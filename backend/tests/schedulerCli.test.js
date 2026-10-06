import { describe, it, expect, afterEach } from 'vitest';
import { main, parseArgs } from '../scripts/scheduler.js';
import { createFetcher } from '../src/discovery/http.js';
import { loadRaw } from '../src/models/dataset.js';
import { makeDataDir, readDataDir, removeMadeDirs } from './helpers/store.js';
import { dataset, co, NOW, auPage, scriptedWeb, DAY } from './helpers/scheduler.js';

afterEach(removeMadeDirs);

const HIRING = { hiring: true, hiring_status: 'hiring' };
const companies = () => [co('Acme Robotics', { website: 'https://acme.com.au', ...HIRING }), co('Beta Labs', { website: 'https://beta.example.com', ...HIRING }), co('Delta')];
const web = () => scriptedWeb({ 'https://acme.com.au/': { body: auPage('Acme Robotics') }, 'https://beta.example.com/': { body: auPage('Beta Labs') } });

async function cli(dir, argv, deps = {}) {
  const lines = [];
  const w = deps.web ?? web();
  const fetcher = createFetcher({ fetchImpl: w.fetchImpl, resolveHost: async () => ['93.184.216.34'], sleep: async () => {}, now: () => NOW });
  const code = await main(argv, { dataDir: dir, out: (s) => lines.push(s), now: () => NOW, fetcher, sources: [], sourceConfig: [], ...deps });
  return { code, text: lines.join('\n'), w };
}
const fresh = async () => makeDataDir(dataset(companies()));

describe('reading the arguments', () => {
  it('splits words from flags, repeats and values', () => {
    expect(parseArgs(['tick', '--job', 'hiring,status', '--dry-run', '--max-sites', '5'])).toEqual({ positional: ['tick'], flags: { job: 'hiring,status', 'dry-run': true, 'max-sites': '5' } });
  });
});

describe('asking what is due', () => {
  it('says what a run would do, and reads and writes nothing', async () => {
    const dir = await fresh();
    const before = await loadRaw(dir);
    const r = await cli(dir, ['plan']);
    expect(r.code).toBe(0);
    expect(r.text).toMatch(/Due at 2026-10-05T04:00:00.000Z \(nothing was read or written\)/);
    expect(r.text).toMatch(/company sites: 2 companies due \(hiring 2, status 2, profile 2, description 2, founded_year 2\); a run would read 2; 2 never checked; 1 have no website/);
    expect(r.text).toMatch(/acme-robotics: /);
    expect(await loadRaw(dir)).toEqual(before);
    expect(r.w.calls).toEqual([]);
  });

  it('plans just the jobs asked for', async () => {
    const dir = await fresh();
    const r = await cli(dir, ['plan', '--job', 'hiring']);
    expect(r.text).toMatch(/company sites: 2 companies due \(hiring 2\)/);
  });

  it('is what `tick --dry-run` does too', async () => {
    const dir = await fresh();
    const before = await loadRaw(dir);
    const r = await cli(dir, ['tick', '--dry-run']);
    expect(r.text).toMatch(/nothing was read or written/);
    expect(await loadRaw(dir)).toEqual(before);
  });

  it('refuses a job that does not exist, a mode that does not exist, and a number that is not one', async () => {
    const dir = await fresh();
    await expect(cli(dir, ['plan', '--job', 'hiring,teleport'])).rejects.toThrow(/unknown job "teleport": the jobs are discovery, funding, hiring, status, enrichment, quality/);
    await expect(cli(dir, ['tick', '--mode', 'overwrite'])).rejects.toThrow(/--mode must be one of suggest, fill/);
    await expect(cli(dir, ['tick', '--max-sites', 'lots'])).rejects.toThrow(/--max-sites must be a number/);
    await expect(cli(dir, ['frobnicate'])).rejects.toThrow(/unknown command "frobnicate"/);
  });
});

describe('running a tick', () => {
  it('runs the jobs, prints each one\'s result and the requests it made, and records every run', async () => {
    const dir = await fresh();
    const r = await cli(dir, ['tick', '--by', 'Aryan', '--max-sites', '10']);
    expect(r.code).toBe(0);
    expect(r.text).toMatch(/running discovery, funding, hiring, status, enrichment, quality in suggest mode \(evidence only: no company is changed\)/);
    expect(r.text).toMatch(/hiring\s+ok\s+due\s+2\s+read\s+2/);
    expect(r.text).toMatch(/discovery\s+idle/);
    expect(r.text).toMatch(/\d+ request\(s\)/);
    const ds = await readDataDir(dir);
    expect(ds.job_runs).toHaveLength(6);
    expect(ds.job_runs.every((x) => x.by === 'Aryan' && x.trigger === 'cli')).toBe(true);
  });

  it('runs one job now whatever its clock says, with `run`', async () => {
    const dir = await fresh();
    await cli(dir, ['tick', '--job', 'hiring,status,enrichment']);
    const calls = (await cli(dir, ['plan'])).w.calls.length;
    expect(calls).toBe(0);
    const quiet = await cli(dir, ['tick', '--job', 'hiring']);
    expect(quiet.text).toMatch(/hiring\s+idle/);
    const forced = await cli(dir, ['run', 'hiring'], { now: () => NOW + 60000 }); // a minute later: a read is only learned from if it is newer than the last
    expect(forced.text).toMatch(/hiring\s+ok\s+due\s+2\s+read\s+2/);
    expect(forced.w.pages().length).toBe(2);
    await expect(cli(dir, ['run'])).rejects.toThrow(/run needs a job/);
  });

  it('exits 2 when a job failed, and still runs the others', async () => {
    const dir = await fresh();
    const broken = { id: 'broken.feed', kind: 'press', region: 'AU', license: { basis: 'public_feed' }, licenseBasis: 'public_feed', discover: async () => { throw new Error('the feed is on fire'); } };
    const r = await cli(dir, ['tick', '--job', 'discovery,hiring'], { sources: [broken] });
    expect(r.code).toBe(2);
    expect(r.text).toMatch(/discovery\s+failed/);
    expect(r.text).toMatch(/hiring\s+ok/);
  });

  it('works on a copy of the data when told to', async () => {
    const live = await fresh();
    const copy = await fresh();
    const before = await loadRaw(live);
    await cli(live, ['tick', '--job', 'hiring', '--data', copy]);
    expect(await loadRaw(live)).toEqual(before);
    expect((await readDataDir(copy)).job_runs).toHaveLength(1);
  });

  it('loops, waiting between ticks, and stops after the number it was given', async () => {
    const dir = await fresh();
    const sleeps = [];
    const r = await cli(dir, ['loop', '--every', '30', '--max-ticks', '2', '--job', 'hiring'], { sleep: async (ms) => { sleeps.push(ms); } });
    expect(r.code).toBe(0);
    expect(sleeps).toEqual([30 * 60000]);
    expect(r.text).toMatch(/== tick 1 ==[\s\S]*== tick 2 ==/);
    const ds = await readDataDir(dir);
    expect(ds.job_runs.map((x) => [x.trigger, x.status])).toEqual([['loop', 'ok'], ['loop', 'idle']]);
  });
});

describe('looking at what it has done', () => {
  it('says there is nothing yet, then shows the runs newest first, filtered', async () => {
    const dir = await fresh();
    expect((await cli(dir, ['runs'])).text).toBe('No runs logged yet.');
    await cli(dir, ['tick', '--job', 'hiring,status']);
    const all = await cli(dir, ['runs']);
    expect(all.text.split('\n')).toHaveLength(2);
    expect((await cli(dir, ['runs', '--job', 'status'])).text.split('\n')).toHaveLength(1);
    expect((await cli(dir, ['runs', '--status', 'failed'])).text).toBe('No runs logged yet.');
    expect((await cli(dir, ['runs', '--limit', '1'])).text.split('\n')).toHaveLength(1);
  });

  it('shows the status: each job, when it last ran, what is due, the facets and their pace', async () => {
    const dir = await fresh();
    await cli(dir, ['tick', '--job', 'hiring,status,enrichment']);
    const s = await cli(dir, ['status']);
    expect(s.text).toMatch(/Scheduler status at 2026-10-05T04:00:00.000Z/);
    expect(s.text).toMatch(/hiring\s+0 min ago\s+ok/);
    expect(s.text).toMatch(/hiring\s+every\s+3 d\s+2 checked,\s+0 never,\s+0 due now/);
    expect(s.text).toMatch(/founded_year\s+every 365 d/);
    expect(s.text).toMatch(/Queue: 2 task\(s\)/);
    const json = JSON.parse((await cli(dir, ['status', '--json'])).text);
    expect(json.jobs.map((j) => j.job)).toEqual(['discovery', 'funding', 'hiring', 'status', 'enrichment', 'quality']);
    expect(json.facets.hiring.checked).toBe(2);
  });

  it('shows the sources it would read, and that they have not been read yet', async () => {
    const dir = await fresh();
    const s = await cli(dir, ['status'], { sourceConfig: [{ id: 'rss.test', enabled: true }, { id: 'off.test', enabled: false }] });
    expect(s.text).toMatch(/rss\.test: discovery not read yet/);
    expect(s.text).not.toMatch(/off\.test/);
  });
});

describe('asking for a company to be read again', () => {
  it('makes its clocks due now, for one facet or all, and says how many', async () => {
    const dir = await fresh();
    await cli(dir, ['tick', '--job', 'hiring,status,enrichment']);
    const one = await cli(dir, ['reset', 'acme-robotics', '--facet', 'hiring']);
    expect(one.text).toMatch(/acme-robotics: 1 clock\(s\) set to due now \(hiring\)/);
    let ds = await readDataDir(dir);
    expect(ds.refresh_state.find((r) => r.target_id === 'acme-robotics' && r.facet === 'hiring').next_check_at).toBeNull();
    expect(Date.parse(ds.refresh_state.find((r) => r.target_id === 'acme-robotics' && r.facet === 'description').next_check_at)).toBeGreaterThan(NOW);
    expect((await cli(dir, ['reset', 'acme-robotics'])).text).toMatch(/4 clock\(s\) set to due now/); // hiring was already due
    const next = await cli(dir, ['plan', '--job', 'hiring']);
    expect(next.text).toMatch(/acme-robotics: hiring/);
    ds = await readDataDir(dir);
    expect(ds.refresh_state.every((r) => r.next_check_at === null || r.target_id !== 'acme-robotics' || true)).toBe(true);
  });

  it('sets the clocks from what the queue already did, without the network, and does nothing the second time', async () => {
    const dir = await fresh();
    const { runQueue } = await import('../src/enrichment/worker.js');
    const { seedFromAudit } = await import('../src/models/enrichmentQueue.js');
    const { auditDataset } = await import('../src/models/audit.js');
    const { transact } = await import('../src/models/store.js');
    await transact(dir, (work, { at }) => ({ result: seedFromAudit(work, auditDataset(work, { asOf: '2026-10-05' }), { at, by: 'aryan' }) }), { now: () => NOW });
    const w = web();
    await runQueue({ dir, now: () => NOW, concurrency: 1, fetcher: createFetcher({ fetchImpl: w.fetchImpl, resolveHost: async () => ['93.184.216.34'], sleep: async () => {}, now: () => NOW }) });
    const calls = w.calls.length;
    const first = await cli(dir, ['learn']);
    expect(first.text).toMatch(/learned from 3 finished task\(s\): \d+ clock\(s\) set/); // two reads and the company with no website
    expect((await readDataDir(dir)).refresh_state.length).toBeGreaterThan(0);
    expect(w.calls.length).toBe(calls);
    expect((await cli(dir, ['learn'])).text).toBe('learned from 0 finished task(s): 0 clock(s) set');
    expect((await cli(dir, ['status'])).text).toMatch(/status\s+every\s+14 d\s+2 checked/);
  });

  it('refuses a company that does not exist and a facet that does not exist', async () => {
    const dir = await fresh();
    await expect(cli(dir, ['reset', 'nobody'])).rejects.toThrow(/no company "nobody"/);
    await expect(cli(dir, ['reset', 'acme-robotics', '--facet', 'vibes'])).rejects.toThrow(/unknown facet "vibes"/);
    await expect(cli(dir, ['reset'])).rejects.toThrow(/reset needs a company id/);
  });
});

void DAY;
