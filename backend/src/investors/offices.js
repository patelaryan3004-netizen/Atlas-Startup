// Where an investor's office is, when its own page gives a street address.
//
// An investor's record keeps the cities it has offices in (other_offices, headquarters_city) and, for the offices whose page states one, the street
// address (office_addresses: "Melbourne: 15 Dover St, Cremorne VIC 3121", each with its page in verification_records.json). A point is never typed in:
// it comes from the geocoder's answer to that address (geocode_cache.json, models/geocodeCache.js), judged by the same rules the companies' addresses
// are (geo/geocode.js decide): the street NUMBER found, in the state and the suburb or postcode the address names, and not far from the city the
// office is said to be in. An answer that fails those is no point: the office stays a city, never a guess. This module only reads the cache; the
// investors command asks the geocoder (scripts/investors.js offices --geocode), one question a second.
import { parseOfficeAddress } from '../models/investor.js';
import { questionFor, decide, PROVIDER, normalizeQuery } from '../geo/geocode.js';

// The geocoder's question for an office's address, or null when the entry is not an address a geocoder can be asked about (it needs a street).
export function officeQuestion(entry) {
  const office = parseOfficeAddress(entry);
  if (!office) return null;
  const question = questionFor({ address: office.address, city: office.city });
  return question?.kind === 'address' ? { ...question, office } : null;
}

// What the cache says about one office address, without asking anyone:
//   { office, question, status, point, reason }
//   status  'placed'     the geocoder found the street number where the address says: `point` is { lat, lng, display_name, osm_type, osm_id }
//           'conflict'   it found something that disagrees (the wrong suburb or postcode, the wrong number, far from the city): no point, `reason` says why
//           'unsettled'  it found only the street or the suburb, or nothing: no point
//           'not asked'  the cache has no answer yet
//           'no street'  the entry has no street address to ask about
export function officeVerdict(entry, cacheRows) {
  const question = officeQuestion(entry);
  if (!question) return { office: parseOfficeAddress(entry), question: null, status: 'no street', point: null, reason: 'it is not a street address' };
  const id = `${PROVIDER}:${normalizeQuery(question.query)}`;
  const row = (cacheRows ?? []).find((r) => r.id === id);
  if (!row) return { office: question.office, question, status: 'not asked', point: null, reason: 'the geocoder has not been asked' };
  const decision = decide({ address: question.office.address, city: question.office.city }, question, row);
  if (decision.action === 'place') {
    const { lat, lng, display_name: displayName = null, osm_type: osmType = null, osm_id: osmId = null } = decision.found;
    return { office: question.office, question, status: 'placed', point: { lat, lng, display_name: displayName, osm_type: osmType, osm_id: osmId }, reason: null, found: decision.found };
  }
  if (decision.action === 'conflict') return { office: question.office, question, status: 'conflict', point: null, reason: decision.reason, found: decision.found };
  return { office: question.office, question, status: 'unsettled', point: null, reason: decision.reason };
}

// The offices of one investor, each with its verdict, in the order the record lists them.
export const officesOf = (org, cacheRows) => (org.office_addresses ?? []).map((entry) => ({ entry, ...officeVerdict(entry, cacheRows) }));
