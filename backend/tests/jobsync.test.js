import { describe, it, expect, afterEach } from 'vitest';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { workPlaces, readPlace } from '../src/jobsync/locations.js';
import { canonicalUrl } from '../src/jobsync/canonical.js';
import { readSource, SyncError, PROVIDERS } from '../src/jobsync/adapters.js';
import { SUPPORTED } from '../src/jobsync/providers.js';
import { applyRead, applyEvent } from '../src/jobsync/engine.js';
import { buildCatalogue, boardOf, coverage } from '../src/jobsync/sources.js';
import { BACKOFF_MS, SUCCESS_WAIT_MS } from '../src/jobsync/state.js';
import { planJobSync } from '../src/scheduler/jobs/jobsync.js';
import { createFetcher } from '../src/discovery/http.js';
import { tick } from '../src/scheduler/scheduler.js';
import { SCHEDULER_LOCK_FILE } from '../src/scheduler/lock.js';
import { makeDataDir, readDataDir, removeMadeDirs } from './helpers/store.js';
import { dataset, co, NOW, ISO, scriptedWeb, DAY, at } from './helpers/scheduler.js';

afterEach(removeMadeDirs);

const HOUR = 3600000;
const json = (body, status = 200, headers = {}) => ({ status, body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });

describe('where a role can be worked', () => {
  const place = (labels, o) => { const w = workPlaces(labels, o); return { au: w.au, cities: w.cities, remoteAu: w.remoteAu, arrangement: w.arrangement }; };

  it('reads the advertised place, a suburb of a capital, and several places in one string', () => {
    expect(place('Melbourne, Victoria, Australia')).toMatchObject({ au: true, cities: ['Melbourne'] });
    expect(place('Collingwood, Victoria, Australia')).toMatchObject({ au: true, cities: ['Melbourne'] });
    expect(place('Surry Hills, NSW')).toMatchObject({ au: true, cities: ['Sydney'] });
    expect(place('Sydney / Melbourne').cities).toEqual(['Sydney', 'Melbourne']);
    expect(place(['Sydney', 'Perth'], { workplaceType: 'hybrid' })).toMatchObject({ cities: ['Sydney', 'Perth'], arrangement: 'hybrid' });
    expect(place('Newcastle, NSW').cities).toEqual(['Newcastle']);
    expect(place('Brisbane, QLD, Australia').cities).toEqual(['Brisbane']);
  });

  it('does not take a place elsewhere for ours', () => {
    for (const label of ['Melbourne, FL', 'Perth, Scotland', 'Newcastle upon Tyne, UK', 'Sydney, Nova Scotia', 'London, United Kingdom', 'San Francisco, CA', 'Seattle, WA', 'Auckland, New Zealand', 'Richmond']) {
      expect(place(label), label).toMatchObject({ au: false, cities: [] });
    }
  });

  it('says a role is Remote AU only when the words say someone in Australia can do it remotely', () => {
    for (const label of ['Remote - Australia', 'Remote, Australia', 'Australia (Remote)', 'Remote - Sydney']) expect(place(label).remoteAu, label).toBe(true);
    expect(place('Sydney', { workplaceType: 'remote' }).remoteAu).toBe(true); // the provider says remote and the place is Australian
    for (const label of ['Remote', 'Remote - Global', 'Remote - Anywhere', 'Remote - US', 'Remote - APAC', 'Remote, United Kingdom']) expect(place(label).remoteAu, label).toBe(false);
    expect(place('Melbourne')).toMatchObject({ remoteAu: false, arrangement: null }); // nothing said, nothing shown
  });

  it('does not take a bare "Remote" or "Hybrid" for a place', () => {
    expect(workPlaces('Remote').places).toEqual([]);
    expect(workPlaces('Hybrid').places).toEqual([]);
    expect(workPlaces('Remote').arrangement).toBe('remote');
    expect(workPlaces('Remote, Australia').places.map((p) => p.au)).toEqual([true]);
  });

  it('reads one place at a time', () => {
    expect(readPlace('  ')).toBeNull();
    expect(readPlace('Hobart, Tasmania')).toMatchObject({ au: true, city: 'Hobart' });
  });
});

describe('one role is one address', () => {
  it('drops tracking and fragments, lower-cases the host and the trailing slash, and keeps what names the job', () => {
    expect(canonicalUrl('HTTP://Jobs.Lever.co/zeller/abc-123/?lever-source=twitter&utm_campaign=x#apply')).toBe('https://jobs.lever.co/zeller/abc-123');
    expect(canonicalUrl('https://www.acme.com/careers?gh_jid=77&gh_src=abc&utm_source=a')).toBe('https://www.acme.com/careers?gh_jid=77');
    expect(canonicalUrl('mailto:jobs@acme.com')).toBeNull();
    expect(canonicalUrl('not a url')).toBeNull();
  });
});

// ---------- reading a board ----------

const ghJob = (id, over = {}) => ({ id, title: `Role ${id}`, absolute_url: `https://job-boards.greenhouse.io/acme/jobs/${id}`, location: { name: 'Melbourne, Victoria, Australia' }, first_published: '2026-09-01T00:00:00-04:00', updated_at: '2026-11-01T00:00:00-04:00', ...over });
const GH = (jobs, meta = { total: jobs.length }) => json({ jobs, meta });
const source = (over = {}) => ({ id: 'acme-greenhouse-jobs', company_id: 'acme', provider: 'greenhouse', token: 'acme', ...over });

function reader(routes, over = {}) {
  const w = scriptedWeb(routes);
  const fetcher = createFetcher({ fetchImpl: w.fetchImpl, resolveHost: async () => ['93.184.216.34'], sleep: async () => {}, now: () => NOW, ...over });
  return { w, fetcher, read: (s = source(), o = {}) => readSource(s, { fetcher, now: NOW, companyWebsite: 'https://acme.com.au', sleep: async () => {}, ...o }) };
}
const GH_URL = 'https://boards-api.greenhouse.io/v1/boards/acme/jobs';

describe('which providers are read', () => {
  it('the light list the public server uses names exactly the providers the adapters can read', () => {
    expect([...SUPPORTED].sort()).toEqual(Object.keys(PROVIDERS).sort());
  });
});

describe('reading chosen boards only', () => {
  const ds = {
    job_sources: [
      { id: 'a-greenhouse-jobs', status: 'approved', provider: 'greenhouse', company_id: 'a' },
      { id: 'b-lever-jobs', status: 'approved', provider: 'lever', company_id: 'b' },
      { id: 'c-lever-review', status: 'review', provider: 'lever', company_id: 'c' },
    ],
    job_sync_state: [],
  };
  it('plans every approved board by default, and only the named ones when asked', () => {
    expect(planJobSync(ds, { now: NOW }).planned.map((s) => s.id)).toEqual(['a-greenhouse-jobs', 'b-lever-jobs']);
    expect(planJobSync(ds, { now: NOW, boards: ['b-lever-jobs'] }).planned.map((s) => s.id)).toEqual(['b-lever-jobs']);
  });
  it('never plans a board that is only in review, even when it is named', () => {
    expect(planJobSync(ds, { now: NOW, boards: ['c-lever-review'] }).planned).toEqual([]);
  });
});

describe('reading a Greenhouse board', () => {
  it('returns the whole list, with the employer\'s own posted date and no date of ours', async () => {
    const r = reader({ [GH_URL]: GH([ghJob(1), ghJob(2)]) });
    const read = await r.read();
    expect(read.complete).toBe(true);
    expect(read.postings.map((p) => p.external_id)).toEqual(['1', '2']);
    expect(read.postings[0]).toMatchObject({ title: 'Role 1', labels: ['Melbourne, Victoria, Australia'], posted_at: '2026-09-01T04:00:00.000Z', canonical_url: 'https://job-boards.greenhouse.io/acme/jobs/1' });
  });

  it('never reads "updated" as "posted": a posting with no first_published has no posted date', async () => {
    const r = reader({ [GH_URL]: GH([ghJob(1, { first_published: undefined })]) });
    expect((await r.read()).postings[0].posted_at).toBeNull();
  });

  it('fails, rather than return a short list, when the board says it holds more than it returned', async () => {
    const r = reader({ [GH_URL]: GH([ghJob(1)], { total: 3 }) });
    await expect(r.read()).rejects.toMatchObject({ name: 'SyncError', code: 'incomplete' });
  });

  it('skips a posting whose link is not the employer\'s, and still counts it as listed', async () => {
    const r = reader({ [GH_URL]: GH([ghJob(1), ghJob(2, { absolute_url: 'https://evil.example/jobs/2' })]) });
    const read = await r.read();
    expect(read.postings.map((p) => p.external_id)).toEqual(['1']);
    expect([...read.seen]).toEqual(['1', '2']);
    expect(read.skipped).toEqual([{ id: '2', reason: 'the link is not the employer\'s' }]);
  });

  it('accepts a link on the company\'s own site', async () => {
    const r = reader({ [GH_URL]: GH([ghJob(1, { absolute_url: 'https://www.acme.com.au/careers?gh_jid=1' })]) });
    expect((await r.read()).postings[0].apply_url).toBe('https://www.acme.com.au/careers?gh_jid=1');
  });
});

describe('reading a Lever board', () => {
  const leverJob = (n) => ({ id: `id-${n}`, text: `Role ${n}`, hostedUrl: `https://jobs.lever.co/acme/id-${n}`, createdAt: Date.parse('2026-08-04T00:00:00Z'), workplaceType: 'hybrid', categories: { location: 'Sydney', allLocations: ['Sydney', 'Melbourne'], commitment: 'Full-time', team: 'Eng' } });
  const url = (skip) => `https://api.lever.co/v0/postings/acme?mode=json&limit=50&skip=${skip}`;

  it('reads every page before it says it has the board', async () => {
    const all = Array.from({ length: 70 }, (_, i) => leverJob(i + 1));
    const r = reader({ [url(0)]: json(all.slice(0, 50)), [url(50)]: json(all.slice(50)) });
    const read = await r.read(source({ provider: 'lever' }));
    expect(read.postings).toHaveLength(70);
    expect(read.pages).toBe(2);
    expect(read.postings[0]).toMatchObject({ labels: ['Sydney', 'Melbourne'], workplaceType: 'hybrid', employment: 'Full-time', posted_at: '2026-08-04T00:00:00.000Z' });
  });

  it('fails when a page is repeated, and when a later page is missing', async () => {
    const page = Array.from({ length: 50 }, (_, i) => leverJob(i + 1));
    await expect(reader({ [url(0)]: json(page), [url(50)]: json(page) }).read(source({ provider: 'lever' }))).rejects.toMatchObject({ code: 'incomplete' });
    await expect(reader({ [url(0)]: json(page) }).read(source({ provider: 'lever' }), { retries: 0 })).rejects.toMatchObject({ code: 'gone' }); // the second page answered 404: not a short list
  });
});

describe('a feed that does not answer properly', () => {
  it('says a timeout is a timeout, and changes nothing about the answer it never gave', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    await expect(reader({ [GH_URL]: timeout }).read(source(), { retries: 0 })).rejects.toMatchObject({ code: 'timeout', transient: true });
  });

  it('reports a rate limit with what the provider asked for', async () => {
    const r = reader({ [GH_URL]: { status: 429, body: 'slow down', headers: { 'content-type': 'text/plain', 'retry-after': '120' } } });
    await expect(r.read(source(), { retries: 0 })).rejects.toMatchObject({ code: 'rate_limited', retryAfterSeconds: 120 });
  });

  it('retries a transient failure once inside the run, but never waits out a long Retry-After', async () => {
    let n = 0;
    const flaky = reader((u) => (u === GH_URL ? (n++ === 0 ? { status: 502, body: 'bad gateway', headers: { 'content-type': 'text/plain' } } : GH([ghJob(1)])) : undefined));
    const read = await flaky.read();
    expect(read.attempts).toBe(2); // one failure, one retry, one whole read
    expect(read.postings).toHaveLength(1);
    const slept = [];
    const limited = reader({ [GH_URL]: { status: 429, body: 'x', headers: { 'content-type': 'text/plain', 'retry-after': '3600' } } });
    await expect(limited.read(source(), { retries: 3, sleep: async (ms) => { slept.push(ms); } })).rejects.toMatchObject({ code: 'rate_limited' });
    expect(slept).toEqual([]);
  });

  it('tells a server error, a missing board and a response that is not JSON apart', async () => {
    await expect(reader({ [GH_URL]: { status: 500, body: 'oops', headers: { 'content-type': 'text/plain' } } }).read(source(), { retries: 0 })).rejects.toMatchObject({ code: 'server' });
    await expect(reader({ [GH_URL]: { status: 404, body: 'no', headers: { 'content-type': 'text/plain' } } }).read(source(), { retries: 0 })).rejects.toMatchObject({ code: 'gone', transient: false });
    await expect(reader({ [GH_URL]: { status: 200, body: '<html>maintenance</html>', headers: { 'content-type': 'application/json' } } }).read(source(), { retries: 0 })).rejects.toMatchObject({ code: 'malformed' });
  });

  it('has no reader for a provider it does not know, and says so', async () => {
    await expect(reader({}).read(source({ provider: 'ashby' }))).rejects.toBeInstanceOf(SyncError);
  });
});

// ---------- what a whole read does to the roles ----------

const T0 = Date.parse('2026-11-01T01:00:00Z');
const post = (id, over = {}) => ({ external_id: String(id), title: `Role ${id}`, apply_url: `https://job-boards.greenhouse.io/acme/jobs/${id}`, canonical_url: `https://job-boards.greenhouse.io/acme/jobs/${id}`, labels: ['Melbourne, Victoria, Australia'], workplaceType: null, employment: null, team: null, posted_at: null, ...over });
const whole = (...postings) => ({ postings, seen: new Set(postings.map((p) => p.external_id)), skipped: [], pages: 1 });

describe('a whole read of a board', () => {
  it('adds a role once, however many times the board is read', () => {
    const rows = [];
    const first = applyRead(rows, source(), whole(post(1), post(2)), { now: T0 });
    expect(first).toMatchObject({ added: 2, updated: 0 });
    const again = applyRead(rows, source(), whole(post(1), post(2)), { now: T0 + HOUR });
    expect(again).toMatchObject({ added: 0, updated: 2 });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });

  it('keeps posted, first seen and last confirmed apart: a role merely checked is not posted today', () => {
    const rows = [];
    applyRead(rows, source(), whole(post(1)), { now: T0 });
    applyRead(rows, source(), whole(post(1, { posted_at: '2026-08-04T00:00:00.000Z' })), { now: T0 + 5 * HOUR });
    expect(rows[0]).toMatchObject({ first_seen_at: '2026-11-01T01:00:00.000Z', last_confirmed_at: '2026-11-01T06:00:00.000Z', retrieved_at: '2026-11-01T06:00:00.000Z', posted_at: '2026-08-04T00:00:00.000Z' });
    const quiet = [];
    applyRead(quiet, source(), whole(post(1)), { now: T0 });
    expect(quiet[0].posted_at).toBeNull(); // the employer gave no date: none is made up
  });

  it('hides a role that is not in a whole read, archives it at the second, and lists it again if it comes back', () => {
    const rows = [];
    applyRead(rows, source(), whole(post(1), post(2)), { now: T0 });
    const second = applyRead(rows, source(), whole(post(1)), { now: T0 + HOUR });
    expect(second).toMatchObject({ hidden: 1 });
    expect(rows.find((r) => r.external_id === '2')).toMatchObject({ status: 'hidden', absent_reads: 1, last_confirmed_at: '2026-11-01T01:00:00.000Z' }); // its date did not move
    const third = applyRead(rows, source(), whole(post(1)), { now: T0 + 2 * HOUR });
    expect(third).toMatchObject({ archived: 1 });
    expect(rows.find((r) => r.external_id === '2')).toMatchObject({ status: 'archived', absent_reads: 2 });
    const back = applyRead(rows, source(), whole(post(1), post(2)), { now: T0 + 3 * HOUR });
    expect(back).toMatchObject({ reopened: 1 });
    expect(rows.find((r) => r.external_id === '2')).toMatchObject({ status: 'open', absent_reads: 0, first_seen_at: '2026-11-01T01:00:00.000Z' });
    expect(rows).toHaveLength(2);
  });

  it('does not archive on a second read a few minutes after the first: the same bad answer twice is not two absences', () => {
    const rows = [];
    applyRead(rows, source(), whole(post(1), post(2)), { now: T0 });
    applyRead(rows, source(), whole(post(1)), { now: T0 + HOUR });
    applyRead(rows, source(), whole(post(1)), { now: T0 + HOUR + 5 * 60000 });
    expect(rows.find((r) => r.external_id === '2')).toMatchObject({ status: 'hidden', absent_reads: 1 });
    applyRead(rows, source(), whole(post(1)), { now: T0 + HOUR + 31 * 60000 });
    expect(rows.find((r) => r.external_id === '2').status).toBe('archived');
  });

  it('does not store a role that is not in Australia and not remote from it, but keeps one it already holds', () => {
    const rows = [];
    const stats = applyRead(rows, source(), whole(post(1, { labels: ['London, United Kingdom'] }), post(2, { labels: ['Remote - US'] }), post(3, { labels: ['Remote - Australia'] })), { now: T0 });
    expect(stats).toMatchObject({ added: 1, out_of_scope: 2 });
    expect(rows.map((r) => r.external_id)).toEqual(['3']);
  });

  it('catches the same role under two ids by its address, and a posting still listed but unusable is not absent', () => {
    const rows = [];
    applyRead(rows, source(), whole(post(1), post(2, { canonical_url: 'https://job-boards.greenhouse.io/acme/jobs/1' })), { now: T0 });
    expect(rows).toHaveLength(1);
    const unusable = { postings: [post(1)], seen: new Set(['1', '9']), skipped: [{ id: '9', reason: 'x' }], pages: 1 };
    applyRead(rows, source(), { postings: [post(1), post(9)], seen: new Set(['1', '9']), skipped: [], pages: 1 }, { now: T0 + HOUR });
    expect(rows).toHaveLength(2);
    applyRead(rows, source(), unusable, { now: T0 + 2 * HOUR });
    expect(rows.find((r) => r.external_id === '9').status).toBe('open'); // listed, only its link could not be used this time
  });

  it('adopts a role the slower reader held: same id (a saved role stays saved), same first read, now with an external id', () => {
    const rows = [{ id: 'acme-designer', company_id: 'acme', title: 'Designer', location: 'Melbourne', employment_type: null, remote: null, posted_at: null, apply_url: 'https://job-boards.greenhouse.io/acme/jobs/5?gh_src=abc', status: 'open', source_id: 'acme-greenhouse-jobs', retrieved_at: '2026-10-13T04:17:55Z' }];
    const stats = applyRead(rows, source(), whole(post(5, { title: 'Designer' })), { now: T0 });
    expect(stats).toMatchObject({ adopted: 1, added: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'acme-designer', provider: 'greenhouse', external_id: '5', first_seen_at: '2026-10-13T04:17:55Z', last_confirmed_at: '2026-11-01T01:00:00.000Z' });
  });

  it('leaves another company\'s roles and a closed role alone', () => {
    const rows = [
      { id: 'other-1', company_id: 'other', title: 'X', status: 'open', source_id: 'other-lever-jobs', retrieved_at: '2026-10-01T00:00:00Z' },
      { id: 'acme-old', company_id: 'acme', title: 'Old', status: 'closed', source_id: 'acme-greenhouse-jobs', retrieved_at: '2026-09-01T00:00:00Z', apply_url: 'https://job-boards.greenhouse.io/acme/jobs/50' },
    ];
    applyRead(rows, source(), whole(post(1)), { now: T0 });
    expect(rows.find((r) => r.id === 'other-1').status).toBe('open');
    expect(rows.find((r) => r.id === 'acme-old').status).toBe('closed');
  });

  it('closes one role on an explicit closure and upserts one posting without declaring the rest absent (a signed webhook, when an employer offers one)', () => {
    const rows = [];
    applyRead(rows, source(), whole(post(1), post(2)), { now: T0 });
    expect(applyEvent(rows, source(), { type: 'closed', external_id: '2' }, { now: T0 + HOUR })).toEqual({ closed: 1 });
    expect(rows.find((r) => r.external_id === '2').status).toBe('closed');
    applyEvent(rows, source(), { type: 'published', posting: post(3) }, { now: T0 + 2 * HOUR });
    expect(rows.find((r) => r.external_id === '1').status).toBe('open'); // not read in that event: not absent
    expect(rows.find((r) => r.external_id === '3').status).toBe('open');
  });
});

// ---------- the catalogue ----------

describe('which boards are approved', () => {
  const ds = () => dataset([co('Acme Robotics', { website: 'https://acme.com.au' }), co('Deputy', { website: 'https://www.deputy.com' })], {
    sources: [
      { id: 'acme-robotics-greenhouse-jobs', kind: 'company_website', url: 'https://boards.greenhouse.io/acme', title: 'Greenhouse job board', publisher: 'acme.com.au', retrieved_at: ISO, note: 'linked from the careers page' },
      { id: 'acme-robotics-ashby-jobs', kind: 'company_website', url: 'https://jobs.ashbyhq.com/acme', title: 'Ashby job board', publisher: 'acme.com.au', retrieved_at: ISO, note: '' },
      { id: 'ghost-lever-jobs', kind: 'company_website', url: 'https://jobs.lever.co/ghost', title: 'x', publisher: 'ghost.example', retrieved_at: ISO, note: '' },
    ],
  });

  it('reads the provider and board name from the board\'s address', () => {
    expect(boardOf('https://boards.greenhouse.io/karbon')).toEqual({ provider: 'greenhouse', token: 'karbon' });
    expect(boardOf('https://jobs.lever.co/Zeller')).toEqual({ provider: 'lever', token: 'Zeller' });
    expect(boardOf('https://apply.workable.com/asseti/')).toEqual({ provider: 'workable', token: 'asseti' });
    expect(boardOf('https://example.com/careers')).toBeNull();
  });

  it('approves only boards a company in the directory\'s own page links to, and queues the ones that were only named', () => {
    const rows = buildCatalogue(ds(), { review: [{ company_id: 'deputy', provider: 'lever', token: 'deputy', reason: 'named by the pilot; the careers page has not been read' }, { company_id: 'nobody', provider: 'lever', token: 'x', reason: 'x' }] });
    expect(rows.map((r) => [r.id, r.status])).toEqual([['acme-robotics-ashby-jobs', 'approved'], ['acme-robotics-greenhouse-jobs', 'approved'], ['deputy-lever-review', 'review']]);
    const merged = dataset(ds().companies, { sources: ds().sources, job_sources: rows });
    const c = coverage(merged);
    expect(c).toMatchObject({ approved: 2, polled: 1, companies_polled: 1 });
    expect(c.unsupported).toEqual([{ id: 'acme-robotics-ashby-jobs', company_id: 'acme-robotics', provider: 'ashby' }]);
    expect(c.review.map((r) => r.company_id)).toEqual(['deputy']);
  });
});

// ---------- the scheduled job, end to end ----------

const BOARD = 'https://boards-api.greenhouse.io/v1/boards/acme/jobs';
async function setup({ jobs = [], jobSources = null } = {}) {
  const sources = [{ id: 'acme-robotics-greenhouse-jobs', kind: 'company_website', url: 'https://boards.greenhouse.io/acme', title: 'Greenhouse job board', publisher: 'acme.com.au', retrieved_at: ISO, note: '' }];
  const catalogue = jobSources ?? [{ id: 'acme-robotics-greenhouse-jobs', company_id: 'acme-robotics', provider: 'greenhouse', token: 'acme', board_url: 'https://boards.greenhouse.io/acme', status: 'approved', basis: 'the company\'s own careers page links to it', note: '', added_at: ISO }];
  const dir = await makeDataDir(dataset([co('Acme Robotics', { website: 'https://acme.com.au', city: 'Melbourne' })], { sources, jobs, job_sources: catalogue }));
  const state = { feed: GH([ghJob(1), ghJob(2)]), calls: 0 };
  const w = scriptedWeb((u) => { if (u === BOARD) { state.calls += 1; return state.feed instanceof Error ? state.feed : state.feed; } return undefined; });
  const clock = { now: NOW };
  const now = () => clock.now;
  const fetcher = () => createFetcher({ fetchImpl: w.fetchImpl, resolveHost: async () => ['93.184.216.34'], sleep: async () => {}, now });
  return {
    dir, state, w, clock, now,
    run: (over = {}) => tick({ dir, now, fetcher: fetcher(), sources: [], by: 'tester', jobs: ['jobsync'], trigger: 'ci', ...over }),
    forward: (ms) => { clock.now += ms; },
    data: () => readDataDir(dir),
  };
}
const jobRows = (ds) => ds.jobs.filter((j) => j.company_id === 'acme-robotics');

describe('the hourly sync, run by the scheduler', () => {
  it('reads a board, stores its roles, and writes the run and the board\'s state', async () => {
    const t = await setup();
    const r = await t.run();
    expect(r.status).toBe('ok');
    const ds = await t.data();
    expect(jobRows(ds).map((j) => [j.external_id, j.status, j.first_seen_at, j.last_confirmed_at])).toEqual([['1', 'open', ISO, ISO], ['2', 'open', ISO, ISO]]);
    expect(ds.job_sync_state).toEqual([expect.objectContaining({ source_id: 'acme-robotics-greenhouse-jobs', last_success_at: ISO, consecutive_failures: 0, last_error: null, next_attempt_at: at(NOW + SUCCESS_WAIT_MS) })]);
    const run = ds.job_runs.find((x) => x.job === 'jobsync');
    expect(run).toMatchObject({ status: 'ok', due: 1, processed: 1, changed: 1, failed: 0, trigger: 'ci' });
    expect(run.summary).toMatch(/1 board\(s\) read whole; 2 role\(s\) new/);
  });

  it('asks nothing of a board that was read within the hour, and gives the same answer when run twice', async () => {
    const t = await setup();
    await t.run();
    const before = await t.data();
    const second = await t.run();
    expect(t.state.calls).toBe(1); // no second request
    expect(second.runs.find((x) => x.job === 'jobsync')).toMatchObject({ status: 'idle', processed: 0 });
    const after = await t.data();
    expect(after.jobs).toEqual(before.jobs);
    expect(after.job_sync_state).toEqual(before.job_sync_state);
  });

  it('an hour later reads it again: no duplicates, first seen kept, last confirmed moved, posted date untouched', async () => {
    const t = await setup();
    await t.run();
    t.forward(SUCCESS_WAIT_MS + 1000);
    await t.run();
    const ds = await t.data();
    expect(jobRows(ds)).toHaveLength(2);
    const one = jobRows(ds).find((j) => j.external_id === '1');
    expect(one).toMatchObject({ first_seen_at: ISO, last_confirmed_at: at(NOW + SUCCESS_WAIT_MS + 1000), posted_at: '2026-09-01T04:00:00.000Z' });
  });

  it('a feed that fails closes nothing, moves no date, and backs off; the next good read recovers', async () => {
    const t = await setup();
    await t.run();
    t.forward(SUCCESS_WAIT_MS + 1000);
    t.state.feed = { status: 500, body: 'down', headers: { 'content-type': 'text/plain' } };
    const bad = await t.run();
    expect(bad.runs.find((x) => x.job === 'jobsync')).toMatchObject({ status: 'failed', processed: 0, failed: 1 });
    let ds = await t.data();
    expect(jobRows(ds).every((j) => j.status === 'open' && j.last_confirmed_at === ISO)).toBe(true); // untouched
    const row = ds.job_sync_state[0];
    expect(row).toMatchObject({ consecutive_failures: 1, last_success_at: ISO, last_error: expect.objectContaining({ code: 'server', transient: true }) });
    expect(Date.parse(row.next_attempt_at) - Date.parse(row.last_attempt_at)).toBe(BACKOFF_MS[0]);
    // too soon: it does not ask again
    const calls = t.state.calls;
    t.forward(5 * 60000);
    await t.run();
    expect(t.state.calls).toBe(calls);
    // the feed is back
    t.state.feed = GH([ghJob(1), ghJob(2), ghJob(3)]);
    t.forward(BACKOFF_MS[0]);
    const good = await t.run();
    expect(good.status).toBe('ok');
    ds = await t.data();
    expect(jobRows(ds)).toHaveLength(3);
    expect(ds.job_sync_state[0]).toMatchObject({ consecutive_failures: 0, last_error: null });
  });

  it('a partial feed is a failure: nothing is hidden because the list was short', async () => {
    const t = await setup();
    await t.run();
    t.forward(SUCCESS_WAIT_MS + 1000);
    t.state.feed = GH([ghJob(1)], { total: 2 });
    await t.run();
    const ds = await t.data();
    expect(jobRows(ds).map((j) => j.status)).toEqual(['open', 'open']);
    expect(ds.job_sync_state[0].last_error).toMatchObject({ code: 'incomplete' });
  });

  it('a removed role is hidden by the next whole read, archived by the one after, and still found by its id', async () => {
    const t = await setup();
    await t.run();
    t.state.feed = GH([ghJob(1)]);
    t.forward(SUCCESS_WAIT_MS + 1000);
    await t.run();
    let ds = await t.data();
    expect(jobRows(ds).find((j) => j.external_id === '2')).toMatchObject({ status: 'hidden', last_confirmed_at: ISO });
    t.forward(SUCCESS_WAIT_MS + 1000);
    await t.run();
    ds = await t.data();
    expect(jobRows(ds).find((j) => j.external_id === '2').status).toBe('archived');
    expect(ds.jobs.some((j) => j.external_id === '2')).toBe(true); // never deleted: a bookmark still finds it
  });

  it('a board that suddenly lists nothing is believed only the second time', async () => {
    const t = await setup();
    await t.run();
    t.state.feed = GH([]);
    t.forward(SUCCESS_WAIT_MS + 1000);
    await t.run();
    let ds = await t.data();
    expect(jobRows(ds).map((j) => j.status)).toEqual(['open', 'open']);
    expect(ds.job_sync_state[0].empty_reads).toBe(1);
    t.forward(20 * 60000);
    await t.run();
    ds = await t.data();
    expect(jobRows(ds).map((j) => j.status)).toEqual(['hidden', 'hidden']);
  });

  it('an empty answer twice in two minutes is one glitch, not two: the roles stay open until a later read still says empty', async () => {
    const t = await setup();
    await t.run();
    t.state.feed = GH([]);
    t.forward(SUCCESS_WAIT_MS + 1000);
    await t.run();
    t.forward(2 * 60000);
    await t.run({ force: true });
    let ds = await t.data();
    expect(jobRows(ds).map((j) => j.status)).toEqual(['open', 'open']);
    t.forward(20 * 60000);
    await t.run({ force: true });
    ds = await t.data();
    expect(jobRows(ds).map((j) => j.status)).toEqual(['hidden', 'hidden']);
  });

  it('two runs at once: the second does nothing and says so', async () => {
    const t = await setup();
    await writeFile(path.join(t.dir, SCHEDULER_LOCK_FILE), JSON.stringify({ pid: 1, at: ISO }));
    const r = await t.run();
    expect(r.status).toBe('locked');
    expect(t.state.calls).toBe(0);
    expect((await t.data()).job_runs.find((x) => x.job === 'jobsync')).toMatchObject({ status: 'skipped' });
  });

  it('polls only approved boards it can read, and says which it cannot', async () => {
    const t = await setup({ jobSources: [
      { id: 'acme-robotics-greenhouse-jobs', company_id: 'acme-robotics', provider: 'greenhouse', token: 'acme', board_url: 'https://boards.greenhouse.io/acme', status: 'review', basis: 'named, not confirmed', note: '', added_at: ISO },
    ] });
    const r = await t.run();
    expect(t.state.calls).toBe(0);
    expect(r.runs.find((x) => x.job === 'jobsync')).toMatchObject({ status: 'idle', due: 0 });
  });

  it('is not part of a plain tick: it is asked for by name', async () => {
    const { ROUTINE_JOBS, JOBS } = await import('../src/models/jobRuns.js');
    expect(ROUTINE_JOBS).not.toContain('jobsync');
    expect(JOBS).toContain('jobsync');
  });

  it('a bookmarked role keeps its true status: the roles a visitor saved are still there when the employer takes them down', async () => {
    const t = await setup({ jobs: [{ id: 'acme-robotics-designer', company_id: 'acme-robotics', title: 'Designer', location: 'Melbourne', employment_type: null, remote: null, posted_at: null, apply_url: 'https://job-boards.greenhouse.io/acme/jobs/9', status: 'open', source_id: 'acme-robotics-greenhouse-jobs', retrieved_at: '2026-10-13T04:17:55Z' }] });
    await t.run(); // the board no longer lists role 9
    const ds = await t.data();
    expect(ds.jobs.find((j) => j.id === 'acme-robotics-designer')).toMatchObject({ status: 'hidden', retrieved_at: '2026-10-13T04:17:55Z' });
  });
});

// ---------- what a run changed that a visitor could see ----------

import { compareJobs, compareHealth, worthCommitting } from '../src/jobsync/changes.js';

describe('did the run change anything a visitor could see?', () => {
  const row = (id, over = {}) => ({ id, title: 'T', status: 'open', locations: ['Melbourne'], last_confirmed_at: '2026-11-01T00:00:00Z', retrieved_at: '2026-11-01T00:00:00Z', ...over });

  it('counts a new role, a role that changed status, an edited one and a removed one: and not a role that was only re-dated', () => {
    const before = [row('a'), row('b'), row('c'), row('d')];
    const after = [row('a', { last_confirmed_at: '2026-11-01T01:00:00Z', retrieved_at: '2026-11-01T01:00:00Z' }), row('b', { status: 'hidden' }), row('c', { title: 'New title' }), row('e')];
    expect(compareJobs(before, after)).toEqual({ added: 1, removed: 1, status: 1, edited: 1, redated: 1 });
  });

  it('does not make a commit for an hour in which every board was read and nothing moved, until the data is a day old', () => {
    const quiet = compareJobs([row('a')], [row('a', { last_confirmed_at: '2026-11-01T05:00:00Z' })]);
    expect(worthCommitting({ jobs: quiet, health: 0, ageHours: 3 })).toMatchObject({ commit: false });
    expect(worthCommitting({ jobs: quiet, health: 0, ageHours: 24 })).toMatchObject({ commit: true, deploy: false });
    expect(worthCommitting({ jobs: compareJobs([], [row('a')]), health: 0, ageHours: 1 })).toMatchObject({ commit: true, deploy: true });
  });

  it('counts a board going failing or healthy, and not one that stays as it was', () => {
    const ok = { source_id: 's', consecutive_failures: 0 };
    expect(compareHealth([ok], [{ ...ok, consecutive_failures: 1 }])).toBe(1);
    expect(compareHealth([{ ...ok, consecutive_failures: 1 }], [{ ...ok, consecutive_failures: 4 }])).toBe(0);
    expect(compareHealth([{ ...ok, consecutive_failures: 2 }], [ok])).toBe(1);
  });
});
