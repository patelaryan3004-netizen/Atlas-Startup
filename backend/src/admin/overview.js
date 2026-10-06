// What the Command Center shows, worked out from one snapshot of the data. Pure: a dataset and a clock in,
// plain objects out, so every number on the dashboard can be tested against data whose answer is known.
//
// The eight headline numbers, and what each means exactly:
//   TOTAL COMPANIES      every company in the directory
//   PUBLISHED            the companies the public site lists (all of them), split into on the map / unconfirmed
//   NEW CANDIDATES       found in the last 7 days and still open (not yet rejected, merged or published)
//   NEEDS REVIEW         waiting for a person: new companies and possible duplicates
//   POTENTIAL DUPLICATES open candidates that look like a company we have, plus pairs of companies that look alike
//   UPDATED THIS WEEK    companies edited or re-verified in the last 7 days
//   MISSING DATA         companies missing a core fact: website, sector, location, stage or description
//   FAILED IMPORTS       sources whose latest import failed and nobody has looked, plus enrichment tasks that failed
import { auditDataset, findPossibleDuplicates } from '../models/audit.js';
import { detectConflicts } from '../models/evidence.js';
import { failedImports } from '../models/importRuns.js';
import { queueSummary, latestTasks } from '../models/enrichmentQueue.js';
import { suggestionsOf, LOCATION_FIELDS } from './decisions.js';
import { locationOf } from '../discovery/report.js';
import { buildSourceConfig } from '../discovery/config.js';
import { schedulerStatus } from '../scheduler/status.js';

const DAY = 86400000;
export const OPEN = ['candidate', 'needs_review', 'matched', 'approved'];
// The core facts a company is "missing data" without. A location is two audit attributes (a city and a pin).
export const MISSING_KEYS = { website: ['website'], sector: ['sector'], location: ['city', 'coordinates'], stage: ['stage'], description: ['description'] };
const iso = (ms) => new Date(ms).toISOString();
const pct = (n, total) => (total ? Math.round((n / total) * 1000) / 10 : 0);

// The labels the directory already uses, most used first, for a person typing a sector or a stage to pick from
// (so "HealthTech" is not typed as "Health Tech"). A lifecycle note such as "Acquired" is not a stage to choose.
function vocabulary(values) {
  const counts = new Map();
  for (const v of values) {
    const s = String(v ?? '').trim();
    if (s && !/^(unknown|n\/a|defunct|acquired|subsidiary)/i.test(s)) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([label]) => label);
}

// Which core facts each company lacks. The MISSING DATA tile counts these, and the list behind it is these.
const missingOf = (audit) => audit.companies
  .map((c) => ({ company: c, missing: Object.entries(MISSING_KEYS).filter(([, keys]) => keys.some((k) => c.states[k] !== 'present')).map(([key]) => key) }))
  .filter((r) => r.missing.length);

export function buildOverview(ds, nowMs) {
  const audit = auditDataset(ds, { asOf: iso(nowMs).slice(0, 10) });
  const weekAgo = nowMs - 7 * DAY;
  const open = ds.candidates.filter((c) => OPEN.includes(c.status));
  const onMap = ds.companies.filter((c) => c.verified === true).length;
  const failedSources = failedImports(ds.import_runs ?? []);
  const failedTasks = (ds.enrichment_queue ?? []).filter((t) => t.status === 'failed');
  const fresh = ds.companies.filter((c) => [c.updated_at, c.last_verified_at].some((t) => t && Date.parse(t) >= weekAgo)).length;
  const missing = missingOf(audit).length;
  const lookAlikes = open.filter((c) => c.resolution !== 'NEW_COMPANY').length;

  const h = audit.headline;
  const attr = Object.fromEntries(audit.attributes.map((a) => [a.key, a]));
  const bar = (key, label, present, backedKey = key, note = null) => ({ key, label, present, total: h.total, pct: pct(present, h.total), backed: attr[backedKey]?.evidenceBacked ?? 0, note });
  const unknownLocation = ds.companies.filter((c) => c.verified !== true).length;

  return {
    generated_at: iso(nowMs),
    tiles: {
      total_companies: ds.companies.length,
      published: ds.companies.length,
      new_candidates: open.filter((c) => Date.parse(c.first_discovered_at) >= weekAgo).length,
      needs_review: ds.candidates.filter((c) => c.status === 'needs_review').length,
      potential_duplicates: lookAlikes + audit.duplicates.length,
      updated_this_week: fresh,
      missing_data: missing,
      failed_imports: failedSources.length + failedTasks.length,
    },
    detail: {
      published: { on_map: onMap, unconfirmed: ds.companies.length - onMap },
      new_candidates: { open_in_total: open.length, all_candidates: ds.candidates.length },
      potential_duplicates: { candidates: lookAlikes, company_pairs: audit.duplicates.length },
      failed_imports: { sources: failedSources.length, enrichment_tasks: failedTasks.length },
      missing_data: { core_attributes: 'website, sector, location, stage, description' },
    },
    quality: [
      bar('website', 'Website coverage', h.website),
      bar('sector', 'Sector coverage', h.sector, 'sector', `${h.specificSector} are a specific industry`),
      bar('location', 'Location coverage', h.location, 'coordinates', `${unknownLocation} unconfirmed, so not on the map`),
      bar('stage', 'Stage coverage', h.stage),
      bar('founders', 'Founder coverage', h.founder, 'founders'),
      bar('funding', 'Funding coverage', h.funding),
      bar('investors', 'Investor coverage', h.investors),
    ],
    provenance: { companies_with_sources: audit.cohorts.withSources, companies_without_sources: audit.cohorts.withoutSources, evidence_rows: ds.evidence.length, sources: ds.sources.length },
    attention: { open_conflicts: detectConflicts(ds).length, suggestions: suggestionsOf(ds).length, priority: audit.tierCounts },
    vocab: { sectors: vocabulary(ds.companies.map((c) => c.sector)).slice(0, 40), stages: vocabulary(ds.companies.map((c) => c.stage)) },
  };
}

// ---------- candidates ----------

export const ACTIONS_FOR = {
  candidate: ['edit', 'reject'],
  matched: ['merge', 'distinct', 'reject', 'edit'],
  approved: ['publish', 'reject', 'edit', 'reopen', 'enrich'],
  rejected: ['reopen'],
};

export function actionsFor(c) {
  if (c.status === 'needs_review') return c.resolution === 'NEW_COMPANY' ? ['approve', 'reject', 'edit', 'merge', 'enrich'] : ['distinct', 'merge', 'reject', 'edit', 'enrich'];
  return ACTIONS_FOR[c.status] ?? [];
}

const sectorOf = (c) => c.evidence.filter((e) => e.field === 'sector').at(-1)?.value ?? null;

export function candidateRow(c) {
  const first = c.discoveries[0];
  return {
    id: c.id, name: c.name, status: c.status, resolution: c.resolution,
    source: { id: first?.source_id ?? null, kind: first?.source_kind ?? null, count: c.discoveries.length, url: first?.url ?? null, title: first?.title ?? null },
    location: locationOf({ address: c.address, city: c.city, state: c.state }),
    sector: sectorOf(c), confidence: c.confidence ? { label: c.confidence.label, score: c.confidence.score } : null,
    discovered_at: c.first_discovered_at, website: c.website,
    match: c.matches[0] ? { kind: c.matches[0].kind, id: c.matches[0].id, name: c.matches[0].name, outcome: c.matches[0].outcome } : null,
    actions: actionsFor(c), notes: c.notes.length,
  };
}

const FILTERS = {
  open: (c) => OPEN.includes(c.status),
  new: (c, now) => OPEN.includes(c.status) && Date.parse(c.first_discovered_at) >= now - 7 * DAY,
  needs_review: (c) => c.status === 'needs_review',
  duplicates: (c) => OPEN.includes(c.status) && c.resolution !== 'NEW_COMPANY',
  all: () => true,
};

export function listCandidates(ds, nowMs, { status = 'open', q = '', limit = 200 } = {}) {
  const keep = FILTERS[status] ?? ((c) => c.status === status);
  const needle = String(q).toLowerCase().trim();
  const rows = ds.candidates
    .filter((c) => keep(c, nowMs) && (!needle || [c.name, c.website, ...c.aliases].some((s) => String(s ?? '').toLowerCase().includes(needle))))
    .sort((a, b) => Date.parse(b.first_discovered_at) - Date.parse(a.first_discovered_at) || (b.confidence?.score ?? 0) - (a.confidence?.score ?? 0))
    .map(candidateRow);
  const counts = Object.fromEntries(Object.keys(FILTERS).map((k) => [k, ds.candidates.filter((c) => FILTERS[k](c, nowMs)).length]));
  return { total: rows.length, counts, results: rows.slice(0, limit) };
}

export function candidateDetail(ds, id) {
  const c = ds.candidates.find((x) => x.id === id);
  if (!c) return null;
  return { ...candidateRow(c), aliases: c.aliases, description: c.description, city: c.city, state: c.state, address: c.address, founders: c.founders, external_ids: c.external_ids,
    discoveries: c.discoveries, evidence: c.evidence, matches: c.matches, australian: c.australian, startup: c.startup, confidence_breakdown: c.confidence?.breakdown ?? null,
    notes: c.notes, status_history: c.status_history, decisions: c.decisions, review: c.review, published_company_id: c.published_company_id };
}

export function searchCompanies(ds, q, limit = 8) {
  const needle = String(q ?? '').toLowerCase().trim();
  if (needle.length < 2) return [];
  return ds.companies.filter((c) => c.name.toLowerCase().includes(needle) || c.slug?.includes(needle) || String(c.website ?? '').toLowerCase().includes(needle))
    .slice(0, limit).map((c) => ({ id: c.id, name: c.name, city: c.city, website: c.website || null, on_map: c.verified === true }));
}

// ---------- what the tiles lead to ----------

// The companies behind MISSING DATA, with what each lacks and whether its website is already waiting to be read.
export function missingData(ds, nowMs) {
  const audit = auditDataset(ds, { asOf: iso(nowMs).slice(0, 10) });
  const task = new Map(latestTasks(ds.enrichment_queue ?? []).filter((t) => t.kind === 'company').map((t) => [t.target_id, t]));
  const rows = missingOf(audit).map(({ company: c, missing }) => ({
    id: c.id, name: c.name, website: c.website, city: c.city, on_map: c.verified, missing,
    enrichment: task.has(c.id) ? { status: task.get(c.id).status, outcome: task.get(c.id).result?.outcome ?? null } : null,
  })).sort((a, b) => b.missing.length - a.missing.length || a.name.localeCompare(b.name));
  return { total: rows.length, counts: Object.fromEntries(Object.keys(MISSING_KEYS).map((k) => [k, rows.filter((r) => r.missing.includes(k)).length])), results: rows };
}

// The pairs of published companies behind POTENTIAL DUPLICATES (the other part is open candidates that look like a company).
export const companyDuplicates = (ds) => findPossibleDuplicates(ds.companies).map((g) => ({ reason: g.reason, names: g.names, company_ids: g.company_ids }));

// ---------- conflicts and suggestions ----------

function describeEvidence(ds, id) {
  const e = ds.evidence.find((x) => x.id === id);
  const s = ds.sources.find((x) => x.id === e.source_id);
  return { id: e.id, confidence: e.confidence, verified_at: e.verified_at, note: e.note, source: { id: s.id, kind: s.kind, title: s.title, url: s.url, publisher: s.publisher, retrieved_at: s.retrieved_at } };
}

export function listConflicts(ds) {
  const byId = new Map(ds.companies.map((c) => [c.id, c]));
  return detectConflicts(ds).map((c) => ({
    company_id: c.company_id, company_name: c.company_name, field: c.field, kind: c.kind, stored: c.stored,
    location: LOCATION_FIELDS.includes(c.field), pinned: byId.get(c.company_id)?.verified === true, city: byId.get(c.company_id)?.city ?? null,
    sides: c.values.map((v) => ({ value: v.value, confidence: v.best_confidence, matches_stored: v.matches_stored, evidence: v.evidence_ids.map((id) => describeEvidence(ds, id)) })),
  }));
}

export function listSuggestions(ds) {
  return suggestionsOf(ds).map((s) => ({ ...s, evidence: s.evidence_ids.map((id) => describeEvidence(ds, id)) }));
}

// ---------- queue, imports, audit ----------

const finishedOrder = (a, b) => Date.parse(b.finished_at ?? 0) - Date.parse(a.finished_at ?? 0);
const taskView = (t) => ({ id: t.id, kind: t.kind, target_id: t.target_id, status: t.status, priority: t.priority, reason: t.reason, attempts: t.attempts, last_error: t.last_error, outcome: t.result?.outcome ?? null, result: t.result, finished_at: t.finished_at, not_before: t.not_before, wanted: t.wanted });

export function queuePanel(ds, nowMs) {
  const tasks = ds.enrichment_queue ?? [];
  const name = new Map([...ds.companies.map((c) => [c.id, c.name]), ...ds.candidates.map((c) => [c.id, c.name])]);
  const view = (t) => ({ ...taskView(t), name: name.get(t.target_id) ?? t.target_id });
  // What needs a person is judged on each company's latest task: an older attempt that has been superseded is history.
  const now = latestTasks(tasks);
  const attention = now.filter((t) => t.status === 'failed' || ['mismatch', 'blocked', 'unreachable'].includes(t.result?.outcome) || (t.status === 'queued' && t.attempts > 0));
  return {
    summary: queueSummary(tasks, iso(nowMs)),
    running: tasks.filter((t) => t.status === 'running').map(view),
    attention: attention.map(view),
    declined: now.filter((t) => t.status === 'skipped' && t.result?.outcome === 'refused').map(view),
    no_website: now.filter((t) => t.status === 'skipped' && t.result?.outcome === 'no_website').length,
    recent: tasks.filter((t) => t.status === 'done').sort(finishedOrder).slice(0, 12).map(view),
  };
}

export function importsPanel(ds) {
  const runs = [...(ds.import_runs ?? [])].sort((a, b) => Date.parse(b.finished_at) - Date.parse(a.finished_at));
  return {
    failures: failedImports(ds.import_runs ?? []),
    runs: runs.slice(0, 10).map((r) => ({ id: r.id, finished_at: r.finished_at, by: r.by, trigger: r.trigger, status: r.status, totals: r.totals, failed_sources: r.sources.filter((s) => s.error).map((s) => s.id), declined_pages: r.refused.length })),
  };
}

// What the scheduler is doing: the jobs and when they next run, the facets and their pace, what is on the status
// watch (with the companies' names), and the latest runs. Read only: the scheduler is run from a terminal or a schedule.
export function schedulerPanel(ds, nowMs, env = process.env) {
  const configured = buildSourceConfig(env).filter((c) => c.enabled !== false);
  const status = schedulerStatus(ds, { at: iso(nowMs), sourceIds: configured.map((c) => c.id), fundingIds: configured.filter((c) => c.adapter === 'rss').map((c) => c.id) });
  const names = new Map(ds.companies.map((c) => [c.id, c.name]));
  const named = (id) => names.get(id) ?? id;
  return {
    ...status,
    watch: status.watch.map((w) => ({ ...w, name: named(w.company_id) })),
    recent: status.recent.map((r) => ({ ...r })),
  };
}

export function auditPage(ds, { limit = 100, actor = null, action = null, target = null } = {}) {
  const rows = [...(ds.audit_trail ?? [])].reverse().filter((r) => (!actor || r.actor === actor) && (!action || r.action === action || r.action.startsWith(`${action}.`)) && (!target || r.target.id === target));
  return { total: rows.length, results: rows.slice(0, Math.min(limit, 500)) };
}
