import { describe, it, expect, afterEach } from 'vitest';
import { tick } from '../src/scheduler/scheduler.js';
import { classifyFundingLead, partitionLeads, recordFunding, companyIndex, MAX_STORY_AGE_DAYS } from '../src/scheduler/funding.js';
import { createFetcher } from '../src/discovery/http.js';
import { detectConflicts, findUnappliedEvidence } from '../src/models/evidence.js';
import { failedImports } from '../src/models/importRuns.js';
import { loadRaw } from '../src/models/dataset.js';
import { makeDataDir, readDataDir, removeMadeDirs } from './helpers/store.js';
import { dataset, co, NOW, ISO, DAY, at, scriptedWeb } from './helpers/scheduler.js';
import { lead as makeLead, fakeSource as makeSource } from './helpers/discovery.js';

afterEach(removeMadeDirs);

const L = makeLead;
const round = (value = 'Seed') => ({ field: 'last_funding_round', value, confidence: 'medium', note: 'headline' });
const investor = (value) => ({ field: 'investors', value, confidence: 'medium', note: 'headline' });
const city = (value) => ({ field: 'city', value, confidence: 'medium', note: 'headline' });

const companies = () => [
  co('Acme Robotics', { website: 'https://acme.com.au', investors: ['Blackbird'], stage: 'Pre-seed', last_funding_round: 'Pre-seed', last_funding_date: '2025-03' }),
  co('Hex', { website: '' }), // a short name
  co('Zed Labs', { city: 'Melbourne', lat: -37.81, lng: 144.96 }),
];
const work = (list = companies()) => structuredClone(dataset(list));
const slug = (name) => name.toLowerCase().replace(/\s+/g, '-');
const story = (name, evidence, over = {}) => L({ key: `${slug(name)}-1`, name, url: `https://news.example/${slug(name)}`, title: `${name} raises a round`, evidence, extraction: { method: 'excerpt', agreed: true }, ...over });
const classify = (l, w = work()) => classifyFundingLead(l, companyIndex(w), w, { at: ISO });

describe('which funding stories are plainly about a company we have', () => {
  it('takes a story that names the company and an investor it already has', () => {
    const c = classify(story('Acme Robotics', [round('Seed'), investor('Blackbird')]));
    expect(c).toMatchObject({ kind: 'attach', round: 'Seed', shared: ['Blackbird'], date: '2026-10-05' });
    expect(c.company.id).toBe('acme-robotics');
  });

  it('takes a story that puts the company in the city the record gives', () => {
    expect(classify(story('Zed Labs', [round('Series A'), city('Melbourne')]))).toMatchObject({ kind: 'attach', sameCity: true, round: 'Series A' });
  });

  it.each([
    ['says nothing about a round', story('Acme Robotics', [investor('Blackbird')]), 'no_round'],
    ['was read by the weakest guess', story('Acme Robotics', [round(), investor('Blackbird')], { extraction: { method: 'excerpt-round', agreed: false } }), 'weak_extraction'],
    ['has no date', story('Acme Robotics', [round(), investor('Blackbird')], { observed_at: null, retrieved_at: null }), 'undated'],
    ['is too old to be news', story('Acme Robotics', [round(), investor('Blackbird')], { observed_at: at(NOW - (MAX_STORY_AGE_DAYS + 5) * DAY) }), 'old'],
    ['is about nobody we have', story('Unknown Startup', [round(), investor('Blackbird')]), 'no_company'],
    ['names the company and nothing that agrees with what we hold', story('Acme Robotics', [round()]), 'uncorroborated'],
    ['names an investor the company does not have', story('Acme Robotics', [round(), investor('AirTree')]), 'uncorroborated'],
    ['names the company in a different city', story('Zed Labs', [round(), city('Perth')]), 'uncorroborated'],
    ['is about a company with a short name and nothing else to go on', story('Hex', [round()]), 'no_company'],
  ])('leaves alone a story that %s', (_, l, reason) => {
    expect(classify(l)).toEqual({ kind: 'pass', reason });
  });

  it('leaves alone a story whose name fits two companies', () => {
    const w = work([co('Acme Robotics', { website: 'https://acme.com.au', investors: ['Blackbird'] }), co('Acme Robotics', { website: 'https://acme.example', investors: ['Blackbird'] })]);
    expect(classify(story('Acme Robotics', [round(), investor('Blackbird')]), w)).toEqual({ kind: 'pass', reason: 'ambiguous' });
  });

  it('splits a feed into the stories that are ours and the rest, counting why each was left', () => {
    const w = work();
    const leads = [story('Acme Robotics', [round(), investor('Blackbird')]), story('Unknown Startup', [round()]), story('Zed Labs', [round()])];
    const { attach, rest, passed } = partitionLeads(leads, w, { at: ISO });
    expect(attach.map((a) => a.company.id)).toEqual(['acme-robotics']);
    expect(rest.map((l) => l.name)).toEqual(['Unknown Startup', 'Zed Labs']);
    expect(passed).toEqual({ no_company: 1, uncorroborated: 1 });
  });
});

describe('recording what a story says', () => {
  const attach = (w, l = story('Acme Robotics', [round('Seed'), investor('Blackbird'), investor('AirTree')], { observed_at: '2026-09-30T00:00:00.000Z' })) => partitionLeads([l], w, { at: ISO }).attach;

  it('adds the round, the date when it is later than the record\'s, and the investors, each citing the story', () => {
    const w = work();
    const r = recordFunding(w, attach(w), { at: ISO });
    expect(r).toMatchObject({ stories: 1, evidence_added: 4, companies: ['acme-robotics'] });
    const rows = w.evidence.filter((e) => e.company_id === 'acme-robotics');
    expect(rows.map((e) => [e.field, e.value]).sort()).toEqual([['investors', 'AirTree'], ['investors', 'Blackbird'], ['last_funding_date', '2026-09-30'], ['last_funding_round', 'Seed']]);
    expect(rows.every((e) => e.confidence === 'medium' && e.status === 'active')).toBe(true);
    const source = w.sources.find((s) => s.id === rows[0].source_id);
    expect(source).toMatchObject({ kind: 'press', url: 'https://news.example/acme-robotics', publisher: 'Test feed' });
  });

  it('is idempotent: reading the same story again adds nothing', () => {
    const w = work();
    recordFunding(w, attach(w), { at: ISO });
    const once = JSON.stringify(w.evidence);
    const again = recordFunding(w, attach(w), { at: at(NOW + DAY) });
    expect(again.evidence_added).toBe(0);
    expect(JSON.stringify(w.evidence)).toBe(once);
    expect(w.refresh_state.find((r) => r.target_id === 'acme-robotics' && r.facet === 'funding')).toMatchObject({ checks: 2, last_changed_at: ISO, last_outcome: 'unchanged', next_check_at: null });
  });

  it('never changes the company: a different round is a conflict, a new investor is a suggestion', () => {
    const w = work();
    const before = JSON.stringify(w.companies);
    recordFunding(w, attach(w), { at: ISO });
    expect(JSON.stringify(w.companies)).toBe(before);
    const conflicts = detectConflicts(w).filter((c) => c.company_id === 'acme-robotics');
    expect(conflicts.map((c) => [c.field, c.kind, c.stored])).toEqual(expect.arrayContaining([['last_funding_round', 'stored_differs', 'Pre-seed'], ['last_funding_date', 'stored_differs', '2025-03']]));
    expect(findUnappliedEvidence(w).filter((u) => u.field === 'investors').map((u) => u.value)).toEqual(['AirTree']);
  });

  it('does not offer a date that is no later than the one the record has', () => {
    const w = work([co('Acme Robotics', { website: 'https://acme.com.au', investors: ['Blackbird'], last_funding_round: 'Seed', last_funding_date: '2026-09' })]);
    recordFunding(w, attach(w), { at: ISO });
    expect(w.evidence.filter((e) => e.field === 'last_funding_date')).toEqual([]);
    expect(detectConflicts(w)).toEqual([]); // the round agrees
  });

  it('does not put back what a person turned down', () => {
    const w = work();
    recordFunding(w, attach(w), { at: ISO });
    const row = w.evidence.find((e) => e.field === 'last_funding_round');
    Object.assign(row, { status: 'rejected', note: 'wrong company' });
    const again = recordFunding(w, attach(w), { at: at(NOW + DAY) });
    expect(again.evidence_added).toBe(0);
    expect(w.evidence.filter((e) => e.field === 'last_funding_round')).toHaveLength(1);
  });
});

// A tick over a funding feed and the discovery engine, with the real store and no network.
async function feedSetup({ leads, list = companies(), source = null } = {}) {
  const dir = await makeDataDir(dataset(list));
  const clock = { now: NOW };
  const feed = source ?? makeSource({ id: 'rss.test-funding', kind: 'press', leads });
  const w = scriptedWeb({});
  const run = (over = {}) => tick({
    dir, now: () => clock.now, sources: [feed], by: 'tester', jobs: ['funding', 'discovery'], limits: { concurrency: 1 },
    fetcher: createFetcher({ fetchImpl: w.fetchImpl, resolveHost: async () => ['93.184.216.34'], sleep: async () => {}, now: () => clock.now }), ...over,
  });
  return { dir, clock, run, feed, w };
}
const byJob = (r) => Object.fromEntries(r.runs.map((x) => [x.job, x]));

describe('the funding and discovery jobs', () => {
  const leads = () => [
    story('Acme Robotics', [round('Seed'), investor('Blackbird')], { observed_at: '2026-09-30T00:00:00.000Z' }),
    L({ key: 'z1', name: 'Zorbly', text: 'Payments for pets.', url: 'https://news.example/zorbly', title: 'Zorbly raises $4m', evidence: [round('Pre-seed')] }),
  ];

  it('records the story about our company as evidence and sends the stranger to review, each once', async () => {
    const t = await feedSetup({ leads: leads() });
    const r = await t.run();
    const ds = await readDataDir(t.dir);

    expect(byJob(r).funding).toMatchObject({ status: 'ok', due: 1, processed: 1, changed: 1 });
    expect(byJob(r).funding.summary).toMatch(/2 stories, 1 about our companies \(\d+ evidence row\(s\) added to 1 company\), 1 left to discovery/);
    expect(ds.evidence.filter((e) => e.company_id === 'acme-robotics' && e.field === 'last_funding_round')).toEqual([expect.objectContaining({ value: 'Seed', confidence: 'medium' })]);

    expect(byJob(r).discovery).toMatchObject({ status: 'ok', due: 1, processed: 1, changed: 1 });
    expect(ds.candidates.map((c) => [c.name, c.status])).toEqual([['Zorbly', 'needs_review']]); // not "Acme Robotics, a possible duplicate of Acme Robotics"
    expect(ds.companies).toHaveLength(3); // nothing was published
    expect(ds.import_runs).toEqual([expect.objectContaining({ trigger: 'scheduler', by: 'tester', status: 'ok', sources: [{ id: 'rss.test-funding', leads: 1, error: null }] })]);
    expect(ds.audit_trail.filter((a) => a.action === 'scheduler.run').map((a) => a.target.id.split('-').at(-1)).sort()).toEqual(['discovery', 'funding']);
  });

  it('reads the feed once for both jobs', async () => {
    let reads = 0;
    const feed = { ...makeSource({ id: 'rss.test-funding', kind: 'press', leads: leads() }), async discover() { reads += 1; return leads(); } };
    const t = await feedSetup({ source: feed });
    await t.run();
    expect(reads).toBe(1);
  });

  it('does nothing when run again at the same moment, and is not fooled by the same stories later', async () => {
    const t = await feedSetup({ leads: leads() });
    await t.run();
    const first = await loadRaw(t.dir);

    const same = await t.run();
    expect(same.runs.every((x) => x.status === 'idle')).toBe(true);
    const second = await loadRaw(t.dir);
    for (const file of Object.keys(first)) if (file !== 'job_runs.json') expect(second[file], file).toBe(first[file]);

    t.clock.now += 3 * DAY; // the feed still holds the same stories
    const later = await t.run();
    expect(byJob(later).funding).toMatchObject({ status: 'ok', changed: 0 }); // seen, nothing new
    expect(byJob(later).discovery).toMatchObject({ status: 'ok', changed: 0 });
    const ds = await readDataDir(t.dir);
    expect(ds.candidates).toHaveLength(1);
    expect(ds.evidence.filter((e) => e.company_id === 'acme-robotics' && e.field === 'last_funding_round')).toHaveLength(1);
    expect(ds.import_runs).toHaveLength(2);
  });

  it('leaves everything to discovery when the funding job is not running', async () => {
    const t = await feedSetup({ leads: leads() });
    const r = await t.run({ jobs: ['discovery'] });
    const ds = await readDataDir(t.dir);
    expect(byJob(r).discovery).toMatchObject({ status: 'ok' });
    expect(ds.candidates.map((c) => c.name).sort()).toEqual(['Acme Robotics', 'Zorbly']); // a person decides about both
    expect(ds.evidence.filter((e) => e.company_id === 'acme-robotics')).toEqual([]);
  });

  it('reads a source only when its own clock says so', async () => {
    const t = await feedSetup({ leads: leads() });
    await t.run();
    t.clock.now += 3600000; // an hour later
    const r = await t.run();
    expect(byJob(r).funding.summary).toBe('No feed is due');
    expect(byJob(r).discovery.summary).toBe('No source is due');
    const ds = await readDataDir(t.dir);
    const row = ds.refresh_state.find((x) => x.scope === 'source' && x.facet === 'funding');
    expect(Date.parse(row.next_check_at) - Date.parse(row.last_checked_at)).toBeGreaterThan(DAY);
  });

  it('backs a failing feed off, and shows it where failed imports are shown', async () => {
    const feed = makeSource({ id: 'rss.test-funding', kind: 'press', fail: Object.assign(new Error('feed gone'), { code: 'http_error' }) });
    const t = await feedSetup({ source: feed });
    const r = await t.run();
    expect(byJob(r).funding).toMatchObject({ status: 'failed', failed: 1, error: expect.stringMatching(/feed gone/) });
    expect(byJob(r).discovery).toMatchObject({ status: 'failed', failed: 1 });
    const ds = await readDataDir(t.dir);
    expect(failedImports(ds.import_runs)).toEqual([expect.objectContaining({ source_id: 'rss.test-funding', error: expect.stringMatching(/feed gone/) })]);
    const row = ds.refresh_state.find((x) => x.scope === 'source' && x.facet === 'funding');
    expect(row).toMatchObject({ failures: 1, last_outcome: 'failed', checks: 0 });
    expect(Date.parse(row.next_check_at)).toBeGreaterThan(NOW);
    expect(Date.parse(row.next_check_at)).toBeLessThan(NOW + DAY);
  });

  it('reads a source that asked for its own pace at that pace', async () => {
    const dir = await makeDataDir(dataset(companies()));
    const src = makeSource({ id: 'submissions', kind: 'user_submission', licenseBasis: 'user_submission', leads: [] });
    await tick({ dir, now: () => NOW, sources: [src], sourceConfig: [{ id: 'submissions', refresh_days: 0.25 }], jobs: ['discovery'], by: 'tester', fetcher: createFetcher({ fetchImpl: scriptedWeb({}).fetchImpl, resolveHost: async () => ['93.184.216.34'], sleep: async () => {}, now: () => NOW }) });
    const row = (await readDataDir(dir)).refresh_state.find((x) => x.scope === 'source' && x.facet === 'discovery');
    expect(Date.parse(row.next_check_at) - NOW).toBeLessThan(0.4 * DAY);
  });
});
