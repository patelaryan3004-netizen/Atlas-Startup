// The founding-member list in Postgres (src/db, network/founding.js): the same rules as the file, kept somewhere a restart does not erase.
//
// These tests use the real `pg` driver against a real Postgres (PGlite: Postgres itself, compiled to WebAssembly, served over a local socket), kept in a folder on disk, so "the server restarts" is
// tested for real: the app, its connection pool and the Postgres process are all stopped and started again, and only the folder is the same. What they cannot show is Neon itself (TLS, suspending an
// idle database): docs/database.md gives the owner the check to run against the real one.
import { describe, it, expect, afterEach, vi } from 'vitest';
import request from 'supertest';
import { mkdtemp, rm, readFile, readdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import pg from 'pg';
import { createApp } from '../src/app.js';
import { createNetwork } from '../src/network/index.js';
import { openDatabase, checkDatabaseUrl } from '../src/db/database.js';
import { migrate, checksum, MIGRATIONS_DIR } from '../src/db/migrate.js';
import { importFounding, rowsOf, cleanRow } from '../src/db/foundingImport.js';
import { makeId } from '../src/network/validate.js';
import { fixture, removeTempDirs } from './helpers/catalog.js';

// Each test starts a Postgres (WebAssembly) of its own, which takes a few seconds alone and much longer while the rest of the suite is running beside it: a slow run must not read as a failure.
vi.setConfig({ testTimeout: 180000 });
const execFileAsync = promisify(execFile);
const KEY = 'test-admin-key';
const admin = { 'x-admin-key': KEY };
const cleanup = [];
afterEach(async () => { await removeTempDirs(); while (cleanup.length) await cleanup.pop()(); });
const quiet = { log() {}, warn() {}, error() {} };

// A Postgres on a local port whose data lives in `dir`. `stop()` shuts it down, as a restart would; start again with the same dir to see what survived.
async function postgres(dir) {
  const pglite = await PGlite.create(dir);
  const server = new PGLiteSocketServer({ db: pglite, port: 0, host: '127.0.0.1' });
  await server.start();
  const url = `postgresql://postgres:postgres@127.0.0.1:${server.server.address().port}/postgres`;
  let stopped = false;
  const stop = async () => { if (stopped) return; stopped = true; await server.stop(); await pglite.close(); };
  cleanup.push(stop);
  return { url, stop };
}

// The whole site over a database at `url`, as the server builds it at boot.
async function site(url, { env = {} } = {}) {
  const f = await fixture(3);
  const db = openDatabase({ url, max: 1, log: quiet });
  cleanup.push(async () => { await db.close?.(); });
  const network = createNetwork({ env: { RENDER: 'true', ...env }, db, log: quiet, curatedEvents: [], curatedJobsRows: [] });
  return { app: createApp({ catalog: f.catalog, network }), network, db };
}

let saved;
const withAdminKey = () => { saved = process.env.ADMIN_KEY; process.env.ADMIN_KEY = KEY; cleanup.push(async () => { if (saved === undefined) delete process.env.ADMIN_KEY; else process.env.ADMIN_KEY = saved; }); };
const entry = (over = {}) => ({ name: 'Ada Example', email: 'Ada@Example.org', city: 'Melbourne', intents: ['cofounder', 'feedback'], skills: ['engineering'], building: 'A ledger for sole traders', looking_for: 'A designer', link: 'https://example.org/ada', consent: true, ...over });
const newDir = async () => { const d = await mkdtemp(path.join(os.tmpdir(), 'au-pg-')); cleanup.push(() => rm(d, { recursive: true, force: true })); return d; };

describe('registrations survive a restart and a redeploy', () => {
  it('keeps a registration in Postgres, and finds it again after the whole server (app, connections and database process) is stopped and started', async () => {
    withAdminKey();
    const dir = await newDir();
    let pgA = await postgres(dir);
    let one = await site(pgA.url);
    expect((await request(one.app).get('/api/network/status')).body).toMatchObject({ available: false, founding: { open: true, durable: true } }); // the member side is still closed
    const res = await request(one.app).post('/api/founding-members').send(entry());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({ saved: true, durable: true });
    expect((await request(one.app).get('/api/admin/network/founding').set(admin)).body).toMatchObject({ durable: true, store: 'postgres', count: 1 });

    // the restart: everything in memory is gone; only the data folder is the same
    await one.db.close();
    await pgA.stop();
    const pgB = await postgres(dir);
    const two = await site(pgB.url);
    const list = await request(two.app).get('/api/admin/network/founding').set(admin);
    expect(list.body).toMatchObject({ durable: true, store: 'postgres', count: 1 });
    expect(list.body.results[0]).toMatchObject({ name: 'Ada Example', email: 'ada@example.org', city: 'Melbourne', intents: ['cofounder', 'feedback'], skills: ['engineering'], link: 'https://example.org/ada' });
    expect(list.body.results[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('is one person once: the same email in any capitals, again and again or at the same moment, is one row that keeps its id and its first dates', async () => {
    withAdminKey();
    const { url } = await postgres(await newDir());
    const { app } = await site(url);
    await request(app).post('/api/founding-members').send(entry());
    const first = (await request(app).get('/api/admin/network/founding').set(admin)).body.results[0];
    await request(app).post('/api/founding-members').send(entry({ email: ' ADA@example.ORG ', name: 'Ada E.', city: 'Sydney' }));
    await Promise.all([1, 2].map((n) => request(app).post('/api/founding-members').send(entry({ name: 'Ada E.', city: 'Sydney', building: `try ${n}` }))));
    await request(app).post('/api/founding-members').send(entry({ email: 'bo@example.org', name: 'Bo Example' }));
    const { body } = await request(app).get('/api/admin/network/founding').set(admin);
    expect(body.count).toBe(2);
    const ada = body.results.find((r) => r.email === 'ada@example.org');
    expect(ada.id).toBe(first.id);
    expect(ada.created_at).toBe(first.created_at);
    expect(ada.consented_at).toBe(first.consented_at);
    expect(ada.name).toBe('Ada E.'); // the later sign-up changed what they said about themselves
    expect(Date.parse(ada.updated_at)).toBeGreaterThanOrEqual(Date.parse(first.updated_at));
  });

  it('is backed by the database itself, not only by the code: a second row for one email, a capitalised email or a bad one cannot be written', async () => {
    const { url } = await postgres(await newDir());
    const { db } = await site(url);
    await db.ready();
    const insert = (email) => db.query(`insert into founding_members (id, email, name, consented_at, created_at, updated_at) values ($1, $2, 'X Y', now(), now(), now())`, [`f_${Math.random()}`, email]);
    await insert('one@example.org');
    await expect(insert('one@example.org')).rejects.toMatchObject({ code: '23505' }); // unique
    await expect(insert('Two@Example.org')).rejects.toMatchObject({ code: '23514' }); // lower case only
    await expect(insert('no-at-sign')).rejects.toMatchObject({ code: '23514' });
  });

  it('migrates once however often it is asked: a redeploy runs the migrations again and changes nothing, and two asks at the same moment apply the file only once (the test database serves one connection, so the advisory lock itself is for the live check in docs/database.md)', async () => {
    const { url } = await postgres(await newDir());
    const a = openDatabase({ url, max: 1, log: quiet });
    cleanup.push(() => a.close());
    const [x, y] = await Promise.all([migrate(a, { log: quiet }), migrate(a, { log: quiet })]);
    expect([...x.applied, ...y.applied]).toEqual(['0001_founding_members.sql']); // applied exactly once
    expect((await migrate(a, { log: quiet })).applied).toEqual([]);
    const { rows } = await a.query('select name, checksum from schema_migrations');
    expect(rows).toHaveLength(1);
  });
});

describe('what the site says when the database is not there', () => {
  it('does not pretend: with a database that cannot be reached it answers 503 and keeps nothing in a file a restart would erase, then works again when the database is back', async () => {
    withAdminKey();
    const dir = await newDir();
    const live = await postgres(dir);
    const down = await site(live.url);
    await request(down.app).post('/api/founding-members').send(entry({ email: 'before@example.org' }));
    await down.db.close();
    await live.stop(); // the database goes away
    const noDb = await site(live.url); // a new pool pointing at a port nobody listens on
    const out = await request(noDb.app).post('/api/founding-members').send(entry({ email: 'during@example.org' }));
    expect(out.status).toBe(503);
    expect(out.body.error ?? out.body.code ?? JSON.stringify(out.body)).toMatch(/cannot take sign-ups right now|founding_unavailable/);
    expect(JSON.stringify(out.body)).not.toMatch(/127\.0\.0\.1|postgres|ECONNREFUSED/i); // nothing about the connection leaks to a visitor
    expect((await request(noDb.app).get('/api/admin/network/founding').set(admin)).status).toBe(503);
    const back = await postgres(dir);
    const again = await site(back.url);
    expect((await request(again.app).post('/api/founding-members').send(entry({ email: 'after@example.org' }))).status).toBe(201);
    expect((await request(again.app).get('/api/admin/network/founding').set(admin)).body.count).toBe(2); // the one from before the outage is still there
  });

  it('with no DATABASE_URL it is the file as before and says it does not last; an address it cannot use is ignored with the reason, never repeated', async () => {
    withAdminKey();
    const f = await fixture(3);
    const logged = [];
    const secret = 'postgresql://owner:hunter2@ep-secret-host.example.neon.tech/neondb';
    const bad = createNetwork({ env: { RENDER: 'true', DATABASE_URL: secret }, foundingDir: await newDir(), log: { error: (m) => logged.push(m), log() {}, warn() {} }, curatedEvents: [], curatedJobsRows: [] });
    const app = createApp({ catalog: f.catalog, network: bad });
    expect((await request(app).get('/api/network/status')).body.founding).toEqual({ open: true, durable: false });
    const list = await request(app).get('/api/admin/network/founding').set(admin);
    expect(list.body).toMatchObject({ durable: false, store: 'file' });
    expect(list.body.database_problem).toMatch(/must use TLS/);
    expect(JSON.stringify([list.body, logged, (await request(app).get('/api/network/status')).body])).not.toMatch(/hunter2|ep-secret-host/); // the password and host are never repeated
    const none = createNetwork({ env: { RENDER: 'true' }, foundingDir: await newDir(), curatedEvents: [], curatedJobsRows: [] });
    expect(none.database).toBeNull();
    expect(none.founding.store).toBe('file');
  });
});

describe('the database address', () => {
  it('needs TLS anywhere but the developer\'s own computer, refuses the pooled address, and never repeats what it was given', () => {
    expect(checkDatabaseUrl('postgresql://u:p@ep-cool-123.ap-southeast-2.aws.neon.tech/neondb?sslmode=require')).toMatchObject({ ok: true });
    expect(checkDatabaseUrl('postgresql://u:p@ep-cool-123.ap-southeast-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require')).toMatchObject({ ok: true });
    expect(checkDatabaseUrl('postgresql://u:p@ep-cool-123.ap-southeast-2.aws.neon.tech/neondb?sslmode=verify-full')).toMatchObject({ ok: true });
    expect(checkDatabaseUrl('postgresql://u:p@127.0.0.1:5432/postgres')).toMatchObject({ ok: true });
    for (const url of ['postgresql://u:s3cret@ep-cool-123.aws.neon.tech/neondb', 'postgresql://u:s3cret@ep-cool-123.aws.neon.tech/neondb?sslmode=disable', 'postgresql://u:s3cret@ep-cool-123-pooler.aws.neon.tech/neondb?sslmode=require', 'mysql://u:s3cret@host/db', 'not a url s3cret', 'postgresql://u:s3cret@/db']) {
      const r = checkDatabaseUrl(url);
      expect(r.ok, url).toBe(false);
      expect(r.reason, url).not.toMatch(/s3cret|ep-cool/);
    }
    expect(openDatabase({ url: '' })).toBeNull();
    expect(openDatabase({})).toBeNull(); // the test setup blanks DATABASE_URL
  });

  it('survives Neon dropping idle connections: an idle-connection error is caught, and a query whose connection was dropped runs once more', async () => {
    const logged = [];
    class FakePool {
      constructor() { FakePool.last = this; this.handlers = {}; this.calls = 0; }
      on(event, fn) { this.handlers[event] = fn; return this; }
      async query() { this.calls += 1; if (this.calls === 1) throw Object.assign(new Error('Connection terminated unexpectedly'), { code: undefined }); return { rows: [{ ok: 1 }] }; }
      async end() {}
    }
    const db = openDatabase({ url: 'postgresql://u:p@ep-x.aws.neon.tech/neondb?sslmode=require', Pool: FakePool, log: { warn: (m) => logged.push(m) } });
    expect(() => FakePool.last.handlers.error(Object.assign(new Error('terminating connection due to administrator command at ep-x.aws.neon.tech'), { code: '57P01' }))).not.toThrow();
    expect(logged[0]).toMatch(/57P01/);
    expect(logged[0]).not.toMatch(/ep-x/); // only the code is logged
    expect((await db.query('select 1')).rows).toEqual([{ ok: 1 }]);
    expect(FakePool.last.calls).toBe(2);
  });
});

describe('earlier registrations are brought in, and the schema for what comes next is valid', () => {
  const old = (over = {}) => ({ id: 'f_old1', name: 'Ada Example', email: 'ada@example.org', city: 'Melbourne', intents: ['cofounder'], skills: ['engineering'], building: '', looking_for: '', link: '', created_at: '2026-11-21T01:00:00.000Z', updated_at: '2026-11-21T01:00:00.000Z', ...over });

  it('imports an admin export (or the old file) once: duplicates and invalid rows are counted, a dry run writes nothing, and running it again changes nothing', async () => {
    const { url } = await postgres(await newDir());
    const db = openDatabase({ url, max: 1, log: quiet });
    cleanup.push(() => db.close());
    const file = { durable: false, count: 5, results: [
      old(), old({ updated_at: '2026-11-21T05:00:00.000Z', name: 'Ada E.', city: 'Sydney' }), // the same person twice: the newer one wins
      old({ id: 'f_old2', email: 'bo@example.org', name: 'Bo Example', created_at: '2026-11-21T02:00:00.000Z', updated_at: '2026-11-21T02:00:00.000Z' }),
      old({ email: 'not an email' }), old({ name: '' }),
    ] };
    expect(rowsOf(file)).toHaveLength(5);
    expect(rowsOf([old()])).toHaveLength(1);
    const dry = await importFounding(db, rowsOf(file), { makeId });
    expect(dry).toMatchObject({ in_file: 5, invalid: 2, duplicates_in_file: 1, to_add: 2, to_update: 0, applied: false });
    expect((await db.query('select count(*)::int as n from founding_members')).rows[0].n).toBe(0); // a dry run wrote nothing
    const done = await importFounding(db, rowsOf(file), { apply: true, makeId });
    expect(done).toMatchObject({ to_add: 2, applied: true });
    const { rows } = await db.query('select id, email, name, city, created_at, consented_at from founding_members order by email');
    expect(rows.map((r) => r.email)).toEqual(['ada@example.org', 'bo@example.org']);
    expect(rows[0]).toMatchObject({ id: 'f_old1', name: 'Ada E.', city: 'Sydney' }); // the newer entry, under the first id
    expect(rows[0].created_at.toISOString()).toBe('2026-11-21T01:00:00.000Z'); // the first date is kept
    expect(rows[0].consented_at.toISOString()).toBe('2026-11-21T01:00:00.000Z'); // consent is dated from the original sign-up
    const again = await importFounding(db, rowsOf(file), { apply: true, makeId });
    expect(again).toMatchObject({ to_add: 0, to_update: 0, unchanged: 2 });
    expect((await db.query('select count(*)::int as n from founding_members')).rows[0].n).toBe(2);
    // a person who signed up again on the live site since the export is not overwritten by the older row in the file
    await db.query(`update founding_members set name = 'Ada Newest', updated_at = '2026-11-22T00:00:00Z' where email = 'ada@example.org'`);
    await importFounding(db, rowsOf(file), { apply: true, makeId });
    expect((await db.query(`select name from founding_members where email = 'ada@example.org'`)).rows[0].name).toBe('Ada Newest');
  });

  it('is run by the owner as commands (npm run db:status, db:migrate, founding:import): they read DATABASE_URL, take the file PowerShell saves (with a byte-order mark), and print counts and never an address, a password or an email', async () => {
    const { url } = await postgres(await newDir());
    const folder = await newDir();
    const file = path.join(folder, 'founding-export.json');
    await writeFile(file, `﻿${JSON.stringify({ durable: false, count: 1, results: [old({ email: 'private.person@example.org', name: 'Private Person' })] })}`);
    const run = async (...args) => {
      try { const { stdout, stderr } = await execFileAsync(process.execPath, [path.join(MIGRATIONS_DIR, '..', '..', 'scripts', 'db.mjs'), ...args], { env: { ...process.env, DATABASE_URL: url }, timeout: 60000 }); return { code: 0, out: stdout + stderr }; } catch (err) { return { code: err.code, out: (err.stdout ?? '') + (err.stderr ?? '') }; }
    };
    const results = [await run('status'), await run('migrate'), await run('migrate'), await run('founding-import', file), await run('founding-import', file, '--apply'), await run('status'), await run('founding-import', path.join(folder, 'missing.json')), await run('nonsense')];
    expect(results.map((r) => r.code)).toEqual([0, 0, 0, 0, 0, 0, 1, 1]);
    expect(results[0].out).toMatch(/Connected to database "postgres"/);
    expect(results[0].out).toMatch(/No migrations applied yet/);
    expect(results[1].out).toMatch(/Applied: 0001_founding_members.sql/);
    expect(results[2].out).toMatch(/Already up to date/);
    expect(results[3].out).toMatch(/Dry run/);
    expect(results[4].out).toMatch(/Imported/);
    expect(results[5].out).toMatch(/Founding members: 1/);
    expect(results[6].out).toMatch(/not found/);
    expect(results.map((r) => r.out).join('\n')).not.toMatch(/private\.person|Private Person|postgres:postgres|127\.0\.0\.1/); // no email, no address, no password
    const blank = await execFileAsync(process.execPath, [path.join(MIGRATIONS_DIR, '..', '..', 'scripts', 'db.mjs'), 'status'], { env: { ...process.env, DATABASE_URL: '' } }).catch((err) => err);
    expect(blank.stderr).toMatch(/DATABASE_URL is not set/);
  });

  it('cleans a row it is given: lower-case email, only https links, closed length limits, and no row without a usable email, name and date', () => {
    expect(cleanRow(old({ email: ' ADA@Example.ORG ', link: 'http://insecure.example.org' }))).toMatchObject({ email: 'ada@example.org', link: '' });
    expect(cleanRow(old({ name: 'x'.repeat(500) })).name).toHaveLength(60);
    expect(cleanRow(old({ created_at: 'yesterday' }))).toBeNull();
    expect(cleanRow(null)).toBeNull();
  });

  it('keeps the migrations as they ran (a changed file is refused, line endings do not count) and the planned schema is valid SQL that holds its rules', async () => {
    const dir = await newDir();
    const { url } = await postgres(dir);
    const db = openDatabase({ url, max: 1, log: quiet });
    cleanup.push(() => db.close());
    await migrate(db, { log: quiet });
    const original = await readFile(path.join(MIGRATIONS_DIR, '0001_founding_members.sql'), 'utf8');
    expect(checksum(original)).toBe(checksum(original.replaceAll('\n', '\r\n'))); // a Windows checkout does not read as a change
    const edited = await newDir();
    await (await import('node:fs/promises')).writeFile(path.join(edited, '0001_founding_members.sql'), `${original}\n-- edited later\ncreate table sneaky (id int);\n`);
    await expect(migrate(db, { dir: edited, log: quiet })).rejects.toThrow(/changed after it ran/);

    // the design for the members' side: the runner does not run it; applying it by hand to a fresh database must work and hold its rules
    expect(await readdir(MIGRATIONS_DIR)).toEqual(['0001_founding_members.sql']);
    const planned = await readFile(new URL('../db/planned/community_schema.sql', import.meta.url), 'utf8');
    const fresh = openDatabase({ url: (await postgres(await newDir())).url, max: 1, log: quiet });
    cleanup.push(() => fresh.close());
    await fresh.query(planned);
    const now = '2026-11-22T00:00:00Z';
    const member = (id, email) => fresh.query(`insert into members (id, email, password_hash, name, created_at, updated_at) values ($1, $2, 'x', 'Person', $3, $3)`, [id, email, now]);
    await member('m_a', 'a@example.org'); await member('m_b', 'b@example.org');
    await expect(member('m_c', 'A@example.org')).rejects.toMatchObject({ code: '23514' }); // lower case emails only
    const ask = (id, from, to, status = 'requested') => fresh.query(`insert into introductions (id, from_member, to_member, note, status, created_at) values ($1, $2, $3, 'hello there', $4, $5)`, [id, from, to, status, now]);
    await ask('i_1', 'm_a', 'm_b');
    await expect(ask('i_2', 'm_b', 'm_a')).rejects.toMatchObject({ code: '23505' }); // one live introduction per pair, whichever way round
    await expect(ask('i_3', 'm_a', 'm_a')).rejects.toMatchObject({ code: '23514' }); // nobody asks themselves
    await fresh.query(`update introductions set status = 'declined' where id = 'i_1'`);
    await ask('i_4', 'm_b', 'm_a'); // after a decline a new one is allowed (the 30-day cooldown is the code's rule)
    await expect(fresh.query(`insert into posts (id, author_id, topic, body, status, created_at) values ('p_1', 'm_a', 'idea', 'hi', 'sparkly', $1)`, [now])).rejects.toMatchObject({ code: '23514' }); // four moderation words only
    await fresh.query(`insert into posts (id, author_id, topic, body, created_at) values ('p_2', 'm_a', 'idea', 'hi', $1)`, [now]);
    await fresh.query(`delete from members where id = 'm_a'`); // leaving takes everything with it
    expect((await fresh.query(`select (select count(*) from posts)::int as posts, (select count(*) from introductions)::int as intros`)).rows[0]).toEqual({ posts: 0, intros: 0 });
  });
});
