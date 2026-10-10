// Field-level provenance for the investor layer: which page says what about which investor.
//
//   sources.json               a document at a URL (the same file the company evidence uses)
//   verification_records.json  one claim a source makes about one field of an investor, a person or a fund
//                              { id, subject_type, subject_id, field, value, source_id, confidence, verified_at, status, note }
//
// It follows evidence.js, which does the same for companies, and keeps its rules:
//   - a record is a claim, never a change: it is compared with what the investor's record says and with other records, and a
//     disagreement is reported (detectInvestorConflicts), never settled by the code;
//   - a claim a person has turned down is `rejected`, one replaced by newer information is `superseded`, both with a note, and
//     neither is ever deleted;
//   - `high` confidence needs verified_at, and verified_at needs a source somebody actually retrieved.
// And adds one: an active record states what the page SAYS (`note`), in its own words, so a reader can check the claim
// against the page without trusting the person who recorded it.
//
// What this is for: a record cannot be verified or published while a claim it makes has no active record behind it
// (claimsWithoutRecords). Unknown stays null; a stated stage, sector, thesis, cheque size, location or type has a page.
//
// An investment and a team role are relationships, and each is its own provenance (investorGraph.js: a source_id and the
// words the page uses sit on the row), so they have no row here.
import { ISO_RE, isStr, isNum } from './company.js';
import { CONFIDENCE_LEVELS, EVIDENCE_STATUSES, checkValue } from './evidence.js';
import {
  INVESTOR_TYPES, INVESTOR_STAGES, INCLUSION_BASES, LEAD_OR_FOLLOW, ACTIVE_STATUSES, CHECKED_STATUSES, CLAIM_FIELDS, claimValue,
} from './investor.js';

const single = (type, extra = {}) => ({ cardinality: 'single', type, ...extra });
const multi = (type, extra = {}) => ({ cardinality: 'multi', type, ...extra });
const text = () => ({ cardinality: 'text', type: 'string' });

// single  one true value at a time: two different active values are a conflict
// multi   each record asserts ONE member of a list, so records add up and never conflict
// text    free text: records coexist and are never compared with each other (but the record's own text must be one of them)
export const RECORD_FIELDS = {
  investor_organisation: {
    name: single('string'),
    website: single('url'),
    investor_type: single('enum', { values: Object.keys(INVESTOR_TYPES) }),
    inclusion_basis: single('enum', { values: INCLUSION_BASES }),
    headquarters_city: single('string'),
    state: single('state'),
    country: single('string'),
    other_offices: multi('string'),
    stages: multi('enum', { values: INVESTOR_STAGES }),
    sectors: multi('string'),
    geographies: multi('string'),
    typical_cheque: single('cheque'),
    lead_or_follow: single('enum', { values: LEAD_OR_FOLLOW }),
    active_status: single('enum', { values: ACTIVE_STATUSES }),
    application_url: single('url'),
    jobs_url: single('url'),
    description: text(),
    investment_thesis: text(),
  },
  investor_person: {
    location: single('string'),
    biography: text(),
    sector_focus: multi('string'),
    stage_focus: multi('enum', { values: INVESTOR_STAGES }),
    previous_companies: multi('string'),
    previous_investor_organisations: multi('string'),
    linkedin_url: single('url'),
    personal_website: single('url'),
  },
  fund: {
    vintage_year: single('year'),
    size: single('money'),
    stage_focus: multi('enum', { values: INVESTOR_STAGES }),
    sector_focus: multi('string'),
    active_status: single('enum', { values: ACTIVE_STATUSES }),
  },
};
export const SUBJECT_TYPES = Object.keys(RECORD_FIELDS);
const COLLECTION_OF = { investor_organisation: 'investors', investor_person: 'investor_people', fund: 'funds' };
export const subjectsOf = (ds, subjectType) => ds[COLLECTION_OF[subjectType]] ?? [];

// ---------- comparing values ----------

const textKey = (v) => String(v).toLowerCase().replace(/\s+/g, ' ').trim();
function urlKey(v) {
  try {
    const u = new URL(v);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch { return textKey(v); }
}

export function valuesEqualFor(spec, a, b) {
  if (a == null || b == null) return a == null && b == null;
  switch (spec?.type) {
    case 'url': return urlKey(a) === urlKey(b);
    case 'year': return Number(a) === Number(b);
    case 'state': return String(a).toUpperCase() === String(b).toUpperCase();
    case 'money': return a.amount === b.amount && (a.currency == null || b.currency == null || a.currency === b.currency);
    case 'cheque': return (a.min ?? null) === (b.min ?? null) && (a.max ?? null) === (b.max ?? null) && a.currency === b.currency;
    case 'enum': return a === b;
    default: return textKey(a) === textKey(b);
  }
}

// Why a value is not acceptable for a field of this type, or null if it is.
export function checkRecordValue(spec, value) {
  if (spec.type === 'cheque') {
    const ok = value && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).sort().join() === 'currency,max,min'
      && [value.min, value.max].every((n) => n === null || (isNum(n) && n >= 0))
      && (value.min !== null || value.max !== null)
      && (value.min === null || value.max === null || value.min <= value.max)
      && /^[A-Z]{3}$/.test(value.currency ?? '');
    return ok ? null : 'must be { min, max, currency }: at least one amount (>= 0, min not above max) and a 3-letter currency';
  }
  return checkValue(spec, value);
}

// What the subject's own record says for a field, in the form a record states it; null when it says nothing.
export function storedValueOf(subjectType, subject, field) {
  const emptyList = (v) => (Array.isArray(v) && v.length ? v : null);
  if (subjectType === 'investor_organisation') return claimValue(subject, field);
  if (subjectType === 'investor_person') {
    return RECORD_FIELDS.investor_person[field]?.cardinality === 'multi' ? emptyList(subject[field]) : (subject[field] ?? null);
  }
  if (field === 'size') return subject.publicly_disclosed_size == null ? null : { amount: subject.publicly_disclosed_size, currency: subject.size_currency ?? null };
  if (field === 'stage_focus' || field === 'sector_focus') return emptyList(subject[field]);
  return subject[field] ?? null;
}

export const activeRecords = (ds) => (ds.verification_records ?? []).filter((r) => r.status === 'active');

const recordsFor = (ds, subjectType, subjectId) => activeRecords(ds).filter((r) => r.subject_type === subjectType && r.subject_id === subjectId);

// ---------- what a record claims without a page behind it ----------

// The claims on a subject's record that no active verification record backs: [{ field, value }]. A list claim is one entry per
// member. A field that is null or empty is not a claim. This is what stops a record being verified, or published, with a stage
// or a thesis that nobody can point at a page for.
export function claimsWithoutRecords(ds, subjectType, subject) {
  const mine = recordsFor(ds, subjectType, subject.id);
  const out = [];
  const fields = subjectType === 'investor_organisation' ? CLAIM_FIELDS : Object.keys(RECORD_FIELDS[subjectType]);
  for (const field of fields) {
    const spec = RECORD_FIELDS[subjectType][field];
    if (!spec) continue;
    const stored = storedValueOf(subjectType, subject, field);
    if (stored == null) continue;
    const rows = mine.filter((r) => r.field === field);
    for (const member of spec.cardinality === 'multi' ? stored : [stored]) {
      if (!rows.some((r) => valuesEqualFor(spec, r.value, member))) out.push({ field, value: member });
    }
  }
  return out;
}

// The fields an investor organisation must state, and have backed, before a person can call it checked: who it is, what kind
// of investor, why it is in the directory, and where.
export function identityGaps(org) {
  const gaps = [];
  if (!org.website) gaps.push('website');
  if (!org.investor_type) gaps.push('investor_type');
  if (!org.inclusion_basis) gaps.push('inclusion_basis');
  if (!org.country && !org.headquarters_city) gaps.push('location');
  return gaps;
}

// Everything that stops an organisation being called checked: what it has not said, and what it says that nothing backs.
export function checkProblems(ds, org) {
  const gaps = identityGaps(org).map((g) => `it does not say its ${g.replace('_', ' ')}`);
  const unbacked = claimsWithoutRecords(ds, 'investor_organisation', org).map((c) => `its ${c.field.replace(/_/g, ' ')} (${JSON.stringify(c.value)}) has no source`);
  return [...gaps, ...unbacked];
}

// ---------- conflicts ----------

function distinctValues(spec, rows) {
  const out = [];
  for (const row of rows) {
    const hit = out.find((d) => valuesEqualFor(spec, d.value, row.value));
    if (hit) hit.rows.push(row); else out.push({ value: row.value, rows: [row] });
  }
  return out;
}

// Disagreements, for a person to settle. Nothing here changes any data.
//   sources_disagree  two or more active records give different values for a field
//   stored_differs    the active records agree with each other but not with the record
export function detectInvestorConflicts(ds) {
  const out = [];
  const groups = new Map();
  for (const row of activeRecords(ds)) {
    const spec = RECORD_FIELDS[row.subject_type]?.[row.field];
    if (!spec || spec.cardinality !== 'single') continue;
    const key = `${row.subject_type}\u0000${row.subject_id}\u0000${row.field}`;
    if (!groups.has(key)) groups.set(key, { subject_type: row.subject_type, subject_id: row.subject_id, field: row.field, spec, rows: [] });
    groups.get(key).rows.push(row);
  }
  for (const g of groups.values()) {
    const subject = subjectsOf(ds, g.subject_type).find((s) => s.id === g.subject_id);
    if (!subject) continue;
    const stored = storedValueOf(g.subject_type, subject, g.field);
    const distinct = distinctValues(g.spec, g.rows);
    const base = { subject_type: g.subject_type, subject_id: g.subject_id, name: subject.name, field: g.field, stored };
    const side = (d) => ({ value: d.value, record_ids: d.rows.map((r) => r.id), source_ids: [...new Set(d.rows.map((r) => r.source_id))], matches_stored: stored != null && valuesEqualFor(g.spec, stored, d.value) });
    if (distinct.length > 1) out.push({ ...base, kind: 'sources_disagree', values: distinct.map(side) });
    else if (stored != null && !valuesEqualFor(g.spec, stored, distinct[0].value)) out.push({ ...base, kind: 'stored_differs', values: [side(distinct[0])] });
  }
  return out;
}

// ---------- building rows ----------

const slug = (v) => String(v).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// A row with a readable, deterministic id: <subject>.<field>.<source> (single and text), <subject>.<field>.<member>.<source> (multi).
export function makeRecordRow(input, taken = new Set()) {
  const { subject_type, subject_id, field, value, source_id, confidence, verified_at = null, status = 'active', note = null } = input;
  const spec = RECORD_FIELDS[subject_type]?.[field];
  const member = spec?.cardinality === 'multi' ? [slug(typeof value === 'string' ? value : JSON.stringify(value))] : [];
  const base = [subject_id, field, ...member, source_id].join('.');
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}.${n}`;
  return { id, subject_type, subject_id, field, value, source_id, confidence, verified_at, status, note };
}

// ---------- validation ----------

const ID_RE = /^[a-z0-9][a-z0-9._-]*$/;

export function validateVerificationRecords(ds) {
  const errors = [];
  const bad = (where, msg) => errors.push(`${where}: ${msg}`);
  const sources = new Map((ds.sources ?? []).map((s) => [s.id, s]));
  const subjects = Object.fromEntries(SUBJECT_TYPES.map((t) => [t, new Set(subjectsOf(ds, t).map((s) => s.id))]));
  const ids = new Set();
  const claims = [];

  for (const r of ds.verification_records ?? []) {
    const at = `verification record "${r.id}"`;
    if (!isStr(r.id) || !ID_RE.test(r.id)) bad('verification_records', `invalid id ${JSON.stringify(r.id)}`);
    else if (ids.has(r.id)) bad(at, 'duplicate id');
    ids.add(r.id);

    if (!SUBJECT_TYPES.includes(r.subject_type)) { bad(at, `invalid subject_type "${r.subject_type}"`); continue; }
    if (!subjects[r.subject_type].has(r.subject_id)) bad(at, `unknown ${r.subject_type} "${r.subject_id}"`);
    const source = sources.get(r.source_id);
    if (!source) bad(at, `unknown source_id "${r.source_id}"`);

    const spec = RECORD_FIELDS[r.subject_type][r.field];
    if (!spec) bad(at, `"${r.field}" is not a field of ${r.subject_type}`);
    else {
      const problem = checkRecordValue(spec, r.value);
      if (problem) bad(at, `value for "${r.field}" ${problem}`);
    }

    if (!CONFIDENCE_LEVELS.includes(r.confidence)) bad(at, `invalid confidence "${r.confidence}"`);
    if (!EVIDENCE_STATUSES.includes(r.status)) bad(at, `invalid status "${r.status}"`);
    if (r.verified_at != null && !ISO_RE.test(r.verified_at)) bad(at, 'verified_at must be ISO-8601 UTC or null');
    if (r.note != null && typeof r.note !== 'string') bad(at, 'note must be a string or null');
    if (r.confidence === 'high' && r.verified_at == null) bad(at, 'high confidence requires verified_at');
    if (r.verified_at != null && source && source.retrieved_at == null) bad(at, `verified_at is set but source "${source.id}" was never retrieved`);
    if (r.status === 'active' && !isStr(r.note)) bad(at, 'an active record needs a note: what the page says');
    if ((r.status === 'rejected' || r.status === 'superseded') && !isStr(r.note)) bad(at, `${r.status} records need a note saying why`);

    if (spec && source) {
      const repeat = claims.some((k) => k.type === r.subject_type && k.subject === r.subject_id && k.field === r.field && k.source === r.source_id && valuesEqualFor(spec, k.value, r.value));
      if (repeat) bad(at, 'repeats a claim this source already makes for this field');
      claims.push({ type: r.subject_type, subject: r.subject_id, field: r.field, source: r.source_id, value: r.value });
    }
  }

  // A checked organisation or fund may only say what a page backs. (A candidate is a work in progress, and is not held to it.)
  for (const org of ds.investors ?? []) {
    if (!CHECKED_STATUSES.includes(org.verification_status)) continue;
    for (const problem of checkProblems(ds, org)) errors.push(`investor "${org.id}": is ${org.verification_status} but ${problem}`);
  }
  for (const subjectType of ['investor_person', 'fund']) {
    for (const s of subjectsOf(ds, subjectType)) {
      if (!CHECKED_STATUSES.includes(s.verification_status)) continue;
      for (const c of claimsWithoutRecords(ds, subjectType, s)) errors.push(`${subjectType} "${s.id}": is ${s.verification_status} but its ${c.field.replace(/_/g, ' ')} (${JSON.stringify(c.value)}) has no source`);
    }
  }

  // last_verified_at may never lag behind the records beneath it.
  const latest = new Map();
  for (const r of ds.verification_records ?? []) {
    if (r.verified_at == null) continue;
    const key = `${r.subject_type}\u0000${r.subject_id}`;
    if (!latest.has(key) || Date.parse(r.verified_at) > Date.parse(latest.get(key))) latest.set(key, r.verified_at);
  }
  for (const [key, when] of latest) {
    const [type, id] = key.split('\u0000');
    const subject = subjectsOf(ds, type).find((s) => s.id === id);
    if (subject && (subject.last_verified_at == null || Date.parse(subject.last_verified_at) < Date.parse(when))) errors.push(`${type} "${id}": last_verified_at is older than its records (run npm run data:migrate)`);
  }
  return errors;
}

// last_verified_at, kept level with the records beneath it: only ever moves forward.
export function syncLastVerified(ds) {
  const latest = new Map();
  for (const r of ds.verification_records ?? []) {
    if (r.verified_at == null) continue;
    const key = `${r.subject_type}\u0000${r.subject_id}`;
    if (!latest.has(key) || Date.parse(r.verified_at) > Date.parse(latest.get(key))) latest.set(key, r.verified_at);
  }
  for (const [key, when] of latest) {
    const [type, id] = key.split('\u0000');
    const subject = subjectsOf(ds, type).find((s) => s.id === id);
    if (subject && (subject.last_verified_at == null || Date.parse(subject.last_verified_at) < Date.parse(when))) subject.last_verified_at = when;
  }
}
