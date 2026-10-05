// Reading and writing the data files when more than one thing can write them: the
// discovery CLI, the enrichment worker, and the Command Center's actions.
//
// The data lives in JSON files, so a write is "read everything, change something,
// write what changed". Without care, two writers lose each other's work: a worker
// reads the files, spends twenty minutes on the network, and writes back over what an
// admin approved in the meantime. This module is the care:
//
//   withLock     one writer at a time, across processes (a lock file) and within one
//                (a queue). A lock left by a crashed process goes stale and is taken over.
//   commit       migrate, validate, then check the files on disk are still what the caller
//                read, and write only what changed. If anything fails nothing is written.
//   transact     lock -> read fresh -> change -> record in the audit trail -> commit. The
//                change and its audit rows are written together, so an action and its
//                record are both there or neither is. The change itself must be quick and
//                offline: the network is used outside a transaction and its result applied
//                inside one.
//
// The audit trail is append-only: commit refuses a write that would alter or drop a row.
import { open, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  COLLECTION_FILES, loadRaw, parseRaw, serializeDataset, writeFiles, migrateDataset, validateDataset,
} from './dataset.js';
import { appendAudit } from './auditTrail.js';

export const LOCK_FILE = '.data.lock';

export class DataLockError extends Error {
  constructor(message) { super(message); this.name = 'DataLockError'; }
}
export class DataChangedError extends Error {
  constructor(files) {
    super(`the data files changed while this was running (${files.join(', ')}); nothing was written, so run it again`);
    this.name = 'DataChangedError';
    this.files = files;
  }
}
export class DataValidationError extends Error {
  constructor(errors) {
    super(`nothing was written: ${errors.length} problem(s)\n${errors.slice(0, 10).map((e) => `  - ${e}`).join('\n')}`);
    this.name = 'DataValidationError';
    this.errors = errors;
  }
}

// Calls within one process run one after another, in the order they arrived.
const chains = new Map();
function serial(key, fn) {
  const run = (chains.get(key) ?? Promise.resolve()).then(fn);
  chains.set(key, run.then(() => {}, () => {}));
  return run;
}

export function withLock(dir, fn, { staleMs = 120000, timeoutMs = 30000, pollMs = 25, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const root = path.resolve(dir);
  return serial(root, async () => {
    const file = path.join(root, LOCK_FILE);
    const started = now();
    for (;;) {
      try {
        const handle = await open(file, 'wx');
        try { await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date(now()).toISOString() })); } finally { await handle.close(); }
        break;
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        let age;
        try { age = now() - (await stat(file)).mtimeMs; } catch { continue; } // it vanished: try again at once
        if (age > staleMs) { await unlink(file).catch(() => {}); continue; } // its owner is long gone
        if (now() - started > timeoutMs) throw new DataLockError(`another process has held the data lock for ${Math.round(age / 1000)}s (${file}); if nothing is running, delete it`);
        await sleep(pollMs);
      }
    }
    try { return await fn(); } finally { await unlink(file).catch(() => {}); }
  });
}

// The files and the parsed dataset, as one consistent snapshot.
export async function readSnapshot(dir) {
  const raw = await loadRaw(dir);
  return { raw, ds: parseRaw(raw) };
}

// A snapshot that cannot be half-way through someone's write.
export const snapshot = (dir, opts) => withLock(dir, () => readSnapshot(dir), opts);

// Migrate, validate and write what changed. Call it holding the lock. `raw` is what the
// caller read: if the files on disk are no longer that, someone else wrote in between.
export async function commit(dir, raw, work) {
  const migrated = migrateDataset(work);
  const errors = validateDataset(migrated);
  if (errors.length) throw new DataValidationError(errors);
  const files = serializeDataset(migrated);

  const current = await loadRaw(dir);
  const moved = Object.keys(files).filter((f) => (current[f] ?? null) !== (raw[f] ?? null));
  if (moved.length) throw new DataChangedError(moved);

  const trailFile = COLLECTION_FILES.audit_trail;
  const was = raw[trailFile] == null ? [] : JSON.parse(raw[trailFile]);
  const now = migrated.audit_trail;
  if (now.length < was.length || was.some((row, i) => !isDeepStrictEqual(row, now[i]))) {
    throw new Error('the audit trail is append-only: this change would alter or remove an entry');
  }

  const changed = Object.fromEntries(Object.entries(files).filter(([f, text]) => (raw[f] ?? null) !== text));
  await writeFiles(dir, changed);
  return { changed: Object.keys(changed), data: migrated };
}

// mutate(work, { at }) changes a working copy and returns { result, audit } (both optional). It runs
// holding the lock, so it must not wait on anything slow.
export function transact(dir, mutate, { now = Date.now, ...lockOptions } = {}) {
  return withLock(dir, async () => {
    const raw = await loadRaw(dir);
    const work = structuredClone(parseRaw(raw));
    const at = new Date(now()).toISOString();
    const outcome = (await mutate(work, { at })) ?? {};
    if (outcome.audit?.length) appendAudit(work, outcome.audit, at);
    const { changed } = await commit(dir, raw, work);
    return { result: outcome.result, changed, at };
  }, { now, ...lockOptions });
}
