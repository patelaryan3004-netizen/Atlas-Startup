// The location review: which companies' locations a person should look at, and why. Read-only and pure: a dataset and
// a date in, plain objects out. It never changes a company and never proposes a coordinate; each row says what is
// wrong and what to do about it.
//
//   unknown_location            nothing reliable is known of where the company is
//   city_level_only             only the city is known: the suburb and the office address are missing
//   state_level_only            only the state is known
//   suburb_level_only           the suburb is known but not the office
//   address_not_geocoded        a street address is on record but there is no point for it
//   missing_coordinates         the location says it is a point but has none
//   coordinates_on_area_location  a city- or state-level company carries coordinates: a city centre, not the company
//   city_centre_coordinates     a pin sits on a city centre and nothing backs it: a fallback, not an office
//   shared_coordinates          the pin is shared with a company at a different address
//   coordinates_conflict        the point is not in the state, or is far from the city, the record names
//   geocode_disagrees           the geocoder puts the address somewhere else than the pin
//   address_unverified          an address is on record that no source has been checked for
//   stale_location              last checked against a source more than a year ago
//   historical_location         the company is closed, acquired or a subsidiary, so its place may be a past one
//   suburb_in_city_field        the city field holds a suburb ("Richmond"), not a city
//   no_state                    the state is not known
import { parseAddress, deriveBlock, hasPoint, isPointPrecision, PRECISIONS, LOCATION_STALE_DAYS } from './location.js';
import { sameAddress } from './identity.js';
import { lifecycleOf } from './company.js';
import { centreAt, cityCentre, conflictsWithState, kmFromCity, CENTRE_METRES, MAX_KM_FROM_CITY } from '../geo/places.js';
import { cachedVerdict } from '../geo/geocode.js';

const DAY = 86400000;
export { CENTRE_METRES, MAX_KM_FROM_CITY };

export const LOCATION_ISSUES = {
  coordinates_conflict: { severity: 'high', label: 'The point is not where the record says', action: 'Check the address and the city. Re-geocode the address, or correct the city or state.' },
  geocode_disagrees: { severity: 'high', label: 'A geocoder puts the address somewhere else', action: 'Look at the address and at the pin: one is wrong. Correct the address, or move the pin to the geocoded point.' },
  coordinates_on_area_location: { severity: 'high', label: 'A city-level company carries coordinates', action: 'Clear the coordinates (`npm run locations -- normalize`): a city centre is not where the company is.' },
  missing_coordinates: { severity: 'high', label: 'Located as a point but has no coordinates', action: 'Geocode the address (`npm run locations -- geocode`) or lower the precision.' },
  address_not_geocoded: { severity: 'high', label: 'A street address is on record but not plotted', action: 'Geocode it (`npm run locations -- geocode --apply`).' },
  shared_coordinates: { severity: 'medium', label: 'The pin is shared with a company at a different address', action: 'Geocode both addresses: at least one pin is not at its own address.' },
  city_centre_coordinates: { severity: 'medium', label: 'The pin sits on a city centre, backed by nothing', action: 'Find the office address; until then the company is only known to its city.' },
  unknown_location: { severity: 'medium', label: 'Location not known', action: "Look for an Australian address on the company's contact, privacy or terms page. Leave it unknown if there is none." },
  city_level_only: { severity: 'medium', label: 'Only the city is known', action: 'Find the office address (contact, privacy or terms page), then geocode it.' },
  state_level_only: { severity: 'medium', label: 'Only the state is known', action: 'Find the city, and the office address.' },
  historical_location: { severity: 'medium', label: 'The company is closed, acquired or a subsidiary', action: 'Confirm whether the place is still current; take it off the map if the company is gone.' },
  suburb_level_only: { severity: 'low', label: 'Suburb known, office not', action: 'Find the office address for an exact pin.' },
  address_unverified: { severity: 'low', label: 'The address has not been checked against a source', action: "Find the company's own page that states it (the enrichment run reads the usual ones)." },
  stale_location: { severity: 'low', label: 'Last checked against a source over a year ago', action: 'Check the address against the company\'s own page again.' },
  suburb_in_city_field: { severity: 'low', label: 'The city field holds a suburb', action: 'Set the city to the city, and keep the suburb in the suburb field.' },
  no_state: { severity: 'low', label: 'The state is not known', action: 'Set the state from the address.' },
};

// The six counts the Command Center shows beside the precision counts, and the review problems each one is made of.
export const LOCATION_FLAGS = {
  duplicate_coordinates: { label: 'Duplicate coordinates', note: 'a pin shared with a company at a different address', issues: ['shared_coordinates'] },
  city_centroid_coordinates: { label: 'City-centroid coordinates', note: 'coordinates that are a city centre, not a company', issues: ['coordinates_on_area_location', 'city_centre_coordinates'] },
  location_conflicts: { label: 'Location conflicts', note: 'the point is not where the record, or a geocoder, says', issues: ['coordinates_conflict', 'geocode_disagrees'] },
  missing_coordinates: { label: 'Missing coordinates', note: 'a point is expected and there is none', issues: ['missing_coordinates', 'address_not_geocoded'] },
  potentially_stale: { label: 'Potentially stale locations', note: 'last checked over a year ago, or the company has closed or been acquired', issues: ['stale_location', 'historical_location'] },
  unverified_addresses: { label: 'Addresses not checked', note: 'an address no source has been checked for', issues: ['address_unverified'] },
};

// The review problems a filter names: a flag (several problems) or one problem. null for something that is neither.
export const locationFilterCodes = (filter) => LOCATION_FLAGS[filter]?.issues ?? (LOCATION_ISSUES[filter] ? [filter] : null);

const SEVERITY = { high: 0, medium: 1, low: 2 };
const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

// The location fields a company is judged on, with the block derived for a record that predates it.
const viewOf = (c) => (c.location_precision == null ? { ...c, ...deriveBlock(c) } : c);

export function reviewLocations(ds, { asOf = new Date().toISOString() } = {}) {
  const nowMs = Date.parse(asOf);
  const cache = ds.geocode_cache ?? [];
  const list = ds.companies.map(viewOf);

  // Companies that share a point, and which of them share it with a company somewhere else.
  const byPoint = new Map();
  for (const c of list) {
    if (!hasPoint(c) || !isPointPrecision(c.location_precision)) continue;
    const key = `${c.lat},${c.lng}`;
    if (!byPoint.has(key)) byPoint.set(key, []);
    byPoint.get(key).push(c);
  }
  const sharesWithElsewhere = (c) => {
    const group = byPoint.get(`${c.lat},${c.lng}`) ?? [];
    return group.filter((o) => o !== c && !(
      (parseAddress(c.address).streetLevel && parseAddress(o.address).streetLevel && sameAddress(c.address, o.address))
      || (c.location_precision === 'SUBURB' && o.location_precision === 'SUBURB' && same(c.suburb, o.suburb))
    ));
  };

  const rows = [];
  const counts = Object.fromEntries(PRECISIONS.map((p) => [p, 0]));
  const flagged = { duplicate_coordinates: new Set(), city_centroid_coordinates: new Set(), location_conflicts: new Set(), missing_coordinates: new Set(), potentially_stale: new Set(), unverified_addresses: new Set() };

  for (const c of list) {
    const precision = c.location_precision;
    counts[precision] = (counts[precision] ?? 0) + 1;
    const issues = [];
    const add = (code, detail = null) => issues.push({ code, severity: LOCATION_ISSUES[code].severity, label: LOCATION_ISSUES[code].label, action: LOCATION_ISSUES[code].action, detail });
    const parsed = parseAddress(c.address);
    const point = hasPoint(c);
    const located = precision !== 'UNKNOWN';
    const verdict = located ? cachedVerdict(c, cache) : null;
    // The pin is where the geocoder puts the company's own address: whatever else it is near, it is not a fallback.
    const geocoded = verdict?.decision.action === 'agrees';

    if (precision === 'UNKNOWN') add('unknown_location', parsed.text ? `an address on file ("${parsed.text.slice(0, 60)}") is not counted as the company's place` : null);
    if (precision === 'CITY') add('city_level_only');
    if (precision === 'STATE') add('state_level_only');
    if (precision === 'SUBURB') add('suburb_level_only');

    if (located && !point && (isPointPrecision(precision) || parsed.streetLevel)) {
      add(isPointPrecision(precision) ? 'missing_coordinates' : 'address_not_geocoded', isPointPrecision(precision) ? null : parsed.text.slice(0, 80));
      flagged.missing_coordinates.add(c.id);
    }
    if ((precision === 'CITY' || precision === 'STATE') && point) {
      add('coordinates_on_area_location', `${c.lat}, ${c.lng}`);
      flagged.city_centroid_coordinates.add(c.id);
    }
    if (point && isPointPrecision(precision)) {
      const sharing = sharesWithElsewhere(c);
      if (sharing.length) { add('shared_coordinates', `with ${sharing.slice(0, 3).map((o) => o.name).join(', ')}${sharing.length > 3 ? ` and ${sharing.length - 3} more` : ''}`); flagged.duplicate_coordinates.add(c.id); }
      const centre = c.location_verified_at == null && !geocoded ? centreAt(c.lat, c.lng, CENTRE_METRES) : null;
      if (centre) { add('city_centre_coordinates', `${centre.distance} m from the centre of ${centre.city}`); flagged.city_centroid_coordinates.add(c.id); }
      const wrongState = c.state && conflictsWithState(c.lat, c.lng, c.state);
      const km = c.city ? kmFromCity(c.lat, c.lng, c.city, c.state) : null;
      if (wrongState || (km != null && km > MAX_KM_FROM_CITY)) {
        add('coordinates_conflict', wrongState ? `the point is not in ${c.state}` : `the point is ${Math.round(km)} km from ${c.city}`);
        flagged.location_conflicts.add(c.id);
      }
    }
    if (verdict?.decision.action === 'conflict') {
      const { reason, found } = verdict.decision;
      add('geocode_disagrees', found ? `${reason} (the geocoder's point: ${found.lat.toFixed(5)}, ${found.lng.toFixed(5)})` : reason);
      flagged.location_conflicts.add(c.id);
    }
    if (precision === 'EXACT' && c.location_verified_at == null) { add('address_unverified'); flagged.unverified_addresses.add(c.id); }
    if (located && c.location_verified_at != null && nowMs - Date.parse(c.location_verified_at) > LOCATION_STALE_DAYS * DAY) { add('stale_location', `checked ${c.location_verified_at.slice(0, 10)}`); flagged.potentially_stale.add(c.id); }
    const lifecycle = lifecycleOf(c);
    if (located && lifecycle) { add('historical_location', lifecycle); flagged.potentially_stale.add(c.id); }
    if (isPointPrecision(precision) && c.city && !cityCentre(c.city, c.state) && (same(c.city, c.suburb) || same(c.city, parsed.locality))) add('suburb_in_city_field', c.city);
    if (located && !c.state) add('no_state');

    if (issues.length) {
      issues.sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity]);
      rows.push({
        company_id: c.id, name: c.name, city: c.city ?? null, state: c.state ?? null, suburb: c.suburb ?? null, address: c.address ?? null,
        lat: point ? c.lat : null, lng: point ? c.lng : null, precision, source: c.location_source ?? null, source_url: c.location_source_url ?? null,
        verified_at: c.location_verified_at ?? null, confidence: c.location_confidence ?? null, worst: issues[0].severity, issues,
      });
    }
  }
  rows.sort((a, b) => SEVERITY[a.worst] - SEVERITY[b.worst] || b.issues.length - a.issues.length || a.name.localeCompare(b.name));

  const byIssue = {};
  for (const r of rows) for (const i of r.issues) byIssue[i.code] = (byIssue[i.code] ?? 0) + 1;
  return {
    asOf: asOf.slice(0, 10), total: list.length,
    precision: counts,
    flags: Object.fromEntries(Object.entries(flagged).map(([k, set]) => [k, set.size])),
    issues: Object.fromEntries(Object.entries(LOCATION_ISSUES).map(([code, spec]) => [code, { severity: spec.severity, label: spec.label, action: spec.action, count: byIssue[code] ?? 0 }])),
    rows,
  };
}
