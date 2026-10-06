import { describe, it, expect, afterEach } from 'vitest';
import { tick } from '../src/scheduler/scheduler.js';
import { runQuality, qualitySummary } from '../src/scheduler/jobs/quality.js';
import { schedulerStatus } from '../src/scheduler/status.js';
import { reconcileFromQueue, stampCheck } from '../src/scheduler/state.js';
import { emptyState, indexState } from '../src/models/refreshState.js';
import { startJobRun, finishJobRun, closeInterrupted, pruneJobRuns, lastRunByJob, jobRunId, validateJobRuns } from '../src/models/jobRuns.js';
import { pruneFinished, enqueueTask, claimNext, finishTask } from '../src/models/enrichmentQueue.js';
import { makeEvidenceRow } from '../src/models/evidence.js';
import { createFetcher } from '../src/discovery/http.js';
import { makeDataDir, readDataDir, removeMadeDirs } from './helpers/store.js';
import { dataset, co, task, read, NOW, ISO, DAY, at, auPage, scriptedWeb } from './helpers/scheduler.js';

afterEach(removeMadeDirs);

const HIRING = { hiring: true, hiring_status: 'hiring' };
const work = (list, extra = {}) => ({ ...structuredClone(dataset(list)), refresh_state: [], enrichment_queue: [], job_runs: [], ...extra });
const rowOf = (w, id, facet) => w.refresh_state.find((r) => r.scope === 'company' && r.target_id === id && r.facet === facet);

// A company in conflict: its record says one round, a source says another.
function inConflict() {
  const w = work([co('Acme Robotics', { website: 'https://acme.com.au', last_funding_round: 'Pre-seed', stage: 'Pre-seed' })]);
  w.sources = [{ id: 'news-1', kind: 'press', url: 'https://news.example/a', title: 'Acme raises', publisher: 'News', retrieved_at: ISO, note: '' }];
  w.evidence = [makeEvidenceRow({ company_id: 'acme-robotics', field: 'last_funding_round', value: 'Seed', source_id: 'news-1', confidence: 'medium', note: 'headline' })];
  w.companies[0].source_ids = ['news-1'];
  return w;
}

describe('the data-quality job', () => {
  it('brings a record in conflict forward so its site is read again, but not every run', () => {
    const w = inConflict();
    // its facets were all checked three days ago
    w.enrichment_queue = [task('acme-robotics', { finished_at: at(NOW - 3 * DAY), result: read({}) })];
    reconcileFromQueue(w);
    // a round conflict could be settled by the profile or the description; funding has no clock of its own, so nothing moves for it
    const before = JSON.stringify(w.refresh_state);
    const r = runQuality(w, { at: ISO });
    expect(r.details.conflicts).toBe(1);
    expect(r.changed).toBe(0); // last_funding_round is not a field a company's own site can settle
    expect(JSON.stringify(w.refresh_state)).toBe(before);
  });

  it('brings the hiring check forward for a company that says it is hiring and has not been seen to be', () => {
    const w = work([co('Acme Robotics', { website: 'https://acme.com.au', ...HIRING })]);
    w.enrichment_queue = [task('acme-robotics', { finished_at: at(NOW - 3.2 * DAY), result: read({}) })]; // read, and it found no roles
    reconcileFromQueue(w);
    const row = rowOf(w, 'acme-robotics', 'hiring');
    expect(Date.parse(row.next_check_at)).toBeGreaterThan(NOW); // not due by its own clock yet
    const r = runQuality(w, { at: ISO });
    expect(r.details.stale_hiring).toBe(1);
    expect(r.details.brought_forward).toEqual({ conflicts: 0, hiring: 1 });
    expect(row.next_check_at).toBe(ISO);
    // and not again straight away: it was checked recently enough
    const again = runQuality(w, { at: ISO });
    expect(again.details.brought_forward.hiring).toBe(0);
  });

  it('settles on what a site can settle: a disagreement about a company\'s city moves the profile clock, not the hiring clock', () => {
    const w = work([co('Acme Robotics', { website: 'https://acme.com.au', city: 'Sydney', ...HIRING })]);
    w.sources = [{ id: 's1', kind: 'company_website', url: 'https://acme.com.au/', title: 'Acme', publisher: 'Acme', retrieved_at: ISO, note: '' }];
    w.evidence = [makeEvidenceRow({ company_id: 'acme-robotics', field: 'city', value: 'Melbourne', source_id: 's1', confidence: 'medium', verified_at: ISO })];
    w.companies[0].source_ids = ['s1'];
    w.enrichment_queue = [task('acme-robotics', { finished_at: at(NOW - 20 * DAY), result: read({}) })];
    reconcileFromQueue(w);
    const r = runQuality(w, { at: ISO });
    expect(r.details.conflicts).toBe(1);
    expect(r.details.brought_forward.conflicts).toBe(1);
    expect(rowOf(w, 'acme-robotics', 'profile').next_check_at).toBe(ISO);
  });

  it('reports how far behind each facet is, which companies were never checked, and which are on the status watch', () => {
    const w = work([co('A', { website: 'https://a.example.com' }), co('B', { website: 'https://b.example.com' })]);
    w.enrichment_queue = [task('a', { finished_at: at(NOW - 100 * DAY), result: read({ status_signals: [{ code: 'moved_domain', detail: 'a.example.com now redirects to z.example' }] }) })];
    reconcileFromQueue(w);
    const { details } = runQuality(w, { at: ISO });
    expect(details.facets.hiring).toMatchObject({ checked: 1, never: 1, due: 2, behind: 1 });
    expect(details.facets.founded_year).toMatchObject({ checked: 1, never: 1, due: 1, behind: 0 });
    expect(details.status_watch).toEqual([{ company_id: 'a', signals: ['moved_domain'], since: at(NOW - 100 * DAY) }]);
    expect(details.status_watch_total).toBe(1);
    expect(qualitySummary({ changed: 0, details })).toMatch(/^Checked 2 companies, 0 conflict\(s\), \d+ stale hiring, \d+ facet check\(s\) behind, 1 on the status watch/);
  });

  it('keeps the log short: old idle runs, finished tasks, and the clocks of companies that are gone', () => {
    const w = work([co('Acme Robotics', { website: 'https://acme.com.au' })]);
    w.job_runs = [
      { ...finishJobRun(startJobRun([], { job: 'hiring', tickId: 't1', at: at(NOW - 40 * DAY) }), { at: at(NOW - 40 * DAY), status: 'idle' }), id: 'jr-1-hiring' },
      { ...finishJobRun(startJobRun([], { job: 'hiring', tickId: 't2', at: at(NOW - 40 * DAY) }), { at: at(NOW - 40 * DAY), status: 'ok', due: 3, processed: 3 }), id: 'jr-2-hiring' },
      { ...finishJobRun(startJobRun([], { job: 'hiring', tickId: 't3', at: at(NOW - DAY) }), { at: at(NOW - DAY), status: 'idle' }), id: 'jr-3-hiring' },
    ];
    w.enrichment_queue = [
      task('acme-robotics', { n: 1, finished_at: at(NOW - 60 * DAY), result: read({}) }),
      task('acme-robotics', { n: 2, finished_at: at(NOW - 45 * DAY), result: read({}) }),
      task('acme-robotics', { n: 3, finished_at: at(NOW - 2 * DAY), result: read({}) }),
    ];
    w.refresh_state = [emptyState('company', 'ghost', 'hiring')];
    const { details } = runQuality(w, { at: ISO });
    expect(details.pruned).toEqual({ runs: 1, queue: 2, orphans: 1 });
    expect(w.job_runs.map((r) => r.id)).toEqual(['jr-2-hiring', 'jr-3-hiring']); // the old row that did something stays
    expect(w.enrichment_queue.map((t) => t.id)).toEqual(['enq-acme-robotics-3']);
  });

  it('never changes a company or resolves a conflict', async () => {
    const dir = await makeDataDir(dataset([co('Acme Robotics', { website: 'https://acme.com.au', ...HIRING })]));
    const w = scriptedWeb({ 'https://acme.com.au/': { body: auPage('Acme Robotics') } });
    const fetcher = () => createFetcher({ fetchImpl: w.fetchImpl, resolveHost: async () => ['93.184.216.34'], sleep: async () => {}, now: () => NOW });
    await tick({ dir, now: () => NOW, fetcher: fetcher(), sources: [], jobs: ['hiring', 'quality'], by: 't' });
    const before = await readDataDir(dir);
    await tick({ dir, now: () => NOW + 30 * DAY, fetcher: fetcher(), sources: [], jobs: ['quality'], by: 't', force: true });
    const after = await readDataDir(dir);
    expect(after.companies).toEqual(before.companies);
    expect(after.evidence).toEqual(before.evidence);
  });
});

describe('the run log', () => {
  it('starts a row before the work, so a run that dies still left a record, and closes it when it finishes', () => {
    const rows = [];
    const row = startJobRun(rows, { job: 'hiring', tickId: 'tick-1', at: ISO, trigger: 'ci', by: 'github-actions', mode: 'suggest' });
    expect(row).toMatchObject({ status: 'running', finished_at: null, trigger: 'ci', mode: 'suggest', due: 0 });
    expect(validateJobRuns({ job_runs: rows })).toEqual([]);
    finishJobRun(row, { at: at(NOW + 5000), status: 'ok', due: 4, processed: 3, changed: 1, failed: 0, deferred: 1, requests: 12, summary: 'x'.repeat(500), budget: { max_requests: 300, stopped_for: null } });
    expect(row.summary.length).toBe(300);
    expect(validateJobRuns({ job_runs: rows })).toEqual([]);
  });

  it('marks what no live tick owns as interrupted, and leaves the live tick\'s own rows alone', () => {
    const rows = [];
    startJobRun(rows, { job: 'hiring', tickId: 'dead', at: ISO });
    startJobRun(rows, { job: 'status', tickId: 'live', at: ISO });
    const closed = closeInterrupted(rows, { at: at(NOW + 1000), ownTickId: 'live' });
    expect(closed).toEqual([rows[0].id]);
    expect(rows[0]).toMatchObject({ status: 'failed', summary: 'Interrupted' });
    expect(rows[1].status).toBe('running');
    expect(validateJobRuns({ job_runs: rows })).toEqual([]);
  });

  it('gives every row its own id, even for two runs of one job in the same instant', () => {
    const rows = [];
    for (let i = 0; i < 3; i += 1) startJobRun(rows, { job: 'hiring', tickId: 't', at: ISO });
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
    expect(rows.map((r) => r.id)[1]).toBe(`${jobRunId([], ISO, 'hiring')}-2`);
  });

  it('says what each job last did', () => {
    const rows = [];
    startJobRun(rows, { job: 'hiring', tickId: 'a', at: ISO });
    startJobRun(rows, { job: 'hiring', tickId: 'b', at: at(NOW + DAY) });
    startJobRun(rows, { job: 'status', tickId: 'a', at: ISO });
    const last = lastRunByJob(rows);
    expect(last.hiring.tick_id).toBe('b');
    expect(Object.keys(last).sort()).toEqual(['hiring', 'status']);
  });

  it('refuses a run row that is wrong', () => {
    const rows = [];
    const ok = startJobRun(rows, { job: 'hiring', tickId: 't', at: ISO });
    finishJobRun(ok, { at: ISO, status: 'ok' });
    const bad = [{ ...ok, id: 'nope' }, { ...ok, id: 'jr-1-bogus', job: 'bogus' }, { ...ok, id: 'jr-2-hiring', status: 'failed', error: null }, { ...ok, id: 'jr-3-hiring', started_at: 'yesterday' }, { ...ok, id: 'jr-4-hiring', due: -1 }];
    const errors = validateJobRuns({ job_runs: bad });
    expect(errors.length).toBeGreaterThanOrEqual(5);
    expect(errors.join('\n')).toMatch(/unknown job "bogus"/);
    expect(errors.join('\n')).toMatch(/a failed run says why/);
  });

  it('drops idle rows after a month and anything after a year, keeping the rest', () => {
    const mk = (job, status, age) => finishJobRun(startJobRun([], { job, tickId: 'x', at: at(NOW - age * DAY) }), { at: at(NOW - age * DAY), status, error: status === 'failed' ? 'x' : null });
    const rows = [mk('hiring', 'idle', 31), mk('hiring', 'skipped', 40), mk('hiring', 'ok', 40), mk('hiring', 'failed', 100), mk('hiring', 'ok', 400), mk('hiring', 'idle', 2)];
    const { rows: kept, dropped } = pruneJobRuns(rows, { at: ISO });
    expect(dropped).toBe(3);
    expect(kept.map((r) => `${r.status}`)).toEqual(['ok', 'failed', 'idle']);
  });
});

describe('the queue stays small, and its ids stay unique', () => {
  it('hands out a number one past the highest used, so a pruned task\'s id is never given again', () => {
    const w = { enrichment_queue: [] };
    const ids = [];
    for (let i = 0; i < 3; i += 1) {
      const { task: t } = enqueueTask(w, { kind: 'company', targetId: 'acme', priority: 1, reason: 'refresh', wanted: [], by: 'x', at: ISO });
      ids.push(t.id);
      claimNext(w, { at: ISO }); finishTask(w, t.id, { at: ISO });
    }
    expect(ids).toEqual(['enq-acme-1', 'enq-acme-2', 'enq-acme-3']);
    w.enrichment_queue = w.enrichment_queue.filter((t) => t.id === 'enq-acme-3'); // the older two are pruned
    expect(enqueueTask(w, { kind: 'company', targetId: 'acme', priority: 1, reason: 'refresh', wanted: [], by: 'x', at: ISO }).task.id).toBe('enq-acme-4');
  });

  it('keeps the latest task for each company and everything still waiting, whatever its age', () => {
    const w = { enrichment_queue: [task('a', { n: 1, finished_at: at(NOW - 90 * DAY), result: read({}) }), task('a', { n: 2, finished_at: at(NOW - 80 * DAY), result: read({}) }), task('b', { n: 1, status: 'queued', created_at: at(NOW - 90 * DAY) })] };
    expect(pruneFinished(w, { at: ISO })).toBe(1);
    expect(w.enrichment_queue.map((t) => t.id)).toEqual(['enq-a-2', 'enq-b-1']);
  });
});

describe('what the status view says', () => {
  it('shows each job, its last run, what is due now and what is next, and what is wrong', async () => {
    const list = [co('Acme Robotics', { website: 'https://acme.com.au', ...HIRING }), co('Beta Labs', { website: 'https://beta.example.com', ...HIRING })];
    const dir = await makeDataDir(dataset(list));
    const w = scriptedWeb({ 'https://acme.com.au/': { body: auPage('Acme Robotics') } }); // beta answers 404
    const fetcher = createFetcher({ fetchImpl: w.fetchImpl, resolveHost: async () => ['93.184.216.34'], sleep: async () => {}, now: () => NOW });
    await tick({ dir, now: () => NOW, fetcher, sources: [], jobs: ['hiring', 'status', 'enrichment', 'quality'], by: 't', limits: { concurrency: 1 } });
    const ds = await readDataDir(dir);
    const s = schedulerStatus(ds, { at: ISO, sourceIds: ['rss.x'] });
    expect(s.jobs.map((j) => j.job)).toEqual(['discovery', 'funding', 'hiring', 'status', 'enrichment', 'quality']);
    const hiring = s.jobs.find((j) => j.job === 'hiring');
    expect(hiring.last_run).toMatchObject({ status: expect.stringMatching(/ok|partial/), started_at: ISO });
    expect(hiring.next_due).toBeTruthy();
    expect(s.jobs.find((j) => j.job === 'discovery')).toMatchObject({ due_now: 1, last_run: null }); // a source never read is due
    expect(s.facets.hiring).toMatchObject({ checked: 1, every_days: 3, job: 'hiring' });
    expect(s.recent.length).toBe(4);
    expect(s.queue.total).toBe(2);
    expect(s.totals.companies).toBe(2);
  });
});

describe('what the status view counts as due for the feeds', () => {
  it('counts only publishers\' feeds for the funding job, and every source for discovery', () => {
    const ds = work([co('Acme Robotics', { website: 'https://acme.com.au' })]);
    const s = schedulerStatus(ds, { at: ISO, sourceIds: ['rss.x', 'submissions'], fundingIds: ['rss.x'] });
    expect(s.jobs.find((j) => j.job === 'funding').due_now).toBe(1);
    expect(s.jobs.find((j) => j.job === 'discovery').due_now).toBe(2);
    expect(s.sources.map((x) => [x.id, x.is_funding_feed])).toEqual([['rss.x', true], ['submissions', false]]);
  });
});

describe('a refresh clock cannot go backwards', () => {
  it('keeps a failure from bringing the next check forward of what was already waiting for a refused site', () => {
    const row = emptyState('company', 'acme', 'hiring');
    stampCheck(row, { at: ISO, outcome: 'refused', code: 'robots_disallow' });
    const wait = Date.parse(row.next_check_at) - NOW;
    expect(wait).toBeGreaterThan(29 * DAY);
    expect(indexState([row]).get('company', 'acme', 'hiring')).toBe(row);
  });
});
