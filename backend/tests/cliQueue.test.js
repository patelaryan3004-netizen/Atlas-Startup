import { describe, it, expect, afterEach } from 'vitest';
import { main } from '../scripts/discovery.js';
import { createCandidate, moveTo } from '../src/models/candidate.js';
import { createFetcher } from '../src/discovery/http.js';
import { NOW, ISO, dataset, co, auPage } from './helpers/discovery.js';
import { makeDataDir, readDataDir, removeMadeDirs } from './helpers/store.js';

afterEach(removeMadeDirs);

const html = (body) => ({ body, headers: { 'content-type': 'text/html' } });
const web = (routes) => createFetcher({
  fetchImpl: async (url) => { const hit = routes[url]; return hit ? new Response(hit.body, { status: 200, headers: hit.headers }) : new Response('nope', { status: 404, headers: { 'content-type': 'text/html' } }); },
  resolveHost: async () => ['93.184.216.34'], sleep: async () => {}, now: () => NOW,
});

async function cliIn(dir, argv, deps = {}) {
  const lines = [];
  const code = await main(argv, { dataDir: dir, out: (s) => lines.push(s), now: () => NOW, fetcher: web({}), ...deps });
  return { code, text: lines.join('\n') };
}
const base = () => dataset([
  co('Acme Robotics', { website: 'https://acme.com.au', blurb: '' }),
  co('Beta Labs', { website: 'https://beta.example' }),
  co('Gamma'),
]);

describe('seeding and watching the queue', () => {
  it('queues the companies in the audit\'s order, records that it did, and does not queue them twice', async () => {
    const dir = await makeDataDir(base());
    const first = await cliIn(dir, ['queue', 'seed', '--by', 'Me']);
    expect(first.text).toMatch(/queued 2 companies in the audit's order; 1 have no website \(recorded as skipped\)/);
    const ds = await readDataDir(dir);
    expect(ds.enrichment_queue.map((t) => [t.target_id, t.status])).toEqual(expect.arrayContaining([['acme-robotics', 'queued'], ['beta-labs', 'queued'], ['gamma', 'skipped']]));
    expect(ds.audit_trail.at(-1)).toMatchObject({ action: 'enrichment.seed', actor: 'Me', role: 'cli', target: { type: 'queue', id: 'enrichment' } });
    expect((await cliIn(dir, ['queue', 'seed', '--by', 'Me'])).text).toMatch(/queued 0 companies.*2 already waiting/);
    await expect(cliIn(dir, ['queue', 'seed'])).rejects.toThrow(/--by is required/);
  });

  it('can start with a limited first batch', async () => {
    const dir = await makeDataDir(base());
    expect((await cliIn(dir, ['queue', 'seed', '--by', 'Me', '--limit', '1'])).text).toMatch(/queued 1 company.*1 left for a later seed/);
  });

  it('shows what is waiting, and what needs a person\'s look', async () => {
    const dir = await makeDataDir(base());
    await cliIn(dir, ['queue', 'seed', '--by', 'Me']);
    expect((await cliIn(dir, ['queue', 'status'])).text).toMatch(/3 task\(s\): 2 queued, 1 skipped\n2 ready now, 0 backing off/);
  });
});

describe('running the queue', () => {
  it('reads the sites, records what it found without changing a company, and says what it did', async () => {
    const dir = await makeDataDir(base());
    await cliIn(dir, ['queue', 'seed', '--by', 'Me']);
    const before = (await readDataDir(dir)).companies.map((c) => c.blurb);
    const fetcher = web({ 'https://acme.com.au/': html(auPage('Acme Robotics')) });
    const run = await cliIn(dir, ['queue', 'run', '--by', 'Me', '--concurrency', '1'], { fetcher });
    expect(run.text).toMatch(/reading websites in suggest mode \(evidence only: no company is changed\)/);
    expect(run.text).toMatch(/2 task\(s\): 1 read, 1 skipped, 0 failed, 0 to retry\. \d+ evidence added\./);
    const ds = await readDataDir(dir);
    expect(ds.companies.map((c) => c.blurb)).toEqual(before);
    expect(ds.evidence.some((e) => e.company_id === 'acme-robotics' && e.field === 'website')).toBe(true);
    expect(ds.audit_trail.map((r) => r.action)).toEqual(expect.arrayContaining(['enrichment.seed', 'enrichment.task', 'enrichment.run']));
    expect(ds.audit_trail.at(-1)).toMatchObject({ action: 'enrichment.run', actor: 'Me', summary: expect.stringMatching(/suggest mode: 1 read, 1 skipped/) });
  });

  it('fills what the policy allows only when asked to', async () => {
    const dir = await makeDataDir(base());
    await cliIn(dir, ['queue', 'seed', '--by', 'Me']);
    const fetcher = web({ 'https://acme.com.au/': html(auPage('Acme Robotics')) });
    const run = await cliIn(dir, ['queue', 'run', '--by', 'Me', '--mode', 'fill', '--concurrency', '1'], { fetcher });
    expect(run.text).toMatch(/field\(s\) filled/);
    expect((await readDataDir(dir)).companies.find((c) => c.id === 'acme-robotics')).toMatchObject({ blurb: 'Acme Robotics makes things.', foundedYear: 2022 });
    await expect(cliIn(dir, ['queue', 'run', '--by', 'Me', '--mode', 'yolo'])).rejects.toThrow(/--mode must be one of suggest, fill/);
  });

  it('retries and cancels a task, and says when it cannot', async () => {
    const dir = await makeDataDir(base());
    await cliIn(dir, ['queue', 'seed', '--by', 'Me']);
    const [t] = (await readDataDir(dir)).enrichment_queue.filter((x) => x.status === 'queued');
    expect((await cliIn(dir, ['queue', 'cancel', t.id, '--by', 'Me'])).text).toMatch(/cancelled/);
    expect((await readDataDir(dir)).audit_trail.at(-1)).toMatchObject({ action: 'enrichment.cancel', target: { type: 'queue', id: t.id } });
    expect((await cliIn(dir, ['queue', 'retry', t.id, '--by', 'Me'])).text).toMatch(/queued again/);
    await expect(cliIn(dir, ['queue', 'cancel', 'enq-nobody-1', '--by', 'Me'])).rejects.toThrow(/no enrichment task/);
    await expect(cliIn(dir, ['queue', 'retry', t.id, '--by', 'Me'])).rejects.toThrow(/only a failed, cancelled or skipped task/);
    await expect(cliIn(dir, ['queue', 'frobnicate'])).rejects.toThrow(/queue needs one of/);
  });
});

describe('new companies join the same queue', () => {
  const candidate = () => {
    let c = createCandidate({
      id: 'cand-zorbly', name: 'Zorbly', website: 'https://zorbly.com.au',
      discoveries: [{ source_id: 'test.feed', source_kind: 'press', license_basis: 'public_feed', region: 'AU', key: 'z', url: null, title: null, observed_at: ISO }],
    }, { at: ISO });
    c = moveTo(c, 'needs_review', { at: ISO });
    return c;
  };

  it('queues an approved candidate\'s website to be read before it is published, and a published company ahead of everything', async () => {
    const dir = await makeDataDir(dataset(base().companies.map(({ id, slug, ...c }) => c), { candidates: [candidate()] }));
    await cliIn(dir, ['queue', 'seed', '--by', 'Me']);
    const approved = await cliIn(dir, ['approve', 'cand-zorbly', '--by', 'Me']);
    expect(approved.text).toMatch(/approved \(its website is queued to be read before it is published\)/);
    let ds = await readDataDir(dir);
    expect(ds.enrichment_queue.find((t) => t.target_id === 'cand-zorbly')).toMatchObject({ kind: 'candidate', status: 'queued', reason: 'approved' });
    expect(ds.audit_trail.at(-1).summary).toMatch(/website queued for reading/);
    const published = await cliIn(dir, ['publish', 'cand-zorbly', '--by', 'Me']);
    expect(published.text).toMatch(/queued for enrichment/);
    ds = await readDataDir(dir);
    const task = ds.enrichment_queue.find((t) => t.target_id === 'zorbly');
    expect(task).toMatchObject({ kind: 'company', status: 'queued', reason: 'published' });
    expect(task.priority).toBe(Math.max(...ds.enrichment_queue.map((t) => t.priority)));
  });

  it('does not queue a candidate whose website the discovery engine already read', async () => {
    const read = candidate();
    read.evidence = [{ field: 'website', value: 'https://zorbly.com.au', confidence: 'high', verified_at: ISO, note: 'The site itself.', source: { kind: 'company_website', url: 'https://zorbly.com.au/', title: null, publisher: null, retrieved_at: ISO, note: '' } }];
    const dir = await makeDataDir(dataset(base().companies.map(({ id, slug, ...c }) => c), { candidates: [read] }));
    expect((await cliIn(dir, ['approve', 'cand-zorbly', '--by', 'Me'])).text).toBe('cand-zorbly approved\n\nwrote candidates.json, audit_trail.json');
    expect((await readDataDir(dir)).enrichment_queue).toEqual([]);
  });
});
