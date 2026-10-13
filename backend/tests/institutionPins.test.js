import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createApp } from '../src/app.js';
import { createCommunityCatalog } from '../src/catalog/community.js';
import { checkInstitutionSeed } from '../src/models/institutionSeed.js';
import { judgeOffice, buildInstitutionPins } from '../src/catalog/institutionPins.js';
import { questionFor, normalizeQuery, PROVIDER } from '../src/geo/geocode.js';
import { main as pinsCli } from '../scripts/institution-pins.js';
import { dataset, co } from './helpers/locations.js';
import { makeDataDir, removeMadeDirs } from './helpers/store.js';
import { fixture, tempDir, removeTempDirs } from './helpers/catalog.js';

afterEach(async () => { await removeMadeDirs(); await removeTempDirs(); });

const STREET = 'Level 2, 12 Example Street, Sydney NSW 2000';
const office = (over = {}) => ({ label: 'Sydney', address: STREET, city: 'Sydney', state: 'NSW', lat: null, lng: null, ...over });
const firm = (over = {}) => ({ id: 'example-capital', name: 'Example Capital', website: 'https://capital.example', offices: [office()], ...over });
const queryFor = (o = office()) => questionFor({ address: o.address, city: o.city, state: o.state }).query;
// What the geocoder would have answered, kept in the cache.
const answer = (o, { quality = 'house', address = {}, lat = -33.87, lng = 151.21, status = 'found' } = {}) => ({
  id: `${PROVIDER}:${normalizeQuery(queryFor(o))}`, provider: PROVIDER, query: queryFor(o), status, quality: status === 'found' ? quality : null,
  result: status === 'found' ? { lat, lng, display_name: 'Somewhere', address: { house_number: '12', road: 'Example Street', suburb: 'Sydney', state: 'New South Wales', postcode: '2000', country_code: 'au', ...address } } : null,
  fetched_at: '2026-10-13T00:00:00.000Z', expires_at: '2027-10-13T00:00:00.000Z',
});

describe('the institutions seed', () => {
  it('takes a firm with an office, and says what it dropped and why', () => {
    const out = checkInstitutionSeed({ institutions: [firm(), { name: '' }, firm({ id: 'example-capital', name: 'Twin' }), 'junk'] });
    expect(out.institutions.map((f) => f.id)).toEqual(['example-capital']);
    expect(out.institutions[0]).toMatchObject({ name: 'Example Capital', website: 'https://capital.example' });
    expect(out.problems.join('\n')).toMatch(/needs a name/);
    expect(out.problems.join('\n')).toMatch(/the id "example-capital" is already used/);
    expect(out.problems.join('\n')).toMatch(/not an object/);
  });

  it('never renders what is on hold, a placeholder, or marked as held, and only counts them', () => {
    const out = checkInstitutionSeed({
      institutions: [firm(), firm({ id: 'p', name: 'Placeholder Co', placeholder: true }), firm({ id: 'h', name: 'Held Co', hold: true }), firm({ id: 's', name: 'Status Co', status: 'hold' })],
      hold: [{ name: 'Unsure Ventures', issue: 'Cannot confirm the office' }],
    });
    expect(out.institutions.map((f) => f.name)).toEqual(['Example Capital']);
    expect(out.held.map((h) => h.name).sort()).toEqual(['Held Co', 'Placeholder Co', 'Status Co', 'Unsure Ventures']);
    expect(JSON.stringify(out.institutions)).not.toMatch(/Unsure|Held Co|Placeholder/);
  });

  it('keeps a firm with offices: [] or none, as a firm with no office to draw', () => {
    const out = checkInstitutionSeed({ institutions: [firm({ offices: [] }), firm({ id: 'b', name: 'B', offices: undefined })] });
    expect(out.institutions.map((f) => f.offices)).toEqual([[], []]);
    expect(out.problems).toEqual([]);
  });

  it('keeps both coordinates or neither, and drops an office with nothing to place it by', () => {
    const out = checkInstitutionSeed({ institutions: [firm({ offices: [office({ lat: -33.8, lng: 151.2 }), office({ lat: -33.8, lng: null }), { label: 'x' }, office({ lat: 200, lng: 10 })] })] });
    expect(out.institutions[0].offices.map((o) => [o.lat, o.lng])).toEqual([[-33.8, 151.2], [null, null], [null, null]]);
    expect(out.problems.join('\n')).toMatch(/lat and lng must both be numbers/);
    expect(out.problems.join('\n')).toMatch(/an office needs an address, a city or a point/);
  });

  it('takes the names other files use for the list and the point, and an https website only', () => {
    const out = checkInstitutionSeed([{ name: 'Alias Fund', website: 'http://alias.example', offices: [{ address: STREET, latitude: -33.8, longitude: 151.2 }] }]);
    expect(out.institutions[0].website).toBeNull();
    expect(out.institutions[0].offices[0]).toMatchObject({ lat: -33.8, lng: 151.2 });
    expect(out.institutions[0].id).toBe('alias-fund');
  });
});

describe('which offices may be drawn', () => {
  it('draws an office whose point the owner gave', () => {
    expect(judgeOffice(office({ lat: -37.81, lng: 144.96 }))).toMatchObject({ status: 'pin', lat: -37.81, lng: 144.96, how: 'given' });
  });

  it('does not draw an office with no street address: a city is not an office', () => {
    expect(judgeOffice(office({ address: null, city: 'Melbourne', state: 'VIC' }))).toMatchObject({ status: 'no_pin' });
    expect(judgeOffice(office({ address: null, city: null }))).toMatchObject({ status: 'no_pin', reason: 'the office has no address' });
  });

  it('leaves a street address nobody has asked about pending, with the question to ask', () => {
    expect(judgeOffice(office(), [])).toEqual({ status: 'pending', query: queryFor() });
  });

  it('draws an office the geocoder found to the house, in the state the address names, at the geocoder\'s point', () => {
    expect(judgeOffice(office(), [answer(office())])).toMatchObject({ status: 'pin', how: 'geocoder', lat: -33.87, lng: 151.21 });
  });

  it('flags, and does not draw, an answer that is only a street or a suburb, in another state, or nothing at all', () => {
    const street = judgeOffice(office(), [answer(office(), { quality: 'street' })]);
    expect(street.status).toBe('flagged');
    expect(street.reason).toMatch(/only the street/);
    const wrongState = judgeOffice(office(), [answer(office(), { address: { state: 'Victoria' } })]);
    expect(wrongState.status).toBe('flagged');
    expect(wrongState.reason).toMatch(/put it in VIC, not NSW/);
    expect(judgeOffice(office(), [answer(office(), { status: 'none' })])).toMatchObject({ status: 'flagged', reason: 'the geocoder knows nothing of that address' });
  });
});

describe('the pins and the report', () => {
  it('draws one pin per office that is settled, and reports every one that is not, with a firm that has no office listed only', () => {
    const checked = checkInstitutionSeed({
      institutions: [
        firm({ offices: [office({ lat: -37.81, lng: 144.96, label: 'Melbourne' }), office({ label: 'Sydney' })] }),
        firm({ id: 'flag', name: 'Flag Fund', offices: [office({ address: '9 Other Road, Perth WA 6000', city: 'Perth', state: 'WA', label: 'Perth' })] }),
        firm({ id: 'pend', name: 'Pending Fund', offices: [office({ address: '3 New Street, Brisbane QLD 4000', city: 'Brisbane', state: 'QLD', label: 'Brisbane' })] }),
        firm({ id: 'city', name: 'City Fund', offices: [office({ address: null, city: 'Adelaide', state: 'SA', label: 'Adelaide' })] }),
        firm({ id: 'none', name: 'No Office Fund', offices: [] }),
      ],
      hold: [{ name: 'Held Fund', issue: 'unsure' }],
    });
    const flagged = office({ address: '9 Other Road, Perth WA 6000', city: 'Perth', state: 'WA' });
    const { pins, report } = buildInstitutionPins(checked, [answer(office()), answer(flagged, { quality: 'suburb' })]);
    expect(pins.map((p) => [p.id, p.name, p.office])).toEqual([['example-capital#0', 'Example Capital', 'Melbourne'], ['example-capital#1', 'Example Capital', 'Sydney']]);
    expect(report.pinned).toBe(2);
    expect(report.flagged.map((r) => r.name)).toEqual(['Flag Fund']);
    expect(report.pending.map((r) => r.name)).toEqual(['Pending Fund']);
    expect(report.noPin.map((r) => r.name)).toEqual(['City Fund']);
    expect(report.noOffices).toEqual(['No Office Fund']);
    expect(report.held).toBe(1);
    expect(JSON.stringify(pins)).not.toMatch(/Held Fund|Flag Fund|Pending Fund|City Fund|No Office/);
  });
});

describe('GET /api/institutions/pins', () => {
  async function appOver({ seed, cache = [] }) {
    const f = await fixture(10);
    const dir = await tempDir();
    const files = { people: path.join(dir, 'people_seed.json'), seed: path.join(dir, 'institutions_seed.json'), cache: path.join(dir, 'geocode_cache.json') };
    await writeFile(files.people, JSON.stringify({ people: [], institutions: [], lists: [] }));
    if (seed) await writeFile(files.seed, JSON.stringify(seed));
    await writeFile(files.cache, JSON.stringify(cache));
    const investorCatalog = { snapshot: async () => ({ version: 'x', cards: [{ slug: 'example-capital', name: 'Example Capital', location: { city: 'Sydney' }, stages: [], sectors: [], website: null, verified_at: null }], profiles: new Map(), personProfiles: new Map() }) };
    const communityCatalog = createCommunityCatalog({ file: files.people, institutionsFile: files.seed, geocodeFile: files.cache, investorCatalog, production: true, reloadMs: 0 });
    return { app: createApp({ catalog: f.catalog, investorCatalog, communityCatalog }), files };
  }

  it('serves no pins, and does not fail, when there is no seed file', async () => {
    const { app } = await appOver({ seed: null });
    expect((await request(app).get('/api/institutions/pins')).body).toEqual({ count: 0, items: [] });
  });

  it('serves the settled offices, each beside the investor page that backs the firm, and nothing that is flagged, pending or on hold', async () => {
    const { app } = await appOver({
      seed: { institutions: [firm({ offices: [office(), office({ label: 'Melbourne', address: '5 Far Street, Melbourne VIC 3000', city: 'Melbourne', state: 'VIC' })] })], hold: [{ name: 'Held Fund', issue: 'x' }] },
      cache: [answer(office())],
    });
    const res = await request(app).get('/api/institutions/pins');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.items[0]).toEqual({
      id: 'example-capital#0', institution: 'example-capital', name: 'Example Capital', lat: -33.87, lng: 151.21, city: 'Sydney', state: 'NSW', place: STREET, office: 'Sydney',
      website: 'https://capital.example', href: '/investors/example-capital',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/how|Held Fund|flagged|pending|geocoder/);
  });

  it('picks up a newly geocoded address without a restart', async () => {
    const { app, files } = await appOver({ seed: { institutions: [firm()] }, cache: [] });
    expect((await request(app).get('/api/institutions/pins')).body.count).toBe(0);
    await writeFile(files.cache, JSON.stringify([answer(office())]));
    // the catalog answers from the last snapshot while it reloads in the background, so the first question after a change may still be the old
    // answer; the next one has the new
    await request(app).get('/api/institutions/pins');
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    expect((await request(app).get('/api/institutions/pins')).body.count).toBe(1);
  });
});

describe('the command line', () => {
  async function dirWith(seed) {
    const dir = await makeDataDir(dataset([co('Acme')]));
    if (seed) await writeFile(path.join(dir, 'institutions_seed.json'), JSON.stringify(seed));
    return dir;
  }
  const run = async (dir, args, deps = {}) => {
    const lines = [];
    const code = await pinsCli(args, { dataDir: dir, out: (s) => lines.push(s), ...deps });
    return { code, text: lines.join('\n') };
  };

  it('says so when there is no seed file, and draws nothing', async () => {
    const { code, text } = await run(await dirWith(null), ['status']);
    expect(code).toBe(0);
    expect(text).toMatch(/There is no institutions_seed.json/);
    expect(text).toMatch(/Institutions layer is hidden/);
  });

  it('reports what is pending, then asks the geocoder once for each address and keeps the answer', async () => {
    const dir = await dirWith({ institutions: [firm()] });
    expect((await run(dir, ['status'])).text).toMatch(/Pending[^\n]*: 1/);
    let asked = 0;
    const geocoder = { stopped: null, search: async () => { asked += 1; return { status: 'found', quality: 'house', result: answer(office()).result }; } };
    const first = await run(dir, ['geocode'], { geocoder });
    expect(asked).toBe(1);
    expect(first.text).toMatch(/Asked the geocoder about 1 address/);
    expect(first.text).toMatch(/Drawn: 1 office/);
    const second = await run(dir, ['geocode'], { geocoder });
    expect(asked).toBe(1); // asked once, and never again
    expect(second.text).toMatch(/Asked the geocoder about 0 addresses/);
  });

  it('stops, with exit code 2, when the geocoder asks it to', async () => {
    const dir = await dirWith({ institutions: [firm()] });
    const geocoder = { stopped: null, search: async () => { geocoder.stopped = 'the geocoder answered 429'; return { status: 'error', error: geocoder.stopped }; } };
    const { code, text } = await run(dir, ['geocode'], { geocoder });
    expect(code).toBe(2);
    expect(text).toMatch(/stopped early: the geocoder answered 429/);
  });
});
