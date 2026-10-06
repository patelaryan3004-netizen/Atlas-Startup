import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { fixture, removeTempDirs } from './helpers/catalog.js';
import { CARD_FIELDS, MARKER_FIELDS } from '../src/catalog/catalog.js';
import { INTERNAL_FIELDS } from '../src/models/company.js';

afterEach(removeTempDirs);

const byName = (a, b) => a.name.localeCompare(b.name);
const uniqueSorted = (list) => [...new Set(list)].sort();

describe('GET /api/startups, one page at a time', () => {
  it('gives a page of cards in the order asked for, with how many there are and whether there is more', async () => {
    const f = await fixture(300);
    const res = await request(f.app).get('/api/startups?limit=10&offset=5&sort=name&view=card');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 300, count: 300, offset: 5, limit: 10, hasMore: true });
    expect(res.body.results.map((r) => r.name)).toEqual([...f.rows].sort(byName).slice(5, 15).map((r) => r.name));
    for (const card of res.body.results) {
      expect(Object.keys(card).every((k) => CARD_FIELDS.includes(k))).toBe(true);
      expect(card.slug).toEqual(expect.any(String));
    }
  });

  it('says there is no more on the last page, and gives nothing past it', async () => {
    const f = await fixture(300);
    const last = await request(f.app).get('/api/startups?limit=10&offset=295&view=card');
    expect(last.body.results).toHaveLength(5);
    expect(last.body.hasMore).toBe(false);
    expect((await request(f.app).get('/api/startups?limit=10&offset=500')).body.results).toEqual([]);
  });

  it('uses a page of 48 when only an offset is given, and the full record unless a card is asked for', async () => {
    const f = await fixture(300);
    const res = await request(f.app).get('/api/startups?offset=0');
    expect(res.body.limit).toBe(48);
    expect(res.body.results).toHaveLength(48);
    const withAddress = res.body.results.find((r) => r.address);
    expect(withAddress).toBeDefined();
    expect(res.body.results[0]).toHaveProperty('founder_ids');
  });

  it('pages a filtered result: the count is the matches, and every row on the page matches', async () => {
    const f = await fixture(400);
    const res = await request(f.app).get('/api/startups?hiring=yes&limit=20&view=card');
    const hiring = f.rows.filter((r) => r.hiring);
    expect(res.body.count).toBe(hiring.length);
    expect(res.body.total).toBe(400);
    expect(res.body.results.every((r) => r.hiring === true)).toBe(true);
    const unverified = await request(f.app).get('/api/startups?verified=no&limit=200&view=card');
    expect(unverified.body.count).toBe(f.rows.filter((r) => !r.verified).length);
    expect(unverified.body.results.every((r) => r.verified === false)).toBe(true);
  });

  it('counts the values among the matches when asked, so a filter shows only options that exist', async () => {
    const f = await fixture(500);
    const res = await request(f.app).get('/api/startups?hiring=yes&limit=1&facets=sector,city&view=card');
    const hiring = f.rows.filter((r) => r.hiring);
    const top = (key) => { const m = new Map(); for (const r of hiring) m.set(r[key], (m.get(r[key]) ?? 0) + 1); return Math.max(...m.values()); };
    expect(res.body.facets.sector.values[0].count).toBe(top('sector'));
    expect(res.body.facets.city.values[0].count).toBe(top('city'));
    expect(res.body.facets.stage).toBeUndefined();
  });

  it('looks companies up by name, for a list the visitor keeps: name may repeat', async () => {
    const f = await fixture(200);
    const [a, b] = [f.rows[10].name, f.rows[150].name];
    const res = await request(f.app).get(`/api/startups?name=${encodeURIComponent(a)}&name=${encodeURIComponent(b)}&limit=50&view=card`);
    expect(res.body.results.map((r) => r.name).sort()).toEqual([a, b].sort());
    expect((await request(f.app).get('/api/startups?name=No%20Such%20Company&limit=5')).body.count).toBe(0);
  });
});

describe('GET /api/startups with no paging, as it always answered', () => {
  it('is { total, count, results } with every match in full and in file order, and nothing about paging', async () => {
    const f = await fixture(300);
    const res = await request(f.app).get('/api/startups');
    expect(Object.keys(res.body).sort()).toEqual(['count', 'results', 'total']);
    expect(res.body.results.map((r) => r.id)).toEqual(f.rows.map((r) => r.id));
    for (const r of res.body.results) for (const key of INTERNAL_FIELDS) expect(r).not.toHaveProperty(key);
    const filtered = await request(f.app).get('/api/startups?sector=Fintech&city=Sydney');
    expect(filtered.body.results.map((r) => r.id)).toEqual(f.rows.filter((r) => r.sector === 'Fintech' && r.city === 'Sydney').map((r) => r.id));
  });

  it('answers a sort without paging by sorting the whole result', async () => {
    const f = await fixture(120);
    const res = await request(f.app).get('/api/startups?sort=name');
    expect(res.body.results.map((r) => r.name)).toEqual([...f.rows].sort(byName).map((r) => r.name));
  });
});

describe('what the page needs besides a page', () => {
  it('gives the filter options, as sorted lists of what exists', async () => {
    const f = await fixture(300);
    const res = await request(f.app).get('/api/startups/meta');
    expect(res.body).toEqual({
      sectors: uniqueSorted(f.rows.map((r) => r.sector)), cities: uniqueSorted(f.rows.map((r) => r.city)),
      investors: uniqueSorted(f.rows.flatMap((r) => r.investors)), stages: uniqueSorted(f.rows.map((r) => r.stage)),
    });
  });

  it('gives counts and short lists about a result without sending it', async () => {
    const f = await fixture(300);
    const res = await request(f.app).get('/api/startups/summary?hiring=yes');
    const hiring = f.rows.filter((r) => r.hiring);
    expect(res.body).toMatchObject({ total: 300, count: hiring.length, hiring: hiring.length, pinned: hiring.filter((r) => r.verified).length });
    expect(res.body.topCities.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.body).length).toBeLessThan(20000);
  });

  it('gives the map compact pins, only for companies with a confirmed location, narrowed by the same filters', async () => {
    const f = await fixture(300);
    const res = await request(f.app).get('/api/startups/markers?hiring=yes');
    const pinned = f.rows.filter((r) => r.hiring && r.verified);
    expect(res.body).toMatchObject({ total: 300, count: f.rows.filter((r) => r.hiring).length, pinned: pinned.length, fields: MARKER_FIELDS });
    expect(res.body.items).toHaveLength(pinned.length);
    expect(res.body.items.every((m) => m.length === MARKER_FIELDS.length)).toBe(true);
    expect(JSON.stringify(res.body.items[0])).not.toMatch(/founders|investors|blurb|address/);
  });

  it('gives one company in full by slug, and says so plainly when there is none', async () => {
    const f = await fixture(100);
    const target = f.rows[42];
    const res = await request(f.app).get(`/api/startups/${target.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe(target.name);
    expect(res.body.founders).toEqual(target.founders);
    for (const key of INTERNAL_FIELDS) expect(res.body).not.toHaveProperty(key);
    const missing = await request(f.app).get('/api/startups/no-such-company');
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: 'Startup not found' });
    // the fixed words are not taken for a company
    expect((await request(f.app).get('/api/startups/meta')).body.sectors).toBeDefined();
    expect((await request(f.app).get('/api/startups/markers')).body.items).toBeDefined();
  });

  it('suggests for the search box, and finds the companies a founder is named on', async () => {
    const f = await fixture(400);
    const company = f.rows.find((r) => r.founders?.length);
    const person = company.founders[0];
    const s = await request(f.app).get(`/api/search?q=${encodeURIComponent(company.name.slice(0, 5))}`);
    expect(s.body.companies.length).toBeGreaterThan(0);
    expect(Object.keys(s.body).sort()).toEqual(['companies', 'industries', 'investors', 'locations', 'people']);
    const p = await request(f.app).get(`/api/people/${encodeURIComponent(person)}`);
    expect(p.body.name).toBe(person);
    expect(p.body.companies.map((c) => c.name)).toContain(company.name);
    expect(p.body.companies.every((c) => c.founders.includes(person))).toBe(true);
    expect((await request(f.app).get('/api/people/Nobody%20At%20All')).body).toEqual({ name: 'Nobody At All', companies: [] });
  });
});

describe('questions that cannot be answered', () => {
  it.each([
    ['limit=0', /limit must be a whole number from 1 to 200/], ['limit=201', /limit must be/], ['limit=abc', /limit must be/], ['limit=1.5', /limit must be/],
    ['offset=-1', /offset must be/], ['sort=price', /sort must be one of file, name, hiring, location, industry/], ['view=huge', /view must be card or full/],
    ['facets=color', /facets must be from sector, city, stage, investor/], ['limit=5&facets=sector,color', /facets must be from/],
  ])('say what is wrong, with a 400 that is not kept: %s', async (query, message) => {
    const f = await fixture(40);
    const before = f.app.locals.respond.stats().entries;
    const res = await request(f.app).get(`/api/startups?${query}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(f.app.locals.respond.stats().entries).toBe(before);
  });

  it('refuse a search limit out of range', async () => {
    const f = await fixture(40);
    for (const limit of ['0', '11', 'x']) expect((await request(f.app).get(`/api/search?q=a&limit=${limit}`)).status).toBe(400);
  });
});

describe('answering cheaply', () => {
  it('tells a client it already has the answer, before working it out, and gives a new tag when the data changes', async () => {
    const f = await fixture(200);
    const first = await request(f.app).get('/api/startups?limit=20&view=card');
    expect(first.headers.etag).toMatch(/^W\//);
    expect(first.headers['cache-control']).toBe('public, max-age=60, stale-while-revalidate=600');
    expect(first.headers.vary).toMatch(/Accept-Encoding/);
    const same = await request(f.app).get('/api/startups?limit=20&view=card').set('If-None-Match', first.headers.etag);
    expect(same.status).toBe(304);
    expect(same.text).toBe('');
    const other = await request(f.app).get('/api/startups?limit=21&view=card');
    expect(other.headers.etag).not.toBe(first.headers.etag);

    await f.rewrite(f.rows.slice(0, 150));
    await f.catalog.refresh();
    const changed = await request(f.app).get('/api/startups?limit=20&view=card').set('If-None-Match', first.headers.etag);
    expect(changed.status).toBe(200); // the old tag no longer matches: the data is not what it was
    expect(changed.body.total).toBe(150);
    expect(changed.headers.etag).not.toBe(first.headers.etag);
  });

  it('compresses what is worth compressing, to the same answer, and leaves a small one alone', async () => {
    const f = await fixture(300);
    const gz = await request(f.app).get('/api/startups').set('Accept-Encoding', 'gzip');
    const plain = await request(f.app).get('/api/startups').set('Accept-Encoding', 'identity');
    expect(gz.headers['content-encoding']).toBe('gzip');
    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(Number(gz.headers['content-length'])).toBeLessThan(Number(plain.headers['content-length']) / 4);
    expect(gz.body).toEqual(plain.body);
    const small = await request(f.app).get('/api/search?q=zzzzzz').set('Accept-Encoding', 'gzip');
    expect(small.headers['content-encoding']).toBeUndefined();
  });

  it('keeps one answer per question: a parameter the API ignores is not a different question', async () => {
    const f = await fixture(100);
    const a = await request(f.app).get('/api/startups?limit=5&view=card');
    const entries = f.app.locals.respond.stats().entries;
    const b = await request(f.app).get('/api/startups?limit=5&view=card&_=12345&utm_source=x');
    const c = await request(f.app).get('/api/startups?view=card&limit=5');
    expect(f.app.locals.respond.stats().entries).toBe(entries);
    expect(b.headers.etag).toBe(a.headers.etag);
    expect(c.headers.etag).toBe(a.headers.etag);
  });

  it('keeps no more than it is allowed to, and still answers every question correctly', async () => {
    const f = await fixture(200, { cache: { maxEntries: 3 } });
    for (let i = 0; i < 12; i += 1) {
      const res = await request(f.app).get(`/api/startups?limit=${i + 1}&view=card`);
      expect(res.body.results).toHaveLength(i + 1);
    }
    expect(f.app.locals.respond.stats().entries).toBeLessThanOrEqual(3);
  });

  it('can answer with nothing kept at all, which is how the benchmark measures the work behind a miss', async () => {
    const f = await fixture(60, { cache: { maxEntries: 0 } });
    expect((await request(f.app).get('/api/startups?limit=5')).body.results).toHaveLength(5);
    expect(f.app.locals.respond.stats().entries).toBe(0);
  });
});

describe('GET /directory, a page at a time', () => {
  it('lists 250 companies a page by name, with links to the neighbouring pages', async () => {
    const f = await fixture(600);
    const one = await request(f.app).get('/directory');
    expect(one.status).toBe(200);
    expect(one.headers['content-type']).toMatch(/text\/html/);
    expect(one.text).toContain('(600 companies)');
    expect(one.text).toContain('Page 1 of 3');
    expect(one.text).toContain('<link rel="next" href="/directory?page=2">');
    expect(one.text).not.toContain('rel="prev"');
    expect((one.text.match(/<tr>/g) ?? []).length).toBe(251); // the header row and 250 companies
    const two = await request(f.app).get('/directory?page=2');
    expect(two.text).toContain('<link rel="prev" href="/directory">');
    expect(two.text).toContain('<link rel="next" href="/directory?page=3">');
    const three = await request(f.app).get('/directory?page=3');
    expect((three.text.match(/<tr>/g) ?? []).length).toBe(101);
    expect(three.text).toContain('<link rel="prev" href="/directory?page=2">');
    expect(three.text).not.toContain('rel="next"');
    const names = [...f.rows].sort(byName).map((r) => r.name);
    expect(one.text.indexOf(names[0])).toBeGreaterThan(-1);
    expect(three.text.indexOf(names[599])).toBeGreaterThan(-1);
    expect(one.text.indexOf(names[599])).toBe(-1);
  });

  it('is one page with no navigation while the directory is small, and says no to a page that does not exist', async () => {
    const f = await fixture(100);
    const res = await request(f.app).get('/directory');
    expect(res.text).not.toContain('Page 1 of');
    expect(res.text).toContain('(100 companies)');
    expect((await request(f.app).get('/directory?page=2')).status).toBe(404);
    expect((await request(f.app).get('/directory?page=0')).status).toBe(400);
    expect((await request(f.app).get('/directory?page=abc')).status).toBe(400);
  });

  it('escapes what a company is called, so no name can break the page', async () => {
    const f = await fixture(10);
    await f.rewrite(f.rows.map((r, i) => (i === 0 ? { ...r, name: '<b>x</b> & "y"', website: 'https://a.test/?q="1"&z=<2>' } : r)));
    await f.catalog.refresh();
    const res = await request(f.app).get('/directory');
    expect(res.text).toContain('&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;');
    expect(res.text).not.toContain('<b>x</b>');
    expect(res.text).not.toMatch(/<script/i);
  });
});
