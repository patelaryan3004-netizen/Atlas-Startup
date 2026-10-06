import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { main, startServer, refusal, HOST } from '../scripts/admin.js';
import { loadUsers, hashToken } from '../src/admin/auth.js';
import { dataset, co } from './helpers/discovery.js';
import { makeDataDir, removeMadeDirs } from './helpers/store.js';

const homes = [];
const servers = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
  await removeMadeDirs();
  await Promise.all(homes.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
const newHome = async () => { const d = await mkdtemp(path.join(os.tmpdir(), 'admin-cli-')); homes.push(d); return d; };
const run = async (argv, home) => { const lines = []; const code = await main(argv, { out: (s) => lines.push(s), home, env: {} }); return { code, text: lines.join('\n') }; };

describe('where it may run', () => {
  it('refuses on Render and in production, with the reason', () => {
    expect(refusal({ RENDER: 'true' })).toMatch(/Render keeps no disk.*must not be reachable from the internet/);
    expect(refusal({ NODE_ENV: 'production' })).toMatch(/does not run with NODE_ENV=production/);
    expect(refusal({})).toBeNull();
    expect(refusal({ NODE_ENV: 'development' })).toBeNull();
  });

  it('does not start there, even with a user, and not without one', async () => {
    const home = await newHome();
    await run(['init', '--name', 'Aryan'], home);
    const dataDir = await makeDataDir(dataset([co('Acme')]));
    await expect(startServer({ dataDir, home, port: 0, env: { RENDER: 'true' } })).rejects.toThrow(/local tool/);
    await expect(startServer({ dataDir, home: await newHome(), port: 0, env: {} })).rejects.toThrow(/nobody can sign in yet: run `npm run admin -- init/);
  });

  it('listens on the loopback address only, and answers there', async () => {
    const home = await newHome();
    const token = /aus_\S+/.exec((await run(['init', '--name', 'Aryan'], home)).text)[0];
    const dataDir = await makeDataDir(dataset([co('Acme')]));
    const started = await startServer({ dataDir, home, port: 0, env: {} });
    servers.push(started);
    expect(HOST).toBe('127.0.0.1');
    expect(started.server.address().address).toBe('127.0.0.1');
    expect(started.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const res = await fetch(`${started.url}/api/overview`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect((await res.json()).tiles.total_companies).toBe(1);
    expect((await fetch(`${started.url}/api/overview`)).status).toBe(401);
  });
});

describe('the people who may sign in', () => {
  it('makes the first admin and shows the token once, storing only its hash', async () => {
    const home = await newHome();
    const { code, text } = await run(['init', '--name', 'Aryan'], home);
    expect(code).toBe(0);
    const token = /aus_\S+/.exec(text)[0];
    expect(text).toMatch(/Aryan \(admin\) can now sign in with this token\. It is shown once and is not stored/);
    const file = await readFile(path.join(home, 'users.json'), 'utf8');
    expect(file).not.toContain(token);
    expect((await loadUsers(path.join(home, 'users.json')))[0]).toMatchObject({ name: 'Aryan', role: 'admin', token_sha256: hashToken(token) });
  });

  it('will not make a second first admin, but adds, lists and revokes others', async () => {
    const home = await newHome();
    await run(['init', '--name', 'Aryan'], home);
    await expect(run(['init', '--name', 'Eve'], home)).rejects.toThrow(/already users/);
    expect((await run(['add-user', '--name', 'Riley', '--role', 'reviewer'], home)).text).toMatch(/Riley \(reviewer\)/);
    const listed = (await run(['users'], home)).text;
    expect(listed).toMatch(/Aryan\s+admin/);
    expect(listed).toMatch(/Riley\s+reviewer/);
    expect(listed).not.toMatch(/aus_|token/);
    await run(['revoke', '--name', 'riley'], home);
    expect((await run(['users'], home)).text).not.toMatch(/Riley/);
    await expect(run(['revoke', '--name', 'riley'], home)).rejects.toThrow(/no user called riley/);
  });

  it('asks for what it needs, and says what it does not know', async () => {
    const home = await newHome();
    await expect(run(['init'], home)).rejects.toThrow(/--name is required/);
    await expect(run(['add-user', '--name', 'Sam'], home)).rejects.toThrow(/--role is required/);
    await expect(run(['add-user', '--name', 'Sam', '--role', 'root'], home)).rejects.toThrow(/role must be one of viewer, reviewer, admin/);
    await expect(run(['frobnicate'], home)).rejects.toThrow(/unknown command "frobnicate"/);
    expect((await run(['users'], home)).text).toMatch(/no users yet: run `npm run admin -- init/);
  });
});
