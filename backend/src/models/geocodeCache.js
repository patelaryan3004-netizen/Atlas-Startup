// geocode_cache.json: what a geocoder answered, kept so the same address is never asked twice.
//
//   { id, provider, query, status, quality, result, fetched_at, expires_at }
//
//   id          the provider and the query, normalised (see cacheId): one row per question
//   status      found     the geocoder gave a place
//               none      it knew nothing of the query: asking again soon would get the same answer, so it waits
//               error     the geocoder could not be reached or refused: tried again sooner
//   quality     how precisely the place answers the query: house (the street number was found), street (only the
//               street), suburb, city or region. Only a house answers an address with a point worth drawing.
//   result      for `found`: { lat, lng, display_name, osm_type, osm_id, class, type, addresstype, importance,
//               address: { house_number, road, suburb, city, state, postcode }, boundingbox }
//   expires_at  when the answer should be asked for again (a found address rarely moves; a refusal clears quickly)
//
// An internal record of the pipeline's own work: no route serves it.
const DAY = 86400000;
export const GEOCODE_STATUSES = ['found', 'none', 'error'];
export const GEOCODE_QUALITIES = ['house', 'street', 'suburb', 'city', 'region'];
// How long an answer is kept before the geocoder is asked again.
export const TTL_DAYS = { found: 365, none: 90, error: 1 };

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

// Two ways of writing the same question share one row.
export const normalizeQuery = (query) => String(query ?? '').toLowerCase().replace(/[\s,]+/g, ' ').trim();
export const cacheId = (provider, query) => `${provider}:${normalizeQuery(query)}`;

// The row for a question that is still fresh, or null.
export function lookup(rows, provider, query, nowMs) {
  const id = cacheId(provider, query);
  const row = rows.find((r) => r.id === id);
  if (!row) return null;
  return row.expires_at != null && Date.parse(row.expires_at) <= nowMs ? null : row;
}

// Puts an answer in the cache, replacing a stale one for the same question. Mutates `rows` and returns the row.
export function remember(rows, { provider, query, status, quality = null, result = null }, nowMs) {
  const at = new Date(nowMs).toISOString();
  const row = { id: cacheId(provider, query), provider, query: String(query).replace(/\s+/g, ' ').trim(), status, quality, result, fetched_at: at, expires_at: new Date(nowMs + TTL_DAYS[status] * DAY).toISOString() };
  const slot = rows.findIndex((r) => r.id === row.id);
  if (slot >= 0) rows[slot] = row; else rows.push(row);
  return row;
}

export function validateGeocodeCache(ds) {
  const errors = [];
  const bad = (where, msg) => errors.push(`${where}: ${msg}`);
  const seen = new Set();
  for (const r of ds.geocode_cache ?? []) {
    const at = `geocode_cache "${r.id}"`;
    if (typeof r.id !== 'string' || r.id === '') { bad(at, 'needs an id'); continue; }
    if (seen.has(r.id)) bad(at, 'duplicate id');
    seen.add(r.id);
    if (typeof r.provider !== 'string' || typeof r.query !== 'string' || r.query === '') bad(at, 'needs a provider and a query');
    else if (r.id !== cacheId(r.provider, r.query)) bad(at, 'id does not match the provider and query');
    if (!GEOCODE_STATUSES.includes(r.status)) bad(at, `status must be one of ${GEOCODE_STATUSES.join(', ')}`);
    if (!ISO.test(r.fetched_at ?? '')) bad(at, 'fetched_at must be an ISO-8601 UTC timestamp');
    if (r.expires_at != null && !ISO.test(r.expires_at)) bad(at, 'expires_at must be an ISO-8601 UTC timestamp or null');
    if (r.status === 'found') {
      if (!GEOCODE_QUALITIES.includes(r.quality)) bad(at, `quality must be one of ${GEOCODE_QUALITIES.join(', ')}`);
      if (!Number.isFinite(r.result?.lat) || !Number.isFinite(r.result?.lng)) bad(at, 'a found answer needs a point');
    } else if (r.result != null) bad(at, `a ${r.status} answer has no result`);
  }
  return errors;
}
