// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { usable, SNAPSHOT_VERSION, MAX_AGE_DAYS } from '../src/snapshot.js';
import { FIRST_VIEWS } from '../src/snapshotRequests.js';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/data/snapshot.json');
const DAY = 86400000;

afterEach(() => vi.unstubAllGlobals());

describe('the snapshot file the site serves beside its own files', () => {
  // The requests the first views make, found by running them (api.js) against a fetch that only notes the address.
  async function asked() {
    const urls = [];
    vi.stubGlobal('fetch', async (url) => { urls.push(url); return { ok: true, json: async () => ({}) }; });
    for (const ask of FIRST_VIEWS) await ask();
    return urls;
  }

  it('holds an answer to every question the first views ask, and no other (npm run snapshot in backend/ makes it)', async () => {
    const snapshot = JSON.parse(await readFile(file, 'utf8'));
    expect(snapshot.version).toBe(SNAPSHOT_VERSION);
    expect(Object.keys(snapshot.answers).sort()).toEqual((await asked()).sort());
  });

  it('is made of real answers: companies, pins, a page of cards and the lists\' counts', async () => {
    const { answers } = JSON.parse(await readFile(file, 'utf8'));
    expect(answers['/api/startups/summary'].count).toBeGreaterThan(0);
    expect(answers['/api/startups/markers'].items.length).toBeGreaterThan(0);
    expect(answers['/api/startups/meta'].sectors.length).toBeGreaterThan(0);
    const list = answers['/api/startups?limit=48&offset=0&sort=name&view=card'];
    expect(list.results.length).toBeGreaterThan(0);
    expect(list.results.length).toBeLessThanOrEqual(48);
    const hiring = answers['/api/startups?hiring=yes&limit=80&offset=0&sort=file&view=card'];
    for (const company of hiring.results) expect(company.hiring).toBe(true);
    const counts = Object.entries(answers).find(([key]) => key.startsWith('/api/startups/counts'))[1];
    expect(counts.counts.length).toBeGreaterThan(0);
  });

  it('holds nothing about people or firms', async () => {
    const text = await readFile(file, 'utf8');
    for (const word of ['/api/people', '/api/institutions', '/api/lists', 'people_seed']) expect(text, word).not.toContain(word);
  });
});

describe('when a snapshot may be used', () => {
  const made = (ageDays, now) => ({ version: SNAPSHOT_VERSION, generatedAt: new Date(now - ageDays * DAY).toISOString(), answers: { a: 1 } });
  const now = Date.parse('2026-10-14T00:00:00Z');

  it('uses a young one', () => {
    expect(usable(made(0, now), now)).not.toBeNull();
    expect(usable(made(MAX_AGE_DAYS - 0.5, now), now)).not.toBeNull();
  });

  it('does not use one older than the server\'s 14-day "hiring now" window: it could name a company that no longer qualifies', () => {
    expect(MAX_AGE_DAYS).toBe(14);
    expect(usable(made(MAX_AGE_DAYS + 1, now), now)).toBeNull();
  });

  it('does not use one from the future, one of another version, or one that is not a snapshot at all', () => {
    expect(usable(made(-3, now), now)).toBeNull();
    expect(usable({ ...made(0, now), version: 99 }, now)).toBeNull();
    expect(usable({ ...made(0, now), generatedAt: 'yesterday' }, now)).toBeNull();
    expect(usable({ version: SNAPSHOT_VERSION, generatedAt: new Date(now).toISOString() }, now)).toBeNull();
    for (const nothing of [null, undefined, 'x', 3, []]) expect(usable(nothing, now)).toBeNull();
  });
});
