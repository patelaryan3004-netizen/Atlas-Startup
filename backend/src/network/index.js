// The members' side of the site, opened: its store, its accounts, and whether it can honestly be open at all.
//
// It is open when the machine says where it can keep things: NETWORK_DATA_DIR (a disk that survives a restart), or a developer's own computer (a folder
// in backend/, which git ignores). On Render with no NETWORK_DATA_DIR it is NOT open: Render's free disk is erased on every restart, so accounts and posts kept
// there would vanish. The API says so (503, "network_unavailable") and the pages say the community is not open yet. NETWORK_ENABLED=0 closes it by hand.
import path from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openStore, memoryStore } from './store.js';
import { createAuth } from './auth.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DIR = path.join(HERE, '..', '..', '.network');
export const EVENTS_FILE = path.join(HERE, '..', 'data', 'events.json');
export const JOBS_FILE = path.join(HERE, '..', 'data', 'jobs.json');

// A JSON file read again only when it has changed.
function watched(file) {
  let stamp = -1;
  let value = [];
  return () => {
    try {
      const m = statSync(file).mtimeMs;
      if (m !== stamp) { value = JSON.parse(readFileSync(file, 'utf8')); stamp = m; }
    } catch (e) { if (e.code !== 'ENOENT') throw e; value = []; stamp = -1; }
    return value;
  };
}

export function createNetwork({ dir, memory = false, env = process.env, now = Date.now, limits, eventsFile = EVENTS_FILE, curatedEvents, jobsFile = JOBS_FILE, curatedJobsRows } = {}) {
  const off = ['0', 'false', 'no', 'off'].includes(String(env.NETWORK_ENABLED ?? '').trim().toLowerCase());
  let folder = dir ?? env.NETWORK_DATA_DIR ?? null;
  let reason = null;
  if (off) reason = 'The community has been closed by the site owner.';
  else if (!memory && !folder) {
    if (env.RENDER) reason = 'The community is not open yet: it needs a disk that survives restarts (NETWORK_DATA_DIR), and this server has none.';
    else folder = DEFAULT_DIR;
  }
  const available = reason === null;
  const events = curatedEvents ? () => curatedEvents : watched(eventsFile);
  const jobs = curatedJobsRows ? () => curatedJobsRows : watched(jobsFile);

  let ready = null;
  const open = () => {
    if (!available) return Promise.reject(Object.assign(new Error(reason), { status: 503, code: 'network_unavailable' }));
    ready ??= (async () => {
      const store = memory ? memoryStore() : await openStore({ dir: folder });
      return { store, auth: createAuth({ store, now, limits }) };
    })();
    return ready;
  };

  return { available, reason, open, events, jobs, now, dir: memory ? null : folder };
}
