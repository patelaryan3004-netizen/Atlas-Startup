// Data-completeness audit and enrichment queue.
//
// Read-only and pure: it inspects the dataset and returns findings. It never
// writes to a company and never proposes a value - the queue holds questions
// ("find the website"), not answers.
//
// What the legacy data can and cannot say is the reason for the definitions
// below. startups.json encodes "unknown" five ways ('' / 'Unknown' / missing key
// / null / []), carries no observation dates, and has no sources, so:
//   - an attribute is PRESENT only if it holds a real value; the five encodings
//     are reported separately rather than lumped together;
//   - hiring and stage are "potentially stale" when no dated check is on record
//     (evidence.verified_at), which is every legacy record. Risk tiers say which
//     matter most: a public "hiring now" claim decays faster than a late-stage
//     label, so those lead the queue;
//   - provenance coverage is reported next to value coverage, so a field that is
//     filled in but unsourced is visible as such.
import {
  activeEvidence, detectConflicts, findUnappliedEvidence, findWeakEvidence, evidenceCoverage,
} from './evidence.js';

export const AUDIT_DEFAULTS = { hiringStaleDays: 30, stageStaleDays: 180 };

const DAY_MS = 86400000;
const UNKNOWN_RE = /^(?:unknown|n\/?a|tbd|tba|none|null|undefined|-+)$/i;
const AU_BBOX = { latMin: -45, latMax: -9, lngMin: 110, lngMax: 155 };

// Labels that name a business model or product type, not the industry served.
// Kept short on purpose: 'AI' stays off the list because this dataset uses it as
// a primary sector (sectorFull then narrows it, e.g. "AI / Sports Tech").
export const GENERIC_SECTORS = [
  'saas', 'b2b saas', 'enterprise', 'enterprise software', 'software', 'consumer',
  'marketplace', 'hardware', 'data', 'analytics', 'tech', 'technology', 'other', 'general', 'misc',
];

// How quickly a stage label goes out of date. Unlisted labels are 'medium'.
export const STAGE_VOLATILITY = {
  'Pre-seed': 'high', Seed: 'high', Early: 'high', 'Series A': 'high',
  'Series B': 'medium', 'Series B+': 'medium', Growth: 'medium', 'Other Equity': 'medium',
  'Series C': 'low', 'Series C+': 'low', 'Series D': 'low', 'Series D+': 'low', 'Series E': 'low', Unicorn: 'low',
};
const EARLY_STAGES = new Set(['Pre-seed', 'Seed', 'Early']);
const STAGE_PROMINENCE = {
  Unicorn: 5, 'Series E': 4, 'Series D+': 4, 'Series D': 4, 'Series C+': 4, 'Series C': 4,
  'Series B+': 3, 'Series B': 3, Growth: 3, 'Series A': 2, Seed: 2, Early: 1, 'Pre-seed': 1,
};

// The 14 things asked about, in report order. group: core attributes are what
// the map and filters rely on; depth is nice to have; provenance is traceability.
export const ATTRIBUTES = [
  { key: 'website', label: 'Website', group: 'core', evidence: ['website'] },
  { key: 'sector', label: 'Sector', group: 'core', evidence: ['sector'] },
  { key: 'city', label: 'City', group: 'core', evidence: ['city'] },
  { key: 'state', label: 'State', group: 'core', evidence: ['state'] },
  { key: 'coordinates', label: 'Coordinates', group: 'core', evidence: ['address'] },
  { key: 'stage', label: 'Stage', group: 'core', evidence: ['stage'] },
  { key: 'hiring', label: 'Hiring status', group: 'depth', evidence: ['hiring_status'] },
  { key: 'description', label: 'Description', group: 'core', evidence: ['description'] },
  { key: 'founders', label: 'Founders', group: 'depth', evidence: ['founders'] },
  { key: 'founded_year', label: 'Founded year', group: 'depth', evidence: ['founded_year'] },
  { key: 'funding', label: 'Funding information', group: 'depth', evidence: ['funding_total', 'last_funding_round', 'last_funding_date'] },
  { key: 'investors', label: 'Investor information', group: 'depth', evidence: ['investors'] },
  { key: 'source', label: 'Source', group: 'provenance', evidence: [] },
  { key: 'last_verified', label: 'Last verified date', group: 'provenance', evidence: [] },
];

// Each way a company can be incomplete, wrong or out of date, as a unit of
// work. tier: 0 integrity (public data is wrong or contradicts itself),
// 1 core identity (map, filters, cards), 2 freshness and confidence,
// 3 depth. weight orders work within a company and between companies.
export const TASKS = {
  source_conflict: { tier: 0, weight: 100, issue: 'Sources disagree on a field', action: 'Read both sources and decide which claim holds. Mark the other evidence row rejected or superseded (with a note) and update the record if needed.' },
  hiring_on_defunct: { tier: 0, weight: 100, issue: 'Flagged hiring but marked defunct', action: 'Confirm whether the company has ceased trading and clear the hiring flag if so.' },
  missing_coordinates: { tier: 0, weight: 95, issue: 'Confirmed location has no coordinates', action: 'Geocode the address (or city) and set lat and lng.' },
  invalid_website: { tier: 0, weight: 90, issue: 'Website is not a valid company URL', action: "Find the company's official site and correct the URL." },
  coordinates_outside_australia: { tier: 0, weight: 90, issue: 'Pin is outside Australia', action: 'Re-check the address and geocode again.' },
  possible_duplicate: { tier: 0, weight: 80, issue: 'Possible duplicate of another company', action: 'Compare the records and merge them or record how they differ.' },
  missing_website: { tier: 1, weight: 70, issue: 'No website', action: "Find the company's official site (an investor portfolio page is a good start) and record it with its source." },
  unconfirmed_location: { tier: 1, weight: 65, issue: 'Australian HQ not confirmed (so not on the map)', action: 'Look for an Australian address on the company site (contact, privacy or terms page). Leave it Unconfirmed if there is none.' },
  unknown_city: { tier: 1, weight: 60, issue: 'Confirmed location but city is unknown', action: 'Set the city from the address.' },
  unknown_sector: { tier: 1, weight: 60, issue: 'Sector unknown', action: "Choose a sector from the company's own description." },
  missing_description: { tier: 1, weight: 50, issue: 'No description', action: "Write a one-line description from the company's own site." },
  unknown_stage: { tier: 1, weight: 45, issue: 'Stage unknown', action: 'Check the latest funding announcement and record the round with its source.' },
  generic_sector: { tier: 1, weight: 35, issue: 'Sector names a business model, not an industry', action: 'Pick the industry the company serves (sectorFull may help).' },
  missing_state: { tier: 1, weight: 30, issue: 'Confirmed location has no state', action: 'Set the state from the address.' },
  stale_hiring: { tier: 2, weight: 40, issue: 'Hiring flag has no dated check', action: 'Open the careers page, set the flag from what is listed, and record it as hiring_status evidence.' },
  lifecycle_check: { tier: 2, weight: 35, issue: 'Marked defunct, acquired or a subsidiary', action: 'Confirm the event and its date, and decide whether the company should stay listed.' },
  stale_stage: { tier: 2, weight: 25, issue: 'Stage looks out of date', action: 'Check for a newer funding round and record stage or last_funding_round evidence.' },
  unapplied_evidence: { tier: 2, weight: 25, issue: 'Evidence recorded but not applied to the record', action: 'Review the evidence and apply it to the record, or reject it.' },
  weak_evidence: { tier: 2, weight: 20, issue: 'Value rests only on low-confidence evidence', action: 'Find a primary source (company page, accelerator profile or investor post).' },
  unverified_stage: { tier: 3, weight: 8, issue: 'Stage has never been checked against a source', action: 'Check the latest funding announcement and record stage or last_funding_round evidence.' },
  missing_funding: { tier: 3, weight: 12, issue: 'No funding information', action: 'Record the latest round from an announcement, with its source.' },
  missing_founders: { tier: 3, weight: 12, issue: 'No founders listed', action: "Check the company's About or team page." },
  missing_investors: { tier: 3, weight: 10, issue: 'No investors listed', action: "Check the company's About page or investor portfolio pages." },
  missing_founded_year: { tier: 3, weight: 8, issue: 'Founded year unknown', action: "Check the company's About page." },
  approximate_pin: { tier: 3, weight: 6, issue: 'Pin is approximate (no street address)', action: 'Find the registered address (privacy policy, terms or contact page) for an exact pin.' },
  no_source: { tier: 3, weight: 4, issue: 'No source on record', action: 'Record where the core facts were checked (usually the company site) as evidence.' },
};

// ---------- classifying single values ----------

// present | unknown ('Unknown', 'N/A', ...) | empty ('' or []) | missing (no key)
// | null | invalid (wrong type or shape)
export function classify(value, kind) {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (kind === 'array') return Array.isArray(value) ? (value.length ? 'present' : 'empty') : 'invalid';
  if (kind === 'number') return typeof value === 'number' && Number.isFinite(value) ? 'present' : 'invalid';
  if (typeof value !== 'string') return 'invalid';
  const s = value.trim();
  if (s === '') return 'empty';
  return UNKNOWN_RE.test(s) ? 'unknown' : 'present';
}

const NOT_A_COMPANY_SITE = ['linkedin.com', 'facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'crunchbase.com',
  'wikipedia.org', 'youtube.com', 'github.com', 'play.google.com', 'apps.apple.com'];
const hostOf = (url) => { try { return new URL(String(url).trim()).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; } };

// Syntax and shape only; whether the site is still up is not checked.
export function websiteProblems(value) {
  const s = String(value).trim();
  const problems = [];
  if (/\s/.test(s)) problems.push('contains whitespace');
  let url;
  try {
    url = new URL(s);
  } catch {
    problems.push(/^[\w-]+(?:\.[\w-]+)+(?:[/?#]|$)/.test(s) ? 'missing http(s):// scheme' : 'not a parseable URL');
    return problems;
  }
  if (!/^https?:$/.test(url.protocol)) problems.push(`unsupported scheme ${url.protocol}`);
  if (!url.hostname.includes('.') || /^\d+(?:\.\d+){3}$/.test(url.hostname) || url.hostname === 'localhost') {
    problems.push('host is not a public domain name');
  }
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  // Exact host or a subdomain of it: airwallex.com must not match x.com.
  if (NOT_A_COMPANY_SITE.some((d) => host === d || host.endsWith(`.${d}`))) problems.push(`points at ${host}, not the company's own site`);
  return problems;
}

const inAustralia = (lat, lng) => lat >= AU_BBOX.latMin && lat <= AU_BBOX.latMax && lng >= AU_BBOX.lngMin && lng <= AU_BBOX.lngMax;
const normLabel = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const nameKey = (name) => normLabel(String(name).replace(/\s*\([^)]*\)/g, ''));

export const isGenericSector = (sector) => GENERIC_SECTORS.some((g) => normLabel(g) === normLabel(sector));

function lifecycleOf(c) {
  if (c.company_status === 'defunct' || /^defunct/i.test(c.stage || '')) return 'defunct';
  if (c.company_status === 'acquired' || /^acquired/i.test(c.stage || '')) return 'acquired';
  if (c.company_status === 'subsidiary' || /^subsidiary/i.test(c.stage || '')) return 'subsidiary';
  return null;
}

// ---------- dataset-level checks ----------

export function findPossibleDuplicates(companies) {
  const groups = [];
  const bucket = (keyOf, reason) => {
    const byKey = new Map();
    for (const c of companies) {
      const key = keyOf(c);
      if (key) byKey.set(key, [...(byKey.get(key) ?? []), c]);
    }
    for (const [key, list] of byKey) {
      if (list.length > 1) groups.push({ reason, key, company_ids: list.map((c) => c.id ?? c.name), names: list.map((c) => c.name) });
    }
  };
  bucket((c) => (classify(c.website, 'string') === 'present' ? hostOf(c.website) : null), 'same website domain');
  bucket((c) => nameKey(c.name), 'same name');
  return groups;
}

// Spellings of one label that differ only by case, spacing or punctuation.
export function labelVariants(values) {
  const groups = new Map();
  for (const v of values) {
    if (classify(v, 'string') !== 'present') continue;
    const counts = groups.get(normLabel(v)) ?? new Map();
    counts.set(v, (counts.get(v) || 0) + 1);
    groups.set(normLabel(v), counts);
  }
  return [...groups.values()].filter((g) => g.size > 1)
    .map((g) => [...g.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count })));
}

export function pinStacks(companies) {
  const byPoint = new Map();
  for (const c of companies) {
    if (typeof c.lat === 'number' && typeof c.lng === 'number') {
      const key = `${c.lat},${c.lng}`;
      byPoint.set(key, [...(byPoint.get(key) ?? []), c]);
    }
  }
  const shared = [...byPoint.entries()].filter(([, list]) => list.length > 1).sort((a, b) => b[1].length - a[1].length);
  return {
    pinned: [...byPoint.values()].reduce((n, l) => n + l.length, 0),
    distinctPoints: byPoint.size,
    sharedPoints: shared.length,
    companiesOnSharedPoints: shared.reduce((n, [, l]) => n + l.length, 0),
    largest: shared.slice(0, 5).map(([point, list]) => ({
      point,
      companies: list.length,
      withoutAddress: list.filter((c) => classify(c.address, 'string') !== 'present').length,
      sample: list.slice(0, 4).map((c) => c.name),
    })),
  };
}

// Latest verified_at per company and field, from active evidence.
function latestChecks(ds) {
  const byCompany = new Map();
  for (const e of activeEvidence(ds)) {
    if (e.verified_at == null) continue;
    const at = Date.parse(e.verified_at);
    const fields = byCompany.get(e.company_id) ?? new Map();
    if (!(fields.get(e.field) >= at)) fields.set(e.field, at);
    byCompany.set(e.company_id, fields);
  }
  return byCompany;
}

function staleness(lastCheckMs, thresholdDays, asOf) {
  if (!Number.isFinite(lastCheckMs)) return { stale: true, last_checked: null, age_days: null, reason: 'no dated check on record' };
  const age = Math.floor((asOf - lastCheckMs) / DAY_MS);
  const stale = age > thresholdDays;
  return { stale, last_checked: new Date(lastCheckMs).toISOString(), age_days: age, reason: stale ? `last checked ${age} days ago` : `checked ${age} days ago` };
}

// ---------- one company ----------

function auditCompany(c, ctx) {
  const { asOf, params, checks, roundsFor, conflictsFor, unappliedFor, weakFor, dupesFor, evidenceFields } = ctx;
  const id = c.id ?? c.name;
  const lastCheck = (fields) => Math.max(-Infinity, ...fields.map((f) => checks.get(id)?.get(f) ?? -Infinity));
  const lifecycle = lifecycleOf(c);
  const verified = c.verified === true;

  // -- attribute states
  const website = classify(c.website, 'string');
  const websiteIssues = website === 'present' ? websiteProblems(c.website) : [];
  const hasPin = typeof c.lat === 'number' && typeof c.lng === 'number';
  const year = classify(c.foundedYear, 'number');
  const yearOk = year !== 'present' || (Number.isInteger(c.foundedYear) && c.foundedYear >= 1800 && c.foundedYear <= asOf.getUTCFullYear());
  const hasFunding = c.funding_total != null || c.last_funding_round != null || c.last_funding_date != null || roundsFor.has(id);
  let coordinates = 'null';
  if (hasPin) coordinates = inAustralia(c.lat, c.lng) ? 'present' : 'invalid';
  else if (c.lat === undefined || c.lng === undefined) coordinates = 'missing';
  const states = {
    website: websiteIssues.length ? 'invalid' : website,
    sector: classify(c.sector, 'string'),
    city: classify(c.city, 'string'),
    state: classify(c.state, 'string'),
    coordinates,
    stage: classify(c.stage, 'string'),
    hiring: typeof c.hiring === 'boolean' ? 'present' : (c.hiring === undefined ? 'missing' : 'invalid'),
    description: classify(c.blurb, 'string'),
    founders: classify(c.founders, 'array'),
    founded_year: yearOk ? year : 'invalid',
    funding: hasFunding ? 'present' : 'missing',
    investors: classify(c.investors, 'array'),
    source: classify(c.source_ids ?? [], 'array'),
    last_verified: classify(c.last_verified_at, 'string'),
  };
  const backed = Object.fromEntries(ATTRIBUTES.map((a) => [a.key, a.evidence.some((f) => evidenceFields.get(id)?.has(f))]));

  // -- findings, as register entries and as queue tasks
  const findings = []; // { category, detail }
  const gaps = [];     // { code, detail }
  const note = (category, detail = null) => findings.push({ category, detail });
  const gap = (code, detail = null, weight = TASKS[code].weight) => gaps.push({ code, detail, weight });

  const unknownFields = ['sector', 'sectorFull', 'city', 'stage', 'website', 'blurb', 'address'].filter((k) => classify(c[k], 'string') === 'unknown');
  if (unknownFields.length) note('unknown_values', unknownFields.join(', '));
  const contentAttrs = ATTRIBUTES.filter((a) => a.group !== 'provenance');
  const emptyCore = ATTRIBUTES.filter((a) => a.group === 'core' && ['missing', 'empty'].includes(states[a.key])).map((a) => a.key);
  if (emptyCore.length) note('missing_values', emptyCore.join(', '));
  const nullAttrs = contentAttrs.filter((a) => states[a.key] === 'null').map((a) => a.key);
  if (nullAttrs.length) note('null_values', nullAttrs.join(', '));

  if (websiteIssues.length) { note('invalid_urls', websiteIssues.join('; ')); gap('invalid_website', websiteIssues.join('; ')); }
  if (website !== 'present' && !websiteIssues.length) gap('missing_website');

  if (verified && !hasPin) { note('missing_coordinates', 'verified location without coordinates'); gap('missing_coordinates'); }
  if (!verified) { gap('unconfirmed_location'); if (!hasPin) note('unpinned_unconfirmed', 'no coordinates (expected while unconfirmed)'); }
  if (coordinates === 'invalid') { note('outside_australia', `${c.lat}, ${c.lng}`); gap('coordinates_outside_australia', `${c.lat}, ${c.lng}`); }
  if (verified && states.city !== 'present') gap('unknown_city');
  if (verified && states.state !== 'present') gap('missing_state');
  if (verified && hasPin && classify(c.address, 'string') !== 'present') gap('approximate_pin');

  if (states.sector !== 'present') gap('unknown_sector');
  else if (isGenericSector(c.sector)) { note('generic_sectors', c.sector); gap('generic_sector', c.sector); }
  if (states.description !== 'present') gap('missing_description');
  if (states.stage !== 'present') gap('unknown_stage');

  // -- potentially stale (undated counts as stale; risk says how much it matters)
  const hiringCheck = staleness(lastCheck(['hiring_status']), params.hiringStaleDays, asOf);
  const hiringRisk = c.hiring === true ? 'high' : 'low';
  if (hiringCheck.stale) {
    note('stale_hiring', `${hiringRisk} risk; ${hiringCheck.reason}`);
    if (hiringRisk === 'high') gap('stale_hiring', hiringCheck.reason);
  }
  // An undated stage is unverified, not necessarily out of date: only a known-old
  // check, or an early-stage label on a company founded six or more years ago,
  // is real evidence it has moved on. Late-stage labels change least and are not queued.
  if (!lifecycle && states.stage === 'present') {
    const stageCheck = staleness(lastCheck(['stage', 'last_funding_round']), params.stageStaleDays, asOf);
    const volatility = STAGE_VOLATILITY[c.stage] ?? 'medium';
    const ageSignal = EARLY_STAGES.has(c.stage) && Number.isInteger(c.foundedYear) && asOf.getUTCFullYear() - c.foundedYear >= 6
      ? `founded ${c.foundedYear} but still labelled ${c.stage}` : null;
    if (stageCheck.stale || ageSignal) {
      note('stale_stage', [`${volatility} risk`, stageCheck.reason, ageSignal].filter(Boolean).join('; '));
      if (volatility !== 'low') {
        const knownOld = stageCheck.last_checked != null && stageCheck.stale;
        if (knownOld || ageSignal) gap('stale_stage', [knownOld ? stageCheck.reason : null, ageSignal].filter(Boolean).join('; '));
        else gap('unverified_stage', null, volatility === 'high' ? TASKS.unverified_stage.weight : TASKS.unverified_stage.weight / 2);
      }
    }
  }

  // -- lifecycle
  if (lifecycle === 'defunct') note('defunct', c.stage);
  if (lifecycle === 'acquired' || lifecycle === 'subsidiary') note('acquired', c.stage);
  if (lifecycle) gap('lifecycle_check', c.stage);
  if (lifecycle === 'defunct' && c.hiring === true) { note('hiring_on_defunct'); gap('hiring_on_defunct'); }

  // -- depth
  if (states.funding !== 'present') gap('missing_funding');
  if (states.founders !== 'present') gap('missing_founders');
  if (states.investors !== 'present') gap('missing_investors');
  if (states.founded_year !== 'present') gap('missing_founded_year');

  // -- provenance
  if (states.source !== 'present') gap('no_source');
  for (const k of conflictsFor(id)) {
    const sides = k.values.map((v) => JSON.stringify(v.value)).join(' vs ');
    note('source_conflicts', `${k.field}: ${sides}`);
    gap('source_conflict', `${k.field}: ${sides}`);
  }
  for (const u of unappliedFor(id)) gap('unapplied_evidence', `${u.field}: ${JSON.stringify(u.value)}`);
  for (const w of weakFor(id)) gap('weak_evidence', `${w.field}: ${JSON.stringify(w.value)}`);
  for (const d of dupesFor(id)) { note('possible_duplicates', `${d.reason}: ${d.names.join(' / ')}`); gap('possible_duplicate', `${d.reason}: ${d.names.join(' / ')}`); }

  const tasks = gaps.map((g) => ({ code: g.code, tier: TASKS[g.code].tier, weight: g.weight, issue: TASKS[g.code].issue, action: TASKS[g.code].action, detail: g.detail }))
    .sort((a, b) => a.tier - b.tier || b.weight - a.weight);
  const score = tasks.reduce((n, t) => n + t.weight, 0);
  const prominence = (STAGE_PROMINENCE[c.stage] ?? 0) + (c.hiring === true ? 1 : 0);

  return {
    id, name: c.name, website: c.website ?? null, city: c.city ?? null, stage: c.stage ?? null,
    hiring: c.hiring === true, verified, states, evidence_backed: backed, findings, tasks, score, prominence,
    genericSector: states.sector === 'present' && isGenericSector(c.sector),
    priority: tasks.length ? `P${tasks[0].tier}` : null,
  };
}

// ---------- the audit ----------

export function auditDataset(ds, options = {}) {
  const params = { ...AUDIT_DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([k]) => k in AUDIT_DEFAULTS)) };
  const asOf = options.asOf ? new Date(options.asOf) : new Date();
  if (Number.isNaN(asOf.getTime())) throw new Error(`invalid asOf date: ${options.asOf}`);

  const conflicts = detectConflicts(ds);
  const unapplied = findUnappliedEvidence(ds);
  const weak = findWeakEvidence(ds);
  const duplicates = findPossibleDuplicates(ds.companies);

  const by = (rows) => (id) => rows.filter((r) => r.company_id === id);
  const byCompanyNames = (groups) => (id) => groups.filter((g) => g.company_ids.includes(id));
  const evidenceFields = new Map();
  for (const e of activeEvidence(ds)) evidenceFields.set(e.company_id, (evidenceFields.get(e.company_id) ?? new Set()).add(e.field));

  const ctx = {
    asOf, params, checks: latestChecks(ds), evidenceFields,
    roundsFor: new Set((ds.funding_rounds ?? []).map((r) => r.company_id)),
    conflictsFor: by(conflicts), unappliedFor: by(unapplied), weakFor: by(weak), dupesFor: byCompanyNames(duplicates),
  };
  const companies = ds.companies.map((c) => auditCompany(c, ctx));
  const total = companies.length;

  const attributes = ATTRIBUTES.map((a) => {
    const counts = { present: 0, unknown: 0, empty: 0, missing: 0, null: 0, invalid: 0 };
    for (const c of companies) counts[c.states[a.key]] += 1;
    const evidenceBacked = companies.filter((c) => c.evidence_backed[a.key]).length;
    return { ...a, total, ...counts, evidenceBacked };
  });
  const attr = Object.fromEntries(attributes.map((a) => [a.key, a]));
  const count = (pred) => companies.filter(pred).length;
  const located = count((c) => c.states.city === 'present' && c.states.state === 'present' && c.states.coordinates === 'present');
  const specificSector = count((c) => c.states.sector === 'present' && !c.genericSector);
  const headline = {
    total, website: attr.website.present, sector: attr.sector.present, specificSector, location: located, stage: attr.stage.present,
    founder: attr.founders.present, funding: attr.funding.present, hiring: attr.hiring.present, description: attr.description.present,
    investors: attr.investors.present, founded_year: attr.founded_year.present, source: attr.source.present, last_verified: attr.last_verified.present,
  };

  const issues = {};
  for (const c of companies) {
    for (const f of c.findings) (issues[f.category] ??= []).push({ id: c.id, name: c.name, detail: f.detail });
  }

  const queue = companies.filter((c) => c.tasks.length)
    .sort((a, b) => a.tasks[0].tier - b.tasks[0].tier || b.score - a.score || b.prominence - a.prominence || a.name.localeCompare(b.name))
    .map((c, i) => ({
      rank: i + 1, priority: c.priority, score: c.score, company_id: c.id, name: c.name, website: c.website,
      city: c.city, stage: c.stage, hiring: c.hiring, verified: c.verified, tasks: c.tasks,
    }));
  const tierCounts = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const q of queue) tierCounts[q.priority] += 1;
  const taskCounts = {};
  for (const q of queue) for (const t of q.tasks) taskCounts[t.code] = (taskCounts[t.code] || 0) + 1;

  return {
    asOf: asOf.toISOString().slice(0, 10),
    params,
    total,
    cohorts: { withSources: attr.source.present, withoutSources: total - attr.source.present },
    headline,
    attributes,
    issues,
    sectorVariants: labelVariants(ds.companies.map((c) => c.sector)),
    pins: pinStacks(ds.companies),
    provenance: {
      sources: ds.sources.length,
      evidence: evidenceCoverage(ds),
      conflicts, unapplied, weak,
    },
    duplicates,
    companies,
    queue,
    tierCounts,
    taskCounts,
  };
}
