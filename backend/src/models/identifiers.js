// What a company is known by besides its record: other names, former names,
// legal names, other domains, and registry numbers. Entity resolution compares
// a newly discovered company against these as well as against the record, so a
// rebrand, a legal name or a second domain still finds the existing company.
//
//   identifiers.json  { id, company_id, scheme, value, source_id, note }
//
// Aliases and former names that the legacy data keeps inside the company name
// ("Hone (HoneAg)", "Brumby (formerly GrazeMate)") are read from there at
// resolution time, so they are not duplicated here. A row needs a source or a
// note saying how it is known; nothing is stored on a guess.
import { isStr, slugify } from './company.js';
import { canonicalDomain, isValidABN, isValidACN, nameKey } from './identity.js';

export const IDENTIFIER_SCHEMES = ['alias', 'former_name', 'legal_name', 'domain', 'abn', 'acn'];
const NAME_SCHEMES = new Set(['alias', 'former_name', 'legal_name']);
const ID_RE = /^[a-z0-9][a-z0-9._-]*$/;

// The stored form of a value: digits for ABN and ACN, the canonical domain for a
// domain, trimmed text for a name. null when it cannot be one.
export function normalizeIdentifierValue(scheme, value) {
  if (scheme === 'abn' || scheme === 'acn') return String(value ?? '').replace(/\D/g, '') || null;
  if (scheme === 'domain') {
    const d = canonicalDomain(value);
    return d && !d.nonCompany ? d.domain : null;
  }
  return isStr(value) ? String(value).trim() : null;
}

const comparable = (scheme, value) => (NAME_SCHEMES.has(scheme) ? nameKey(value) : value);

export function makeIdentifierRow({ company_id, scheme, value, source_id = null, note = null }, taken = new Set()) {
  const stored = normalizeIdentifierValue(scheme, value);
  const base = `${company_id}.${scheme}.${slugify(stored ?? '')}`;
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}.${n}`;
  return { id, company_id, scheme, value: stored, source_id, note };
}

export function validateIdentifiers(ds) {
  const errors = [];
  const bad = (where, msg) => errors.push(`${where}: ${msg}`);
  const companies = new Map(ds.companies.map((c) => [c.id, c]));
  const sources = new Set(ds.sources.map((s) => s.id));
  const seenIds = new Set();
  const seenValues = new Map(); // scheme|value -> company_id, for the one-owner rule
  const own = new Set();

  const websiteOwner = new Map();
  for (const c of ds.companies) {
    const d = canonicalDomain(c.website);
    if (d && !d.nonCompany && !websiteOwner.has(d.domain)) websiteOwner.set(d.domain, c);
  }

  for (const row of ds.identifiers ?? []) {
    const at = `identifier "${row.id}"`;
    if (!isStr(row.id) || !ID_RE.test(row.id)) bad('identifiers', `invalid id ${JSON.stringify(row.id)}`);
    else if (seenIds.has(row.id)) bad(at, 'duplicate id');
    seenIds.add(row.id);

    const company = companies.get(row.company_id);
    if (!company) bad(at, `unknown company_id "${row.company_id}"`);
    if (!IDENTIFIER_SCHEMES.includes(row.scheme)) { bad(at, `invalid scheme "${row.scheme}"`); continue; }

    const stored = normalizeIdentifierValue(row.scheme, row.value);
    if (stored == null) bad(at, `value ${JSON.stringify(row.value)} is not a valid ${row.scheme}`);
    else if (stored !== row.value) bad(at, `value must be stored as ${JSON.stringify(stored)}`);
    if (row.scheme === 'abn' && stored && !isValidABN(stored)) bad(at, 'ABN fails its checksum');
    if (row.scheme === 'acn' && stored && !isValidACN(stored)) bad(at, 'ACN fails its checksum');

    if (row.source_id != null && !sources.has(row.source_id)) bad(at, `unknown source_id "${row.source_id}"`);
    if (row.source_id == null && !isStr(row.note)) bad(at, 'needs a source_id or a note saying how it is known');

    if (stored == null) continue;
    const key = `${row.company_id}|${row.scheme}|${comparable(row.scheme, stored)}`;
    if (own.has(key)) bad(at, 'repeats an identifier this company already has');
    own.add(key);

    if (company && NAME_SCHEMES.has(row.scheme) && row.scheme !== 'legal_name' && nameKey(stored) === nameKey(company.name)) {
      bad(at, 'is the same as the company name');
    }
    if (!NAME_SCHEMES.has(row.scheme)) {
      const owner = seenValues.get(`${row.scheme}|${stored}`);
      if (owner && owner !== row.company_id) bad(at, `${row.scheme} ${stored} is also claimed by "${owner}"`);
      seenValues.set(`${row.scheme}|${stored}`, row.company_id);
    }
    if (row.scheme === 'domain') {
      const site = websiteOwner.get(stored);
      if (site && site.id !== row.company_id) bad(at, `domain ${stored} is the website of "${site.name}"`);
    }
  }
  return errors;
}
