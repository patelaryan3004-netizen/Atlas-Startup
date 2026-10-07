// Where a company is, and how well that is known.
//
// A pin on a map says "the company is here". It should say that only when it is true to the precision the pin
// implies, so every location carries the level it is actually known at:
//
//   EXACT    a public business address (a street address) is on record, and the point is that address
//   SUBURB   the suburb is known but the office's own address is not: the point is the suburb, not the office
//   CITY     only the city is known. No point: the map shows these as a group at the city, never as an office
//   STATE    only the state is known. Likewise a group, at the state
//   UNKNOWN  nothing reliable is known. No pin; the company is still in search and the list
//
// Only EXACT and SUBURB carry coordinates, and only those are drawn as a company's own pin. A city centre is never
// stored as where a company is (see geo/places.js for what city centres are used for).
//
// The fields live on the company (they describe its headquarters, the place the map uses) and are mirrored as one
// HEADQUARTERS row in company_locations, with a row for each other office. The headquarters row is derived from
// the company by the dataset migration, like founder_ids from founders, so the two cannot disagree.
//
// Where a location came from is recorded, best source first. Never used as a source of a location: a person's
// LinkedIn location, where a founder lives, a search snippet, a guess from a postcode. And never a home address:
// only a business address the company itself publishes, or a credible profile states outright.
import { addressParts, sameAddress, cityKey } from './identity.js';
import { AU_STATES, cityCentre, statesAt } from '../geo/places.js';

export const PRECISIONS = ['EXACT', 'SUBURB', 'CITY', 'STATE', 'UNKNOWN'];
// The words a visitor reads (the map, the company panel): "Location: city-level".
export const PRECISION_WORDS = { EXACT: 'exact address', SUBURB: 'suburb-level', CITY: 'city-level', STATE: 'state-level', UNKNOWN: 'unknown' };
// Only these are drawn as a company's own pin, and only these carry coordinates.
export const POINT_PRECISIONS = ['EXACT', 'SUBURB'];
export const CONFIDENCES = ['high', 'medium', 'low'];
export const LOCATION_KINDS = ['HEADQUARTERS', 'OFFICE', 'OTHER'];

// Best first. The first four are the order the project trusts sources in for a location; `manual` is a person
// who confirmed it (and says what from); `directory_record` is the honest label for a record that predates sources.
export const LOCATION_SOURCES = ['company_website', 'company_document', 'credible_profile', 'ecosystem_source', 'manual', 'directory_record'];
export const SOURCE_RANK = { company_website: 1, company_document: 2, credible_profile: 3, manual: 3, ecosystem_source: 4, directory_record: 9 };
const OFFICIAL = new Set(['company_website', 'company_document']);
// Is this where a company says its own place is (its website, a document it publishes), as opposed to someone else's word for it?
export const isOfficialSource = (source) => OFFICIAL.has(source);

// How an evidence source (sources.json kind) maps onto where a location came from.
const SOURCE_FOR_KIND = {
  company_website: 'company_website', company_document: 'company_document',
  accelerator_profile: 'credible_profile', directory_listing: 'credible_profile', press: 'credible_profile',
  investor_post: 'ecosystem_source', aggregator: 'ecosystem_source', open_dataset: 'ecosystem_source', licensed_dataset: 'ecosystem_source',
  user_supplied: 'manual',
};
export const locationSourceFor = (sourceKind) => SOURCE_FOR_KIND[sourceKind] ?? 'ecosystem_source';

// A location older than this, or never checked against a source, is flagged for a person to look at again.
export const LOCATION_STALE_DAYS = 365;

// The active address and city evidence about each company, every row with the source it cites: what backs a location.
// { evidence, sources } -> Map(company id -> rows).
export function locationEvidenceIndex({ evidence = [], sources = [] }) {
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const index = new Map();
  for (const e of evidence) {
    if (e.status !== 'active' || !['address', 'city'].includes(e.field) || !sourceById.has(e.source_id)) continue;
    if (!index.has(e.company_id)) index.set(e.company_id, []);
    index.get(e.company_id).push({ ...e, source: sourceById.get(e.source_id) });
  }
  return index;
}

const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const HTTP = /^https?:\/\/\S+$/;
const known = (v) => isStr(v) && !/^unknown$/i.test(v.trim());

// Hosts that are never a source of where a company is: a person's profile says where a person is.
const NOT_A_SOURCE = ['linkedin.com', 'facebook.com', 'x.com', 'twitter.com', 'instagram.com', 'tiktok.com'];

// Why a source cannot back a location, or null when it can.
export function locationSourceProblem(kind, url) {
  if (kind != null && !LOCATION_SOURCES.includes(kind)) return `"${kind}" is not a kind of location source`;
  if (url == null) return null;
  if (!HTTP.test(url)) return 'the source address must be an http(s) link';
  let host;
  try { host = new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return 'the source address is not a valid link'; }
  if (NOT_A_SOURCE.some((d) => host === d || host.endsWith(`.${d}`))) return `${host} says where a person is, not where the company is`;
  return null;
}

// ---------- reading an address ----------

const UNIT = [
  /^(?:level|lvl|suite|ste|unit|floor|fl|shop|studio|l)\s*[\w.]+\s*[/,-]\s*/i,
  /^(?:level|lvl|suite|ste|unit|floor|fl|shop|studio)\s+\w+\s+(?=\d)/i,
  /^\d+(?:\.\d+)?[a-z]?\s*\/\s*(?=\d)/i,
];
const STREET_WORD = /\b(?:street|st|road|rd|avenue|ave|av|lane|ln|place|pl|parade|pde|drive|dr|court|ct|boulevard|blvd|highway|hwy|terrace|tce|crescent|cres|square|sq|way|close|circuit|cct|esplanade|esp)\b\.?/i;
const UNITLIKE = /^(?:level|lvl|suite|ste|unit|floor|fl|shop|studio|l)\b/i;
const STATE_POSTCODE = new RegExp(`\\b(${AU_STATES.join('|')})\\b[\\s,]*(\\d{4})\\b`);
// A place name that is a building or an institution, not a suburb: "Wade Institute", "Macquarie University Cyber Hub".
const PREMISES = /\b(?:university|institute|hub|centre|center|campus|labs?|laborator(?:y|ies)|building|tower|house|foundry|precinct|incubator|accelerator|innovation|school|college|hospital|studios?|works|exchange|headquarters|hq)\b/i;
// "Richmond, Victoria 3121": a state written out in full at the end ("33 Victoria Street" is left alone).
const STATE_FULL = { 'new south wales': 'NSW', victoria: 'VIC', queensland: 'QLD', 'south australia': 'SA', 'western australia': 'WA', tasmania: 'TAS', 'northern territory': 'NT', 'australian capital territory': 'ACT' };
const FULL_STATE_AT_END = new RegExp(`\\b(${Object.keys(STATE_FULL).join('|')})\\b(?=[\\s,]*(?:\\d{4}\\b|$))`, 'i');

// The street line of an address as written ("110 Kippax Street"), with the unit, level and building left out, or null.
export function streetLine(address) {
  for (const part of String(address ?? '').replace(/\([^)]*\)/g, ' ').split(/[,;\n]+/)) {
    let p = part.replace(/[–—]/g, '-').trim();
    for (const re of UNIT) p = p.replace(re, '');
    if (/^\d/.test(p) && STREET_WORD.test(p)) return p.replace(/\s+/g, ' ').trim();
  }
  return null;
}

// What an address says, no more. { text, streetLevel, street, suburb, locality, localityIsCity, state, postcode }.
//   streetLevel  there is a street (a number and a street word): the address names a place, not just an area
//   locality     the last place name in it ("Sydney" in "110 Kippax Street, Surry Hills, Sydney NSW 2010")
//   suburb       the place name before it when there is one ("Surry Hills"), else the locality
// A parenthetical ("(Sydney office; global HQ in Singapore)") is a note, not part of the address.
export function parseAddress(address) {
  const text = String(address ?? '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim().replace(/[\s.,;]+$/, '')
    .replace(/,?\s*Australia$/i, '').replace(FULL_STATE_AT_END, (m) => STATE_FULL[m.toLowerCase()]);
  const out = { text, streetLevel: false, street: null, suburb: null, locality: null, localityIsCity: false, state: null, postcode: null };
  if (!text) return out;
  const sp = STATE_POSTCODE.exec(text);
  let head = text;
  if (sp) { out.state = sp[1]; out.postcode = sp[2]; head = text.slice(0, sp.index); } else {
    const state = new RegExp(`\\b(${AU_STATES.join('|')})\\b`).exec(text);
    if (state) { out.state = state[1]; head = text.slice(0, state.index); }
    const pc = /\b(\d{4})\s*$/.exec(head);
    if (pc) { out.postcode = pc[1]; head = head.slice(0, pc.index); }
  }
  out.street = streetLine(text);
  out.streetLevel = out.street != null && addressParts(text)?.street != null;
  const parts = head.split(/[,;]+/).map((p) => p.trim()).filter(Boolean);
  const placeLike = (p) => !/\d/.test(p) && !UNITLIKE.test(p) && !STREET_WORD.test(p);
  let at = parts.length - 1;
  while (at >= 0 && !placeLike(parts[at])) at -= 1;
  if (at >= 0) {
    out.locality = parts[at];
    out.localityIsCity = cityCentre(out.locality, out.state) != null;
    // "Surry Hills, Sydney NSW 2010": when the last place name is a city, the one before it is the suburb. When it is
    // not ("UNSW Innovation Hub, Kensington NSW 2052") the last one is the suburb and what is before it is a building.
    const before = at >= 1 ? parts[at - 1] : null;
    out.suburb = out.localityIsCity && before && placeLike(before) && !PREMISES.test(before) && before.toLowerCase() !== out.locality.toLowerCase() ? before : out.locality;
  }
  return out;
}

// Is the suburb an address names really the city ("Sydney NSW 2000", a CBD street address)? Then it says no more than the city does.
export const suburbIsCity = (parsed) => parsed.suburb != null && cityCentre(parsed.suburb, parsed.state) != null;

// ---------- the block of fields ----------

// The fields a location is made of on a company, in the order they are written.
export const LOCATION_FIELDS = ['address', 'suburb', 'city', 'state', 'country', 'postcode', 'lat', 'lng',
  'location_precision', 'location_source', 'location_source_url', 'location_verified_at', 'location_confidence'];
// The ones the migration adds (the first six are older: legacy fields and `state`/`country`).
export const LOCATION_ADDED = ['suburb', 'postcode', 'location_precision', 'location_source', 'location_source_url', 'location_verified_at', 'location_confidence'];

export const hasPoint = (c) => isNum(c.lat) && isNum(c.lng);
export const isPointPrecision = (precision) => POINT_PRECISIONS.includes(precision);

// How sure we are that a location is at the level it claims: a company's own page beats a profile, a source that
// was read beats a record nobody can trace, and a geocoder agreeing with the address adds to either. HIGH needs all
// three: an official source, read, and a geocoder that finds the same place.
export function confidenceFor({ source = null, verified = false, geocodeAgrees = false } = {}) {
  if (source == null) return null;
  const base = OFFICIAL.has(source) ? 2 : source === 'credible_profile' || source === 'manual' ? 1.5 : source === 'ecosystem_source' ? 0.5 : 0;
  const score = base + (verified ? 1 : 0) + (geocodeAgrees ? 1 : 0);
  return score >= 3.5 ? 'high' : score >= 1.5 ? 'medium' : 'low';
}

// The block a record without one should carry, worked out from what it already holds and the evidence about it.
// It states only what the record can support:
//   - not confirmed in Australia            -> UNKNOWN
//   - a street address and a point          -> EXACT (backed, if an official page states the same address)
//   - a place name and a point              -> SUBURB
//   - a known city                          -> CITY (its coordinates, if any, were not a company's own: they are
//                                              a city centre or a guess, and are left for the audit to clear)
//   - only a state                          -> STATE
// `evidence`: the active address/city evidence rows for the company, with `source` ({ kind, url }) attached.
export function deriveBlock(record, { evidence = [] } = {}) {
  const none = { suburb: null, postcode: null, location_precision: 'UNKNOWN', location_source: null, location_source_url: null, location_verified_at: null, location_confidence: null };
  if (record.verified !== true) return none;
  const parsed = parseAddress(record.address);
  const point = hasPoint(record);
  const cityKnown = known(record.city);
  const stateKnown = AU_STATES.includes(record.state);

  let precision;
  if (parsed.streetLevel && point) precision = 'EXACT';
  else if (point && parsed.suburb && !suburbIsCity(parsed)) precision = 'SUBURB';
  else if (cityKnown) precision = 'CITY';
  else if (stateKnown) precision = 'STATE';
  else precision = 'UNKNOWN';
  if (precision === 'UNKNOWN') return none;

  const suburb = parsed.suburb;
  const postcode = parsed.postcode;
  // Evidence that backs what the record says: an active row stating the same address (or, with no address, the same city).
  const backing = evidence.filter((e) => e.source && (record.address ? e.field === 'address' && sameAddress(record.address, e.value) : e.field === 'city' && cityKey(e.value) === cityKey(record.city)));
  const best = [...backing].sort((a, b) => SOURCE_RANK[locationSourceFor(a.source.kind)] - SOURCE_RANK[locationSourceFor(b.source.kind)] || String(b.verified_at ?? '').localeCompare(String(a.verified_at ?? '')))[0];
  const source = best ? locationSourceFor(best.source.kind) : 'directory_record';
  const verifiedAt = best?.verified_at ?? null;
  return {
    suburb: precision === 'EXACT' || precision === 'SUBURB' ? suburb : null,
    postcode: precision === 'EXACT' || precision === 'SUBURB' ? postcode : null,
    location_precision: precision, location_source: source, location_source_url: best?.source.url ?? null,
    location_verified_at: verifiedAt, location_confidence: confidenceFor({ source, verified: verifiedAt != null }),
  };
}

// ---------- checks ----------

// The rules every location obeys, on a company (flat fields) or a row (latitude/longitude). Returns messages.
// `view`: { precision, verified?, address, suburb, city, state, country, postcode, lat, lng, source, url, verifiedAt, confidence }
export function locationProblems(view) {
  const out = [];
  const p = view.precision;
  if (!PRECISIONS.includes(p)) return [`location_precision must be one of ${PRECISIONS.join(', ')}`];
  if (view.verified !== undefined && (view.verified === true) !== (p !== 'UNKNOWN')) out.push('verified and location_precision disagree: a located company is not UNKNOWN, an unlocated one is');
  const point = hasPoint(view);
  if ((view.lat != null) !== (view.lng != null)) out.push('lat and lng must both be set or both null');
  if (isPointPrecision(p) && !point) out.push(`a ${p} location needs coordinates`);
  if (p === 'UNKNOWN' && (view.lat != null || view.lng != null)) out.push('an UNKNOWN location must not carry coordinates');
  if (p === 'EXACT' && !isStr(view.address)) out.push('an EXACT location needs the address it is');
  if (p === 'SUBURB' && !isStr(view.suburb)) out.push('a SUBURB location needs the suburb');
  if (p === 'CITY' && !known(view.city)) out.push('a CITY location needs the city');
  if (p === 'STATE' && !AU_STATES.includes(view.state)) out.push('a STATE location needs the state');
  if (point && statesAt(view.lat, view.lng).length === 0) out.push('the coordinates are not in Australia');
  if (view.postcode != null && !/^\d{4}$/.test(view.postcode)) out.push('postcode must be four digits');
  if (view.suburb != null && !isStr(view.suburb)) out.push('suburb must be text');
  if (p === 'UNKNOWN') {
    for (const [k, v] of [['source', view.source], ['source address', view.url], ['verified time', view.verifiedAt], ['confidence', view.confidence]]) if (v != null) out.push(`an UNKNOWN location has no ${k}`);
  } else {
    if (view.source != null && !LOCATION_SOURCES.includes(view.source)) out.push(`location_source must be one of ${LOCATION_SOURCES.join(', ')}`);
    const bad = locationSourceProblem(view.source, view.url);
    if (bad) out.push(bad);
    if (view.verifiedAt != null && !ISO.test(view.verifiedAt)) out.push('location_verified_at must be an ISO-8601 UTC timestamp or null');
    if (view.verifiedAt != null && view.source == null) out.push('a verified location must say where it came from');
    if (view.confidence != null && !CONFIDENCES.includes(view.confidence)) out.push(`location_confidence must be one of ${CONFIDENCES.join(', ')}`);
  }
  return out;
}

// The checks above, run on a company record.
export const companyLocationProblems = (c) => locationProblems({
  precision: c.location_precision, verified: c.verified, address: c.address, suburb: c.suburb, city: c.city, state: c.state, country: c.country,
  postcode: c.postcode, lat: c.lat, lng: c.lng, source: c.location_source, url: c.location_source_url, verifiedAt: c.location_verified_at, confidence: c.location_confidence,
});

// ---------- the company_locations relationship ----------

const ROW_FIELDS = ['address', 'suburb', 'city', 'state', 'country', 'postcode', 'latitude', 'longitude',
  'location_precision', 'location_source', 'location_source_url', 'location_verified_at', 'location_confidence'];

// The headquarters row for a company: its own location block, as a row. Derived, never edited (edit the company).
export function hqRowFor(c) {
  return {
    id: `${c.id}.hq`, company_id: c.id, kind: 'HEADQUARTERS', label: null,
    address: c.location_precision !== 'UNKNOWN' && isStr(c.address) ? c.address : null, suburb: c.suburb ?? null, city: known(c.city) ? c.city : null, state: c.state ?? null, country: c.country ?? null,
    postcode: c.postcode ?? null, latitude: c.lat ?? null, longitude: c.lng ?? null,
    location_precision: c.location_precision ?? 'UNKNOWN', location_source: c.location_source ?? null, location_source_url: c.location_source_url ?? null,
    location_verified_at: c.location_verified_at ?? null, location_confidence: c.location_confidence ?? null,
    created_at: c.created_at ?? null, updated_at: c.updated_at ?? null,
  };
}

export const rowProblems = (r) => locationProblems({
  precision: r.location_precision, address: r.address, suburb: r.suburb, city: r.city, state: r.state, country: r.country, postcode: r.postcode,
  lat: r.latitude, lng: r.longitude, source: r.location_source, url: r.location_source_url, verifiedAt: r.location_verified_at, confidence: r.location_confidence,
});

export function validateLocationRows(ds) {
  const errors = [];
  const bad = (where, msg) => errors.push(`${where}: ${msg}`);
  const companies = new Map(ds.companies.map((c) => [c.id, c]));
  const seen = new Set();
  const heads = new Set();
  for (const r of ds.company_locations ?? []) {
    const at = `company_location "${r.id}"`;
    if (!isStr(r.id)) { bad(at, 'needs an id'); continue; }
    if (seen.has(r.id)) bad(at, 'duplicate id');
    seen.add(r.id);
    const company = companies.get(r.company_id);
    if (!company) { bad(at, `unknown company_id "${r.company_id}"`); continue; }
    if (!LOCATION_KINDS.includes(r.kind)) bad(at, `kind must be one of ${LOCATION_KINDS.join(', ')}`);
    for (const key of ROW_FIELDS) if (!(key in r)) bad(at, `missing field "${key}"`);
    for (const m of rowProblems(r)) bad(at, m);
    if (r.kind === 'HEADQUARTERS') {
      if (heads.has(r.company_id)) bad(at, 'a company has one headquarters');
      heads.add(r.company_id);
      const derived = hqRowFor(company);
      for (const key of ROW_FIELDS) if (JSON.stringify(r[key] ?? null) !== JSON.stringify(derived[key] ?? null)) bad(at, `"${key}" differs from the company's own (the headquarters row mirrors the company: edit the company)`);
    } else if (r.location_precision === 'UNKNOWN') bad(at, 'an office that is not located is not a row: leave it out');
  }
  return errors;
}

// How a company's place reads in a sentence about publishing it ("Published Acme as acme (on the map)").
export const PUBLISHED_AS = {
  EXACT: 'on the map', SUBURB: 'on the map, at its suburb', CITY: 'city-level: a group in its city, not a pin', STATE: 'state-level: a group in its state, not a pin',
  UNKNOWN: 'unconfirmed location: listed, not on the map',
};

// What a visitor is told about where a company is: the words on the map's tooltip and the company panel. Pure, so the
// server and the tests agree on it. place: the line naming where; quality: how well it is known.
export function describeLocation(c) {
  const precision = c.location_precision ?? 'UNKNOWN';
  const verified = c.location_verified === true || c.location_verified_at != null; // the public record says it as a flag, the stored one as a date
  const city = known(c.city) ? c.city : null;
  const state = c.state ?? null;
  const where = [city, state].filter(Boolean).join(', ');
  if (precision === 'EXACT') {
    const street = streetLine(c.address);
    return { precision, place: [street, c.suburb && c.suburb !== city ? c.suburb : null, city].filter(Boolean).join(', ') || where, quality: verified ? 'Verified office' : 'Office address on file' };
  }
  if (precision === 'SUBURB') return { precision, place: [c.suburb, city && c.suburb !== city ? city : null].filter(Boolean).join(', ') || where, quality: 'Location: suburb-level' };
  if (precision === 'CITY') return { precision, place: where, quality: 'Location: city-level' };
  if (precision === 'STATE') return { precision, place: state, quality: 'Location: state-level' };
  return { precision: 'UNKNOWN', place: null, quality: 'Location unknown' };
}
