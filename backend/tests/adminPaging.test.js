import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAdminApp } from '../src/admin/server.js';
import { createAdminService } from '../src/admin/service.js';
import { addUser, loadUsers, createAuthenticator, createLimiter, createSecurityLog } from '../src/admin/auth.js';
import { runDiscovery } from '../src/discovery/pipeline.js';
import { NOW, co, dataset, lead, fakeSource, fetcherFor } from './helpers/discovery.js';
import { makeDataDir, removeMadeDirs } from './helpers/store.js';

// Every list the Command Center serves is a page: 20 unless asked, 500 at most. These pin the shape and that following the next page
// reaches every row once, on a directory big enough to need more than one page.

const homes = [];
afterEach(async () => { await removeMadeDirs(); await Promise.all(homes.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });
const AT = Date.parse('2026-10-06T01:00:00.000Z');
const as = (token) => ({ Authorization: `Bearer ${token}` });
const JSON_HEADERS = { 'Content-Type': 'application/json' };

// 45 invented names that do not look alike, so each is its own candidate.
const SYLLABLES = ['Zor', 'Xel', 'Qua', 'Vin', 'Mur', 'Kep', 'Lum', 'Dro', 'Fen'];
const ENDINGS = ['bly', 'tra', 'lio', 'mex', 'dax'];
const NAMES = SYLLABLES.flatMap((a, i) => ENDINGS.map((b, j) => `${a}${b}${'abcdefghij'[(i + j) % 10]}${i}${j}`));

async function boot() {
  // 30 companies with no website (10 also with no sector), 25 pairs on one website each (those have a website); 45 candidates found by discovery.
  const companies = [
    ...Array.from({ length: 30 }, (_, i) => co(`Blank${i}Co`, { website: '', ...(i < 10 ? { sector: 'Unknown', sectorFull: 'Unknown' } : {}) })),
    ...Array.from({ length: 25 }, (_, i) => [co(`Twin${i}Alpha`, { website: `https://twin${i}.example` }), co(`Twin${i}Beta`, { website: `https://twin${i}.example/about` })]).flat(),
  ];
  const leads = NAMES.map((name) => lead({ key: name, name, text: `${name} raises $2m. Aussie startup` }));
  const { fetcher } = fetcherFor({});
  const { ds } = await runDiscovery({ ds: dataset(companies), sources: [fakeSource({ leads })], fetcher, now: () => NOW });
  const dir = await makeDataDir(ds);
  const home = await mkdtemp(path.join(os.tmpdir(), 'admin-home-'));
  homes.push(home);
  const file = path.join(home, 'users.json');
  const tokens = {};
  for (const [name, role] of [['Sam', 'viewer'], ['Aryan', 'admin']]) tokens[role] = (await addUser(file, { name, role })).token;
  const service = createAdminService({ dir, now: () => AT });
  const app = createAdminApp({ service, authenticator: createAuthenticator(await loadUsers(file)), limiter: createLimiter(), securityLog: createSecurityLog(path.join(home, 'security.log')), logger: { error() {} } });
  return { app, service, tokens, get: (p) => request(app).get(p).set(as(tokens.viewer)) };
}

// Every row of a list, by following its nextOffset.
async function every(get, route, size = 20) {
  const rows = [];
  let offset = 0;
  const sep = route.includes('?') ? '&' : '?';
  for (let pages = 0; pages < 200; pages += 1) {
    const res = await get(`${route}${sep}limit=${size}&offset=${offset}`);
    expect(res.status, route).toBe(200);
    rows.push(...res.body.results);
    if (res.body.nextOffset === null) return rows;
    offset = res.body.nextOffset;
  }
  throw new Error('never ended');
}

describe('the review lists are pages', () => {
  it('gives 20 candidates at a time, says how many there are, and reaches every one once', async () => {
    const { get } = await boot();
    const first = await get('/api/candidates?status=all');
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ total: 45, offset: 0, limit: 20, hasMore: true, nextOffset: 20 });
    expect(first.body.results).toHaveLength(20);
    expect(first.body.counts.all).toBe(45);
    const all = await every(get, '/api/candidates?status=all');
    expect(all).toHaveLength(45);
    expect(new Set(all.map((c) => c.id)).size).toBe(45);
    const last = await get('/api/candidates?status=all&offset=40');
    expect(last.body).toMatchObject({ hasMore: false, nextOffset: null });
    expect(last.body.results).toHaveLength(5);
  });

  it('takes a page of up to 500, and refuses 0, 501, text and a negative start as a 400', async () => {
    const { get } = await boot();
    expect((await get('/api/candidates?status=all&limit=500')).body.results).toHaveLength(45);
    for (const q of ['limit=0', 'limit=501', 'limit=abc', 'offset=-1', 'offset=1.5']) {
      const res = await get(`/api/candidates?${q}`);
      expect(res.status, q).toBe(400);
      expect(res.body.error, q).toMatch(/whole number/);
    }
    for (const route of ['/api/missing', '/api/duplicates', '/api/conflicts', '/api/suggestions', '/api/locations', '/api/investors', '/api/audit']) {
      expect((await get(`${route}?limit=501`)).status, route).toBe(400);
    }
  });

  it('pages the companies missing data, narrowed to one missing fact on the server, with the counts of them all', async () => {
    const { get } = await boot();
    const first = await get('/api/missing');
    expect(first.body).toMatchObject({ total: 30, count: 30, field: null, limit: 20, hasMore: true });
    expect(first.body.counts.website).toBe(30);
    expect(first.body.counts.sector).toBe(10);
    const sector = await get('/api/missing?field=sector');
    expect(sector.body).toMatchObject({ total: 30, count: 10, field: 'sector', hasMore: false });
    expect(sector.body.results).toHaveLength(10);
    expect(sector.body.results.every((r) => r.missing.includes('sector'))).toBe(true);
    const all = await every(get, '/api/missing');
    expect(all).toHaveLength(30);
    expect(new Set(all.map((r) => r.id)).size).toBe(30);
    expect((await get('/api/missing?field=colour')).status).toBe(400);
  });

  it('pages the companies that look alike, each pair once', async () => {
    const { get } = await boot();
    const first = await get('/api/duplicates');
    expect(first.body.total).toBeGreaterThanOrEqual(25);
    expect(first.body.results).toHaveLength(20);
    const all = await every(get, '/api/duplicates');
    expect(all).toHaveLength(first.body.total);
    expect(new Set(all.map((g) => g.company_ids.join('|'))).size).toBe(first.body.total);
  });

  it('answers conflicts and suggestions as pages with a count of each field, and narrows by field', async () => {
    const { get } = await boot();
    for (const route of ['/api/conflicts', '/api/suggestions']) {
      const res = await get(route);
      expect(res.status, route).toBe(200);
      expect(res.body, route).toMatchObject({ total: 0, count: 0, counts: {}, results: [], limit: 20, hasMore: false, nextOffset: null });
      expect((await get(`${route}?field=city`)).body, route).toMatchObject({ field: 'city', count: 0 });
    }
  });
});

describe('the audit trail is paged by cursor, newest first', () => {
  it('walks the whole trail once, and a new row added while reading does not move the next page', async () => {
    const { app, tokens, get, service } = await boot();
    const ids = (await get('/api/candidates?status=all&limit=40')).body.results.map((c) => c.id);
    for (const id of ids.slice(0, 30)) await service.reject({ name: 'Aryan', role: 'admin' }, id, { reason: 'Not a startup.' });
    const first = await get('/api/audit?limit=10');
    expect(first.body).toMatchObject({ total: 30, limit: 10, hasMore: true });
    expect(first.body.results).toHaveLength(10);
    // an action taken between two pages puts a new row at the front of a newest-first list
    const post = await request(app).post(`/api/candidates/${ids[30]}/reject`).set(as(tokens.admin)).set(JSON_HEADERS).send({ reason: 'Also not a startup.' });
    expect(post.status).toBe(200);
    const second = await get(`/api/audit?limit=10&cursor=${first.body.nextCursor}`);
    const expectedAfter = (await get('/api/audit?limit=500')).body.results;
    const at = expectedAfter.findIndex((r) => r.id === first.body.results[9].id);
    expect(second.body.results.map((r) => r.id)).toEqual(expectedAfter.slice(at + 1, at + 11).map((r) => r.id));
    expect(second.body.results.map((r) => r.id)).not.toContain(first.body.results[9].id); // no row twice
    const seen = [...first.body.results];
    let next = first.body.nextCursor;
    while (next) {
      const res = await get(`/api/audit?limit=10&cursor=${next}`);
      seen.push(...res.body.results);
      next = res.body.nextCursor;
    }
    expect(new Set(seen.map((r) => r.id)).size).toBe(seen.length); // each row once
    expect(seen).toHaveLength(30); // the 31st was added after the first page, in front of it
  });

  it('is 20 to a page by default, refuses a cursor it did not give as a 400, and keeps a filter', async () => {
    const { get, service } = await boot();
    const ids = (await get('/api/candidates?status=all&limit=40')).body.results.map((c) => c.id);
    for (const id of ids.slice(0, 25)) await service.reject({ name: 'Aryan', role: 'admin' }, id, { reason: 'Not a startup.' });
    const res = await get('/api/audit');
    expect(res.body).toMatchObject({ limit: 20, hasMore: true });
    expect(res.body.results).toHaveLength(20);
    expect((await get('/api/audit?cursor=bm9wZQ')).status).toBe(400);
    expect((await get('/api/audit?limit=0')).status).toBe(400);
    const filtered = await get('/api/audit?action=candidate.reject&limit=5');
    expect(filtered.body.total).toBe(25);
    expect(filtered.body.results.every((r) => r.action === 'candidate.reject')).toBe(true);
    expect((await get(`/api/audit?action=candidate.approve&cursor=${filtered.body.nextCursor}`)).status).toBe(400); // the cursor names a row this filter does not hold
  });
});

describe('the lists with a count of their own keep it whatever the page', () => {
  it('has the same counts on every page of the candidates, and the same total behind each investors and locations page', async () => {
    const { get } = await boot();
    const [a, b] = [await get('/api/candidates?status=all&limit=5&offset=0'), await get('/api/candidates?status=all&limit=5&offset=10')];
    expect(a.body.counts).toEqual(b.body.counts);
    expect(a.body.total).toBe(b.body.total);
    const loc = await get('/api/locations?limit=3');
    expect(loc.body.results.length).toBeLessThanOrEqual(3);
    expect(loc.body).toMatchObject({ limit: 3 });
    expect((await get('/api/locations?limit=3&offset=3')).body.queue).toBe(loc.body.queue);
    expect((await get('/api/investors')).body).toMatchObject({ limit: 20, offset: 0, hasMore: false, nextOffset: null });
  });
});
