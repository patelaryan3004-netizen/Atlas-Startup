import { snapshotAnswer, peekSnapshot } from './snapshot.js';
import { API_ROOT, BASE, toQuery, startupPageUrl, markersUrl, summaryUrl, metaUrl, countsUrl } from './apiUrls.js';

export const DIRECTORY_URL = `${API_ROOT}/directory`;

// `onSnapshot(data)`, when given, is called with the answer this request had when the snapshot file was made (snapshot.js), if the file holds
// one and the server has not answered yet, so a page draws at once and the server's own answer follows: the promise resolves with that, and
// with the very same object when nothing changed (so a page that sets it as state does not draw twice). A server that cannot be reached
// still rejects; the page has what the snapshot gave it.
async function getJson(url, { signal, failure, onSnapshot }) {
  const path = url.slice(API_ROOT.length);
  let answered = false;
  if (onSnapshot) {
    snapshotAnswer(path).then((hit) => {
      if (!hit || answered || signal?.aborted) return;
      onSnapshot(hit);
    }, () => {});
  }
  const res = await (signal ? fetch(url, { signal }) : fetch(url));
  answered = true;
  if (!res.ok) throw Object.assign(new Error(failure), { status: res.status });
  const body = await res.json();
  // The snapshot's own object when the server's answer is the same (peek.js gave a page that object to start from), so state set from it
  // does not change and the page does not draw twice.
  const known = peekSnapshot(path);
  return known && JSON.stringify(known) === JSON.stringify(body) ? known : body;
}

// There is no call for the whole list: the server answers every list a page at a time (20 unless asked, 200 at most), so the app
// pages (fetchStartupPage), draws the map from compact pins (fetchMarkers) and asks for counts (fetchSummary, fetchCount,
// fetchCounts for several at once).

// One page of companies as cards, in the order asked for (name, hiring, location, industry, stage, verified). Resolves to
// { total, count, results, offset, limit, hasMore, nextOffset, facets? }; `facets` is a list like 'sector,city,stage'.
export function fetchStartupPage(filters = {}, { limit = 20, offset = 0, sort = 'name', facets, signal, onSnapshot } = {}) {
  return getJson(startupPageUrl(filters, { limit, offset, sort, facets }), { signal, failure: 'Failed to fetch startups', onSnapshot });
}

// The address of a list as a spreadsheet: the same filters and sort as the list, every company they pick (not a page), as a CSV the
// browser saves. It is a link, not a request: the server sends the file as an attachment.
export function exportUrl(filters = {}, sort = 'name') {
  return `${BASE}/startups/export.csv${toQuery({ ...filters, sort })}`;
}

// The map's pins for a set of filters: { total, count, pinned, fields, items, areas, unplaced }. Each item is a compact array in
// the order of `fields`, for a company whose place is a point (an exact office or a suburb). `areas` are the companies known
// only to a city or a state, one group per place ({ kind, label, city, state, lat, lng, count, sample }), drawn as a group and
// never as a pin; `unplaced` counts those whose city has no centre on file (they are in the list, not on the map).
export function fetchMarkers(filters = {}, { signal, onSnapshot } = {}) {
  return getJson(markersUrl(filters), { signal, failure: 'Failed to fetch map pins', onSnapshot });
}

// Counts and short lists about a set of filters: { count, pinned, onMap, byPrecision, unverified, hiring, taskGated, cities, topCities,
// notable, vouched }. `pinned` is the companies with a confirmed location; `onMap` those drawn as a pin of their own.
export function fetchSummary(filters = {}, { signal, onSnapshot } = {}) {
  return getJson(summaryUrl(filters), { signal, failure: 'Failed to fetch counts', onSnapshot });
}

export function fetchCount(filters = {}, { signal } = {}) {
  return getJson(`${BASE}/startups/count${toQuery(filters)}`, { signal, failure: 'Failed to fetch a count' });
}

// How many companies each of several sets of filters picks, in one request: { total, counts: [n, ...] } in the order given. A page of
// curated lists asks this once; asking fetchCount once per list was a request each.
export function fetchCounts(filterSets, { signal, onSnapshot } = {}) {
  return getJson(countsUrl(filterSets), { signal, failure: 'Failed to fetch the counts', onSnapshot });
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
// { total, count, results, offset, limit, hasMore, nextOffset, facets? }; `facets` is a list like 'type,stage,sector'. Filters are
// search, type, stage, sector, location, lead, active, chequeMin, chequeMax, and name (a list of exact names).
export function fetchInvestors(filters = {}, { limit = 20, offset = 0, sort = 'name', facets, signal } = {}) {
  return getJson(`${BASE}/investors${toQuery({ ...filters, limit: String(limit), offset: String(offset), sort, facets })}`, { signal, failure: 'Failed to fetch investors' });
}

// What the whole directory offers to filter by, with how many investors have each: { total, types, stages, sectors,
// locations, lead, active, cheque }. `cheque` is null until some investor states a cheque size in Australian dollars.
export function fetchInvestorMeta({ signal } = {}) {
  return getJson(`${BASE}/investors/meta`, { signal, failure: 'Failed to fetch the investor filters' });
}

// The investors as marks for the map: { total, count, pinned, unplaced, items: [{ id, slug, name, type_label, domain, logo, lat, lng, city, state, place,
// role, precision, stages, sectors, portfolio_count }] }. The map's own search, sector, stage and city narrow them, like the companies'. A mark is the
// reference point of a city (precision CITY), never an office: the investors' records state a city and no address.
export function fetchInvestorPins(filters = {}, { signal } = {}) {
  const { search, sector, stage, city } = filters;
  return getJson(`${BASE}/investors/pins${toQuery({ search, sector, stage, city })}`, { signal, failure: 'Failed to fetch the investors for the map' });
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

// ---------- the people pages ----------

// People worth following, one tab at a time (role: founder, operator or investor), 20 to a page. Resolves to
// { counts: { founders, operators, investors, institutions }, total, count, results, offset, limit, hasMore, nextOffset }.
// `list` is a curated list's id: the people on it, in its order.
export function fetchPeople(filters = {}, { limit = 20, offset = 0, signal } = {}) {
  return getJson(`${BASE}/people${toQuery({ ...filters, limit: String(limit), offset: String(offset) })}`, { signal, failure: 'Failed to fetch people' });
}

// The firms, beside the investor pages that back them: the same shape as fetchPeople.
export function fetchInstitutions(filters = {}, { limit = 20, offset = 0, signal } = {}) {
  return getJson(`${BASE}/institutions${toQuery({ ...filters, limit: String(limit), offset: String(offset) })}`, { signal, failure: 'Failed to fetch institutions' });
}

// The firms' offices drawn on the map: { count, items: [{ id, institution, name, lat, lng, city, state, place, office, website, href }] }.
// None until institutions_seed.json is in place and its addresses are settled.
export function fetchInstitutionPins({ signal } = {}) {
  return getJson(`${BASE}/institutions/pins`, { signal, failure: 'Failed to fetch the institutions on the map' });
}

// The curated lists that have someone on them: { results: [{ id, title, description, curator, type, count }] }.
export function fetchLists({ signal } = {}) {
  return getJson(`${BASE}/lists`, { signal, failure: 'Failed to fetch the lists' });
}

// One list, in its own order: { list, total, count, results, offset, limit, hasMore, nextOffset }. Its results are people,
// institutions or companies, as its type says.
export function fetchList(id, { limit = 20, offset = 0, signal } = {}) {
  return getJson(`${BASE}/lists/${encodeURIComponent(id)}${toQuery({ limit: String(limit), offset: String(offset) })}`, { signal, failure: 'Failed to fetch the list' });
}

export function fetchMeta({ onSnapshot } = {}) {
  return getJson(metaUrl(), { failure: 'Failed to fetch filter metadata', onSnapshot });
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
