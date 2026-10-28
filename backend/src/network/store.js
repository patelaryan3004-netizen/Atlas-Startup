// Where the members' side of the site keeps what people made: accounts, sessions, posts, replies, saved things, reports and suggestions.
//
// One JSON file, written whole and atomically (a temporary file, then a rename), changed one change at a time. It holds a few thousand
// posts comfortably: past that, it is the thing to swap for a database (everything reads and writes through this file's two calls).
//
// THE LIMIT THAT MATTERS: the free Render plan's disk is erased every time the service restarts or redeploys. A community kept there would lose
// everyone's accounts and posts without a word. So the store is only "durable" where the machine says its folder is: NETWORK_DATA_DIR (a mounted
// disk), or the working folder of a developer's own computer. On Render with no NETWORK_DATA_DIR the whole members' side says it is not open yet,
// rather than take posts it cannot keep (see createNetwork in index.js).
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';

const FILE = 'network.json';
const emptyData = () => ({
  version: 1, members: [], sessions: [], posts: [], replies: [], likes: [], saved: [], reports: [], suggestions: [], events: [], jobs: [], audit: [],
});

export async function openStore({ dir }) {
  const target = path.join(dir, FILE);
  let data;
  try {
    data = { ...emptyData(), ...JSON.parse(await readFile(target, 'utf8')) };
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    data = emptyData();
  }
  let queue = Promise.resolve();

  async function persist(next) {
    await mkdir(dir, { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(next)}\n`, { mode: 0o600 });
    await rename(tmp, target);
  }

  return {
    file: target,
    // The current data. Callers read it and never change it.
    read: () => data,
    // Makes a change: `fn` gets a copy to change and may return a value. If it throws, nothing is kept. The next change waits for this one.
    change(fn) {
      const run = async () => {
        const draft = structuredClone(data);
        const result = await fn(draft);
        await persist(draft);
        data = draft;
        return result;
      };
      const done = queue.then(run, run);
      queue = done.catch(() => {});
      return done;
    },
  };
}

// A store that lives in memory only, for a test that does not want a folder.
export function memoryStore() {
  let data = emptyData();
  let queue = Promise.resolve();
  return {
    file: null,
    read: () => data,
    change(fn) {
      const run = async () => {
        const draft = structuredClone(data);
        const result = await fn(draft);
        data = draft;
        return result;
      };
      const done = queue.then(run, run);
      queue = done.catch(() => {});
      return done;
    },
  };
}
