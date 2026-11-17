import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRaw, parseRaw, validateDataset } from '../src/models/dataset.js';
import { MATURITIES, toPublic, INTERNAL_FIELDS } from '../src/models/company.js';
import { readFilters, select, markers, areas, suggest, tight, CARD_FIELDS } from '../src/catalog/catalog.js';
import request from 'supertest';
import { fixture } from './helpers/catalog.js';

// The owner's curated list (scripts/curation/curated-list.json, from Still-Early-startups-curated.xlsx): which companies the map draws (show_on_map), how far along each is (maturity: the map's
// Early / Growth filter) and the ones it could not say about (maturity_check). The company's funding `stage` (Seed, Series A) is another thing and is never touched.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'src', 'data');
const list = JSON.parse(readFileSync(path.join(HERE, '..', 'scripts', 'curation', 'curated-list.json'), 'utf8')).rows;

describe('the curated list in the shipped data', () => {
  let ds;
  beforeAll(async () => { ds = parseRaw(await loadRaw(DATA)); });

  it('has a row for every company, and each company says what its row says: shown or left off the map, its maturity, and whether to check it', () => {
    expect(list).toHaveLength(ds.companies.length);
    const byName = new Map(ds.companies.map((c) => [c.name.toLowerCase(), c]));
    for (const row of list) {
      const c = byName.get(row.startup.toLowerCase());
      expect(c, row.startup).toBeTruthy();
      expect(c.show_on_map, row.startup).toBe(row.recommended === 'Pin');
      expect(c.maturity ?? null, row.startup).toBe(row.stage ?? null);
      expect(c.maturity_check ?? null, row.startup).toBe(row.change === 'Check' ? true : null);
    }
  });

  it('keeps the unverified ones on the map, flagged, and nothing else flagged', () => {
    const flagged = ds.companies.filter((c) => c.maturity_check);
    expect(flagged).toHaveLength(24);
    for (const c of flagged) { expect(c.maturity, c.name).toBe('Unverified'); expect(c.show_on_map, c.name).toBe(true); }
    expect(ds.companies.filter((c) => c.maturity === 'Unverified')).toHaveLength(flagged.length);
  });

  it('shows only early and growth companies (and the unverified, for now) and leaves every other kind, and every one with no stage, off the map', () => {
    for (const c of ds.companies.filter((x) => x.show_on_map)) expect(['Early', 'Growth', 'Unverified'], c.name).toContain(c.maturity);
    for (const c of ds.companies.filter((x) => !x.show_on_map)) expect(['Early', 'Growth'], c.name).not.toContain(c.maturity);
    expect(ds.companies.filter((c) => !c.show_on_map).length + ds.companies.filter((c) => c.show_on_map).length).toBe(ds.companies.length); // nobody deleted, nobody undecided
  });

  it('is a valid dataset, and refuses a maturity the list does not know and a show_on_map that is not true or false', () => {
    expect(validateDataset(structuredClone(ds))).toEqual([]);
    const bad = (patch) => { const copy = structuredClone(ds); Object.assign(copy.companies[0], patch); return validateDataset(copy).join('\n'); };
    expect(bad({ maturity: 'Teen' })).toMatch(/maturity must be one of/);
    expect(bad({ show_on_map: 'yes' })).toMatch(/show_on_map must be true or false/);
    expect(bad({ maturity_check: 'yes' })).toMatch(/maturity_check must be true or false/);
    expect(bad({ maturity: 'Growth', show_on_map: false, maturity_check: null })).toBe('');
    expect(MATURITIES).toEqual(['Early', 'Growth', 'Late-stage / mature', 'Listed', 'Global corp', 'Community / coworking', 'Collapsed', 'Unverified']);
  });

  it('serves the maturity on the card and keeps the record-keeping (show_on_map, maturity_check) internal', () => {
    expect(CARD_FIELDS).toContain('maturity');
    expect(CARD_FIELDS).not.toContain('show_on_map');
    const out = toPublic({ id: 'acme', name: 'Acme', maturity: 'Early', show_on_map: false, maturity_check: true });
    expect(out.maturity).toBe('Early');
    expect(out).not.toHaveProperty('show_on_map');
    expect(out).not.toHaveProperty('maturity_check');
    expect([...INTERNAL_FIELDS]).toEqual(expect.arrayContaining(['show_on_map', 'maturity_check']));
  });
});

describe('what the map draws, and the maturity filter', () => {
  async function curated() {
    const f = await fixture(120);
    const pinnable = f.rows.filter((r) => r.verified && ['EXACT', 'SUBURB'].includes(r.location_precision));
    const cityOnly = f.rows.filter((r) => r.verified && r.location_precision === 'CITY');
    expect(pinnable.length).toBeGreaterThan(6);
    expect(cityOnly.length).toBeGreaterThan(2);
    const hiddenPin = pinnable[0]; const shownPin = pinnable[1]; const hiddenCity = cityOnly[0]; const shownCity = cityOnly[1];
    const patch = new Map([
      [hiddenPin.id, { show_on_map: false, maturity: 'Late-stage / mature' }], [shownPin.id, { show_on_map: true, maturity: 'Early' }],
      [hiddenCity.id, { show_on_map: false, maturity: 'Listed' }], [shownCity.id, { show_on_map: true, maturity: 'Growth' }],
      [pinnable[2].id, { show_on_map: true, maturity: 'Growth' }],
    ]);
    await f.rewrite(f.rows.map((r) => (patch.has(r.id) ? { ...r, ...patch.get(r.id) } : r)));
    await f.catalog.refresh();
    const snap = await f.catalog.snapshot();
    return { f, snap, hiddenPin, shownPin, hiddenCity, shownCity, indexOf: (id) => snap.records.findIndex((r) => r.id === id) };
  }

  it('draws no pin and no city group for a company the list leaves off the map, and still lists it, counts it in the directory and finds it in a search', async () => {
    const { snap, hiddenPin, shownPin, hiddenCity, shownCity, indexOf } = await curated();
    expect(snap.markers[indexOf(hiddenPin.id)]).toBeNull();
    expect(snap.markers[indexOf(shownPin.id)]).not.toBeNull();
    expect(snap.areaKey[indexOf(hiddenCity.id)]).toBeNull();
    expect(snap.areaKey[indexOf(shownCity.id)]).not.toBeNull();
    // still in the directory: the list, the count and the search are about every company
    const everyone = select(snap, readFilters({}));
    expect(everyone).toHaveLength(snap.count);
    const found = select(snap, readFilters({ search: hiddenPin.name }));
    expect(Array.from(found, (i) => snap.records[i].id)).toContain(hiddenPin.id);
    // and the map's own answers leave it out
    const onMap = select(snap, readFilters({ onMap: 'yes' }));
    expect(Array.from(onMap, (i) => snap.records[i].id)).not.toContain(hiddenPin.id);
    expect(markers(snap, onMap).map((m) => m[0])).toContain(shownPin.slug ?? shownPin.id);
    expect(markers(snap, everyone).map((m) => m[0])).not.toContain(hiddenPin.slug ?? hiddenPin.id);
    const groups = areas(snap, everyone).items ?? areas(snap, everyone);
    const sample = JSON.stringify(groups);
    expect(sample).not.toContain(hiddenCity.name);
  });

  it('asks only for the companies the map shows with onMap=yes, the others with onMap=no, and everyone with neither; a company never curated is shown', async () => {
    const { snap } = await curated();
    const yes = select(snap, readFilters({ onMap: 'yes' })).length;
    const no = select(snap, readFilters({ onMap: 'no' })).length;
    expect(no).toBe(2);
    expect(yes + no).toBe(snap.count);
    expect(yes).toBe(snap.count - 2); // every company the list says nothing about is shown
  });

  it('filters by maturity (one or several), and offers as options only the maturities of the companies on the map, with how many', async () => {
    const { snap } = await curated();
    expect(select(snap, readFilters({ maturity: 'Early' }))).toHaveLength(1);
    expect(select(snap, readFilters({ maturity: 'Growth' }))).toHaveLength(2);
    expect(select(snap, readFilters({ maturity: 'Early,Growth' }))).toHaveLength(3);
    expect(select(snap, readFilters({ maturity: 'Growth', onMap: 'yes' }))).toHaveLength(2);
    expect(select(snap, readFilters({ maturity: 'Listed', onMap: 'yes' }))).toHaveLength(0); // on the list, off the map
    expect(select(snap, readFilters({ maturity: 'Listed' }))).toHaveLength(1);
    expect(snap.meta.maturities).toEqual([{ value: 'Early', count: 1 }, { value: 'Growth', count: 2 }]); // Late-stage and Listed are left off the map: not offered
  });

  it('answers each maturity and the map-only question differently through the API\'s kept answers (the cache), and offers the options in /meta', async () => {
    const { f } = await curated();
    const ask = async (query) => (await request(f.app).get(`/api/startups?${query}&limit=1&view=card`)).body.count;
    const all = await ask('sort=name');
    expect(await ask('maturity=Early')).toBe(1);
    expect(await ask('maturity=Growth')).toBe(2);
    expect(await ask('onMap=yes')).toBe(all - 2);
    expect(await ask('onMap=no')).toBe(2);
    expect(await ask('sort=name')).toBe(all); // an unfiltered question is not answered with a filtered one
    expect((await request(f.app).get('/api/startups/meta')).body.maturities).toEqual([{ value: 'Early', count: 1 }, { value: 'Growth', count: 2 }]);
    const summary = (await request(f.app).get('/api/startups/summary?onMap=yes')).body;
    expect(summary.count).toBe(all - 2);
    const pins = (await request(f.app).get('/api/startups/markers')).body.items;
    expect(pins.length).toBeLessThan(all);
  });

  it('offers no maturity options until a list has been applied', async () => {
    const f = await fixture(40);
    expect((await f.catalog.snapshot()).meta.maturities).toEqual([]);
  });
});

describe('a search that is not put off by a space or a dot in a name', () => {
  async function named() {
    const f = await fixture(60);
    const names = { 0: 'OwnHome', 1: 'Harrison.ai', 2: 'Cake Equity', 3: 'Sunburnt Space Co' };
    await f.rewrite(f.rows.map((r, i) => (names[i] ? { ...r, name: names[i], founders: [], suburb: null } : r)));
    await f.catalog.refresh();
    return f.catalog.snapshot();
  }
  const find = (snap, q) => Array.from(select(snap, readFilters({ search: q })), (i) => snap.records[i].name);

  it('finds OwnHome by "Own Home", Harrison.ai by "harrison ai", and Cake Equity by "CakeEquity" and "cake-equity", as well as by their own names', async () => {
    const snap = await named();
    for (const q of ['OwnHome', 'own home', 'Own Home', 'ownhome']) expect(find(snap, q), q).toContain('OwnHome');
    for (const q of ['Harrison.ai', 'harrison ai', 'harrison.ai', 'HarrisonAI']) expect(find(snap, q), q).toContain('Harrison.ai');
    for (const q of ['Cake Equity', 'CakeEquity', 'cake-equity']) expect(find(snap, q), q).toContain('Cake Equity');
    expect(find(snap, 'Sunburnt Space Co')).toEqual(['Sunburnt Space Co']);
  });

  it('does not match a short query across the join of two words, and finds nothing for a name that is not there', async () => {
    const snap = await named();
    expect(tight('Own Home')).toBe('ownhome');
    expect(find(snap, 'keeq')).not.toContain('Cake Equity'); // the end of Cake and the start of Equity run together: only five characters or more are matched that way
    expect(find(snap, 'keequ')).toContain('Cake Equity');
    expect(find(snap, 'own hom')).toContain('OwnHome');
    expect(find(snap, 'Own Homes Ltd')).toEqual([]);
  });

  it('suggests them the same way', async () => {
    const snap = await named();
    expect(suggest(snap, 'harrison ai').companies.map((c) => c.name)).toContain('Harrison.ai');
    expect(suggest(snap, 'own home').companies.map((c) => c.name)).toContain('OwnHome');
  });
});
