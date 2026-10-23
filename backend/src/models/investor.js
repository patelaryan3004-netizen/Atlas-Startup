// Investor organisations: the funds, angel networks and institutions that back Australian startups.
//
// An investor organisation is the entity investors.json has always held ({ id, name, slug, aliases[] }, made from the
// free-text names in companies' `investors` lists). This module extends that record in place, so every company's
// investor_ids still point at it, and adds what a directory of investors needs: what kind of investor it is, where, what it
// says it invests in, and whether a person has checked any of that.
//
// The rules the whole investor layer follows (docs/investors.md):
//
//   Unknown stays null. A field no source states is null (or []), never estimated and never filled from a guess.
//   A claim about an investor is only as good as its source. Every stated stage, sector, thesis, cheque size, location and
//   type has a verification record (verification_records.json) naming the page that says it, and a record cannot be
//   verified or published while one is missing (investorEvidence.js).
//   The public record moves only by a person's act. A record starts as a `candidate`; checking it makes it `verified`;
//   publishing it (an admin's act) is the only way it reaches the public site.
//
// The other tables of the layer (investor_people, funds, investments, investor_people_organisations,
// fund_portfolio_companies, verification_records) are in investorGraph.js and investorEvidence.js.
import { AU_STATES, ISO_RE, URL_RE, isStr, isNum } from './company.js';

// What kind of investor. The stored value is the key, so a label can be reworded without touching data. A funding platform
// (crowdfunding, venture debt, revenue-based finance) is its own kind and is never labelled a venture fund.
export const INVESTOR_TYPES = {
  venture_capital: 'Venture Capital',
  corporate_vc: 'Corporate VC',
  family_office: 'Family Office',
  angel_network: 'Angel Network',
  angel_syndicate: 'Angel Syndicate',
  individual_angel: 'Individual Angel',
  government_fund: 'Government Fund',
  university_fund: 'University Fund',
  accelerator_fund: 'Accelerator Fund',
  venture_debt: 'Venture Debt',
  revenue_based_finance: 'Revenue-Based Finance',
  crowdfunding_platform: 'Crowdfunding Platform',
};
export const typeLabel = (type) => INVESTOR_TYPES[type] ?? null;

// candidate     found, not yet checked
// needs_review  a person must look: a conflict, a possible duplicate, a doubt about whether it belongs
// verified      checked against sources by a person; still not public
// published     public (an admin's act)
// inactive      public, and no longer investing: kept, labelled, never deleted
// rejected      looked at and turned down: kept so the same name is not proposed again
export const INVESTOR_STATUSES = ['candidate', 'needs_review', 'verified', 'published', 'inactive', 'rejected'];
export const PUBLIC_STATUSES = ['published', 'inactive'];
export const isPublicStatus = (status) => PUBLIC_STATUSES.includes(status);
// Statuses that say a person has checked the record: what is claimed must be backed.
export const CHECKED_STATUSES = ['verified', 'published', 'inactive'];

export const INVESTOR_STAGES = ['Pre-seed', 'Seed', 'Series A', 'Series B', 'Series C+', 'Growth'];
export const LEAD_OR_FOLLOW = ['lead', 'follow', 'both'];
export const ACTIVE_STATUSES = ['active', 'inactive'];

// Why an investor is in the directory at all (the inclusion criteria): it is based in Australia, it invests in
// Australian-founded startups, or it runs a recognised Australian startup investment network. A record needs one.
// `international` is for global discovery: the investor is based outside Australia and is listed as that. It says nothing about whether it backs
// Australian startups, and the pages never imply it does.
export const INCLUSION_BASES = ['based_in_australia', 'invests_in_australian_startups', 'australian_startup_network', 'international'];

// The record's keys in the order they are written, with what each is when nothing is known.
const DEFAULTS = {
  logo: null,
  website: null,
  investor_type: null,
  description: null,
  investment_thesis: null,
  headquarters_city: null,
  state: null,
  country: null,
  other_offices: [],
  office_addresses: [],
  stages: [],
  sectors: [],
  geographies: [],
  typical_cheque_min: null,
  typical_cheque_max: null,
  cheque_currency: null,
  lead_or_follow: null,
  active_status: null,
  application_url: null,
  jobs_url: null,
  inclusion_basis: null,
  verification_status: 'candidate',
  last_verified_at: null,
  created_at: null,
  updated_at: null,
};
export const INVESTOR_ADDED_FIELDS = Object.keys(DEFAULTS);
const LIST_FIELDS = new Set(['other_offices', 'office_addresses', 'stages', 'sectors', 'geographies']);

export const emptyInvestorFields = () => Object.fromEntries(Object.entries(DEFAULTS).map(([k, v]) => [k, Array.isArray(v) ? [] : v]));

// Fills what is missing and leaves what is there: pure and idempotent. A record that predates this model (just a name and
// its aliases) becomes a candidate with nothing claimed.
export function migrateInvestorRecord(record) {
  const merged = { ...emptyInvestorFields(), ...record };
  const out = { id: merged.id, name: merged.name, slug: merged.slug, aliases: merged.aliases ?? [] };
  for (const k of INVESTOR_ADDED_FIELDS) out[k] = LIST_FIELDS.has(k) ? [...(merged[k] ?? [])] : merged[k];
  for (const k of Object.keys(merged)) if (!(k in out)) out[k] = merged[k];
  return out;
}

// The claims about an investor that a source has to back before a person can call the record checked. A field that is
// null or empty is not a claim and needs nothing.
export const CLAIM_FIELDS = [
  'name', 'website', 'investor_type', 'inclusion_basis', 'headquarters_city', 'state', 'country', 'other_offices', 'office_addresses', 'stages', 'sectors',
  'geographies', 'typical_cheque', 'lead_or_follow', 'active_status', 'application_url', 'jobs_url', 'description', 'investment_thesis',
];

// The fields a person may change on an investor (the Command Center's Edit, and the CLI). Each claim field changed needs a source.
export const EDITABLE_INVESTOR_FIELDS = [
  'website', 'investor_type', 'inclusion_basis', 'headquarters_city', 'state', 'country', 'other_offices', 'office_addresses', 'stages', 'sectors',
  'geographies', 'typical_cheque_min', 'typical_cheque_max', 'cheque_currency', 'lead_or_follow', 'active_status',
  'application_url', 'jobs_url', 'description', 'investment_thesis',
];

// The value a claim field currently has on the record, in the form a verification record states it; null when it says nothing.
export function claimValue(org, field) {
  switch (field) {
    case 'typical_cheque': {
      if (org.typical_cheque_min == null && org.typical_cheque_max == null) return null;
      return { min: org.typical_cheque_min ?? null, max: org.typical_cheque_max ?? null, currency: org.cheque_currency ?? null };
    }
    case 'other_offices': case 'office_addresses': case 'stages': case 'sectors': case 'geographies': return org[field]?.length ? org[field] : null;
    default: return org[field] === undefined || org[field] === '' ? null : org[field];
  }
}

// An office's street address, as the record keeps it: "Melbourne: 15 Dover St, Cremorne VIC 3121", the city the page puts it under (one of the
// investor's offices) and the address, written plainly so it can be looked up. What the page itself says, word for word, is the evidence row's note.
// Null for anything that is not that shape.
export function parseOfficeAddress(entry) {
  const m = /^([^:]{2,60}):\s*(\S.*)$/.exec(String(entry ?? '').trim());
  return m ? { city: m[1].trim(), address: m[2].trim() } : null;
}

// ---------- validation ----------

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const duplicates = (list) => list.filter((v, i) => list.indexOf(v) !== i);

// One investor record on its own. How it fits the rest of the dataset (evidence, links) is checked elsewhere.
export function investorProblems(org) {
  const problems = [];
  const bad = (msg) => problems.push(msg);
  const url = (key) => { if (org[key] != null && !URL_RE.test(org[key])) bad(`${key} must be http(s) or null`); };

  if (!isStr(org.name)) bad('needs a name');
  if (!SLUG_RE.test(org.slug ?? '')) bad(`invalid slug ${JSON.stringify(org.slug)}`);
  if (!Array.isArray(org.aliases)) bad('aliases must be a list');
  url('website'); url('application_url'); url('jobs_url'); url('logo');
  if (org.investor_type != null && !(org.investor_type in INVESTOR_TYPES)) bad(`invalid investor_type ${JSON.stringify(org.investor_type)}`);
  if (org.inclusion_basis != null && !INCLUSION_BASES.includes(org.inclusion_basis)) bad(`invalid inclusion_basis ${JSON.stringify(org.inclusion_basis)}`);
  if (org.state != null && !AU_STATES.includes(org.state)) bad(`invalid state ${JSON.stringify(org.state)}`);
  if (org.state != null && org.country !== 'Australia') bad('state is set but country is not Australia');
  for (const key of ['headquarters_city', 'country', 'description', 'investment_thesis']) {
    if (org[key] != null && !isStr(org[key])) bad(`${key} must be text or null`);
  }
  for (const key of LIST_FIELDS) {
    if (!Array.isArray(org[key])) bad(`${key} must be a list`);
    else if (org[key].some((v) => !isStr(v))) bad(`${key} must be a list of text`);
    else if (duplicates(org[key]).length) bad(`${key} repeats ${JSON.stringify(duplicates(org[key])[0])}`);
  }
  if (Array.isArray(org.stages)) for (const s of org.stages) if (!INVESTOR_STAGES.includes(s)) bad(`invalid stage ${JSON.stringify(s)}`);
  // An office address belongs to an office: its city is the headquarters or one of the other offices, so an address never floats free of a place.
  if (Array.isArray(org.office_addresses)) {
    const cities = [org.headquarters_city, ...(Array.isArray(org.other_offices) ? org.other_offices : [])].filter(Boolean).map((c) => String(c).toLowerCase());
    for (const entry of org.office_addresses) {
      if (typeof entry !== 'string') continue;
      const parsed = parseOfficeAddress(entry);
      if (!parsed) bad(`office address ${JSON.stringify(entry)} must be written "City: street address"`);
      else if (!cities.includes(parsed.city.toLowerCase())) bad(`office address ${JSON.stringify(entry)} is for a city that is neither the headquarters nor one of the other offices`);
    }
  }

  for (const key of ['typical_cheque_min', 'typical_cheque_max']) {
    if (org[key] != null && (!isNum(org[key]) || org[key] < 0)) bad(`${key} must be a number >= 0 or null`);
  }
  if (isNum(org.typical_cheque_min) && isNum(org.typical_cheque_max) && org.typical_cheque_min > org.typical_cheque_max) bad('typical_cheque_min is above typical_cheque_max');
  const hasCheque = org.typical_cheque_min != null || org.typical_cheque_max != null;
  if (hasCheque && !/^[A-Z]{3}$/.test(org.cheque_currency ?? '')) bad('a cheque size needs a 3-letter cheque_currency');
  if (!hasCheque && org.cheque_currency != null) bad('cheque_currency is set but there is no cheque size');

  if (org.lead_or_follow != null && !LEAD_OR_FOLLOW.includes(org.lead_or_follow)) bad(`invalid lead_or_follow ${JSON.stringify(org.lead_or_follow)}`);
  if (org.active_status != null && !ACTIVE_STATUSES.includes(org.active_status)) bad(`invalid active_status ${JSON.stringify(org.active_status)}`);
  if (!INVESTOR_STATUSES.includes(org.verification_status)) bad(`invalid verification_status ${JSON.stringify(org.verification_status)}`);
  for (const key of ['last_verified_at', 'created_at', 'updated_at']) {
    if (org[key] != null && !ISO_RE.test(org[key])) bad(`${key} must be an ISO-8601 UTC timestamp or null`);
  }
  // A record that is public and inactive says so; one that says it is no longer investing is not listed as active.
  if (org.verification_status === 'inactive' && org.active_status !== 'inactive') bad('an inactive record must have active_status "inactive"');
  if (org.verification_status === 'published' && org.active_status === 'inactive') bad('a published record is active or unknown: mark it inactive instead');
  if (CHECKED_STATUSES.includes(org.verification_status) && org.last_verified_at == null) bad(`is ${org.verification_status} but has no last_verified_at`);
  return problems;
}

export function validateInvestorOrganisations(ds) {
  const errors = [];
  const slugs = new Set();
  for (const org of ds.investors ?? []) {
    for (const message of investorProblems(org)) errors.push(`investor "${org.id}": ${message}`);
    if (org.slug != null) {
      if (slugs.has(org.slug)) errors.push(`investor "${org.id}": duplicate slug "${org.slug}"`);
      slugs.add(org.slug);
    }
  }
  return errors;
}
