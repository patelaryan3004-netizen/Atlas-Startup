import { describe, it, expect, afterEach } from 'vitest';
import { utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tick, plan } from '../src/scheduler/scheduler.js';
import { createFetcher } from '../src/discovery/http.js';
import { loadRaw } from '../src/models/dataset.js';
import { transact } from '../src/models/store.js';
import { startJobRun } from '../src/models/jobRuns.js';
import { SCHEDULER_LOCK_FILE } from '../src/scheduler/lock.js';
import { detectConflicts } from '../src/models/evidence.js';
import { makeDataDir, readDataDir, removeMadeDirs } from './helpers/store.js';
import { dataset, co, NOW, ISO, auPage, scriptedWeb, DAY, at } from './helpers/scheduler.js';

afterEach(removeMadeDirs);

const html = (body, title = 'Home') => ({ body: `<html><head><title>${title}</title></head><body>${body}</body></html>`, headers: { 'content-type': 'text/html' } });
const json = (body) => ({ body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const HIRING = { hiring: true, hiring_status: 'hiring' };
const SITE_JOBS = ['hiring', 'status', 'enrichment'];

const companies = () => [
  co('Acme Robotics', { website: 'https://acme.com.au', ...HIRING }),
  co('Beta Labs', { website: 'https://beta.example.com', ...HIRING }),
  co('Gamma Works', { website: 'https://gamma.example.com', ...HIRING }),
  co('Delta'), // no website
];
const routes = () => ({
  'https://acme.com.au/': { body: auPage('Acme Robotics') }, 'https://beta.example.com/': { body: auPage('Beta Labs') }, 'https://gamma.example.com/': { body: auPage('Gamma Works') },
});

// A data directory, a scripted web, a clock, and a way to run a tick that is like a real one: a new fetcher each time.
async function setup({ list = companies(), web = routes(), extra = {}, dir = null } = {}) {
  const data = dir ?? await makeDataDir(dataset(list, extra));
  const w = scriptedWeb(web);
  const clock = { now: NOW };
  const now = () => clock.now;
  const fetcher = () => createFetcher({ fetchImpl: w.fetchImpl, resolveHost: async () => ['93.184.216.34'], sleep: async () => {}, now });
  return {
    dir: data, w, clock, now,
    run: (over = {}) => tick({ dir: data, now, fetcher: fetcher(), sources: [], by: 'tester', jobs: SITE_JOBS, limits: { concurrency: 1 }, ...over }),
    forward: (ms) => { clock.now += ms; },
  };
}
const runsOf = (r) => Object.fromEntries(r.runs.map((x) => [x.job, x]));
const stateRow = (ds, id, facet, scope = 'company') => ds.refresh_state.find((r) => r.scope === scope && r.target_id === id && r.facet === facet);

describe('the first tick', () => {
  it('reads what is due, moves each company\'s clocks, changes no company, and logs every job', async () => {
    const t = await setup();
    const before = await readDataDir(t.dir);
    const r = await t.run({ jobs: [...SITE_JOBS, 'quality'] });
    const ds = await readDataDir(t.dir);

    expect(r).toMatchObject({ status: 'ok', stopped_for: null });
    expect(Object.keys(runsOf(r)).sort()).toEqual(['enrichment', 'hiring', 'quality', 'status']);
    expect(runsOf(r).hiring).toMatchObject({ status: 'ok', due: 3, processed: 3, failed: 0, deferred: 0, tick_id: r.tick_id, trigger: 'cli', by: 'tester', mode: 'suggest', dry_run: false });
    expect(runsOf(r).enrichment).toMatchObject({ status: 'ok', due: 9, processed: 9 });
    expect(runsOf(r).enrichment.changed).toBeGreaterThan(0);
    expect(runsOf(r).quality).toMatchObject({ status: 'ok', processed: 1 });
    expect(runsOf(r).hiring.summary).toMatch(/^Checked careers pages and job boards: 3 read/);
    expect(ds.job_runs.every((x) => x.finished_at && x.status !== 'running')).toBe(true);

    // every company with a website has a clock for every facet, set in the future; the one without has none
    for (const id of ['acme-robotics', 'beta-labs', 'gamma-works']) {
      for (const facet of ['hiring', 'status', 'description', 'profile', 'founded_year']) {
        const row = stateRow(ds, id, facet);
        expect(row, `${id} ${facet}`).toMatchObject({ checks: 1, failures: 0, last_checked_at: ISO });
        expect(Date.parse(row.next_check_at)).toBeGreaterThan(NOW);
      }
    }
    expect(ds.refresh_state.some((x) => x.target_id === 'delta')).toBe(false);

    // suggest mode: evidence was recorded, no company was touched
    expect(ds.evidence.filter((e) => e.company_id === 'acme-robotics').map((e) => e.field)).toEqual(expect.arrayContaining(['description', 'address']));
    const stable = (c) => ({ ...c, last_verified_at: null, confidence_score: null, source_ids: [], updated_at: null });
    expect(ds.companies.map(stable)).toEqual(before.companies.map(stable));
  });

  it('puts the run in the audit trail, as the scheduler, for the jobs that found something', async () => {
    const t = await setup();
    await t.run();
    const ds = await readDataDir(t.dir);
    const rows = ds.audit_trail.filter((a) => a.action === 'scheduler.run');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({ actor: 'tester', role: 'system', via: 'worker', target: { type: 'job_run', id: expect.stringMatching(/^jr-/) } });
    expect(ds.audit_trail.filter((a) => a.action === 'enrichment.task').every((a) => a.actor === 'tester')).toBe(true);
  });

  it('reads each site politely: robots.txt, then pages, never more than the limit says', async () => {
    const t = await setup();
    await t.run({ limits: { concurrency: 1, maxSites: 2 } });
    const hosts = new Set(t.w.pages().map((u) => new URL(u).host));
    expect(hosts.size).toBe(2);
    expect(t.w.calls.filter((u) => u.endsWith('/robots.txt')).length).toBe(2);
  });
});

describe('running it again', () => {
  it('does nothing the second time at the same moment, but says so: only the run log changes', async () => {
    const t = await setup();
    await t.run({ jobs: [...SITE_JOBS, 'quality'] });
    const first = await loadRaw(t.dir);
    const calls = t.w.calls.length;

    const r = await t.run({ jobs: [...SITE_JOBS, 'quality'] });
    const second = await loadRaw(t.dir);

    expect(t.w.calls.length).toBe(calls); // not a single request
    expect(r.runs.map((x) => x.status)).toEqual(['idle', 'idle', 'idle', 'idle']);
    expect(r.runs.every((x) => /Nothing was due|Not due yet/.test(x.summary))).toBe(true);
    for (const file of Object.keys(first)) {
      if (file === 'job_runs.json') continue;
      expect(second[file], `${file} changed`).toBe(first[file]);
    }
    expect(JSON.parse(second['job_runs.json'])).toHaveLength(8);
  });

  it('reads again only what has come due, when it does: hiring after a few days, the rest not for weeks', async () => {
    const t = await setup();
    await t.run();
    const calls = t.w.calls.length;
    t.forward(6 * DAY);
    const r = await t.run();
    const ds = await readDataDir(t.dir);

    expect(runsOf(r).hiring).toMatchObject({ due: 3, processed: 3 });
    expect(runsOf(r).status).toMatchObject({ due: 0, processed: 3 }); // not due, but the homepage was read anyway: it is checked for free
    expect(runsOf(r).enrichment).toMatchObject({ status: 'idle', due: 0, processed: 0 });
    // three more homepages and nothing else (these pages link to no careers page), each with its robots.txt
    const fresh = t.w.calls.slice(calls);
    expect(fresh.filter((u) => !u.endsWith('/robots.txt')).sort()).toEqual(['https://acme.com.au/', 'https://beta.example.com/', 'https://gamma.example.com/']);
    expect(stateRow(ds, 'acme-robotics', 'hiring')).toMatchObject({ checks: 2, last_checked_at: at(NOW + 6 * DAY) });
    expect(stateRow(ds, 'acme-robotics', 'description')).toMatchObject({ checks: 1, last_checked_at: ISO });
  });

  it('carries on where it stopped when the limit cut a run short, and never repeats a company', async () => {
    const list = Array.from({ length: 5 }, (_, i) => co(`Shop ${i}`, { website: `https://shop${i}.example.com`, ...HIRING }));
    const web = Object.fromEntries(list.map((c, i) => [`https://shop${i}.example.com/`, { body: auPage(c.name) }]));
    const t = await setup({ list, web });
    const a = await t.run({ limits: { concurrency: 1, maxSites: 2 } });
    expect(runsOf(a).hiring).toMatchObject({ due: 5, processed: 2, deferred: 3 });
    const b = await t.run({ limits: { concurrency: 1, maxSites: 2 } });
    expect(runsOf(b).hiring).toMatchObject({ due: 3, processed: 2, deferred: 1 });
    const c = await t.run({ limits: { concurrency: 1, maxSites: 2 } });
    expect(runsOf(c).hiring).toMatchObject({ due: 1, processed: 1, deferred: 0 });
    const d = await t.run({ limits: { concurrency: 1, maxSites: 2 } });
    expect(runsOf(d).hiring.status).toBe('idle');
    const homepages = t.w.pages();
    expect(homepages.length).toBe(5); // each company's homepage once, across all four runs
    expect(new Set(homepages).size).toBe(5);
  });

  it('stops starting new sites when the request budget is spent, says which limit, and leaves the rest due', async () => {
    const list = Array.from({ length: 4 }, (_, i) => co(`Shop ${i}`, { website: `https://shop${i}.example.com`, ...HIRING }));
    const web = Object.fromEntries(list.map((c, i) => [`https://shop${i}.example.com/`, { body: auPage(c.name) }]));
    const t = await setup({ list, web });
    const r = await t.run({ limits: { concurrency: 1, maxRequests: 14 } });
    expect(r.stopped_for).toBe('requests');
    expect(runsOf(r).hiring.processed).toBeLessThan(4);
    expect(runsOf(r).hiring.budget).toMatchObject({ max_requests: 14, stopped_for: 'requests' });
    const next = await t.run({ limits: { concurrency: 1 } });
    expect(runsOf(next).hiring.processed + runsOf(r).hiring.processed).toBe(4);
  });
});

describe('when things go wrong', () => {
  it('retries a site that times out with the queue\'s own back-off, then backs the facet off and says it failed', async () => {
    const web = routes();
    web['https://beta.example.com/'] = Object.assign(new Error('the operation timed out'), { name: 'TimeoutError' });
    const t = await setup({ web });
    const first = await t.run();
    expect(runsOf(first).hiring).toMatchObject({ processed: 2, failed: 0 }); // the failing site is retrying, not failed yet
    t.forward(11 * 60000);
    await t.run();
    t.forward(61 * 60000);
    const third = await t.run();
    const ds = await readDataDir(t.dir);
    expect(runsOf(third).hiring).toMatchObject({ status: 'partial', failed: 1 });
    expect(stateRow(ds, 'beta-labs', 'hiring')).toMatchObject({ failures: 1, last_outcome: 'failed', checks: 0, last_error: expect.stringMatching(/timeout/) });
    expect(Date.parse(stateRow(ds, 'beta-labs', 'hiring').next_check_at)).toBeGreaterThan(t.now());
    expect(stateRow(ds, 'acme-robotics', 'hiring')).toMatchObject({ failures: 0, checks: 1 });
    expect(third.status).toBe('partial');
  });

  it('leaves a website alone after it said to slow down, in the next run and until its wait is over', async () => {
    const web = routes();
    web['https://acme.com.au/robots.txt'] = { status: 429, body: 'slow down', headers: { 'content-type': 'text/plain', 'retry-after': '172800' } };
    const t = await setup({ web });
    await t.run();
    let ds = await readDataDir(t.dir);
    const host = stateRow(ds, 'acme.com.au', 'access', 'host');
    expect(host).toMatchObject({ failures: 1, last_outcome: 'failed' });
    expect(daysBetween(host.last_attempt_at, host.next_check_at)).toBeGreaterThanOrEqual(2); // it asked for two days

    t.forward(2 * 3600000);
    const before = t.w.calls.length;
    await t.run({ force: true });
    expect(t.w.calls.slice(before).filter((u) => u.includes('acme.com.au'))).toEqual([]);

    t.forward(3 * DAY);
    await t.run();
    expect(t.w.calls.some((u) => u === 'https://acme.com.au/robots.txt' && t.w.calls.lastIndexOf(u) > before)).toBe(true);
    ds = await readDataDir(t.dir);
    expect(stateRow(ds, 'acme.com.au', 'access', 'host').failures).toBeGreaterThanOrEqual(1);
  });

  it('marks a run that died as interrupted, and runs normally', async () => {
    const t = await setup();
    await transact(t.dir, (work, { at: when }) => { startJobRun(work.job_runs, { job: 'hiring', tickId: 'tick-19990101000000000', at: when }); return {}; }, { now: t.now });
    expect((await readDataDir(t.dir)).job_runs[0]).toMatchObject({ status: 'running', finished_at: null });
    const r = await t.run();
    const old = (await readDataDir(t.dir)).job_runs.find((x) => x.tick_id === 'tick-19990101000000000');
    expect(old).toMatchObject({ status: 'failed', summary: 'Interrupted', error: expect.stringMatching(/stopped before it finished/) });
    expect(r.status).toBe('ok');
  });

  it('records a failure in one job without stopping the others', async () => {
    const t = await setup();
    // the feeds phase breaks (a source that cannot be read is not the thing: its discover throws something unexpected)
    const broken = { id: 'broken.feed', kind: 'press', region: 'AU', license: { basis: 'public_feed' }, licenseBasis: 'public_feed', discover: async () => { throw new Error('the feed is on fire'); } };
    const r = await t.run({ jobs: ['discovery', 'hiring'], sources: [broken] });
    expect(runsOf(r).discovery).toMatchObject({ status: 'failed', error: expect.stringMatching(/on fire/) });
    expect(runsOf(r).hiring).toMatchObject({ status: 'ok', processed: 3 });
    expect(r.status).toBe('failed');
    const ds = await readDataDir(t.dir);
    expect(stateRow(ds, 'broken.feed', 'discovery', 'source')).toMatchObject({ failures: 1, last_outcome: 'failed' });
  });
});

describe('only one tick at a time', () => {
  it('turns a second tick away, and says so in the run log, while the first holds the lock', async () => {
    const t = await setup();
    await writeFile(path.join(t.dir, SCHEDULER_LOCK_FILE), JSON.stringify({ pid: 4242, at: ISO }));
    const calls = t.w.calls.length;
    const r = await t.run();
    expect(r.status).toBe('locked');
    expect(r.held).toMatchObject({ pid: 4242, since: ISO });
    expect(t.w.calls.length).toBe(calls);
    const ds = await readDataDir(t.dir);
    expect(ds.job_runs).toHaveLength(3);
    expect(ds.job_runs.every((x) => x.status === 'skipped' && /another scheduler tick has held the lock since/.test(x.summary))).toBe(true);
  });

  it('takes over a lock left by a tick that died', async () => {
    const t = await setup();
    const lock = path.join(t.dir, SCHEDULER_LOCK_FILE);
    await writeFile(lock, JSON.stringify({ pid: 1, at: ISO }));
    const old = new Date(Date.now() - 3 * 3600000);
    await utimes(lock, old, old);
    const r = await t.run();
    expect(r.status).toBe('ok');
  });

  it('lets go of the lock when it finishes, so the next tick can run', async () => {
    const t = await setup();
    await t.run();
    await expect(t.run()).resolves.toMatchObject({ status: 'ok' });
  });
});

describe('looking without touching', () => {
  it('says what is due and writes nothing and reads nothing', async () => {
    const t = await setup();
    const before = await loadRaw(t.dir);
    const p = await plan({ dir: t.dir, now: t.now, jobs: [...SITE_JOBS, 'quality'], sources: [] });
    expect(p.reads).toMatchObject({ due: 3, planned: 3, never: 3, skipped: { no_website: 1 } });
    expect(p.reads.dueByFacet).toEqual({ hiring: 3, status: 3, profile: 3, description: 3, founded_year: 3 });
    expect(p.quality.summary).toMatch(/^Checked 4 companies/);
    expect(await loadRaw(t.dir)).toEqual(before);
    expect(t.w.calls).toEqual([]);
  });
});

describe('what it finds on real-looking pages', () => {
  const CAREERS = 'https://acme.com.au/careers';
  // no address on these pages, so the only thing in dispute is the one the test is about
  const homeWithCareers = () => ({ body: auPage('Acme Robotics', { address: false }).replace('</body>', '<a href="/careers">Careers</a></body>') });
  const board = (jobs) => json(jobs);

  it('records open roles from the job board the careers page links to, and the hiring evidence, without touching the company', async () => {
    const web = {
      'https://acme.com.au/': homeWithCareers(),
      [CAREERS]: html('<p>Join us</p><a href="https://jobs.lever.co/acme-robotics">See roles</a>', 'Careers'),
      'https://api.lever.co/v0/postings/acme-robotics?mode=json': board([{ text: 'Robotics Engineer', categories: { location: 'Sydney', commitment: 'Full-time' }, hostedUrl: 'https://jobs.lever.co/acme-robotics/1', createdAt: 1759300000000 }]),
    };
    const t = await setup({ list: [co('Acme Robotics', { website: 'https://acme.com.au', hiring: false })], web });
    const r = await t.run({ jobs: ['hiring'] });
    const ds = await readDataDir(t.dir);
    expect(runsOf(r).hiring).toMatchObject({ status: 'ok', processed: 1, changed: 1 });
    expect(ds.jobs.filter((j) => j.company_id === 'acme-robotics')).toEqual([expect.objectContaining({ title: 'Robotics Engineer', status: 'open' })]);
    expect(ds.evidence.find((e) => e.field === 'hiring_status' && e.value === 'hiring')).toMatchObject({ confidence: 'high' });
    expect(ds.companies[0]).toMatchObject({ hiring: false }); // suggest mode: a person decides
    expect(stateRow(ds, 'acme-robotics', 'hiring')).toMatchObject({ last_outcome: 'changed', last_changed_at: ISO, last_verified_at: ISO });
  });

  it('fills the hiring flag from those roles only when told to, and only the policy allows it', async () => {
    const web = {
      'https://acme.com.au/': homeWithCareers(),
      [CAREERS]: html('<a href="https://jobs.lever.co/acme-robotics">roles</a>', 'Careers'),
      'https://api.lever.co/v0/postings/acme-robotics?mode=json': board([{ text: 'Robotics Engineer', categories: { location: 'Sydney' }, hostedUrl: 'https://jobs.lever.co/acme-robotics/1' }]),
    };
    const t = await setup({ list: [co('Acme Robotics', { website: 'https://acme.com.au', hiring: false })], web });
    await t.run({ jobs: ['hiring'], mode: 'fill' });
    expect((await readDataDir(t.dir)).companies[0]).toMatchObject({ hiring: true, hiring_status: 'hiring' });
  });

  it('notices a company that says it was acquired: evidence and a signal for a person, never a change to the company', async () => {
    const acquired = { body: auPage('Acme Robotics', { address: false }).replace('<p>', '<p>Acme Robotics has been acquired by Beta Group. ') };
    const t = await setup({ list: [co('Acme Robotics', { website: 'https://acme.com.au', ...HIRING })], web: { 'https://acme.com.au/': acquired } });
    const r = await t.run({ jobs: ['status'] });
    const ds = await readDataDir(t.dir);

    expect(ds.evidence.find((e) => e.field === 'company_status')).toMatchObject({ value: 'acquired', confidence: 'medium', note: expect.stringMatching(/acquired by Beta Group/) });
    expect(ds.companies[0].company_status ?? null).toBeNull();
    const row = stateRow(ds, 'acme-robotics', 'status');
    expect(row.meta.signals).toEqual([expect.objectContaining({ code: 'acquired_notice', other: 'Beta Group', since: ISO })]);
    expect(row).toMatchObject({ last_outcome: 'changed', last_verified_at: null });
    expect(runsOf(r).status).toMatchObject({ status: 'ok', changed: 1 });
    expect(runsOf(r).status.details.watch).toEqual([{ company_id: 'acme-robotics', signals: ['acquired_notice'] }]);
    // against a record that says "active" it is a conflict for a person to settle
    const asActive = { ...ds, companies: ds.companies.map((c) => ({ ...c, company_status: 'active' })) };
    expect(detectConflicts(asActive).filter((c) => c.field === 'company_status').map((c) => c.kind)).toEqual(['stored_differs']);
  });

  it('notices a job board that has gone empty, as evidence that conflicts with a record that says "hiring"', async () => {
    const web = {
      'https://acme.com.au/': homeWithCareers(),
      [CAREERS]: html('<a href="https://jobs.lever.co/acme-robotics">roles</a>', 'Careers'),
      'https://api.lever.co/v0/postings/acme-robotics?mode=json': board([]),
    };
    const t = await setup({ list: [co('Acme Robotics', { website: 'https://acme.com.au', ...HIRING })], web });
    await t.run({ jobs: ['hiring'] });
    const ds = await readDataDir(t.dir);
    expect(ds.evidence.find((e) => e.field === 'hiring_status')).toMatchObject({ value: 'not_hiring', confidence: 'medium', note: expect.stringMatching(/listed no open roles/) });
    expect(ds.companies[0]).toMatchObject({ hiring: true });
    expect(detectConflicts(ds).filter((c) => c.field === 'hiring_status').map((c) => [c.stored, c.kind])).toEqual([['hiring', 'stored_differs']]);
  });
});

describe('the clocks follow work a person queued by hand', () => {
  it('stamps a company whose site was read through the ordinary queue, so the scheduler does not read it again at once', async () => {
    const t = await setup();
    const { runQueue } = await import('../src/enrichment/worker.js');
    const { enqueueTask, WANTABLE, PRIORITY } = await import('../src/models/enrichmentQueue.js');
    await transact(t.dir, (work, { at: when }) => { enqueueTask(work, { kind: 'company', targetId: 'acme-robotics', priority: PRIORITY.manual, reason: 'manual', wanted: WANTABLE, by: 'aryan', at: when }); return {}; }, { now: t.now });
    await runQueue({ dir: t.dir, fetcher: createFetcher({ fetchImpl: t.w.fetchImpl, resolveHost: async () => ['93.184.216.34'], sleep: async () => {}, now: t.now }), now: t.now, concurrency: 1 });
    const r = await t.run();
    expect(runsOf(r).hiring).toMatchObject({ due: 2, processed: 2 }); // only the two the person had not read were due
    const ds = await readDataDir(t.dir);
    expect(stateRow(ds, 'acme-robotics', 'hiring')).toMatchObject({ checks: 1 });
  });
});

const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / DAY;
