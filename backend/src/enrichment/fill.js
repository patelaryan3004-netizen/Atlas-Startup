// Putting a value on a company record. The one place this is done, so the pipeline's fills and a person's
// "apply this suggestion" are the same code with the same checks, and each says exactly what it changed.
//
// Each function changes the record in place and returns the changes as [{ field, from, to }], the shape the
// audit trail stores. The caller runs it on a working copy that is then migrated, validated and written.
import { AU_STATES, deriveState, isStr } from '../models/company.js';
import { storedValue } from '../models/evidence.js';
import { inAustralia } from '../models/audit.js';

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
// A pin needs coordinates, which a website does not give, so a person supplies them.

// Puts a company on the map at a confirmed place. Needs a city, coordinates inside Australia, and a state
// (given, or worked out from the address or the city).
export function confirmLocation(company, { city, address = null, state = null, lat, lng }) {
  if (!isStr(city)) throw new Error('say the city');
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('coordinates are needed to put a company on the map');
  if (!inAustralia(lat, lng)) throw new Error(`${lat}, ${lng} is not in Australia`);
  const addressText = isStr(address) ? address.trim() : company.address ?? '';
  const resolved = state ?? deriveState({ verified: true, address: addressText, city });
  if (!resolved || !AU_STATES.includes(resolved)) throw new Error(`say the state: it could not be worked out from "${addressText || city}"`);
  const before = { city: company.city, lat: company.lat, lng: company.lng, address: company.address ?? null, state: company.state ?? null, verified: company.verified };
  Object.assign(company, {
    city: city.trim(), lat, lng, state: resolved, country: 'Australia', verified: true,
    verification_status: company.verification_status === 'verified' ? 'verified' : 'location_verified',
    ...(isStr(address) ? { address: address.trim() } : {}),
  });
  return ['city', 'lat', 'lng', 'address', 'state', 'verified'].filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(company[k] ?? null))
    .map((field) => ({ field, from: before[field] ?? null, to: company[field] ?? null }));
}

// Takes a company off the map: no confirmed Australian HQ. Its address, if it has one, is kept.
export function unconfirmLocation(company) {
  const before = { city: company.city, lat: company.lat, lng: company.lng, state: company.state ?? null, country: company.country ?? null, verified: company.verified };
  Object.assign(company, { city: 'Unknown', lat: null, lng: null, state: null, country: null, verified: false, verification_status: 'unverified' });
  return Object.keys(before).filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(company[k] ?? null))
    .map((field) => ({ field, from: before[field] ?? null, to: company[field] ?? null }));
}
