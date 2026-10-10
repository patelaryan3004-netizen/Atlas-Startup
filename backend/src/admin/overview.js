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
import { reviewLocations, locationFilterCodes, LOCATION_FLAGS } from '../models/locationAudit.js';
import { reviewInvestors } from '../models/investorReview.js';
import { INVESTOR_STATUSES, INVESTOR_TYPES, INVESTOR_STAGES, INCLUSION_BASES, LEAD_OR_FOLLOW, typeLabel } from '../models/investor.js';
import { LEAD_STATUSES } from '../models/investorGraph.js';
import { detectConflicts } from '../models/evidence.js';
import { failedImports } from '../models/importRuns.js';
import { queueSummary, latestTasks } from '../models/enrichmentQueue.js';
import { suggestionsOf, LOCATION_FIELDS } from './decisions.js';
import { locationOf } from '../discovery/report.js';
import { buildSourceConfig } from '../discovery/config.js';
import { schedulerStatus } from '../scheduler/status.js';

const DAY = 86400000;
export const OPEN = ['candidate', 'needs_review', 'matched', 'approved'];
// The core facts a company is "missing data" without. A location is missing when the company is not located at least
// to its city (a pin for a point, a group for a city), which the audit works out as `located`.
export const MISSING_KEYS = { website: ['website'], sector: ['sector'], location: ['located'], stage: ['stage'], description: ['description'] };
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
  const where = reviewLocations(ds, { asOf: iso(nowMs) });
  // A company is a pin on the map only when its place is a point; one known to its city or state is a group there.
  const onMap = where.precision.EXACT + where.precision.SUBURB;
  const cityLevel = where.precision.CITY + where.precision.STATE;
  const failedSources = failedImports(ds.import_runs ?? []);
  const failedTasks = (ds.enrichment_queue ?? []).filter((t) => t.status === 'failed');
  const fresh = ds.companies.filter((c) => [c.updated_at, c.last_verified_at].some((t) => t && Date.parse(t) >= weekAgo)).length;
  const missing = missingOf(audit).length;
  const lookAlikes = open.filter((c) => c.resolution !== 'NEW_COMPANY').length;

  const h = audit.headline;
  const attr = Object.fromEntries(audit.attributes.map((a) => [a.key, a]));
  const bar = (key, label, present, backedKey = key, note = null) => ({ key, label, present, total: h.total, pct: pct(present, h.total), backed: attr[backedKey]?.evidenceBacked ?? 0, note });
  const unknownLocation = where.precision.UNKNOWN;
  const p = where.precision;

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
      published: { on_map: onMap, city_level: cityLevel, unconfirmed: unknownLocation },
      new_candidates: { open_in_total: open.length, all_candidates: ds.candidates.length },
      potential_duplicates: { candidates: lookAlikes, company_pairs: audit.duplicates.length },
      failed_imports: { sources: failedSources.length, enrichment_tasks: failedTasks.length },
      missing_data: { core_attributes: 'website, sector, location, stage, description' },
    },
    quality: [
      bar('website', 'Website coverage', h.website),
      bar('sector', 'Sector coverage', h.sector, 'sector', `${h.specificSector} are a specific industry`),
      bar('location', 'Location coverage', h.location, 'coordinates', `${p.EXACT} exact, ${p.SUBURB} suburb, ${cityLevel} known only to a city or state, ${unknownLocation} unknown`),
      bar('stage', 'Stage coverage', h.stage),
      bar('founders', 'Founder coverage', h.founder, 'founders'),
      bar('funding', 'Funding coverage', h.funding),
      bar('investors', 'Investor coverage', h.investors),
    ],
    locations: locationsSummary(where),
    investors: investorsSummary(reviewInvestors(ds, { asOf: iso(nowMs) })),
    provenance: { companies_with_sources: audit.cohorts.withSources, companies_without_sources: audit.cohorts.withoutSources, evidence_rows: ds.evidence.length, sources: ds.sources.length },
    attention: { open_conflicts: detectConflicts(ds).length, suggestions: suggestionsOf(ds).length, priority: audit.tierCounts },
    vocab: { sectors: vocabulary(ds.companies.map((c) => c.sector)).slice(0, 40), stages: vocabulary(ds.companies.map((c) => c.stage)) },
  };
}

// ---------- locations ----------

// How well the directory knows where its companies are: a count per precision, the six flags, and how many companies
// are in the review queue (and how many of those have a problem that is wrong, not just unfinished).
function locationsSummary(review) {
  return {
    total: review.total, precision: review.precision,
    flags: Object.entries(LOCATION_FLAGS).map(([key, spec]) => ({ key, label: spec.label, note: spec.note, count: review.flags[key] })),
    queue: review.rows.length, attention: review.rows.filter((r) => r.worst === 'high').length,
  };
}

// The location review queue: the companies a person should look at, worst first, each with what is wrong and what to do.
// `filter` is a flag (duplicate_coordinates ...) or one problem (city_level_only ...); `limit` caps the rows, not the counts.
export function locationsPanel(ds, nowMs, { filter = '', limit = 100 } = {}) {
  const review = reviewLocations(ds, { asOf: iso(nowMs) });
  const codes = filter ? locationFilterCodes(filter) : null;
  const rows = codes ? review.rows.filter((r) => r.issues.some((i) => codes.includes(i.code))) : review.rows;
  return {
    ...locationsSummary(review), filter: filter || null,
    issues: Object.entries(review.issues).map(([code, spec]) => ({ code, ...spec })).filter((i) => i.count > 0),
    total: rows.length, results: rows.slice(0, Math.min(Math.max(limit, 1), 500)),
  };
}

// ---------- investors ----------

// What a person can do to an investor in each status (the buttons the page shows; the service checks the rules again).
export const INVESTOR_ACTIONS_FOR = {
  candidate: ['edit', 'approve', 'flag', 'reject', 'merge'],
  needs_review: ['edit', 'approve', 'reject', 'merge'],
  verified: ['edit', 'publish', 'flag', 'inactive', 'reject', 'merge'],
  published: ['edit', 'unpublish', 'inactive', 'merge'],
  inactive: ['edit', 'unpublish', 'merge'],
  rejected: ['reopen'],
};

const INVESTOR_FILTERS = {
  open: (o) => ['candidate', 'needs_review'].includes(o.verification_status),
  all: () => true,
};
const investorMatches = (status, o) => (INVESTOR_FILTERS[status] ?? ((x) => x.verification_status === status))(o);

// The investors page's summary, for the overview: how many in each status, and how many of each thing to look at.
export function investorsSummary(review) {
  return {
    total: review.total, by_status: review.byStatus, public: review.public, people: review.people, funds: review.funds, investments: review.investments,
    issues: Object.entries(review.issues).map(([code, spec]) => ({ code, label: spec.label, note: spec.note, severity: spec.severity, count: review.counts[code] })),
    relationships: { links: review.relationships.links, sourced: review.relationships.sourced, unsourced: review.relationships.unsourced, unverified_investments: review.relationships.unverified_investments },
    duplicates: { firms: review.duplicates.firms.length, people: review.duplicates.people.length },
    team: { records: review.team.records, stale: review.team.stale }, conflicts: review.conflicts.count,
    attention: review.rows.filter((r) => r.worst === 'high').length,
  };
}

const locationLabel = (o) => [o.headquarters_city, o.state ?? o.country].filter(Boolean).join(', ') || null;

// The words the investor forms offer, so the page never keeps a second copy of them.
export const INVESTOR_VOCAB = {
  types: Object.entries(INVESTOR_TYPES), stages: INVESTOR_STAGES, bases: INCLUSION_BASES, lead_or_follow: LEAD_OR_FOLLOW, lead_status: LEAD_STATUSES,
};

// A claim two pages disagree about, with the page behind each side (what it says and where).
function conflictView(ds, c) {
  const sources = new Map((ds.sources ?? []).map((s) => [s.id, s]));
  const records = new Map((ds.verification_records ?? []).map((r) => [r.id, r]));
  const page = (s) => (s ? { id: s.id, kind: s.kind, url: s.url, title: s.title, publisher: s.publisher, retrieved_at: s.retrieved_at } : null);
  return {
    ...c,
    values: c.values.map((v) => ({
      ...v,
      evidence: v.record_ids.map((id) => records.get(id)).filter(Boolean).map((r) => ({ id: r.id, note: r.note, confidence: r.confidence, verified_at: r.verified_at, source: page(sources.get(r.source_id)) })),
    })),
  };
}

export function investorRow(o, review, ds) {
  const issues = review.rows.find((r) => r.id === o.id)?.issues ?? [];
  const mine = (ds.investments ?? []).filter((i) => i.investor_organisation_id === o.id);
  const gap = review.relationships.by_investor.find((g) => g.id === o.id);
  return {
    id: o.id, slug: o.slug, name: o.name, aliases: o.aliases, status: o.verification_status, active_status: o.active_status,
    type: o.investor_type, type_label: typeLabel(o.investor_type), website: o.website, location: locationLabel(o),
    stages: o.stages.length, sectors: o.sectors.length, last_verified_at: o.last_verified_at,
    portfolio: { verified: mine.filter((i) => i.verification_status === 'verified').length, unverified: mine.filter((i) => i.verification_status === 'unverified').length, unsourced: gap?.count ?? 0 },
    issues: issues.map(({ code, label, severity, detail }) => ({ code, label, severity, detail })), worst: issues[0]?.severity ?? null,
    actions: INVESTOR_ACTIONS_FOR[o.verification_status] ?? [],
  };
}

// The investor records a person is to look at: filtered by status ('open' is candidates and records needing review), by one
// kind of problem, or by a word in the name, an alias or the website.
export function listInvestors(ds, nowMs, { status = 'open', issue = '', q = '', limit = 200 } = {}) {
  const review = reviewInvestors(ds, { asOf: iso(nowMs) });
  const needle = String(q).toLowerCase().trim();
  const rank = { high: 0, medium: 1, low: 2, null: 3 };
  const rows = ds.investors
    .filter((o) => investorMatches(status, o) && (!needle || [o.name, o.website, ...o.aliases].some((s) => String(s ?? '').toLowerCase().includes(needle))))
    .map((o) => investorRow(o, review, ds))
    .filter((r) => !issue || r.issues.some((i) => i.code === issue))
    .sort((a, b) => rank[a.worst] - rank[b.worst] || a.name.localeCompare(b.name));
  const counts = Object.fromEntries([...Object.keys(INVESTOR_FILTERS), ...INVESTOR_STATUSES].map((k) => [k, ds.investors.filter((o) => investorMatches(k, o)).length]));
  const byId = new Map(ds.investors.map((o) => [o.id, o]));
  const group = (g) => ({ ...g, members: g.ids.map((id) => ({ id, name: byId.get(id)?.name ?? id, status: byId.get(id)?.verification_status ?? null, website: byId.get(id)?.website ?? null })) });
  return {
    total: rows.length, counts, summary: investorsSummary(review), vocab: INVESTOR_VOCAB, results: rows.slice(0, Math.min(Math.max(limit, 1), 500)),
    // What a person is to settle across the whole list, whatever the filter above: sources that disagree, firms and people
    // that look like one, and team records nobody has looked at for a year.
    conflicts: review.conflicts.items.map((c) => conflictView(ds, c)),
    duplicates: { firms: review.duplicates.firms.map(group), people: review.duplicates.people },
    stale_team: review.team.stale_roles,
  };
}

// One investor in full: every claim with the page behind it (the ones turned down too), the investments and who says so, the
// companies that name it and have no page for it yet, the team, the funds, and what is in dispute.
export function investorDetail(ds, id, nowMs) {
  const o = ds.investors.find((x) => x.id === id);
  if (!o) return null;
  const review = reviewInvestors(ds, { asOf: iso(nowMs) });
  const sources = new Map((ds.sources ?? []).map((s) => [s.id, s]));
  const companies = new Map(ds.companies.map((c) => [c.id, c]));
  const people = new Map((ds.investor_people ?? []).map((p) => [p.id, p]));
  const sourceView = (s) => (s ? { id: s.id, kind: s.kind, url: s.url, title: s.title, publisher: s.publisher, retrieved_at: s.retrieved_at } : null);
  const gap = review.relationships.by_investor.find((g) => g.id === id);
  return {
    ...investorRow(o, review, ds), ...Object.fromEntries(Object.entries(o).filter(([k]) => !['id', 'name', 'slug', 'aliases'].includes(k))),
    check_problems: review.rows.find((r) => r.id === id)?.checkProblems ?? [],
    records: (ds.verification_records ?? []).filter((r) => r.subject_type === 'investor_organisation' && r.subject_id === id)
      .map((r) => ({ id: r.id, field: r.field, value: r.value, status: r.status, confidence: r.confidence, verified_at: r.verified_at, note: r.note, source: sourceView(sources.get(r.source_id)) })),
    investments: (ds.investments ?? []).filter((i) => i.investor_organisation_id === id).map((i) => ({
      id: i.id, company_id: i.company_id, company: companies.get(i.company_id)?.name ?? i.company_id, round: i.round, investment_date: i.investment_date, amount: i.amount, currency: i.currency,
      lead_status: i.lead_status, status: i.verification_status, verified_at: i.verified_at, note: i.note, source: sourceView(sources.get(i.source_id)),
    })).sort((a, b) => a.company.localeCompare(b.company)),
    unsourced_companies: gap?.companies ?? [],
    team: (ds.investor_people_organisations ?? []).filter((m) => m.organisation_id === id).map((m) => ({
      id: m.id, person_id: m.person_id, person: people.get(m.person_id)?.name ?? m.person_id, person_status: people.get(m.person_id)?.verification_status ?? null,
      role: m.role, is_current: m.is_current, status: m.verification_status, verified_at: m.verified_at, source: sourceView(sources.get(m.source_id)),
    })),
    funds: (ds.funds ?? []).filter((f) => f.organisation_id === id).map((f) => ({ id: f.id, name: f.name, vintage_year: f.vintage_year, status: f.verification_status })),
    conflicts: review.conflicts.items.filter((c) => c.subject_id === id).map((c) => conflictView(ds, c)),
    duplicates: review.duplicates.firms.filter((g) => g.ids.includes(id)),
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

// Is the company a pin on the public map: its place is a point (an exact office or a suburb)? One known only to its city or
// state is a group there, not a pin; one with no confirmed place is not drawn at all.
const isPin = (c) => (c.location_precision == null ? c.verified === true && Number.isFinite(c.lat) && Number.isFinite(c.lng) : ['EXACT', 'SUBURB'].includes(c.location_precision));

export function searchCompanies(ds, q, limit = 8) {
  const needle = String(q ?? '').toLowerCase().trim();
  if (needle.length < 2) return [];
  return ds.companies.filter((c) => c.name.toLowerCase().includes(needle) || c.slug?.includes(needle) || String(c.website ?? '').toLowerCase().includes(needle))
    .slice(0, limit).map((c) => ({ id: c.id, name: c.name, city: c.city, website: c.website || null, on_map: isPin(c) }));
}

// ---------- what the tiles lead to ----------

// The companies behind MISSING DATA, with what each lacks and whether its website is already waiting to be read.
export function missingData(ds, nowMs) {
  const audit = auditDataset(ds, { asOf: iso(nowMs).slice(0, 10) });
  const task = new Map(latestTasks(ds.enrichment_queue ?? []).filter((t) => t.kind === 'company').map((t) => [t.target_id, t]));
  const record = new Map(ds.companies.map((c) => [c.id, c]));
  const rows = missingOf(audit).map(({ company: c, missing }) => ({
    id: c.id, name: c.name, website: c.website, city: c.city, on_map: isPin(record.get(c.id) ?? c), precision: record.get(c.id)?.location_precision ?? null, missing,
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
