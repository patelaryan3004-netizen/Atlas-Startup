import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import app from '../src/app.js';
import { createApp } from '../src/app.js';
import { createCatalog, MARKER_FIELDS } from '../src/catalog/catalog.js';
import { BIG_CITIES, metroOf } from '../src/geo/metro.js';
import { tempDir, removeTempDirs } from './helpers/catalog.js';
// The map page's national view counts its city badges with the frontend's own code. The badge and the city's view must agree, so this is the one test that runs both
// halves together: the server's answer for the national map, counted by the frontend, against the server's answer for the city.
import { cityBadges, kmBetween } from '../../frontend/src/atlas/cities.js';
import { cityView } from '../../frontend/src/cityViews.js';

afterEach(removeTempDirs);

const METRO = MARKER_FIELDS.indexOf('metro');
const LNG = MARKER_FIELDS.indexOf('lng');
const LAT = MARKER_FIELDS.indexOf('lat');
const SLUG = MARKER_FIELDS.indexOf('slug');

const company = (name, over = {}) => {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return {
    id, slug: id, name, sector: 'SaaS', sectorFull: 'SaaS', city: 'Sydney', state: 'NSW', country: 'Australia', lat: -33.8848, lng: 151.2098, investors: [], stage: 'Seed', hiring: false,
    verified: true, website: `https://${id}.test`, blurb: 'x', taskGate: { enabled: false }, suburb: 'Surry Hills', postcode: '2010',
    address: '110 Kippax Street, Surry Hills, Sydney NSW 2010', location_precision: 'EXACT', location_source: 'directory_record', location_source_url: null,
    location_verified_at: null, location_confidence: 'low', ...over,
  };
};

// Companies that exercise the assignment: the offices in the middle of a city, a suburban office well beyond 20 km from the middle (Penrith's postcode is Sydney's), a
// regional town that belongs to no city, a company in a suburb that names itself, and one whose own city name and postcode disagree.
const ROWS = () => [
  company('Sydney Core'),
  company('Penrith Office', { city: 'Penrith', suburb: 'Penrith', postcode: '2750', address: '1 High Street, Penrith NSW 2750', lat: -33.7506, lng: 150.6942 }),
  company('Orange Regional', { city: 'Orange', suburb: 'Orange', postcode: '2800', address: '5 Summer Street, Orange NSW 2800', lat: -33.2839, lng: 149.1012 }),
  company('Melbourne Core', { city: 'Melbourne', state: 'VIC', suburb: 'Melbourne', postcode: '3000', address: '1 Collins Street, Melbourne VIC 3000', lat: -37.8136, lng: 144.9631 }),
  company('Carlton Office', { city: 'Carlton', state: 'VIC', suburb: 'Carlton', postcode: '3053', address: '10 Lygon Street, Carlton VIC 3053', lat: -37.7974, lng: 144.971, sector: 'AI', sectorFull: 'AI' }),
  company('Perth Core', { city: 'Perth', state: 'WA', suburb: 'Perth', postcode: '6000', address: '1 St Georges Terrace, Perth WA 6000', lat: -31.9505, lng: 115.8605 }),
  company('Carwoola Farm', { city: 'Carwoola', suburb: 'Carwoola', postcode: '2620', address: '1 Captains Flat Road, Carwoola NSW 2620', lat: -35.3922, lng: 149.367 }), // 25 km from Canberra, and not Canberra's
  company('Mixed Signals', { city: 'Melbourne', state: 'NSW', suburb: 'Surry Hills', postcode: '2010', address: '2 Crown Street, Surry Hills NSW 2010', lat: -33.884, lng: 151.21 }), // its own city says Melbourne, its postcode Sydney
  company('Town Only', { precision: 'x', location_precision: 'CITY', lat: null, lng: null, city: 'Sydney' }),
];

async function fixtureApp(rows) {
  const dir = await tempDir();
  const file = path.join(dir, 'startups.json');
  await writeFile(file, `${JSON.stringify(rows, null, 2)}\n`);
  const catalog = createCatalog({ file, reloadMs: 0 });
  await catalog.refresh();
  return createApp({ catalog });
}

const ask = async (server, filters = {}) => {
  const query = new URLSearchParams(filters).toString();
  return (await request(server).get(`/api/startups/markers${query ? `?${query}` : ''}`).expect(200)).body;
};
const sorted = (points) => points.map(([a, b]) => `${a},${b}`).sort();

// What the badge says against what opening the city shows, under the same filters: the same number of pins, at the same places.
async function expectBadgesToMatchTheCities(server, filters) {
  const national = await ask(server, filters);
  const badges = cityBadges({ markers: national.items });
  for (const city of BIG_CITIES) {
    const opened = await ask(server, { ...filters, city });
    const badge = badges.find((b) => b.city === city);
    expect({ city, count: badge?.count ?? 0 }).toEqual({ city, count: opened.items.length });
    expect(sorted(badge?.points ?? [])).toEqual(sorted(opened.items.map((t) => [t[LAT], t[LNG]])));
  }
  return { national, badges };
}

describe('the pins say which big city they are in', () => {
  it('carries each pin\'s metro as the city filter assigns it: one of the ten, or null', async () => {
    const server = await fixtureApp(ROWS());
    const { items } = await ask(server);
    const metroOfSlug = Object.fromEntries(items.map((t) => [t[SLUG], t[METRO]]));
    expect(metroOfSlug).toEqual({
      'sydney-core': 'Sydney', 'penrith-office': 'Sydney', 'orange-regional': null, 'melbourne-core': 'Melbourne', 'carlton-office': 'Melbourne',
      'perth-core': 'Perth', 'carwoola-farm': null, 'mixed-signals': 'Sydney',
    });
    for (const row of ROWS().filter((r) => r.lat != null)) expect(metroOfSlug[row.slug]).toBe(metroOf(row) ?? null); // the one assignment, the one the filter reads
    expect(Object.values(metroOfSlug).filter(Boolean).every((m) => BIG_CITIES.includes(m))).toBe(true);
  });

  it('keeps coordinates as stored and makes no pin for a company known only to its city', async () => {
    const server = await fixtureApp(ROWS());
    const { items, areas } = await ask(server);
    expect(items.map((t) => t[SLUG])).not.toContain('town-only');
    expect(areas.some((a) => a.city === 'Sydney')).toBe(true); // it is a group at its city, as before
    const penrith = items.find((t) => t[SLUG] === 'penrith-office');
    expect([penrith[LAT], penrith[LNG]]).toEqual([-33.7506, 150.6942]);
  });
});

describe('a city badge counts exactly the pins that opening the city shows', () => {
  it('on synthetic companies, including a suburban office beyond 20 km and a regional pin that is in no metro', async () => {
    const server = await fixtureApp(ROWS());
    const { national, badges } = await expectBadgesToMatchTheCities(server, {});
    // the suburban office is more than 20 km from the middle of Sydney and is in Sydney's badge, and in Sydney's view, because the postcode says so
    const sydney = cityView('Sydney');
    const penrith = national.items.find((t) => t[SLUG] === 'penrith-office');
    expect(kmBetween(sydney.lat, sydney.lng, penrith[LAT], penrith[LNG])).toBeGreaterThan(20);
    expect((await ask(server, { city: 'Sydney' })).items.map((t) => t[SLUG])).toContain('penrith-office');
    expect(badges.find((b) => b.city === 'Sydney').points).toContainEqual([penrith[LAT], penrith[LNG]]);
    // the regional pin is a pin: it is on the national map, and in no badge and in no city's view
    const orange = national.items.find((t) => t[SLUG] === 'orange-regional');
    expect(orange).toBeTruthy();
    for (const badge of badges) expect(badge.points).not.toContainEqual([orange[LAT], orange[LNG]]);
    for (const city of BIG_CITIES) expect((await ask(server, { city })).items.map((t) => t[SLUG])).not.toContain('orange-regional');
    // ...and so is the town 25 km from Canberra that is not Canberra's: no Canberra badge, and no pins when Canberra is opened
    expect(badges.find((b) => b.city === 'Canberra')).toBeUndefined();
    expect((await ask(server, { city: 'Canberra' })).items).toEqual([]);
    // a company whose own city and whose postcode name two cities is in both cities' views, and so in both badges
    expect((await ask(server, { city: 'Melbourne' })).items.map((t) => t[SLUG])).toContain('mixed-signals');
    expect((await ask(server, { city: 'Sydney' })).items.map((t) => t[SLUG])).toContain('mixed-signals');
  });

  it('under the same filters: the badges follow the sector, the stage and the search as the city does', async () => {
    const server = await fixtureApp(ROWS());
    for (const filters of [{ sector: 'SaaS' }, { sector: 'AI' }, { search: 'core' }, { stage: 'Seed' }, { sector: 'SaaS', stage: 'Seed' }]) {
      await expectBadgesToMatchTheCities(server, filters);
    }
    const ai = await expectBadgesToMatchTheCities(server, { sector: 'AI' });
    expect(ai.badges.map((b) => [b.city, b.count])).toEqual([['Melbourne', 1]]); // (only the Carlton office is AI)
  });
});

describe('the same check on the real directory', () => {
  it('Melbourne + SaaS: the badge is what opening Melbourne shows, at the same places (whatever today\'s counts are)', async () => {
    const { badges } = await expectBadgesToMatchTheCities(app, { sector: 'SaaS' });
    const opened = await ask(app, { sector: 'SaaS', city: 'Melbourne' });
    expect(opened.items.length).toBeGreaterThan(0); // (so the check is not an empty one)
    expect(badges.find((b) => b.city === 'Melbourne').count).toBe(opened.items.length);
  });

  it('every city, with no filter and with a few, and with the type the map page offers', async () => {
    for (const filters of [{}, { sector: 'SaaS' }, { orgType: 'startup' }, { orgType: 'company' }, { stage: 'Seed' }, { hiring: 'yes' }]) {
      await expectBadgesToMatchTheCities(app, filters);
    }
  });

  it('gives every pin a metro that is one of the ten, or null, and leaves the pins where they were stored', async () => {
    const { items, pinned } = await ask(app);
    expect(items).toHaveLength(pinned);
    expect(items.every((t) => t.length === MARKER_FIELDS.length)).toBe(true);
    expect(items.every((t) => t[METRO] === null || BIG_CITIES.includes(t[METRO]))).toBe(true);
    expect(items.every((t) => Number.isFinite(t[LAT]) && Number.isFinite(t[LNG]))).toBe(true);
  });
});
