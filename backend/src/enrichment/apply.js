// Applying what a company's website said to the dataset, under the rules:
//
//   1. Never fabricate: every row traces to a page that was read, and says in its note what it read.
//   2. Store evidence and source: sources are reused by URL (and note that they were read again).
//   3. Preserve what is there: a value the record holds is never overwritten, and a claim a person
//      turned down (a rejected or superseded row) is not added again.
//   4. Flag conflicts: evidence that disagrees with the record, or with other sources, is reported
//      (detectConflicts) for a person; nothing here resolves one.
//   5. Leave unknown what the evidence does not settle: a field with two different claims stays as it was.
//   6. Record when and how sure: each row has verified_at and a confidence; the company's own
//      last_verified_at and confidence_score follow from them when the data is migrated.
//
// It works on a working copy of the dataset and writes nothing: the caller migrates, validates and writes.
import { slugify, uniqueSlug } from '../models/company.js';
import { makeEvidenceRow, valuesEqual, storedValue, activeEvidence, bestConfidence, detectConflicts, EVIDENCE_FIELDS } from '../models/evidence.js';
import { decide } from './policy.js';
import { setField, isUnknown } from './fill.js';

const pageSlug = (url) => { try { return slugify(new URL(url).pathname) || 'website'; } catch { return 'page'; } };

// The id of the source row for a page: the existing row with that URL (a hand-written source keeps its
// note, and just records that the page was read again), or a new one.
export function upsertSource(work, companyId, src) {
  work.sources ??= [];
  const hit = work.sources.find((s) => s.url && src.url && valuesEqual('website', s.url, src.url));
  if (hit) {
    if (src.retrieved_at && (!hit.retrieved_at || Date.parse(src.retrieved_at) > Date.parse(hit.retrieved_at))) hit.retrieved_at = src.retrieved_at;
    return hit.id;
  }
  // The id reads as what it is: "acme-privacy-policy", or "acme-lever-jobs" for a board (the caller names it).
  const id = uniqueSlug(slugify(`${companyId}-${src.slug ?? pageSlug(src.url)}`).slice(0, 64), new Set(work.sources.map((s) => s.id)));
  work.sources.push({ id, kind: src.kind, url: src.url, title: src.title ?? null, publisher: src.publisher ?? null, retrieved_at: src.retrieved_at, note: src.note ?? '' });
  return id;
}

function distinct(field, rows) {
  const out = [];
  for (const r of rows) if (!out.some((d) => valuesEqual(field, d, r.value))) out.push(r.value);
  return out;
}

const matchesRecord = (company, field, value) => (field === 'hiring_status'
  ? value === 'hiring' && company.hiring === true
  : valuesEqual(field, storedValue(company, field), value));

// Postings found on the pages read this time are added or kept open. A posting from a page that was read
// this time and is no longer on it is closed; one from a page not read is left alone.
function upsertJobs(work, company, analysis, retrieved) {
  const out = { added: 0, updated: 0, closed: 0 };
  work.jobs ??= [];
  const keyOf = (r) => `${r.title.toLowerCase().trim()}|${r.apply_url ?? ''}`;
  const seen = new Set();
  for (const j of analysis.jobs ?? []) {
    const sourceId = upsertSource(work, company.id, j.source);
    const existing = work.jobs.find((r) => r.company_id === company.id && keyOf(r) === keyOf(j));
    const fields = { location: j.location, employment_type: j.employment_type, remote: j.remote, posted_at: j.posted_at };
    if (existing) {
      Object.assign(existing, { status: 'open', retrieved_at: retrieved, source_id: sourceId, ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v ?? existing[k] ?? null])) });
      seen.add(existing.id);
      out.updated += 1;
    } else {
      const id = uniqueSlug(slugify(`${company.id}-${j.title}`).slice(0, 80), new Set(work.jobs.map((r) => r.id)));
      work.jobs.push({ id, company_id: company.id, title: j.title, ...fields, apply_url: j.apply_url, status: 'open', source_id: sourceId, retrieved_at: retrieved });
      seen.add(id);
      out.added += 1;
    }
  }
  const readSources = new Set(analysis.pages.map((p) => work.sources.find((s) => s.url && valuesEqual('website', s.url, p.url))?.id).filter(Boolean));
  for (const r of work.jobs) {
    if (r.company_id === company.id && r.status === 'open' && readSources.has(r.source_id) && !seen.has(r.id)) {
      Object.assign(r, { status: 'closed', retrieved_at: retrieved });
      out.closed += 1;
    }
  }
  return out;
}

export function applyCompanyEnrichment(work, { companyId, analysis, at, mode = 'suggest' }) {
  const company = work.companies.find((c) => c.id === companyId);
  if (!company) throw new Error(`no company "${companyId}"`);
  const s = {
    outcome: 'read', pages: analysis.pages, evidence_added: 0, evidence_refreshed: 0,
    applied: [], suggested: [], confirmed: [], conflicts: [], held: [], jobs: { added: 0, updated: 0, closed: 0 },
    warnings: [...analysis.warnings], refused: analysis.errors.map(({ url, code, message }) => ({ url, code, message })), changes: [],
  };
  if (analysis.mismatch) return { ...s, outcome: 'mismatch' };
  if (analysis.blocked) return { ...s, outcome: 'blocked' };
  if (analysis.pages.length === 0) return { ...s, outcome: 'unreachable' };

  work.evidence ??= [];
  const retrieved = analysis.retrieved_at ?? at;
  const touched = new Set();
  const taken = new Set(work.evidence.map((e) => e.id));

  for (const row of analysis.evidence) {
    const sourceId = upsertSource(work, company.id, row.source);
    const same = (e) => e.company_id === company.id && e.field === row.field && valuesEqual(row.field, e.value, row.value);
    const turnedDown = work.evidence.find((e) => same(e) && e.status !== 'active');
    if (turnedDown) { s.held.push(`${row.field} ${JSON.stringify(row.value)} was turned down earlier (${turnedDown.status}), so it is not added again`); continue; }
    touched.add(row.field);
    const existing = work.evidence.find((e) => same(e) && e.source_id === sourceId);
    if (existing) {
      // The same page says the same thing again: it was checked again, and that is what is recorded.
      if (row.verified_at && (!existing.verified_at || Date.parse(row.verified_at) > Date.parse(existing.verified_at))) existing.verified_at = row.verified_at;
      s.evidence_refreshed += 1;
      continue;
    }
    const made = makeEvidenceRow({ company_id: company.id, field: row.field, value: row.value, source_id: sourceId, confidence: row.confidence, verified_at: row.verified_at, note: row.note }, taken);
    taken.add(made.id);
    work.evidence.push(made);
    s.evidence_added += 1;
  }

  for (const field of touched) {
    const rows = activeEvidence(work).filter((e) => e.company_id === company.id && e.field === field);
    const spec = EVIDENCE_FIELDS[field];
    const best = bestConfidence(rows.map((r) => r.confidence));
    const values = distinct(field, rows);

    if (spec.cardinality === 'multi') {
      const stored = storedValue(company, field) ?? [];
      const missing = values.filter((v) => !stored.some((m) => valuesEqual(field, m, v)));
      for (const v of values) if (!missing.includes(v)) s.confirmed.push({ field, value: v });
      if (!missing.length) continue;
      if (decide(field, best, mode) === 'fill') { s.changes.push(...setField(company, field, missing)); s.applied.push({ field, value: missing, confidence: best }); } else s.suggested.push({ field, value: missing, confidence: best });
      continue;
    }

    // One value at a time (free text included: its rows are never compared, so the first and strongest is the one used).
    const ordered = spec.cardinality === 'text' ? [...rows].sort((a, b) => (b.confidence === 'high') - (a.confidence === 'high')) : rows;
    if (spec.cardinality !== 'text' && values.length > 1) continue; // sources disagree: reported below, not settled here
    const value = ordered[0].value;
    if (!isUnknown(company, field)) {
      if (spec.cardinality !== 'text' && matchesRecord(company, field, value)) s.confirmed.push({ field, value });
      continue; // a value the record holds is never overwritten
    }
    const action = decide(field, best, mode);
    if (action === 'fill') { s.changes.push(...setField(company, field, value)); s.applied.push({ field, value, confidence: best }); } else if (action === 'suggest') s.suggested.push({ field, value, confidence: best });
  }

  if (analysis.jobs?.length || work.jobs?.some((r) => r.company_id === company.id)) s.jobs = upsertJobs(work, company, analysis, retrieved);
  if (s.changes.length) company.updated_at = at;

  s.conflicts = detectConflicts(work).filter((c) => c.company_id === company.id && touched.has(c.field))
    .map((c) => ({ field: c.field, kind: c.kind, stored: c.stored, values: c.values.map((v) => ({ value: v.value, confidence: v.best_confidence })) }));
  return s;
}
