// The first view of the busiest pages, from a file that is served with the site (public/data/snapshot.json, made by `npm run snapshot` in
// backend/ from the same code that answers the API). A page draws it at once and asks the API in the background; the API's answer replaces
// it (api.js, getJson). So the first screen never waits on the API server, and it still shows when that server is asleep or down.
//
// The file holds the API's own answers to the questions the first views ask (snapshotRequests.js), keyed by the request's path and query,
// so an answer here is exactly the answer the API gave when the file was made, and a question it does not hold goes to the API as before.
//
// How old it may be: the API says "hiring now" for a company whose open roles a page confirmed in the last 14 days, counted from the moment
// it is asked. A file keeps what it said when it was made, so past that same 14 days it could name a company that no longer qualifies: an
// older file is not used at all.
export const SNAPSHOT_URL = '/data/snapshot.json';
export const SNAPSHOT_VERSION = 1;
export const MAX_AGE_DAYS = 14;
const DAY = 86400000;

// The file if it is one this code can read and is young enough; otherwise null (and the pages ask the API, as they always did).
export function usable(snapshot, now = Date.now()) {
  if (!snapshot || snapshot.version !== SNAPSHOT_VERSION || !snapshot.answers || typeof snapshot.answers !== 'object') return null;
  const made = Date.parse(snapshot.generatedAt);
  if (Number.isNaN(made) || now - made > MAX_AGE_DAYS * DAY || made - now > DAY) return null;
  return snapshot;
}

let loading = null;
let loaded = null; // the file itself, once it has arrived and is usable

// The file, fetched once. index.html starts the fetch before any script has run (window.__auSnapshot) on the pages that use it; a page
// reached some other way fetches it here. Anything that goes wrong is "no snapshot".
export function loadSnapshot() {
  if (!loading) {
    const started = (typeof window !== 'undefined' && window.__auSnapshot) || fetch(SNAPSHOT_URL).then((res) => (res.ok ? res.json() : null));
    loading = Promise.resolve(started).then((snapshot) => { loaded = usable(snapshot); return loaded; }, () => null);
  }
  return loading;
}

// What the API answered to this request when the file was made (the path with its query, from /api on), or null.
export const snapshotAnswer = (path) => loadSnapshot().then((snapshot) => snapshot?.answers[path] ?? null);

// The same answer, now, or null when the file has not arrived (or does not hold it). A page uses it for what it first draws: its first
// paint then already has the figures, the cards and the pins, instead of drawing without them and moving everything when they come.
export const peekSnapshot = (path) => loaded?.answers[path] ?? null;

// For tests: forget the file that was loaded.
export function forgetSnapshot() { loading = null; loaded = null; }
