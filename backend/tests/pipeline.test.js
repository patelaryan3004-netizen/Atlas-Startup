import { describe, it, expect } from 'vitest';
import { migrateDataset, validateDataset } from '../src/models/dataset.js';
import { detectConflicts } from '../src/models/evidence.js';
import { runDiscovery, createEngine } from '../src/discovery/pipeline.js';
import { NOW, dataset, lead, fakeSource, fetcherFor, auPage, page } from './helpers/discovery.js';

const run = async (leads, { routes = {}, ds = dataset(), options = {}, extraSources = [] } = {}) => {
  const { fetcher, w } = fetcherFor(routes);
  const result = await runDiscovery({ ds, sources: [fakeSource({ leads }), ...extraSources], fetcher, now: () => NOW, options });
  return { ...result, w, fetcher, input: ds };
};
const only = (out) => { expect(out.candidates).toHaveLength(1); return out.candidates[0]; };

describe('an exact match for an existing company', () => {
  it('becomes a matched candidate that names the company, with no network use and no change to the company', async () => {
    const { ds, w, input } = await run([lead({ name: 'Leonardo.Ai', website: 'https://leonardo.ai', title: 'Leonardo.Ai raises $20m', text: 'Leonardo.Ai raises $20m seed' })]);
    const c = only(ds);
    expect(c).toMatchObject({ status: 'matched', resolution: 'EXACT_MATCH' });
    expect(c.matches[0]).toMatchObject({ kind: 'company', id: 'leonardo-ai', outcome: 'EXACT_MATCH' });
    expect(c.status_history.map((h) => h.status)).toEqual(['candidate', 'matched']);
    expect(w.calls).toEqual([]);
    expect(ds.companies).toEqual(input.companies);
  });

  it('is enriched into the company only when asked: evidence and identifiers added, unknown fields filled, nothing overwritten', async () => {
    const evidence = [
      { field: 'founders', value: 'Jane Doe', confidence: 'medium', note: 'listed' },
      { field: 'founded_year', value: 2022, confidence: 'medium', note: 'listed' },
      { field: 'stage', value: 'Seed', confidence: 'medium', note: 'listed' },
    ];
    const src = fakeSource({ kind: 'open_dataset', licenseBasis: 'open_data', leads: [lead({ name: 'Leonardo.Ai', website: 'https://leonardo.ai', evidence })] });
    const { fetcher } = fetcherFor();
    const staged = await runDiscovery({ ds: dataset(), sources: [src], fetcher, now: () => NOW });
    expect(staged.ds.candidates[0].status).toBe('matched');
    expect(staged.ds.companies.find((c) => c.id === 'leonardo-ai').founders).toBeUndefined();
    expect(staged.report.applied).toEqual([]);

    const applied = await runDiscovery({ ds: dataset(), sources: [src], fetcher, now: () => NOW, options: { applyExact: true } });
    const company = applied.ds.companies.find((c) => c.id === 'leonardo-ai');
    expect(applied.ds.candidates[0]).toMatchObject({ status: 'merged', decisions: { same_as: 'leonardo-ai' } });
    expect(company.founders).toEqual(['Jane Doe']);
    expect(company.foundedYear).toBe(2022);
    expect(company.stage).toBe('Acquired'); // known, so never overwritten
    expect(applied.ds.evidence.filter((e) => e.company_id === 'leonardo-ai')).toHaveLength(3);
    expect(applied.report.applied[0].filled).toEqual(['founders: Jane Doe', 'foundedYear: 2022']);
    // The disagreement the evidence reveals is reported, not resolved.
    expect(detectConflicts(migrateDataset(applied.ds))).toEqual([expect.objectContaining({ field: 'stage', kind: 'stored_differs' })]);
  });

  it('adds a name as an alias only on a strong name relation: a loose one is held for a person', async () => {
    const { ds, report } = await run([lead({ name: 'Acme Robotics Group', website: 'https://acme.com.au' })], { options: { applyExact: true } });
    expect(only(ds)).toMatchObject({ status: 'merged' });
    expect(ds.identifiers).toEqual([]);
    expect(report.applied[0].held.join(' ')).toMatch(/"Acme Robotics Group" not added as an alias: it matches only loosely/);
    expect(only(ds).notes.map((n) => n.text).join(' ')).toMatch(/matches only loosely/);
  });
});

describe('a possible duplicate', () => {
  it('goes to a person, not to a new company, and the website is not read', async () => {
    const { ds, w } = await run([lead({ name: 'Leonardo.Ai' })]);
    const c = only(ds);
    expect(c).toMatchObject({ status: 'needs_review', resolution: 'LIKELY_MATCH' });
    expect(c.matches[0]).toMatchObject({ id: 'leonardo-ai', outcome: 'LIKELY_MATCH' });
    expect(c.matches[0].reasons.join(' ')).toMatch(/same name/);
    expect(c.confidence.breakdown.caps).toContain('possible duplicate unresolved');
    expect(c.confidence.score).toBeLessThanOrEqual(0.5);
    expect(w.calls).toEqual([]);
  });

  it('is never merged on a matching website with a different name, even when asked to apply exact matches', async () => {
    const { ds, input } = await run([lead({ name: 'Canva Fake', website: 'https://leonardo.ai' })], { options: { applyExact: true } });
    const c = only(ds);
    expect(c).toMatchObject({ status: 'needs_review', resolution: 'LIKELY_MATCH' });
    expect(c.matches[0].reasons.join(' ')).toMatch(/names differ/);
    expect(ds.companies).toEqual(input.companies);
    expect(ds.identifiers).toEqual([]);
  });

  it('finds a company by a former name', async () => {
    const ds0 = dataset([...dataset().companies.map(({ id, slug, ...c }) => c), { name: 'Brumby (formerly GrazeMate)', sector: 'Unknown', sectorFull: 'Unknown', city: 'Sydney', lat: null, lng: null, investors: [], stage: 'Unknown', hiring: false, verified: false, website: '', blurb: '', taskGate: { enabled: false } }]);
    const { ds } = await run([lead({ name: 'GrazeMate' })], { ds: ds0 });
    expect(only(ds).matches[0]).toMatchObject({ id: 'brumby', outcome: 'LIKELY_MATCH' });
    expect(only(ds).matches[0].reasons.join(' ')).toMatch(/former name/);
  });
});

describe('a new company', () => {
  const ZORBLY = { key: 'z1', name: 'Zorbly', website: 'zorbly.com.au', url: 'https://news.example/zorbly', title: 'Zorbly raises $4m seed round',
    text: 'Zorbly raises $4m seed round. Aussie startup', evidence: [{ field: 'last_funding_round', value: 'Seed', confidence: 'medium', note: 'headline' }] };
  const routes = { 'https://zorbly.com.au/': { body: auPage('Zorbly', { abn: '53 004 085 616' }) } };

  it('is checked, its own website is read, and it is left waiting for review with its evidence', async () => {
    const { ds, w } = await run([lead(ZORBLY)], { routes });
    const c = only(ds);
    expect(c).toMatchObject({ status: 'needs_review', resolution: 'NEW_COMPANY', website: 'https://zorbly.com.au', domain: 'zorbly.com.au' });
    expect(w.pages()).toEqual(['https://zorbly.com.au/']);
    expect(c.evidence.map((e) => e.field)).toEqual(expect.arrayContaining(['last_funding_round', 'website', 'address', 'city', 'state', 'founded_year', 'description']));
    expect(c.evidence.find((e) => e.field === 'website')).toMatchObject({ confidence: 'high', verified_at: '2026-10-05T04:00:00.000Z' });
    expect(c.external_ids).toEqual({ abn: '53004085616', acn: null });
    expect(c.aliases).toEqual(['Zorbly Pty Ltd']);
    expect(c.address).toBe('5 Collins Street, Melbourne VIC 3000');
    expect(c.australian.verdict).toBe('yes');
    expect(['yes', 'likely']).toContain(c.startup.verdict);
    expect(c.confidence).toMatchObject({ label: expect.stringMatching(/high|medium/) });
    expect(c.status_history.map((h) => h.status)).toEqual(['candidate', 'needs_review']);
  });

  it('records where and when it was found', async () => {
    const c = only((await run([lead(ZORBLY)], { routes })).ds);
    expect(c.discoveries).toEqual([{
      source_id: 'test.feed', source_kind: 'press', license_basis: 'public_feed', region: 'AU', key: 'z1',
      url: 'https://news.example/zorbly', title: 'Zorbly raises $4m seed round', observed_at: '2026-10-05T04:00:00.000Z',
    }]);
    expect(c.first_discovered_at).toBe('2026-10-05T04:00:00.000Z');
    expect(c.evidence.find((e) => e.field === 'last_funding_round').source).toMatchObject({ kind: 'press', url: 'https://news.example/zorbly', publisher: 'Test feed' });
  });

  it('is not read at all when it already looks foreign: the gate comes before enrichment', async () => {
    const { ds, w } = await run([lead({ name: 'Foo', website: 'https://foo.co.uk', text: 'London-based Foo raises $5m seed round' })], { routes: { 'https://foo.co.uk/': { body: page('Foo') } } });
    const c = only(ds);
    expect(c).toMatchObject({ status: 'rejected', resolution: 'NEW_COMPANY' });
    expect(c.status_history.map((h) => [h.status, h.by])).toEqual([['candidate', 'engine'], ['rejected', 'engine']]);
    expect(c.status_history[1].note).toMatch(/auto-rejected - not Australian: foreign_domain \(foo\.co\.uk\), foreign_hq/);
    expect(w.calls).toEqual([]);
  });

  it('rejects a venture fund as not a startup, keeping the record', async () => {
    const { ds } = await run([lead({ name: 'Eastend Ventures', text: 'Eastend Ventures nails $30 million debut fund to back SA, WA and Queensland startups' })]);
    expect(only(ds)).toMatchObject({ status: 'rejected' });
    expect(only(ds).status_history[1].note).toMatch(/not a startup: fund_or_investor/);
  });

  it('is not rejected for lack of evidence: with little to go on it waits for a person', async () => {
    const { ds } = await run([lead({ name: 'Zorbly', text: 'Payments for pets.' })]);
    expect(only(ds)).toMatchObject({ status: 'needs_review', resolution: 'NEW_COMPANY', australian: { verdict: 'unknown' }, startup: { verdict: 'unknown' } });
  });

  it('records a refusal as a note and carries on, rather than failing', async () => {
    const { ds, report } = await run([lead(ZORBLY)], { routes: { 'https://zorbly.com.au/robots.txt': { body: 'User-agent: *\nDisallow: /\n', headers: { 'content-type': 'text/plain' } } } });
    expect(only(ds)).toMatchObject({ status: 'needs_review' });
    expect(only(ds).notes.map((n) => n.text).join(' ')).toMatch(/Could not read https:\/\/zorbly\.com\.au\/: robots\.txt disallows/);
    expect(report.refused.map((r) => r.code)).toContain('robots_disallow');
  });

  it('notes a website that appears to belong to someone else, and adopts nothing from it', async () => {
    const { ds } = await run([lead(ZORBLY)], { routes: { 'https://zorbly.com.au/': { body: auPage('Totally Different Co', { abn: '53004085616' }) } } });
    const c = only(ds);
    expect(c.external_ids.abn).toBeNull();
    expect(c.evidence.map((e) => e.field)).toEqual(['last_funding_round']);
    expect(c.notes.map((n) => n.text).join(' ')).toMatch(/does not appear to be Zorbly/);
  });

  it('never reads an internal address, LinkedIn or a non-company link given as the website', async () => {
    const { ds, w } = await run([
      lead({ key: 'a', name: 'Alpha', website: 'http://localhost:4000/api/submissions' }),
      lead({ key: 'b', name: 'Beta', website: 'https://www.linkedin.com/company/beta' }),
      lead({ key: 'c', name: 'Gamma', website: 'http://169.254.169.254/latest/meta-data' }),
    ]);
    expect(ds.candidates).toHaveLength(3);
    expect(ds.candidates.every((c) => c.website === null)).toBe(true);
    expect(w.calls).toEqual([]);
  });
});

describe('the same company found more than once', () => {
  it('joins its observations and evidence to one candidate, and reads its website once', async () => {
    const routes = { 'https://zorbly.com.au/': { body: auPage('Zorbly') } };
    const second = fakeSource({ id: 'test.other', kind: 'open_dataset', licenseBasis: 'open_data', leads: [lead({ key: 'other-9', name: 'Zorbly Pty Ltd', website: 'https://www.zorbly.com.au/about', evidence: [{ field: 'city', value: 'Melbourne', confidence: 'medium', note: 'dataset' }] })] });
    const { ds, report, w } = await run([lead({ key: 'z1', name: 'Zorbly', website: 'zorbly.com.au', text: 'Zorbly raises $4m' })], { routes, extraSources: [second] });
    const c = only(ds);
    expect(c.discoveries.map((d) => [d.source_id, d.key])).toEqual([['test.feed', 'z1'], ['test.other', 'other-9']]);
    expect(c.evidence.filter((e) => e.field === 'city').map((e) => e.source.kind).sort()).toEqual(['company_website', 'open_dataset']);
    expect(c.confidence.breakdown.corroboration).toBe(0.1);
    expect(report.attached).toBe(1);
    expect(w.pages()).toEqual(['https://zorbly.com.au/']);
  });

  it('adds nothing on a second run: every lead is recognised as seen', async () => {
    const leads = [lead({ key: 'z1', name: 'Zorbly', website: 'zorbly.com.au', text: 'Zorbly raises $4m' }), lead({ key: 'e1', name: 'Leonardo.Ai', website: 'leonardo.ai' })];
    const routes = { 'https://zorbly.com.au/': { body: auPage('Zorbly') } };
    const first = await run(leads, { routes });
    const second = await run(leads, { routes, ds: first.ds });
    expect(second.report.already_seen).toBe(2);
    expect(second.ds.candidates).toHaveLength(2);
    expect(second.w.calls).toEqual([]);
    expect(second.ds.candidates.map((c) => c.status_history.length)).toEqual(first.ds.candidates.map((c) => c.status_history.length));
  });
});

describe('how a run behaves', () => {
  it('carries on past a source that fails, and says which one and why', async () => {
    const { ds, report } = await run([lead({ name: 'Zorbly' })], { extraSources: [fakeSource({ id: 'broken', fail: Object.assign(new Error('feed gone'), { code: 'http_error' }) })] });
    expect(ds.candidates).toHaveLength(1);
    expect(report.sources).toEqual([{ id: 'test.feed', leads: 1, error: null }, { id: 'broken', leads: 0, error: 'http_error: feed gone' }]);
  });

  it('skips a lead with no usable name, and respects the per-source limit', async () => {
    const leads = [lead({ key: '1', name: '  ' }), lead({ key: '2', name: 'A' }), ...['Alpha', 'Beta', 'Gamma'].map((name) => lead({ key: name, name }))];
    const { ds, report } = await run(leads, { options: { maxLeadsPerSource: 4 } });
    expect(report.skipped.map((s) => s.reason)).toEqual(['no usable company name', 'no usable company name']);
    expect(ds.candidates.map((c) => c.name).sort()).toEqual(['Alpha', 'Beta']);
  });

  it('never approves, merges by itself without being asked, or publishes anything, and leaves the companies alone', async () => {
    const leads = [
      lead({ key: '1', name: 'Zorbly', website: 'zorbly.com.au', text: 'Zorbly raises $4m. Aussie startup' }),
      lead({ key: '2', name: 'Leonardo.Ai', website: 'leonardo.ai' }),
      lead({ key: '3', name: 'Hex' }),
      lead({ key: '4', name: 'Foo', website: 'https://foo.co.uk', text: 'London-based Foo raises $5m' }),
    ];
    const { ds, input } = await run(leads, { routes: { 'https://zorbly.com.au/': { body: auPage('Zorbly') } } });
    expect(ds.candidates.map((c) => c.status).sort()).toEqual(['matched', 'needs_review', 'needs_review', 'rejected']);
    for (const c of ds.candidates) {
      expect(c.status_history[0].status).toBe('candidate');
      expect(['approved', 'merged', 'published']).not.toContain(c.status);
      expect(c.review).toBeNull();
      expect(c.published_company_id).toBeNull();
    }
    expect(ds.companies).toEqual(input.companies);
    expect(ds.evidence).toEqual(input.evidence);
    expect(validateDataset(migrateDataset(ds))).toEqual([]);
  });

  it('does not touch the dataset it was given', async () => {
    const input = dataset();
    const snapshot = structuredClone(input);
    await run([lead({ name: 'Zorbly', website: 'zorbly.com.au' })], { ds: input, routes: { 'https://zorbly.com.au/': { body: auPage('Zorbly') } } });
    expect(input).toEqual(snapshot);
  });

  it('keeps every candidate out of what the public sees: they are never companies', async () => {
    const { ds } = await run([lead({ name: 'Zorbly', website: 'zorbly.com.au' })], { routes: { 'https://zorbly.com.au/': { body: auPage('Zorbly') } } });
    expect(ds.companies.map((c) => c.name)).not.toContain('Zorbly');
    expect(ds.candidates[0].id).toMatch(/^cand-/);
  });
});

describe('a person helping a candidate along', () => {
  it('supplying a website lets the engine read it, check identity again, and match the company it turns out to be', async () => {
    const first = await run([lead({ name: 'Acme', text: 'Acme raises $3m. Aussie startup' })]);
    const c0 = only(first.ds);
    expect(c0).toMatchObject({ status: 'needs_review', resolution: 'POSSIBLE_MATCH' });

    const { fetcher } = fetcherFor({ 'https://acme.com.au/': { body: auPage('Acme Robotics') } });
    const engine = createEngine({ work: structuredClone(first.ds), fetcher, now: () => NOW });
    const after = await engine.enrichCandidate(c0.id, { website: 'acme.com.au', by: 'reviewer' });
    expect(after).toMatchObject({ status: 'matched', resolution: 'EXACT_MATCH' });
    expect(after.matches[0]).toMatchObject({ id: 'acme-robotics', outcome: 'EXACT_MATCH' });
    expect(after.evidence.find((e) => e.field === 'website' && e.source.kind === 'user_supplied')).toMatchObject({ confidence: 'low' });
    expect(after.status_history.map((h) => h.status)).toEqual(['candidate', 'needs_review', 'matched']);
  });

  it('refuses a website that cannot be a company site, and a candidate that is not waiting for review', async () => {
    const first = await run([lead({ name: 'Zorbly' })]);
    const { fetcher } = fetcherFor();
    const engine = createEngine({ work: structuredClone(first.ds), fetcher, now: () => NOW });
    await expect(engine.enrichCandidate(only(first.ds).id, { website: 'https://linkedin.com/company/x', by: 'r' })).rejects.toThrow(/not a usable company website/);
    await expect(engine.enrichCandidate('cand-nobody', { by: 'r' })).rejects.toThrow(/no candidate/);
  });
});
