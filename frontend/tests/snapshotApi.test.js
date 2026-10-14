import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchSummary, fetchStartupPage, fetchMarkers } from '../src/api.js';
import { peek } from '../src/peek.js';
import { forgetSnapshot, loadSnapshot, SNAPSHOT_URL, SNAPSHOT_VERSION } from '../src/snapshot.js';

// The first views draw from the snapshot file and the API's answer replaces it (api.js, snapshot.js, peek.js). Here the file and the API are
// both a fetch that the test controls.

const LIST_KEY = '/api/startups?limit=48&offset=0&sort=name&view=card';
const made = (ageDays = 0) => ({
  version: SNAPSHOT_VERSION,
  generatedAt: new Date(Date.now() - ageDays * 86400000).toISOString(),
  answers: {
    '/api/startups/summary': { count: 252, hiring: 25 },
    [LIST_KEY]: { results: [{ name: 'Canva' }], count: 252, hasMore: true },
  },
});

// A fetch that serves the snapshot file at once and holds each API answer until the test settles it.
function serve(snapshot) {
  const pending = [];
  vi.stubGlobal('fetch', vi.fn((url) => {
    if (url === SNAPSHOT_URL) return Promise.resolve({ ok: true, json: async () => snapshot });
    return new Promise((resolve, reject) => pending.push({ url, resolve: (body, ok = true, status = 200) => resolve({ ok, status, json: async () => body }), reject }));
  }));
  return pending;
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => forgetSnapshot());
afterEach(() => { forgetSnapshot(); vi.unstubAllGlobals(); });

describe('a question the snapshot can answer', () => {
  it('is answered from the snapshot at once, and then by the server', async () => {
    const pending = serve(made());
    const seen = [];
    const result = fetchSummary({}, { onSnapshot: (answer) => seen.push(answer) });
    await flush();
    expect(seen).toEqual([{ count: 252, hiring: 25 }]); // before the server has said anything
    pending[0].resolve({ count: 253, hiring: 26 });
    expect(await result).toEqual({ count: 253, hiring: 26 });
  });

  it('keeps what the snapshot gave when the server cannot be reached (it is asleep or down): the question still fails, the page has its answer', async () => {
    const pending = serve(made());
    const seen = [];
    const result = fetchSummary({}, { onSnapshot: (answer) => seen.push(answer) });
    await flush();
    pending[0].reject(new Error('network down'));
    await expect(result).rejects.toThrow('network down');
    expect(seen).toHaveLength(1);
  });

  it('hands back the snapshot\'s own object when the server says the same, so a page that sets it as state does not draw twice', async () => {
    const pending = serve(made());
    let given = null;
    const result = fetchStartupPage({}, { limit: 48, offset: 0, sort: 'name', onSnapshot: (page) => { given = page; } });
    await flush();
    pending[0].resolve({ results: [{ name: 'Canva' }], count: 252, hasMore: true });
    expect(await result).toBe(given);
  });

  it('does not offer the snapshot once the server has answered', async () => {
    const pending = serve(made());
    await loadSnapshot();
    const seen = [];
    const result = fetchSummary({}, { onSnapshot: (answer) => seen.push(answer) });
    pending[0].resolve({ count: 253 });
    await result;
    await flush();
    expect(seen).toEqual([]);
  });

  it('does not offer it for a question it does not hold (a filtered list goes to the server alone)', async () => {
    const pending = serve(made());
    const seen = [];
    const result = fetchSummary({ sector: 'AI' }, { onSnapshot: (answer) => seen.push(answer) });
    await flush();
    expect(seen).toEqual([]);
    pending[0].resolve({ count: 40 });
    expect(await result).toEqual({ count: 40 });
  });

  it('does not use a snapshot older than the server\'s 14-day "hiring now" window', async () => {
    const pending = serve(made(15));
    const seen = [];
    const result = fetchSummary({}, { onSnapshot: (answer) => seen.push(answer) });
    await flush();
    expect(seen).toEqual([]);
    pending[0].resolve({ count: 252 });
    await result;
  });

  it('works without any snapshot: a missing file is the server alone', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => (url === SNAPSHOT_URL ? Promise.resolve({ ok: false, status: 404 }) : Promise.resolve({ ok: true, json: async () => ({ items: [] }) }))));
    const seen = [];
    expect(await fetchMarkers({}, { onSnapshot: (answer) => seen.push(answer) })).toEqual({ items: [] });
    expect(seen).toEqual([]);
  });
});

describe('what a page first draws (peek)', () => {
  it('has nothing until the snapshot has arrived, then the answers it holds', async () => {
    serve(made());
    expect(peek.summary({})).toBeNull();
    await loadSnapshot();
    expect(peek.summary({})).toEqual({ count: 252, hiring: 25 });
    expect(peek.startupPage({}, { limit: 48, offset: 0, sort: 'name' }).results[0].name).toBe('Canva');
  });

  it('has nothing for a question the snapshot does not hold, or from a snapshot too old to use', async () => {
    serve(made());
    await loadSnapshot();
    expect(peek.summary({ sector: 'AI' })).toBeNull();
    expect(peek.startupPage({}, { limit: 48, offset: 0, sort: 'stage' })).toBeNull();
    forgetSnapshot();
    serve(made(20));
    await loadSnapshot();
    expect(peek.summary({})).toBeNull();
  });
});
