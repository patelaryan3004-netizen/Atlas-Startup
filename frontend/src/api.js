const API_ROOT = import.meta.env.VITE_API_BASE || '';
const BASE = `${API_ROOT}/api`;
export const DIRECTORY_URL = `${API_ROOT}/directory`;

// Empty values are left out; a list (the tracked names) is repeated as name=a&name=b.
function toQuery(params) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
    else if (v) qs.set(k, v);
  });
  const s = qs.toString();
  return s ? `?${s}` : '';
}

async function getJson(url, { signal, failure }) {
  const res = await fetch(url, signal ? { signal } : undefined);
  if (!res.ok) throw Object.assign(new Error(failure), { status: res.status });
  return res.json();
}

// The whole list in one go, every company in full. Kept for anything that still wants it, but the app does not:
// at thousands of companies that is megabytes, so it pages (fetchStartupPage), draws the map from compact pins
// (fetchMarkers) and asks for counts (fetchSummary, fetchCount).
export async function fetchStartups(filters = {}) {
  const res = await fetch(`${BASE}/startups${toQuery(filters)}`);
  if (!res.ok) throw new Error('Failed to fetch startups');
  return res.json();
}

// One page of companies as cards, in the order asked for (name, hiring, location, industry). Resolves to
// { total, count, results, offset, limit, hasMore, facets? }; `facets` is a list like 'sector,city,stage'.
export function fetchStartupPage(filters = {}, { limit = 48, offset = 0, sort = 'name', facets, signal } = {}) {
  return getJson(`${BASE}/startups${toQuery({ ...filters, limit: String(limit), offset: String(offset), sort, view: 'card', facets })}`, { signal, failure: 'Failed to fetch startups' });
}

// The map's pins for a set of filters: { total, count, pinned, fields, items, areas, unplaced }. Each item is a compact array in
// the order of `fields`, for a company whose place is a point (an exact office or a suburb). `areas` are the companies known
// only to a city or a state, one group per place ({ kind, label, city, state, lat, lng, count, sample }), drawn as a group and
// never as a pin; `unplaced` counts those whose city has no centre on file (they are in the list, not on the map).
export function fetchMarkers(filters = {}, { signal } = {}) {
  return getJson(`${BASE}/startups/markers${toQuery(filters)}`, { signal, failure: 'Failed to fetch map pins' });
}

// Counts and short lists about a set of filters: { count, pinned, onMap, byPrecision, unverified, hiring, taskGated, cities, topCities,
// notable, vouched }. `pinned` is the companies with a confirmed location; `onMap` those drawn as a pin of their own.
export function fetchSummary(filters = {}, { signal } = {}) {
  return getJson(`${BASE}/startups/summary${toQuery(filters)}`, { signal, failure: 'Failed to fetch counts' });
}

export function fetchCount(filters = {}, { signal } = {}) {
  return getJson(`${BASE}/startups/count${toQuery(filters)}`, { signal, failure: 'Failed to fetch a count' });
}

// One company in full, by slug.
export function fetchStartup(slug, { signal } = {}) {
  return getJson(`${BASE}/startups/${encodeURIComponent(slug)}`, { signal, failure: 'Failed to fetch the company' });
}

// Companies by exact name (the ones a visitor tracks): up to 200 at a time.
export function fetchStartupsByName(names, { signal } = {}) {
  return getJson(`${BASE}/startups${toQuery({ name: names.slice(0, 200), limit: '200', view: 'card' })}`, { signal, failure: 'Failed to fetch startups' });
}

// Suggestions for the search box: { companies, people, investors, industries, locations }.
export function fetchSuggestions(q, { signal } = {}) {
  return getJson(`${BASE}/search${toQuery({ q })}`, { signal, failure: 'Failed to search' });
}

// The companies a founder is named on: { name, companies }.
export function fetchPerson(name, { signal } = {}) {
  return getJson(`${BASE}/people/${encodeURIComponent(name)}`, { signal, failure: 'Failed to fetch the person' });
}

// ---------- the investor directory ----------

// One page of published investors as cards, in the order asked for (name, portfolio, location). Resolves to
// { total, count, results, offset, limit, hasMore, facets? }; `facets` is a list like 'type,stage,sector'. Filters are
// search, type, stage, sector, location, lead, active, chequeMin, chequeMax, and name (a list of exact names).
export function fetchInvestors(filters = {}, { limit = 24, offset = 0, sort = 'name', facets, signal } = {}) {
  return getJson(`${BASE}/investors${toQuery({ ...filters, limit: String(limit), offset: String(offset), sort, facets })}`, { signal, failure: 'Failed to fetch investors' });
}

// What the whole directory offers to filter by, with how many investors have each: { total, types, stages, sectors,
// locations, lead, active, cheque }. `cheque` is null until some investor states a cheque size in Australian dollars.
export function fetchInvestorMeta({ signal } = {}) {
  return getJson(`${BASE}/investors/meta`, { signal, failure: 'Failed to fetch the investor filters' });
}

// One published investor in full, by slug.
export function fetchInvestor(slug, { signal } = {}) {
  return getJson(`${BASE}/investors/${encodeURIComponent(slug)}`, { signal, failure: 'Failed to fetch the investor' });
}

// One published person who invests, by slug.
export function fetchInvestorPerson(slug, { signal } = {}) {
  return getJson(`${BASE}/investor-people/${encodeURIComponent(slug)}`, { signal, failure: 'Failed to fetch the person' });
}

// The published investors a company's own record names, by exact name or other name: only those with a page to open.
export function fetchInvestorsByName(names, { signal } = {}) {
  return fetchInvestors({ name: names.slice(0, 100) }, { limit: 100, signal });
}

// A correction a visitor suggests for an investor's page. It is staged for a person to check against a page, never applied.
export async function submitInvestorCorrection(slug, data) {
  const res = await fetch(`${BASE}/investors/${encodeURIComponent(slug)}/corrections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Failed to send the correction');
  return body;
}

export async function fetchMeta() {
  const res = await fetch(`${BASE}/startups/meta`);
  if (!res.ok) throw new Error('Failed to fetch filter metadata');
  return res.json();
}

export async function fetchNews(force = false) {
  const res = await fetch(`${BASE}/news${force ? '?refresh=1' : ''}`);
  if (!res.ok) throw new Error('Failed to fetch news');
  return res.json();
}

export async function submitStartup(data) {
  const res = await fetch(`${BASE}/submissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Failed to submit startup');
  return body;
}

export async function submitEdit(data) {
  const res = await fetch(`${BASE}/edits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Failed to submit edit');
  return body;
}

export async function submitFeedback(data) {
  const res = await fetch(`${BASE}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Failed to submit feedback');
  return body;
}
