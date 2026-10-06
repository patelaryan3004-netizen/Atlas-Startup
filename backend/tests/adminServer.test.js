import { describe, it, expect, afterEach, vi } from 'vitest';
import request from 'supertest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAdminApp, SECURITY_HEADERS } from '../src/admin/server.js';
import { createAdminService } from '../src/admin/service.js';
import { addUser, loadUsers, createAuthenticator, createLimiter, createSecurityLog } from '../src/admin/auth.js';
import { runDiscovery } from '../src/discovery/pipeline.js';
import { createFetcher } from '../src/discovery/http.js';
import { NOW, dataset, lead, fakeSource, fetcherFor, auPage } from './helpers/discovery.js';
import { makeDataDir, readDataDir, removeMadeDirs } from './helpers/store.js';

const homes = [];
afterEach(async () => { await removeMadeDirs(); await Promise.all(homes.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });
const AT = Date.parse('2026-10-06T01:00:00.000Z');

async function boot({ limiter, service: custom, logger = { error: vi.fn() } } = {}) {
  const { fetcher } = fetcherFor({ 'https://zorbly.com.au/': { body: auPage('Zorbly') } });
  const leads = [lead({ key: 'z', name: 'Zorbly', website: 'zorbly.com.au', text: 'Zorbly raises $4m. Aussie startup' }), lead({ key: 'x', name: 'Xylo', text: 'Xylo raises $2m. Aussie startup' })];
  const { ds } = await runDiscovery({ ds: dataset(), sources: [fakeSource({ leads })], fetcher, now: () => NOW });
  const dir = await makeDataDir(ds);
  const home = await mkdtemp(path.join(os.tmpdir(), 'admin-home-'));
  homes.push(home);
  const file = path.join(home, 'users.json');
  const tokens = {};
  for (const [name, role] of [['Sam', 'viewer'], ['Riley', 'reviewer'], ['Aryan', 'admin']]) tokens[role] = (await addUser(file, { name, role })).token;
  // A run reads websites, so the service is given a scripted web (slow enough to see a job in progress), never the real one.
  const slowWeb = () => createFetcher({
    fetchImpl: async (u) => {
      if (!u.endsWith('robots.txt')) await new Promise((r) => setTimeout(r, 250));
      return u === 'https://zorbly.com.au/' ? new Response(auPage('Zorbly'), { status: 200, headers: { 'content-type': 'text/html' } }) : new Response('nope', { status: 404, headers: { 'content-type': 'text/html' } });
    },
    resolveHost: async () => ['93.184.216.34'], sleep: async () => {}, now: () => NOW,
  });
  const service = custom ?? createAdminService({ dir, now: () => AT, fetcherFactory: slowWeb });
  const securityLog = createSecurityLog(path.join(home, 'security.log'));
  const app = createAdminApp({ service, authenticator: createAuthenticator(await loadUsers(file)), limiter: limiter ?? createLimiter(), securityLog, logger });
  const logText = async () => readFile(path.join(home, 'security.log'), 'utf8').catch(() => '');
  return { app, dir, tokens, logText, logger, service };
}
const as = (token) => ({ Authorization: `Bearer ${token}` });
const JSON_HEADERS = { 'Content-Type': 'application/json' };

describe('what the server sends with everything', () => {
  it('serves the page with a policy that allows only its own script and style, and tells the browser to keep nothing', async () => {
    const { app } = await boot();
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.type).toBe('text/html');
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(res.headers[name.toLowerCase()], name).toBe(value);
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['content-security-policy']).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.text).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it('sends no CORS header to anyone, so no other site can read an answer, and refuses a preflight', async () => {
    const { app, tokens } = await boot();
    for (const res of [
      await request(app).get('/').set('Origin', 'https://evil.example'),
      await request(app).get('/api/overview').set(as(tokens.admin)).set('Origin', 'https://evil.example'),
      await request(app).options('/api/overview').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET'),
    ]) expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect((await request(app).options('/api/overview').set('Origin', 'https://evil.example')).status).toBe(403);
  });

  it('serves the script and the style, and answers 404 for anything else, with nothing in it', async () => {
    const { app } = await boot();
    expect((await request(app).get('/app.js')).type).toBe('text/javascript');
    expect((await request(app).get('/styles.css')).type).toBe('text/css');
    for (const p of ['/.env', '/package.json', '/../package.json', '/src/data/startups.json', '/index.html', '/%2e%2e/%2e%2e/etc/passwd']) {
      const res = await request(app).get(p);
      expect(res.status, p).toBe(404);
      expect(res.text, p).toBe('not found');
    }
  });
});

describe('answering only to this machine, for this page', () => {
  it('refuses a Host that is not this machine on this port, so a web page cannot reach it by another name', async () => {
    const { app } = await boot();
    for (const host of ['evil.example', 'evil.example:80', '127.0.0.1:1', 'localhost', '127.0.0.1.evil.example', '10.0.0.5:4010']) {
      const res = await request(app).get('/').set('Host', host);
      expect(res.status, host).toBe(403);
      expect(res.body.error).toMatch(/only on this machine/);
    }
  });

  it('refuses a change from another site, and one that is not JSON, whoever it claims to be', async () => {
    const { app, tokens } = await boot();
    const post = (extra) => request(app).post('/api/queue/seed').set(as(tokens.admin)).set(JSON_HEADERS).set(extra).send({});
    expect((await post({ Origin: 'https://evil.example' })).status).toBe(403);
    expect((await post({ 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    expect((await post({ 'Sec-Fetch-Site': 'same-site' })).status).toBe(403);
    expect((await post({ 'Sec-Fetch-Site': 'same-origin' })).status).toBe(200);
    expect((await request(app).post('/api/queue/seed').set(as(tokens.admin)).set('Content-Type', 'text/plain').send('{}')).status).toBe(415);
    expect((await request(app).post('/api/queue/seed').set(as(tokens.admin)).set('Content-Type', 'application/x-www-form-urlencoded').send('a=1')).status).toBe(415);
  });

  it('answers a malformed or oversized body with an error, not a crash', async () => {
    const { app, tokens } = await boot();
    const bad = await request(app).post('/api/queue/seed').set(as(tokens.admin)).set(JSON_HEADERS).send('{"limit": ');
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ error: 'the request is not valid JSON' });
    const big = await request(app).post('/api/queue/seed').set(as(tokens.admin)).set(JSON_HEADERS).send(JSON.stringify({ x: 'a'.repeat(70000) }));
    expect(big.status).toBe(413);
  });
});

describe('signing in', () => {
  it('needs a token in the Authorization header, and nothing else counts', async () => {
    const { app, tokens } = await boot();
    expect((await request(app).get('/api/overview')).status).toBe(401);
    expect((await request(app).get('/api/overview').set('Authorization', 'Basic abc')).status).toBe(401);
    expect((await request(app).get('/api/overview').set('Authorization', `Bearer`)).status).toBe(401);
    // the token in a query string, a cookie or another header is not a sign-in
    expect((await request(app).get(`/api/overview?token=${tokens.admin}`)).status).toBe(401);
    expect((await request(app).get('/api/overview').set('Cookie', `token=${tokens.admin}`)).status).toBe(401);
    expect((await request(app).get('/api/overview').set('X-Admin-Key', tokens.admin)).status).toBe(401);
    expect((await request(app).get('/api/overview').set(as(tokens.viewer))).status).toBe(200);
  });

  it('says who you are and what you may do, to a person who signs in', async () => {
    const { app, tokens } = await boot();
    const res = await request(app).post('/api/login').set(JSON_HEADERS).send({ token: tokens.reviewer });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Riley', role: 'reviewer', permissions: expect.arrayContaining(['read', 'candidate.approve']) });
    expect(res.body.permissions).not.toContain('candidate.publish');
    expect((await request(app).get('/api/me').set(as(tokens.admin))).body).toMatchObject({ name: 'Aryan', role: 'admin' });
    expect(JSON.stringify(res.body)).not.toContain(tokens.reviewer);
  });

  it('refuses a wrong token the same way every time, and writes it to the security log without the token', async () => {
    const { app, logText, tokens } = await boot();
    const wrong = 'aus_thisisnotarealtokenbutitisalongonethatlooksreal';
    const a = await request(app).post('/api/login').set(JSON_HEADERS).send({ token: wrong });
    const b = await request(app).get('/api/overview').set(as(wrong));
    expect([a.status, b.status]).toEqual([401, 401]);
    const log = await logText();
    expect(log).toContain('login.failed');
    expect(log).toContain('auth.failed');
    expect(log).not.toContain(wrong);
    await request(app).post('/api/login').set(JSON_HEADERS).send({ token: tokens.admin });
    expect(await logText()).toMatch(/"event":"login","user":"Aryan","role":"admin"/);
    expect(await logText()).not.toContain(tokens.admin);
  });

  it('refuses everything for a while after too many wrong tokens, even a right one, and then lets people back in', async () => {
    let t = 0;
    const { app, tokens } = await boot({ limiter: createLimiter({ max: 3, windowMs: 60000, lockMs: 60000, now: () => t }) });
    for (let i = 0; i < 3; i += 1) await request(app).post('/api/login').set(JSON_HEADERS).send({ token: `aus_wrong${i}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` });
    const locked = await request(app).get('/api/overview').set(as(tokens.admin));
    expect(locked.status).toBe(429);
    expect(locked.body.error).toMatch(/too many wrong tokens: try again in \d+ seconds/);
    expect((await request(app).post('/api/login').set(JSON_HEADERS).send({ token: tokens.admin })).status).toBe(429);
    t += 61000;
    expect((await request(app).get('/api/overview').set(as(tokens.admin))).status).toBe(200);
  });

  it('does not count a request with no token at all as a wrong one: opening the page is not an attack', async () => {
    const { app, tokens } = await boot({ limiter: createLimiter({ max: 2 }) });
    for (let i = 0; i < 6; i += 1) expect((await request(app).get('/api/overview')).status).toBe(401);
    expect((await request(app).get('/api/overview').set(as(tokens.admin))).status).toBe(200);
  });
});

describe('who may do what, over HTTP', () => {
  it('lets a viewer look and not touch, a reviewer decide about candidates but not publish, an admin do both', async () => {
    const { app, tokens, dir } = await boot();
    const id = (await readDataDir(dir)).candidates.find((c) => c.name === 'Zorbly').id;
    const post = (token, route, body = {}) => request(app).post(route).set(as(token)).set(JSON_HEADERS).send(body);
    expect((await post(tokens.viewer, `/api/candidates/${id}/approve`)).status).toBe(403);
    expect((await post(tokens.reviewer, `/api/candidates/${id}/approve`, { note: 'ok' })).status).toBe(200);
    expect((await post(tokens.reviewer, `/api/candidates/${id}/publish`)).status).toBe(403);
    const forbidden = await post(tokens.reviewer, `/api/candidates/${id}/publish`);
    expect(forbidden.body.error).toBe('candidate.publish needs the admin role, and you are a reviewer');
    expect((await post(tokens.admin, `/api/candidates/${id}/publish`)).status).toBe(200);
    expect((await request(app).get('/api/audit').set(as(tokens.viewer))).body.results.map((r) => r.action)).toEqual(['candidate.publish', 'candidate.approve']);
  });

  it('writes a refused attempt to the security log, with who and what, so a person probing is seen', async () => {
    const { app, tokens, logText } = await boot();
    await request(app).post('/api/queue/seed').set(as(tokens.viewer)).set(JSON_HEADERS).send({});
    expect(await logText()).toMatch(/"event":"forbidden","user":"Sam","role":"viewer","method":"POST","path":"\/api\/queue\/seed"/);
  });

  it('records the person who signed in as the one who acted, whatever the request says', async () => {
    const { app, tokens, dir } = await boot();
    const id = (await readDataDir(dir)).candidates.find((c) => c.name === 'Zorbly').id;
    await request(app).post(`/api/candidates/${id}/approve`).set(as(tokens.reviewer)).set(JSON_HEADERS).send({ by: 'Aryan', actor: { name: 'Aryan', role: 'admin' } });
    expect((await readDataDir(dir)).audit_trail.at(-1)).toMatchObject({ actor: 'Riley', role: 'reviewer', via: 'admin-ui' });
  });
});

describe('the actions and what they answer', () => {
  it('maps a rule that said no to 400 with the reason, a missing thing to 404, a clash to 409', async () => {
    const { app, tokens, dir } = await boot();
    const ds = await readDataDir(dir);
    const xylo = ds.candidates.find((c) => c.name === 'Xylo').id;
    const post = (route, body = {}, token = tokens.admin) => request(app).post(route).set(as(token)).set(JSON_HEADERS).send(body);
    const refused = await post(`/api/candidates/${xylo}/publish`);
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/only an approved candidate can be published/);
    expect((await post('/api/candidates/cand-nobody/approve')).status).toBe(400);
    expect((await request(app).get('/api/candidates/cand-nobody').set(as(tokens.viewer))).status).toBe(404);
    expect((await post(`/api/candidates/${xylo}/vaporise`)).status).toBe(404);
    expect((await post('/api/candidates/NOT%20AN%20ID/approve')).status).toBe(400);
    expect((await post(`/api/candidates/${xylo}/reject`, { reason: '' })).body.error).toBe('say why, in a few words');
    expect((await request(app).get('/api/nowhere').set(as(tokens.viewer))).status).toBe(404);
  });

  it('answers a reads with JSON the page can show', async () => {
    const { app, tokens } = await boot();
    const get = (p) => request(app).get(p).set(as(tokens.viewer));
    expect((await get('/api/overview')).body.tiles).toMatchObject({ total_companies: 4 });
    expect((await get('/api/candidates?status=open')).body.results.length).toBeGreaterThan(0);
    expect((await get('/api/candidates?status=open&q=zorb')).body.results.map((c) => c.name)).toEqual(['Zorbly']);
    expect((await get('/api/companies?q=leon')).body[0]).toMatchObject({ id: 'leonardo-ai' });
    for (const p of ['/api/conflicts', '/api/suggestions', '/api/queue', '/api/imports', '/api/job', '/api/audit?limit=5', '/api/missing', '/api/duplicates']) expect((await get(p)).status, p).toBe(200);
    expect((await get('/api/missing')).body).toMatchObject({ total: expect.any(Number), counts: { website: expect.any(Number) }, results: expect.any(Array) });
    expect(Array.isArray((await get('/api/duplicates')).body)).toBe(true);
    for (const p of ['/api/missing', '/api/duplicates']) expect((await request(app).get(p)).status, `${p} without a token`).toBe(401);
  });

  it('shows the scheduler read only: its jobs, facets and runs for anyone who may look, and nothing to change', async () => {
    const { app, tokens } = await boot();
    const res = await request(app).get('/api/scheduler').set(as(tokens.viewer));
    expect(res.status).toBe(200);
    expect(res.body.jobs.map((j) => j.job)).toEqual(['discovery', 'funding', 'hiring', 'status', 'enrichment', 'quality']);
    expect(res.body.facets.hiring).toMatchObject({ every_days: 3, job: 'hiring' });
    expect(res.body).toMatchObject({ watch: [], hosts: [], recent: [], totals: { companies: 4 } });
    expect(res.body.sources.map((s) => s.id)).toEqual(['rss.startupdaily-funding', 'submissions']);
    expect((await request(app).get('/api/scheduler')).status).toBe(401);
    expect((await request(app).post('/api/scheduler').set(as(tokens.admin)).set(JSON_HEADERS).send({})).status).toBe(404); // there is no way to run it from here
  });

  it('queues the companies, runs the queue in the background, refuses a second run, and reports the job', async () => {
    const { app, tokens, service } = await boot();
    const post = (route, body = {}) => request(app).post(route).set(as(tokens.admin)).set(JSON_HEADERS).send(body);
    expect((await post('/api/queue/seed')).body).toMatchObject({ queued: expect.any(Number) });
    const run = await post('/api/queue/run', { concurrency: 1 });
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({ kind: 'enrichment', state: 'running', by: 'Aryan' });
    expect((await post('/api/queue/run')).status).toBe(409); // one at a time
    expect((await request(app).get('/api/job').set(as(tokens.viewer))).body).toMatchObject({ state: 'running' });
    expect((await post('/api/queue/run', { mode: 'yolo' })).status).toBe(400); // what is asked for is checked first
    expect((await post('/api/queue/stop')).body).toMatchObject({ stopping: true });
    await service.jobs.idle();
    expect((await request(app).get('/api/job').set(as(tokens.viewer))).body.state).toBe('stopped');
  });

  it('does not let a person act on the queue with a task id that is not one', async () => {
    const { app, tokens } = await boot();
    expect((await request(app).post('/api/queue/..%2F..%2Fx/cancel').set(as(tokens.admin)).set(JSON_HEADERS).send({})).status).toBe(400);
    expect((await request(app).post('/api/queue/enq-nobody-1/cancel').set(as(tokens.admin)).set(JSON_HEADERS).send({})).status).toBe(400);
  });
});

describe('when something goes wrong', () => {
  it('tells the person only that it did, keeps the detail in the server log, and never sends a stack, a path or a token', async () => {
    const stub = { overview: () => { throw new TypeError('Cannot read properties of undefined at C:\\Users\\secret\\project\\src\\x.js'); } };
    const { app, tokens, logger } = await boot({ service: stub });
    const res = await request(app).get('/api/overview').set(as(tokens.viewer));
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'something went wrong; the server log has the detail' });
    expect(JSON.stringify(res.body)).not.toMatch(/secret|stack|\.js|Cannot read/);
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/admin: GET \/api\/overview: TypeError: Cannot read properties/));
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(tokens.viewer);
  });
});
