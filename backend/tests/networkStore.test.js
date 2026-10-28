import { describe, it, expect, afterEach } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { openStore } from '../src/network/store.js';
import { createNetwork } from '../src/network/index.js';
import { createApp } from '../src/app.js';
import { eventProblems, upcomingEvents } from '../src/network/events.js';
import { tempDir, removeTempDirs, fixture } from './helpers/catalog.js';

afterEach(removeTempDirs);

describe('the store the members\' side keeps things in', () => {
  it('writes what was changed to one file, and a fresh start reads it back', async () => {
    const dir = await tempDir();
    const a = await openStore({ dir });
    await a.change((draft) => { draft.posts.push({ id: 'p_1', body: 'hello' }); });
    const b = await openStore({ dir });
    expect(b.read().posts).toEqual([{ id: 'p_1', body: 'hello' }]);
    expect(JSON.parse(await readFile(a.file, 'utf8')).posts).toHaveLength(1);
  });

  it('keeps nothing of a change that fails halfway, in memory or on disk', async () => {
    const dir = await tempDir();
    const store = await openStore({ dir });
    await store.change((draft) => { draft.posts.push({ id: 'p_1' }); });
    await expect(store.change((draft) => { draft.posts.push({ id: 'p_2' }); draft.members.push({ id: 'm_1' }); throw new Error('boom'); })).rejects.toThrow('boom');
    expect(store.read().posts).toHaveLength(1);
    expect(store.read().members).toHaveLength(0);
    expect(JSON.parse(await readFile(store.file, 'utf8')).posts).toHaveLength(1);
    await store.change((draft) => { draft.posts.push({ id: 'p_3' }); }); // and the next change goes through
    expect(store.read().posts.map((p) => p.id)).toEqual(['p_1', 'p_3']);
  });

  it('takes changes one at a time, so two at once do not lose one', async () => {
    const dir = await tempDir();
    const store = await openStore({ dir });
    await Promise.all(Array.from({ length: 25 }, (_, i) => store.change(async (draft) => { await new Promise((r) => setTimeout(r, 1)); draft.posts.push({ id: `p_${i}` }); })));
    expect(store.read().posts).toHaveLength(25);
    expect(new Set(store.read().posts.map((p) => p.id)).size).toBe(25);
  });

  it('is what accounts and posts survive a restart in: a second server over the same folder sees the member and the post', async () => {
    const dir = await tempDir();
    const f = await fixture(1);
    const make = () => createApp({ catalog: f.catalog, network: createNetwork({ dir, curatedEvents: [], curatedJobsRows: [] }) });
    const first = make();
    const signup = await request(first).post('/api/auth/signup').send({ name: 'Ada Example', email: 'ada@example.com', password: 'a-long-enough-password' });
    await request(first).post('/api/feed').set({ Authorization: `Bearer ${signup.body.token}` }).send({ topic: 'idea', body: 'Still here after a restart.' });
    const second = make();
    expect((await request(second).get('/api/feed')).body.results.map((p) => p.body)).toEqual(['Still here after a restart.']);
    expect((await request(second).get('/api/account').set({ Authorization: `Bearer ${signup.body.token}` })).status).toBe(200); // the session too
    const raw = await readFile(path.join(dir, 'network.json'), 'utf8');
    expect(raw).not.toContain('a-long-enough-password'); // the password is not in the file
    expect(raw).toContain('scrypt$');
  });

  it('refuses to start from a file it cannot read, rather than start empty over someone\'s data', async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, 'network.json'), '{ not json');
    await expect(openStore({ dir })).rejects.toThrow();
  });
});

describe('the curated events file', () => {
  it('holds only events that pass every check, each with its own sources and a check date', async () => {
    const events = JSON.parse(await readFile(new URL('../src/data/events.json', import.meta.url), 'utf8'));
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(eventProblems(e), e.id).toEqual([]);
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
    for (const e of events) {
      expect(e.registration_url, e.id).toMatch(/^https:\/\//);
      expect(e.source_url, e.id).toMatch(/^https:\/\//);
      expect(e.source_checked_at, e.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.why_selected, e.id).not.toMatch(/\b(best|top|leading|premier)\b/i); // a reason, never a ranking
    }
  });

  it('hides each event once it is over, with no help', async () => {
    const events = JSON.parse(await readFile(new URL('../src/data/events.json', import.meta.url), 'utf8'));
    expect(upcomingEvents(events, Date.parse('2026-10-28T02:00:00Z')).length).toBe(events.length);
    expect(upcomingEvents(events, Date.parse('2027-03-01T00:00:00Z'))).toEqual([]);
    const mid = upcomingEvents(events, Date.parse('2026-11-05T00:00:00Z')).map((e) => e.id);
    expect(mid).toContain('uq-ilab-pitch-night-2026');
    expect(mid).not.toContain('wade-showcase-pitch-night-2026');
  });

  it('answers a request for exactly the events (or roles, or members) a person saved', async () => {
    const f = await fixture(1);
    const network = createNetwork({ memory: true, now: () => Date.parse('2026-10-28T02:00:00Z') });
    const app = createApp({ catalog: f.catalog, network });
    const ids = (await request(app).get('/api/events')).body.results.slice(0, 2).map((e) => e.id);
    const some = await request(app).get(`/api/events?ids=${ids.join(',')},nope`);
    expect(some.body.results.map((e) => e.id).sort()).toEqual([...ids].sort());
    expect((await request(app).get('/api/events?ids=nope')).body.results).toEqual([]);
  });
});
