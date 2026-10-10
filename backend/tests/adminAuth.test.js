import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  generateToken, hashToken, addUser, revokeUser, loadUsers, createAuthenticator, createLimiter, createSecurityLog, TOKEN_PREFIX,
} from '../src/admin/auth.js';
import { can, requireRole, permissionsOf, PERMISSIONS, ROLES } from '../src/admin/roles.js';
import { ForbiddenError } from '../src/admin/errors.js';

const dirs = [];
const tmp = async () => { const d = await mkdtemp(path.join(os.tmpdir(), 'admin-auth-')); dirs.push(d); return d; };
afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

describe('roles: who may do what', () => {
  const expected = {
    viewer: ['read'],
    reviewer: ['read', 'candidate.approve', 'candidate.reject', 'candidate.reopen', 'candidate.edit', 'candidate.note', 'candidate.distinct', 'candidate.enrich', 'suggestion.dismiss', 'enrichment.enqueue', 'enrichment.retry', 'enrichment.cancel', 'import.dismiss', 'location.lookup',
      // the investor directory: a reviewer checks it, an admin publishes it
      'investor.approve', 'investor.reject', 'investor.reopen', 'investor.flag', 'investor.edit', 'investment.add', 'investment.reject', 'person.approve', 'person.reject'],
    admin: Object.keys(PERMISSIONS),
  };

  it('gives a viewer only reading, a reviewer the decisions about candidates, and an admin everything', () => {
    for (const role of ROLES) expect(permissionsOf(role).sort(), role).toEqual([...expected[role]].sort());
  });

  it('reserves for the admin whatever changes what the public sees', () => {
    for (const p of ['candidate.merge', 'candidate.publish', 'conflict.resolve', 'suggestion.apply', 'location.set', 'enrichment.seed', 'enrichment.run', 'investor.publish', 'investor.unpublish', 'investor.merge', 'investor.inactive', 'investor.resolve', 'person.publish', 'person.unpublish']) {
      expect(can('admin', p), p).toBe(true);
      expect(can('reviewer', p), p).toBe(false);
      expect(can('viewer', p), p).toBe(false);
    }
  });

  it('denies an unknown permission and an unknown role, instead of allowing what it does not understand', () => {
    expect(can('admin', 'database.drop')).toBe(false);
    expect(can('root', 'read')).toBe(false);
    expect(can(undefined, 'read')).toBe(false);
  });

  it('says what a refused person needed, and what they are', () => {
    expect(() => requireRole({ name: 'x', role: 'viewer' }, 'candidate.approve')).toThrow(ForbiddenError);
    expect(() => requireRole({ name: 'x', role: 'viewer' }, 'candidate.approve')).toThrow('candidate.approve needs the reviewer role, and you are a viewer');
    expect(() => requireRole(null, 'read')).toThrow(ForbiddenError);
    expect(() => requireRole({ name: 'x', role: 'admin' }, 'nonsense')).toThrow('unknown action "nonsense"');
    expect(() => requireRole({ name: 'x', role: 'reviewer' }, 'candidate.approve')).not.toThrow();
  });
});

describe('tokens', () => {
  it('are long, random, recognisable by their prefix, and hash the same way every time', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).not.toBe(hashToken(b));
  });
});

describe('the users file', () => {
  it('stores a name, a role and a hash, and never the token, which is shown once', async () => {
    const file = path.join(await tmp(), 'users.json');
    const { user, token } = await addUser(file, { name: 'Aryan', role: 'admin', now: () => Date.parse('2026-10-06T00:00:00.000Z') });
    expect(user).toEqual({ name: 'Aryan', role: 'admin' });
    const text = await readFile(file, 'utf8');
    expect(text).not.toContain(token);
    expect(JSON.parse(text)).toEqual([{ name: 'Aryan', role: 'admin', token_sha256: hashToken(token), created_at: '2026-10-06T00:00:00.000Z' }]);
  });

  it('refuses a duplicate name (in any case), a bad name, and a role that does not exist', async () => {
    const file = path.join(await tmp(), 'users.json');
    await addUser(file, { name: 'Aryan', role: 'admin' });
    await expect(addUser(file, { name: 'aryan', role: 'viewer' })).rejects.toThrow(/already a user/);
    await expect(addUser(file, { name: '<script>', role: 'viewer' })).rejects.toThrow(/a name is 2 to 40/);
    await expect(addUser(file, { name: '', role: 'viewer' })).rejects.toThrow(/a name is 2 to 40/);
    await expect(addUser(file, { name: 'Sam', role: 'root' })).rejects.toThrow(/role must be one of viewer, reviewer, admin/);
    expect(await loadUsers(file)).toHaveLength(1);
  });

  it('revokes a user, and says so when there is nobody of that name', async () => {
    const file = path.join(await tmp(), 'users.json');
    const { token } = await addUser(file, { name: 'Sam', role: 'viewer' });
    await addUser(file, { name: 'Aryan', role: 'admin' });
    await revokeUser(file, 'sam');
    const auth = createAuthenticator(await loadUsers(file));
    expect(auth.authenticate(token)).toBeNull();
    expect(auth.count).toBe(1);
    await expect(revokeUser(file, 'nobody')).rejects.toThrow(/no user called nobody/);
  });

  it('reads as no users when there is no file yet, and refuses a file that has been tampered with', async () => {
    const dir = await tmp();
    expect(await loadUsers(path.join(dir, 'missing.json'))).toEqual([]);
    const bad = path.join(dir, 'users.json');
    await writeFile(bad, JSON.stringify([{ name: 'Sam', role: 'root', token_sha256: 'x' }]));
    await expect(loadUsers(bad)).rejects.toThrow(/invalid entry for "Sam"/);
  });

  it('is written where git will not look: the folder is ignored', async () => {
    const ignore = await readFile(path.resolve('..', '.gitignore'), 'utf8');
    expect(ignore).toMatch(/^backend\/\.admin\/$/m);
  });
});

describe('signing in', () => {
  async function setup() {
    const file = path.join(await tmp(), 'users.json');
    const admin = await addUser(file, { name: 'Aryan', role: 'admin' });
    const viewer = await addUser(file, { name: 'Sam', role: 'viewer' });
    return { auth: createAuthenticator(await loadUsers(file)), admin, viewer };
  }

  it('knows each person by their own token, and by nothing else', async () => {
    const { auth, admin, viewer } = await setup();
    expect(auth.authenticate(admin.token)).toEqual({ name: 'Aryan', role: 'admin' });
    expect(auth.authenticate(viewer.token)).toEqual({ name: 'Sam', role: 'viewer' });
  });

  it('refuses a wrong, truncated, extended, empty or non-string token', async () => {
    const { auth, admin } = await setup();
    for (const t of [generateToken(), admin.token.slice(0, -1), `${admin.token}x`, '', 'aus_short', undefined, null, 12345, { token: admin.token }, [admin.token], 'x'.repeat(500)]) {
      expect(auth.authenticate(t), String(t).slice(0, 30)).toBeNull();
    }
  });

  it('refuses the stored hash itself as a token: a stolen users file is not a way in', async () => {
    const { auth, admin } = await setup();
    expect(auth.authenticate(hashToken(admin.token))).toBeNull();
  });
});

describe('after too many wrong tokens', () => {
  it('locks for a minute, counting only the recent ones, and a good sign-in clears the count', () => {
    let t = 0;
    const limiter = createLimiter({ max: 3, windowMs: 1000, lockMs: 5000, now: () => t });
    expect(limiter.fail()).toBe(false);
    t += 2000; // the first failure is old by now
    expect(limiter.fail()).toBe(false);
    expect(limiter.fail()).toBe(false);
    expect(limiter.locked()).toBe(0);
    limiter.succeed();
    expect([limiter.fail(), limiter.fail()]).toEqual([false, false]);
    expect(limiter.fail()).toBe(true);
    expect(limiter.locked()).toBe(5000);
    t += 4000;
    expect(limiter.locked()).toBe(1000);
    t += 1500;
    expect(limiter.locked()).toBe(0);
  });
});

describe('the security log', () => {
  it('writes one JSON line per event, with the time, and does not take the interface down if it cannot write', async () => {
    const dir = await tmp();
    const file = path.join(dir, 'security.log');
    const log = createSecurityLog(file, { now: () => Date.parse('2026-10-06T00:00:00.000Z') });
    await log.log('login', { user: 'Aryan' });
    await log.log('login.failed', { locked: false });
    expect((await readFile(file, 'utf8')).trim().split('\n').map((l) => JSON.parse(l))).toEqual([
      { at: '2026-10-06T00:00:00.000Z', event: 'login', user: 'Aryan' }, { at: '2026-10-06T00:00:00.000Z', event: 'login.failed', locked: false },
    ]);
    await writeFile(path.join(dir, 'blocker'), 'a file where a folder should be');
    await expect(createSecurityLog(path.join(dir, 'blocker', 'nested', 'security.log')).log('login')).resolves.toBeUndefined();
    expect((await stat(file)).isFile()).toBe(true);
  });
});
