import { describe, it, expect } from 'vitest';
import { migrateDataset, validateDataset } from '../src/models/dataset.js';
import {
  approveInvestor, rejectInvestor, reopenInvestor, flagInvestor, publishInvestor, unpublishInvestor, editInvestor, markInactive,
  mergeInvestors, addInvestment, rejectInvestment, resolveInvestorConflict, approvePerson, rejectPerson, publishPerson, unpublishPerson, ensureSource,
} from '../src/models/investorActions.js';
import { reviewInvestors, relationshipGaps, possibleDuplicateFirms, possibleDuplicatePeople } from '../src/models/investorReview.js';
import { co, world, backed, bare, record, source, investment, person, role, ISO, LONG_AGO } from './helpers/investors.js';

const AT = '2026-10-08T02:00:00.000Z';
const ctx = { at: AT, by: 'test' };
// What the store would do with a working copy: migrate it, then validate it. Nothing an action does may fail that.
const valid = (work) => validateDataset(migrateDataset(structuredClone(work)));
const copy = (ds) => structuredClone(ds);
const PAGE = { url: 'https://oif.example/about', quote: 'We back software founders at seed.' };

const one = (over = {}, claims = [], companies = [co('Acme')], extra = {}) => world({ companies, orgs: [backed('oif', over, claims)], extra });

describe('moving an investor through its lifecycle', () => {
  it('approves a candidate only when every claim it makes has a page behind it', () => {
    const b = backed('oif', { verification_status: 'candidate', last_verified_at: null, stages: ['Seed'] });
    const ds = world({ orgs: [b] });
    expect(() => approveInvestor(copy(ds), 'oif', ctx)).toThrow(/cannot be approved yet: its stages \("Seed"\) has no source/);
    const ok = world({ orgs: [backed('oif', { verification_status: 'candidate', last_verified_at: null, stages: ['Seed'] }, [['stages', 'Seed']])] });
    const work = copy(ok);
    const org = approveInvestor(work, 'oif', ctx);
    expect(org).toMatchObject({ verification_status: 'verified', last_verified_at: AT, updated_at: AT });
    expect(valid(work)).toEqual([]);
  });

  it('will not approve what is already verified, or has nothing said at all', () => {
    expect(() => approveInvestor(copy(one()), 'oif', ctx)).toThrow(/is verified, not waiting to be approved/);
    const empty = world({ orgs: [bare('x')] });
    expect(() => approveInvestor(copy(empty), 'x', ctx)).toThrow(/does not say its website/);
    expect(() => approveInvestor(copy(empty), 'ghost', ctx)).toThrow(/no investor "ghost"/);
  });

  it('publishes only a verified record, and says why when it cannot', () => {
    const work = copy(one());
    expect(publishInvestor(work, 'oif', ctx).verification_status).toBe('published');
    expect(valid(work)).toEqual([]);
    expect(() => publishInvestor(work, 'oif', ctx)).toThrow(/is published: only a verified record is published/);
    const candidate = world({ orgs: [backed('oif', { verification_status: 'candidate', last_verified_at: null })] });
    expect(() => publishInvestor(copy(candidate), 'oif', ctx)).toThrow(/is candidate: only a verified record/);
  });

  it('publishes a record that has stopped investing as inactive: public, labelled, kept', () => {
    const b = backed('oif', { active_status: 'inactive' }, [['active_status', 'inactive']]);
    const work = copy(world({ orgs: [b] }));
    expect(publishInvestor(work, 'oif', ctx).verification_status).toBe('inactive');
    expect(valid(work)).toEqual([]);
  });

  it('unpublishes to verified, and refuses to unpublish what is not public', () => {
    const work = copy(world({ orgs: [backed('oif', { verification_status: 'published' })] }));
    expect(unpublishInvestor(work, 'oif', ctx).verification_status).toBe('verified');
    expect(() => unpublishInvestor(work, 'oif', ctx)).toThrow(/not public/);
  });

  it('rejects before publication, keeps the record, and reopens it for review', () => {
    const work = copy(world({ orgs: [bare('x')] }));
    expect(rejectInvestor(work, 'x', ctx).verification_status).toBe('rejected');
    expect(work.investors).toHaveLength(1);
    expect(() => rejectInvestor(work, 'x', ctx)).toThrow(/is rejected: unpublish it/);
    expect(reopenInvestor(work, 'x', ctx).verification_status).toBe('needs_review');
    expect(() => reopenInvestor(work, 'x', ctx)).toThrow(/only a rejected record is reopened/);
    const published = copy(world({ orgs: [backed('oif', { verification_status: 'published' })] }));
    expect(() => rejectInvestor(published, 'oif', ctx)).toThrow(/unpublish it before rejecting/);
  });

  it('flags a candidate or a verified record for review, and nothing else', () => {
    const work = copy(one());
    expect(flagInvestor(work, 'oif', ctx).verification_status).toBe('needs_review');
    expect(() => flagInvestor(work, 'oif', ctx)).toThrow(/only a candidate or a verified record is flagged/);
  });
});

describe('editing an investor', () => {
  it('needs the page that states a claim, and what it says, before it will record one', () => {
    const work = copy(one({ verification_status: 'candidate', last_verified_at: null }));
    expect(() => editInvestor(work, 'oif', { stages: ['Seed'] }, { ...ctx })).toThrow(/name the page that states it/);
    expect(() => editInvestor(work, 'oif', { stages: ['Seed'] }, { ...ctx, source: { url: PAGE.url, quote: 'ok' } })).toThrow(/say what the page says/);
    expect(work.investors[0].stages).toEqual([]);
  });

  it('records the page, the claim and the words, and returns what moved', () => {
    const work = copy(one({ verification_status: 'candidate', last_verified_at: null }));
    const { org, changes } = editInvestor(work, 'oif', { stages: ['Seed', 'Series A'], sectors: 'Software; Health', lead_or_follow: 'lead' }, { ...ctx, source: PAGE });
    expect(org).toMatchObject({ stages: ['Seed', 'Series A'], sectors: ['Software', 'Health'], lead_or_follow: 'lead', last_verified_at: AT });
    expect(changes.map((c) => c.field).sort()).toEqual(['lead_or_follow', 'sectors', 'stages']);
    const page = work.sources.find((s) => s.url === PAGE.url);
    expect(page).toMatchObject({ kind: 'investor_website', retrieved_at: AT });
    const rows = work.verification_records.filter((r) => r.source_id === page.id);
    expect(rows.map((r) => `${r.field}:${r.value}`).sort()).toEqual(['lead_or_follow:lead', 'sectors:Health', 'sectors:Software', 'stages:Seed', 'stages:Series A']);
    expect(rows.every((r) => r.note === PAGE.quote && r.confidence === 'high' && r.verified_at === AT)).toBe(true);
    expect(valid(work)).toEqual([]);
  });

  it('supersedes the record a new value replaces, and keeps it', () => {
    const work = copy(one({ verification_status: 'candidate', last_verified_at: null }));
    editInvestor(work, 'oif', { headquarters_city: 'Melbourne', state: 'VIC' }, { ...ctx, source: PAGE });
    const city = work.verification_records.filter((r) => r.field === 'headquarters_city');
    expect(city.map((r) => `${r.value}:${r.status}`).sort()).toEqual(['Melbourne:active', 'Sydney:superseded']);
    expect(city.find((r) => r.status === 'superseded').note).toMatch(/Replaced on 2026-10-08 by test/);
    expect(valid(work)).toEqual([]);
  });

  it('removes a list member, superseding its record, and clears a claim without needing a page', () => {
    const work = copy(one({ stages: ['Seed', 'Series A'] }, [['stages', 'Seed'], ['stages', 'Series A']]));
    editInvestor(work, 'oif', { stages: ['Seed'] }, ctx);
    expect(work.investors[0].stages).toEqual(['Seed']);
    expect(work.verification_records.find((r) => r.field === 'stages' && r.value === 'Series A').status).toBe('superseded');
    const cleared = copy(one({ description: 'Backs founders.' }, [['description', 'Backs founders.']]));
    editInvestor(cleared, 'oif', { description: '' }, ctx);
    expect(cleared.investors[0].description).toBeNull();
    expect(valid(cleared)).toEqual([]);
  });

  it('keeps a cheque size as one claim of three fields', () => {
    const work = copy(one({ verification_status: 'candidate', last_verified_at: null }));
    const { org } = editInvestor(work, 'oif', { typical_cheque_min: '250000', typical_cheque_max: 1000000, cheque_currency: 'aud' }, { ...ctx, source: PAGE });
    expect(org).toMatchObject({ typical_cheque_min: 250000, typical_cheque_max: 1000000, cheque_currency: 'AUD' });
    expect(work.verification_records.filter((r) => r.field === 'typical_cheque')).toHaveLength(1);
    expect(valid(work)).toEqual([]);
    expect(() => editInvestor(copy(work), 'oif', { typical_cheque_min: 5000000 }, { ...ctx, source: PAGE })).toThrow(/above/);
  });

  it('renames while keeping the old name as an alias, so the companies that name it still find it', () => {
    const ds = world({ companies: [co('Acme', { investors: ['Oif'] })], orgs: [backed('oif')] });
    const work = copy(ds);
    const { org } = editInvestor(work, 'oif', { name: 'OIF Ventures' }, { ...ctx, source: { url: PAGE.url, quote: 'OIF Ventures is a venture firm.' } });
    expect(org).toMatchObject({ name: 'OIF Ventures', aliases: ['Oif'] });
    expect(valid(work)).toEqual([]);
    const again = migrateDataset(structuredClone(work));
    expect(again.companies[0].investor_ids).toEqual(['oif']);
    expect(again.investors).toHaveLength(1);
  });

  it('refuses a name another investor already has, a field it cannot edit, and an invalid value', () => {
    const ds = world({ orgs: [backed('oif'), backed('skip')] });
    expect(() => editInvestor(copy(ds), 'oif', { name: 'Skip' }, { ...ctx, source: PAGE })).toThrow(/already called "Skip": merge them/);
    expect(() => editInvestor(copy(ds), 'oif', { verification_status: 'published' }, ctx)).toThrow(/cannot be edited here/);
    expect(() => editInvestor(copy(ds), 'oif', { investor_type: 'hedge_fund' }, { ...ctx, source: PAGE })).toThrow(/the type must be one of/);
    expect(() => editInvestor(copy(ds), 'oif', { stages: ['Seeding'] }, { ...ctx, source: PAGE })).toThrow(/a stage must be one of/);
    expect(() => editInvestor(copy(ds), 'oif', { website: 'not a url' }, { ...ctx, source: PAGE })).toThrow(/website must be an http\(s\) address/);
    expect(() => editInvestor(copy(ds), 'oif', { typical_cheque_min: 'lots' }, { ...ctx, source: PAGE })).toThrow(/must be a number/);
  });

  it('will not leave a checked record saying something no page backs', () => {
    const work = copy(one());
    // clearing a record's backing is not possible through an edit, but setting a claim always brings its own record
    editInvestor(work, 'oif', { sectors: ['Software'] }, { ...ctx, source: PAGE });
    expect(valid(work)).toEqual([]);
    expect(work.investors[0].verification_status).toBe('verified');
  });

  it('backs a value the record already holds when a person states it again with its page, and needs no page for one that is already backed', () => {
    // a legacy candidate: it has a name, a stage and a sector, and no page behind any of them
    const ds = world({ orgs: [{ org: bare('oif', { name: 'OIF Ventures', verification_status: 'candidate', stages: ['Seed'], sectors: ['Software'] }) }] });
    const work = copy(ds);
    expect(() => editInvestor(copy(ds), 'oif', { name: 'OIF Ventures' }, ctx)).toThrow(/name the page that states it/);
    const first = editInvestor(work, 'oif', { name: 'OIF Ventures', stages: ['Seed'] }, { ...ctx, source: PAGE });
    expect(first.recorded.sort()).toEqual(['name', 'stages']);
    expect(first.changes).toEqual([]); // the record says what it said: it now has a page behind it
    expect(work.verification_records.filter((r) => r.status === 'active').map((r) => `${r.field}:${r.value}`).sort()).toEqual(['name:OIF Ventures', 'stages:Seed']);
    expect(work.investors[0].sectors).toEqual(['Software']); // not in the edit, so not backed by it
    const again = editInvestor(work, 'oif', { stages: ['Seed'] }, ctx);
    expect(again.recorded).toEqual([]);
    expect(work.verification_records.filter((r) => r.field === 'stages')).toHaveLength(1);
    expect(valid(work)).toEqual([]);
  });

  it('records only the list members no page backs yet when a list is stated again, and leaves the records the others have', () => {
    const ds = world({ orgs: [{ org: bare('oif', { name: 'OIF Ventures', verification_status: 'candidate', stages: ['Seed', 'Series A'] }), records: [record('oif', 'stages', 'Seed', 'earlier-page')], source: source('earlier-page') }] });
    const work = copy(ds);
    const { recorded } = editInvestor(work, 'oif', { stages: ['Seed', 'Series A'] }, { ...ctx, source: PAGE });
    expect(recorded).toEqual(['stages']);
    const rows = work.verification_records.filter((r) => r.field === 'stages');
    expect(rows.map((r) => `${r.value}:${r.source_id === 'earlier-page' ? 'earlier' : 'this'}`).sort()).toEqual(['Seed:earlier', 'Series A:this']);
    expect(valid(work)).toEqual([]);
  });

  it('reuses a page it has seen, and says it was read again', () => {
    const work = copy(one());
    const first = ensureSource(work, { url: 'https://oif.example/team' }, { at: LONG_AGO });
    const again = ensureSource(work, { url: 'https://oif.example/team' }, { at: AT });
    expect(again.id).toBe(first.id);
    expect(work.sources.filter((s) => s.url === 'https://oif.example/team')).toHaveLength(1);
    expect(again.retrieved_at).toBe(AT);
    expect(() => ensureSource(work, { url: 'oif.example' }, { at: AT })).toThrow(/an http\(s\) address/);
  });
});

describe('marking an investor inactive', () => {
  it('needs the page that says it has stopped investing, once the record is checked', () => {
    const work = copy(world({ orgs: [backed('oif', { verification_status: 'published' })] }));
    expect(() => markInactive(work, 'oif', ctx)).toThrow(/name the page that says it has stopped investing/);
    const { org } = markInactive(work, 'oif', { ...ctx, source: { url: PAGE.url, quote: 'The fund is no longer making new investments.' } });
    expect(org).toMatchObject({ active_status: 'inactive', verification_status: 'inactive' });
    expect(valid(work)).toEqual([]);
    expect(() => markInactive(work, 'oif', ctx)).toThrow(/already inactive/);
  });

  it('is enough to say so on a candidate, which is a work in progress', () => {
    const work = copy(world({ orgs: [backed('oif', { verification_status: 'candidate', last_verified_at: null })] }));
    const { org } = markInactive(work, 'oif', ctx);
    expect(org).toMatchObject({ active_status: 'inactive', verification_status: 'candidate' });
  });
});

describe('merging two records that are one firm', () => {
  const pair = () => {
    const keep = backed('oneventures', { name: 'OneVentures' });
    const drop = backed('oneventures-etc', { name: 'OneVentures etc.' });
    const ds = world({
      companies: [co('Acme', { investors: ['OneVentures etc.'] }), co('Beta', { investors: ['OneVentures'] }), co('Cee', { investors: ['OneVentures', 'OneVentures etc.'] })],
      orgs: [keep, drop],
      extra: {
        sources: [source('portfolio')],
        investments: [investment('oneventures', 'beta', 'portfolio'), investment('oneventures-etc', 'beta', 'portfolio', { id: 'dupe' }), investment('oneventures-etc', 'acme', 'portfolio')],
        funds: [{ id: 'f1', name: 'Fund One', slug: 'f1', organisation_id: 'oneventures-etc' }],
        investor_people: [person('jo', { current_organisation_id: 'oneventures-etc', current_title: 'Partner' })],
        investor_people_organisations: [role('jo', 'oneventures-etc', 'portfolio')],
      },
    });
    return ds;
  };

  it('keeps the name and aliases as aliases, moves what hangs off it, drops what the kept record already has, and deletes it', () => {
    const work = copy(pair());
    const { into, moved } = mergeInvestors(work, 'oneventures-etc', 'oneventures', { at: AT });
    expect(into.aliases).toEqual(['OneVentures etc.']);
    expect(work.investors.map((o) => o.id)).toEqual(['oneventures']);
    expect(work.investments.map((i) => `${i.investor_organisation_id}:${i.company_id}`).sort()).toEqual(['oneventures:acme', 'oneventures:beta']);
    expect(moved).toMatchObject({ funds: 1, investments: 1, dropped: 1, team: 1 });
    expect(work.funds[0].organisation_id).toBe('oneventures');
    expect(work.investor_people[0].current_organisation_id).toBe('oneventures');
    expect(work.investor_people_organisations[0].organisation_id).toBe('oneventures');
    expect(work.verification_records.every((r) => r.subject_id === 'oneventures')).toBe(true);
    expect(valid(work)).toEqual([]);
  });

  it('leaves every company that named either one linked to the one that is kept', () => {
    const work = copy(pair());
    mergeInvestors(work, 'oneventures-etc', 'oneventures', { at: AT });
    const after = migrateDataset(structuredClone(work));
    expect(after.investors).toHaveLength(1);
    expect(after.companies.map((c) => c.investor_ids)).toEqual([['oneventures'], ['oneventures'], ['oneventures']]);
  });

  it('shows a disagreement the merge brought together as a conflict, and settles nothing itself', () => {
    const work = copy(pair());
    work.verification_records.push({ ...record('oneventures-etc', 'website', 'https://other.example/', 'oneventures-etc-site'), id: 'x.web' });
    mergeInvestors(work, 'oneventures-etc', 'oneventures', { at: AT });
    const review = reviewInvestors(migrateDataset(structuredClone(work)), { asOf: AT });
    expect(review.conflicts.count).toBeGreaterThan(0);
  });

  it('refuses to merge a record into itself or into a rejected one', () => {
    const work = copy(pair());
    expect(() => mergeInvestors(work, 'oneventures', 'oneventures', { at: AT })).toThrow(/into itself/);
    work.investors.find((o) => o.id === 'oneventures').verification_status = 'rejected';
    expect(() => mergeInvestors(work, 'oneventures-etc', 'oneventures', { at: AT })).toThrow(/is rejected/);
    expect(() => mergeInvestors(work, 'ghost', 'oneventures', { at: AT })).toThrow(/no investor "ghost"/);
  });
});

describe('recording that an investor backed a company', () => {
  const ds = () => world({ companies: [co('Acme'), co('Beta')], orgs: [backed('oif')] });
  const input = (over = {}) => ({ investor_id: 'oif', company_id: 'acme', source: { url: 'https://oif.example/portfolio', quote: 'Acme' }, ...over });

  it('records it with its page and its words, and makes it verified', () => {
    const work = copy(ds());
    const { investment: row } = addInvestment(work, input({ round: 'Seed', investment_date: '2026-03', amount: '3500000', currency: 'aud', lead_status: 'lead' }), ctx);
    expect(row).toMatchObject({ id: 'oif-acme-seed', investor_organisation_id: 'oif', company_id: 'acme', round: 'Seed', investment_date: '2026-03', amount: 3500000, currency: 'AUD', lead_status: 'lead', note: 'Acme', verification_status: 'verified', verified_at: AT });
    expect(work.sources.find((s) => s.id === row.source_id).url).toBe('https://oif.example/portfolio');
    expect(valid(work)).toEqual([]);
  });

  it('will not record one without the page, the words, or a currency for an amount', () => {
    expect(() => addInvestment(copy(ds()), input({ source: null }), ctx)).toThrow(/every investment has a source/);
    expect(() => addInvestment(copy(ds()), input({ source: { url: 'https://oif.example/p', quote: '' } }), ctx)).toThrow(/say what the page says/);
    expect(() => addInvestment(copy(ds()), input({ amount: 5 }), ctx)).toThrow(/needs a 3-letter currency/);
    expect(() => addInvestment(copy(ds()), input({ lead_status: 'boss' }), ctx)).toThrow(/lead status must be one of/);
    expect(() => addInvestment(copy(ds()), input({ investment_date: 'soon' }), ctx)).toThrow(/YYYY, YYYY-MM or YYYY-MM-DD/);
    expect(() => addInvestment(copy(ds()), input({ company_id: 'ghost' }), ctx)).toThrow(/no company "ghost"/);
  });

  it('will not record the same investment twice, but will for another round', () => {
    const work = copy(ds());
    addInvestment(work, input(), ctx);
    expect(() => addInvestment(work, input(), ctx)).toThrow(/already has an investment in Acme/);
    addInvestment(work, input({ round: 'Series A' }), ctx);
    expect(work.investments).toHaveLength(2);
    expect(valid(work)).toEqual([]);
  });

  it('rejects one that was wrong, and keeps the row', () => {
    const work = copy(ds());
    const { investment: row } = addInvestment(work, input(), ctx);
    expect(rejectInvestment(work, row.id, ctx).verification_status).toBe('rejected');
    expect(work.investments).toHaveLength(1);
    expect(() => rejectInvestment(work, row.id, ctx)).toThrow(/already rejected/);
    expect(() => rejectInvestment(work, 'ghost', ctx)).toThrow(/no investment "ghost"/);
  });
});

describe('settling a disagreement between two sources', () => {
  const disputed = () => {
    const b = backed('oif');
    const other = source('oif-press', 'press');
    return world({ orgs: [{ ...b, records: [...b.records, { ...record('oif', 'headquarters_city', 'Melbourne', other.id), id: 'oif.hq.press', confidence: 'medium' }] }], extra: { sources: [other] } });
  };

  it('keeps the records that say the chosen value, turns down the others with why, and sets the record', () => {
    const work = copy(disputed());
    const { org, winner, turnedDown } = resolveInvestorConflict(work, { subject_id: 'oif', field: 'headquarters_city', value: 'Melbourne', reason: 'The press piece is newer.' }, ctx);
    expect(winner).toBe('Melbourne');
    expect(org.headquarters_city).toBe('Melbourne');
    expect(turnedDown).toHaveLength(1);
    const lost = work.verification_records.find((r) => r.id === turnedDown[0]);
    expect(lost).toMatchObject({ value: 'Sydney', status: 'rejected' });
    expect(lost.note).toMatch(/Turned down on 2026-10-08 by test: The press piece is newer\./);
    expect(valid(work)).toEqual([]);
    expect(reviewInvestors(migrateDataset(structuredClone(work)), { asOf: AT }).conflicts.count).toBe(0);
  });

  it('needs a reason, a value a source gave, and a field with one right answer', () => {
    const work = copy(disputed());
    expect(() => resolveInvestorConflict(work, { subject_id: 'oif', field: 'headquarters_city', value: 'Melbourne', reason: '' }, ctx)).toThrow(/say why/);
    expect(() => resolveInvestorConflict(work, { subject_id: 'oif', field: 'headquarters_city', value: 'Perth', reason: 'guess' }, ctx)).toThrow(/no source on record says that/);
    expect(() => resolveInvestorConflict(work, { subject_id: 'oif', field: 'stages', value: 'Seed', reason: 'x' }, ctx)).toThrow(/not a field with one right answer/);
  });
});

describe('people', () => {
  const people = () => world({
    orgs: [backed('oif', { verification_status: 'published' })],
    extra: {
      sources: [source('team')],
      investor_people: [person('jo', { name: 'Jo Citizen', current_organisation_id: 'oif', current_title: 'Partner' })],
      investor_people_organisations: [role('jo', 'oif', 'team')],
    },
  });

  it('approves, publishes and unpublishes a person whose role at the firm is verified', () => {
    const work = copy(people());
    expect(approvePerson(work, 'jo', ctx).verification_status).toBe('verified');
    expect(publishPerson(work, 'jo', ctx).verification_status).toBe('published');
    expect(valid(work)).toEqual([]);
    expect(unpublishPerson(work, 'jo', ctx).verification_status).toBe('verified');
    expect(() => unpublishPerson(work, 'jo', ctx)).toThrow(/not public/);
  });

  it('will not approve a person whose role is not verified, or whose claims have no page', () => {
    const work = copy(people());
    work.investor_people_organisations[0].verification_status = 'unverified';
    expect(() => approvePerson(work, 'jo', ctx)).toThrow(/team record .* is not verified/);
    const bio = copy(people());
    bio.investor_people[0].biography = 'Invests in climate.';
    expect(() => approvePerson(bio, 'jo', ctx)).toThrow(/biography has no source/);
    expect(() => approvePerson(copy(people()), 'ghost', ctx)).toThrow(/no investor person "ghost"/);
  });

  it('rejects a person, and will not publish one that is not verified', () => {
    const work = copy(people());
    expect(() => publishPerson(work, 'jo', ctx)).toThrow(/only a verified record is published/);
    expect(rejectPerson(work, 'jo', ctx).verification_status).toBe('rejected');
  });
});

describe('what the Command Center is told to look at', () => {
  const review = (ds) => reviewInvestors(ds, { asOf: AT });
  const codes = (r, id) => r.rows.find((x) => x.id === id)?.issues.map((i) => i.code) ?? [];

  it('counts the records in each status, and the public ones', () => {
    const ds = world({ orgs: [backed('a', { verification_status: 'published' }), backed('b'), bare('c'), bare('d', { verification_status: 'rejected' })] });
    const r = review(ds);
    expect(r.byStatus).toEqual({ candidate: 1, needs_review: 0, verified: 1, published: 1, inactive: 0, rejected: 1 });
    expect(r).toMatchObject({ total: 4, public: 1 });
  });

  it('flags a new candidate, and what it has not said', () => {
    const r = review(world({ orgs: [bare('c')] }));
    expect(codes(r, 'c')).toEqual(expect.arrayContaining(['new_candidate', 'missing_type', 'missing_location', 'missing_stages', 'missing_sectors', 'missing_website']));
    expect(r.counts.new_candidate).toBe(1);
  });

  it('flags a record someone sent for review, and does not look at a rejected one', () => {
    const r = review(world({ orgs: [bare('c', { verification_status: 'needs_review' }), bare('d', { verification_status: 'rejected' })] }));
    expect(codes(r, 'c')).toContain('needs_review');
    expect(r.rows.some((x) => x.id === 'd')).toBe(false);
  });

  it('flags a name that is really several investors, and a firm that looks like another', () => {
    const r = review(world({ orgs: [backed('oneventures', { name: 'OneVentures' }), backed('oneventures-etc', { name: 'OneVentures etc.' })] }));
    expect(codes(r, 'oneventures-etc')).toEqual(expect.arrayContaining(['compound_name', 'possible_duplicate_firm']));
    expect(codes(r, 'oneventures')).toContain('possible_duplicate_firm');
    expect(r.duplicates.firms.some((g) => g.names.includes('OneVentures etc.'))).toBe(true);
  });

  it('flags a firm checked more than a year ago', () => {
    const r = review(world({ orgs: [backed('old', { last_verified_at: LONG_AGO }, []).org && { ...backed('old'), org: { ...backed('old').org, last_verified_at: LONG_AGO }, records: backed('old').records.map((x) => ({ ...x, verified_at: LONG_AGO })) }] }));
    expect(codes(r, 'old')).toContain('stale_verification');
  });

  it('flags a candidate that states things no page backs', () => {
    const r = review(world({ orgs: [backed('x', { verification_status: 'candidate', last_verified_at: null, stages: ['Seed'] })] }));
    const issue = r.rows[0].issues.find((i) => i.code === 'unsourced_claims');
    expect(issue.detail).toMatch(/1 claim: stages/);
  });

  it('sorts the worst first', () => {
    const r = review(world({ orgs: [bare('a'), bare('b', { verification_status: 'needs_review' })] }));
    expect(r.rows.map((x) => x.id)).toEqual(['b', 'a']);
    expect(r.rows[0].worst).toBe('high');
  });

  it('finds companies that name an investor with no page that states it, and counts the ones that have one', () => {
    const companies = [co('Acme', { investors: ['Oif'] }), co('Beta', { investors: ['Oif'] }), co('Cee', { investors: [] })];
    const ds = world({ companies, orgs: [backed('oif')], extra: { sources: [source('portfolio')], investments: [investment('oif', 'acme', 'portfolio')] } });
    const gaps = relationshipGaps(ds);
    expect(gaps).toMatchObject({ links: 2, sourced: 1, unsourced: 1 });
    expect(gaps.by_investor).toEqual([expect.objectContaining({ id: 'oif', count: 1, companies: [{ company_id: 'beta', name: 'Beta' }] })]);
    expect(codes(review(ds), 'oif')).toContain('unverified_relationships');
  });

  it('does not count a rejected investment as a page that states the link, and counts an unverified one apart', () => {
    const companies = [co('Acme', { investors: ['Oif'] })];
    const rejected = world({ companies, orgs: [backed('oif')], extra: { sources: [source('p')], investments: [investment('oif', 'acme', 'p', { verification_status: 'rejected' })] } });
    expect(relationshipGaps(rejected).unsourced).toBe(1);
    const unverified = world({ companies, orgs: [backed('oif')], extra: { sources: [source('p')], investments: [investment('oif', 'acme', 'p', { verification_status: 'unverified', verified_at: null })] } });
    expect(relationshipGaps(unverified)).toMatchObject({ unsourced: 0, unverified_investments: 1 });
  });

  it('lists team records and people not looked at for a year', () => {
    const ds = world({
      orgs: [backed('oif', { verification_status: 'published' })],
      extra: { sources: [source('team')], investor_people: [person('jo', { name: 'Jo Citizen' })], investor_people_organisations: [role('jo', 'oif', 'team', { verified_at: LONG_AGO })] },
    });
    const r = review(ds);
    expect(r.team.stale).toBe(1);
    expect(r.team.stale_roles[0]).toMatchObject({ person: 'Jo Citizen', organisation: 'Oif', role: 'Partner' });
  });
});

describe('firms and people that look alike', () => {
  it('finds the same name or alias, the same website, and a name that starts another', () => {
    const orgs = [
      bare('a', { name: 'AirTree' }), bare('b', { name: 'Airtree' }),
      bare('c', { name: 'Skip', website: 'https://skip.example/' }), bare('d', { name: 'Skip Capital', website: 'https://www.skip.example/about' }),
      bare('e', { name: 'Prosus' }), bare('f', { name: 'Prosus Ventures' }),
      bare('g', { name: 'Moo', aliases: ['Cow'] }), bare('h', { name: 'Cow' }),
      bare('z', { name: 'Zed', verification_status: 'rejected' }), bare('zz', { name: 'Zed' }),
    ].map((o) => ({ aliases: [], website: null, verification_status: 'candidate', ...o }));
    const reasons = possibleDuplicateFirms(orgs).map((g) => `${g.ids.join('+')}: ${g.reason}`);
    expect(reasons.join('\n')).toMatch(/a\+b: the same name or alias/);
    expect(reasons.join('\n')).toMatch(/c\+d: the same website \(skip\.example\)/);
    expect(reasons.join('\n')).toMatch(/e\+f: "Prosus Ventures" starts with "Prosus"/);
    expect(reasons.join('\n')).toMatch(/g\+h: the same name or alias/);
    expect(reasons.join('\n')).not.toMatch(/zz/);
  });

  it('finds two people with one name or one LinkedIn page', () => {
    const groups = possibleDuplicatePeople([
      { id: 'a', name: 'Jo Citizen' }, { id: 'b', name: 'jo  citizen' },
      { id: 'c', name: 'A', linkedin_url: 'https://www.linkedin.com/in/x/' }, { id: 'd', name: 'B', linkedin_url: 'https://www.linkedin.com/in/x' },
      { id: 'e', name: 'Gone', verification_status: 'rejected' }, { id: 'f', name: 'Gone' },
    ]);
    expect(groups.map((g) => g.ids.join('+'))).toEqual(['a+b', 'c+d']);
  });
});
