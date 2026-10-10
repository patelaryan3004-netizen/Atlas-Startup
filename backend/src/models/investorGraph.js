// The rest of the investor layer: the people, funds and relationships around an investor organisation.
//
//   investor_people.json                 a person who invests, kept apart from the firm they work at
//                                        { id, name, slug, photo, current_title, current_organisation_id, location, biography,
//                                          previous_companies[], previous_investor_organisations[], sector_focus[], stage_focus[],
//                                          linkedin_url, personal_website, verification_status, last_verified_at, created_at, updated_at }
//   funds.json                           one fund of one organisation
//                                        { id, name, slug, organisation_id, vintage_year, publicly_disclosed_size, size_currency,
//                                          stage_focus[], sector_focus[], active_status, verification_status, last_verified_at, created_at, updated_at }
//   investments.json                     INVESTED_IN: an organisation (and, where public, its fund and the person) backed a company
//                                        { id, investor_organisation_id, fund_id, investor_person_id, company_id, round, investment_date,
//                                          amount, currency, lead_status, source_id, note, verified_at, verification_status }
//   investor_people_organisations.json   a person's role at an organisation (the team)
//                                        { id, person_id, organisation_id, role, is_current, started_on, ended_on,
//                                          source_id, note, verified_at, verification_status }
//   fund_portfolio_companies.json        a fund's disclosed portfolio, where a source lists the companies and not the rounds
//                                        { id, fund_id, company_id, investment_id, source_id, note, verified_at }
//
// A person, a fund, an investment and a role are four different things and are never folded into one another: an investment
// may name the fund and the person behind it only where a source does, and a person's role belongs to the organisation they
// are at, with the page that says so.
//
// A relationship is its own provenance. Every investment, role and fund-portfolio row names the source that states it
// (`source_id`, required) and the words that source uses (`note`, required): "Every INVESTED_IN relationship must have a
// source" is a rule the validator enforces, not a habit. Unknown stays null. A person has no private contact detail
// field at all, and a record that carries one is refused.
import { ISO_RE, PARTIAL_DATE_RE, URL_RE, isStr, isNum } from './company.js';
import { INVESTOR_STATUSES, INVESTOR_STAGES, ACTIVE_STATUSES, CHECKED_STATUSES } from './investor.js';

// What a person and a fund are when nothing about them is known. A record that has less than this gets the rest filled in
// (pure and idempotent), in this order.
const PERSON_DEFAULTS = {
  photo: null, current_title: null, current_organisation_id: null, location: null, biography: null, previous_companies: [],
  previous_investor_organisations: [], sector_focus: [], stage_focus: [], linkedin_url: null, personal_website: null,
  verification_status: 'candidate', last_verified_at: null, created_at: null, updated_at: null,
};
const FUND_DEFAULTS = {
  organisation_id: null, vintage_year: null, publicly_disclosed_size: null, size_currency: null, stage_focus: [], sector_focus: [],
  active_status: null, verification_status: 'candidate', last_verified_at: null, created_at: null, updated_at: null,
};
function fillDefaults(record, base, defaults) {
  const merged = { ...base, ...record };
  const out = {};
  for (const k of Object.keys(base)) out[k] = merged[k];
  for (const [k, v] of Object.entries(defaults)) out[k] = Array.isArray(v) ? [...(merged[k] ?? [])] : (merged[k] === undefined ? v : merged[k]);
  for (const k of Object.keys(merged)) if (!(k in out)) out[k] = merged[k];
  return out;
}
export const migratePerson = (p) => fillDefaults(p, { id: p.id, name: p.name, slug: p.slug }, PERSON_DEFAULTS);
export const migrateFund = (f) => fillDefaults(f, { id: f.id, name: f.name, slug: f.slug }, FUND_DEFAULTS);

export const RELATIONSHIP_STATUSES = ['unverified', 'verified', 'rejected'];
export const LEAD_STATUSES = ['lead', 'participant'];
// A team record or a person's page not looked at for this long is stale (the Command Center lists it).
export const STALE_DAYS = 365;

// What a person's record must never hold: nothing here is for reaching a private individual.
const PRIVATE_KEYS = ['email', 'phone', 'mobile', 'telephone', 'whatsapp', 'signal', 'home_address', 'address', 'contact'];

const ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const dupes = (list) => list.filter((v, i) => list.indexOf(v) !== i);

export function validateInvestorGraph(ds) {
  const errors = [];
  const bad = (where, msg) => errors.push(`${where}: ${msg}`);
  const orgs = new Map((ds.investors ?? []).map((o) => [o.id, o]));
  const people = ds.investor_people ?? [];
  const funds = ds.funds ?? [];
  const peopleById = new Map(people.map((p) => [p.id, p]));
  const fundsById = new Map(funds.map((f) => [f.id, f]));
  const companies = new Set(ds.companies.map((c) => c.id));
  const sources = new Map((ds.sources ?? []).map((s) => [s.id, s]));
  const investments = ds.investments ?? [];
  const investmentsById = new Map(investments.map((i) => [i.id, i]));
  const memberships = ds.investor_people_organisations ?? [];

  const uniqueIds = (rows, label) => {
    const seen = new Set();
    for (const r of rows) {
      if (!isStr(r.id) || !ID_RE.test(r.id)) bad(label, `invalid id ${JSON.stringify(r.id)}`);
      else if (seen.has(r.id)) bad(label, `duplicate id "${r.id}"`);
      seen.add(r.id);
    }
  };
  const stamp = (at, row, keys) => { for (const k of keys) if (row[k] != null && !ISO_RE.test(row[k])) bad(at, `${k} must be an ISO-8601 UTC timestamp or null`); };
  const list = (at, row, key, allowed = null) => {
    if (!Array.isArray(row[key])) { bad(at, `${key} must be a list`); return; }
    if (row[key].some((v) => !isStr(v))) bad(at, `${key} must be a list of text`);
    else if (dupes(row[key]).length) bad(at, `${key} repeats ${JSON.stringify(dupes(row[key])[0])}`);
    if (allowed) for (const v of row[key]) if (!allowed.includes(v)) bad(at, `invalid ${key} value ${JSON.stringify(v)}`);
  };
  // A relationship names the page that states it, and says what the page says; a verified one was read.
  const provenance = (at, row) => {
    const source = sources.get(row.source_id);
    if (!isStr(row.source_id)) bad(at, 'needs a source_id: every relationship has a source');
    else if (!source) bad(at, `unknown source_id "${row.source_id}"`);
    if (!isStr(row.note)) bad(at, 'needs a note: what the source says');
    if (!RELATIONSHIP_STATUSES.includes(row.verification_status)) bad(at, `invalid verification_status "${row.verification_status}"`);
    stamp(at, row, ['verified_at']);
    if (row.verification_status === 'verified') {
      if (row.verified_at == null) bad(at, 'is verified but has no verified_at');
      if (source && source.retrieved_at == null) bad(at, `is verified but source "${source.id}" was never retrieved`);
    }
  };

  // ----- people -----
  uniqueIds(people, 'investor_people');
  const personSlugs = new Set();
  for (const p of people) {
    const at = `investor person "${p.id}"`;
    if (!isStr(p.name)) bad(at, 'needs a name');
    if (!SLUG_RE.test(p.slug ?? '')) bad(at, `invalid slug ${JSON.stringify(p.slug)}`);
    else if (personSlugs.has(p.slug)) bad(at, `duplicate slug "${p.slug}"`);
    personSlugs.add(p.slug);
    for (const key of PRIVATE_KEYS) if (key in p) bad(at, `must not hold "${key}": a person's private contact details are never kept`);
    for (const key of ['photo', 'linkedin_url', 'personal_website']) if (p[key] != null && !URL_RE.test(p[key])) bad(at, `${key} must be http(s) or null`);
    for (const key of ['current_title', 'location', 'biography']) if (p[key] != null && !isStr(p[key])) bad(at, `${key} must be text or null`);
    if (p.current_organisation_id != null && !orgs.has(p.current_organisation_id)) bad(at, `unknown current_organisation_id "${p.current_organisation_id}"`);
    list(at, p, 'previous_companies'); list(at, p, 'previous_investor_organisations'); list(at, p, 'sector_focus'); list(at, p, 'stage_focus', INVESTOR_STAGES);
    if (!INVESTOR_STATUSES.includes(p.verification_status)) bad(at, `invalid verification_status "${p.verification_status}"`);
    stamp(at, p, ['last_verified_at', 'created_at', 'updated_at']);
    if (CHECKED_STATUSES.includes(p.verification_status) && p.last_verified_at == null) bad(at, `is ${p.verification_status} but has no last_verified_at`);
    // A current role is a team record: the page that puts the person at the firm.
    if (p.current_organisation_id != null) {
      const role = memberships.find((m) => m.person_id === p.id && m.organisation_id === p.current_organisation_id && m.is_current === true && m.verification_status !== 'rejected');
      if (!role) bad(at, `names current_organisation_id "${p.current_organisation_id}" with no current team record for it`);
      else if (p.current_title != null && role.role.trim().toLowerCase() !== p.current_title.trim().toLowerCase()) bad(at, `current_title "${p.current_title}" is not the role its team record states ("${role.role}")`);
    } else if (p.current_title != null) bad(at, 'has a current_title but no current_organisation_id');
    if (CHECKED_STATUSES.includes(p.verification_status) && p.current_organisation_id != null) {
      const role = memberships.find((m) => m.person_id === p.id && m.organisation_id === p.current_organisation_id && m.is_current === true);
      if (role && role.verification_status !== 'verified') bad(at, `is ${p.verification_status} but its current team record is not verified`);
    }
  }

  // ----- funds -----
  uniqueIds(funds, 'funds');
  const fundSlugs = new Set();
  for (const f of funds) {
    const at = `fund "${f.id}"`;
    if (!isStr(f.name)) bad(at, 'needs a name');
    if (!SLUG_RE.test(f.slug ?? '')) bad(at, `invalid slug ${JSON.stringify(f.slug)}`);
    else if (fundSlugs.has(f.slug)) bad(at, `duplicate slug "${f.slug}"`);
    fundSlugs.add(f.slug);
    if (!orgs.has(f.organisation_id)) bad(at, `unknown organisation_id "${f.organisation_id}"`);
    if (f.vintage_year != null && (!Number.isInteger(f.vintage_year) || f.vintage_year < 1900 || f.vintage_year > 2100)) bad(at, 'vintage_year must be a year or null');
    if (f.publicly_disclosed_size != null && (!isNum(f.publicly_disclosed_size) || f.publicly_disclosed_size < 0)) bad(at, 'publicly_disclosed_size must be a number >= 0 or null');
    if (f.publicly_disclosed_size != null && !/^[A-Z]{3}$/.test(f.size_currency ?? '')) bad(at, 'a disclosed size needs a 3-letter size_currency');
    list(at, f, 'stage_focus', INVESTOR_STAGES); list(at, f, 'sector_focus');
    if (f.active_status != null && !ACTIVE_STATUSES.includes(f.active_status)) bad(at, `invalid active_status ${JSON.stringify(f.active_status)}`);
    if (!INVESTOR_STATUSES.includes(f.verification_status)) bad(at, `invalid verification_status "${f.verification_status}"`);
    stamp(at, f, ['last_verified_at', 'created_at', 'updated_at']);
    if (CHECKED_STATUSES.includes(f.verification_status) && f.last_verified_at == null) bad(at, `is ${f.verification_status} but has no last_verified_at`);
  }

  // ----- investments -----
  uniqueIds(investments, 'investments');
  const seenInvestments = new Set();
  for (const i of investments) {
    const at = `investment "${i.id}"`;
    if (!orgs.has(i.investor_organisation_id)) bad(at, `unknown investor_organisation_id "${i.investor_organisation_id}"`);
    if (!companies.has(i.company_id)) bad(at, `unknown company_id "${i.company_id}"`);
    if (i.fund_id != null) {
      const fund = fundsById.get(i.fund_id);
      if (!fund) bad(at, `unknown fund_id "${i.fund_id}"`);
      else if (fund.organisation_id !== i.investor_organisation_id) bad(at, `fund "${i.fund_id}" belongs to "${fund.organisation_id}", not to the investor`);
    }
    if (i.investor_person_id != null && !peopleById.has(i.investor_person_id)) bad(at, `unknown investor_person_id "${i.investor_person_id}"`);
    if (i.round != null && !isStr(i.round)) bad(at, 'round must be text or null');
    if (i.investment_date != null && !PARTIAL_DATE_RE.test(i.investment_date)) bad(at, 'investment_date must be YYYY, YYYY-MM or YYYY-MM-DD');
    if (i.amount != null && (!isNum(i.amount) || i.amount < 0)) bad(at, 'amount must be a number >= 0 or null');
    if (i.amount != null && !/^[A-Z]{3}$/.test(i.currency ?? '')) bad(at, 'an amount needs a 3-letter currency');
    if (i.lead_status != null && !LEAD_STATUSES.includes(i.lead_status)) bad(at, `invalid lead_status ${JSON.stringify(i.lead_status)}`);
    provenance(at, i);
    const key = `${i.investor_organisation_id}|${i.company_id}|${String(i.round ?? '').toLowerCase()}`;
    if (seenInvestments.has(key)) bad(at, 'repeats an investment this organisation already has in this company and round');
    seenInvestments.add(key);
  }

  // ----- team roles -----
  uniqueIds(memberships, 'investor_people_organisations');
  const seenRoles = new Set();
  for (const m of memberships) {
    const at = `team record "${m.id}"`;
    if (!peopleById.has(m.person_id)) bad(at, `unknown person_id "${m.person_id}"`);
    if (!orgs.has(m.organisation_id)) bad(at, `unknown organisation_id "${m.organisation_id}"`);
    if (!isStr(m.role)) bad(at, 'needs a role');
    if (m.is_current != null && typeof m.is_current !== 'boolean') bad(at, 'is_current must be true, false or null');
    for (const key of ['started_on', 'ended_on']) if (m[key] != null && !PARTIAL_DATE_RE.test(m[key])) bad(at, `${key} must be YYYY, YYYY-MM or YYYY-MM-DD`);
    if (m.is_current === true && m.ended_on != null) bad(at, 'is current but has an ended_on');
    provenance(at, m);
    const key = `${m.person_id}|${m.organisation_id}|${String(m.role ?? '').toLowerCase()}`;
    if (seenRoles.has(key)) bad(at, 'repeats a role this person already has at this organisation');
    seenRoles.add(key);
  }

  // ----- fund portfolios -----
  const portfolio = ds.fund_portfolio_companies ?? [];
  uniqueIds(portfolio, 'fund_portfolio_companies');
  const seenPortfolio = new Set();
  for (const p of portfolio) {
    const at = `fund portfolio row "${p.id}"`;
    if (!fundsById.has(p.fund_id)) bad(at, `unknown fund_id "${p.fund_id}"`);
    if (!companies.has(p.company_id)) bad(at, `unknown company_id "${p.company_id}"`);
    if (p.investment_id != null) {
      const inv = investmentsById.get(p.investment_id);
      if (!inv) bad(at, `unknown investment_id "${p.investment_id}"`);
      else if (inv.company_id !== p.company_id || inv.fund_id !== p.fund_id) bad(at, `investment "${p.investment_id}" is not this fund's investment in this company`);
    }
    provenance(at, { ...p, verification_status: p.verified_at != null ? 'verified' : 'unverified' });
    const key = `${p.fund_id}|${p.company_id}`;
    if (seenPortfolio.has(key)) bad(at, 'repeats a company this fund already lists');
    seenPortfolio.add(key);
  }
  return errors;
}
