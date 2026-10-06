import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { buildSnapshot, readFilters, select, summary, markers, areas, AREA_SAMPLE, MARKER_FIELDS, precisionOf } from '../src/catalog/catalog.js';
import { questionKey } from '../src/catalog/respond.js';
import { cityCentre, stateCentre } from '../src/geo/places.js';
import { fixture, removeTempDirs } from './helpers/catalog.js';

afterEach(removeTempDirs);

// Public-form companies, as startups.json holds them, with the location block spelled out.
const company = (name, precision, over = {}) => {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const point = precision === 'EXACT' || precision === 'SUBURB';
  return {
    id, slug: id, name, sector: 'AI', sectorFull: 'AI', city: 'Sydney', state: 'NSW', country: 'Australia', lat: point ? -33.8848 : null, lng: point ? 151.2098 : null, investors: [], stage: 'Seed', hiring: false,
    verified: precision !== 'UNKNOWN', website: `https://${id}.test`, blurb: 'x', taskGate: { enabled: false }, suburb: point ? 'Surry Hills' : null, postcode: point ? '2010' : null,
    address: precision === 'EXACT' ? '110 Kippax Street, Surry Hills, Sydney NSW 2010' : undefined, location_precision: precision, location_source: 'directory_record', location_source_url: null,
    location_verified_at: null, location_confidence: 'low', ...over,
  };
};
const snapOf = (rows) => buildSnapshot(JSON.stringify(rows), 'test');
const names = (snap, matched) => [...matched].map((i) => snap.records[i].name);

describe('the groups for companies known only to their city or state', () => {
  const rows = () => [
    ...['Aa', 'Bb', 'Cc', 'Dd', 'Ee'].map((n) => company(`Syd ${n}`, 'CITY')),
    ...['Aa', 'Bb', 'Cc'].map((n) => company(`Mel ${n}`, 'CITY', { city: 'Melbourne', state: 'VIC' })),
    ...['Aa', 'Bb'].map((n) => company(`Vic ${n}`, 'STATE', { city: 'Unknown', state: 'VIC' })),
    company('Lost One', 'CITY', { city: 'Narnia', state: 'NSW' }),
    company('Lost Two', 'CITY', { city: 'Queanbeyan/Jerrabomberra', state: 'NSW' }),
    company('Exact One', 'EXACT'), company('Suburb One', 'SUBURB'), company('Nowhere', 'UNKNOWN', { city: 'Unknown', state: null }),
  ];

  it('is one group per city, at the city\'s reference centre, with how many are in it and who', () => {
    const snap = snapOf(rows());
    const out = areas(snap, select(snap, {}));
    expect(out.items.map((a) => [a.kind, a.label, a.count])).toEqual([['CITY', 'Sydney', 5], ['CITY', 'Melbourne', 3], ['STATE', 'Victoria', 2]]);
    const sydney = out.items[0];
    expect(sydney).toMatchObject({ key: 'CITY|Sydney|NSW', city: 'Sydney', state: 'NSW', lat: cityCentre('Sydney', 'NSW').lat, lng: cityCentre('Sydney', 'NSW').lng });
    expect(sydney.sample).toEqual([{ slug: 'syd-aa', name: 'Syd Aa' }, { slug: 'syd-bb', name: 'Syd Bb' }, { slug: 'syd-cc', name: 'Syd Cc' }, { slug: 'syd-dd', name: 'Syd Dd' }, { slug: 'syd-ee', name: 'Syd Ee' }]);
    expect(out.items[2]).toMatchObject({ kind: 'STATE', state: 'VIC', city: null, lat: stateCentre('VIC').lat, lng: stateCentre('VIC').lng });
  });

  it('counts, without drawing, the companies whose city has no centre on file', () => {
    const snap = snapOf(rows());
    expect(areas(snap, select(snap, {})).unplaced).toBe(2);
  });

  it('is never made of a company that is a pin, or is not known at all', () => {
    const snap = snapOf(rows());
    const out = areas(snap, select(snap, {}));
    const inGroups = out.items.reduce((n, a) => n + a.count, 0) + out.unplaced;
    expect(inGroups).toBe(5 + 3 + 2 + 2); // not the exact, suburb or unknown one
    expect(areas(snap, select(snap, readFilters({ precision: 'EXACT,SUBURB,UNKNOWN' })))).toEqual({ items: [], unplaced: 0 });
  });

  it('is narrowed by the same filters as the list', () => {
    const snap = snapOf(rows());
    expect(areas(snap, select(snap, readFilters({ city: 'Melbourne' }))).items.map((a) => [a.label, a.count])).toEqual([['Melbourne', 3]]);
    expect(areas(snap, select(snap, readFilters({ search: 'syd b' }))).items.map((a) => [a.label, a.count])).toEqual([['Sydney', 1]]);
    expect(areas(snap, select(snap, readFilters({ state: 'vic' }))).items.map((a) => [a.label, a.count])).toEqual([['Melbourne', 3], ['Victoria', 2]]);
  });

  it('lists only a few of a big group by name, whatever its size, and says how many there are', () => {
    const many = Array.from({ length: 40 }, (_, i) => company(`Co ${String(40 - i).padStart(2, '0')}`, 'CITY'));
    const snap = snapOf(many);
    const [group] = areas(snap, select(snap, {})).items;
    expect(group.count).toBe(40);
    expect(group.sample).toHaveLength(AREA_SAMPLE);
    expect(group.sample.map((s) => s.name)).toEqual(Array.from({ length: AREA_SAMPLE }, (_, i) => `Co ${String(i + 1).padStart(2, '0')}`));
  });
});

describe('asking for a kind of location', () => {
  const rows = () => [company('E1', 'EXACT'), company('E2', 'EXACT', { state: 'VIC', city: 'Melbourne' }), company('S1', 'SUBURB'), company('C1', 'CITY'), company('C2', 'CITY', { city: 'Melbourne', state: 'VIC' }), company('T1', 'STATE', { city: 'Unknown', state: 'QLD' }), company('U1', 'UNKNOWN', { city: 'Unknown', state: null })];
  const ask = (snap, query) => names(snap, select(snap, readFilters(query))).sort();

  it('filters by precision: one, several, in either case, and nothing for a precision there is none of', () => {
    const snap = snapOf(rows());
    expect(ask(snap, { precision: 'CITY' })).toEqual(['C1', 'C2']);
    expect(ask(snap, { precision: 'city' })).toEqual(['C1', 'C2']);
    expect(ask(snap, { precision: 'EXACT,SUBURB' })).toEqual(['E1', 'E2', 'S1']);
    expect(ask(snap, { precision: 'UNKNOWN' })).toEqual(['U1']);
    expect(ask(snap, { precision: 'ROUGH' })).toEqual([]);
  });

  it('filters by state, and combines with the other filters', () => {
    const snap = snapOf(rows());
    expect(ask(snap, { state: 'VIC' })).toEqual(['C2', 'E2']);
    expect(ask(snap, { state: 'vic,qld' })).toEqual(['C2', 'E2', 'T1']);
    expect(ask(snap, { state: 'VIC', precision: 'CITY' })).toEqual(['C2']);
    expect(ask(snap, { precision: 'CITY', city: 'Sydney' })).toEqual(['C1']);
    expect(ask(snap, { state: 'WA' })).toEqual([]);
  });

  it('says how many of the matches are known to each precision, and how many are drawn as a pin', () => {
    const snap = snapOf(rows());
    const s = summary(snap, select(snap, {}));
    expect(s.byPrecision).toEqual({ EXACT: 2, SUBURB: 1, CITY: 2, STATE: 1, UNKNOWN: 1 });
    expect(s.onMap).toBe(3);
    expect(s.pinned).toBe(6); // the confirmed locations, as it always counted them
    expect(s.unverified).toBe(1);
    expect(summary(snap, select(snap, readFilters({ state: 'VIC' }))).byPrecision).toEqual({ EXACT: 1, SUBURB: 0, CITY: 1, STATE: 0, UNKNOWN: 0 });
  });
});

describe('the pins', () => {
  it('say how well the place is known, where it is in words, and whether the address was checked', () => {
    const snap = snapOf([
      company('Exact Checked', 'EXACT', { location_verified: true, location_verified_at: '2026-10-05T04:00:00.000Z' }),
      company('Exact Filed', 'EXACT'),
      company('Suburban', 'SUBURB', { address: 'Surry Hills, Sydney NSW 2010' }),
    ]);
    const items = markers(snap, select(snap, {}));
    const field = (row, name) => row[MARKER_FIELDS.indexOf(name)];
    expect(items.map((m) => [field(m, 'name'), field(m, 'precision'), field(m, 'place'), field(m, 'checked')])).toEqual([
      ['Exact Checked', 'EXACT', '110 Kippax Street, Surry Hills, Sydney', 1],
      ['Exact Filed', 'EXACT', '110 Kippax Street, Surry Hills, Sydney', 0],
      ['Suburban', 'SUBURB', 'Surry Hills, Sydney', 0],
    ]);
  });

  it('are not made for a company known only to its city or state, even if it carries coordinates', () => {
    const snap = snapOf([company('Citywide', 'CITY', { lat: -33.8688, lng: 151.2093 }), company('Statewide', 'STATE', { city: 'Unknown', lat: -37, lng: 144 }), company('Exact', 'EXACT')]);
    expect(markers(snap, select(snap, {})).map((m) => m[1])).toEqual(['Exact']);
    expect(snap.records.find((r) => r.name === 'Citywide')).toMatchObject({ lat: null, lng: null }); // and the public record has none to show
  });
});

describe('a record from before the location fields', () => {
  const old = (name, over = {}) => ({ id: name.toLowerCase(), slug: name.toLowerCase(), name, sector: 'AI', sectorFull: 'AI', city: 'Sydney', lat: -33.87, lng: 151.2, investors: [], stage: 'Seed', hiring: false, verified: true, website: '', blurb: '', taskGate: { enabled: false }, ...over });

  it('means what such a record always meant: confirmed with coordinates is a pin, without them it is known to its city, unconfirmed is unknown', () => {
    const rows = [old('Pinned'), old('Cityish', { lat: null, lng: null }), old('Unconfirmed', { verified: false })];
    expect(rows.map(precisionOf)).toEqual(['EXACT', 'CITY', 'UNKNOWN']);
    const snap = snapOf(rows);
    expect(markers(snap, select(snap, {})).map((m) => m[1])).toEqual(['Pinned']);
    expect(areas(snap, select(snap, {})).items.map((a) => [a.label, a.count])).toEqual([['Sydney', 1]]);
    expect(summary(snap, select(snap, {})).byPrecision).toEqual({ EXACT: 1, SUBURB: 0, CITY: 1, STATE: 0, UNKNOWN: 1 });
  });
});

describe('what the API says about where companies are', () => {
  it('treats the kind of location and the state as part of the question, so one answer is never served for another', () => {
    const key = (query) => questionKey({ baseUrl: '/api/startups', path: '/markers', query });
    expect(key({ precision: 'CITY' })).not.toBe(key({}));
    expect(key({ precision: 'CITY' })).not.toBe(key({ precision: 'EXACT' }));
    expect(key({ state: 'VIC' })).not.toBe(key({ state: 'NSW' }));
    expect(key({ state: 'VIC', junk: 'x' })).toBe(key({ state: 'VIC' }));
  });

  it('serves the groups with the pins, narrowed by the same filters, and counts what it cannot place', async () => {
    const f = await fixture(600);
    const all = (await request(f.app).get('/api/startups/markers')).body;
    expect(Array.isArray(all.areas)).toBe(true);
    expect(all.areas.length).toBeGreaterThan(0);
    const inAreas = all.areas.reduce((n, a) => n + a.count, 0) + all.unplaced;
    expect(inAreas).toBe(f.rows.filter((r) => ['CITY', 'STATE'].includes(r.location_precision)).length);
    expect(all.pinned).toBe(f.rows.filter((r) => ['EXACT', 'SUBURB'].includes(r.location_precision)).length);
    expect(all.areas.every((a) => Number.isFinite(a.lat) && Number.isFinite(a.lng) && a.count > 0 && a.sample.length <= AREA_SAMPLE)).toBe(true);
    const cityOnly = (await request(f.app).get('/api/startups/markers?precision=CITY')).body;
    expect(cityOnly.items).toEqual([]);
    expect(cityOnly.count).toBe(f.rows.filter((r) => r.location_precision === 'CITY').length);
    const sydneyArea = all.areas.find((a) => a.label === 'Sydney');
    const sydney = (await request(f.app).get('/api/startups/markers?precision=CITY&city=Sydney')).body;
    expect(sydney.areas).toHaveLength(1);
    expect(sydney.areas[0].count).toBe(sydneyArea.count);
  });

  it('lists the companies of a group by the filter the group names', async () => {
    const f = await fixture(600);
    const { areas: groups } = (await request(f.app).get('/api/startups/markers')).body;
    const sydney = groups.find((a) => a.label === 'Sydney');
    const res = await request(f.app).get('/api/startups?precision=CITY&city=Sydney&limit=200&view=card');
    expect(res.body.count).toBe(sydney.count);
    expect(sydney.sample.every((s) => res.body.results.some((r) => r.slug === s.slug))).toBe(true);
  });

  it('says in words how well one company\'s place is known, and serves no pin for a city-level one', async () => {
    const f = await fixture(300);
    const exact = f.rows.find((r) => r.location_precision === 'EXACT' && !r.location_verified_at);
    const checked = f.rows.find((r) => r.location_precision === 'EXACT' && r.location_verified_at);
    const suburb = f.rows.find((r) => r.location_precision === 'SUBURB');
    const city = f.rows.find((r) => r.location_precision === 'CITY');
    const unknown = f.rows.find((r) => r.location_precision === 'UNKNOWN');
    const get = async (r) => (await request(f.app).get(`/api/startups/${r.slug}`)).body;
    expect((await get(exact)).location).toMatchObject({ precision: 'EXACT', quality: 'Office address on file' });
    expect((await get(checked)).location).toMatchObject({ precision: 'EXACT', quality: 'Verified office' });
    expect((await get(suburb)).location).toMatchObject({ precision: 'SUBURB', quality: 'Location: suburb-level' });
    const c = await get(city);
    expect(c.location).toEqual({ precision: 'CITY', place: `${city.city}, ${city.state}`, quality: 'Location: city-level' });
    expect([c.lat, c.lng]).toEqual([null, null]);
    expect((await get(unknown)).location).toEqual({ precision: 'UNKNOWN', place: null, quality: 'Location unknown' });
    expect((await get(exact)).location.place).toContain(exact.address.split(',')[0]);
  });

  it('keeps the internal record of where a location came from to itself', async () => {
    const f = await fixture(300);
    const checked = f.rows.find((r) => r.location_verified_at);
    const body = (await request(f.app).get(`/api/startups/${checked.slug}`)).body;
    for (const key of ['location_source', 'location_source_url', 'location_verified_at', 'location_confidence']) expect(body).not.toHaveProperty(key);
    expect(body.location_verified).toBe(true);
    expect(JSON.stringify((await request(f.app).get('/api/startups/markers')).body)).not.toContain(checked.location_source_url);
  });
});
