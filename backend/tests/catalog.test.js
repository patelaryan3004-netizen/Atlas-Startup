import { describe, it, expect, afterEach } from 'vitest';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createCatalog, readFilters, select, explain, pageOf, facets, summary, markers, suggest, recordFor, MARKER_FIELDS, CARD_FIELDS, buildSnapshot, SORTS, STAGE_ORDER, stageRank } from '../src/catalog/catalog.js';
import { generateCompanies } from '../scripts/scale/fixtures.js';
import { fixture, tempDir, removeTempDirs } from './helpers/catalog.js';
import { INTERNAL_FIELDS } from '../src/models/company.js';

afterEach(removeTempDirs);

// The filter the API had before the catalog, copied from the route it replaced. The catalog is correct if, for
// any question, it picks the same companies in the same order.
const matchesAny = (value, param) => (!param ? true : String(param).split(',').includes(value));
function legacyFilter(startups, query) {
  const { search, sector, city, investor, stage, hiring, taskGate } = query;
  return startups.filter((s) => {
    if (search) {
      const q = String(search).toLowerCase();
      const nameMatch = s.name.toLowerCase().includes(q);
      const founderMatch = (s.founders || []).some((f) => f.toLowerCase().includes(q));
      if (!nameMatch && !founderMatch) return false;
    }
    if (!matchesAny(s.sector, sector)) return false;
    if (!matchesAny(s.city, city)) return false;
    if (investor && !s.investors.includes(investor)) return false;
    if (stage && s.stage !== stage) return false;
    if (hiring === 'yes' && !s.hiring) return false;
    if (hiring === 'no' && s.hiring) return false;
    if (taskGate === 'yes' && !s.taskGate?.enabled) return false;
    if (taskGate === 'no' && s.taskGate?.enabled) return false;
    return true;
  });
}
// The list's sorts, as the page used to apply them in the browser.
const OLD_SORTS = {
  name: (a, b) => a.name.localeCompare(b.name),
  hiring: (a, b) => (b.hiring === true) - (a.hiring === true) || a.name.localeCompare(b.name),
  location: (a, b) => a.city.localeCompare(b.city) || a.name.localeCompare(b.name),
  industry: (a, b) => (a.sectorFull || a.sector).localeCompare(b.sectorFull || b.sector) || a.name.localeCompare(b.name),
};

function lcg(seed) { let s = seed; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

describe('the catalog answers a question exactly as the old filter did', () => {
  it('for 400 random questions over 1,200 companies: the same companies in the same order', async () => {
    const f = await fixture(1200);
    const snap = await f.catalog.snapshot();
    const rand = lcg(7);
    const pick = (list) => list[Math.floor(rand() * list.length)];
    const sectors = [...new Set(f.rows.map((r) => r.sector))];
    const cities = [...new Set(f.rows.map((r) => r.city))];
    const investors = [...new Set(f.rows.flatMap((r) => r.investors))];
    const stages = [...new Set(f.rows.map((r) => r.stage))];
    const words = f.rows.flatMap((r) => [r.name, ...(r.founders ?? [])]);
    let nonEmpty = 0;
    for (let i = 0; i < 400; i += 1) {
      const q = {};
      if (rand() < 0.4) { const w = pick(words); const start = Math.floor(rand() * w.length); q.search = rand() < 0.5 ? w.slice(start, start + 1 + Math.floor(rand() * 5)).toUpperCase() : w.slice(start, start + 3 + Math.floor(rand() * 4)); }
      if (rand() < 0.3) q.sector = rand() < 0.3 ? `${pick(sectors)},${pick(sectors)}` : rand() < 0.1 ? 'No Such Sector' : pick(sectors);
      if (rand() < 0.3) q.city = rand() < 0.3 ? `${pick(cities)},${pick(cities)}` : pick(cities);
      if (rand() < 0.2) q.investor = rand() < 0.1 ? 'Nobody Capital' : pick(investors);
      if (rand() < 0.2) q.stage = pick(stages);
      if (rand() < 0.3) q.hiring = pick(['yes', 'no', 'maybe']);
      if (rand() < 0.2) q.taskGate = pick(['yes', 'no']);
      const expected = legacyFilter(f.rows, q).map((r) => r.id);
      const got = Array.from(select(snap, readFilters(q)), (n) => snap.records[n].id);
      expect(got, JSON.stringify(q)).toEqual(expected);
      if (expected.length) nonEmpty += 1;
    }
    expect(nonEmpty).toBeGreaterThan(100); // the questions were not all empty
  });

  it('an empty question is everyone, and an empty value is no filter at all', async () => {
    const f = await fixture(80);
    const snap = await f.catalog.snapshot();
    expect(select(snap, readFilters({})).length).toBe(80);
    expect(select(snap, readFilters({ sector: '', city: '', search: '' })).length).toBe(80);
  });

  it('reads a repeated parameter the way the old route did: as one string joined with commas', async () => {
    const f = await fixture(200);
    const snap = await f.catalog.snapshot();
    const twoSectors = [f.rows[0].sector, f.rows[1].sector];
    const got = Array.from(select(snap, readFilters({ sector: twoSectors })), (n) => snap.records[n].id);
    expect(got).toEqual(legacyFilter(f.rows, { sector: twoSectors }).map((r) => r.id));
  });
});

describe('ordering and pages', () => {
  it('has the four list orders the page used to sort into, and a company\'s own place breaks any tie', async () => {
    const f = await fixture(700);
    const snap = await f.catalog.snapshot();
    for (const [name, compare] of Object.entries(OLD_SORTS)) {
      const expected = [...snap.records].sort(compare).map((r) => r.id);
      expect(Array.from(snap.orders[name], (n) => snap.records[n].id), name).toEqual(expected);
    }
  });

  it('serves a result page by page in any order, and the pages add up to the whole result', async () => {
    const f = await fixture(500);
    const snap = await f.catalog.snapshot();
    const matched = select(snap, readFilters({ hiring: 'yes' }));
    for (const sort of ['file', 'name', 'hiring', 'location', 'industry']) {
      const ids = [];
      for (let offset = 0; offset < matched.length; offset += 37) ids.push(...Array.from(pageOf(snap, matched, { sort, offset, limit: 37 }), (n) => snap.records[n].id));
      const whole = legacyFilter(f.rows, { hiring: 'yes' });
      const expected = sort === 'file' ? whole : [...whole].sort(OLD_SORTS[sort]);
      expect(ids, sort).toEqual(expected.map((r) => r.id));
    }
    expect(pageOf(snap, matched, { sort: 'name', offset: matched.length + 5, limit: 10 })).toHaveLength(0);
  });

  it('answers an unfiltered page of a sorted list without building anything: it is a slice of the order', async () => {
    const f = await fixture(300);
    const snap = await f.catalog.snapshot();
    const all = select(snap, {});
    expect(pageOf(snap, all, { sort: 'name', offset: 10, limit: 5 }).buffer).toBe(snap.orders.name.buffer);
  });
});

describe('facets, summary, markers', () => {
  it('counts the values among the matches, most first, and only values that exist', async () => {
    const f = await fixture(600);
    const snap = await f.catalog.snapshot();
    const matched = select(snap, readFilters({ hiring: 'yes' }));
    const out = facets(snap, matched, ['sector', 'city', 'stage', 'investor']);
    const hiring = f.rows.filter((r) => r.hiring);
    for (const [facet, valuesOf] of [['sector', (r) => [r.sector]], ['city', (r) => [r.city]], ['stage', (r) => [r.stage]], ['investor', (r) => r.investors]]) {
      const naive = new Map();
      for (const r of hiring) for (const v of valuesOf(r)) naive.set(v, (naive.get(v) ?? 0) + 1);
      expect(out[facet].distinct, facet).toBe(naive.size);
      expect(out[facet].values.every((x) => naive.get(x.value) === x.count), facet).toBe(true);
      const counts = out[facet].values.map((x) => x.count);
      expect(counts, facet).toEqual([...counts].sort((a, b) => b - a));
    }
  });

  it('summarises a result: how many are pinned, unpinned and hiring, the busiest cities, the oldest companies', async () => {
    const f = await fixture(400);
    const rows = f.rows.map((r, i) => ({ ...r, ...(i % 10 === 0 ? { foundedYear: 2000 + (i % 25) } : {}), ...(i % 50 === 0 ? { vouches: Array.from({ length: 1 + (i % 7) }, (_, k) => `v${k}`) } : {}) }));
    await f.rewrite(rows);
    const snap = await f.catalog.refresh();
    const s = summary(snap, select(snap, {}));
    expect(s.count).toBe(400);
    expect(s.pinned).toBe(rows.filter((r) => r.verified).length);
    expect(s.unverified).toBe(rows.filter((r) => !r.verified).length);
    expect(s.hiring).toBe(rows.filter((r) => r.hiring).length);
    expect(s.topCities).toHaveLength(8);
    expect(s.topCities[0].city).toBe('Sydney');
    const years = s.notable.items.map((x) => x.foundedYear);
    expect(years).toEqual([...years].sort((a, b) => a - b));
    expect(s.notable.total).toBe(rows.filter((r) => r.foundedYear).length);
    expect(s.vouched.items.map((x) => x.vouches)).toEqual([...s.vouched.items.map((x) => x.vouches)].sort((a, b) => b - a));
    expect(s.vouched.total).toBe(rows.filter((r) => r.vouches?.length).length);
  });

  it('gives the map one compact tuple per company whose location is a point, and none for the rest', async () => {
    const f = await fixture(500);
    const snap = await f.catalog.snapshot();
    const items = markers(snap, select(snap, {}));
    const pinned = f.rows.filter((r) => ['EXACT', 'SUBURB'].includes(r.location_precision));
    expect(items).toHaveLength(pinned.length);
    expect(pinned.length).toBeLessThan(f.rows.filter((r) => r.verified).length); // some are known only to their city
    expect(MARKER_FIELDS).toEqual(['slug', 'name', 'lat', 'lng', 'sector', 'city', 'hiring', 'domain', 'precision', 'place', 'checked']);
    expect(items[0]).toHaveLength(MARKER_FIELDS.length);
    const first = pinned[0];
    const [slug, name, lat, lng, sector, city, hiring, domain, precision, place, checked] = items[0];
    expect([slug, name, lat, lng, sector, city, hiring]).toEqual([first.slug, first.name, first.lat, first.lng, first.sector, first.city, first.hiring ? 1 : 0]);
    expect(domain).toBe(first.website ? first.website.replace(/^https:\/\/www\./, '') : '');
    expect(precision).toBe(first.location_precision);
    expect(place).toContain(first.suburb);
    expect(checked).toBe(first.location_verified_at ? 1 : 0);
    expect(items.every((m) => Number.isFinite(m[2]) && Number.isFinite(m[3]))).toBe(true);
    // narrowed by the same filters as the list
    expect(markers(snap, select(snap, readFilters({ hiring: 'yes' }))).length).toBe(pinned.filter((r) => r.hiring).length);
  });

  it('leaves a company off the map unless it is a confirmed point: a confirmation without coordinates, or coordinates without one, is not a pin', async () => {
    const f = await fixture(10);
    const rows = f.rows.map((r) => ({ ...r, verified: false, location_precision: 'UNKNOWN', lat: null, lng: null }));
    rows[0] = { ...rows[0], verified: true, location_precision: 'EXACT', lat: null, lng: null }; // an office, but nowhere to put it
    rows[1] = { ...rows[1], verified: false, lat: -33.8, lng: 151.2 }; // a place, but not confirmed
    rows[2] = { ...rows[2], verified: true, location_precision: 'EXACT', lat: -33.9, lng: 151.1 };
    rows[3] = { ...rows[3], verified: true, location_precision: 'CITY', lat: -33.9, lng: 151.1 }; // known to its city: whatever coordinates it carries, it is not a pin
    await f.rewrite(rows);
    const snap = await f.catalog.refresh();
    expect(markers(snap, select(snap, {})).map((m) => m[0])).toEqual([rows[2].slug]);
  });

  it('keeps a card to what a list shows, far smaller than the whole record, and never anything internal', async () => {
    const f = await fixture(50);
    const snap = await f.catalog.snapshot();
    for (const card of snap.cards) {
      expect(Object.keys(card).every((k) => CARD_FIELDS.includes(k))).toBe(true);
      for (const key of INTERNAL_FIELDS) expect(card).not.toHaveProperty(key);
    }
    expect(JSON.stringify(snap.cards[0]).length).toBeLessThan(JSON.stringify(snap.records[0]).length / 2);
  });
});

describe('suggestions for the search box', () => {
  it('puts a name that starts with the text first, then a word that does, then one that contains it', async () => {
    const f = await fixture(1000);
    const snap = await f.catalog.snapshot();
    const target = f.rows[123].name;
    const first = target.split(' ')[0];
    const out = suggest(snap, first.slice(0, 4).toUpperCase());
    expect(out.companies.length).toBeGreaterThan(0);
    expect(out.companies.length).toBeLessThanOrEqual(5);
    expect(out.companies.every((c) => c.name.toLowerCase().startsWith(first.slice(0, 4).toLowerCase()))).toBe(true);
    // a text only the second word starts: found, after any that start with it
    const second = target.split(' ')[1].slice(0, 4);
    const byWord = suggest(snap, second);
    expect(byWord.companies.length).toBeGreaterThan(0);
    expect(byWord.companies.some((c) => c.name.toLowerCase().includes(` ${second.toLowerCase()}`) || c.name.toLowerCase().startsWith(second.toLowerCase()))).toBe(true);
    expect(suggest(snap, 'a', { limit: 3 }).companies).toHaveLength(3);
  });

  it('finds founders, investors, industries and locations that contain the text, up to the limit', async () => {
    const f = await fixture(800);
    const snap = await f.catalog.snapshot();
    const founder = f.rows.find((r) => r.founders?.length).founders[0];
    const people = suggest(snap, founder.toLowerCase().slice(0, 5)).people;
    expect(people.some((p) => p.name === founder)).toBe(true);
    expect(suggest(snap, 'capital').investors.every((i) => i.toLowerCase().includes('capital'))).toBe(true);
    expect(suggest(snap, 'fin').industries).toContain('Fintech');
    expect(suggest(snap, 'syd').locations).toContain('Sydney');
    expect(suggest(snap, 'e', { limit: 2 }).investors.length).toBeLessThanOrEqual(2);
  });

  it('says nothing for empty text', async () => {
    const f = await fixture(20);
    const snap = await f.catalog.snapshot();
    expect(suggest(snap, '   ')).toEqual({ companies: [], people: [], investors: [], industries: [], locations: [] });
  });
});

describe('finding one company', () => {
  it('by slug or by id, and not at all when there is none', async () => {
    const f = await fixture(30);
    const snap = await f.catalog.snapshot();
    expect(recordFor(snap, f.rows[3].slug).name).toBe(f.rows[3].name);
    expect(recordFor(snap, f.rows[3].id).name).toBe(f.rows[3].name);
    expect(recordFor(snap, 'nobody-here')).toBeNull();
    for (const key of INTERNAL_FIELDS) expect(recordFor(snap, f.rows[3].slug)).not.toHaveProperty(key);
  });
});

describe('loading the file', () => {
  it('builds once for many callers at once, and again only when the file has changed', async () => {
    const f = await fixture(40);
    const catalog = createCatalog({ file: f.file, reloadMs: 0 });
    const [a, b, c] = await Promise.all([catalog.snapshot(), catalog.snapshot(), catalog.snapshot()]);
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(await catalog.refresh()).toBe(a); // nothing changed: the same snapshot, not a rebuild
    await f.rewrite(generateCompanies(55));
    const next = await catalog.refresh();
    expect(next).not.toBe(a);
    expect(next.count).toBe(55);
    expect(next.version).not.toBe(a.version);
  });

  it('keeps answering from the last good snapshot when a reload fails', async () => {
    const f = await fixture(40);
    const catalog = createCatalog({ file: f.file, reloadMs: 0 });
    const before = await catalog.snapshot();
    await writeFile(f.file, '{ this is not json');
    const during = await catalog.snapshot(); // starts the reload, which fails, and still answers
    await new Promise((r) => setTimeout(r, 30));
    const after = await catalog.snapshot();
    expect(during).toBe(before);
    expect(after).toBe(before);
  });

  it('reports a file that is not there, on the first request and not by crashing the server', async () => {
    const dir = await tempDir();
    const catalog = createCatalog({ file: path.join(dir, 'missing.json') });
    await expect(catalog.snapshot()).rejects.toThrow(/ENOENT/);
  });

  it('indexes 10,000 companies fast enough to start in well under a second on this machine', () => {
    const raw = JSON.stringify(generateCompanies(10000));
    const t0 = performance.now();
    const snap = buildSnapshot(raw, 'test');
    const ms = performance.now() - t0;
    expect(snap.count).toBe(10000);
    expect(ms).toBeLessThan(2500); // measured near 330 ms; the margin is for a loaded machine, and the old typed-array sort took 4.9 s
  });
});

// "Hiring" is public only for a company whose open roles a page showed; a flag no page backs is never counted, drawn or sorted as hiring.
describe('hiring is counted only where a page backs it', () => {
  const CHECKED = '2026-10-05T15:00:00.000Z';
  // Twelve companies: the first three are flagged as hiring with a check behind it, the next three are flagged and no page backs it.
  const rows = generateCompanies(12).map((r, i) => ({
    ...r, hiring: i < 6, hiring_status: i < 6 ? 'hiring' : null, hiring_verified_at: i < 3 ? CHECKED : null, verified: true,
    location_precision: 'EXACT', lat: -33.87 + i / 100, lng: 151.2,
  }));
  const snap = buildSnapshot(JSON.stringify(rows), 'v1');
  const all = select(snap, {});

  it('filters hiring=yes to the checked ones, and hiring=no to everyone else, the flagged-but-unchecked included', () => {
    expect(select(snap, readFilters({ hiring: 'yes' }))).toHaveLength(3);
    expect(select(snap, readFilters({ hiring: 'no' }))).toHaveLength(9);
  });

  it('counts only the checked ones as hiring in a summary, and draws only them with the hiring mark on the map', () => {
    expect(summary(snap, all).hiring).toBe(3);
    const marks = markers(snap, all).map((m) => m[6]);
    expect(marks.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('says on a card which kind it is: hiring, flagged but unchecked, or neither', () => {
    const cards = snap.cards;
    expect(cards.slice(0, 3).every((c) => c.hiring === true && !('rolesUnverified' in c))).toBe(true);
    expect(cards.slice(3, 6).every((c) => c.hiring === false && c.rolesUnverified === true)).toBe(true);
    expect(cards.slice(6).every((c) => c.hiring === false && !('rolesUnverified' in c))).toBe(true);
  });

  it('puts the checked ones first when sorted by hiring, and says when it was checked on the full record', () => {
    const order = Array.from(pageOf(snap, all, { sort: 'hiring', limit: 12 }), (n) => snap.records[n].hiring);
    expect(order.slice(0, 3)).toEqual([true, true, true]);
    expect(order.slice(3).some(Boolean)).toBe(false);
    expect(recordFor(snap, rows[0].slug)).toMatchObject({ hiring: true, hiring_verified_at: CHECKED });
    expect(recordFor(snap, rows[4].slug)).toMatchObject({ hiring: false, rolesUnverified: true, hiring_status: null });
  });
});

// The yes/no columns (hiring, taskGate, verified) are indexed like the others, so "hiring now" or "not yet confirmed" starts from the
// companies that are, not from all of them. explain() says which index a question starts from and how many companies it looks at.
describe('the yes/no columns are indexed', () => {
  const rows = generateCompanies(900, { seed: 5 });
  const snap = buildSnapshot(JSON.stringify(rows), 'v1');
  const truth = {
    hiring: (r) => !!r.hiring, taskGate: (r) => !!r.taskGate?.enabled, verified: (r) => !!r.verified,
  };
  const ask = (q) => Array.from(select(snap, readFilters(q)), (n) => snap.records[n].id);
  const brute = (q, extra = () => true) => snap.records.filter((r) => extra(r)
    && Object.entries(truth).every(([col, on]) => q[col] === undefined || q[col] === 'maybe' || (q[col] === 'yes') === on(r))).map((r) => r.id);

  it('keeps an index of each answer that agrees with the column, in ascending order', () => {
    for (const [column, on] of Object.entries(truth)) {
      const yes = snap.idx[column].get('yes') ?? [];
      const no = snap.idx[column].get('no') ?? [];
      expect(yes.length + no.length, column).toBe(snap.count);
      expect(Array.from(yes).every((n) => on(snap.records[n])), column).toBe(true);
      expect(Array.from(no).some((n) => on(snap.records[n])), column).toBe(false);
      expect(Array.from(yes), column).toEqual(Array.from(yes).sort((a, b) => a - b));
    }
    expect(snap.idx.hiring.get('yes').length).toBeGreaterThan(0);
    expect(snap.idx.verified.get('no').length).toBeGreaterThan(0);
    expect(snap.idx.taskGate.get('yes').length).toBeGreaterThan(0);
  });

  it('answers every combination of the three as checking each company does, in the same order', () => {
    const answers = [undefined, 'yes', 'no', 'maybe'];
    let nonEmpty = 0;
    for (const hiring of answers) for (const taskGate of answers) for (const verified of answers) {
      const q = {};
      if (hiring) q.hiring = hiring;
      if (taskGate) q.taskGate = taskGate;
      if (verified) q.verified = verified;
      expect(ask(q), JSON.stringify(q)).toEqual(brute(q));
      if (brute(q).length) nonEmpty += 1;
    }
    expect(nonEmpty).toBeGreaterThan(30);
  });

  it('answers them together with the other filters the same way', () => {
    const sector = snap.records[3].sector;
    const city = snap.records[5].city;
    for (const q of [{ hiring: 'yes', sector }, { verified: 'no', city }, { taskGate: 'yes', hiring: 'no', sector }, { verified: 'yes', search: 'a' }]) {
      const search = q.search?.toLowerCase();
      const extra = (r) => (!q.sector || r.sector === q.sector) && (!q.city || r.city === q.city)
        && (!search || r.name.toLowerCase().includes(search) || (r.founders || []).some((f) => f.toLowerCase().includes(search)));
      expect(ask(q), JSON.stringify(q)).toEqual(brute(q, extra));
    }
  });

  it('starts from the shorter list, and looks at only those companies', () => {
    const notVerified = snap.idx.verified.get('no').length;
    expect(explain(snap, readFilters({ verified: 'no' }))).toEqual({ using: 'verified', examined: notVerified, matched: notVerified });
    expect(notVerified).toBeLessThan(snap.count / 4);
    const hiring = explain(snap, readFilters({ hiring: 'yes' }));
    expect(hiring.using).toBe('hiring');
    expect(hiring.examined).toBe(hiring.matched);
    const both = explain(snap, readFilters({ hiring: 'yes', verified: 'no' }));
    expect(both.examined).toBe(Math.min(hiring.examined, notVerified)); // the shorter of the two
    expect(both.matched).toBe(ask({ hiring: 'yes', verified: 'no' }).length);
  });

  it('says a search is checked company by company, and that an unknown answer is not a filter', () => {
    expect(explain(snap, readFilters({ search: 'ab' }))).toMatchObject({ using: 'scan', examined: snap.count });
    expect(explain(snap, readFilters({ hiring: 'maybe' }))).toMatchObject({ using: 'scan', examined: snap.count, matched: snap.count });
    expect(explain(snap, {})).toEqual({ using: 'the whole list', examined: 0, matched: snap.count });
  });
});

// Two more orders: by the stage a company has reached, and by when a page last checked its facts.
describe('ordering by stage and by when a company was last checked', () => {
  const named = (name, over) => ({ ...generateCompanies(1)[0], name, id: name.toLowerCase().replace(/\s+/g, '-'), slug: name.toLowerCase().replace(/\s+/g, '-'), ...over });
  const rows = [
    named('Zed', { stage: 'Series B', last_verified_at: '2026-10-01T00:00:00.000Z' }),
    named('Amy', { stage: 'Unknown', last_verified_at: '2026-10-09T00:00:00.000Z' }),
    named('Bob', { stage: 'Seed', last_verified_at: null }),
    named('Cat', { stage: 'Pre-seed', last_verified_at: '2026-10-05T00:00:00.000Z' }),
    named('Dan', { stage: 'Unicorn', last_verified_at: '2026-10-05T00:00:00.000Z' }),
    named('Eve', { stage: 'A Brand New Stage', last_verified_at: undefined }),
    named('Fay', { stage: 'Seed', last_verified_at: 'not a date' }),
    named('Gus', { stage: 'Series A', last_verified_at: '2026-10-09T00:00:00.000Z' }),
  ];
  const snap = buildSnapshot(JSON.stringify(rows), 'v1');
  const all = select(snap, {});
  const names = (sort) => Array.from(pageOf(snap, all, { sort }), (n) => snap.records[n].name);

  it('is one of the orders the API accepts', () => {
    expect(SORTS).toEqual(expect.arrayContaining(['stage', 'verified']));
  });

  it('puts the earliest stage first, a stage it does not know after the ones it does, and "Unknown" last; a tie is broken by name', () => {
    expect(names('stage')).toEqual(['Cat', 'Bob', 'Fay', 'Gus', 'Zed', 'Dan', 'Eve', 'Amy']);
  });

  it('ranks every stage the directory has in the order a company moves through them', () => {
    const ranks = ['Pre-seed', 'Seed', 'Series A', 'Series B', 'Series C', 'Growth', 'Unicorn'].map(stageRank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(new Set(STAGE_ORDER).size).toBe(STAGE_ORDER.length);
    expect(stageRank('Something New')).toBeGreaterThan(stageRank('Other Equity'));
    expect(stageRank('Unknown')).toBeGreaterThan(stageRank('Something New'));
    expect(stageRank(undefined)).toBe(stageRank('Unknown'));
  });

  it('puts the most recently checked first, and a company never checked (or with a date that is not one) last, by name', () => {
    expect(names('verified')).toEqual(['Amy', 'Gus', 'Cat', 'Dan', 'Zed', 'Bob', 'Eve', 'Fay']);
  });

  it('serves the date it sorts by, on the record and on the card: the site says "Verified 3 days ago"', () => {
    expect(snap.records.find((r) => r.name === 'Amy').last_verified_at).toBe('2026-10-09T00:00:00.000Z');
    expect(snap.cards.find((c) => c.name === 'Amy').last_verified_at).toBe('2026-10-09T00:00:00.000Z');
  });
});

describe('the latest check and the events this week', () => {
  const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  const named = (name, over) => ({ ...generateCompanies(1)[0], name, id: name.toLowerCase(), slug: name.toLowerCase(), events: undefined, ...over });
  const rows = [
    named('Soon', { events: [{ title: 'Demo day', date: day(3), url: 'https://example.com/e' }], last_verified_at: '2026-10-01T00:00:00.000Z' }),
    named('Later', { events: [{ title: 'Summit', date: day(40), url: null }], last_verified_at: '2026-10-09T10:00:00.000Z' }),
    named('Past', { events: [{ title: 'Meetup', date: day(-2), url: null }], last_verified_at: null }),
    named('None', {}),
  ];
  const snap = buildSnapshot(JSON.stringify(rows), 'v1');

  it('says when the most recent check was, or null when none was made', () => {
    expect(summary(snap, select(snap, {})).lastVerifiedAt).toBe('2026-10-09T10:00:00.000Z');
    expect(summary(snap, select(snap, { search: 'none' })).lastVerifiedAt).toBeNull();
  });

  it('keeps only the companies with an event in the next 14 days, and reads the filter from a query', () => {
    const f = readFilters({ events: 'week' });
    expect(f).toEqual({ events: 'week' });
    expect(Array.from(select(snap, f), (n) => snap.records[n].name)).toEqual(['Soon']);
  });

  it('puts events on a card only when the company has some', () => {
    expect(snap.cards.find((c) => c.name === 'Soon').events).toHaveLength(1);
    expect(snap.cards.find((c) => c.name === 'None')).not.toHaveProperty('events');
  });
});
