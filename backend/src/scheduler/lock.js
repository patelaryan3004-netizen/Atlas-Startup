// One scheduler tick at a time. The data lock (models/store.js) is held for moments, around each write; a tick lasts
// minutes, so it has its own lock file, which does not stop the Command Center or the command line from writing
// between a tick's own writes. A second tick that finds it held does nothing and says so in the run log.
// A lock left by a tick that died goes stale and is taken over. (Staleness is judged by the file's age on the real
// clock, not the injected one: the file's time is the operating system's.)
import { open, readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

export const SCHEDULER_LOCK_FILE = '.scheduler.lock';
export const STALE_LOCK_MS = 90 * 60000;

export async function acquireTickLock(dir, { now = Date.now, staleMs = STALE_LOCK_MS } = {}) {
  const file = path.join(path.resolve(dir), SCHEDULER_LOCK_FILE);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const handle = await open(file, 'wx');
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date(now()).toISOString() })); } finally { await handle.close(); }
      return { file, release: () => unlink(file).catch(() => {}) };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const info = await stat(file).catch(() => null);
      if (!info) continue; // it vanished: try again at once
      const ageMs = Date.now() - info.mtimeMs;
      if (ageMs > staleMs) { await unlink(file).catch(() => {}); continue; }
      let holder = {};
      try { holder = JSON.parse(await readFile(file, 'utf-8')); } catch { /* unreadable: still held */ }
      return { held: { pid: holder.pid ?? null, since: holder.at ?? null, ageMs } };
    }
  }
  return { held: { pid: null, since: null, ageMs: 0 } };
}
