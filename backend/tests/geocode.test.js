import { describe, it, expect } from 'vitest';
import {
  questionFor, qualityOf, createGeocoder, geocodeCached, mergeCache, agreesWith, decide, cachedVerdict, normalizeQuery, MIN_INTERVAL_MS, DEFAULT_USER_AGENT, AGREE_METRES, SUBURB_AGREE_METRES,
} from '../src/geo/geocode.js';
import { remember, lookup, validateGeocodeCache, cacheId, TTL_DAYS } from '../src/models/geocodeCache.js';
import { distanceMetres } from '../src/geo/places.js';
import { co, dataset, nominatim, fakeClock, osm, osmHouse, osmSuburb, NOW, ISO, KIPPAX, KIPPAX_QUERY, KIPPAX_POINT, WILLIAM, WILLIAM_QUERY, WILLIAM_POINT } from './helpers/locations.js';

const DAY = 86400000;
const company = (name, over = {}) => dataset([co(name, over)]).companies[0];
const geocoderFor = (script) => {
  const web = nominatim(script);
  const clock = fakeClock();
  return { web, clock, gc: createGeocoder({ fetchImpl: web.fetchImpl, now: clock.now, sleep: clock.sleep }) };
};

describe('the question put to the geocoder', () => {
  it('is the street, suburb, state and postcode of an address, with the unit and level left out', () => {
    expect(questionFor(company('Acme', { address: KIPPAX, ...KIPPAX_POINT }))).toEqual({ kind: 'address', query: KIPPAX_QUERY, wants: 'house' });
    expect(questionFor(company('Acme', { address: WILLIAM, city: 'Melbourne', lat: WILLIAM_POINT.lat, lng: WILLIAM_POINT.lng }))).toEqual({ kind: 'address', query: WILLIAM_QUERY, wants: 'house' });
  });

  it('asks for a suburb when that is all there is, a city when that is all there is, and nothing when nothing is known', () => {
    expect(questionFor(company('Acme', { address: 'Surry Hills, Sydney NSW 2010', lat: -33.8848, lng: 151.2098 }))).toEqual({ kind: 'suburb', query: 'Surry Hills, NSW, 2010, Australia', wants: 'suburb' });
    expect(questionFor(company('Acme'))).toEqual({ kind: 'city', query: 'Sydney, NSW, Australia', wants: 'city' });
    expect(questionFor(company('Acme', { city: 'Unknown', verified: false }))).toBeNull();
  });

  it('asks about a street address even before it has a point', () => {
    expect(questionFor(company('Acme', { address: KIPPAX }))).toEqual({ kind: 'address', query: KIPPAX_QUERY, wants: 'house' });
  });

  it('never sends a person\'s name or anything but the place', () => {
    const q = questionFor(company('Acme', { address: KIPPAX, founders: ['Jane Doe'], website: 'https://acme.example' }));
    expect(q.query).not.toMatch(/Jane|Doe|acme/i);
  });
});

describe('how exactly a result answers', () => {
  it('knows a house, a street, a suburb, a city and a region', () => {
    expect(qualityOf(osmHouse(KIPPAX_POINT))).toBe('house');
    expect(qualityOf(osm(KIPPAX_POINT, { road: 'Kippax Street' }))).toBe('house'); // a named building on a road
    expect(qualityOf(osm(KIPPAX_POINT, { road: 'Kippax Street' }, { category: 'highway', type: 'residential', addresstype: 'road' }))).toBe('street');
    expect(qualityOf(osmSuburb(KIPPAX_POINT))).toBe('suburb');
    expect(qualityOf(osm(KIPPAX_POINT, { city: 'Sydney' }, { category: 'boundary', type: 'administrative', addresstype: 'city' }))).toBe('city');
    expect(qualityOf(osm(KIPPAX_POINT, { state: 'New South Wales' }, { category: 'boundary', type: 'administrative', addresstype: 'state' }))).toBe('region');
  });
});

describe('asking the geocoder', () => {
  it('says who is asking, wants Australia only, and waits between requests however many there are', async () => {
    const { web, clock, gc } = geocoderFor({});
    await gc.search('a');
    await gc.search('b');
    await gc.search('c');
    expect(web.asked()).toEqual(['a', 'b', 'c']);
    expect(web.calls[0].userAgent).toBe(DEFAULT_USER_AGENT);
    expect(DEFAULT_USER_AGENT).toMatch(/^AUStartupMapBot\/1\.0 \(\+https:\/\/au-startup-map\.vercel\.app\//);
    expect(web.calls[0].countrycodes).toBe('au');
    const url = new URL(web.calls[0].url);
    expect(url.origin + url.pathname).toBe('https://nominatim.openstreetmap.org/search');
    expect(url.searchParams.get('format')).toBe('jsonv2');
    expect(url.searchParams.get('addressdetails')).toBe('1');
    expect(MIN_INTERVAL_MS).toBeGreaterThanOrEqual(1000); // Nominatim's policy: at most one request a second
    expect(clock.sleeps).toEqual([MIN_INTERVAL_MS, MIN_INTERVAL_MS]);
  });

  it('does not wait when the last request was long enough ago', async () => {
    const { clock, gc } = geocoderFor({});
    await gc.search('a');
    await clock.sleep(5000); // time passes before the next question
    clock.sleeps.length = 0;
    await gc.search('b');
    expect(clock.sleeps).toEqual([]);
  });

  it('keeps the best answer and what it needs of it, and how well it answers', async () => {
    const { gc } = geocoderFor({ q: [osmHouse(KIPPAX_POINT), osmSuburb(KIPPAX_POINT)] });
    const a = await gc.search('q');
    expect(a.status).toBe('found');
    expect(a.quality).toBe('house');
    expect(a.result).toMatchObject({ lat: KIPPAX_POINT.lat, lng: KIPPAX_POINT.lng, addresstype: 'building', osm_type: 'way', address: { house_number: '110', road: 'Kippax Street', suburb: 'Surry Hills', postcode: '2010', country_code: 'au' } });
    expect(Number.isFinite(a.result.lat) && Number.isFinite(a.result.lng)).toBe(true);
  });

  it('says there was nothing when it answers with nothing, and ignores a place outside Australia', async () => {
    const { gc } = geocoderFor({ nothing: [], abroad: [osm({ lat: -41.29, lng: 174.78 }, { city: 'Wellington', country_code: 'nz' })] });
    expect(await gc.search('nothing')).toEqual({ status: 'none' });
    expect(await gc.search('abroad')).toEqual({ status: 'none' });
    expect(await gc.search('unscripted')).toEqual({ status: 'none' });
  });

  it('stops the whole run when told to slow down or go away, and asks no more', async () => {
    for (const status of [429, 403, 503]) {
      const { web, gc } = geocoderFor({ first: status });
      const a = await gc.search('first');
      expect(a).toEqual({ status: 'error', error: expect.stringContaining(`the geocoder answered ${status}`) });
      expect(gc.stopped).toMatch(String(status));
      const b = await gc.search('second');
      expect(b.status).toBe('error');
      expect(web.asked()).toEqual(['first']);
    }
  });

  it('says when to retry, if it is told', async () => {
    const { gc } = geocoderFor({ first: 429 });
    await gc.search('first');
    expect(gc.stopped).toBe('the geocoder answered 429 (retry after 60 s)');
  });

  it('reports a failure to ask without stopping: a network error, a server error, a page that is not JSON', async () => {
    const { web, gc } = geocoderFor({ down: new Error('ECONNRESET'), broken: 500, html: '<html>Bad gateway</html>', fine: [osmHouse(KIPPAX_POINT)] });
    expect(await gc.search('down')).toEqual({ status: 'error', error: 'could not reach the geocoder: ECONNRESET' });
    expect(await gc.search('broken')).toEqual({ status: 'error', error: 'the geocoder answered 500' });
    expect(await gc.search('html')).toEqual({ status: 'error', error: 'the geocoder answered something that is not JSON' });
    expect(gc.stopped).toBeNull();
    expect((await gc.search('fine')).status).toBe('found');
    expect(web.asked()).toHaveLength(4);
  });
});

describe('asking only once', () => {
  it('asks the geocoder the first time, keeps the answer, and answers from it after, however the question is spelled', async () => {
    const { web, gc } = geocoderFor({ [KIPPAX_QUERY]: [osmHouse(KIPPAX_POINT)] });
    const rows = [];
    const first = await geocodeCached(gc, rows, KIPPAX_QUERY, NOW);
    expect(first).toMatchObject({ fromCache: false, row: { status: 'found', quality: 'house', provider: 'nominatim' } });
    expect(rows).toHaveLength(1);
    const again = await geocodeCached(gc, rows, KIPPAX_QUERY, NOW + DAY);
    const respelled = await geocodeCached(gc, rows, KIPPAX_QUERY.toUpperCase().replace(/, /g, ' ,  '), NOW + DAY);
    expect(again.fromCache).toBe(true);
    expect(respelled.fromCache).toBe(true);
    expect(respelled.row).toEqual(first.row);
    expect(web.calls).toHaveLength(1);
    expect(rows).toHaveLength(1);
  });

  it('keeps "nothing found" too, so an address the geocoder does not know is not asked about again and again', async () => {
    const { web, gc } = geocoderFor({});
    const rows = [];
    expect((await geocodeCached(gc, rows, 'a made up place', NOW)).row).toMatchObject({ status: 'none', result: null, quality: null });
    expect((await geocodeCached(gc, rows, 'a made up place', NOW + 80 * DAY)).fromCache).toBe(true);
    expect(web.calls).toHaveLength(1);
  });

  it('asks again when the answer has gone stale: a year for an address, three months for nothing', async () => {
    const { web, gc } = geocoderFor({ [KIPPAX_QUERY]: [osmHouse(KIPPAX_POINT)] });
    const rows = [];
    await geocodeCached(gc, rows, KIPPAX_QUERY, NOW);
    await geocodeCached(gc, rows, 'nowhere', NOW);
    expect(TTL_DAYS).toEqual({ found: 365, none: 90, error: 1 });
    expect((await geocodeCached(gc, rows, KIPPAX_QUERY, NOW + 364 * DAY)).fromCache).toBe(true);
    expect((await geocodeCached(gc, rows, 'nowhere', NOW + 91 * DAY)).fromCache).toBe(false);
    expect((await geocodeCached(gc, rows, KIPPAX_QUERY, NOW + 366 * DAY)).fromCache).toBe(false);
    expect(rows).toHaveLength(2); // the stale rows were replaced, not added to
    expect(web.calls).toHaveLength(4);
  });

  it('does not keep a failure: nothing was learned, so the next run asks again', async () => {
    const { web, gc } = geocoderFor({ q: new Error('offline') });
    const rows = [];
    const a = await geocodeCached(gc, rows, 'q', NOW);
    expect(a).toEqual({ row: { status: 'error', error: 'could not reach the geocoder: offline', result: null, quality: null }, fromCache: false });
    expect(rows).toEqual([]);
    await geocodeCached(gc, rows, 'q', NOW);
    expect(web.calls).toHaveLength(2);
  });

  it('merges two copies of the cache by question, keeping the one fetched later', () => {
    const mk = (query, fetched, lat) => ({ ...remember([], { provider: 'nominatim', query, status: 'found', quality: 'house', result: { lat, lng: 151 } }, Date.parse(fetched)) });
    const merged = mergeCache([mk('a', '2026-01-01T00:00:00.000Z', -33), mk('b', '2026-05-01T00:00:00.000Z', -34)], [mk('a', '2026-03-01T00:00:00.000Z', -35), mk('b', '2026-02-01T00:00:00.000Z', -36), mk('c', '2026-02-01T00:00:00.000Z', -37)]);
    expect(merged.map((r) => [r.query, r.result.lat])).toEqual([['a', -35], ['b', -34], ['c', -37]]);
  });

  it('shares one row between the ways of writing a question, and checks the rows it keeps', () => {
    expect(normalizeQuery('110 Kippax  Street,  Surry Hills')).toBe(normalizeQuery('110 KIPPAX STREET, SURRY HILLS'));
    expect(cacheId('nominatim', 'A, b')).toBe('nominatim:a b');
    const rows = [];
    remember(rows, { provider: 'nominatim', query: KIPPAX_QUERY, status: 'found', quality: 'house', result: { lat: -33.88, lng: 151.2 } }, NOW);
    remember(rows, { provider: 'nominatim', query: 'nowhere', status: 'none' }, NOW);
    expect(validateGeocodeCache({ geocode_cache: rows })).toEqual([]);
    expect(lookup(rows, 'nominatim', KIPPAX_QUERY, NOW)).toBe(rows[0]);
    expect(lookup(rows, 'nominatim', KIPPAX_QUERY, NOW + 400 * DAY)).toBeNull();
    const broken = [
      { ...rows[0], id: 'nominatim:other' }, { ...rows[0], status: 'maybe' }, { ...rows[0], quality: 'roughly' }, { ...rows[0], result: { lat: null, lng: null } },
      { ...rows[1], result: { lat: 1, lng: 2 } }, { ...rows[1], fetched_at: 'yesterday' }, rows[0], rows[0],
    ];
    const problems = validateGeocodeCache({ geocode_cache: broken }).join('\n');
    for (const want of [/id does not match/, /status must be one of/, /quality must be one of/, /needs a point/, /has no result/, /fetched_at must be an ISO/, /duplicate id/]) expect(problems).toMatch(want);
  });
});

describe('judging an answer', () => {
  const exact = () => company('Acme', { address: KIPPAX, ...KIPPAX_POINT });
  const q = (c) => questionFor(c);
  const row = (result, quality = 'house') => ({ status: 'found', quality, result });
  const found = (point = KIPPAX_POINT, address = {}) => ({ ...point, address: { house_number: '110', road: 'Kippax Street', suburb: 'Surry Hills', city: 'Sydney', state: 'New South Wales', postcode: '2010', ...address } });
  const metresNorth = (point, m) => ({ lat: point.lat + m / 111195, lng: point.lng });

  it('confirms a point that is the same place, and keeps the geocoder\'s because it can be traced', () => {
    const c = exact();
    const d = decide(c, q(c), row(found(metresNorth(KIPPAX_POINT, 80))));
    expect(d).toMatchObject({ action: 'confirm' });
    expect(d.away).toBeGreaterThan(70);
    expect(d.away).toBeLessThan(90);
    expect(d.found.lat).toBeCloseTo(KIPPAX_POINT.lat + 80 / 111195, 6);
  });

  it('leaves a point that is the geocoder\'s own, give or take a few metres, exactly as it is', () => {
    const c = exact();
    const d = decide(c, q(c), row(found(metresNorth(KIPPAX_POINT, 10))));
    expect(d.action).toBe('agrees');
    expect(d.away).toBeLessThanOrEqual(25);
    expect(decide(c, q(c), row(found(metresNorth(KIPPAX_POINT, 40)))).action).toBe('confirm');
  });

  it('places a company that has no point yet', () => {
    const c = company('Acme', { address: KIPPAX });
    expect(decide(c, q(c), row(found()))).toMatchObject({ action: 'place', away: null, found: { lat: KIPPAX_POINT.lat } });
  });

  it('treats a pin on a city centre that nothing has checked as no point at all: the geocoder\'s takes its place', () => {
    const c = company('Acme', { address: KIPPAX, lat: -33.8688, lng: 151.2093 }); // the centre of Sydney, two kilometres from the address
    expect(decide(c, q(c), row(found()))).toMatchObject({ action: 'place', away: null, found: { lat: KIPPAX_POINT.lat } });
    // a centre a source has checked is a point somebody knew, and a disagreement with it is a conflict to look at
    const checked = { ...c, location_verified_at: ISO };
    expect(decide(checked, q(checked), row(found())).action).toBe('conflict');
    // and a pin merely near a centre is not a fallback
    const near = company('Acme', { address: KIPPAX, lat: -33.8688 + 0.002, lng: 151.2093 });
    expect(decide(near, q(near), row(found())).action).toBe('conflict');
  });

  it('calls it a conflict, and changes nothing, when the point on file is somewhere else', () => {
    const c = exact();
    const d = decide(c, q(c), row(found(metresNorth(KIPPAX_POINT, 3000))));
    expect(d.action).toBe('conflict');
    expect(d.reason).toMatch(/the point on file is 3\.0 km from where the geocoder puts the address/);
    const close = decide(c, q(c), row(found(metresNorth(KIPPAX_POINT, AGREE_METRES + 100))));
    expect(close.action).toBe('conflict');
    expect(close.reason).toMatch(/\d+ m from where the geocoder puts the address/);
  });

  it('calls it a conflict when the geocoder puts the address in another state, another postcode or another street number', () => {
    const c = exact();
    expect(decide(c, q(c), row(found(KIPPAX_POINT, { state: 'Victoria' })))).toMatchObject({ action: 'conflict', reason: 'the geocoder put it in VIC, not NSW' });
    expect(decide(c, q(c), row(found(KIPPAX_POINT, { postcode: '2011', suburb: 'Elizabeth Bay', city: 'Sydney' }))).reason).toMatch(/the geocoder's postcode is 2011, not 2010/);
    expect(decide(c, q(c), row(found(KIPPAX_POINT, { house_number: '112' }))).reason).toMatch(/the geocoder found number 112, not 110/);
  });

  it('accepts a street number that falls within the run of numbers the geocoder has for the building, in either direction', () => {
    const at = (address) => company('Acme', { address, ...KIPPAX_POINT });
    const asks = (address, house_number) => agreesWith(at(address), found(KIPPAX_POINT, { house_number })).agrees;
    expect(asks('441 Kippax Street, Surry Hills NSW 2010', '435-441')).toBe(true);
    expect(asks('5 Kippax Street, Surry Hills NSW 2010', '3–5')).toBe(true);
    expect(asks('1-9 Kippax Street, Surry Hills NSW 2010', '5')).toBe(true);
    expect(asks('Unit 12/34 Kippax Street, Surry Hills NSW 2010', '34')).toBe(true);
    expect(asks('34 Kippax Street, Surry Hills NSW 2010', '12/34')).toBe(true);
    expect(asks('34 Kippax Street, Surry Hills NSW 2010', '34A')).toBe(true);
    expect(asks('445 Kippax Street, Surry Hills NSW 2010', '435-441')).toBe(false);
    expect(asks('1-9 Kippax Street, Surry Hills NSW 2010', '11')).toBe(false);
    expect(asks('34 Kippax Street, Surry Hills NSW 2010', '36')).toBe(false);
  });

  it('does not take a street of the same name in another suburb of the same city for the one asked about', () => {
    const c = company('Acme', { address: 'Level 4, 99 Queen Street, Melbourne VIC 3000', city: 'Melbourne', lat: -37.8176, lng: 144.9700 });
    const altona = { lat: -37.8695, lng: 144.8325, address: { house_number: '99', road: 'Queen Street', suburb: 'Altona', city: 'Melbourne', state: 'Victoria', postcode: '3018' } };
    const d = decide(c, q(c), row(altona));
    expect(d.action).toBe('conflict');
    expect(d.reason).toBe("the geocoder's postcode is 3018, not 3000");
  });

  it('does not place a company, with no point to check against, at a point far from the city its record names', () => {
    const c = company('Acme', { address: KIPPAX });
    const perth = { lat: -31.9523, lng: 115.8613, address: { house_number: '110', road: 'Kippax Street', suburb: 'Surry Hills', state: 'New South Wales', postcode: '2010' } };
    expect(decide(c, q(c), row(perth))).toMatchObject({ action: 'conflict', reason: expect.stringMatching(/^the geocoder puts it 3\d{3} km from Sydney$/), away: null });
    expect(decide(c, q(c), row(found())).action).toBe('place');
    // a record whose city is not on file has nothing to be checked against, and is placed
    const odd = company('Acme', { address: KIPPAX, city: 'Narnia' });
    expect(decide(odd, q(odd), row(perth)).action).toBe('place');
  });

  it('lets a postcode differ on a boundary when the suburb is the same', () => {
    const c = exact();
    expect(decide(c, q(c), row(found(KIPPAX_POINT, { postcode: '2011' }))).action).toBe('agrees');
    expect(agreesWith(c, found(KIPPAX_POINT, { postcode: '2011' }))).toEqual({ agrees: true, reasons: [] });
  });

  it('does not settle anything with nothing, or with a street when a house was wanted', () => {
    const c = exact();
    expect(decide(c, q(c), { status: 'none', result: null })).toEqual({ action: 'skip', reason: 'the geocoder knows nothing of that address' });
    expect(decide(c, q(c), { status: 'error', error: 'x', result: null })).toEqual({ action: 'skip', reason: 'the geocoder could not be asked' });
    expect(decide(c, q(c), row(found(), 'street'))).toEqual({ action: 'skip', reason: 'the geocoder found only the street, not the house' });
    expect(decide(c, q(c), row(found(), 'suburb')).action).toBe('skip');
    expect(decide(c, q(c), row(found(), 'city')).action).toBe('skip');
  });

  it('treats a suburb\'s point as a centre: the same place within a couple of kilometres', () => {
    const c = company('Acme', { address: 'Surry Hills, Sydney NSW 2010', lat: -33.8848, lng: 151.2098 });
    const centre = { lat: -33.8885, lng: 151.2113 };
    const suburb = (point) => row({ ...point, address: { suburb: 'Surry Hills', city: 'Sydney', state: 'New South Wales', postcode: '2010' } }, 'suburb');
    expect(decide(c, q(c), suburb(centre))).toMatchObject({ action: 'agrees' }); // a point inside the suburb is at least as good as its centre
    expect(decide(c, q(c), suburb(metresNorth(centre, SUBURB_AGREE_METRES + 800))).action).toBe('conflict');
    expect(decide(c, q(c), row(found(), 'region')).action).toBe('skip');
  });

  it('measures the distance it reports', () => {
    const c = exact();
    const away = metresNorth(KIPPAX_POINT, 250);
    expect(decide(c, q(c), row(found(away))).away).toBe(Math.round(distanceMetres(c.lat, c.lng, away.lat, away.lng)));
  });
});

describe('what the cache says about a company without asking anyone', () => {
  it('is nothing for a company that was never asked about, or has nothing to ask', () => {
    expect(cachedVerdict(company('Acme', { address: KIPPAX, ...KIPPAX_POINT }), [])).toBeNull();
    expect(cachedVerdict(company('Acme', { city: 'Unknown', verified: false }), [])).toBeNull();
  });

  it('is the question, the answer and what would be done, whatever the age of the answer', () => {
    const c = company('Acme', { address: KIPPAX, ...KIPPAX_POINT });
    const rows = [];
    const result = { ...KIPPAX_POINT, address: { house_number: '110', road: 'Kippax Street', suburb: 'Surry Hills', state: 'New South Wales', postcode: '2010' } };
    remember(rows, { provider: 'nominatim', query: KIPPAX_QUERY, status: 'found', quality: 'house', result }, NOW - 800 * DAY);
    const verdict = cachedVerdict(c, rows);
    expect(verdict.question.kind).toBe('address');
    expect(verdict.row.id).toBe(cacheId('nominatim', KIPPAX_QUERY));
    expect(verdict.decision.action).toBe('agrees');
  });
});
