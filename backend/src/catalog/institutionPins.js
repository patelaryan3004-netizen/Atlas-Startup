// Where the firms' offices go on the map, and which of them must not yet.
//
// An office is drawn only when its place is KNOWN to be that office: a point the owner gave, or a street address the geocoder (the same
// one the companies use, with the same rules, geo/geocode.js) found to the house and in the state it names. Everything else is left off the
// map and said so, never guessed:
//   pin       drawn
//   flagged   the geocoder's answer is not good enough (only a street or a suburb, a different state or postcode, nothing found): not drawn,
//             and listed so the owner can look
//   pending   a street address nobody has asked the geocoder about yet (scripts/institution-pins.js geocode)
//   no_pin    no street address (a city is not an office), so the firm is listed, not drawn
import { questionFor, decide, normalizeQuery, PROVIDER } from '../geo/geocode.js';
import { MAPBOX_PROVIDER, LOW_RELEVANCE } from '../geo/mapbox.js';

// What the map may do with one office. cacheRows: the geocode cache (geocode_cache.json). The answer of Mapbox's geocoder, when there is one,
// is the one used; otherwise OpenStreetMap's. A Mapbox match that fits the address poorly (relevance under LOW_RELEVANCE) is flagged: it is
// not drawn, and the report says how well it fit so a person can check it.
export function judgeOffice(office, cacheRows = []) {
  if (Number.isFinite(office.lat) && Number.isFinite(office.lng)) return { status: 'pin', lat: office.lat, lng: office.lng, how: 'given' };
  const question = questionFor({ address: office.address, city: office.city, state: office.state });
  if (!question) return { status: 'no_pin', reason: 'the office has no address' };
  if (question.kind !== 'address') return { status: 'no_pin', reason: 'no street address: a city is not an office, so the firm is listed and not drawn' };
  const key = normalizeQuery(question.query);
  const row = cacheRows.find((r) => r.id === `${MAPBOX_PROVIDER}:${key}`) ?? cacheRows.find((r) => r.id === `${PROVIDER}:${key}`);
  if (!row) return { status: 'pending', query: question.query };
  const verdict = decide({ address: office.address, state: office.state, city: office.city, lat: null, lng: null }, question, row);
  const relevance = row.provider === MAPBOX_PROVIDER ? row.result?.relevance ?? null : null;
  if (verdict.action === 'place' && relevance != null && relevance < LOW_RELEVANCE) {
    return { status: 'flagged', reason: `Mapbox's relevance for this match is ${relevance.toFixed(2)}, under ${LOW_RELEVANCE}: it may not be this office`, relevance, query: question.query, found: verdict.found };
  }
  if (verdict.action === 'place') return { status: 'pin', lat: verdict.found.lat, lng: verdict.found.lng, how: 'geocoder', query: question.query, ...(relevance != null ? { relevance } : {}) };
  return { status: 'flagged', reason: verdict.reason ?? 'the geocoder\'s answer does not settle the address', query: question.query, found: verdict.found ?? row.result ?? null, ...(relevance != null ? { relevance } : {}) };
}

// The pins for a checked seed (models/institutionSeed.js), and a report of everything that is not a pin.
export function buildInstitutionPins(checked, cacheRows = []) {
  const pins = [];
  const report = { pinned: 0, flagged: [], pending: [], noPin: [], noOffices: [], held: checked.held.length, problems: [...checked.problems] };
  for (const firm of checked.institutions) {
    if (firm.offices.length === 0) { report.noOffices.push(firm.name); continue; }
    firm.offices.forEach((office, n) => {
      const verdict = judgeOffice(office, cacheRows);
      const where = { institution: firm.id, name: firm.name, office: office.label ?? office.address ?? office.city };
      if (verdict.status === 'pin') {
        report.pinned += 1;
        pins.push({
          id: `${firm.id}#${n}`, institution: firm.id, name: firm.name, lat: verdict.lat, lng: verdict.lng, city: office.city, state: office.state,
          place: office.address ?? office.city ?? null, office: office.label, website: firm.website, how: verdict.how,
        });
      } else if (verdict.status === 'flagged') report.flagged.push({ ...where, address: office.address, reason: verdict.reason, found: verdict.found, ...(verdict.relevance != null ? { relevance: verdict.relevance } : {}) });
      else if (verdict.status === 'pending') report.pending.push({ ...where, query: verdict.query });
      else report.noPin.push({ ...where, reason: verdict.reason });
    });
  }
  return { pins, report };
}
