import { describe, it, expect } from 'vitest';
import { migrateDataset, validateDataset, serializeDataset, COLLECTION_FILES } from '../src/models/dataset.js';
import { migrateInvestorRecord, investorProblems, INVESTOR_TYPES, INVESTOR_STATUSES, PUBLIC_STATUSES, typeLabel } from '../src/models/investor.js';
import {
  claimsWithoutRecords, checkProblems, identityGaps, detectInvestorConflicts, valuesEqualFor, RECORD_FIELDS, makeRecordRow,
} from '../src/models/investorEvidence.js';
import { co, world, backed, bare, record, source, investment, person, role, ISO, LONG_AGO } from './helpers/investors.js';

const errors = (ds) => validateDataset(ds);
const withExtra = (orgs, extra = {}, companies = [co('Acme')]) => world({ companies, orgs, extra });

describe('an investor organisation, as the dataset stores it', () => {
  it('is an existing investor with everything a directory needs added, and nothing claimed', () => {
    const ds = withExtra([bare('blackbird')]);
    expect(ds.investors[0]).toEqual({
      id: 'blackbird', name: 'Blackbird', slug: 'blackbird', aliases: [], logo: null, website: null, investor_type: null, description: null,
      investment_thesis: null, headquarters_city: null, state: null, country: null, other_offices: [], stages: [], sectors: [], geographies: [],
      typical_cheque_min: null, typical_cheque_max: null, cheque_currency: null, lead_or_follow: null, active_status: null, application_url: null,
      jobs_url: null, inclusion_basis: null, verification_status: 'candidate', last_verified_at: null, created_at: null, updated_at: null,
    });
    expect(errors(ds)).toEqual([]);
  });

  it('migrates the same way twice, and keeps what a record already says', () => {
    const once = migrateInvestorRecord({ id: 'x', name: 'X', slug: 'x', aliases: ['Ex'], sectors: ['Climate'], stages: ['Seed'], extra_field: 7 });
    expect(migrateInvestorRecord(once)).toEqual(once);
    expect(once).toMatchObject({ aliases: ['Ex'], sectors: ['Climate'], stages: ['Seed'], extra_field: 7, verification_status: 'candidate' });
  });

  it('is made a candidate when a company names an investor the directory did not know', () => {
    const ds = withExtra([], {}, [co('Acme', { investors: ['Brand New Capital'] })]);
    expect(ds.investors).toHaveLength(1);
    expect(ds.investors[0]).toMatchObject({ name: 'Brand New Capital', verification_status: 'candidate', website: null, stages: [] });
    expect(ds.companies[0].investor_ids).toEqual([ds.investors[0].id]);
  });

  it('writes every collection of the investor layer, empty when there is nothing in it', () => {
    const files = serializeDataset(withExtra([]));
    for (const key of ['investor_people', 'funds', 'investments', 'investor_people_organisations', 'fund_portfolio_companies', 'verification_records']) {
      expect(files[COLLECTION_FILES[key]]).toBe('[]\n');
    }
  });

  it('knows what each kind of investor is called, and that a funding platform is not a venture fund', () => {
    expect(Object.keys(INVESTOR_TYPES)).toHaveLength(12);
    expect(typeLabel('venture_debt')).toBe('Venture Debt');
    expect(typeLabel('crowdfunding_platform')).toBe('Crowdfunding Platform');
    expect(typeLabel('nonsense')).toBeNull();
    expect(INVESTOR_STATUSES).toEqual(['candidate', 'needs_review', 'verified', 'published', 'inactive', 'rejected']);
    expect(PUBLIC_STATUSES).toEqual(['published', 'inactive']);
  });
});

describe('what an investor record may hold', () => {
  const base = migrateInvestorRecord(bare('x'));
  const say = (over) => investorProblems({ ...base, ...over });

  it('accepts a candidate with nothing in it', () => expect(say({})).toEqual([]));

  it('refuses a type, state, stage, lead or active value it does not know', () => {
    expect(say({ investor_type: 'hedge_fund' })[0]).toMatch(/invalid investor_type/);
    expect(say({ state: 'XX', country: 'Australia' })[0]).toMatch(/invalid state/);
    expect(say({ state: 'NSW', country: 'New Zealand' })[0]).toMatch(/country is not Australia/);
    expect(say({ stages: ['Seed', 'Late'] })[0]).toMatch(/invalid stage "Late"/);
    expect(say({ lead_or_follow: 'sometimes' })[0]).toMatch(/lead_or_follow/);
    expect(say({ active_status: 'dormant' })[0]).toMatch(/active_status/);
    expect(say({ verification_status: 'done' })[0]).toMatch(/verification_status/);
    expect(say({ inclusion_basis: 'big' })[0]).toMatch(/inclusion_basis/);
  });

  it('keeps a cheque size honest: an amount needs a currency, the low end is not above the high', () => {
    expect(say({ typical_cheque_min: 100000 })[0]).toMatch(/needs a 3-letter cheque_currency/);
    expect(say({ typical_cheque_min: 5, typical_cheque_max: 1, cheque_currency: 'AUD' })[0]).toMatch(/above/);
    expect(say({ cheque_currency: 'AUD' })[0]).toMatch(/no cheque size/);
    expect(say({ typical_cheque_min: -1, cheque_currency: 'AUD' })[0]).toMatch(/>= 0/);
    expect(say({ typical_cheque_min: 100000, typical_cheque_max: 500000, cheque_currency: 'AUD' })).toEqual([]);
  });

  it('refuses a list with a blank or repeated member, and a website that is not an address', () => {
    expect(say({ sectors: ['Climate', 'Climate'] })[0]).toMatch(/repeats/);
    expect(say({ sectors: [''] })[0]).toMatch(/list of text/);
    expect(say({ website: 'blackbird.vc' })[0]).toMatch(/website must be http\(s\)/);
  });

  it('keeps inactive and published apart: a record that stopped investing is not published as active', () => {
    expect(say({ verification_status: 'inactive', last_verified_at: ISO })[0]).toMatch(/active_status "inactive"/);
    expect(say({ verification_status: 'published', last_verified_at: ISO, active_status: 'inactive' })[0]).toMatch(/mark it inactive/);
    expect(say({ verification_status: 'inactive', last_verified_at: ISO, active_status: 'inactive' })).toEqual([]);
  });

  it('says a record that has been checked has a date it was checked', () => {
    expect(say({ verification_status: 'verified' })[0]).toMatch(/no last_verified_at/);
  });

  it('refuses two investors with the same slug', () => {
    const ds = withExtra([bare('a', { slug: 'same' }), bare('b', { slug: 'same' })]);
    expect(errors(ds).join('\n')).toMatch(/duplicate slug "same"/);
  });
});

describe('the pages behind what an investor says', () => {
  it('lists the claims no active verification record backs, a member at a time', () => {
    const { org } = backed('oif', { stages: ['Seed', 'Series A'], sectors: ['Software'], typical_cheque_min: 1e6, typical_cheque_max: 3e6, cheque_currency: 'AUD', description: 'Backs software founders.' });
    const ds = withExtra([{ org, source: source('oif-site'), records: [record('oif', 'stages', 'Seed', 'oif-site')] }]);
    const missing = claimsWithoutRecords(ds, 'investor_organisation', ds.investors[0]);
    expect(missing.map((m) => `${m.field}:${typeof m.value === 'string' ? m.value : 'cheque'}`).sort()).toEqual([
      'country:Australia', 'description:Backs software founders.', 'headquarters_city:Sydney', 'inclusion_basis:based_in_australia', 'investor_type:venture_capital',
      'name:Oif', 'sectors:Software', 'stages:Series A', 'state:NSW', 'typical_cheque:cheque', 'website:https://oif.example/',
    ]);
  });

  it('counts a claim as backed when a record states it, however the text is spaced or cased', () => {
    const { org, source: src, records } = backed('oif', { description: 'Backs   software founders.', sectors: ['Software'] }, [['description', 'backs software FOUNDERS.'], ['sectors', 'software']]);
    expect(claimsWithoutRecords(withExtra([{ org, source: src, records }]), 'investor_organisation', org)).toEqual([]);
  });

  it('does not count a rejected or superseded record', () => {
    const { org, source: src, records } = backed('oif');
    const stale = records.map((r) => (r.field === 'website' ? { ...r, status: 'rejected', note: 'It was the wrong site.' } : r));
    const missing = claimsWithoutRecords(withExtra([{ org, source: src, records: stale }]), 'investor_organisation', org);
    expect(missing.map((m) => m.field)).toEqual(['website']);
  });

  it('says what an organisation has not said, and what it says that nothing backs, before it can be verified', () => {
    expect(identityGaps(migrateInvestorRecord(bare('x')))).toEqual(['website', 'investor_type', 'inclusion_basis', 'location']);
    const ds = withExtra([bare('x', { website: 'https://x.example/', investor_type: 'venture_capital' })]);
    expect(checkProblems(ds, ds.investors[0]).join('|')).toMatch(/does not say its inclusion basis.*does not say its location.*its website .* has no source/s);
  });

  it('holds a checked record to it, and leaves a candidate alone', () => {
    const { org } = backed('oif', { verification_status: 'candidate', last_verified_at: null });
    expect(errors(withExtra([org]))).toEqual([]);
    const checked = backed('oif');
    expect(errors(withExtra([checked]))).toEqual([]);
    const stripped = { ...checked, records: checked.records.filter((r) => r.field !== 'investor_type') };
    expect(errors(withExtra([stripped])).join('\n')).toMatch(/investor "oif": is verified but its investor type \("venture_capital"\) has no source/);
  });

  it('refuses a verified record that states a stage no page backs', () => {
    const b = backed('oif', { stages: ['Seed'] });
    expect(errors(withExtra([b])).join('\n')).toMatch(/its stages \("Seed"\) has no source/);
    const ok = backed('oif', { stages: ['Seed'] }, [['stages', 'Seed']]);
    expect(errors(withExtra([ok]))).toEqual([]);
  });

  it('checks a record on its own terms', () => {
    const b = backed('oif');
    const bad = (over) => errors(withExtra([{ ...b, records: [...b.records, { ...record('oif', 'sectors', 'Software', 'oif-site'), ...over }] }])).join('\n');
    expect(bad({ field: 'favourite_colour' })).toMatch(/not a field of investor_organisation/);
    expect(bad({ subject_id: 'ghost' })).toMatch(/unknown investor_organisation "ghost"/);
    expect(bad({ source_id: 'nowhere' })).toMatch(/unknown source_id/);
    expect(bad({ confidence: 'certain' })).toMatch(/invalid confidence/);
    expect(bad({ note: null })).toMatch(/needs a note: what the page says/);
    expect(bad({ confidence: 'high', verified_at: null })).toMatch(/high confidence requires verified_at/);
    expect(bad({ status: 'rejected', note: null })).toMatch(/rejected records need a note/);
    expect(bad({ value: 7 })).toMatch(/must be a non-empty string/);
    expect(bad({ field: 'stages', value: 'Late' })).toMatch(/must be one of/);
    expect(bad({ field: 'typical_cheque', value: { min: 5, max: 1, currency: 'AUD' } })).toMatch(/min not above max/);
  });

  it('refuses verified_at on a page nobody retrieved, and the same claim twice from one page', () => {
    const b = backed('oif');
    const unread = { ...b, source: { ...b.source, retrieved_at: null } };
    expect(errors(withExtra([unread])).join('\n')).toMatch(/was never retrieved/);
    const twice = { ...b, records: [...b.records, { ...b.records[0], id: 'oif.name.again' }] };
    expect(errors(withExtra([twice])).join('\n')).toMatch(/repeats a claim this source already makes/);
  });

  it('lifts last_verified_at to the newest record under it when the dataset is migrated, and never lowers it', () => {
    const b = backed('oif', { verification_status: 'candidate', last_verified_at: LONG_AGO });
    const ds = withExtra([b]);
    expect(ds.investors[0].last_verified_at).toBe(ISO);
    const newer = backed('oif', { verification_status: 'candidate', last_verified_at: '2026-12-01T00:00:00.000Z' });
    expect(withExtra([newer]).investors[0].last_verified_at).toBe('2026-12-01T00:00:00.000Z');
  });

  it('compares values by what they mean', () => {
    const website = RECORD_FIELDS.investor_organisation.website;
    expect(valuesEqualFor(website, 'https://www.oif.example/about/', 'http://oif.example/about')).toBe(true);
    expect(valuesEqualFor(RECORD_FIELDS.investor_organisation.state, 'nsw', 'NSW')).toBe(true);
    const cheque = RECORD_FIELDS.investor_organisation.typical_cheque;
    expect(valuesEqualFor(cheque, { min: 1, max: 2, currency: 'AUD' }, { min: 1, max: 3, currency: 'AUD' })).toBe(false);
    expect(valuesEqualFor(RECORD_FIELDS.investor_organisation.description, 'A  B', 'a b')).toBe(true);
  });

  it('builds a readable id, one per member for a list', () => {
    const row = makeRecordRow({ subject_type: 'investor_organisation', subject_id: 'oif', field: 'sectors', value: 'Deep Tech', source_id: 'oif-site', confidence: 'high' });
    expect(row.id).toBe('oif.sectors.deep-tech.oif-site');
    const taken = new Set([row.id]);
    expect(makeRecordRow({ subject_type: 'investor_organisation', subject_id: 'oif', field: 'sectors', value: 'Deep Tech', source_id: 'oif-site', confidence: 'high' }, taken).id).toBe('oif.sectors.deep-tech.oif-site.2');
  });
});

describe('where two sources disagree', () => {
  const two = (a, b, over = {}) => {
    const { org, source: src, records } = backed('oif', { ...over });
    const other = source('oif-press', 'press');
    return withExtra([{ org, source: src, records: [...records, { ...record('oif', 'headquarters_city', b, other.id), id: 'oif.hq.press' }] }], { sources: [other] });
  };

  it('reports two active records with different values, and never settles it', () => {
    const ds = two('Sydney', 'Melbourne');
    const found = detectInvestorConflicts(ds);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ subject_id: 'oif', field: 'headquarters_city', kind: 'sources_disagree', stored: 'Sydney' });
    expect(found[0].values.map((v) => v.value).sort()).toEqual(['Melbourne', 'Sydney']);
    expect(ds.investors[0].headquarters_city).toBe('Sydney');
  });

  it('reports records that agree with each other but not with the record', () => {
    const { org, source: src, records } = backed('oif');
    const moved = { ...org, headquarters_city: 'Brisbane' };
    const found = detectInvestorConflicts(withExtra([{ org: moved, source: src, records: records.filter((r) => r.field !== 'headquarters_city').concat(record('oif', 'headquarters_city', 'Sydney', src.id)) }]));
    expect(found).toEqual([expect.objectContaining({ field: 'headquarters_city', kind: 'stored_differs', stored: 'Brisbane' })]);
  });

  it('ignores a rejected record, and a list field, which never conflicts', () => {
    const { org, source: src, records } = backed('oif', { sectors: ['Software'] }, [['sectors', 'Software']]);
    const other = source('oif-press', 'press');
    const extra = [{ ...record('oif', 'headquarters_city', 'Melbourne', other.id), id: 'oif.hq.press', status: 'rejected', note: 'Wrong.' }, { ...record('oif', 'sectors', 'Health', other.id), id: 'oif.sec.press' }];
    expect(detectInvestorConflicts(withExtra([{ org, source: src, records: [...records, ...extra] }], { sources: [other] }))).toEqual([]);
  });
});

describe('the people, funds and relationships around an investor', () => {
  const base = () => {
    const a = backed('oif');
    const b = backed('skip');
    return { a, b, extra: { sources: [source('portfolio')] } };
  };
  const ds = (parts, companies = [co('Acme')]) => world({ companies, orgs: [parts.a, parts.b], extra: { ...parts.extra, ...(parts.rows ?? {}) } });

  it('accepts an investment with its source and what the source says, and refuses one without', () => {
    const p = base();
    expect(errors(ds({ ...p, rows: { investments: [investment('oif', 'acme', 'portfolio')] } }))).toEqual([]);
    const noSource = errors(ds({ ...p, rows: { investments: [investment('oif', 'acme', null)] } })).join('\n');
    expect(noSource).toMatch(/needs a source_id: every relationship has a source/);
    expect(errors(ds({ ...p, rows: { investments: [investment('oif', 'acme', 'nowhere')] } })).join('\n')).toMatch(/unknown source_id "nowhere"/);
    expect(errors(ds({ ...p, rows: { investments: [investment('oif', 'acme', 'portfolio', { note: '' })] } })).join('\n')).toMatch(/needs a note: what the source says/);
  });

  it('keeps an investment tied to real things: an organisation, a company, its own fund, a person', () => {
    const p = base();
    const row = (over) => errors(ds({ ...p, rows: { investments: [investment('oif', 'acme', 'portfolio', over)], funds: [{ id: 'skip-fund', name: 'F', slug: 'skip-fund', organisation_id: 'skip' }] } })).join('\n');
    expect(row({ investor_organisation_id: 'ghost' })).toMatch(/unknown investor_organisation_id/);
    expect(row({ company_id: 'ghost' })).toMatch(/unknown company_id/);
    expect(row({ fund_id: 'skip-fund' })).toMatch(/belongs to "skip", not to the investor/);
    expect(row({ fund_id: 'nope' })).toMatch(/unknown fund_id/);
    expect(row({ investor_person_id: 'nobody' })).toMatch(/unknown investor_person_id/);
    expect(row({ amount: 5 })).toMatch(/an amount needs a 3-letter currency/);
    expect(row({ lead_status: 'boss' })).toMatch(/invalid lead_status/);
    expect(row({ investment_date: '08/10/2026' })).toMatch(/investment_date must be/);
    expect(row({ verification_status: 'maybe' })).toMatch(/invalid verification_status/);
  });

  it('refuses a verified investment whose page was never retrieved, and the same investment twice', () => {
    const p = base();
    const unread = { ...p, extra: { sources: [source('portfolio', 'investor_website', { retrieved_at: null })] }, rows: { investments: [investment('oif', 'acme', 'portfolio')] } };
    expect(errors(ds(unread)).join('\n')).toMatch(/was never retrieved/);
    const twice = { ...p, rows: { investments: [investment('oif', 'acme', 'portfolio'), investment('oif', 'acme', 'portfolio', { id: 'again' })] } };
    expect(errors(ds(twice)).join('\n')).toMatch(/repeats an investment/);
    const rounds = { ...p, rows: { investments: [investment('oif', 'acme', 'portfolio', { round: 'Seed' }), investment('oif', 'acme', 'portfolio', { id: 'again', round: 'Series A' })] } };
    expect(errors(ds(rounds))).toEqual([]);
  });

  it('never holds a private contact detail for a person, and ties a current role to a team record', () => {
    const p = base();
    const bad = (over, extra = {}) => errors(ds({ ...p, rows: { investor_people: [person('jo', over)], ...extra } })).join('\n');
    expect(bad({ email: 'jo@example.com' })).toMatch(/must not hold "email"/);
    expect(bad({ phone: '0400 000 000' })).toMatch(/must not hold "phone"/);
    expect(bad({ current_organisation_id: 'oif' })).toMatch(/with no current team record/);
    expect(bad({ current_title: 'Partner' })).toMatch(/no current_organisation_id/);
    expect(bad({ current_organisation_id: 'oif', current_title: 'Analyst' }, { investor_people_organisations: [role('jo', 'oif', 'portfolio')] })).toMatch(/not the role its team record states/);
    expect(bad({ current_organisation_id: 'oif', current_title: 'partner' }, { investor_people_organisations: [role('jo', 'oif', 'portfolio')] })).toBe('');
    expect(bad({ linkedin_url: 'linkedin.com/in/jo' })).toMatch(/linkedin_url must be http\(s\)/);
  });

  it('holds a checked person to a verified team record and a source for what they say', () => {
    const p = base();
    const checked = { verification_status: 'verified', last_verified_at: ISO, current_organisation_id: 'oif', current_title: 'Partner' };
    const rows = (m) => ({ investor_people: [person('jo', checked)], investor_people_organisations: [role('jo', 'oif', 'portfolio', m)] });
    expect(errors(ds({ ...p, rows: rows({}) }))).toEqual([]);
    expect(errors(ds({ ...p, rows: rows({ verification_status: 'unverified', verified_at: null }) })).join('\n')).toMatch(/current team record is not verified/);
    const withBio = { ...p, rows: { ...rows({}), investor_people: [person('jo', { ...checked, biography: 'Invests in climate.' })] } };
    expect(errors(ds(withBio)).join('\n')).toMatch(/investor_person "jo": is verified but its biography .* has no source/);
  });

  it('keeps a team record sensible: a current role has not ended, and is not repeated', () => {
    const p = base();
    const bad = (over) => errors(ds({ ...p, rows: { investor_people: [person('jo')], investor_people_organisations: [role('jo', 'oif', 'portfolio', over)] } })).join('\n');
    expect(bad({ ended_on: '2025' })).toMatch(/is current but has an ended_on/);
    expect(bad({ role: '' })).toMatch(/needs a role/);
    expect(bad({ started_on: 'last year' })).toMatch(/started_on must be/);
    const twice = errors(ds({ ...p, rows: { investor_people: [person('jo')], investor_people_organisations: [role('jo', 'oif', 'portfolio'), role('jo', 'oif', 'portfolio', { id: 'again' })] } })).join('\n');
    expect(twice).toMatch(/repeats a role/);
  });

  it('keeps a fund tied to its organisation, and a disclosed size to a currency', () => {
    const p = base();
    const fund = (over) => errors(ds({ ...p, rows: { funds: [{ id: 'f1', name: 'Fund 1', slug: 'f1', organisation_id: 'oif', ...over }] } })).join('\n');
    expect(fund({})).toBe('');
    expect(fund({ organisation_id: 'ghost' })).toMatch(/unknown organisation_id/);
    expect(fund({ vintage_year: 1850 })).toMatch(/vintage_year must be a year/);
    expect(fund({ publicly_disclosed_size: 1e8 })).toMatch(/needs a 3-letter size_currency/);
    expect(fund({ publicly_disclosed_size: 1e8, size_currency: 'AUD', stage_focus: ['Seed'] })).toBe('');
    expect(fund({ stage_focus: ['Seeding'] })).toMatch(/invalid stage_focus value/);
  });

  it('keeps a fund portfolio row to its fund, its company and the page that lists it', () => {
    const p = base();
    const funds = [{ id: 'f1', name: 'Fund 1', slug: 'f1', organisation_id: 'oif' }];
    const row = (over) => errors(ds({ ...p, rows: { funds, fund_portfolio_companies: [{ id: 'fp1', fund_id: 'f1', company_id: 'acme', investment_id: null, source_id: 'portfolio', note: 'Listed.', verified_at: ISO, ...over }] } })).join('\n');
    expect(row({})).toBe('');
    expect(row({ fund_id: 'ghost' })).toMatch(/unknown fund_id/);
    expect(row({ source_id: null })).toMatch(/needs a source_id/);
    expect(row({ investment_id: 'ghost' })).toMatch(/unknown investment_id/);
  });
});

describe('the investor layer next to the companies', () => {
  it('leaves a company\'s own investors list, links and record untouched', () => {
    const ds = withExtra([backed('blackbird')], {}, [co('Acme', { investors: ['Blackbird'] })]);
    expect(ds.companies[0].investors).toEqual(['Blackbird']);
    expect(ds.companies[0].investor_ids).toEqual(['blackbird']);
    expect(errors(ds)).toEqual([]);
  });
});
