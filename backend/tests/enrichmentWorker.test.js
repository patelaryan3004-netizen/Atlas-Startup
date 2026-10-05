import { describe, it, expect, afterEach } from 'vitest';
import { runQueue } from '../src/enrichment/worker.js';
import { transact } from '../src/models/store.js';
import { seedFromAudit, enqueueTask, BACKOFF_MS } from '../src/models/enrichmentQueue.js';
import { auditDataset } from '../src/models/audit.js';
import { createCandidate, moveTo } from '../src/models/candidate.js';
import { createFetcher } from '../src/discovery/http.js';
import { NOW, ISO, dataset, co, auPage } from './helpers/discovery.js';
import { makeDataDir, readDataDir, removeMadeDirs } from './helpers/store.js';

afterEach(removeMadeDirs);

const LD = JSON.stringify({
  '@context': 'https://schema.org', '@type': 'Organization', name: 'Acme Robotics', foundingDate: '2019-03-01',
  address: { streetAddress: '1 George Street', addressLocality: 'Sydney', addressRegion: 'NSW', postalCode: '2000', addressCountry: 'AU' },
});
const ACME_HOME = `<html><head><title>Acme Robotics | Home</title><meta name="description" content="Acme builds warehouse robots for Australian logistics.">
  <meta property="og:site_name" content="Acme Robotics"><script type="application/ld+json">${LD}</script></head><body><p>Hello</p></body></html>`;
const html = (body) => ({ body, headers: { 'content-type': 'text/html' } });

const companies = () => [
  co('Acme Robotics', { website: 'https://acme.com.au', blurb: '', city: 'Unknown', verified: false, lat: null, lng: null }),
  co('Beta Labs', { website: 'https://beta.example', blurb: 'Hand-written.' }),
  co('Gamma Works', { website: 'https://gamma.example', blurb: 'Hand-written.' }),
  co('Delta'), // no website
];

// A scripted web read through the real compliance fetcher. `gate` lets a test act while a read is in flight.
function webFor(routes, { gate = async () => {}, onRequest = () => {} } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    onRequest(url);
    await gate(url);
    const hit = routes[url];
    if (hit instanceof Error) throw hit;
    if (!hit) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
    return new Response(hit.body ?? '', { status: hit.status ?? 200, headers: hit.headers ?? { 'content-type': 'text/html' } });
  };
  const fetcher = createFetcher({ fetchImpl, resolveHost: async () => ['93.184.216.34'], sleep: async () => {}, now: () => NOW });
  return { fetcher, calls };
}

async function setup(extra = {}, ds = dataset(companies(), extra)) {
  const dir = await makeDataDir(ds);
  const clock = { now: NOW };
  const now = () => clock.now;
  await transact(dir, (work, { at }) => ({ result: seedFromAudit(work, auditDataset(work, { asOf: '2026-10-05' }), { at, by: 'aryan' }) }), { now });
  return { dir, clock, now };
}
const tasks = async (dir) => (await readDataDir(dir)).enrichment_queue;
const taskFor = async (dir, id) => (await tasks(dir)).filter((t) => t.target_id === id).at(-1);

describe('working through the queue', () => {
  it('reads each site, records the evidence and what was found, and changes no company in suggest mode', async () => {
    const { dir, now } = await setup();
    const before = (await readDataDir(dir)).companies;
    const { fetcher } = webFor({ 'https://acme.com.au/': html(ACME_HOME), 'https://beta.example/': html(auPage('Beta Labs')), 'https://gamma.example/': html(auPage('Gamma Works')) });
    const stats = await runQueue({ dir, fetcher, now, concurrency: 1 });
    expect(stats).toMatchObject({ claimed: 3, done: 3, failed: 0 });
    const after = await readDataDir(dir);
    expect(after.companies.map((c) => ({ ...c, last_verified_at: null, confidence_score: null, source_ids: [], updated_at: null }))).toEqual(before.map((c) => ({ ...c, last_verified_at: null, confidence_score: null, source_ids: [], updated_at: null })));
    expect(after.evidence.filter((e) => e.company_id === 'acme-robotics').map((e) => e.field).sort()).toEqual(expect.arrayContaining(['website', 'description', 'address', 'state', 'city', 'founded_year']));
    const acme = after.companies.find((c) => c.id === 'acme-robotics');
    expect(acme).toMatchObject({ last_verified_at: new Date(NOW).toISOString() });
    expect(acme.confidence_score).toBeGreaterThan(0);
    expect(await taskFor(dir, 'acme-robotics')).toMatchObject({ status: 'done', attempts: 0, result: { outcome: 'read', applied: [], suggested: expect.arrayContaining(['address', 'description']) } });
  });

  it('records each task that changed anything in the audit trail, as the worker, not a person', async () => {
    const { dir, now } = await setup();
    const { fetcher } = webFor({ 'https://acme.com.au/': html(ACME_HOME) });
    await runQueue({ dir, fetcher, now, concurrency: 1, by: 'enrichment' });
    const trail = (await readDataDir(dir)).audit_trail.filter((r) => r.target.id === 'acme-robotics');
    expect(trail).toEqual([expect.objectContaining({ actor: 'enrichment', role: 'system', via: 'worker', action: 'enrichment.task', summary: expect.stringMatching(/^Read acme\.com\.au: \d+ evidence added/) })]);
  });

  it('fills what the policy allows when asked to, and says what it filled', async () => {
    const { dir, now } = await setup();
    const { fetcher } = webFor({ 'https://acme.com.au/': html(ACME_HOME) });
    await runQueue({ dir, fetcher, now, concurrency: 1, mode: 'fill' });
    const after = await readDataDir(dir);
    expect(after.companies.find((c) => c.id === 'acme-robotics')).toMatchObject({ blurb: 'Acme builds warehouse robots for Australian logistics.', foundedYear: 2019, verified: false, city: 'Unknown' });
    const row = after.audit_trail.find((r) => r.target.id === 'acme-robotics');
    expect(row.summary).toMatch(/filled description, founded_year/);
    expect(row.changes).toEqual(expect.arrayContaining([{ field: 'blurb', from: '', to: 'Acme builds warehouse robots for Australian logistics.' }]));
    expect((await taskFor(dir, 'acme-robotics')).result.applied).toEqual(['description', 'founded_year']);
  });

  it('says so, and moves on, for a company with no website', async () => {
    const { dir, now } = await setup();
    const t = await taskFor(dir, 'delta');
    expect(t).toMatchObject({ status: 'skipped', result: { outcome: 'no_website' } });
    const { fetcher, calls } = webFor({});
    const stats = await runQueue({ dir, fetcher, now, concurrency: 1 });
    expect(stats.claimed).toBe(3);
    expect(calls.every((u) => !u.includes('delta'))).toBe(true);
  });

  it('respects robots.txt: a site that says no is skipped with the reason, not retried, and nothing is recorded', async () => {
    const { dir, now } = await setup();
    const { fetcher } = webFor({ 'https://acme.com.au/robots.txt': { body: 'User-agent: *\nDisallow: /\n', headers: { 'content-type': 'text/plain' } } });
    await runQueue({ dir, fetcher, now, concurrency: 1, limit: 3 });
    expect(await taskFor(dir, 'acme-robotics')).toMatchObject({ status: 'skipped', attempts: 0, result: { outcome: 'refused', code: 'robots_disallow' }, last_error: expect.stringMatching(/^robots_disallow/) });
    expect((await readDataDir(dir)).evidence.filter((e) => e.company_id === 'acme-robotics')).toEqual([]);
  });

  it('does not use a site that is plainly someone else\'s, and says so in the task', async () => {
    const { dir, now } = await setup();
    const other = '<html><head><title>Totally Different Co</title><meta property="og:site_name" content="Totally Different Co"></head><body>Hi</body></html>';
    const { fetcher } = webFor({ 'https://acme.com.au/': html(other) });
    await runQueue({ dir, fetcher, now, concurrency: 1, limit: 3 });
    const t = await taskFor(dir, 'acme-robotics');
    expect(t).toMatchObject({ status: 'done', result: { outcome: 'mismatch', evidence_added: 0, warnings: [expect.stringMatching(/does not appear to be Acme Robotics/)] } });
    expect((await readDataDir(dir)).evidence.filter((e) => e.company_id === 'acme-robotics')).toEqual([]);
  });

  it('treats a site telling it to slow down as something to try again later, not as a refusal', async () => {
    const { dir, now } = await setup({}, dataset([co('Acme Robotics', { website: 'https://acme.com.au' })]));
    const { fetcher } = webFor({ 'https://acme.com.au/robots.txt': { status: 429, body: 'slow down', headers: { 'content-type': 'text/plain' } } });
    await runQueue({ dir, fetcher, now, concurrency: 1 });
    expect(await taskFor(dir, 'acme-robotics')).toMatchObject({ status: 'queued', attempts: 1, last_error: expect.stringMatching(/robots_unavailable.*429/) });
  });

  it('retries a robots.txt it could not fetch at all, but not one that says access is controlled', async () => {
    const outcome = async (robots) => {
      const { dir, now } = await setup({}, dataset([co('Acme Robotics', { website: 'https://acme.com.au' })]));
      const { fetcher } = webFor({ 'https://acme.com.au/robots.txt': robots });
      await runQueue({ dir, fetcher, now, concurrency: 1 });
      return (await taskFor(dir, 'acme-robotics')).status;
    };
    expect(await outcome(new Error('fetch failed'))).toBe('queued'); // the connection dropped: try again later
    expect(await outcome({ status: 403, body: 'no', headers: { 'content-type': 'text/plain' } })).toBe('skipped'); // access-controlled: final
  });

  it('retries a network failure later with a growing back-off, and gives up after the last attempt', async () => {
    const { dir, clock, now } = await setup({}, dataset([co('Acme Robotics', { website: 'https://acme.com.au' })]));
    const { fetcher } = webFor({ 'https://acme.com.au/': new Error('socket hang up') });
    await runQueue({ dir, fetcher, now, concurrency: 1 });
    expect(await taskFor(dir, 'acme-robotics')).toMatchObject({ status: 'queued', attempts: 1, last_error: expect.stringMatching(/network_error/), not_before: new Date(NOW + BACKOFF_MS[0]).toISOString() });
    // Nothing happens before the back-off is over.
    expect((await runQueue({ dir, fetcher, now, concurrency: 1 })).claimed).toBe(0);
    clock.now = NOW + BACKOFF_MS[0] + 1000;
    await runQueue({ dir, fetcher, now, concurrency: 1 });
    expect(await taskFor(dir, 'acme-robotics')).toMatchObject({ status: 'queued', attempts: 2 });
    clock.now += BACKOFF_MS[1] + 1000;
    const stats = await runQueue({ dir, fetcher, now, concurrency: 1 });
    expect(stats).toMatchObject({ failed: 1 });
    expect(await taskFor(dir, 'acme-robotics')).toMatchObject({ status: 'failed', attempts: 3 });
  });

  it('takes tasks in priority order and stops at the limit, leaving the rest queued', async () => {
    const { dir, now } = await setup();
    await transact(dir, (work, { at }) => {
      work.enrichment_queue.find((t) => t.target_id === 'gamma-works').priority = 99999;
    }, { now });
    const seen = [];
    const { fetcher } = webFor({}, { onRequest: (u) => { if (!u.endsWith('robots.txt')) seen.push(new URL(u).hostname); } });
    const stats = await runQueue({ dir, fetcher, now, concurrency: 1, limit: 2 });
    expect(stats.claimed).toBe(2);
    expect(seen[0]).toBe('gamma.example');
    expect((await tasks(dir)).filter((t) => t.status === 'queued')).toHaveLength(1);
  });

  it('reads several sites at once when told to, and one at a time otherwise', async () => {
    const measure = async (concurrency) => {
      const { dir, now } = await setup();
      let inFlight = 0;
      let max = 0;
      const { fetcher } = webFor({ 'https://acme.com.au/': html(ACME_HOME) }, {
        onRequest: (u) => { if (!u.endsWith('robots.txt')) { inFlight += 1; max = Math.max(max, inFlight); } },
        // A read takes far longer than claiming the next task, as a real one does.
        gate: async (u) => { if (!u.endsWith('robots.txt')) { await new Promise((r) => setTimeout(r, 200)); inFlight -= 1; } },
      });
      await runQueue({ dir, fetcher, now, concurrency });
      return max;
    };
    expect(await measure(1)).toBe(1);
    expect(await measure(3)).toBeGreaterThan(1);
  });

  it('stops claiming when told to', async () => {
    const { dir, now } = await setup();
    let claimed = 0;
    const { fetcher } = webFor({});
    const stats = await runQueue({ dir, fetcher, now, concurrency: 1, onEvent: (e) => { if (e.type === 'start') claimed += 1; }, shouldStop: () => claimed >= 1 });
    expect(stats.claimed).toBe(1);
  });
});

describe('a run that takes a long time', () => {
  it('keeps a decision a person made while it was reading, and still records what it read', async () => {
    const { dir, now } = await setup();
    let edited = false;
    const { fetcher } = webFor({ 'https://acme.com.au/': html(ACME_HOME) }, {
      gate: async (url) => {
        if (edited || url.endsWith('robots.txt')) return;
        edited = true;
        // An admin edits another company while the worker is out on the network.
        await transact(dir, (work) => { work.companies.find((c) => c.id === 'beta-labs').blurb = 'Edited by an admin mid-run.'; return { audit: [{ actor: { name: 'aryan', role: 'admin' }, via: 'admin-ui', action: 'conflict.resolve', target: { type: 'company', id: 'beta-labs' }, summary: 'Edited' }] }; }, { now });
      },
    });
    await runQueue({ dir, fetcher, now, concurrency: 1, limit: 1 });
    const after = await readDataDir(dir);
    expect(after.companies.find((c) => c.id === 'beta-labs').blurb).toBe('Edited by an admin mid-run.');
    expect(after.evidence.filter((e) => e.company_id === 'acme-robotics').length).toBeGreaterThan(0);
    expect(after.audit_trail.map((r) => r.actor).sort()).toEqual(['aryan', 'enrichment']);
  });

  it('keeps a change made to the very company it was reading: its evidence is added to the record as it is now', async () => {
    const { dir, now } = await setup();
    let edited = false;
    const { fetcher } = webFor({ 'https://acme.com.au/': html(ACME_HOME) }, {
      gate: async (url) => {
        if (edited || url.endsWith('robots.txt')) return;
        edited = true;
        await transact(dir, (work) => { work.companies.find((c) => c.id === 'acme-robotics').blurb = 'A person wrote this first.'; }, { now });
      },
    });
    await runQueue({ dir, fetcher, now, concurrency: 1, limit: 1, mode: 'fill' });
    const acme = (await readDataDir(dir)).companies.find((c) => c.id === 'acme-robotics');
    expect(acme.blurb).toBe('A person wrote this first.'); // not overwritten by the description it read
    expect(acme.foundedYear).toBe(2019); // the unknown field was filled
  });

  it('survives a company being given a task twice, running both without double-counting evidence', async () => {
    const { dir, now } = await setup();
    const { fetcher } = webFor({ 'https://acme.com.au/': html(ACME_HOME) });
    await runQueue({ dir, fetcher, now, concurrency: 1, limit: 3 });
    const count = (await readDataDir(dir)).evidence.length;
    await transact(dir, (work, { at }) => { enqueueTask(work, { kind: 'company', targetId: 'acme-robotics', by: 'aryan', at, reason: 'refresh' }); }, { now });
    await runQueue({ dir, fetcher, now, concurrency: 1, limit: 3 });
    expect((await readDataDir(dir)).evidence).toHaveLength(count);
  });
});

describe('newly found companies go through the same queue', () => {
  const candidate = (status) => {
    let c = createCandidate({
      id: 'cand-zorbly', name: 'Zorbly', website: 'https://zorbly.com.au',
      discoveries: [{ source_id: 'test.feed', source_kind: 'press', license_basis: 'public_feed', region: 'AU', key: 'z', url: null, title: 'Zorbly raises $4m', observed_at: ISO }],
    }, { at: ISO });
    c = moveTo(c, 'needs_review', { at: ISO });
    if (status === 'approved') { c = moveTo(c, 'approved', { at: ISO, by: 'aryan' }); c.review = { by: 'aryan', at: ISO, note: null }; }
    return c;
  };
  const withTask = async (c) => {
    const dir = await makeDataDir(dataset(companies(), { candidates: [c] }));
    const now = () => NOW;
    await transact(dir, (work, { at }) => { enqueueTask(work, { kind: 'candidate', targetId: c.id, by: 'aryan', at, reason: 'approved', priority: 4500 }); }, { now });
    return { dir, now };
  };

  it('reads a candidate\'s site and adds what it says to the candidate, never to a company', async () => {
    const { dir, now } = await withTask(candidate('needs_review'));
    const { fetcher } = webFor({ 'https://zorbly.com.au/': html(auPage('Zorbly', { abn: '53 004 085 616' })) });
    await runQueue({ dir, fetcher, now, concurrency: 1 });
    const after = await readDataDir(dir);
    const c = after.candidates.find((x) => x.id === 'cand-zorbly');
    expect(c.evidence.map((e) => e.field)).toEqual(expect.arrayContaining(['website', 'address', 'founded_year']));
    expect(c.external_ids.abn).toBe('53004085616');
    expect(after.companies).toHaveLength(4);
    expect(after.audit_trail).toEqual([expect.objectContaining({ action: 'candidate.enrich', target: { type: 'candidate', id: 'cand-zorbly' }, role: 'system' })]);
    expect((await taskFor(dir, 'cand-zorbly'))).toMatchObject({ kind: 'candidate', status: 'done' });
  });

  it('keeps an approved candidate approved while it is still a clean new company', async () => {
    const { dir, now } = await withTask(candidate('approved'));
    const { fetcher } = webFor({ 'https://zorbly.com.au/': html(auPage('Zorbly')) });
    await runQueue({ dir, fetcher, now, concurrency: 1 });
    const c = (await readDataDir(dir)).candidates.find((x) => x.id === 'cand-zorbly');
    expect(c.status).toBe('approved');
    expect(c.evidence.length).toBeGreaterThan(0);
  });

  it('skips a candidate that has been rejected since it was queued', async () => {
    const c = candidate('needs_review');
    const { dir, now } = await withTask(c);
    await transact(dir, (work, { at }) => { work.candidates[0] = moveTo(work.candidates[0], 'rejected', { at, by: 'aryan', note: 'No.' }); }, { now });
    const { fetcher } = webFor({ 'https://zorbly.com.au/': html(auPage('Zorbly')) });
    await runQueue({ dir, fetcher, now, concurrency: 1 });
    expect(await taskFor(dir, 'cand-zorbly')).toMatchObject({ status: 'skipped', last_error: 'the candidate is rejected' });
  });
});
