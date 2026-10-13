// Mapbox's Geocoding API, as a second geocoder beside OpenStreetMap's (geo/geocode.js), for the firms' office addresses.
//
// It answers in the same shape the first one does (`search(query)` -> { status, quality, result }), so the cache (models/geocodeCache.js), the
// judging of an answer (decide, agreesWith) and the report of the pins (catalog/institutionPins.js) are the same code for both. What it adds is
// RELEVANCE: Mapbox says how well a match fits the question (0 to 1), and a match under LOW_RELEVANCE is never drawn: it is listed for a
// person to check.
//
// The token comes from the machine (MAPBOX_TOKEN in the environment), never from a file in the project and never printed. Without one the
// geocoder cannot be made, and the caller says so and falls back on OpenStreetMap's.
//
// Mapbox's terms: the ordinary ("temporary") geocoding endpoint is for showing a result, not for keeping it; keeping results needs the permanent
// endpoint, which an account has to have been given. `permanent: true` (MAPBOX_GEOCODING_PERMANENT=1 for the CLI) asks that one. Check which
// your token may do before relying on a cache of these answers.
export const MAPBOX_PROVIDER = 'mapbox';
export const DEFAULT_MAPBOX_URL = 'https://api.mapbox.com';
export const LOW_RELEVANCE = 0.85;
export const MIN_INTERVAL_MS = 120; // well inside Mapbox's 600 requests a minute

// How exactly a Mapbox feature answers, in the cache's words: house (a street number was found), street, suburb, city, region.
export function qualityOf(feature) {
  const types = feature.place_type ?? [];
  const number = houseNumber(feature);
  if (types.includes('address')) return number ? 'house' : 'street';
  if (types.includes('poi')) return number ? 'house' : 'street';
  if (types.some((t) => ['neighborhood', 'locality', 'district'].includes(t))) return 'suburb';
  if (types.includes('place')) return 'city';
  return 'region';
}

// A street number: an address feature carries it as `address`; a point of interest as the front of its address line.
function houseNumber(feature) {
  if (feature.place_type?.includes('address') && feature.address) return String(feature.address);
  const line = feature.properties?.address;
  const m = typeof line === 'string' ? /^\s*(\d+[A-Za-z]?(?:\s*[-–]\s*\d+)?)\b/.exec(line) : null;
  return m ? m[1] : null;
}

const contextOf = (feature, kind) => (feature.context ?? []).find((c) => String(c.id ?? '').startsWith(`${kind}.`));
const STATE_NAMES = { 'AU-NSW': 'New South Wales', 'AU-VIC': 'Victoria', 'AU-QLD': 'Queensland', 'AU-SA': 'South Australia', 'AU-WA': 'Western Australia', 'AU-TAS': 'Tasmania', 'AU-NT': 'Northern Territory', 'AU-ACT': 'Australian Capital Territory' };

// The part of a feature the rest of the code reads, in the keys it knows (the same ones a Nominatim answer is kept under).
export function keep(feature) {
  const [lng, lat] = feature.center ?? feature.geometry?.coordinates ?? [];
  const region = contextOf(feature, 'region');
  const country = contextOf(feature, 'country');
  const place = contextOf(feature, 'place');
  const suburb = contextOf(feature, 'neighborhood') ?? contextOf(feature, 'locality') ?? contextOf(feature, 'district');
  const number = houseNumber(feature);
  const address = {
    house_number: number ?? undefined, road: feature.place_type?.includes('address') ? feature.text : feature.properties?.address?.replace(/^\s*\d+[A-Za-z]?(?:\s*[-–]\s*\d+)?\s*/, '') || undefined,
    suburb: suburb?.text, city: place?.text, state: STATE_NAMES[region?.short_code] ?? region?.text, postcode: contextOf(feature, 'postcode')?.text,
    country_code: String(country?.short_code ?? 'au').toLowerCase(),
  };
  return {
    lat: Number(lat), lng: Number(lng), display_name: feature.place_name ?? null, address: Object.fromEntries(Object.entries(address).filter(([, v]) => v != null && v !== '')),
    relevance: Number.isFinite(feature.relevance) ? feature.relevance : null, accuracy: feature.properties?.accuracy ?? null, mapbox_id: feature.id ?? null, place_type: feature.place_type ?? null,
  };
}

// `fetchImpl`, `now` and `sleep` are injectable so a test never touches the network. Without a token there is no geocoder.
export function createMapboxGeocoder({
  token, fetchImpl = (...args) => fetch(...args), baseUrl = DEFAULT_MAPBOX_URL, permanent = false, minIntervalMs = MIN_INTERVAL_MS, timeoutMs = 20000, now = Date.now,
  sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
} = {}) {
  if (typeof token !== 'string' || token.trim() === '') throw new Error('there is no Mapbox token (set MAPBOX_TOKEN in the environment)');
  let last = 0;
  let stopped = null;
  return {
    provider: MAPBOX_PROVIDER,
    get stopped() { return stopped; },
    async search(query) {
      if (stopped) return { status: 'error', error: stopped };
      const wait = last + minIntervalMs - now();
      if (wait > 0) await sleep(wait);
      last = now();
      const endpoint = permanent ? 'mapbox.places-permanent' : 'mapbox.places';
      // the token is in the address Mapbox asks for; it is never in a message this code makes
      const url = `${baseUrl}/geocoding/v5/${endpoint}/${encodeURIComponent(query)}.json?${new URLSearchParams({ country: 'au', limit: '3', types: 'address,poi', language: 'en', access_token: token })}`;
      let res;
      try {
        res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
      } catch (err) { return { status: 'error', error: `could not reach Mapbox: ${String(err.message).split(token).join('(token)')}` }; }
      if (res.status === 401 || res.status === 403) { stopped = `Mapbox refused the token (${res.status}): check it, and that it may be used for geocoding from a server`; return { status: 'error', error: stopped }; }
      if (res.status === 429) { stopped = 'Mapbox says too many requests (429)'; return { status: 'error', error: stopped }; }
      if (!res.ok) return { status: 'error', error: `Mapbox answered ${res.status}` };
      let body;
      try { body = await res.json(); } catch { return { status: 'error', error: 'Mapbox answered something that is not JSON' }; }
      const found = (body.features ?? []).filter((f) => Array.isArray(f.center ?? f.geometry?.coordinates) && String(contextOf(f, 'country')?.short_code ?? 'au').toLowerCase() === 'au');
      if (!found.length) return { status: 'none' };
      const best = found.reduce((a, b) => ((b.relevance ?? 0) > (a.relevance ?? 0) ? b : a));
      return { status: 'found', quality: qualityOf(best), result: keep(best) };
    },
  };
}
