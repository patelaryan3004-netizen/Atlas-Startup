// Canonical company model - schema version 2.
//
// startups.json remains the single source of truth for companies. v2 is
// strictly additive: every legacy key (name, sector, sectorFull, city, lat,
// lng, investors, stage, hiring, verified, website, blurb, taskGate, address,
// founders, foundedYear) keeps its name, type and value, so the existing API,
// /directory page and frontend read exactly what they read before.
//
// Unknown stays unknown. New fields default to null (or [] for id lists) and
// are only ever filled from data the record already carries or from a cited
// source - never estimated. The legacy fields encode "unknown" five different
// ways ('' / 'Unknown' / missing key / null / []); those are left as-is in
// storage and normalised to null only in the toCanonical() projection.

import { deriveBlock } from './location.js';

export const SCHEMA_VERSION = 2;

export const COMPANY_STATUSES = ['active', 'acquired', 'defunct', 'subsidiary'];
// unverified: HQ/location not confirmed (legacy verified:false).
// location_verified: an Australian location is confirmed, at address or city
//   level (legacy verified:true - the pin on the map).
// verified: reserved for records whose key fields are confirmed against
//   primary sources by the future verification pipeline.
export const VERIFICATION_STATUSES = ['unverified', 'location_verified', 'verified'];
// Positive evidence only. null means unknown - the legacy `hiring:false`
// cannot tell "checked, not hiring" from "no open roles observed", so it does
// not become 'not_hiring'.
export const HIRING_STATUSES = ['hiring', 'not_hiring'];
export const EMPLOYEE_RANGES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001+'];
export const AU_STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'];

// What kind of document a source is. licensed_dataset and open_dataset are
// structured data we hold a licence for, or that is published for reuse.
export const SOURCE_KINDS = [
  'company_website', 'company_document', 'press', 'investor_post', 'accelerator_profile',
  'directory_listing', 'aggregator', 'user_supplied', 'licensed_dataset', 'open_dataset',
];

// Shared by the dataset and evidence validators.
export const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
export const PARTIAL_DATE_RE = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/;
export const URL_RE = /^https?:\/\/\S+$/;
export const isStr = (v) => typeof v === 'string' && v.trim() !== '';
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Keys that existed before v2. Never renamed, retyped or removed.
export const LEGACY_FIELDS = [
  'name', 'sector', 'sectorFull', 'city', 'lat', 'lng', 'investors', 'stage',
  'hiring', 'verified', 'website', 'blurb', 'taskGate', 'address', 'founders', 'foundedYear',
];

// Keys added by v2, in the order they are written.
//   id            immutable once assigned; the join key for every relationship
//   slug          URL form of the name; may change later, id may not
//   funding_total number, AUD; the sum of recorded rounds (a lower bound)
//   *_ids         references into people.json / investors.json / sources.json
//   suburb, postcode, location_*   how well the company's location is known and where that came from
//                 (see location.js): the headquarters, which the map uses. city, state, country, address, lat
//                 and lng are the rest of it. Other offices are rows in company_locations.json.
// Funding rounds and jobs hold a company_id foreign key instead of a list on
// the company, and news holds company_ids, so volatile rows never force a
// rewrite of this file.
export const ADDED_FIELDS = [
  'id', 'slug', 'logo', 'subsector', 'state', 'country', 'suburb', 'postcode', 'location_precision', 'location_source',
  'location_source_url', 'location_verified_at', 'location_confidence', 'company_status', 'hiring_status',
  'employee_range', 'funding_total', 'last_funding_date', 'last_funding_round',
  'verification_status', 'confidence_score', 'created_at', 'updated_at', 'last_verified_at',
  'founder_ids', 'investor_ids', 'source_ids',
];
const ID_LIST_FIELDS = new Set(['founder_ids', 'investor_ids', 'source_ids']);

export const emptyAddedFields = () =>
  Object.fromEntries(ADDED_FIELDS.map((k) => [k, ID_LIST_FIELDS.has(k) ? [] : null]));

// 'defunct', 'acquired' or 'subsidiary' when the record says so, from company_status
// or, for records not migrated yet, from the stage text.
export function lifecycleOf(c) {
  const stage = c.stage || '';
  if (c.company_status === 'defunct' || /^defunct/i.test(stage)) return 'defunct';
  if (c.company_status === 'acquired' || /^acquired/i.test(stage)) return 'acquired';
  if (c.company_status === 'subsidiary' || /^subsidiary/i.test(stage)) return 'subsidiary';
  return null;
}

// Concepts the long-term model names differently but which already exist under
// a legacy key. Deliberately NOT duplicated in storage: two copies of one fact
// drift. toCanonical() projects them instead.
export const CANONICAL_ALIASES = {
  description: 'blurb',
  latitude: 'lat',
  longitude: 'lng',
  founded_year: 'foundedYear',
};

// A parenthetical is an alias or disambiguator ("Hone (HoneAg)"), so it is
// dropped from the slug to keep ids short and readable.
export function slugify(name) {
  const primary = String(name).replace(/\s*\([^)]*\)/g, '').trim() || String(name);
  return primary
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function uniqueSlug(base, taken) {
  const root = base || 'item';
  if (!taken.has(root)) return root;
  let n = 2;
  while (taken.has(`${root}-${n}`)) n += 1;
  return `${root}-${n}`;
}

// Only cities whose state is unambiguous. Richmond, Carlton, Milton, Deakin
// and Cremorne each exist in several states, so they resolve from the address
// or not at all.
const CITY_STATE = {
  Sydney: 'NSW', 'Sydney (Chippendale)': 'NSW', 'North Sydney': 'NSW', Newcastle: 'NSW', Orange: 'NSW',
  Carwoola: 'NSW', 'Queanbeyan/Jerrabomberra': 'NSW',
  Melbourne: 'VIC',
  Brisbane: 'QLD', 'Gold Coast': 'QLD', Noosa: 'QLD', Yatala: 'QLD', Warana: 'QLD',
  'Bowen Hills': 'QLD', Herston: 'QLD', 'Gindie (nr Emerald)': 'QLD',
  Adelaide: 'SA', Perth: 'WA', Canberra: 'ACT',
};
// The cities whose state is unambiguous: the ones this directory uses as a `city`.
// A suburb ("Haymarket", "Richmond") is not on this list.
export const KNOWN_CITIES = Object.keys(CITY_STATE);
const ADDRESS_STATE = /\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\s+\d{4}\b/;

// state is only derived for records with a confirmed Australian location: an
// unverified record's address may be historical (a defunct company) or belong
// to a secondary office, and asserting a state from it would overstate it.
export function deriveState(record) {
  if (record.verified !== true) return null;
  const fromAddress = ADDRESS_STATE.exec(record.address || '');
  if (fromAddress) return fromAddress[1];
  return CITY_STATE[record.city] ?? null;
}

const STATUS_FROM_STAGE = {
  Acquired: 'acquired',
  Subsidiary: 'subsidiary',
  'Defunct (in administration)': 'defunct',
  'Defunct (in liquidation)': 'defunct',
};

// Fills only keys that are missing or null, from legacy fields already on the
// record. Never overwrites a value, never touches a legacy key.
// evidenceFor(id): the active address and city evidence about a company, each row with its `source`, so a
// location that a company's own page backs is recorded as backed (location.js, deriveBlock).
export function migrateCompanyRecord(record, ids, { evidenceFor = () => [] } = {}) {
  const merged = { ...emptyAddedFields(), ...record };
  if (merged.id == null) merged.id = ids.id;
  if (merged.slug == null) merged.slug = ids.slug;

  if (merged.state == null) merged.state = deriveState(record);
  if (merged.country == null && merged.state != null) merged.country = 'Australia';
  // A record that predates the location fields gets them from what it already holds. One that has them is not touched:
  // from then on they are written by whatever changes the location, never re-derived.
  if (merged.location_precision == null) Object.assign(merged, deriveBlock(merged, { evidence: evidenceFor(merged.id) }));
  if (merged.company_status == null) merged.company_status = STATUS_FROM_STAGE[record.stage] ?? null;
  if (merged.hiring_status == null && record.hiring === true) merged.hiring_status = 'hiring';
  if (merged.verification_status == null) {
    merged.verification_status = record.verified === true ? 'location_verified' : 'unverified';
  }

  const out = {};
  for (const k of Object.keys(merged)) if (!ADDED_FIELDS.includes(k)) out[k] = merged[k];
  for (const k of ADDED_FIELDS) out[k] = merged[k];
  return out;
}

// Record-keeping the public API has no reason to serve: which sources back a
// record, when it was last checked, how far it is trusted. The facts themselves
// stay public. The detail behind them (sources.json, evidence.json) is not
// served by any route. To expose one of these later, remove it here and update
// the test that pins this list.
export const INTERNAL_FIELDS = ['source_ids', 'confidence_score', 'last_verified_at', 'created_at', 'updated_at',
  'location_source', 'location_source_url', 'location_verified_at', 'location_confidence'];

// The public form of a company. What is public about where it is: the level it is known at (location_precision), the
// suburb and postcode, whether the address was checked against a source (location_verified), and coordinates ONLY when
// they are the company's own: a company known only to its city, state or not at all has no coordinates here, so nothing
// that reads a public record can draw it as if it were at a point. (A record that predates the location fields is
// left as it was.)
export function toPublic(company) {
  const out = { ...company };
  for (const key of INTERNAL_FIELDS) delete out[key];
  if (['CITY', 'STATE', 'UNKNOWN'].includes(company.location_precision)) { out.lat = null; out.lng = null; }
  if (company.location_precision != null) out.location_verified = company.location_verified_at != null;
  return out;
}

const unknownToNull = (v) => (v === undefined || v === null || v === '' || v === 'Unknown' ? null : v);

// The long-term model as an API/consumer would see it: snake_case, every field
// present, one representation of unknown (null).
export function toCanonical(c) {
  return {
    id: c.id ?? null,
    name: c.name,
    slug: c.slug ?? null,
    website: unknownToNull(c.website),
    description: unknownToNull(c.blurb),
    logo: c.logo ?? null,
    sector: unknownToNull(c.sector),
    subsector: c.subsector ?? null,
    city: unknownToNull(c.city),
    state: c.state ?? null,
    country: c.country ?? null,
    suburb: c.suburb ?? null,
    postcode: c.postcode ?? null,
    latitude: c.lat ?? null,
    longitude: c.lng ?? null,
    location_precision: c.location_precision ?? null,
    location_source: c.location_source ?? null,
    location_source_url: c.location_source_url ?? null,
    location_verified_at: c.location_verified_at ?? null,
    location_confidence: c.location_confidence ?? null,
    founded_year: c.foundedYear ?? null,
    stage: unknownToNull(c.stage),
    company_status: c.company_status ?? null,
    hiring_status: c.hiring_status ?? null,
    employee_range: c.employee_range ?? null,
    funding_total: c.funding_total ?? null,
    last_funding_date: c.last_funding_date ?? null,
    last_funding_round: c.last_funding_round ?? null,
    verification_status: c.verification_status ?? null,
    confidence_score: c.confidence_score ?? null,
    created_at: c.created_at ?? null,
    updated_at: c.updated_at ?? null,
    last_verified_at: c.last_verified_at ?? null,
    founder_ids: c.founder_ids ?? [],
    investor_ids: c.investor_ids ?? [],
    source_ids: c.source_ids ?? [],
  };
}
