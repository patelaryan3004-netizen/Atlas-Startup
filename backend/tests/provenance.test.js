import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import request from 'supertest';
import { buildProvenance, PUBLIC_SOURCE_KINDS } from '../src/catalog/provenance.js';
import { createCatalog, buildSnapshot, recordFor, sourcesFor, CARD_FIELDS } from '../src/catalog/catalog.js';
import { createApp } from '../src/app.js';
import { co, dataset, source, evidenceRow, ISO } from './helpers/locations.js';
import { makeDataDir, removeMadeDirs } from './helpers/store.js';

afterEach(removeMadeDirs);

const EARLY = '2026-10-01T00:00:00.000Z';
const LATE = '2026-10-09T00:00:00.000Z';

describe('what a company page may say about where its facts came from', () => {
  const sources = [
    source('site', 'company_website', 'https://acme.example/'),
    source('board', 'company_website', 'https://boards.greenhouse.io/acme'),
    { ...source('note', 'user_supplied', null), note: 'Owner-supplied research notes: do not publish.' },
    source('private', 'user_supplied', 'https://form.example/submission/123'),
    source('mailto', 'press', 'mailto:someone@example.com'),
    source('press', 'press', 'https://news.example/acme'),
  ];

  it('lists the public pages behind the facts, with what each backs and when it was last read, the page that backs the most first', () => {
    const p = buildProvenance({
      sources,
      evidence: [
        evidenceRow('acme', 'description', 'A company.', 'site', { verified_at: EARLY }),
        evidenceRow('acme', 'website', 'https://acme.example', 'site', { verified_at: LATE }),
        evidenceRow('acme', 'founders', ['A'], 'site', { verified_at: EARLY }),
        evidenceRow('acme', 'funding_total', 5, 'press', { verified_at: EARLY }),
      ],
    });
    const found = p.get('acme').sources;
    expect(found.map((s) => s.url)).toEqual(['https://acme.example/', 'https://news.example/acme']);
    expect(found[0]).toEqual({ title: 'site', url: 'https://acme.example/', publisher: null, kind: 'company_website', checked_at: LATE, backs: ['description', 'founders', 'website'] });
    expect(found[1].backs).toEqual(['funding_total']);
  });

  it('never serves what a person told us, a page with no web address, or one that is not http(s), and never a note', () => {
    const p = buildProvenance({
      sources,
      evidence: ['note', 'private', 'mailto', 'site'].map((id) => evidenceRow('acme', 'description', 'x', id)).map((e, i) => ({ ...e, id: `e${i}` })),
    });
    const found = p.get('acme').sources;
    expect(found.map((s) => s.url)).toEqual(['https://acme.example/']);
    expect(JSON.stringify(p.get('acme'))).not.toMatch(/Owner-supplied|do not publish|submission|mailto/);
    expect(found.every((s) => !('note' in s) && !('id' in s))).toBe(true);
    expect(PUBLIC_SOURCE_KINDS).not.toContain('user_supplied');
  });

  it('counts only active evidence: a claim that was turned down or replaced backs nothing', () => {
    const p = buildProvenance({
      sources,
      evidence: [evidenceRow('acme', 'description', 'x', 'site', { status: 'rejected' }), evidenceRow('beta', 'description', 'x', 'site', { status: 'superseded' })],
    });
    expect(p.get('acme')).toBeUndefined();
    expect(p.get('beta')).toBeUndefined();
  });

  it('names the page that says a company is hiring: its newest check that is not a low-confidence one', () => {
    const p = buildProvenance({
      sources,
      evidence: [
        evidenceRow('acme', 'hiring_status', 'hiring', 'site', { id: 'h1', verified_at: EARLY, confidence: 'high' }),
        evidenceRow('acme', 'hiring_status', 'hiring', 'board', { id: 'h2', verified_at: LATE, confidence: 'high' }),
        evidenceRow('acme', 'hiring_status', 'hiring', 'press', { id: 'h3', verified_at: '2026-10-10T00:00:00.000Z', confidence: 'low' }),
        evidenceRow('acme', 'hiring_status', 'not_hiring', 'site', { id: 'h4', verified_at: '2026-10-11T00:00:00.000Z', confidence: 'high' }),
      ],
    });
    // the newest check is the board's (LATE), but a board read on the 11th, after it, listed no roles: so the roles are checked, not confirmed
    expect(p.get('acme').hiring).toEqual({ url: 'https://boards.greenhouse.io/acme', checked_at: LATE, confirmed_at: null });
    // a job board that listed no roles is kept too, as its own observation
    expect(p.get('acme').no_roles).toEqual({ url: 'https://acme.example/', checked_at: '2026-10-11T00:00:00.000Z' });
  });

  it('confirms hiring only from a high-confidence reading, and takes the confirmation back once a board read later lists no roles', () => {
    const rows = (hiring, extra = []) => buildProvenance({ sources, evidence: [evidenceRow('acme', 'hiring_status', 'hiring', 'board', { id: 'h', verified_at: EARLY, confidence: hiring }), ...extra] }).get('acme');
    expect(rows('high').hiring.confirmed_at).toBe(EARLY);
    // plain text read by hand, or an inference: a check (it has a date), but not a confirmation
    expect(rows('medium').hiring).toEqual({ url: 'https://boards.greenhouse.io/acme', checked_at: EARLY, confirmed_at: null });
    // an empty board read AFTER the confirmation puts it in dispute; one read BEFORE it does not
    const empty = (at) => evidenceRow('acme', 'hiring_status', 'not_hiring', 'site', { id: 'n', verified_at: at, confidence: 'medium' });
    expect(rows('high', [empty(LATE)]).hiring.confirmed_at).toBeNull();
    expect(rows('high', [empty('2026-10-01T00:00:00.000Z')]).hiring.confirmed_at).toBe(EARLY);
  });

  it('falls back to the page an open role was read from when no evidence says hiring, and ignores a closed one', () => {
    const p = buildProvenance({
      sources,
      evidence: [],
      jobs: [
        { id: 'j1', company_id: 'acme', status: 'open', source_id: 'board', retrieved_at: LATE },
        { id: 'j2', company_id: 'acme', status: 'closed', source_id: 'site', retrieved_at: '2026-10-12T00:00:00.000Z' },
        { id: 'j3', company_id: 'beta', status: 'open', source_id: 'note', retrieved_at: LATE },
      ],
    });
    // an open role is a check, but only evidence can confirm
    expect(p.get('acme').hiring).toEqual({ url: 'https://boards.greenhouse.io/acme', checked_at: LATE, confirmed_at: null });
    expect(p.get('beta')?.hiring ?? null).toBeNull(); // a page that may not be served is not named
  });

  it('is empty for no records at all', () => {
    expect(buildProvenance().size).toBe(0);
    expect(buildProvenance({ sources: [], evidence: [], jobs: [] }).size).toBe(0);
  });
});

describe('hiring now: the four states, and the window', () => {
  const NOW = Date.parse('2026-10-13T12:00:00.000Z');
  const DAY = 86400000;
  const iso = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();
  const board = source('board', 'company_website', 'https://boards.greenhouse.io/acme');
  const build = (rows, evidence, windowDays = 14) => buildSnapshot(JSON.stringify(rows.map((r) => ({ ...r, slug: r.id }))), 'v', {
    provenance: buildProvenance({ sources: [board], evidence }), now: () => NOW, hiringWindowDays: windowDays,
  });
  const company = (id, extra = {}) => ({ ...co(id, { hiring: true }), id, hiring_verified_at: iso(1), ...extra });
  const hiringRow = (id, daysAgo, confidence = 'high') => evidenceRow(id, 'hiring_status', 'hiring', 'board', { id: `${id}-h`, verified_at: iso(daysAgo), confidence });

  it('counts a company as hiring when a page confirmed its roles inside the window, and not when the confirmation is older', () => {
    const snap = build([company('fresh'), company('old')], [hiringRow('fresh', 3), hiringRow('old', 20)]);
    expect(recordFor(snap, 'fresh')).toMatchObject({ hiring: true, hiringState: 'hiring', hiring_checked_at: null });
    // the edge: 14 days is inside, 15 is not
    expect(recordFor(build([company('edge')], [hiringRow('edge', 14)]), 'edge').hiring).toBe(true);
    expect(recordFor(build([company('past')], [hiringRow('past', 15)]), 'past')).toMatchObject({ hiring: false, hiringState: 'checked' });
    expect(recordFor(snap, 'old')).toMatchObject({ hiring: false, hiringState: 'checked', hiring_checked_at: iso(20), hiring_source_url: 'https://boards.greenhouse.io/acme' });
  });

  it('holds a company out of hiring now when its roles were only read from page text by hand (medium), but still says when', () => {
    const snap = build([company('hand')], [hiringRow('hand', 8, 'medium')]);
    expect(recordFor(snap, 'hand')).toMatchObject({ hiring: false, hiringState: 'checked', hiring_checked_at: iso(8) });
  });

  it('holds a company out when a board read after the confirmation listed no roles: the claim is in dispute', () => {
    const empty = evidenceRow('disputed', 'hiring_status', 'not_hiring', 'board', { id: 'n', verified_at: iso(1), confidence: 'medium' });
    const snap = build([company('disputed')], [hiringRow('disputed', 8), empty]);
    expect(recordFor(snap, 'disputed')).toMatchObject({ hiring: false, hiringState: 'checked', hiring_checked_at: iso(8) });
  });

  it('says "none" for a company whose board was read and listed no roles, and "unverified" for everything nobody read', () => {
    const empty = evidenceRow('quiet', 'hiring_status', 'not_hiring', 'board', { id: 'q', verified_at: iso(1), confidence: 'medium' });
    const snap = build([{ ...co('quiet'), id: 'quiet', hiring: false, hiring_status: 'not_hiring' }, { ...co('nobody'), id: 'nobody' }, company('flagged', { hiring_verified_at: null })], [empty]);
    expect(recordFor(snap, 'quiet')).toMatchObject({ hiring: false, hiringState: 'none', hiring_checked_at: iso(1) });
    expect(recordFor(snap, 'nobody')).toMatchObject({ hiring: false, hiringState: 'unverified', hiring_checked_at: null });
    expect(recordFor(snap, 'flagged')).toMatchObject({ hiring: false, hiringState: 'unverified', rolesUnverified: true });
  });

  it('keeps the older rule when no window is asked for: a page-backed company is hiring however long ago', () => {
    const snap = build([company('old')], [hiringRow('old', 200)], null);
    expect(recordFor(snap, 'old')).toMatchObject({ hiring: true, hiringState: 'hiring' });
  });

  it('counts the confirmed ones as hiring and the earlier ones as checked, and answers from a catalog that rebuilds when the day changes', async () => {
    const dir = await makeDataDir(dataset([co('fresh', { hiring: true }), co('old', { hiring: true })], { evidence: [hiringRow('fresh', 3), hiringRow('old', 20)], sources: [board] }));
    let clock = NOW;
    const catalog = createCatalog({ file: path.join(dir, 'startups.json'), now: () => clock, hiringWindowDays: 14, reloadMs: 0 });
    const day1 = await catalog.refresh();
    expect(recordFor(day1, 'fresh').hiring).toBe(true);
    clock = NOW + 12 * DAY; // 15 days after the confirmation: it has aged out, with no change to any file
    const day13 = await catalog.refresh();
    expect(recordFor(day13, 'fresh')).toMatchObject({ hiring: false, hiringState: 'checked' });
  });
});

describe('a company in the catalog', () => {
  const rows = [
    { ...co('Acme', { hiring: true }), id: 'acme', slug: 'acme', hiring_verified_at: LATE },
    { ...co('Flagged', { hiring: true }), id: 'flagged', slug: 'flagged', hiring_verified_at: null },
    { ...co('Plain'), id: 'plain', slug: 'plain' },
  ];
  const provenance = buildProvenance({
    sources: [source('site', 'company_website', 'https://acme.example/'), source('board', 'company_website', 'https://boards.greenhouse.io/acme')],
    evidence: [
      evidenceRow('acme', 'description', 'x', 'site', { id: 'a', verified_at: EARLY }),
      evidenceRow('acme', 'hiring_status', 'hiring', 'board', { id: 'b', verified_at: LATE, confidence: 'high' }),
      evidenceRow('flagged', 'hiring_status', 'hiring', 'board', { id: 'c', verified_at: LATE, confidence: 'high' }),
    ],
  });
  const snap = buildSnapshot(JSON.stringify(rows), 'v1', { provenance });

  it('carries the page that backs its hiring on its card, and only while it is public as hiring', () => {
    expect(CARD_FIELDS).toContain('hiring_source_url');
    expect(snap.cards.find((c) => c.slug === 'acme').hiring_source_url).toBe('https://boards.greenhouse.io/acme');
    // flagged as hiring, and a page says so, but no verified check is on the record: public as not hiring, so no page is named
    expect(snap.cards.find((c) => c.slug === 'flagged').hiring).toBe(false);
    expect(snap.cards.find((c) => c.slug === 'flagged')).not.toHaveProperty('hiring_source_url');
    expect(snap.cards.find((c) => c.slug === 'plain')).not.toHaveProperty('hiring_source_url');
  });

  it('answers with its sources, when the newest was read, and the page that backs hiring', () => {
    const acme = sourcesFor(snap, recordFor(snap, 'acme'));
    expect(acme.sources.map((s) => s.url)).toEqual(['https://boards.greenhouse.io/acme', 'https://acme.example/']); // one fact each: by title
    expect(acme.checked_at).toBe(LATE);
    expect(acme.hiring_source).toEqual({ url: 'https://boards.greenhouse.io/acme', checked_at: LATE, confirmed_at: LATE });
  });

  it('says nothing was checked for a company no public page backs, and names no hiring page for one not public as hiring', () => {
    expect(sourcesFor(snap, recordFor(snap, 'plain'))).toEqual({ sources: [], checked_at: null, hiring_source: null });
    expect(sourcesFor(snap, recordFor(snap, 'flagged')).hiring_source).toBeNull();
  });

  it('still builds with no provenance at all', () => {
    const bare = buildSnapshot(JSON.stringify(rows), 'v1');
    expect(sourcesFor(bare, recordFor(bare, 'acme'))).toEqual({ sources: [], checked_at: null, hiring_source: null });
  });
});

describe('GET /api/startups/:slug and the files beside the companies', () => {
  async function app() {
    const ds = dataset([{ ...co('Acme', { hiring: true }), id: 'acme', slug: 'acme' }, { ...co('Plain'), id: 'plain', slug: 'plain' }], {
      sources: [
        source('site', 'company_website', 'https://acme.example/'),
        { ...source('note', 'user_supplied', 'https://form.example/x'), note: 'A private note.' },
      ],
      evidence: [
        evidenceRow('acme', 'description', 'A company.', 'site', { id: 'a' }),
        evidenceRow('acme', 'hiring_status', 'hiring', 'site', { id: 'b', confidence: 'high', verified_at: LATE }),
        evidenceRow('acme', 'address', '1 Example St', 'note', { id: 'c' }),
      ],
    });
    const dir = await makeDataDir(ds);
    return createApp({ catalog: createCatalog({ file: path.join(dir, 'startups.json'), reloadMs: 0 }) });
  }

  it('serves the sources of a company, and what they back, and never the note or a source a person supplied', async () => {
    const res = await request(await app()).get('/api/startups/acme');
    expect(res.status).toBe(200);
    expect(res.body.sources.map((s) => s.url)).toEqual(['https://acme.example/']);
    expect(res.body.sources[0].backs).toEqual(['description', 'hiring_status']);
    expect(res.body.checked_at).toBeTruthy();
    expect(res.body.hiring_source.url).toBe('https://acme.example/');
    expect(JSON.stringify(res.body)).not.toMatch(/private note|form\.example/);
  });

  it('says there are no sources for a company none backs', async () => {
    const res = await request(await app()).get('/api/startups/plain');
    expect(res.body.sources).toEqual([]);
    expect(res.body.checked_at).toBeNull();
    expect(res.body.hiring_source).toBeNull();
  });

  it('does not put the sources in a list of companies: only the one company\'s page asks for them', async () => {
    const res = await request(await app()).get('/api/startups?limit=10&view=card');
    for (const card of res.body.results) {
      expect(card).not.toHaveProperty('sources');
      expect(card).not.toHaveProperty('checked_at');
    }
  });
});
