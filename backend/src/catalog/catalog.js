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
//   markers   the compact tuple a map pin needs, for companies with a confirmed location
//   search    lowercase text per record (name and founders): the legacy substring search runs over it
//   names     lowercase company names in order, for prefix lookup (search suggestions)
//
// Filters mean exactly what they always meant (the legacy tests and a randomised equivalence test pin it).
// Data changes on a deploy, not at run time, so the file is checked for change at most once a second
// (size and modified time) and rebuilt, without blocking requests, when it differs.
import { readFile, stat } from 'node:fs/promises';
import { toPublic } from '../models/company.js';

export const SORTS = ['file', 'name', 'hiring', 'location', 'industry'];
export const FACETS = ['sector', 'city', 'stage', 'investor'];
export const CARD_FIELDS = ['name', 'slug', 'sector', 'sectorFull', 'city', 'stage', 'hiring', 'verified', 'website', 'blurb', 'taskGate'];
export const MARKER_FIELDS = ['slug', 'name', 'lat', 'lng', 'sector', 'city', 'hiring', 'domain'];

const EMPTY = new Uint32Array(0);
const collator = new Intl.Collator(); // the same order localeCompare gives, which is what the list always sorted by

const domainOf = (website) => { try { return new URL(website).hostname.replace(/^www\./, ''); } catch { return ''; } };
const uniqueSorted = (values) => [...new Set(values)].sort(); // default order, as the filter options always were

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

export function buildSnapshot(raw, version, { lap = () => {} } = {}) {
  const source = JSON.parse(raw);
  lap('parse');
  const records = source.map(toPublic);
  lap('public form');
  const count = records.length;
  const all = Uint32Array.from({ length: count }, (_, i) => i);

  const orders = { file: all };
  // A key per record, so a sort compares two strings and not two objects' fields through a collator each time.
  const keys = {
    name: records.map((r) => r.name), city: records.map((r) => r.city), industry: records.map((r) => r.sectorFull || r.sector),
  };
  const byKey = (list) => (a, b) => collator.compare(list[a], list[b]) || a - b;
  const compares = {
    name: byKey(keys.name),
    hiring: (a, b) => (records[b].hiring === true) - (records[a].hiring === true) || collator.compare(keys.name[a], keys.name[b]) || a - b,
    location: (a, b) => collator.compare(keys.city[a], keys.city[b]) || collator.compare(keys.name[a], keys.name[b]) || a - b,
    industry: (a, b) => collator.compare(keys.industry[a], keys.industry[b]) || collator.compare(keys.name[a], keys.name[b]) || a - b,
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

  lap('names');
  const snap = {
    version, count, loadedAt: Date.now(), records, orders,
    flags: { hiring: flag((r) => r.hiring), verified: flag((r) => r.verified), taskGate: flag((r) => r.taskGate?.enabled) },
    idx: {
      sector: postings(records, (r) => [r.sector]), city: postings(records, (r) => [r.city]), stage: postings(records, (r) => [r.stage]),
      investor: postings(records, (r) => new Set(r.investors || [])),
    },
    search: records.map((r) => [r.name, ...(r.founders || [])].join('\n').toLowerCase()),
    lowerNames, nameOrder,
    bySlug: new Map(records.map((r, i) => [r.slug ?? r.id, i])),
    byId: new Map(records.map((r, i) => [r.id, i])),
    byName: postings(records, (r) => [r.name]),
    founders: new Map([...founders].map(([k, rows]) => [k, Uint32Array.from(rows)])),
    people: [...founders.keys()].map((name) => ({ name, lower: name.toLowerCase(), company: records[founders.get(name)[0]].name })),
    meta: {
      sectors: uniqueSorted(records.map((r) => r.sector)), cities: uniqueSorted(records.map((r) => r.city)),
      investors: uniqueSorted(records.flatMap((r) => r.investors || [])), stages: uniqueSorted(records.map((r) => r.stage)),
    },
    cards: records.map((r) => Object.fromEntries(CARD_FIELDS.filter((k) => k in r).map((k) => [k, r[k]]))),
    markers: records.map((r) => (r.verified && Number.isFinite(r.lat) && Number.isFinite(r.lng)
      ? [r.slug ?? r.id, r.name, r.lat, r.lng, r.sector, r.city, r.hiring ? 1 : 0, domainOf(r.website)] : null)),
  };
  lap('indexes, cards, markers');
  return snap;
}

export function createCatalog({ file, reloadMs = 1000, now = Date.now } = {}) {
  let snap = null;
  let loading = null;
  let checkedAt = 0;
  let signature = null;

  async function load() {
    const info = await stat(file);
    const sig = `${Math.round(info.mtimeMs)}-${info.size}`;
    if (snap && sig === signature) return snap;
    const raw = await readFile(file, 'utf8');
    snap = buildSnapshot(raw, sig);
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
  for (const key of ['search', 'sector', 'city', 'investor', 'stage', 'hiring', 'taskGate', 'verified']) {
    if (query[key]) f[key] = str(query[key]);
  }
  if (query.name) f.names = [].concat(query.name).map(String);
  return f;
}

const isEmptyFilter = (f) => Object.keys(f).length === 0;

function union(map, values) {
  if (values.length === 1) return map.get(values[0]) ?? EMPTY;
  const seen = new Set();
  for (const v of values) for (const i of map.get(v) ?? EMPTY) seen.add(i);
  return Uint32Array.from([...seen].sort((a, b) => a - b));
}

// The record numbers that match, ascending. The smallest facet list is the starting point, and every filter is
// then checked on each candidate, so the answer is the same however the work was split.
export function select(snap, f) {
  if (isEmptyFilter(f)) return snap.orders.file;
  const lists = [];
  if (f.sector) lists.push(union(snap.idx.sector, f.sector.split(',')));
  if (f.city) lists.push(union(snap.idx.city, f.city.split(',')));
  if (f.investor) lists.push(snap.idx.investor.get(f.investor) ?? EMPTY);
  if (f.stage) lists.push(snap.idx.stage.get(f.stage) ?? EMPTY);
  if (f.names) lists.push(union(snap.byName, f.names));
  const base = lists.length ? lists.reduce((a, b) => (b.length < a.length ? b : a)) : null;

  const q = f.search ? f.search.toLowerCase().replace(/\n/g, ' ') : null;
  const sectors = f.sector ? new Set(f.sector.split(',')) : null;
  const cities = f.city ? new Set(f.city.split(',')) : null;
  const names = f.names ? new Set(f.names) : null;
  const { records, flags } = snap;
  const keep = (i) => {
    const r = records[i];
    if (q && !snap.search[i].includes(q)) return false;
    if (sectors && !sectors.has(r.sector)) return false;
    if (cities && !cities.has(r.city)) return false;
    if (f.investor && !(r.investors || []).includes(f.investor)) return false;
    if (f.stage && r.stage !== f.stage) return false;
    if (f.hiring === 'yes' && !flags.hiring[i]) return false;
    if (f.hiring === 'no' && flags.hiring[i]) return false;
    if (f.taskGate === 'yes' && !flags.taskGate[i]) return false;
    if (f.taskGate === 'no' && flags.taskGate[i]) return false;
    if (f.verified === 'yes' && !flags.verified[i]) return false;
    if (f.verified === 'no' && flags.verified[i]) return false;
    if (names && !names.has(r.name)) return false;
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
  const notable = [];
  const vouched = [];
  let pinned = 0;
  let hiring = 0;
  let taskGated = 0;
  for (const i of matched) {
    const r = snap.records[i];
    if (r.verified) pinned += 1;
    if (r.hiring) hiring += 1;
    if (r.taskGate?.enabled) taskGated += 1;
    cities.set(r.city, (cities.get(r.city) ?? 0) + 1);
    if (r.foundedYear) notable.push(i);
    if (r.vouches?.length > 0) vouched.push(i);
  }
  const rows = (list) => list.map((i) => ({ name: snap.records[i].name, slug: snap.records[i].slug ?? snap.records[i].id }));
  notable.sort((a, b) => snap.records[a].foundedYear - snap.records[b].foundedYear || a - b);
  vouched.sort((a, b) => snap.records[b].vouches.length - snap.records[a].vouches.length || a - b);
  return {
    count: matched.length, pinned, unverified: matched.length - pinned, hiring, taskGated, cities: cities.size,
    topCities: [...cities].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 8).map(([city, n]) => ({ city, count: n })),
    notable: { total: notable.length, items: notable.slice(0, 100).map((i) => ({ ...rows([i])[0], foundedYear: snap.records[i].foundedYear })) },
    vouched: { total: vouched.length, items: vouched.slice(0, 50).map((i) => ({ ...rows([i])[0], vouches: snap.records[i].vouches.length })) },
  };
}

// The pins for the matches that have a confirmed location, as compact tuples (see MARKER_FIELDS).
export function markers(snap, matched) {
  const items = [];
  for (const i of matched) { const m = snap.markers[i]; if (m) items.push(m); }
  return items;
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
  if (!q) return { companies: [], people: [], investors: [], industries: [], locations: [] };
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
  };
}

export const recordFor = (snap, key) => {
  const i = snap.bySlug.get(key) ?? snap.byId.get(key);
  return i === undefined ? null : snap.records[i];
};
