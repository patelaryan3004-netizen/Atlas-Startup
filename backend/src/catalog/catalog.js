// The public read model: every company the site lists, loaded once and indexed, instead of read and parsed
// from disk on every request.
//
// What it replaces: each request used to read startups.json, JSON.parse it, scan every record and serialise
// every match. That is O(companies) work per request, and it made memory grow with traffic (every request
// allocated the whole dataset again). Here the file is read when it changes, and a request costs the work of
// its own answer.
//
//   records   the public form of each company (toPublic), file order. Immutable: nothing mutates a record.
//   idx       facet indexes: value -> the (ascending) record numbers that have it
//   orders    the four list sorts, computed once, so a page is a slice and not a sort
//   markers   the compact tuple a map pin needs, for companies whose location is a point (an exact office or a suburb)
//   areaOf    for companies known only to their city or state: the area they belong to, drawn as a group, never a pin
//   search    lowercase text per record (name and founders): the legacy substring search runs over it
//   names     lowercase company names in order, for prefix lookup (search suggestions)
//   provenance  for each company, the public pages behind its facts and the page that backs "hiring" (provenance.js), read from the
//             pipeline's own records beside the file (sources.json, evidence.json, jobs.json) when they are there
//
// Filters mean exactly what they always meant (the legacy tests and a randomised equivalence test pin it).
// Data changes on a deploy, not at run time, so the file is checked for change at most once a second
// (size and modified time) and rebuilt, without blocking requests, when it differs.
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { buildProvenance } from './provenance.js';
import { toPublic, deriveState, FACT_FIELDS, REMOTE_POLICIES, TEAM_BUCKETS, teamBucketOf } from '../models/company.js';
import { valuesEqual } from '../models/evidence.js';
import { COHORTS, COHORT_IDS, cohortTerms, programOf } from '../models/cohorts.js';
import { describeLocation, PRECISIONS } from '../models/location.js';
import { cityCentre, stateCentre } from '../geo/places.js';
import { metroOf } from '../geo/metro.js';

export const SORTS = ['file', 'name', 'hiring', 'location', 'industry', 'stage', 'verified', 'team', 'remote'];

// The order a company moves through its stages, earliest first: what a "by stage" list is in. A stage this list does not know (a new
// one) sorts after the ones it does, and "Unknown" last, so nothing is placed by a guess.
export const STAGE_ORDER = [
  'Pre-seed', 'Seed', 'Early', 'Series A', 'Series B', 'Series B+', 'Series C', 'Series C+', 'Series D', 'Series D+', 'Series E', 'Growth', 'Unicorn',
  'Acquired', 'Subsidiary', 'Other Equity',
];
export const stageRank = (stage) => {
  if (stage === 'Unknown' || stage == null) return STAGE_ORDER.length + 2;
  const at = STAGE_ORDER.indexOf(stage);
  return at === -1 ? STAGE_ORDER.length + 1 : at;
};
export const FACETS = ['sector', 'city', 'stage', 'investor'];
// `hiring` is true only for a company whose open roles were read from a page; `rolesUnverified` is true for one flagged as hiring
// that no page backs (toPublic).
// team_size, remote_policy, tech_stack, last_funding_date, last_role_seen_at and cohorts are the optional facts (company.js): present on a card
// only where a public page backs them. `programs` is the cohorts as a visitor reads them, each with the page that says so (cohorts.js programOf).
export const CARD_FIELDS = ['name', 'slug', 'sector', 'sectorFull', 'city', 'stage', 'hiring', 'hiringState', 'hiring_checked_at', 'rolesUnverified', 'hiring_source_url', 'website_status', 'verified', 'website', 'blurb', 'taskGate', 'last_verified_at', 'events',
  'team_size', 'remote_policy', 'tech_stack', 'last_funding_date', 'last_role_seen_at', 'cohorts', 'programs'];
// A pin's tuple. The first eight are what it always was; a reader that knows only those still works. precision is how
// well the place is known (EXACT or SUBURB: only those are pins), place the line that says where, and checked whether
// the address was checked against a source (1) or is only on file (0).
// logo is the company's own picture (its `logo` field, an https address) or null: the map draws that, or the first letter of its name, and
// asks no one else for a logo.
export const MARKER_FIELDS = ['slug', 'name', 'lat', 'lng', 'sector', 'city', 'hiring', 'domain', 'precision', 'place', 'checked', 'logo'];
// How many companies an area names, so a click can list them without another request. The rest are one filter away.
export const AREA_SAMPLE = 12;

const EMPTY = new Uint32Array(0);
const collator = new Intl.Collator(); // the same order localeCompare gives, which is what the list always sorted by

const domainOf = (website) => { try { return new URL(website).hostname.replace(/^www\./, ''); } catch { return ''; } };
// A company's own logo, as the map may draw it: an https address, or nothing (a page served over https must not load an http picture).
const ownLogo = (logo) => (typeof logo === 'string' && /^https:\/\/\S+$/i.test(logo.trim()) ? logo.trim() : null);
const uniqueSorted = (values) => [...new Set(values)].sort(); // default order, as the filter options always were

// How well a company's place is known. A record that predates the location fields means what a record always meant:
// a confirmed location with coordinates is a pin, one without is known to its city, and one not confirmed is unknown.
export const precisionOf = (r) => r.location_precision ?? (r.verified ? (Number.isFinite(r.lat) && Number.isFinite(r.lng) ? 'EXACT' : 'CITY') : 'UNKNOWN');
const isPoint = (precision) => precision === 'EXACT' || precision === 'SUBURB';
// An area-level company whose city or state this project has no centre for: counted, never drawn.
const UNPLACED = '?';

function postings(list, keyOf) {
  const map = new Map();
  list.forEach((record, i) => {
    for (const key of keyOf(record)) {
      const rows = map.get(key);
      if (rows) rows.push(i); else map.set(key, [i]);
    }
  });
  return new Map([...map].map(([k, rows]) => [k, Uint32Array.from(rows)]));
}

// Sorted record numbers. A plain array is sorted and then packed: sorting a typed array with a comparison
// function is several times slower in V8, and this runs on every start.
const sortedNumbers = (count, compare) => Uint32Array.from(Array.from({ length: count }, (_, i) => i).sort(compare));

// What a company says about hiring, as one of four states a visitor can be told:
//   hiring       open roles were CONFIRMED by a page (the company's job board or structured postings on its own page) within the window
//   checked      roles were read on an earlier date, or not by a source we confirm: said with the date, never as "hiring now"
//   none         a job board was read and listed no open roles
//   unverified   nothing has been read: no website, a careers page with no readable roles, or a claim no page backs
// With no window (hiringWindowDays null) a company is `hiring` when a page backs it, however long ago, as it always was.
export function hiringStateOf(record, found, nowMs, windowMs) {
  if (record.hiring === true) {
    const confirmed = Date.parse(found?.hiring?.confirmed_at);
    if (windowMs == null || (Number.isFinite(confirmed) && nowMs - confirmed <= windowMs)) return { state: 'hiring', checkedAt: null };
    return { state: 'checked', checkedAt: found?.hiring?.checked_at ?? record.hiring_verified_at ?? null };
  }
  if (record.hiring_status === 'not_hiring' && found?.no_roles) return { state: 'none', checkedAt: found.no_roles.checked_at };
  return { state: 'unverified', checkedAt: null };
}

// The optional facts of a company (company.js, FACT_FIELDS) as they may be served: a value only where an active evidence row from a public
// page says the same thing, with that page's address and the date it was checked. A value no page backs is not public, and neither is one
// a lead (low confidence) alone supports. A list (the tech stack, the cohorts) keeps the members a page names. Returns the values to serve and,
// for those served, where each comes from: { values: { field: value | null }, sources: { field: { source_url, verified_at } } }.
const LIST_FACTS = new Set(['tech_stack', 'cohorts']);
export function backedFacts(record, found) {
  const values = {};
  const sources = {};
  for (const field of FACT_FIELDS) {
    const rows = found?.facts?.[field] ?? [];
    const value = record[field];
    let shown = null;
    let behind = null;
    if (LIST_FACTS.has(field)) {
      const members = Array.isArray(value) ? value.filter((m) => rows.some((row) => valuesEqual(field, m, row.value))) : [];
      if (members.length) { shown = members; behind = rows.find((row) => members.some((m) => valuesEqual(field, m, row.value))); }
    } else if (value != null) {
      behind = rows.find((row) => valuesEqual(field, value, row.value)) ?? null;
      if (behind) shown = value;
    }
    values[field] = shown;
    if (shown != null && behind) sources[field] = { source_url: behind.url, verified_at: behind.verified_at };
  }
  return { values, sources };
}

// The cohorts a company took part in, as a visitor reads them: each with the page that says so (the newest evidence row that names it) and when
// that page was read.
function programsOf(ids, found) {
  const rows = found?.facts?.cohorts ?? [];
  return ids.map((id) => {
    const row = rows.find((r) => r.value === id);
    return programOf(id, row ? { url: row.url, verified_at: row.verified_at } : null);
  });
}

// A company is "new this week" when it raised, or had a role seen on a page of its own, in the last 14 days: { kind: 'funding' | 'role', at },
// the newer of the two, or null. A funding date counts only to the day (a month alone is not "lately"), and neither counts from the future.
export const FRESH_DAYS = 14;
export function freshOf(record, now = Date.now()) {
  const cutoff = now - FRESH_DAYS * 86400000;
  const latest = now + 86400000;
  const found = [];
  const funded = /^\d{4}-\d{2}-\d{2}$/.test(record.last_funding_date ?? '') ? Date.parse(record.last_funding_date) : NaN;
  if (funded >= cutoff && funded <= latest) found.push({ kind: 'funding', at: record.last_funding_date, t: funded });
  const seen = Date.parse(record.last_role_seen_at);
  if (seen >= cutoff && seen <= latest) found.push({ kind: 'role', at: record.last_role_seen_at, t: seen });
  found.sort((a, b) => b.t - a.t);
  return found[0] ? { kind: found[0].kind, at: found[0].at } : null;
}

export function buildSnapshot(raw, version, { lap = () => {}, provenance = new Map(), now = Date.now, hiringWindowDays = null } = {}) {
  const source = JSON.parse(raw);
  lap('parse');
  const records = source.map(toPublic);
  const windowMs = hiringWindowDays == null ? null : hiringWindowDays * 86400000;
  // The page that says a company is hiring is served with a company that is (hiring is public only where a page backs it): it is
  // where the Jobs board sends a visitor. A company whose roles were read but are not confirmed within the window is not `hiring`,
  // and says when it was checked.
  for (const r of records) {
    const found = provenance.get(r.id);
    const { state, checkedAt } = hiringStateOf(r, found, now(), windowMs);
    r.hiring = state === 'hiring';
    r.hiringState = state;
    r.hiring_checked_at = checkedAt;
    // The open roles read from the pages of a company that is hiring now, counting those read inside the window.
    r.open_roles = state === 'hiring' ? (found?.roles ?? []).filter((t) => windowMs == null || now() - Date.parse(t) <= windowMs).length : 0;
    const hiringPage = state === 'hiring' || state === 'checked' ? found?.hiring : null;
    if (hiringPage) r.hiring_source_url = hiringPage.url;
    const facts = backedFacts(r, found);
    for (const field of FACT_FIELDS) if (field in r) r[field] = facts.values[field];
    if (Object.keys(facts.sources).length) r.facts = facts.sources;
    if (r.cohorts?.length) r.programs = programsOf(r.cohorts, found);
  }
  lap('public form');
  const count = records.length;
  const all = Uint32Array.from({ length: count }, (_, i) => i);

  const orders = { file: all };
  // A key per record, so a sort compares two strings and not two objects' fields through a collator each time.
  const keys = {
    name: records.map((r) => r.name), city: records.map((r) => r.city), industry: records.map((r) => r.sectorFull || r.sector),
    stage: records.map((r) => stageRank(r.stage)),
    // When the company's facts were last checked against a page: a company never checked has no date and goes last.
    verified: source.map((c) => { const t = Date.parse(c.last_verified_at); return Number.isNaN(t) ? 0 : t; }),
    // The biggest team first; one whose size no page gives has none and goes last. Remote worldwide first, then remote within Australia, hybrid,
    // on-site, then the ones with no policy (the order of REMOTE_POLICIES).
    team: records.map((r) => r.team_size ?? 0),
    remote: records.map((r) => { const at = REMOTE_POLICIES.indexOf(r.remote_policy); return at === -1 ? REMOTE_POLICIES.length : at; }),
  };
  const byKey = (list) => (a, b) => collator.compare(list[a], list[b]) || a - b;
  const compares = {
    name: byKey(keys.name),
    hiring: (a, b) => (records[b].hiring === true) - (records[a].hiring === true) || collator.compare(keys.name[a], keys.name[b]) || a - b,
    location: (a, b) => collator.compare(keys.city[a], keys.city[b]) || collator.compare(keys.name[a], keys.name[b]) || a - b,
    industry: (a, b) => collator.compare(keys.industry[a], keys.industry[b]) || collator.compare(keys.name[a], keys.name[b]) || a - b,
    stage: (a, b) => keys.stage[a] - keys.stage[b] || collator.compare(keys.name[a], keys.name[b]) || a - b,
    verified: (a, b) => keys.verified[b] - keys.verified[a] || collator.compare(keys.name[a], keys.name[b]) || a - b,
    team: (a, b) => keys.team[b] - keys.team[a] || collator.compare(keys.name[a], keys.name[b]) || a - b,
    remote: (a, b) => keys.remote[a] - keys.remote[b] || collator.compare(keys.name[a], keys.name[b]) || a - b,
  };
  for (const [name, compare] of Object.entries(compares)) {
    // The company's own number breaks any remaining tie, so an order never depends on the sort's stability.
    orders[name] = sortedNumbers(count, compare);
  }
  lap('orders');

  const flag = (pred) => Uint8Array.from(records, (r) => (pred(r) ? 1 : 0));
  const lowerNames = records.map((r) => r.name.toLowerCase());
  const nameOrder = sortedNumbers(count, (a, b) => (lowerNames[a] < lowerNames[b] ? -1 : lowerNames[a] > lowerNames[b] ? 1 : a - b));
  const founders = new Map();
  records.forEach((r, i) => { for (const f of r.founders || []) { const rows = founders.get(f); if (rows) rows.push(i); else founders.set(f, [i]); } });

  // Where each company is on the map: a pin (a point), a group at its city or state (an area), or nowhere (unknown).
  const precisions = records.map(precisionOf);
  const areaInfo = new Map();
  const areaKey = records.map((r, i) => {
    const precision = precisions[i];
    if (!r.verified || (precision !== 'CITY' && precision !== 'STATE')) return null;
    const state = r.state ?? deriveState(r); // a record from before `state` was kept is placed by its city, as the migration does
    if (precision === 'CITY') {
      const centre = cityCentre(r.city, state);
      if (!centre) return UNPLACED;
      const key = `CITY|${centre.name}|${centre.state}`;
      if (!areaInfo.has(key)) areaInfo.set(key, { kind: 'CITY', key, label: centre.name, city: centre.name, state: centre.state, lat: centre.lat, lng: centre.lng });
      return key;
    }
    const centre = stateCentre(state);
    if (!centre) return UNPLACED;
    const key = `STATE|${state}`;
    if (!areaInfo.has(key)) areaInfo.set(key, { kind: 'STATE', key, label: centre.name, city: null, state, lat: centre.lat, lng: centre.lng });
    return key;
  });

  lap('names');
  const flags = { hiring: flag((r) => r.hiring), verified: flag((r) => r.verified), taskGate: flag((r) => r.taskGate?.enabled) };
  // A yes/no column is indexed by the answer ('yes' or 'no'), so "hiring now" starts from the companies that are, not from all of them.
  const answers = (column) => postings(column, (on) => [on ? 'yes' : 'no']);
  const buckets = records.map((r) => teamBucketOf(r.team_size)); // each company's team-size bucket, or null when no page gives its size
  const techCounts = new Map();
  for (const r of records) for (const t of r.tech_stack ?? []) techCounts.set(t, (techCounts.get(t) ?? 0) + 1);
  const cohortCounts = new Map();
  for (const r of records) for (const id of r.cohorts ?? []) cohortCounts.set(id, (cohortCounts.get(id) ?? 0) + 1);
  const metros = records.map(metroOf); // the big city each company is in by its postcode (null for most outside the ten)
  const snap = {
    version, count, loadedAt: Date.now(), records, orders, precisions, areaKey, areaInfo, provenance, flags, buckets, metros,
    idx: {
      // a company is found under its own city and under the big city its postcode puts it in (a suburb's company is in the city too)
      sector: postings(records, (r) => [r.sector]), city: postings(records, (r) => new Set([r.city, metroOf(r)].filter(Boolean))), stage: postings(records, (r) => [r.stage]),
      investor: postings(records, (r) => new Set(r.investors || [])),
      remote: postings(records, (r) => (r.remote_policy ? [r.remote_policy] : [])),
      tech: postings(records, (r) => new Set(r.tech_stack ?? [])),
      cohort: postings(records, (r) => new Set(r.cohorts ?? [])),
      team: postings(buckets, (b) => (b ? [b] : [])),
      precision: postings(precisions, (p) => [p]), state: postings(records, (r) => (r.state ? [r.state] : [])),
      hiring: answers(flags.hiring), verified: answers(flags.verified), taskGate: answers(flags.taskGate),
    },
    // What a search matches: the name, the founders and, for a company in a cohort a page backs, the words for that cohort (Startmate, Winter 2026, W26...).
    search: records.map((r) => [r.name, ...(r.founders || []), ...(r.cohorts ?? []).flatMap(cohortTerms)].join('\n').toLowerCase()),
    lowerNames, nameOrder,
    bySlug: new Map(records.map((r, i) => [r.slug ?? r.id, i])),
    byId: new Map(records.map((r, i) => [r.id, i])),
    byName: postings(records, (r) => [r.name]),
    founders: new Map([...founders].map(([k, rows]) => [k, Uint32Array.from(rows)])),
    people: [...founders.keys()].map((name) => ({ name, lower: name.toLowerCase(), company: records[founders.get(name)[0]].name })),
    meta: {
      sectors: uniqueSorted(records.map((r) => r.sector)), cities: uniqueSorted(records.map((r) => r.city)),
      investors: uniqueSorted(records.flatMap((r) => r.investors || [])), stages: uniqueSorted(records.map((r) => r.stage)),
      // The options of the filters for the optional facts, from the data and only the ones some company has: none until a page gives one.
      remotePolicies: REMOTE_POLICIES.filter((p) => records.some((r) => r.remote_policy === p)),
      techStack: [...techCounts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 60).map(([name]) => name),
      teamSizes: TEAM_BUCKETS.filter((b) => buckets.includes(b.code)).map(({ code, label }) => ({ code, label })),
      // The accelerator cohorts some company is in (a page backs it), with how many: the options of the cohort filter. None until one is.
      cohorts: COHORT_IDS.filter((id) => cohortCounts.has(id)).map((id) => ({ id, label: COHORTS[id].label, accelerator: COHORTS[id].accelerator, cohort: COHORTS[id].cohort, count: cohortCounts.get(id) })),
      // Is any company new this week (freshOf)? The page asks for the strip of them only when one is, so no request is made for nothing.
      hasFresh: records.some((r) => freshOf(r, now()) !== null),
    },
    cards: records.map((r) => Object.fromEntries(CARD_FIELDS.filter((k) => k in r).map((k) => [k, r[k]]))),
    markers: records.map((r, i) => (r.verified && isPoint(precisions[i]) && Number.isFinite(r.lat) && Number.isFinite(r.lng)
      ? [r.slug ?? r.id, r.name, r.lat, r.lng, r.sector, r.city, r.hiring ? 1 : 0, domainOf(r.website), precisions[i],
        describeLocation({ location_precision: precisions[i], city: r.city, state: r.state, address: r.address, suburb: r.suburb }).place ?? '', r.location_verified ? 1 : 0,
        ownLogo(r.logo)] : null)),
  };
  lap('indexes, cards, markers');
  return snap;
}

// hiringWindowDays: how recent a CONFIRMED reading of a company's open roles must be for it to count as hiring now (see hiringStateOf).
// null keeps the older rule. The snapshot is rebuilt when the UTC day changes, so a company ages out of "hiring now" on time.
export function createCatalog({ file, reloadMs = 1000, now = Date.now, hiringWindowDays = null } = {}) {
  let snap = null;
  let loading = null;
  let checkedAt = 0;
  let signature = null;

  // The records beside the file that say where its facts came from. A folder without them (a test's, a scale run's) has none: the
  // companies are served as they were, with no sources to show.
  const beside = ['sources.json', 'evidence.json', 'jobs.json'].map((name) => path.join(path.dirname(file), name));
  const statOf = async (f) => {
    try { const i = await stat(f); return `${Math.round(i.mtimeMs)}-${i.size}`; } catch (err) { if (err.code === 'ENOENT') return 'none'; throw err; }
  };
  const rowsOf = async (f) => {
    try { return JSON.parse(await readFile(f, 'utf8')); } catch (err) { if (err.code === 'ENOENT') return []; throw err; }
  };

  async function load() {
    const info = await stat(file);
    const sig = [`${Math.round(info.mtimeMs)}-${info.size}`, ...(await Promise.all(beside.map(statOf))), ...(hiringWindowDays == null ? [] : [new Date(now()).toISOString().slice(0, 10)])].join('/');
    if (snap && sig === signature) return snap;
    const raw = await readFile(file, 'utf8');
    const [sources, evidence, jobs] = await Promise.all(beside.map(rowsOf));
    snap = buildSnapshot(raw, sig, { provenance: buildProvenance({ sources, evidence, jobs }), now, hiringWindowDays });
    signature = sig;
    return snap;
  }

  // The current snapshot. Many callers at once share one load, and a reload in progress is not waited for:
  // the previous snapshot answers until the new one is ready.
  async function current() {
    if (snap && now() - checkedAt < reloadMs) return snap;
    checkedAt = now();
    if (!snap) {
      loading ??= load().finally(() => { loading = null; });
      return loading;
    }
    loading ??= load().catch(() => snap).finally(() => { loading = null; });
    return snap;
  }

  // Load now and wait for it: for a server that wants to be ready before it listens, and for tests.
  const refresh = async () => { checkedAt = now(); loading ??= load().finally(() => { loading = null; }); return loading; };
  return { snapshot: current, refresh, file };
}

// ---------- filters ----------

const str = (v) => (Array.isArray(v) ? v.join(',') : String(v));

// What was asked for, read from a query string, with the legacy coercions: a value is a string, and an empty one is not a filter.
export function readFilters(query = {}) {
  const f = {};
  for (const key of ['search', 'sector', 'city', 'investor', 'stage', 'hiring', 'taskGate', 'verified', 'events', 'precision', 'state', 'remote', 'tech', 'team', 'fresh', 'cohort']) {
    if (query[key]) f[key] = str(query[key]);
  }
  if (query.name) f.names = [].concat(query.name).map(String);
  return f;
}

// Events are an optional list on a company ({ title, date: YYYY-MM-DD, url }). One is "this week" from the start of today to 14 days on.
export const EVENT_WINDOW_DAYS = 14;
export function upcomingEvent(events, now = Date.now()) {
  if (!Array.isArray(events)) return null;
  const start = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  const end = start + (EVENT_WINDOW_DAYS + 1) * 86400000;
  return events.filter((e) => { const t = Date.parse(e?.date); return t >= start && t < end; }).sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0] ?? null;
}

const isEmptyFilter = (f) => Object.keys(f).length === 0;

function union(map, values) {
  if (values.length === 1) return map.get(values[0]) ?? EMPTY;
  const seen = new Set();
  for (const v of values) for (const i of map.get(v) ?? EMPTY) seen.add(i);
  return Uint32Array.from([...seen].sort((a, b) => a - b));
}

// The index to start from: of the lists the filters name, the shortest (with what it is an index of), or none when no filter has one.
// How well the place is known and the state are codes (EXACT, NSW), written in either case.
function startingPoint(snap, f, precisions, states) {
  const lists = [];
  if (f.sector) lists.push(['sector', union(snap.idx.sector, f.sector.split(','))]);
  if (f.city) lists.push(['city', union(snap.idx.city, f.city.split(','))]);
  if (f.investor) lists.push(['investor', snap.idx.investor.get(f.investor) ?? EMPTY]);
  if (f.stage) lists.push(['stage', union(snap.idx.stage, f.stage.split(','))]);
  if (f.remote) lists.push(['remote', union(snap.idx.remote, f.remote.split(','))]);
  if (f.tech) lists.push(['tech', union(snap.idx.tech, f.tech.split(','))]);
  if (f.team) lists.push(['team', union(snap.idx.team, f.team.split(','))]);
  if (f.cohort) lists.push(['cohort', union(snap.idx.cohort, f.cohort.split(','))]);
  if (f.names) lists.push(['name', union(snap.byName, f.names)]);
  // Only 'yes' and 'no' filter (any other value is ignored, as the per-record check in select always did).
  for (const column of ['hiring', 'taskGate', 'verified']) {
    if (f[column] === 'yes' || f[column] === 'no') lists.push([column, snap.idx[column].get(f[column]) ?? EMPTY]);
  }
  if (precisions) lists.push(['precision', union(snap.idx.precision, [...precisions])]);
  if (states) lists.push(['state', union(snap.idx.state, [...states])]);
  if (!lists.length) return null;
  const [on, list] = lists.reduce((a, b) => (b[1].length < a[1].length ? b : a));
  return { on, list };
}

const codes = (value) => (value ? new Set(value.toUpperCase().split(',')) : null);

// How a question is answered, as a database would show its query plan: the index it starts from (or a scan of every company when no
// filter has one), the companies it then looks at, and the companies that match. Search is always checked company by company, so
// a question with only a search is a scan.
export function explain(snap, f) {
  if (isEmptyFilter(f)) return { using: 'the whole list', examined: 0, matched: snap.count };
  const start = startingPoint(snap, f, codes(f.precision), codes(f.state));
  return { using: start ? start.on : 'scan', examined: start ? start.list.length : snap.count, matched: select(snap, f).length };
}

// The record numbers that match, ascending. The shortest index is the starting point, and every filter is
// then checked on each candidate, so the answer is the same however the work was split.
export function select(snap, f) {
  if (isEmptyFilter(f)) return snap.orders.file;
  const precisions = codes(f.precision);
  const states = codes(f.state);
  const base = startingPoint(snap, f, precisions, states)?.list ?? null;

  const q = f.search ? f.search.toLowerCase().replace(/\n/g, ' ') : null;
  const sectors = f.sector ? new Set(f.sector.split(',')) : null;
  const cities = f.city ? new Set(f.city.split(',')) : null;
  const names = f.names ? new Set(f.names) : null;
  const week = f.events === 'week' ? Date.now() : null;
  const stages = f.stage ? new Set(f.stage.split(',')) : null; // one stage, or several ("Seed to Series A")
  const remotes = f.remote ? new Set(f.remote.split(',')) : null;
  const techs = f.tech ? new Set(f.tech.split(',')) : null; // a company that uses any of them
  const teams = f.team ? new Set(f.team.split(',')) : null;
  const cohorts = f.cohort ? new Set(f.cohort.split(',')) : null; // a company in any of them
  const fresh =f.fresh === 'week' ? Date.now() : null; // raised, or had a role seen, in the last 14 days
  const { records, flags } = snap;
  const keep = (i) => {
    const r = records[i];
    if (q && !snap.search[i].includes(q)) return false;
    if (sectors && !sectors.has(r.sector)) return false;
    if (cities && !cities.has(r.city) && !cities.has(snap.metros[i])) return false;
    if (precisions && !precisions.has(snap.precisions[i])) return false;
    if (states && !states.has(r.state)) return false;
    if (f.investor && !(r.investors || []).includes(f.investor)) return false;
    if (stages && !stages.has(r.stage)) return false;
    if (remotes && !remotes.has(r.remote_policy)) return false;
    if (techs && !(r.tech_stack ?? []).some((t) => techs.has(t))) return false;
    if (teams && !teams.has(snap.buckets[i])) return false;
    if (cohorts && !(r.cohorts ?? []).some((id) => cohorts.has(id))) return false;
    if (fresh && !freshOf(r, fresh)) return false;
    if (f.hiring === 'yes' && !flags.hiring[i]) return false;
    if (f.hiring === 'no' && flags.hiring[i]) return false;
    if (f.taskGate === 'yes' && !flags.taskGate[i]) return false;
    if (f.taskGate === 'no' && flags.taskGate[i]) return false;
    if (f.verified === 'yes' && !flags.verified[i]) return false;
    if (f.verified === 'no' && flags.verified[i]) return false;
    if (names && !names.has(r.name)) return false;
    if (week && !upcomingEvent(r.events, week)) return false;
    return true;
  };
  const out = [];
  if (base) { for (const i of base) if (keep(i)) out.push(i); } else for (let i = 0; i < snap.count; i += 1) if (keep(i)) out.push(i);
  return Uint32Array.from(out);
}

// One page of a result in the order asked for. A page is a slice of a precomputed order, never a sort.
export function pageOf(snap, matched, { sort = 'file', offset = 0, limit = matched.length } = {}) {
  if (sort === 'file') return matched.subarray(offset, offset + limit);
  const order = snap.orders[sort];
  if (matched.length === snap.count) return order.subarray(offset, offset + limit);
  const mask = new Uint8Array(snap.count);
  for (const i of matched) mask[i] = 1;
  const out = [];
  let skipped = 0;
  for (const i of order) {
    if (!mask[i]) continue;
    if (skipped < offset) { skipped += 1; continue; }
    out.push(i);
    if (out.length >= limit) break;
  }
  return Uint32Array.from(out);
}

// How many of the matches have each value, most first. Counted over the matches, so every option shown is real.
export function facets(snap, matched, names, { top = 100 } = {}) {
  const out = {};
  for (const name of names) {
    const counts = new Map();
    for (const i of matched) {
      const r = snap.records[i];
      const values = name === 'investor' ? r.investors || [] : [r[name]];
      for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const rows = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    out[name] = { distinct: rows.length, values: rows.slice(0, top).map(([value, count]) => ({ value, count })) };
  }
  return out;
}

// What the header and the side panels show about a result, without sending the result.
export function summary(snap, matched) {
  const cities = new Map();
  const founders = new Set(); // the people named as founders on these companies, each once
  const notable = [];
  const vouched = [];
  const byPrecision = Object.fromEntries(PRECISIONS.map((p) => [p, 0]));
  let pinned = 0;
  let hiring = 0;
  let hiringChecked = 0; // roles read earlier, or not by a source we confirm: said with the date, not counted as hiring now
  let openRoles = 0;     // the open roles read from the pages of the companies that are hiring now
  let taskGated = 0;
  let lastVerifiedAt = 0;
  for (const i of matched) {
    const r = snap.records[i];
    byPrecision[snap.precisions[i]] += 1;
    if (r.verified) pinned += 1;
    if (r.hiring) { hiring += 1; openRoles += r.open_roles ?? 0; }
    if (r.hiringState === 'checked') hiringChecked += 1;
    if (r.taskGate?.enabled) taskGated += 1;
    const checked = Date.parse(r.last_verified_at);
    if (checked > lastVerifiedAt) lastVerifiedAt = checked;
    const place = snap.metros[i] ?? r.city; // a suburb's company is counted in its big city
    cities.set(place, (cities.get(place) ?? 0) + 1);
    for (const person of r.founders || []) founders.add(person);
    if (r.foundedYear) notable.push(i);
    if (r.vouches?.length > 0) vouched.push(i);
  }
  const rows = (list) => list.map((i) => ({ name: snap.records[i].name, slug: snap.records[i].slug ?? snap.records[i].id }));
  notable.sort((a, b) => snap.records[a].foundedYear - snap.records[b].foundedYear || a - b);
  vouched.sort((a, b) => snap.records[b].vouches.length - snap.records[a].vouches.length || a - b);
  return {
    // pinned: companies with a confirmed location (the list's count); onMap: those drawn as a pin of their own
    count: matched.length, pinned, onMap: byPrecision.EXACT + byPrecision.SUBURB, byPrecision, unverified: matched.length - pinned, hiring, hiringChecked, openRoles, taskGated, cities: cities.size, founders: founders.size,
    // The most recent check of any company in the result (null when none was ever checked): the site's "Updated" date.
    lastVerifiedAt: lastVerifiedAt ? new Date(lastVerifiedAt).toISOString() : null,
    topCities: [...cities].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 8).map(([city, n]) => ({ city, count: n })),
    notable: { total: notable.length, items: notable.slice(0, 100).map((i) => ({ ...rows([i])[0], foundedYear: snap.records[i].foundedYear })) },
    vouched: { total: vouched.length, items: vouched.slice(0, 50).map((i) => ({ ...rows([i])[0], vouches: snap.records[i].vouches.length })) },
  };
}

// The pins for the matches whose location is a point (an exact office, or a suburb), as compact tuples (see MARKER_FIELDS).
export function markers(snap, matched) {
  const items = [];
  for (const i of matched) { const m = snap.markers[i]; if (m) items.push(m); }
  return items;
}

// The matches known only to their city or state, as one group per place: { kind, key, label, city, state, lat, lng,
// count, sample }. The point is the place's reference centre (geo/places.js), never a company's own, and a group is
// drawn as a group. `sample` names a few of them (AREA_SAMPLE, by name) so a click can list them; the rest are one
// filter away (precision, city, state). `unplaced` counts those whose city or state has no centre on file: they are in
// the list and the search, and on no map.
export function areas(snap, matched) {
  const groups = new Map();
  let unplaced = 0;
  for (const i of matched) {
    const key = snap.areaKey[i];
    if (key == null) continue;
    if (key === UNPLACED) { unplaced += 1; continue; }
    let group = groups.get(key);
    if (!group) { group = { ...snap.areaInfo.get(key), count: 0, members: [] }; groups.set(key, group); }
    group.count += 1;
    group.members.push(i);
  }
  const items = [...groups.values()].map(({ members, ...group }) => ({
    ...group,
    sample: members.sort((a, b) => (snap.lowerNames[a] < snap.lowerNames[b] ? -1 : snap.lowerNames[a] > snap.lowerNames[b] ? 1 : a - b)).slice(0, AREA_SAMPLE)
      .map((i) => ({ slug: snap.records[i].slug ?? snap.records[i].id, name: snap.records[i].name })),
  }));
  items.sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : 1));
  return { items, unplaced };
}

// ---------- search ----------

const lowerBound = (snap, q) => {
  let lo = 0;
  let hi = snap.count;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (snap.lowerNames[snap.nameOrder[mid]] < q) lo = mid + 1; else hi = mid;
  }
  return lo;
};

// Suggestions for a search box, best first: a name that starts with the text, then one with a word that does,
// then one that contains it. The prefix matches come from a binary search; the rest only run when there are
// fewer than `limit` of them.
export function suggest(snap, text, { limit = 5 } = {}) {
  const q = String(text ?? '').trim().toLowerCase();
  if (!q) return { companies: [], people: [], investors: [], industries: [], locations: [], cohorts: [] };
  const picked = new Set();
  const companies = [];
  const take = (i) => { if (!picked.has(i) && companies.length < limit) { picked.add(i); companies.push(i); } };
  for (let k = lowerBound(snap, q); k < snap.count && companies.length < limit; k += 1) {
    const i = snap.nameOrder[k];
    if (!snap.lowerNames[i].startsWith(q)) break;
    take(i);
  }
  if (companies.length < limit) {
    for (let i = 0; i < snap.count && companies.length < limit; i += 1) if (snap.lowerNames[i].includes(` ${q}`)) take(i);
    for (let i = 0; i < snap.count && companies.length < limit; i += 1) if (snap.lowerNames[i].includes(q)) take(i);
  }
  const people = [];
  for (const p of snap.people) {
    if (people.length >= limit) break;
    if (p.lower.includes(q)) people.push({ name: p.name, company: p.company });
  }
  const within = (list) => list.filter((v) => v.toLowerCase().includes(q)).slice(0, limit);
  return {
    companies: companies.map((i) => ({ name: snap.records[i].name, slug: snap.records[i].slug ?? snap.records[i].id, city: snap.records[i].city, sector: snap.records[i].sector })),
    people, investors: within(snap.meta.investors), industries: within(snap.meta.sectors), locations: within(snap.meta.cities),
    // The accelerator cohorts a company is in whose name or alias the text matches ("startmate", "w26"), to filter by.
    cohorts: snap.meta.cohorts.filter((c) => cohortTerms(c.id).some((t) => t.includes(q))).slice(0, limit).map(({ id, label, count }) => ({ id, label, count })),
  };
}

// Where a company's facts came from: the public pages behind them (what each backs and when it was read), when the newest was read,
// and the page that backs "hiring". A company with no public source has none, and says so.
export const sourcesFor = (snap, record) => {
  const found = snap.provenance?.get(record.id);
  const sources = found?.sources ?? [];
  const times = sources.map((s) => Date.parse(s.checked_at)).filter((t) => !Number.isNaN(t));
  return { sources, checked_at: times.length ? new Date(Math.max(...times)).toISOString() : null, hiring_source: record.hiring === true || record.hiringState === 'checked' ? found?.hiring ?? null : null };
};

export const recordFor = (snap, key) => {
  const i = snap.bySlug.get(key) ?? snap.byId.get(key);
  return i === undefined ? null : snap.records[i];
};
