// The discovery pipeline, in the order it runs:
//
//   source -> lead -> already seen? -> check existing companies and candidates
//          -> deduplicate -> Australian? -> startup? -> enrich -> confidence -> review
//
// Publishing is not here: it is a separate, human step (review.js, publish.js).
//
// What happens to a lead:
//   - seen before (same source, same key)        nothing new; it is noted as seen
//   - the same company as a pending candidate    its observation and evidence join that candidate
//   - an exact match for an existing company     a 'matched' candidate; enriching the company is
//                                                staged, or done with applyExact
//   - a likely or possible match                 a candidate for a person to settle; no network reads
//   - nothing like it                            checked for Australia and for being a startup, its
//                                                own website read, identity checked again, scored,
//                                                and left waiting for review. A gate rejects it only
//                                                on explicit evidence against, and keeps the record.
//
// Every candidate is created as 'candidate' and moved on by the pipeline to
// needs_review, matched or rejected. approved, merged by a person, and published are
// never reached automatically.
import { createCandidate, moveTo, candidateId } from '../models/candidate.js';
import { EVIDENCE_FIELDS, checkValue } from '../models/evidence.js';
import { canonicalDomain, websiteUrl, nameKey } from '../models/identity.js';
import { buildIndex, addToIndex, identityOfLead, resolveLead, resolveCandidate, OUTCOMES } from './resolve.js';
import { assessAustralian, assessStartup, accumulate } from './relevance.js';
import { scoreCandidate } from './score.js';
import { enrichFromWebsite } from './enrich.js';
import { applyEnrichment } from './publish.js';

// Programs that back startups, recognised in a story alongside the investors we know.
export const ACCELERATORS = ['Startmate', 'Antler', 'Y Combinator', 'Techstars', 'Muru-D', 'BlueChilli', 'SparkLabs', 'Founders Inc'];

const unique = (list) => [...new Set(list)];
const LEGAL_FORM = /\bPty\.?\s+(?:Ltd|Limited)\b/i;
const iso =(v, fallback) => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? d.toISOString() : fallback; };
const evidenceKey = (e) => `${e.field}|${JSON.stringify(e.value)}|${e.source?.url ?? e.source?.kind}`;
const WEBSITE_SOURCES = new Set(['company_website', 'company_document']);

export function knownInvestorNames(ds) {
  return unique([...(ds.investors ?? []).flatMap((i) => [i.name, ...(i.aliases ?? [])]), ...ACCELERATORS]);
}

export function createEngine({ work, fetcher, now = Date.now, fetchImpl, options = {} }) {
  const opts = { enrich: true, applyExact: false, maxLeadsPerSource: 200, ...options };
  work.candidates ??= [];
  work.identifiers ??= [];
  work.evidence ??= [];
  work.sources ??= [];
  const index = buildIndex(work);
  const knownInvestors = knownInvestorNames(work);
  const asOfYear = new Date(now()).getUTCFullYear();
  const at = () => new Date(now()).toISOString();
  const report = { started_at: at(), sources: [], items: [], already_seen: 0, attached: 0, skipped: [], applied: [], dropped_evidence: 0 };

  const note = (candidate, text) => (candidate.notes.some((n) => n.text === text) ? candidate : { ...candidate, notes: [...candidate.notes, { at: at(), by: 'engine', text }] });
  const replace = (next) => {
    const i = work.candidates.findIndex((c) => c.id === next.id);
    if (i >= 0) work.candidates[i] = next; else work.candidates.push(next);
    addToIndex(index, next);
    return next;
  };

  // ---------- leads into candidate parts ----------

  function cleanLead(lead) {
    const name = String(lead.name ?? '').replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 80 || !nameKey(name)) return null;
    const retrieved = iso(lead.retrieved_at, at());
    return { ...lead, name, website: lead.website ? websiteUrl(lead.website) : null, retrieved_at: retrieved, observed_at: iso(lead.observed_at, retrieved) };
  }

  const observationOf = (lead, source) => ({
    source_id: source.id, source_kind: source.kind, license_basis: source.licenseBasis ?? null, region: source.region ?? null,
    key: String(lead.key ?? lead.name), url: lead.url ?? null, title: lead.title ? String(lead.title).slice(0, 200) : null, observed_at: lead.observed_at,
  });

  function evidenceOf(lead, source) {
    const rows = [];
    for (const e of lead.evidence ?? []) {
      const spec = EVIDENCE_FIELDS[e.field];
      if (!spec || checkValue(spec, e.value)) { report.dropped_evidence += 1; continue; }
      rows.push({
        field: e.field, value: e.value, confidence: e.confidence, verified_at: null, note: e.note ?? null,
        source: { kind: source.kind, url: lead.url ?? null, title: lead.title ?? null, publisher: lead.publisher ?? null, retrieved_at: lead.retrieved_at, note: source.license?.basis ? `Source licence basis: ${source.license.basis}.` : '' },
      });
    }
    return rows;
  }

  const mergeEvidence = (candidate, rows) => {
    const seen = new Set(candidate.evidence.map(evidenceKey));
    return { ...candidate, evidence: [...candidate.evidence, ...rows.filter((r) => !seen.has(evidenceKey(r)))] };
  };

  // ---------- assessing and enriching ----------

  function subjectOf(candidate, extra = {}) {
    const text = [extra.text, ...candidate.discoveries.map((d) => d.title), candidate.description, ...candidate.evidence.filter((e) => e.field === 'description').map((e) => e.value)].filter(Boolean).join('. ');
    return {
      name: candidate.name, aliases: candidate.aliases, domain: candidate.domain, state: candidate.state, city: candidate.city,
      address: candidate.address ?? '', external_ids: candidate.external_ids, phones: extra.phones ?? 0, text,
      regions: unique(candidate.discoveries.map((d) => d.region).filter(Boolean)),
      investors: candidate.evidence.filter((e) => e.field === 'investors').map((e) => e.value),
      foundedYear: candidate.evidence.find((e) => e.field === 'founded_year')?.value ?? null,
    };
  }

  const assess = (candidate, extra) => {
    const subject = subjectOf(candidate, extra);
    return {
      ...candidate,
      australian: accumulate(candidate.australian, assessAustralian(subject), 'australian'),
      startup: accumulate(candidate.startup, assessStartup(subject, { knownInvestors, asOfYear }), 'startup'),
    };
  };

  function mergeEnrichment(candidate, result) {
    let next = mergeEvidence(candidate, result.evidence);
    next = {
      ...next,
      external_ids: { abn: next.external_ids.abn ?? result.external_ids.abn, acn: next.external_ids.acn ?? result.external_ids.acn },
      // A legal name is kept even though it compares equal to the trading name: it is the
      // company's registered identity. Any other name is kept only if it is a different name.
      aliases: unique([...next.aliases, ...result.legalNames, ...result.aliases])
        .filter((a) => nameKey(a) && (LEGAL_FORM.test(a) || nameKey(a) !== nameKey(next.name))),
    };
    const pick = (field) => { const rows = result.evidence.filter((e) => e.field === field); return (rows.find((e) => e.confidence === 'high') ?? rows[0])?.value ?? null; };
    next.address ??= pick('address');
    next.city ??= pick('city');
    next.state ??= pick('state');
    next.description ??= pick('description');
    if (!next.founders.length) next.founders = unique(result.evidence.filter((e) => e.field === 'founders').map((e) => e.value));
    for (const w of result.warnings) next = note(next, w);
    for (const e of result.errors) next = note(next, `Could not read ${e.url}: ${e.message}`);
    return next;
  }

  const enriched = (candidate) => candidate.evidence.some((e) => WEBSITE_SOURCES.has(e.source?.kind));

  // ---------- settling a candidate: resolve, assess, enrich, score, route ----------

  // A website is read for a new company when enrichment is on, and for any candidate a
  // person asks about. Reading it can change the answer to "have we seen this
  // company?", so identity is checked again afterwards.
  // prefetched: a website read done elsewhere (the enrichment queue reads outside a data transaction and
  // applies the result inside one). keepApproved: an approved candidate stays approved while it is still a
  // clean new company; if the read shows it is not, it goes back to review like any other.
  async function settle(candidate, { text = '', phones = 0, forceEnrich = false, allowReject = true, prefetched = null, keepApproved = false } = {}) {
    let c = { ...candidate, ...resolveCandidate(candidate, index) };
    c = assess(c, { text, phones });
    const gated = (x) => allowReject && x.resolution === OUTCOMES.NEW && (x.australian?.verdict === 'no' || x.startup?.verdict === 'no');
    // The relevance gates come before enrichment: a company that already looks foreign or
    // not a startup is not worth reading the website of.
    const wanted = prefetched || forceEnrich || (opts.enrich && c.resolution === OUTCOMES.NEW && !enriched(c));
    if (wanted && c.website && !gated(c)) {
      const result = prefetched ?? await enrichFromWebsite(c.website, { fetcher, now, candidateNames: [c.name, ...c.aliases] });
      c = mergeEnrichment(c, result);
      c = assess(c, { text, phones: result.signals.phones });
      c = { ...c, ...resolveCandidate(c, index) };
    }
    c = { ...c, confidence: scoreCandidate(c) };
    if (keepApproved && c.status === 'approved' && c.resolution === OUTCOMES.NEW) return c;
    return route(c, { allowReject });
  }

  function route(c, { allowReject = true } = {}) {
    const move = (status, why) => (c.status === status ? c : moveTo(c, status, { at: at(), by: 'engine', note: why }));
    if (c.resolution === OUTCOMES.EXACT && c.matches[0]?.kind === 'company') {
      return move('matched', `exact match for ${c.matches[0].name}`);
    }
    if (allowReject && c.resolution === OUTCOMES.NEW && (c.australian?.verdict === 'no' || c.startup?.verdict === 'no')) {
      const why = [['not Australian', c.australian], ['not a startup', c.startup]]
        .filter(([, a]) => a?.verdict === 'no')
        .map(([label, a]) => `${label}: ${a.signals.filter((s) => s.weight < 0).map((s) => `${s.code} (${s.detail})`).join(', ')}`).join('; ');
      return move('rejected', `auto-rejected - ${why}`);
    }
    return move('needs_review', c.resolution === OUTCOMES.NEW ? 'ready for review' : `possible duplicate: ${c.matches[0].name}`);
  }

  function afterRoute(c, sourceId) {
    if (c.status === 'matched' && opts.applyExact) {
      const { candidate, summary } = applyEnrichment(work, c, { by: 'engine:exact', at: at() });
      report.applied.push(summary);
      c = candidate;
    }
    report.items.push({ id: c.id, name: c.name, status: c.status, resolution: c.resolution, confidence: c.confidence?.label, score: c.confidence?.score, source: sourceId, match: c.matches[0]?.name ?? null });
    return replace(c);
  }

  // ---------- one lead ----------

  async function attach(existing, lead, source) {
    let next = { ...existing, discoveries: [...existing.discoveries, observationOf(lead, source)], last_seen_at: at() };
    next = mergeEvidence(next, evidenceOf(lead, source));
    if (!next.website && lead.website) { next.website = lead.website; next.domain = canonicalDomain(lead.website)?.domain ?? null; }
    if (nameKey(lead.name) !== nameKey(next.name)) next.aliases = unique([...next.aliases, lead.name]);
    report.attached += 1;
    if (!['candidate', 'needs_review', 'matched'].includes(next.status)) { replace(next); report.items.push({ id: next.id, name: next.name, status: next.status, attached: true, source: source.id }); return; }
    const settled = await settle(next, { text: lead.text ?? '' });
    const result = afterRoute(settled, source.id);
    report.items[report.items.length - 1].attached = true;
    return result;
  }

  async function handleLead(raw, source) {
    const lead = cleanLead(raw);
    if (!lead) { report.skipped.push({ source: source.id, key: raw.key ?? null, reason: 'no usable company name' }); return; }

    const seen = work.candidates.find((c) => c.discoveries.some((d) => d.source_id === source.id && d.key === String(lead.key ?? lead.name)));
    if (seen) { replace({ ...seen, last_seen_at: at() }); report.already_seen += 1; return; }

    const first = resolveLead(identityOfLead(lead), index);
    if (first.best?.outcome === OUTCOMES.EXACT && first.best.target.kind === 'candidate') {
      await attach(work.candidates.find((c) => c.id === first.best.target.id), lead, source);
      return;
    }

    const id = candidateId(lead.name, new Set(work.candidates.map((c) => c.id)));
    let candidate = createCandidate({
      id, name: lead.name, aliases: lead.aliases ?? [], website: lead.website, description: lead.description ?? null, city: lead.city ?? null,
      state: lead.state ?? null, address: lead.address ?? null, founders: lead.founders ?? [], external_ids: lead.external_ids ?? {},
      discoveries: [observationOf(lead, source)], evidence: evidenceOf(lead, source),
    }, { at: at(), by: 'engine' });
    candidate = await settle(candidate, { text: lead.text ?? '' });
    afterRoute(candidate, source.id);
  }

  async function run(sources) {
    const ctx = { fetcher, now, knownInvestors, fetchImpl };
    for (const source of sources) {
      const entry = { id: source.id, leads: 0, error: null };
      report.sources.push(entry);
      let leads;
      try {
        leads = await source.discover(ctx);
      } catch (err) {
        entry.error = `${err.code ? `${err.code}: ` : ''}${err.message}`;
        continue;
      }
      entry.leads = leads.length;
      for (const lead of leads.slice(0, opts.maxLeadsPerSource)) await handleLead(lead, source);
    }
    return report;
  }

  // A person supplies (or corrects) a candidate's website, and the engine reads it,
  // checks identity again and rescores. Never auto-rejects: a person is already looking.
  async function enrichCandidate(id, { website, by }) {
    const existing = work.candidates.find((c) => c.id === id);
    if (!existing) throw new Error(`no candidate "${id}"`);
    if (!['needs_review', 'matched'].includes(existing.status)) throw new Error(`candidate ${id} is ${existing.status}: only one waiting for review can be enriched`);
    let c = { ...existing };
    if (website) {
      const url = websiteUrl(website);
      if (!url) throw new Error(`"${website}" is not a usable company website`);
      c.website = url;
      c.domain = canonicalDomain(url).domain;
      c = mergeEvidence(c, [{ field: 'website', value: url, confidence: 'low', verified_at: null, note: `Supplied by ${by}.`, source: { kind: 'user_supplied', url: null, title: 'Supplied by a reviewer', publisher: by, retrieved_at: at(), note: '' } }]);
    }
    return afterRoute(await settle(c, { forceEnrich: true, allowReject: false }), 'review');
  }

  // Applies a website read that was done elsewhere to a candidate: the same merge, identity check, scoring
  // and routing as enrichCandidate, without the network. Allowed while the candidate is waiting for review
  // or approved (a newly approved candidate is enriched before it is published, so the evidence goes with it).
  async function enrichCandidateWith(id, result) {
    const existing = work.candidates.find((c) => c.id === id);
    if (!existing) throw new Error(`no candidate "${id}"`);
    if (!['needs_review', 'matched', 'approved'].includes(existing.status)) throw new Error(`candidate ${id} is ${existing.status}: it can no longer be enriched`);
    return afterRoute(await settle({ ...existing }, { prefetched: result, allowReject: false, keepApproved: true }), 'queue');
  }

  return { run, enrichCandidate, enrichCandidateWith, report, index };
}

export async function runDiscovery({ ds, sources, fetcher, now = Date.now, fetchImpl, options = {} }) {
  const work = structuredClone(ds);
  const engine = createEngine({ work, fetcher, now, fetchImpl, options });
  const report = await engine.run(sources);
  report.requests = fetcher?.log?.requests?.length ?? 0;
  report.refused = fetcher?.log?.refused ?? [];
  return { ds: work, report };
}
