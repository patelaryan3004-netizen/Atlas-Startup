// Putting a value on a company record. The one place this is done, so the pipeline's fills and a person's
// "apply this suggestion" are the same code with the same checks, and each says exactly what it changed.
//
// Each function changes the record in place and returns the changes as [{ field, from, to }], the shape the
// audit trail stores. The caller runs it on a working copy that is then migrated, validated and written.
import { AU_STATES, deriveState, isStr } from '../models/company.js';
import { storedValue } from '../models/evidence.js';
import { inAustralia } from '../models/audit.js';
import { PRECISIONS, parseAddress, suburbIsCity, confidenceFor, locationSourceProblem } from '../models/location.js';

const unique = (list) => [...new Set(list)];

// Does the record leave this field unknown? The legacy hiring:false cannot say "checked, not hiring" (it is
// also what a company nobody has looked at carries), so with no hiring_status it counts as unknown.
export function isUnknown(company, field) {
  if (field === 'hiring_status') return company.hiring_status == null && company.hiring !== true;
  return storedValue(company, field) == null;
}

// One field's change on the record. `value` is one value, or a list of members for founders and investors.
const SETTERS = {
  description: (c, v) => [['blurb', c.blurb, v]],
  founded_year: (c, v) => [['foundedYear', c.foundedYear ?? null, v]],
  website: (c, v) => [['website', c.website, v]],
  stage: (c, v) => [['stage', c.stage, v]],
  last_funding_round: (c, v) => [['last_funding_round', c.last_funding_round ?? null, v]],
  last_funding_date: (c, v) => [['last_funding_date', c.last_funding_date ?? null, v]],
  funding_total: (c, v) => [['funding_total', c.funding_total ?? null, v.amount]],
  company_status: (c, v) => [['company_status', c.company_status ?? null, v]],
  employee_range: (c, v) => [['employee_range', c.employee_range ?? null, v]],
  sector: (c, v) => [['sector', c.sector, v], ...(isStr(c.sectorFull) && c.sectorFull !== 'Unknown' ? [] : [['sectorFull', c.sectorFull, v]])],
  founders: (c, v) => [['founders', c.founders ?? [], unique([...(c.founders ?? []), ...[].concat(v)])]],
  investors: (c, v) => [['investors', c.investors ?? [], unique([...(c.investors ?? []), ...[].concat(v)])]],
  hiring_status: (c, v) => (v === 'hiring'
    ? [['hiring', c.hiring, true], ['hiring_status', c.hiring_status ?? null, 'hiring']]
    : [['hiring', c.hiring, false], ['hiring_status', c.hiring_status ?? null, v]]),
};

export const FILLABLE = Object.keys(SETTERS);

export function setField(company, field, value) {
  const set = SETTERS[field];
  if (!set) throw new Error(`"${field}" is not a field that can be applied to a record this way`);
  const changes = [];
  for (const [key, from, to] of set(company, value)) {
    company[key] = to;
    changes.push({ field: key, from, to });
  }
  return changes;
}

// ---------- location ----------
// A pin needs coordinates, which a website does not give, so they come from a person or from a geocoder
// (geo/geocode.js); how well the place is known is then recorded with it (models/location.js).

const LOCATION_KEYS = ['city', 'suburb', 'postcode', 'lat', 'lng', 'address', 'state', 'verified', 'location_precision', 'location_source',
  'location_source_url', 'location_verified_at', 'location_confidence'];
const changesBetween = (before, company) => LOCATION_KEYS.filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(company[k] ?? null))
  .map((field) => ({ field, from: before[field] ?? null, to: company[field] ?? null }));

// Records where a company is, at the precision given or worked out, and puts it on the map to that precision:
//   an address with a street and a point  -> EXACT      the pin is that address
//   a suburb and a point                  -> SUBURB     the pin is the suburb, drawn as approximate
//   a city (no point)                     -> CITY       a group at the city, never a pin
//   only a state                          -> STATE      a group at the state
// A city or a state carries no coordinates: a city centre is not where a company is. Coordinates given without an
// address or a suburb are not a pin either, so that is an error, not a guess.
// source and sourceUrl say where the place came from (default: a person confirmed it); verifiedAt is when it was
// checked against that source (default: `at`, now, for a person's confirmation).
export function confirmLocation(company, input, { at = null } = {}) {
  const { city, address = null, suburb = null, state = null, postcode = null, lat, lng, precision = null, source = 'manual', sourceUrl = null, confidence = null, geocodeAgrees = false } = input;
  if (precision != null && !PRECISIONS.includes(precision)) throw new Error(`the precision must be one of ${PRECISIONS.join(', ')}`);
  if (precision === 'UNKNOWN') throw new Error('to say a place is not known, take the company off the map instead');
  const addressText = isStr(address) ? address.trim() : company.address ?? '';
  const parsed = parseAddress(addressText);
  const point = Number.isFinite(lat) && Number.isFinite(lng);
  if (point && !inAustralia(lat, lng)) throw new Error(`${lat}, ${lng} is not in Australia`);
  const place = isStr(suburb) ? suburb.trim() : parsed.suburb;
  const suburbIsReal = place != null && !suburbIsCity({ suburb: place, state: state ?? parsed.state });

  let level = precision;
  if (level == null) {
    if (parsed.streetLevel && point) level = 'EXACT';
    else if (point && suburbIsReal) level = 'SUBURB';
    else if (point) throw new Error('coordinates need an address (an exact location) or a suburb (a suburb-level one); without either, leave them out and the location is city-level');
    else level = isStr(city) && city.trim().toLowerCase() !== 'unknown' ? 'CITY' : 'STATE';
  }
  if ((level === 'EXACT' || level === 'SUBURB') && !point) throw new Error(`a ${level} location needs coordinates`);
  if (level === 'EXACT' && !isStr(addressText)) throw new Error('an exact location needs the address');
  if (level === 'SUBURB' && !isStr(place)) throw new Error('a suburb-level location needs the suburb');
  if (level !== 'STATE' && !isStr(city)) throw new Error('say the city');

  const resolved = state ?? parsed.state ?? deriveState({ verified: true, address: addressText, city });
  if (!resolved || !AU_STATES.includes(resolved)) throw new Error(`say the state: it could not be worked out from "${addressText || city}"`);
  const bad = locationSourceProblem(source, sourceUrl);
  if (bad) throw new Error(bad);

  const verifiedAt = input.verifiedAt === undefined ? at : input.verifiedAt;
  const before = Object.fromEntries(LOCATION_KEYS.map((k) => [k, company[k]]));
  const points = level === 'EXACT' || level === 'SUBURB';
  Object.assign(company, {
    city: isStr(city) ? city.trim() : 'Unknown', state: resolved, country: 'Australia', verified: true,
    verification_status: company.verification_status === 'verified' ? 'verified' : 'location_verified',
    lat: points ? lat : null, lng: points ? lng : null,
    ...(isStr(address) ? { address: address.trim() } : {}),
    suburb: points ? place : null, postcode: points ? postcode ?? parsed.postcode : null,
    location_precision: level, location_source: source, location_source_url: sourceUrl, location_verified_at: verifiedAt,
    location_confidence: confidence ?? confidenceFor({ source, verified: verifiedAt != null, geocodeAgrees }),
  });
  return changesBetween(before, company);
}

// Takes a company off the map: no confirmed Australian HQ. Its address, if it has one, is kept.
export function unconfirmLocation(company) {
  const before = Object.fromEntries([...LOCATION_KEYS, 'country'].map((k) => [k, company[k]]));
  Object.assign(company, {
    city: 'Unknown', lat: null, lng: null, state: null, country: null, verified: false, verification_status: 'unverified',
    suburb: null, postcode: null, location_precision: 'UNKNOWN', location_source: null, location_source_url: null, location_verified_at: null, location_confidence: null,
  });
  return [...changesBetween(before, company), ...(before.country != null ? [{ field: 'country', from: before.country, to: null }] : [])];
}
