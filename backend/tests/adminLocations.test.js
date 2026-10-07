import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAdminApp } from '../src/admin/server.js';
import { createAdminService } from '../src/admin/service.js';
import { addUser, loadUsers, createAuthenticator, createLimiter, createSecurityLog } from '../src/admin/auth.js';
import { createGeocoder } from '../src/geo/geocode.js';
import { loadRaw } from '../src/models/dataset.js';
import { ForbiddenError, BadRequestError, NotFoundError } from '../src/admin/errors.js';
import { LOCATION_FLAGS } from '../src/models/locationAudit.js';
import { co, dataset, nominatim, fakeClock, osmHouse, KIPPAX, KIPPAX_QUERY, KIPPAX_POINT, WILLIAM, WILLIAM_POINT, ISO } from './helpers/locations.js';
import { makeDataDir, readDataDir, removeMadeDirs } from './helpers/store.js';

const homes = [];
afterEach(async () => { await removeMadeDirs(); await Promise.all(homes.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

const viewer = { name: 'Sam', role: 'viewer' };
const reviewer = { name: 'Riley', role: 'reviewer' };
const admin = { name: 'Aryan', role: 'admin' };
const AT = Date.parse('2026-10-06T01:00:00.000Z');

// A directory with a company at each level of knowing, and a few things wrong with them.
const companies = () => [
  co('Exact One', { address: KIPPAX, lat: KIPPAX_POINT.lat + 0.0007, lng: KIPPAX_POINT.lng }),
  co('Exact Two', { address: WILLIAM, city: 'Melbourne', ...WILLIAM_POINT }),
  co('Citywide', { lat: -33.86984, lng: 151.20828 }),
  co('Suburban', { address: 'Surry Hills, Sydney NSW 2010', lat: -33.8848, lng: 151.2098 }),
  co('Twin A', { address: '1 George Street, Sydney NSW 2000', lat: -33.86, lng: 151.2 }),
  co('Twin B', { address: '200 Pitt Street, Sydney NSW 2000', lat: -33.86, lng: 151.2 }),
  co('Nowhere', { city: 'Unknown', verified: false }),
];

async function build({ script = {}, geocode = true } = {}) {
  const dir = await makeDataDir(dataset(companies()));
  const web = nominatim(script);
  const clock = fakeClock(AT);
  const geocoderFactory = () => createGeocoder({ fetchImpl: web.fetchImpl, now: clock.now, sleep: clock.sleep });
  const service = createAdminService({ dir, now: clock.now, geocoderFactory });
  return { dir, service, web, clock };
}
const trail = async (dir) => (await readDataDir(dir)).audit_trail;
const byName = (ds, name) => ds.companies.find((c) => c.name === name);

describe('the location review in the Command Center', () => {
  it('counts the companies at each precision and the six flags, and how many are in the queue', async () => {
    const { service } = await build();
    const r = await service.locations(viewer);
    expect(r.precision).toEqual({ EXACT: 4, SUBURB: 1, CITY: 1, STATE: 0, UNKNOWN: 1 });
    expect(r.flags.map((f) => f.key)).toEqual(Object.keys(LOCATION_FLAGS));
    expect(Object.fromEntries(r.flags.map((f) => [f.key, f.count]))).toMatchObject({ duplicate_coordinates: 2, city_centroid_coordinates: 1, unverified_addresses: 4 });
    expect(r.flags.find((f) => f.key === 'duplicate_coordinates')).toMatchObject({ label: 'Duplicate coordinates', note: expect.stringContaining('different address') });
    expect(r.queue).toBe(r.total);
    expect(r.attention).toBeGreaterThan(0);
  });

  it('lists the companies to look at, worst first, each with its place, point, precision, where that came from and what is wrong', async () => {
    const { service } = await build();
    const r = await service.locations(viewer);
    expect(r.results[0].worst).toBe('high');
    const severities = r.results.map((x) => ['high', 'medium', 'low'].indexOf(x.worst));
    expect(severities).toEqual([...severities].sort((a, b) => a - b));
    const city = r.results.find((x) => x.name === 'Citywide');
    expect(city).toMatchObject({ company_id: 'citywide', city: 'Sydney', state: 'NSW', precision: 'CITY', lat: -33.86984, lng: 151.20828, source: 'directory_record', verified_at: null });
    expect(city.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['coordinates_on_area_location', 'city_level_only']));
    expect(city.issues[0]).toMatchObject({ severity: 'high', label: expect.any(String), action: expect.any(String) });
    expect(r.issues.every((i) => i.count > 0 && i.label && i.action)).toBe(true);
  });

  it('can be narrowed to a flag or to one problem, and capped without changing the counts', async () => {
    const { service } = await build();
    const dup = await service.locations(viewer, { filter: 'duplicate_coordinates' });
    expect(dup.results.map((x) => x.name).sort()).toEqual(['Twin A', 'Twin B']);
    expect(dup.total).toBe(2);
    expect(dup.filter).toBe('duplicate_coordinates');
    const one = await service.locations(viewer, { filter: 'city_level_only' });
    expect(one.results.map((x) => x.name)).toEqual(['Citywide']);
    const capped = await service.locations(viewer, { limit: 2 });
    expect(capped.results).toHaveLength(2);
    expect(capped.total).toBeGreaterThan(2);
    expect(capped.queue).toBe((await service.locations(viewer)).queue);
    await expect(service.locations(viewer, { filter: 'sad' })).rejects.toBeInstanceOf(BadRequestError);
  });

  it('is part of the overview: the same counts, the published tile split into pins, city-level and unconfirmed, and a coverage note', async () => {
    const { service } = await build();
    const o = await service.overview(viewer);
    expect(o.locations).toMatchObject({ precision: { EXACT: 4, SUBURB: 1, CITY: 1, STATE: 0, UNKNOWN: 1 }, total: 7 });
    expect(o.locations.flags).toHaveLength(6);
    expect(o.detail.published).toEqual({ on_map: 5, city_level: 1, unconfirmed: 1 });
    expect(o.quality.find((q) => q.key === 'location').note).toBe('4 exact, 1 suburb, 1 known only to a city or state, 1 unknown');
  });
});

describe('looking an address up', () => {
  const house = (point, over = {}) => osmHouse(point, over);

  it('asks the geocoder, says where it puts the address and how exactly, and keeps the answer so it is asked once', async () => {
    const { service, dir, web } = await build({ script: { [KIPPAX_QUERY]: [house(KIPPAX_POINT)] } });
    const first = await service.lookupLocation(reviewer, { address: KIPPAX });
    expect(first).toMatchObject({ query: KIPPAX_QUERY, kind: 'address', status: 'found', quality: 'house', from_cache: false, verdict: 'place', found: { lat: KIPPAX_POINT.lat, lng: KIPPAX_POINT.lng } });
    expect(web.calls).toHaveLength(1);
    const ds = await readDataDir(dir);
    expect(ds.geocode_cache.map((r) => r.query)).toEqual([KIPPAX_QUERY]);
    expect(ds.audit_trail.at(-1)).toMatchObject({ action: 'location.geocode', actor: 'Riley', via: 'admin-ui', target: { type: 'system', id: 'geocoder' }, summary: 'Asked the geocoder about 1 address' });
    const again = await service.lookupLocation(reviewer, { address: KIPPAX.toUpperCase() });
    expect(again).toMatchObject({ from_cache: true, status: 'found' });
    expect(web.calls).toHaveLength(1); // not asked again
    expect((await trail(dir)).filter((r) => r.action === 'location.geocode')).toHaveLength(1);
  });

  it('compares the answer with the point the company has on file, and says what it would do', async () => {
    const { service } = await build({ script: { [KIPPAX_QUERY]: [house(KIPPAX_POINT)] } });
    const near = await service.lookupLocation(reviewer, { address: KIPPAX, company_id: 'exact-one' });
    expect(near).toMatchObject({ verdict: 'confirm' });
    expect(near.away).toBeGreaterThan(60);
    const none = await service.lookupLocation(reviewer, { address: KIPPAX, company_id: 'citywide' }); // has only a city centre: no point of its own to disagree with
    expect(none).toMatchObject({ verdict: 'place', away: null });
    await expect(service.lookupLocation(reviewer, { address: KIPPAX, company_id: 'nobody' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('says so when the geocoder disagrees with the address, finds only the street, or knows nothing', async () => {
    const wrongState = house(KIPPAX_POINT, { state: 'Victoria' });
    const { service } = await build({ script: { [KIPPAX_QUERY]: [wrongState], '5 Short Street, Surry Hills, NSW, 2010, Australia': [{ ...house(KIPPAX_POINT), address: { road: 'Short Street', suburb: 'Surry Hills', state: 'New South Wales', postcode: '2010', country_code: 'au' }, category: 'highway', type: 'residential', addresstype: 'road' }] } });
    expect(await service.lookupLocation(reviewer, { address: KIPPAX })).toMatchObject({ verdict: 'conflict', reason: expect.stringMatching(/put it in VIC, not NSW/) });
    expect(await service.lookupLocation(reviewer, { address: '5 Short Street, Surry Hills NSW 2010' })).toMatchObject({ status: 'found', quality: 'street', verdict: 'skip', reason: 'the geocoder found only the street, not the house' });
    expect(await service.lookupLocation(reviewer, { address: '9 Nowhere Road, Surry Hills NSW 2010' })).toMatchObject({ status: 'none', found: null, verdict: 'skip' });
  });

  it('looks up a suburb when that is all there is, and refuses a city alone', async () => {
    const { service } = await build();
    expect((await service.lookupLocation(reviewer, { suburb: 'Surry Hills', city: 'Sydney', state: 'NSW', postcode: '2010', precision: 'SUBURB' })).query).toBe('Surry Hills, NSW, 2010, Australia');
    await expect(service.lookupLocation(reviewer, { city: 'Sydney', state: 'NSW' })).rejects.toThrow(/give a street address, or a suburb/);
    await expect(service.lookupLocation(reviewer, {})).rejects.toThrow(/give a street address, or a suburb/);
  });

  it('reports a failure to reach the geocoder, keeps nothing of it, and writes nothing', async () => {
    const { service, dir } = await build({ script: { [KIPPAX_QUERY]: new Error('offline') } });
    const before = await loadRaw(dir);
    const r = await service.lookupLocation(reviewer, { address: KIPPAX });
    expect(r).toMatchObject({ status: 'error', verdict: 'skip', found: null, error: expect.stringMatching(/could not reach the geocoder: offline/) });
    expect(await loadRaw(dir)).toEqual(before);
  });

  it('is slow on purpose: one geocoder for the server, so two lookups are never closer than its pause', async () => {
    const { service, clock } = await build({ script: { [KIPPAX_QUERY]: [house(KIPPAX_POINT)] } });
    await service.lookupLocation(reviewer, { address: KIPPAX });
    await service.lookupLocation(reviewer, { address: WILLIAM });
    expect(clock.sleeps).toEqual([1100]);
  });

  it('is for a reviewer or an admin; a viewer is refused before anything is asked', async () => {
    const { service, web } = await build({ script: { [KIPPAX_QUERY]: [house(KIPPAX_POINT)] } });
    await expect(service.lookupLocation(viewer, { address: KIPPAX })).rejects.toBeInstanceOf(ForbiddenError);
    expect(web.calls).toEqual([]);
    await expect(service.lookupLocation(admin, { address: KIPPAX })).resolves.toMatchObject({ status: 'found' });
  });
});

describe('saying where a company is', () => {
  const exact = { precision: 'EXACT', city: 'Sydney', state: 'NSW', address: '24 Campbell Street, Sydney NSW 2000', lat: -33.8764, lng: 151.2049 };

  it('records an exact office with the page that states it and why, in one audit row, and the headquarters row follows', async () => {
    const { service, dir } = await build();
    const r = await service.setLocation(admin, 'citywide', { reason: 'Their contact page lists it.', source: 'company_website', source_url: 'https://citywide.example/contact', location: exact });
    expect(r).toMatchObject({ company_id: 'citywide', precision: 'EXACT' });
    expect(r.changed).toEqual(expect.arrayContaining(['address', 'lat', 'lng', 'location_precision', 'location_source']));
    const ds = await readDataDir(dir);
    expect(byName(ds, 'Citywide')).toMatchObject({
      location_precision: 'EXACT', address: '24 Campbell Street, Sydney NSW 2000', lat: -33.8764, lng: 151.2049, postcode: '2000', location_source: 'company_website',
      location_source_url: 'https://citywide.example/contact', location_verified_at: new Date(AT).toISOString(), location_confidence: 'medium',
    });
    expect(ds.company_locations.find((x) => x.id === 'citywide.hq')).toMatchObject({ latitude: -33.8764, location_precision: 'EXACT' });
    const row = ds.audit_trail.at(-1);
    expect(row).toMatchObject({ action: 'location.set', actor: 'Aryan', role: 'admin', via: 'admin-ui', target: { type: 'company', id: 'citywide' }, reason: 'Their contact page lists it.', summary: "Set Citywide's location (EXACT)" });
    expect(row.changes.map((c) => c.field)).toEqual(expect.arrayContaining(['address', 'lat', 'location_precision']));
    expect(ds.audit_trail.filter((x) => x.action === 'location.set')).toHaveLength(1);
  });

  it('records a suburb with a point as suburb-level, a city alone with no point, and a state alone', async () => {
    const { service, dir } = await build();
    await service.setLocation(admin, 'citywide', { reason: 'Newtown, per their post.', location: { precision: 'SUBURB', city: 'Sydney', suburb: 'Newtown', lat: -33.8978, lng: 151.1743 } });
    expect(byName(await readDataDir(dir), 'Citywide')).toMatchObject({ location_precision: 'SUBURB', suburb: 'Newtown', lat: -33.8978, location_source: 'manual' });
    await service.setLocation(admin, 'exact-one', { reason: 'They moved to Melbourne.', location: { precision: 'CITY', city: 'Melbourne', state: 'VIC' } });
    expect(byName(await readDataDir(dir), 'Exact One')).toMatchObject({ location_precision: 'CITY', city: 'Melbourne', state: 'VIC', lat: null, lng: null });
    await service.setLocation(admin, 'suburban', { reason: 'Only the state is known.', location: { precision: 'STATE', state: 'NSW' } });
    expect(byName(await readDataDir(dir), 'Suburban')).toMatchObject({ location_precision: 'STATE', state: 'NSW', lat: null });
  });

  it('can take a company off the map: its place is not known', async () => {
    const { service, dir } = await build();
    await service.setLocation(admin, 'exact-two', { reason: 'The address was wrong and nothing replaces it.', location: { precision: 'UNKNOWN' } });
    expect(byName(await readDataDir(dir), 'Exact Two')).toMatchObject({ location_precision: 'UNKNOWN', verified: false, city: 'Unknown', lat: null, lng: null });
  });

  it('asks for a reason, a page for a company\'s own source, a source it knows, and a point for a point', async () => {
    const { service, dir } = await build();
    const before = await loadRaw(dir);
    const set = (body) => service.setLocation(admin, 'citywide', body);
    await expect(set({ location: exact })).rejects.toThrow(/the reason is required/);
    await expect(set({ reason: 'x'.repeat(2), location: { ...exact, lat: undefined, lng: undefined } })).rejects.toThrow(/needs coordinates/);
    await expect(set({ reason: 'Their page.', source: 'company_website', location: exact })).rejects.toThrow(/name the page that states it/);
    await expect(set({ reason: 'Their page.', source: 'company_website', source_url: 'https://www.linkedin.com/company/citywide', location: exact })).rejects.toThrow(/says where a person is/);
    await expect(set({ reason: 'A guess.', source: 'search_snippet', location: exact })).rejects.toThrow(/the source must be one of/);
    await expect(set({ reason: 'Untraceable.', source: 'directory_record', location: exact })).rejects.toThrow(/the source must be one of/);
    await expect(set({ reason: 'Overseas.', location: { ...exact, lat: 51.5, lng: -0.12 } })).rejects.toThrow(/not in Australia/);
    await expect(set({ reason: 'No place.', location: { precision: 'EXACT', lat: -33.8, lng: 151.2 } })).rejects.toThrow(/the city is required/);
    await expect(set({ reason: 'Half a point.', location: { ...exact, lng: undefined } })).rejects.toThrow(/both a latitude and a longitude/);
    await expect(set({ reason: 'No such precision.', location: { ...exact, precision: 'ROUGHLY' } })).rejects.toThrow(/precision must be/);
    await expect(service.setLocation(admin, 'nobody', { reason: 'x y z', location: exact })).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.setLocation(admin, 'Not An Id!', { reason: 'x y z', location: exact })).rejects.toBeInstanceOf(BadRequestError);
    expect(await loadRaw(dir)).toEqual(before); // every refusal left the files as they were
  });

  it('is for an admin: it changes what the public sees', async () => {
    const { service, dir } = await build();
    const before = await loadRaw(dir);
    for (const person of [viewer, reviewer]) await expect(service.setLocation(person, 'citywide', { reason: 'x y z', location: exact })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await loadRaw(dir)).toEqual(before);
  });
});

describe('through the server', () => {
  async function boot() {
    const built = await build({ script: { [KIPPAX_QUERY]: [osmHouse(KIPPAX_POINT)] } });
    const home = await mkdtemp(path.join(os.tmpdir(), 'admin-loc-'));
    homes.push(home);
    const file = path.join(home, 'users.json');
    const tokens = {};
    for (const [name, role] of [['Sam', 'viewer'], ['Riley', 'reviewer'], ['Aryan', 'admin']]) tokens[role] = (await addUser(file, { name, role })).token;
    const app = createAdminApp({ service: built.service, authenticator: createAuthenticator(await loadUsers(file)), limiter: createLimiter(), securityLog: createSecurityLog(path.join(home, 'security.log')), logger: { error() {} } });
    return { ...built, app, tokens };
  }
  const as = (t) => ({ Authorization: `Bearer ${t}` });
  const JSON_HEADERS = { 'Content-Type': 'application/json' };

  it('serves the review to anyone signed in, narrowed by ?filter=, and says plainly when the filter is not one', async () => {
    const { app, tokens } = await boot();
    expect((await request(app).get('/api/locations')).status).toBe(401);
    const all = await request(app).get('/api/locations').set(as(tokens.viewer));
    expect(all.status).toBe(200);
    expect(all.body.precision.EXACT).toBe(4);
    const dup = await request(app).get('/api/locations?filter=duplicate_coordinates&limit=5').set(as(tokens.viewer));
    expect(dup.body.results.map((x) => x.name).sort()).toEqual(['Twin A', 'Twin B']);
    const bad = await request(app).get('/api/locations?filter=whatever').set(as(tokens.viewer));
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/not a kind of location problem/);
  });

  it('looks an address up for a reviewer, and sets a place only for an admin', async () => {
    const { app, tokens } = await boot();
    const lookup = (t) => request(app).post('/api/locations/lookup').set(as(t)).set(JSON_HEADERS).send({ address: KIPPAX });
    expect((await lookup(tokens.viewer)).status).toBe(403);
    const found = await lookup(tokens.reviewer);
    expect(found.status).toBe(200);
    expect(found.body).toMatchObject({ status: 'found', quality: 'house', found: { lat: KIPPAX_POINT.lat } });
    const set = (t, body) => request(app).post('/api/locations/citywide').set(as(t)).set(JSON_HEADERS).send(body);
    const body = { reason: 'Their contact page.', source: 'company_website', source_url: 'https://c.example/contact', location: { precision: 'EXACT', city: 'Sydney', address: KIPPAX, lat: KIPPAX_POINT.lat, lng: KIPPAX_POINT.lng } };
    expect((await set(tokens.reviewer, body)).status).toBe(403);
    const done = await set(tokens.admin, body);
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ company_id: 'citywide', precision: 'EXACT' });
    expect((await set(tokens.admin, { ...body, reason: '' })).status).toBe(400);
    expect((await request(app).post('/api/locations/nobody').set(as(tokens.admin)).set(JSON_HEADERS).send(body)).status).toBe(404);
  });
});
