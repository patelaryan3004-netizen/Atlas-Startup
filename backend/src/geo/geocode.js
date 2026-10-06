// Turning a company's public address into a point, politely and only once.
//
// The geocoder is OpenStreetMap's Nominatim, whose usage policy this follows: no more than one request a second,
// a user agent that names this site, results kept so the same question is never asked twice (models/geocodeCache.js),
// and no bulk use (a run is a few hundred addresses, once, and a refusal or a 429 stops it). What it returns is
// OpenStreetMap data (ODbL): the map already credits "© OpenStreetMap contributors", and the Command Center says
// where a coordinate came from.
//
// What goes to the geocoder is a business address a company publishes itself (the address on file, which came from
// its website or from the directory), never a person's: the query is built from the street, suburb, state and
// postcode, with the unit, level and building left out.
//
// What comes back is judged before it is used (decide): a point is only worth drawing as an exact location when the
// geocoder found the street NUMBER (quality "house"), in the state and suburb or postcode the address names. A street
// alone, or a suburb, is not an address. And a point that disagrees with one already on file is a conflict to look
// at, never a replacement made silently.
import { parseAddress, streetLine } from '../models/location.js';
import { distanceMetres, centreAt, kmFromCity, CENTRE_METRES, MAX_KM_FROM_CITY, STATES } from './places.js';
import { lookup, remember, normalizeQuery } from '../models/geocodeCache.js';

export const PROVIDER = 'nominatim';
export const DEFAULT_BASE_URL = 'https://nominatim.openstreetmap.org';
export const DEFAULT_USER_AGENT = 'AUStartupMapBot/1.0 (+https://au-startup-map.vercel.app/; geocoding)';
export const MIN_INTERVAL_MS = 1100; // Nominatim allows one request a second at most

// A point within this of the one on file is the same place: the geocoder's replaces it (it can be traced).
export const AGREE_METRES = 500;
// Within this the two are the same point to all intents, and the one on file is left exactly as it is.
export const SAME_POINT_METRES = 25;
// A suburb's centre is wherever the geocoder puts it, so a suburb point is "the same" within a couple of kilometres.
export const SUBURB_AGREE_METRES = 2500;

// ---------- the question ----------

// The question to ask for a company's location, and what kind of answer would settle it:
//   address  a street address: wants a house
//   suburb   a suburb with no street: wants a suburb
//   city     a city: wants a city
// null when the record gives nothing to ask about.
export function questionFor({ address, suburb, city, state, postcode, location_precision: precision }) {
  const parsed = parseAddress(address);
  const st = state ?? parsed.state;
  const pc = postcode ?? parsed.postcode;
  if (parsed.streetLevel) {
    const place = parsed.suburb ?? suburb;
    return { kind: 'address', query: [streetLine(address), place, st, pc, 'Australia'].filter(Boolean).join(', '), wants: 'house' };
  }
  const place = precision === 'SUBURB' ? (suburb ?? parsed.suburb) : null;
  if (place) return { kind: 'suburb', query: [place, st, pc, 'Australia'].filter(Boolean).join(', '), wants: 'suburb' };
  if (city && !/^unknown$/i.test(city)) return { kind: 'city', query: [city, st, 'Australia'].filter(Boolean).join(', '), wants: 'city' };
  return null;
}

// ---------- the answer ----------

const HOUSE_TYPES = new Set(['house', 'building', 'office', 'shop', 'amenity', 'commercial', 'retail', 'industrial', 'tourism', 'leisure', 'craft', 'man_made', 'residential', 'apartments', 'yes']);
const SUBURB_TYPES = new Set(['suburb', 'neighbourhood', 'quarter', 'locality', 'hamlet', 'village', 'town', 'city_district', 'borough', 'isolated_dwelling', 'residential_area']);
const CITY_TYPES = new Set(['city', 'municipality']);

// How exactly a Nominatim result answers: house (the street number was found), street, suburb, city, region.
export function qualityOf(result) {
  const a = result.address ?? {};
  const type = result.addresstype ?? result.type;
  if (a.house_number || (HOUSE_TYPES.has(type) && a.road)) return 'house';
  if (type === 'road' || result.category === 'highway' || result.class === 'highway') return 'street';
  if (SUBURB_TYPES.has(type) || (a.suburb && !CITY_TYPES.has(type))) return 'suburb';
  if (CITY_TYPES.has(type)) return 'city';
  return 'region';
}

const keep = (result) => ({
  lat: Number(result.lat), lng: Number(result.lon), display_name: result.display_name ?? null, osm_type: result.osm_type ?? null, osm_id: result.osm_id ?? null,
  class: result.category ?? result.class ?? null, type: result.type ?? null, addresstype: result.addresstype ?? null, importance: result.importance ?? null,
  address: Object.fromEntries(['house_number', 'road', 'suburb', 'neighbourhood', 'city_district', 'city', 'town', 'village', 'state', 'postcode', 'country_code'].filter((k) => result.address?.[k] != null).map((k) => [k, result.address[k]])),
  boundingbox: result.boundingbox ?? null,
});

// ---------- the client ----------

// minIntervalMs between requests however many are made; `fetchImpl`, `now` and `sleep` are injectable so a test never
// touches the network or waits.
export function createGeocoder({
  fetchImpl = (...args) => fetch(...args), baseUrl = DEFAULT_BASE_URL, userAgent = DEFAULT_USER_AGENT, minIntervalMs = MIN_INTERVAL_MS,
  timeoutMs = 20000, now = Date.now, sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
} = {}) {
  let last = 0;
  let stopped = null;
  return {
    get stopped() { return stopped; },
    async search(query) {
      if (stopped) return { status: 'error', error: stopped };
      const wait = last + minIntervalMs - now();
      if (wait > 0) await sleep(wait);
      last = now();
      const url = `${baseUrl}/search?${new URLSearchParams({ q: query, format: 'jsonv2', addressdetails: '1', limit: '3', countrycodes: 'au', 'accept-language': 'en' })}`;
      let res;
      try {
        res = await fetchImpl(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
      } catch (err) { return { status: 'error', error: `could not reach the geocoder: ${err.message}` }; }
      // Told to slow down or go away: the whole run stops, and the next one tries again later.
      if (res.status === 429 || res.status === 403 || res.status === 503) {
        stopped = `the geocoder answered ${res.status}${res.headers?.get?.('retry-after') ? ` (retry after ${res.headers.get('retry-after')} s)` : ''}`;
        return { status: 'error', error: stopped };
      }
      if (!res.ok) return { status: 'error', error: `the geocoder answered ${res.status}` };
      let rows;
      try { rows = await res.json(); } catch { return { status: 'error', error: 'the geocoder answered something that is not JSON' }; }
      const found = (Array.isArray(rows) ? rows : []).filter((r) => Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lon)) && (r.address?.country_code ?? 'au') === 'au');
      if (!found.length) return { status: 'none' };
      const best = found[0];
      return { status: 'found', quality: qualityOf(best), result: keep(best) };
    },
  };
}

// The answer for a query, from the cache when it is there and fresh, from the geocoder when it is not (and then kept).
// Mutates `rows` (the cache). `fromCache` says whether the geocoder was spared. A failure to ask (the network, a 429) is
// reported but not kept: nothing was learned, and the next run should ask again.
export async function geocodeCached(geocoder, rows, query, nowMs) {
  const hit = lookup(rows, PROVIDER, query, nowMs);
  if (hit) return { row: hit, fromCache: true };
  const answer = await geocoder.search(query);
  if (answer.status === 'error') return { row: { status: 'error', error: answer.error, result: null, quality: null }, fromCache: false };
  return { row: remember(rows, { provider: PROVIDER, query, status: answer.status, quality: answer.quality ?? null, result: answer.result ?? null }, nowMs), fromCache: false };
}

// Merges two copies of the cache by question, keeping the answer that was fetched later.
export function mergeCache(a, b) {
  const byId = new Map(a.map((r) => [r.id, r]));
  for (const r of b) {
    const have = byId.get(r.id);
    if (!have || Date.parse(r.fetched_at) >= Date.parse(have.fetched_at)) byId.set(r.id, r);
  }
  return [...byId.values()];
}

// ---------- judging an answer ----------

// A street number as the range it covers: "441" is [441, 441] and "435-441" is [435, 441]; in "12/34" the 12 is a unit
// and the street number is 34; a letter ("12A") is not part of it. null when there is no number.
const rangeOf = (s) => {
  const text = String(s ?? '').replace(/\d+\s*\/\s*(?=\d)/g, '');
  const span = /(\d+)\s*[-–]\s*(\d+)/.exec(text);
  if (span) return [Math.min(Number(span[1]), Number(span[2])), Math.max(Number(span[1]), Number(span[2]))];
  const one = /\d+/.exec(text);
  return one ? [Number(one[0]), Number(one[0])] : null;
};
const stateCodeOf = (result) => Object.entries(STATES).find(([, s]) => s.name.toLowerCase() === String(result.address?.state ?? '').toLowerCase())?.[0] ?? null;
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

// Does the place the geocoder found match the address it was asked about? State must match; then the postcode when
// both give one, or else the suburb; and a street number the geocoder returns must be the one asked for.
export function agreesWith(company, found) {
  const parsed = parseAddress(company.address);
  const state = company.state ?? parsed.state;
  const got = found.address ?? {};
  const reasons = [];
  const gotState = stateCodeOf(found);
  if (state && gotState && state !== gotState) reasons.push(`the geocoder put it in ${gotState}, not ${state}`);
  const postcode = company.postcode ?? parsed.postcode;
  if (postcode && got.postcode && postcode !== got.postcode) {
    const wantSuburb = norm(company.suburb ?? parsed.suburb);
    // The city is left out: a street of the same name in another suburb of the same city ("99 Queen Street, Altona, Melbourne")
    // must not pass as the one in the city centre.
    const gotSuburbs = [got.suburb, got.neighbourhood, got.city_district, got.town, got.village].map(norm).filter(Boolean);
    // A postcode can differ on a boundary: accept it when the suburb names agree.
    if (!(wantSuburb && gotSuburbs.includes(wantSuburb))) reasons.push(`the geocoder's postcode is ${got.postcode}, not ${postcode}`);
  }
  // A building is often one entry for a run of numbers ("435-441"): the number asked for only has to fall within it.
  const wantNumber = rangeOf(parsed.street);
  const gotNumber = rangeOf(got.house_number);
  if (wantNumber && gotNumber && (wantNumber[1] < gotNumber[0] || gotNumber[1] < wantNumber[0])) reasons.push(`the geocoder found number ${got.house_number}, not ${parsed.street.split(' ')[0]}`);
  return { agrees: reasons.length === 0, reasons };
}

// What to do with an answer, for a company that has coordinates or none. Never writes anything.
//   skip      the answer does not settle the question (a street or suburb for an address, nothing found)
//   conflict  the geocoder disagrees with the address or with the point on file: a person should look
//   place     the company has no point (or only a city centre nothing has checked) and the geocoder gave one worth using
//   confirm   the point on file is the same place (within AGREE_METRES): the geocoder's point replaces it
//   agrees    the point on file is the geocoder's own, give or take SAME_POINT_METRES (or, for a suburb, anywhere inside
//             the suburb's reach): nothing to change
// A pin on a city centre that no source has checked is a fallback, not a place somebody knew: it is no evidence against
// the geocoder, and the geocoder's point takes its place (the audit trail keeps what it was).
export function decide(company, question, row) {
  if (row.status !== 'found') return { action: 'skip', reason: row.status === 'none' ? 'the geocoder knows nothing of that address' : 'the geocoder could not be asked' };
  const found = row.result;
  const needed = question.wants;
  const rank = ['region', 'city', 'suburb', 'street', 'house'];
  if (rank.indexOf(row.quality) < rank.indexOf(needed)) return { action: 'skip', reason: `the geocoder found only the ${row.quality}, not the ${needed}` };
  const check = agreesWith(company, found);
  if (!check.agrees) return { action: 'conflict', reason: check.reasons.join('; '), found };
  const pinned = Number.isFinite(company.lat) && Number.isFinite(company.lng);
  const limit = question.kind === 'address' ? AGREE_METRES : SUBURB_AGREE_METRES;
  const away = pinned ? Math.round(distanceMetres(company.lat, company.lng, found.lat, found.lng)) : null;
  // A pin the geocoder agrees with to the metre is where the address is, wherever that is; one that only sits on a city
  // centre, with nothing behind it, is the fallback.
  const fallback = pinned && away > SAME_POINT_METRES && company.location_verified_at == null && centreAt(company.lat, company.lng, CENTRE_METRES) != null;
  const has = pinned && !fallback;
  if (!has) {
    // With no point on file to compare against, the answer is checked against the city the record names: a street of
    // the same name on the other side of the country is not it.
    const city = company.city && !/^unknown$/i.test(company.city) ? company.city : null;
    const km = city ? kmFromCity(found.lat, found.lng, city, company.state ?? parseAddress(company.address).state) : null;
    if (km != null && km > MAX_KM_FROM_CITY) return { action: 'conflict', reason: `the geocoder puts it ${Math.round(km)} km from ${city}`, found, away: null };
    return { action: 'place', found, away: null };
  }
  if (away <= SAME_POINT_METRES) return { action: 'agrees', found, away };
  // A suburb's centre is where the geocoder puts the whole suburb: a point already inside it (a campus, a building)
  // is at least as good, so it is left where it is.
  if (question.kind !== 'address' && away <= limit) return { action: 'agrees', found, away };
  if (away <= limit) return { action: 'confirm', found, away };
  return { action: 'conflict', reason: `the point on file is ${away >= 1000 ? `${(away / 1000).toFixed(1)} km` : `${away} m`} from where the geocoder puts the address`, found, away };
}

// What the cache says about a company's location, without asking anyone and ignoring how old the answer is:
// { question, row, decision } or null when nothing was ever asked about it. Used to show whether the geocoder and the
// record agree, and to count a record whose address the geocoder places somewhere else.
export function cachedVerdict(company, cacheRows) {
  const question = questionFor(company);
  if (!question) return null;
  const id = `${PROVIDER}:${normalizeQuery(question.query)}`;
  const row = (cacheRows ?? []).find((r) => r.id === id);
  if (!row) return null;
  return { question, row, decision: decide(company, question, row) };
}

export { normalizeQuery };
