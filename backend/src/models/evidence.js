// Field-level provenance: which source says what about which company.
//
//   sources.json   a document at a URL - what was read, and when     { id, kind, url, title, publisher, retrieved_at, note }
//   evidence.json  one claim a source makes about one company field  { id, company_id, field, value, source_id,
//                                                                      confidence, verified_at, status, note }
//
// The facts the model has to hold - source_id, company_id, field, value,
// source_name, source_url, source_type, retrieved_at, verified_at, confidence -
// are an evidence row joined to its source (flattenEvidence). Source facts live
// once, on the source, so several claims can cite one page and a re-fetch
// updates every claim at once.
//
// This is an internal data-quality system. No route serves sources.json or
// evidence.json, and the public company payload drops its record-keeping fields
// (see INTERNAL_FIELDS in company.js).
//
// Evidence never writes to a company. It is recorded, compared with what the
// record says and with other evidence, and disagreements are reported
// (detectConflicts). Changing a company field is always a deliberate, separate
// edit. Evidence that disagrees is never dropped and never wins by default:
//   - two active rows with different values for one field are a conflict;
//   - a row a person has looked at and decided against is marked 'rejected'
//     (kept for the record, ignored by conflict checks);
//   - a row replaced by newer information is marked 'superseded'.
// Both need a note saying why.
//
// confidence is set by whoever records the row:
//   high    a retrieved primary source (the company's own page or document, an
//           accelerator profile, the investor's own announcement) that states
//           the fact directly
//   medium  a retrieved secondary source (press, an aggregator); reputable press
//           seen only through search-result text; or an inference drawn from a
//           retrieved page (company_status 'active' from open roles)
//   low     an owner-supplied lead, a directory listing that was not retrieved,
//           or anything no fetched page confirms
// 'high' requires verified_at, and verified_at requires a retrieved source, so a
// claim cannot be marked verified against a page nobody opened.
import {
  AU_STATES, COMPANY_STATUSES, HIRING_STATUSES, EMPLOYEE_RANGES,
  ISO_RE, PARTIAL_DATE_RE, URL_RE, isStr, isNum, slugify,
} from './company.js';

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'];
export const EVIDENCE_STATUSES = ['active', 'rejected', 'superseded'];
const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };

export const bestConfidence = (levels) =>
  levels.reduce((best, level) => (CONFIDENCE_RANK[level] > CONFIDENCE_RANK[best] ? level : best), 'low');

// The company facts a source can make a claim about, under the long-term
// (snake_case) names. coordinates and logo are deliberately absent: coordinates
// are derived from the address, which is evidenced.
//   single  one true value at a time: different active values are a conflict
//   multi   each row asserts ONE member of a list (an investor, a founder), so
//           rows add up and never conflict
//   text    free text: rows coexist and are never compared
export const EVIDENCE_FIELDS = {
  website: { cardinality: 'single', type: 'url' },
  sector: { cardinality: 'single', type: 'string' },
  subsector: { cardinality: 'single', type: 'string' },
  city: { cardinality: 'single', type: 'string' },
  state: { cardinality: 'single', type: 'state' },
  address: { cardinality: 'single', type: 'string' },
  stage: { cardinality: 'single', type: 'string' },
  company_status: { cardinality: 'single', type: 'enum', values: COMPANY_STATUSES },
  hiring_status: { cardinality: 'single', type: 'enum', values: HIRING_STATUSES },
  employee_range: { cardinality: 'single', type: 'enum', values: EMPLOYEE_RANGES },
  founded_year: { cardinality: 'single', type: 'year' },
  funding_total: { cardinality: 'single', type: 'money' },
  last_funding_round: { cardinality: 'single', type: 'string' },
  last_funding_date: { cardinality: 'single', type: 'date' },
  description: { cardinality: 'text', type: 'string' },
  founders: { cardinality: 'multi', type: 'string' },
  investors: { cardinality: 'multi', type: 'string' },
};
const FIELD_ORDER = Object.keys(EVIDENCE_FIELDS);

// Everyday names that map onto a registry field. Storage only ever holds the
// canonical name; makeEvidenceRow() applies this and the validator rejects the rest.
export const FIELD_ALIASES = {
  headquarters: 'city', hq: 'city', blurb: 'description', foundedYear: 'founded_year', hiring: 'hiring_status',
};
export const normalizeField = (name) => FIELD_ALIASES[name] ?? name;

// ---------- comparing values ----------

const textKey = (v) => String(v).toLowerCase().replace(/\s+/g, ' ').trim();
// "Sydney (Chippendale)" and "Sydney" are the same city for comparison.
const cityKey = (v) => textKey(String(v).replace(/\s*\([^)]*\)/g, ''));
function urlKey(v) {
  try {
    const u = new URL(v);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return textKey(v);
  }
}

// Field-aware equality: URLs ignore scheme, www, query and a trailing slash;
// text ignores case and spacing; money compares amounts, and currencies only
// when both sides state one.
export function valuesEqual(field, a, b) {
  if (a == null || b == null) return a == null && b == null;
  switch (EVIDENCE_FIELDS[field]?.type) {
    case 'url': return urlKey(a) === urlKey(b);
    case 'money': return a.amount === b.amount && (a.currency == null || b.currency == null || a.currency === b.currency);
    case 'year': return Number(a) === Number(b);
    case 'state': return String(a).toUpperCase() === String(b).toUpperCase();
    default: return field === 'city' ? cityKey(a) === cityKey(b) : textKey(a) === textKey(b);
  }
}

// What a company record currently says for a registry field, as a comparable
// value; null when it says nothing (the legacy 'Unknown' and '' count as nothing).
const STORED_KEY = { description: 'blurb', founded_year: 'foundedYear' };
export function storedValue(company, field) {
  const nothing = (v) => v === undefined || v === null || v === '' || v === 'Unknown';
  switch (field) {
    // The legacy flag false cannot say "checked, not hiring", but a source that
    // says "hiring" still disagrees with it.
    case 'hiring_status': return company.hiring_status ?? (company.hiring === false ? 'not_hiring' : null);
    case 'funding_total': return nothing(company.funding_total) ? null : { amount: company.funding_total, currency: null };
    case 'founders':
    case 'investors': return Array.isArray(company[field]) && company[field].length ? company[field] : null;
    default: {
      const v = company[STORED_KEY[field] ?? field];
      return nothing(v) ? null : v;
    }
  }
}

export const activeEvidence = (ds) => (ds.evidence ?? []).filter((e) => e.status === 'active');

function distinctValues(field, rows) {
  const out = [];
  for (const row of rows) {
    const hit = out.find((d) => valuesEqual(field, d.value, row.value));
    if (hit) hit.rows.push(row);
    else out.push({ value: row.value, rows: [row] });
  }
  return out;
}

function groupByCompanyField(ds) {
  const byCompany = new Map(ds.companies.map((c) => [c.id, c]));
  const groups = new Map();
  for (const row of activeEvidence(ds)) {
    const company = byCompany.get(row.company_id);
    if (!company || !EVIDENCE_FIELDS[row.field]) continue;
    const key = `${row.company_id}\u0000${row.field}`;
    if (!groups.has(key)) groups.set(key, { company, field: row.field, rows: [] });
    groups.get(key).rows.push(row);
  }
  const order = new Map(ds.companies.map((c, i) => [c.id, i]));
  return [...groups.values()].sort((a, b) =>
    order.get(a.company.id) - order.get(b.company.id) || FIELD_ORDER.indexOf(a.field) - FIELD_ORDER.indexOf(b.field));
}

const side = (d, stored, field) => ({
  value: d.value,
  evidence_ids: d.rows.map((r) => r.id),
  source_ids: [...new Set(d.rows.map((r) => r.source_id))],
  best_confidence: bestConfidence(d.rows.map((r) => r.confidence)),
  matches_stored: stored != null && valuesEqual(field, stored, d.value),
});

// Disagreements, for a person to resolve. Nothing here changes any data.
//   sources_disagree  two or more active rows give different values for a field
//   stored_differs    the active rows agree with each other but not with the record
// A field the record says nothing about is not a conflict - see findUnappliedEvidence.
export function detectConflicts(ds) {
  const conflicts = [];
  for (const { company, field, rows } of groupByCompanyField(ds)) {
    if (EVIDENCE_FIELDS[field].cardinality !== 'single') continue;
    const distinct = distinctValues(field, rows);
    const stored = storedValue(company, field);
    const base = { company_id: company.id, company_name: company.name, field, stored };
    if (distinct.length > 1) {
      conflicts.push({ ...base, kind: 'sources_disagree', values: distinct.map((d) => side(d, stored, field)) });
    } else if (stored != null && !valuesEqual(field, stored, distinct[0].value)) {
      conflicts.push({ ...base, kind: 'stored_differs', values: [side(distinct[0], stored, field)] });
    }
  }
  return conflicts;
}

// Evidence for something the record does not say yet: an unknown single-valued
// field with one agreed value, or a list member (investor, founder) the record
// does not list. A candidate for a deliberate edit, never applied automatically.
export function findUnappliedEvidence(ds) {
  const out = [];
  for (const { company, field, rows } of groupByCompanyField(ds)) {
    const { cardinality } = EVIDENCE_FIELDS[field];
    const stored = storedValue(company, field);
    const distinct = distinctValues(field, rows);
    const entry = (d) => ({
      company_id: company.id, company_name: company.name, field, value: d.value,
      evidence_ids: d.rows.map((r) => r.id), best_confidence: bestConfidence(d.rows.map((r) => r.confidence)),
    });
    if (cardinality === 'multi') {
      for (const d of distinct) if (!(stored ?? []).some((m) => valuesEqual(field, m, d.value))) out.push(entry(d));
    } else if (cardinality === 'single' && stored == null && distinct.length === 1) {
      out.push(entry(distinct[0]));
    }
  }
  return out;
}

// Values the record states that are backed only by low-confidence evidence:
// an owner-supplied lead or a listing nobody opened. Wants a better source.
export function findWeakEvidence(ds) {
  const out = [];
  for (const { company, field, rows } of groupByCompanyField(ds)) {
    const { cardinality } = EVIDENCE_FIELDS[field];
    if (cardinality === 'text') continue;
    const stored = storedValue(company, field);
    if (stored == null) continue;
    for (const member of cardinality === 'multi' ? stored : [stored]) {
      const support = rows.filter((r) => valuesEqual(field, member, r.value));
      if (support.length && bestConfidence(support.map((r) => r.confidence)) === 'low') {
        out.push({
          company_id: company.id, company_name: company.name, field,
          value: member, best_confidence: 'low', evidence_ids: support.map((r) => r.id),
        });
      }
    }
  }
  return out;
}

// How much of the dataset has any provenance at all, by field.
export function evidenceCoverage(ds) {
  const rows = ds.evidence ?? [];
  const count = (key) => rows.reduce((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] || 0) + 1 }), {});
  const active = rows.filter((r) => r.status === 'active');
  const byField = {};
  for (const field of FIELD_ORDER) {
    const forField = active.filter((r) => r.field === field);
    byField[field] = { rows: forField.length, companies: new Set(forField.map((r) => r.company_id)).size };
  }
  return {
    rows: rows.length,
    byStatus: count('status'),
    byConfidence: count('confidence'),
    companiesWithEvidence: new Set(active.map((r) => r.company_id)).size,
    byField,
  };
}

// ---------- the flat view ----------

// Evidence joined to its source: the one-row-per-claim shape the model is
// specified in. evidence_id, status and note are extras.
export function flattenEvidence(ds, { companyId } = {}) {
  const sources = new Map(ds.sources.map((s) => [s.id, s]));
  return (ds.evidence ?? [])
    .filter((e) => companyId == null || e.company_id === companyId)
    .map((e) => {
      const s = sources.get(e.source_id) ?? {};
      return {
        source_id: e.source_id,
        company_id: e.company_id,
        field: e.field,
        value: e.value,
        source_name: s.title ?? null,
        source_url: s.url ?? null,
        source_type: s.kind ?? null,
        retrieved_at: s.retrieved_at ?? null,
        verified_at: e.verified_at,
        confidence: e.confidence,
        status: e.status,
        note: e.note,
        evidence_id: e.id,
      };
    });
}

// ---------- building rows ----------

// Builds a row with a readable, deterministic id:
//   <company>.<field>.<source>            (single and text fields)
//   <company>.<field>.<member>.<source>   (multi fields: one row per member)
// Pass the ids already in use and a clash gets a numeric suffix.
export function makeEvidenceRow(input, taken = new Set()) {
  const { company_id, value, source_id, confidence, verified_at = null, status = 'active', note = null } = input;
  const field = normalizeField(input.field);
  const member = EVIDENCE_FIELDS[field]?.cardinality === 'multi' ? [slugify(String(value))] : [];
  const base = [company_id, field, ...member, source_id].join('.');
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}.${n}`;
  return { id, company_id, field, value, source_id, confidence, verified_at, status, note };
}

// ---------- validation ----------

const EVIDENCE_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;

function checkValue(spec, value) {
  switch (spec.type) {
    case 'url': return isStr(value) && URL_RE.test(value) ? null : 'must be an http(s) URL';
    case 'string': return isStr(value) ? null : 'must be a non-empty string';
    case 'state': return AU_STATES.includes(value) ? null : `must be one of ${AU_STATES.join(', ')}`;
    case 'enum': return spec.values.includes(value) ? null : `must be one of ${spec.values.join(', ')}`;
    case 'year': return Number.isInteger(value) && value >= 1800 && value <= 2100 ? null : 'must be an integer year';
    case 'date': return typeof value === 'string' && PARTIAL_DATE_RE.test(value) ? null : 'must be YYYY, YYYY-MM or YYYY-MM-DD';
    case 'money': {
      const ok = value && typeof value === 'object' && !Array.isArray(value)
        && Object.keys(value).sort().join() === 'amount,currency'
        && isNum(value.amount) && value.amount >= 0
        && (value.currency === null || /^[A-Z]{3}$/.test(value.currency));
      return ok ? null : 'must be { amount: number >= 0, currency: 3-letter code or null }';
    }
    default: return 'has an unsupported type';
  }
}

export function validateEvidence(ds) {
  const errors = [];
  const bad = (where, msg) => errors.push(`${where}: ${msg}`);
  const companies = new Map(ds.companies.map((c) => [c.id, c]));
  const sources = new Map(ds.sources.map((s) => [s.id, s]));
  const ids = new Set();
  const claims = [];

  for (const e of ds.evidence ?? []) {
    const at = `evidence "${e.id}"`;
    if (!isStr(e.id) || !EVIDENCE_ID_RE.test(e.id)) bad('evidence', `invalid id ${JSON.stringify(e.id)}`);
    else if (ids.has(e.id)) bad(at, 'duplicate id');
    ids.add(e.id);

    const company = companies.get(e.company_id);
    if (!company) bad(at, `unknown company_id "${e.company_id}"`);
    const source = sources.get(e.source_id);
    if (!source) bad(at, `unknown source_id "${e.source_id}"`);

    const spec = EVIDENCE_FIELDS[e.field];
    if (!spec) {
      const hint = FIELD_ALIASES[e.field] ? ` - use "${FIELD_ALIASES[e.field]}"` : '';
      bad(at, `unknown field "${e.field}"${hint}`);
    } else {
      const problem = checkValue(spec, e.value);
      if (problem) bad(at, `value for "${e.field}" ${problem}`);
    }

    if (!CONFIDENCE_LEVELS.includes(e.confidence)) bad(at, `invalid confidence "${e.confidence}"`);
    if (!EVIDENCE_STATUSES.includes(e.status)) bad(at, `invalid status "${e.status}"`);
    if (e.verified_at != null && !ISO_RE.test(e.verified_at)) bad(at, 'verified_at must be ISO-8601 UTC or null');
    if (e.note != null && typeof e.note !== 'string') bad(at, 'note must be a string or null');

    if (e.confidence === 'high' && e.verified_at == null) bad(at, 'high confidence requires verified_at');
    if (e.verified_at != null && source && source.retrieved_at == null) {
      bad(at, `verified_at is set but source "${source.id}" was never retrieved`);
    }
    if ((e.status === 'rejected' || e.status === 'superseded') && !isStr(e.note)) {
      bad(at, `${e.status} evidence needs a note saying why`);
    }
    if (company && source && !company.source_ids.includes(source.id)) {
      bad(at, `company "${company.name}" does not list "${source.id}" in source_ids (run npm run data:migrate)`);
    }

    if (spec && company && source) {
      const repeat = claims.some((k) => k.company === e.company_id && k.field === e.field && k.source === e.source_id
        && valuesEqual(e.field, k.value, e.value));
      if (repeat) bad(at, 'repeats a claim this source already makes for this field');
      claims.push({ company: e.company_id, field: e.field, source: e.source_id, value: e.value });
    }
  }

  // A company's last_verified_at may never lag behind the evidence beneath it.
  const latest = new Map();
  for (const e of ds.evidence ?? []) {
    if (e.verified_at != null && (!latest.has(e.company_id) || Date.parse(e.verified_at) > Date.parse(latest.get(e.company_id)))) {
      latest.set(e.company_id, e.verified_at);
    }
  }
  for (const [companyId, at] of latest) {
    const c = companies.get(companyId);
    if (c && (c.last_verified_at == null || Date.parse(c.last_verified_at) < Date.parse(at))) {
      errors.push(`company "${c.name}": last_verified_at is older than its evidence (run npm run data:migrate)`);
    }
  }
  return errors;
}
