import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, readFile, utimes } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  withLock, transact, commit, snapshot, readSnapshot, LOCK_FILE, DataLockError, DataChangedError, DataValidationError,
} from '../src/models/store.js';
import { dataset } from './helpers/discovery.js';
import { makeDataDir, readDataDir, removeMadeDirs } from './helpers/store.js';

afterEach(removeMadeDirs);
const run = promisify(execFile);

const audit = (n = 1, over = {}) => ({
  actor: { name: 'aryan', role: 'admin' }, via: 'admin-ui', action: 'candidate.note', target: { type: 'candidate', id: `cand-${n}` }, summary: `Note ${n}`, ...over,
});

describe('one writer at a time', () => {
  it('runs callers in the order they arrived and never at the same time', async () => {
    const dir = await makeDataDir(dataset());
    let inside = 0;
    let overlapped = false;
    const order = [];
    await Promise.all([1, 2, 3, 4, 5].map((n) => withLock(dir, async () => {
      inside += 1;
      if (inside > 1) overlapped = true;
      await new Promise((r) => setTimeout(r, 5));
      order.push(n);
      inside -= 1;
    })));
    expect(overlapped).toBe(false);
    expect(order).toEqual([1, 2, 3, 4, 5]);
  });

  it('releases the lock when the work throws, so the next caller is not stuck', async () => {
    const dir = await makeDataDir(dataset());
    await expect(withLock(dir, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(withLock(dir, async () => 'fine')).resolves.toBe('fine');
  });

  it('waits for a lock another process holds, and says so if it never lets go', async () => {
    const dir = await makeDataDir(dataset());
    await writeFile(path.join(dir, LOCK_FILE), JSON.stringify({ pid: 1 }));
    await expect(withLock(dir, async () => 'x', { timeoutMs: 80, pollMs: 10 })).rejects.toBeInstanceOf(DataLockError);
  });

  it('takes over a lock whose owner has been gone too long', async () => {
    const dir = await makeDataDir(dataset());
    const lock = path.join(dir, LOCK_FILE);
    await writeFile(lock, JSON.stringify({ pid: 1 }));
    const old = new Date(Date.now() - 10 * 60000);
    await utimes(lock, old, old);
    await expect(withLock(dir, async () => 'took over', { staleMs: 60000 })).resolves.toBe('took over');
  });

  it('keeps two PROCESSES from losing each other\'s writes: 30 changes from two processes all survive', async () => {
    const dir = await makeDataDir(dataset());
    const store = pathToFileURL(path.resolve('src/models/store.js')).href;
    const child = `import { transact } from ${JSON.stringify(store)};
      const dir = ${JSON.stringify(dir)};
      for (let n = 100; n < 115; n += 1) {
        await transact(dir, () => ({ audit: [{ actor: { name: 'child', role: 'admin' }, via: 'cli', action: 'candidate.note', target: { type: 'candidate', id: 'cand-' + n }, summary: 'child ' + n }] }));
      }`;
    const other = run(process.execPath, ['--input-type=module', '-e', child], { timeout: 60000 });
    for (let n = 0; n < 15; n += 1) await transact(dir, () => ({ audit: [audit(n)] }));
    await other;
    const rows = (await readDataDir(dir)).audit_trail;
    expect(rows).toHaveLength(30);
    expect(new Set(rows.map((r) => r.id)).size).toBe(30);
    expect(rows.filter((r) => r.actor === 'child')).toHaveLength(15);
  }, 90000);
});

describe('a change and its audit record are written together', () => {
  it('writes the change and the audit row in one commit', async () => {
    const dir = await makeDataDir(dataset());
    const out = await transact(dir, (work) => {
      work.companies[0].blurb = 'Changed.';
      return { result: 'ok', audit: [audit(1, { summary: 'Changed a blurb' })] };
    }, { now: () => Date.parse('2026-10-06T03:00:00.000Z') });
    expect(out).toMatchObject({ result: 'ok', at: '2026-10-06T03:00:00.000Z' });
    expect(out.changed).toEqual(expect.arrayContaining(['startups.json', 'audit_trail.json']));
    const after = await readDataDir(dir);
    expect(after.companies[0].blurb).toBe('Changed.');
    expect(after.audit_trail).toEqual([expect.objectContaining({ id: 'aud-20261006030000000-1', summary: 'Changed a blurb', actor: 'aryan', role: 'admin' })]);
  });

  it('writes neither when the change throws', async () => {
    const dir = await makeDataDir(dataset());
    const before = await readFile(path.join(dir, 'startups.json'), 'utf8');
    await expect(transact(dir, (work) => { work.companies[0].blurb = 'Half done.'; throw new Error('nope'); })).rejects.toThrow('nope');
    expect(await readFile(path.join(dir, 'startups.json'), 'utf8')).toBe(before);
    expect((await readDataDir(dir)).audit_trail).toEqual([]);
  });

  it('writes neither when the result would not validate', async () => {
    const dir = await makeDataDir(dataset());
    const error = await transact(dir, (work) => { work.companies[0].stage = 7; return { audit: [audit()] }; }).catch((e) => e);
    expect(error).toBeInstanceOf(DataValidationError);
    expect(error.message).toMatch(/nothing was written/);
    const after = await readDataDir(dir);
    expect(after.audit_trail).toEqual([]);
    expect(typeof after.companies[0].stage).toBe('string');
  });

  it('writes nothing, not even the audit row, when the change makes no difference and records no action', async () => {
    const dir = await makeDataDir(dataset());
    const out = await transact(dir, () => ({ result: 'nothing to do' }));
    expect(out.changed).toEqual([]);
  });
});

describe('not writing over someone else\'s change', () => {
  it('refuses to commit what was read from files that have changed since', async () => {
    const dir = await makeDataDir(dataset());
    const { raw, ds } = await readSnapshot(dir);
    await transact(dir, (work) => { work.companies[0].blurb = 'Someone else got here first.'; });
    const work = structuredClone(ds);
    work.companies[1].blurb = 'My change, from stale data.';
    await expect(withLock(dir, () => commit(dir, raw, work))).rejects.toBeInstanceOf(DataChangedError);
    const after = await readDataDir(dir);
    expect(after.companies[0].blurb).toBe('Someone else got here first.');
    expect(after.companies[1].blurb).not.toBe('My change, from stale data.');
  });

  it('commits what was read when nothing has changed since', async () => {
    const dir = await makeDataDir(dataset());
    const { raw, ds } = await readSnapshot(dir);
    const work = structuredClone(ds);
    work.companies[0].blurb = 'Fresh.';
    await expect(withLock(dir, () => commit(dir, raw, work))).resolves.toMatchObject({ changed: ['startups.json'] });
  });

  it('keeps every change when many are made at once', async () => {
    const dir = await makeDataDir(dataset());
    await Promise.all(Array.from({ length: 25 }, (_, n) => transact(dir, () => ({ audit: [audit(n)] }))));
    const rows = (await readDataDir(dir)).audit_trail;
    expect(rows).toHaveLength(25);
    expect(new Set(rows.map((r) => r.id)).size).toBe(25);
  });
});

describe('the audit trail only grows', () => {
  it('refuses a change that edits an entry already written', async () => {
    const dir = await makeDataDir(dataset());
    await transact(dir, () => ({ audit: [audit(1)] }));
    await expect(transact(dir, (work) => { work.audit_trail[0].summary = 'Quietly rewritten.'; })).rejects.toThrow(/append-only/);
    expect((await readDataDir(dir)).audit_trail[0].summary).toBe('Note 1');
  });

  it('refuses a change that removes an entry', async () => {
    const dir = await makeDataDir(dataset());
    await transact(dir, () => ({ audit: [audit(1), audit(2)] }));
    await expect(transact(dir, (work) => { work.audit_trail.pop(); })).rejects.toThrow(/append-only/);
    expect((await readDataDir(dir)).audit_trail).toHaveLength(2);
  });

  it('refuses a change that reorders the entries', async () => {
    const dir = await makeDataDir(dataset());
    await transact(dir, () => ({ audit: [audit(1), audit(2)] }));
    await expect(transact(dir, (work) => { work.audit_trail.reverse(); })).rejects.toThrow();
  });
});

describe('reading', () => {
  it('returns the files and the parsed data together', async () => {
    const dir = await makeDataDir(dataset());
    const { raw, ds } = await snapshot(dir);
    expect(JSON.parse(raw['startups.json'])).toEqual(ds.companies);
    expect(ds.audit_trail).toEqual([]);
  });
});
