import { describe, it, expect } from 'vitest';
import { migrateDataset, validateDataset } from '../src/models/dataset.js';
import { toPublic } from '../src/models/company.js';
import { runDiscovery } from '../src/discovery/pipeline.js';
import { buildIndex, identityOfLead, resolveLead } from '../src/discovery/resolve.js';
import {
  approveCandidate, rejectCandidate, reopenCandidate, markDistinct, mergeCandidate, renameCompany,
} from '../src/discovery/review.js';
import { ensureSource, promoteEvidence, addIdentifier, applyEnrichment, publishCandidate } from '../src/discovery/publish.js';
import { ISO, NOW, dataset, lead, fakeSource, fetcherFor, auPage } from './helpers/discovery.js';

const AT = '2026-10-06T01:00:00.000Z';
const BY = 'Reviewer';

async function discover(leads, routes = {}) {
  const { fetcher } = fetcherFor(routes);
  const { ds } = await runDiscovery({ ds: dataset(), sources: [fakeSource({ leads })], fetcher, now: () => NOW });
  return structuredClone(ds);
}
const ZORBLY = lead({ key: 'z', name: 'Zorbly', website: 'zorbly.com.au', url: 'https://news.example/z', title: 'Zorbly raises $4m seed',
  text: 'Zorbly raises $4m seed round. Aussie startup', evidence: [{ field: 'last_funding_round', value: 'Seed', confidence: 'medium', note: 'headline' }, { field: 'investors', value: 'Blackbird', confidence: 'medium', note: 'headline' }] });
const ZORBLY_SITE = { 'https://zorbly.com.au/': { body: auPage('Zorbly', { abn: '53004085616' }) } };
const valid = (work) => validateDataset(migrateDataset(work));
const the = (work, id) => work.candidates.find((c) => c.id === id);

describe('approving, rejecting and reopening', () => {
  it('records who approved a new company, when, and why', async () => {
    const work = await discover([ZORBLY], ZORBLY_SITE);
    const c = approveCandidate(work, 'cand-zorbly', { by: BY, at: AT, note: 'Looks right.' });
    expect(c).toMatchObject({ status: 'approved', review: { by: BY, at: AT, note: 'Looks right.' } });
    expect(c.status_history.map((h) => h.status)).toEqual(['candidate', 'needs_review', 'approved']);
    expect(valid(work)).toEqual([]);
  });

  it('refuses without a name, from the wrong status, or while a possible duplicate is unsettled', async () => {
    const work = await discover([ZORBLY, lead({ key: 'l', name: 'Leonardo.Ai' })], ZORBLY_SITE);
    expect(() => approveCandidate(work, 'cand-zorbly', { at: AT })).toThrow(/say who is deciding/);
    expect(() => approveCandidate(work, 'cand-leonardo-ai', { by: BY, at: AT })).toThrow(/still has possible duplicates \(Leonardo AI\)/);
    approveCandidate(work, 'cand-zorbly', { by: BY, at: AT });
    expect(() => approveCandidate(work, 'cand-zorbly', { by: BY, at: AT })).toThrow(/is approved: only a candidate waiting for review/);
    expect(() => approveCandidate(work, 'cand-nobody', { by: BY, at: AT })).toThrow(/no candidate/);
  });

  it('rejects with a reason, keeps the record, and can reopen it', async () => {
    const work = await discover([ZORBLY], ZORBLY_SITE);
    expect(() => rejectCandidate(work, 'cand-zorbly', { by: BY, at: AT })).toThrow(/say why/);
    const r = rejectCandidate(work, 'cand-zorbly', { by: BY, reason: 'A hobby project.', at: AT });
    expect(r).toMatchObject({ status: 'rejected', review: { note: 'A hobby project.' } });
    expect(work.candidates).toHaveLength(1);
    const reopened = reopenCandidate(work, 'cand-zorbly', { by: BY, at: AT });
    expect(reopened).toMatchObject({ status: 'needs_review', review: null });
    expect(reopened.status_history.map((h) => h.status)).toEqual(['candidate', 'needs_review', 'rejected', 'needs_review']);
    expect(valid(work)).toEqual([]);
  });

  it('cannot move a published or merged candidate anywhere', async () => {
    const work = await discover([ZORBLY], ZORBLY_SITE);
    approveCandidate(work, 'cand-zorbly', { by: BY, at: AT });
    publishCandidate(work, 'cand-zorbly', { by: BY, at: AT });
    expect(() => rejectCandidate(work, 'cand-zorbly', { by: BY, reason: 'x', at: AT })).toThrow(/cannot go from published to rejected/);
    expect(() => reopenCandidate(work, 'cand-zorbly', { by: BY, at: AT })).toThrow(/cannot go from published/);
  });
});

describe('settling a possible duplicate', () => {
  it('"not the same company" stops the match being proposed, and clears the way to approve', async () => {
    const work = await discover([lead({ key: 'l', name: 'Leonardo.Ai', text: 'Aussie startup raises $4m' })]);
    expect(the(work, 'cand-leonardo-ai').resolution).toBe('LIKELY_MATCH');
    const c = markDistinct(work, 'cand-leonardo-ai', 'leonardo-ai', { by: BY, at: AT });
    expect(c).toMatchObject({ status: 'needs_review', resolution: 'NEW_COMPANY', matches: [], decisions: { not_same_as: ['leonardo-ai'], same_as: null } });
    expect(c.notes.at(-1).text).toMatch(/Confirmed not the same as Leonardo AI \(leonardo-ai\)/);
    expect(c.confidence.breakdown.caps).not.toContain('possible duplicate unresolved');
    expect(approveCandidate(work, 'cand-leonardo-ai', { by: BY, at: AT }).status).toBe('approved');
    expect(valid(work)).toEqual([]);
  });

  it('settles one match at a time and leaves the rest', async () => {
    const work = await discover([lead({ key: 'x', name: 'Acme' })]);
    expect(the(work, 'cand-acme').matches.map((m) => m.id)).toEqual(['acme-robotics']);
    const c = markDistinct(work, 'cand-acme', 'acme-robotics', { by: BY, at: AT, note: 'Different Acme.' });
    expect(c.resolution).toBe('NEW_COMPANY');
    expect(c.status_history.at(-1).note).toBe('Different Acme.');
  });

  it('refuses an unknown company and a candidate that is not waiting', async () => {
    const work = await discover([ZORBLY], ZORBLY_SITE);
    expect(() => markDistinct(work, 'cand-zorbly', 'nobody', { by: BY, at: AT })).toThrow(/no company or candidate "nobody"/);
    approveCandidate(work, 'cand-zorbly', { by: BY, at: AT });
    expect(() => markDistinct(work, 'cand-zorbly', 'acme-robotics', { by: BY, at: AT })).toThrow(/can only be settled while it waits/);
  });

  it('"this is that company" merges into it, adds the name as an alias on a person\'s word, and keeps the evidence', async () => {
    const work = await discover([lead({ key: 'g', name: 'Acme Robotics Group', url: 'https://news.example/g', title: 'Acme raises', evidence: [{ field: 'last_funding_round', value: 'Seed', confidence: 'medium', note: 'headline' }] })]);
    const before = structuredClone(work.companies);
    const summary = mergeCandidate(work, 'cand-acme-robotics-group', 'acme-robotics', { by: BY, at: AT });
    expect(summary.identifiers).toEqual(['alias: Acme Robotics Group']);
    expect(work.identifiers).toEqual([expect.objectContaining({ company_id: 'acme-robotics', scheme: 'alias', value: 'Acme Robotics Group' })]);
    expect(work.evidence).toEqual([expect.objectContaining({ company_id: 'acme-robotics', field: 'last_funding_round', value: 'Seed', confidence: 'medium' })]);
    expect(the(work, 'cand-acme-robotics-group')).toMatchObject({ status: 'merged', decisions: { same_as: 'acme-robotics' }, review: { by: BY } });
    expect(work.companies).toEqual(before);
    expect(valid(work)).toEqual([]);
    // From now on the alias finds the company.
    const r = resolveLead(identityOfLead({ name: 'Acme Robotics Group' }), buildIndex(migrateDataset(work)));
    expect(r.best.target.id).toBe('acme-robotics');
  });

  it('refuses to merge into a company that does not exist', async () => {
    const work = await discover([lead({ key: 'g', name: 'Acme Robotics Group' })]);
    expect(() => mergeCandidate(work, 'cand-acme-robotics-group', 'nobody', { by: BY, at: AT })).toThrow(/no company "nobody"/);
  });
});

describe('publishing', () => {
  it('needs an approved candidate', async () => {
    const work = await discover([ZORBLY], ZORBLY_SITE);
    expect(() => publishCandidate(work, 'cand-zorbly', { by: BY, at: AT })).toThrow(/is needs_review: only an approved candidate can be published/);
    expect(() => publishCandidate(work, 'cand-nobody', { by: BY, at: AT })).toThrow(/no candidate/);
    expect(work.companies).toHaveLength(4);
  });

  it('creates the company with exactly what is known and nothing guessed', async () => {
    const work = await discover([ZORBLY], ZORBLY_SITE);
    approveCandidate(work, 'cand-zorbly', { by: BY, at: AT });
    const { company, candidate } = publishCandidate(work, 'cand-zorbly', { by: BY, at: AT });
    work.candidates[work.candidates.findIndex((c) => c.id === candidate.id)] = candidate;
    expect(company).toMatchObject({
      id: 'zorbly', slug: 'zorbly', name: 'Zorbly', sector: 'Unknown', sectorFull: 'Unknown', stage: 'Seed', hiring: false, verified: false,
      website: 'https://zorbly.com.au', blurb: '', lat: null, lng: null, investors: ['Blackbird'], foundedYear: 2022, last_funding_round: 'Seed',
      address: '5 Collins Street, Melbourne VIC 3000', city: 'Melbourne', taskGate: { enabled: false, type: null }, created_at: AT,
    });
    expect(candidate).toMatchObject({ status: 'published', published_company_id: 'zorbly' });
    expect(work.companies).toHaveLength(5);
    expect(valid(work)).toEqual([]);
  });

  it('brings the evidence and sources across, with the legal name and registry number as identifiers', async () => {
    const work = await discover([ZORBLY], ZORBLY_SITE);
    approveCandidate(work, 'cand-zorbly', { by: BY, at: AT });
    publishCandidate(work, 'cand-zorbly', { by: BY, at: AT });
    const final = migrateDataset(work);
    const evidence = final.evidence.filter((e) => e.company_id === 'zorbly');
    expect(evidence.map((e) => e.field)).toEqual(expect.arrayContaining(['website', 'address', 'last_funding_round', 'investors']));
    expect(final.sources.map((s) => s.url)).toEqual(expect.arrayContaining(['https://news.example/z', 'https://zorbly.com.au/']));
    expect(final.identifiers.filter((i) => i.company_id === 'zorbly').map((i) => `${i.scheme}:${i.value}`).sort()).toEqual(['abn:53004085616', 'legal_name:Zorbly Pty Ltd']);
    expect(final.companies.find((c) => c.id === 'zorbly').source_ids.length).toBeGreaterThan(0);
    expect(validateDataset(final)).toEqual([]);
  });

  it('puts a company on the map only when the reviewer supplies and confirms a location', async () => {
    const work = await discover([ZORBLY], ZORBLY_SITE);
    approveCandidate(work, 'cand-zorbly', { by: BY, at: AT });
    const { company } = publishCandidate(work, 'cand-zorbly', { by: BY, at: AT, location: { city: 'Melbourne', lat: -37.8136, lng: 144.9631, address: '5 Collins Street, Melbourne VIC 3000' } });
    expect(company).toMatchObject({ verified: true, lat: -37.8136, lng: 144.9631, city: 'Melbourne' });
    const final = migrateDataset(work);
    expect(final.companies.find((c) => c.id === 'zorbly')).toMatchObject({ state: 'VIC', country: 'Australia', verification_status: 'location_verified' });
    expect(validateDataset(final)).toEqual([]);
    // With no location confirmed it is listed but not on the map.
    const unplaced = await discover([ZORBLY], ZORBLY_SITE);
    approveCandidate(unplaced, 'cand-zorbly', { by: BY, at: AT });
    expect(publishCandidate(unplaced, 'cand-zorbly', { by: BY, at: AT }).company).toMatchObject({ verified: false, lat: null });
    expect(migrateDataset(unplaced).companies.find((c) => c.id === 'zorbly')).toMatchObject({ location_precision: 'UNKNOWN' });
  });

  it('records a place at the precision the reviewer gave it: an address and a point is exact, a city alone is city-level with no pin', async () => {
    const exact = await discover([ZORBLY], ZORBLY_SITE);
    approveCandidate(exact, 'cand-zorbly', { by: BY, at: AT });
    publishCandidate(exact, 'cand-zorbly', { by: BY, at: AT, location: { city: 'Melbourne', lat: -37.8136, lng: 144.9631, address: '5 Collins Street, Melbourne VIC 3000' } });
    expect(migrateDataset(exact).companies.find((c) => c.id === 'zorbly')).toMatchObject({ location_precision: 'EXACT', location_source: 'manual', location_verified_at: AT, suburb: 'Melbourne', postcode: '3000' });

    const city = await discover([ZORBLY], ZORBLY_SITE);
    approveCandidate(city, 'cand-zorbly', { by: BY, at: AT });
    const { company } = publishCandidate(city, 'cand-zorbly', { by: BY, at: AT, location: { city: 'Melbourne' } });
    expect(company).toMatchObject({ verified: true, city: 'Melbourne', lat: null, lng: null, location_precision: 'CITY', state: 'VIC' });
    expect(valid(city)).toEqual([]);
  });

  it('publishes nothing at all when the place it was given cannot be recorded', async () => {
    const work = await discover([ZORBLY], ZORBLY_SITE);
    approveCandidate(work, 'cand-zorbly', { by: BY, at: AT });
    // Coordinates outside Australia: refused, and the candidate is neither published nor half-published.
    expect(() => publishCandidate(work, 'cand-zorbly', { by: BY, at: AT, location: { city: 'Melbourne', state: 'VIC', lat: 37.77, lng: -122.41 } })).toThrow(/not in Australia/);
    expect(work.companies.some((c) => c.id === 'zorbly')).toBe(false);
    expect(work.candidates.find((c) => c.id === 'cand-zorbly').status).toBe('approved');
  });

  it('gives a colliding name a distinct id, and leaves what is already there alone', async () => {
    const work = await discover([lead({ key: 'l', name: 'Leonardo.Ai', text: 'Aussie startup raises $4m' })]);
    markDistinct(work, 'cand-leonardo-ai', 'leonardo-ai', { by: BY, at: AT });
    approveCandidate(work, 'cand-leonardo-ai', { by: BY, at: AT });
    const before = structuredClone(work.companies);
    const { company } = publishCandidate(work, 'cand-leonardo-ai', { by: BY, at: AT });
    expect(company).toMatchObject({ id: 'leonardo-ai-2', slug: 'leonardo-ai-2', name: 'Leonardo.Ai' });
    expect(work.companies.slice(0, 4)).toEqual(before);
    expect(valid(work)).toEqual([]);
  });

  it('produces a company the public API shape can serve, with no record-keeping in it', async () => {
    const work = await discover([ZORBLY], ZORBLY_SITE);
    approveCandidate(work, 'cand-zorbly', { by: BY, at: AT });
    publishCandidate(work, 'cand-zorbly', { by: BY, at: AT });
    const served = toPublic(migrateDataset(work).companies.find((c) => c.id === 'zorbly'));
    expect(served).not.toHaveProperty('source_ids');
    expect(served).not.toHaveProperty('created_at');
    expect(served).toMatchObject({ name: 'Zorbly', verified: false, hiring: false });
  });

  it('makes the company known to the next discovery: the same website is now an exact match', async () => {
    const work = await discover([ZORBLY], ZORBLY_SITE);
    approveCandidate(work, 'cand-zorbly', { by: BY, at: AT });
    const { candidate } = publishCandidate(work, 'cand-zorbly', { by: BY, at: AT });
    work.candidates[0] = candidate;
    const index = buildIndex(migrateDataset(work));
    expect(index.candidates).toEqual([]);
    expect(resolveLead(identityOfLead({ name: 'Zorbly Pty Ltd', website: 'https://www.zorbly.com.au' }), index).best).toMatchObject({ outcome: 'EXACT_MATCH', target: { kind: 'company', id: 'zorbly' } });
  });
});

describe('a rebrand', () => {
  it('renames the company, keeps its id, and keeps every old name so the old name still finds it', () => {
    const work = dataset([...dataset().companies.map(({ id, slug, ...c }) => c), {
      name: 'Brumby (formerly GrazeMate)', sector: 'Unknown', sectorFull: 'Unknown', city: 'Sydney', lat: null, lng: null, investors: [], stage: 'Unknown', hiring: false, verified: false, website: '', blurb: '', taskGate: { enabled: false },
    }]);
    const summary = renameCompany(work, 'brumby', 'Brumby Ag', { by: BY, at: AT, reason: 'rebranded in 2026' });
    const company = work.companies.find((c) => c.id === 'brumby');
    expect(company).toMatchObject({ id: 'brumby', slug: 'brumby', name: 'Brumby Ag', updated_at: AT });
    expect(summary).toMatchObject({ from: 'Brumby (formerly GrazeMate)', to: 'Brumby Ag' });
    expect(work.identifiers.map((i) => `${i.scheme}:${i.value}`).sort()).toEqual(['former_name:Brumby', 'former_name:GrazeMate']);
    expect(work.identifiers[0].note).toMatch(/Renamed from "Brumby \(formerly GrazeMate\)" by Reviewer on 2026-10-06: rebranded in 2026/);
    expect(validateDataset(migrateDataset(work))).toEqual([]);
    const index = buildIndex(work);
    for (const old of ['Brumby', 'GrazeMate']) expect(resolveLead(identityOfLead({ name: old }), index).best.target.id, old).toBe('brumby');
  });

  it('refuses nothing-changes, an unknown company, and an unnamed decision', () => {
    const work = dataset();
    expect(() => renameCompany(work, 'acme-robotics', 'Acme Robotics', { by: BY, at: AT })).toThrow(/already its name/);
    expect(() => renameCompany(work, 'nobody', 'X', { by: BY, at: AT })).toThrow(/no company/);
    expect(() => renameCompany(work, 'acme-robotics', '  ', { by: BY, at: AT })).toThrow(/say the new name/);
    expect(() => renameCompany(work, 'acme-robotics', 'Acme Two', { at: AT })).toThrow(/say who is deciding/);
  });
});

describe('the building blocks', () => {
  it('shares one source row between claims from the same page, and gives new ones readable unique ids', () => {
    const work = dataset();
    const a = ensureSource(work, { kind: 'press', url: 'https://news.example/a/b', title: 'A', publisher: 'News', retrieved_at: ISO });
    expect(a).toBe('news-example-a-b');
    expect(ensureSource(work, { kind: 'press', url: 'https://news.example/a/b', title: 'A again', retrieved_at: ISO })).toBe(a);
    expect(ensureSource(work, { kind: 'user_supplied', url: null, title: 'Submission: Foo' })).toMatch(/^user-supplied-submission-foo$/);
    expect(new Set(work.sources.map((s) => s.id)).size).toBe(work.sources.length);
  });

  it('promotes evidence once, however many times it is applied', () => {
    const work = dataset();
    const row = { field: 'city', value: 'Sydney', confidence: 'medium', verified_at: null, note: 'n', source: { kind: 'press', url: 'https://news.example/x', title: 'X', retrieved_at: ISO } };
    expect(promoteEvidence(work, 'acme-robotics', [row])).toHaveLength(1);
    expect(promoteEvidence(work, 'acme-robotics', [row])).toHaveLength(0);
    expect(work.evidence).toHaveLength(1);
  });

  it('records an identifier unless it is invalid, repeated, the company\'s own name, or someone else\'s', () => {
    const work = dataset();
    const acme = work.companies.find((c) => c.id === 'acme-robotics');
    const leo = work.companies.find((c) => c.id === 'leonardo-ai');
    const note = 'n';
    expect(addIdentifier(work, acme, 'abn', '53 004 085 616', { note }).added.value).toBe('53004085616');
    expect(addIdentifier(work, acme, 'abn', '53004085616', { note })).toEqual({ held: 'already recorded' });
    expect(addIdentifier(work, leo, 'abn', '53004085616', { note }).held).toMatch(/already belongs to acme-robotics/);
    expect(addIdentifier(work, acme, 'abn', '12345678901', { note }).held).toMatch(/not valid/);
    expect(addIdentifier(work, acme, 'alias', 'ACME Robotics Pty Ltd', { note }).held).toBe('already one of its names');
    expect(addIdentifier(work, acme, 'legal_name', 'Acme Robotics Pty Ltd', { note }).added.scheme).toBe('legal_name');
    expect(addIdentifier(work, acme, 'domain', 'honeag.com', { note }).held).toMatch(/is the website of Hone/);
    expect(addIdentifier(work, acme, 'domain', 'acmerobotics.example', { note }).added.value).toBe('acmerobotics.example');
  });

  it('fills only what is unknown, from evidence of at least medium confidence, and never overwrites', async () => {
    const work = await discover([lead({ key: 'e', name: 'Acme Robotics', website: 'acme.com.au', founders: ['Someone Else'], evidence: [
      { field: 'founders', value: 'Someone Else', confidence: 'medium', note: 'x' }, { field: 'founded_year', value: 2015, confidence: 'low', note: 'x' },
    ] })]);
    const c = the(work, 'cand-acme-robotics');
    expect(c.status).toBe('matched');
    const { summary } = applyEnrichment(work, c, { by: 'engine:exact', at: AT });
    const acme = work.companies.find((x) => x.id === 'acme-robotics');
    expect(acme.founders).toEqual(['Jane Doe', 'John Roe']); // known, so untouched
    expect(acme.foundedYear).toBeUndefined();               // only a low-confidence claim, so not filled
    expect(summary.filled).toEqual([]);
    expect(summary.evidence).toBe(2);
  });
});
