import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';
import { createMapboxGeocoder, keep, qualityOf, LOW_RELEVANCE, MAPBOX_PROVIDER } from '../src/geo/mapbox.js';
import { geocodeCached, questionFor, normalizeQuery, PROVIDER } from '../src/geo/geocode.js';
import { judgeOffice, buildInstitutionPins } from '../src/catalog/institutionPins.js';
import { checkInstitutionSeed } from '../src/models/institutionSeed.js';
import { main as pinsCli } from '../scripts/institution-pins.js';
import { dataset, co } from './helpers/locations.js';
import { makeDataDir, removeMadeDirs } from './helpers/store.js';

afterEach(removeMadeDirs);

const TOKEN = 'pk.test-token-not-real';
const STREET = 'Level 2, 12 Example Street, Sydney NSW 2000';
const office = (over = {}) => ({ label: 'Sydney', address: STREET, city: 'Sydney', state: 'NSW', lat: null, lng: null, ...over });
const queryFor = (o = office()) => questionFor({ address: o.address, city: o.city, state: o.state }).query;

// A feature as Mapbox's v5 geocoder describes one.
const feature = (over = {}) => ({
  id: 'address.123', type: 'Feature', place_type: ['address'], relevance: 0.99, properties: { accuracy: 'rooftop' }, text: 'Example Street', place_name: '12 Example Street, Sydney, New South Wales 2000, Australia',
  address: '12', center: [151.21, -33.87], geometry: { type: 'Point', coordinates: [151.21, -33.87] },
  context: [{ id: 'postcode.1', text: '2000' }, { id: 'place.1', text: 'Sydney' }, { id: 'region.1', text: 'New South Wales', short_code: 'AU-NSW' }, { id: 'country.1', text: 'Australia', short_code: 'au' }], ...over,
});
const respond = (features, status = 200) => async () => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => ({ features }) });
const geocoder = (fetchImpl, extra = {}) => createMapboxGeocoder({ token: TOKEN, fetchImpl, minIntervalMs: 0, sleep: async () => {}, ...extra });

describe('what a Mapbox feature says', () => {
  it('is kept in the keys the rest of the code reads, with how well it fitted and how exactly it was placed', () => {
    expect(keep(feature())).toEqual({
      lat: -33.87, lng: 151.21, display_name: '12 Example Street, Sydney, New South Wales 2000, Australia', relevance: 0.99, accuracy: 'rooftop', mapbox_id: 'address.123', place_type: ['address'],
      address: { house_number: '12', road: 'Example Street', city: 'Sydney', state: 'New South Wales', postcode: '2000', country_code: 'au' },
    });
  });

  it('says how exactly it answers: a house, only a street, a suburb, a city, a region', () => {
    expect(qualityOf(feature())).toBe('house');
    expect(qualityOf(feature({ address: undefined }))).toBe('street');
    expect(qualityOf(feature({ place_type: ['poi'], address: undefined, properties: { address: '12 Example Street' } }))).toBe('house');
    expect(qualityOf(feature({ place_type: ['poi'], address: undefined, properties: { address: 'Example Street' } }))).toBe('street');
    expect(qualityOf(feature({ place_type: ['neighborhood'] }))).toBe('suburb');
    expect(qualityOf(feature({ place_type: ['locality'] }))).toBe('suburb');
    expect(qualityOf(feature({ place_type: ['place'] }))).toBe('city');
    expect(qualityOf(feature({ place_type: ['region'] }))).toBe('region');
  });

  it('knows a point of interest\'s street number from the front of its address line', () => {
    const k = keep(feature({ place_type: ['poi'], address: undefined, text: 'Example Tower', properties: { address: '12 Example Street' } }));
    expect(k.address).toMatchObject({ house_number: '12', road: 'Example Street' });
  });
});

describe('the client', () => {
  it('cannot be made without a token, and says to set one in the environment', () => {
    for (const token of [undefined, '', '  ']) expect(() => createMapboxGeocoder({ token })).toThrow(/no Mapbox token \(set MAPBOX_TOKEN/);
  });

  it('asks for Australia only, address-like results, and sends the token as Mapbox wants it', async () => {
    let url;
    const gc = geocoder(async (u) => { url = u; return respond([feature()])(); });
    const out = await gc.search('12 Example Street, Sydney, NSW, 2000, Australia');
    expect(out).toMatchObject({ status: 'found', quality: 'house', result: { lat: -33.87, relevance: 0.99 } });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://api.mapbox.com/geocoding/v5/mapbox.places/12%20Example%20Street%2C%20Sydney%2C%20NSW%2C%202000%2C%20Australia.json');
    expect(Object.fromEntries(parsed.searchParams)).toMatchObject({ country: 'au', types: 'address,poi', access_token: TOKEN });
    expect(gc.provider).toBe(MAPBOX_PROVIDER);
  });

  it('uses the permanent endpoint when it is asked to', async () => {
    let url;
    await geocoder(async (u) => { url = u; return respond([])(); }, { permanent: true }).search('x');
    expect(url).toContain('/geocoding/v5/mapbox.places-permanent/');
  });

  it('takes the best match by relevance, and leaves out one that is not in Australia', async () => {
    const gc = geocoder(respond([feature({ relevance: 0.6, id: 'a' }), feature({ relevance: 0.9, id: 'b' }), feature({ relevance: 1, id: 'c', context: [{ id: 'country.1', short_code: 'us' }] })]));
    expect((await gc.search('x')).result.mapbox_id).toBe('b');
    expect((await geocoder(respond([feature({ context: [{ id: 'country.1', short_code: 'nz' }] })])).search('x')).status).toBe('none');
    expect((await geocoder(respond([])).search('x')).status).toBe('none');
  });

  it('stops the whole run when the token is refused or Mapbox says too many, and never says the token', async () => {
    const refused = geocoder(respond([], 401));
    const first = await refused.search('x');
    expect(first.status).toBe('error');
    expect(first.error).toMatch(/refused the token \(401\)/);
    expect(refused.stopped).toMatch(/401/);
    expect((await refused.search('y')).error).toBe(refused.stopped); // not asked again
    const busy = geocoder(respond([], 429));
    await busy.search('x');
    expect(busy.stopped).toMatch(/429/);
    const broken = geocoder(async () => { throw new Error(`connect failed for ${TOKEN}`); });
    const failed = await broken.search('x');
    expect(failed.error).not.toContain(TOKEN);
    for (const text of [first.error, refused.stopped, busy.stopped, failed.error]) expect(text).not.toContain(TOKEN);
  });

  it('keeps its answers in the cache under its own name, apart from OpenStreetMap\'s', async () => {
    const rows = [];
    const gc = geocoder(respond([feature()]));
    const { row } = await geocodeCached(gc, rows, queryFor(), Date.parse('2026-10-13T00:00:00Z'));
    expect(row).toMatchObject({ provider: 'mapbox', id: `mapbox:${normalizeQuery(queryFor())}`, quality: 'house' });
    expect((await geocodeCached(gc, rows, queryFor(), Date.parse('2026-10-14T00:00:00Z'))).fromCache).toBe(true);
  });
});

describe('a match that fits poorly is flagged, not drawn', () => {
  const cacheRow = (relevance, over = {}) => ({
    id: `mapbox:${normalizeQuery(queryFor())}`, provider: 'mapbox', query: queryFor(), status: 'found', quality: 'house',
    result: { ...keep(feature({ relevance })), ...over }, fetched_at: '2026-10-13T00:00:00.000Z', expires_at: '2027-10-13T00:00:00.000Z',
  });

  it('draws a match at or over the limit, at Mapbox\'s point, and says how well it fitted', () => {
    expect(judgeOffice(office(), [cacheRow(0.99)])).toMatchObject({ status: 'pin', how: 'geocoder', lat: -33.87, lng: 151.21, relevance: 0.99 });
    expect(judgeOffice(office(), [cacheRow(LOW_RELEVANCE)]).status).toBe('pin');
  });

  it('flags a match under the limit, with how well it fitted, and does not draw it', () => {
    const verdict = judgeOffice(office(), [cacheRow(0.62)]);
    expect(verdict).toMatchObject({ status: 'flagged', relevance: 0.62 });
    expect(verdict.reason).toMatch(/relevance for this match is 0\.62, under 0\.85/);
    const { pins, report } = buildInstitutionPins(checkInstitutionSeed({ institutions: [{ id: 'x', name: 'X Fund', offices: [office()] }] }), [cacheRow(0.62)]);
    expect(pins).toEqual([]);
    expect(report.flagged).toEqual([expect.objectContaining({ name: 'X Fund', relevance: 0.62, reason: expect.stringContaining('0.62') })]);
  });

  it('still flags a high-relevance match that is in another state, or only the street', () => {
    expect(judgeOffice(office(), [cacheRow(0.99, { address: { state: 'Victoria', house_number: '12', postcode: '2000' } })])).toMatchObject({ status: 'flagged', relevance: 0.99 });
    expect(judgeOffice(office(), [{ ...cacheRow(0.99), quality: 'street' }]).status).toBe('flagged');
  });

  it('prefers Mapbox\'s answer to OpenStreetMap\'s when both are there, and uses OpenStreetMap\'s when Mapbox has not been asked', () => {
    const osm = { id: `${PROVIDER}:${normalizeQuery(queryFor())}`, provider: PROVIDER, query: queryFor(), status: 'found', quality: 'house',
      result: { lat: -33.5, lng: 151.5, display_name: 'osm', address: { house_number: '12', road: 'Example Street', state: 'New South Wales', postcode: '2000', country_code: 'au' } }, fetched_at: 'x', expires_at: null };
    expect(judgeOffice(office(), [osm, cacheRow(0.99)])).toMatchObject({ lat: -33.87 });
    expect(judgeOffice(office(), [osm])).toMatchObject({ status: 'pin', lat: -33.5 });
    expect(judgeOffice(office(), [osm]).relevance).toBeUndefined();
  });
});

describe('the command line with Mapbox', () => {
  async function dirWith(seed) {
    const dir = await makeDataDir(dataset([co('Acme')]));
    await writeFile(path.join(dir, 'institutions_seed.json'), JSON.stringify(seed));
    return dir;
  }
  const run = async (dir, args, deps = {}) => {
    const lines = [];
    const code = await pinsCli(args, { dataDir: dir, out: (s) => lines.push(s), ...deps });
    return { code, text: lines.join('\n') };
  };
  const seed = () => ({ institutions: [
    { id: 'good', name: 'Good Fund', offices: [office()] },
    { id: 'poor', name: 'Poor Fund', offices: [office({ address: '9 Other Road, Perth WA 6000', city: 'Perth', state: 'WA', label: 'Perth' })] },
    { id: 'none', name: 'Bare Fund', offices: [] },
  ] });
  const perth = (relevance) => feature({ relevance, address: '9', text: 'Other Road', place_name: '9 Other Road, Perth', context: [{ id: 'postcode.1', text: '6000' }, { id: 'place.1', text: 'Perth' }, { id: 'region.1', short_code: 'AU-WA' }, { id: 'country.1', short_code: 'au' }], center: [115.86, -31.95] });

  it('is an error, not a quiet fallback, to ask for Mapbox with no token', async () => {
    const dir = await dirWith(seed());
    await expect(run(dir, ['geocode', '--provider', 'mapbox'], { env: {} })).rejects.toThrow(/no Mapbox token: set MAPBOX_TOKEN/);
    await expect(run(dir, ['geocode', '--provider', 'bing'], { env: {} })).rejects.toThrow(/--provider must be mapbox or nominatim/);
  });

  it('uses Mapbox when a token is set, asks once per address, draws the good match and reports the poor one with its relevance', async () => {
    const dir = await dirWith(seed());
    const asked = [];
    const fetchImpl = async (url) => {
      const q = decodeURIComponent(new URL(url).pathname.split('/').pop().replace(/\.json$/, ''));
      asked.push(q);
      return respond([/Perth/.test(q) ? perth(0.55) : feature()])();
    };
    const first = await run(dir, ['geocode'], { env: { MAPBOX_TOKEN: TOKEN }, fetchImpl, sleep: async () => {} });
    expect(first.code).toBe(0);
    expect(asked).toHaveLength(2);
    expect(first.text).toMatch(/Asked the geocoder about 2 addresses/);
    expect(first.text).toMatch(/Drawn: 1 office/);
    expect(first.text).toMatch(/Flagged \(not drawn: check each\): 1/);
    expect(first.text).toMatch(/Poor Fund \(Perth\): .*relevance for this match is 0\.55.*\(relevance 0\.55\)/);
    expect(first.text).toMatch(/Listed, with no offices \(no pin\): 1/);
    expect(first.text).not.toContain(TOKEN);
    const again = await run(dir, ['geocode'], { env: { MAPBOX_TOKEN: TOKEN }, fetchImpl, sleep: async () => {} });
    expect(asked).toHaveLength(2); // asked once, and never again
    expect(again.text).toMatch(/Asked the geocoder about 0 addresses, 2 answered from the cache/);
    const cache = JSON.parse(await readFile(path.join(dir, 'geocode_cache.json'), 'utf8'));
    expect(cache.map((r) => r.provider)).toEqual(['mapbox', 'mapbox']);
    expect(JSON.stringify(cache)).not.toContain(TOKEN);
  });

  it('says it is using OpenStreetMap\'s geocoder, and why, when there is no token', async () => {
    const dir = await dirWith(seed());
    const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => [] });
    const { text } = await run(dir, ['geocode', '--limit', '1'], { env: {}, fetchImpl, sleep: async () => {} });
    expect(text).toMatch(/No Mapbox token \(MAPBOX_TOKEN is not set\): asking OpenStreetMap's geocoder instead/);
  });

  it('stops with exit code 2 when Mapbox refuses the token', async () => {
    const dir = await dirWith(seed());
    const { code, text } = await run(dir, ['geocode'], { env: { MAPBOX_TOKEN: TOKEN }, fetchImpl: respond([], 401), sleep: async () => {} });
    expect(code).toBe(2);
    expect(text).toMatch(/stopped early: Mapbox refused the token \(401\)/);
    expect(text).not.toContain(TOKEN);
  });
});
