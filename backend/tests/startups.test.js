import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import startups from '../src/data/startups.json' with { type: 'json' };
import sources from '../src/data/sources.json' with { type: 'json' };
import candidates from '../src/data/candidates.json' with { type: 'json' };
import identifiers from '../src/data/identifiers.json' with { type: 'json' };
import { INTERNAL_FIELDS } from '../src/models/company.js';

// Derived from the data file so adding a company never breaks these tests; the
// "don't silently lose companies" floor lives in dataIntegrity.test.js.
const TOTAL = startups.length;

describe('GET /api/startups', () => {
  it('returns all startups with no filters', async () => {
    const res = await request(app).get('/api/startups');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(TOTAL);
    expect(res.body.count).toBe(TOTAL);
    expect(res.body.results).toHaveLength(TOTAL);
  });

  it('keeps every legacy field the frontend reads, with the same types, on every record (schema v2 is additive)', async () => {
    const res = await request(app).get('/api/startups');
    for (const s of res.body.results) {
      expect(typeof s.name).toBe('string');
      for (const key of ['sector', 'sectorFull', 'city', 'stage', 'website', 'blurb']) expect(typeof s[key]).toBe('string');
      expect(Array.isArray(s.investors)).toBe(true);
      expect(typeof s.hiring).toBe('boolean');
      expect(typeof s.verified).toBe('boolean');
      expect(typeof s.taskGate.enabled).toBe('boolean');
      if (s.verified) expect(typeof s.lat).toBe('number');
    }
  });

  it('exposes a unique id and slug on every record', async () => {
    const res = await request(app).get('/api/startups');
    const ids = res.body.results.map((s) => s.id);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(TOTAL);
    expect(new Set(res.body.results.map((s) => s.slug)).size).toBe(TOTAL);
  });

  it('does not serve record-keeping or provenance, but keeps the facts and still filters on the full record', async () => {
    const res = await request(app).get('/api/startups');
    for (const s of res.body.results) {
      for (const key of INTERNAL_FIELDS) expect(s, `${s.name} exposes ${key}`).not.toHaveProperty(key);
      expect(typeof s.id).toBe('string');
    }
    // No source id appears anywhere in the payload.
    const payload = JSON.stringify(res.body);
    for (const { id } of sources) expect(payload, `source "${id}" leaked`).not.toContain(id);
    // A company that has sources still comes back with its public facts.
    const superstat = res.body.results.find((s) => s.name === 'Superstat');
    expect(superstat).toMatchObject({ id: 'superstat', state: 'VIC', hiring: true, hiring_status: 'hiring' });
    expect(superstat.founders).toEqual(['Cordelia King', 'Kai Bloomfield', 'Sam Hung']);
  });

  it('never serves a discovery candidate or an identifier: staging and internal data are not public', async () => {
    for (const p of ['/api/candidates', '/api/discovery', '/api/identifiers', '/api/review', '/api/startups/candidates', '/candidates.json', '/identifiers.json']) {
      expect((await request(app).get(p)).status, p).toBe(404);
    }
    const res = await request(app).get('/api/startups');
    const payload = JSON.stringify(res.body);
    const companyNames = new Set(startups.map((s) => s.name));
    for (const c of candidates) {
      expect(payload, `candidate id ${c.id} leaked`).not.toContain(c.id);
      if (!companyNames.has(c.name)) expect(payload, `candidate "${c.name}" is in the public list`).not.toContain(`"${c.name}"`);
      expect((await request(app).get(`/api/startups?search=${encodeURIComponent(c.name)}`)).body.results.map((s) => s.name), c.name).not.toContain(c.name);
    }
    for (const i of identifiers) expect(res.body.results.every((s) => !('identifiers' in s)), `identifier ${i.id}`).toBe(true);
    const directory = (await request(app).get('/directory')).text;
    for (const c of candidates) if (!companyNames.has(c.name)) expect(directory, `candidate "${c.name}" is in /directory`).not.toContain(c.name);
  });

  it('includes the three companies added from the owner-supplied research, findable by name and by founder', async () => {
    const byName = await request(app).get('/api/startups?search=Superstat');
    expect(byName.body.count).toBe(1);
    expect(byName.body.results[0].founders).toEqual(['Cordelia King', 'Kai Bloomfield', 'Sam Hung']);

    const byFounder = await request(app).get('/api/startups?search=Daniel Yoon');
    expect(byFounder.body.results.map((s) => s.name)).toEqual(['Forward']);

    const sydneyHiring = await request(app).get('/api/startups?city=Sydney&hiring=yes');
    expect(sydneyHiring.body.results.map((s) => s.name)).toContain('Fastlane');
  });

  it('lists the new investors in the filter metadata, keeping "Latitude 37" distinct from the existing "Latitude"', async () => {
    const res = await request(app).get('/api/startups/meta');
    expect(res.body.investors).toEqual(expect.arrayContaining(['Y Combinator', 'NextGen Ventures', 'Latitude 37', 'Latitude']));
  });

  it('offers no investor whose only claim was an unconfirmed lead: Lyra Capital and AirTree came off Forward', async () => {
    const meta = await request(app).get('/api/startups/meta');
    expect(meta.body.investors).not.toContain('Lyra Capital');
    expect(meta.body.investors).toContain('AirTree'); // other companies list it
    const forward = (await request(app).get('/api/startups?search=Forward')).body.results.find((s) => s.name === 'Forward');
    expect(forward.investors).toEqual(['Y Combinator', 'Startmate', 'NextGen Ventures', 'Latitude 37']);
  });

  it('lists Forward as Unconfirmed, not on the map, because its headquarters is in San Francisco', async () => {
    const forward = (await request(app).get('/api/startups?search=Daniel Yoon')).body.results[0];
    expect(forward).toMatchObject({ name: 'Forward', verified: false, city: 'Unknown', lat: null, lng: null, state: null });
    const sydney = await request(app).get('/api/startups?city=Sydney');
    expect(sydney.body.results.map((s) => s.name)).not.toContain('Forward');
  });

  it("serves Superstat with the lead investor's round label and the founding year the press states", async () => {
    const superstat = (await request(app).get('/api/startups?search=Superstat')).body.results[0];
    expect(superstat).toMatchObject({ stage: 'Seed', last_funding_round: 'Seed', foundedYear: 2025 });
  });

  it('filters by search (case-insensitive, partial match)', async () => {
    const res = await request(app).get('/api/startups?search=canva');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.results[0].name).toBe('Canva');
  });

  it('filters by sector', async () => {
    const res = await request(app).get('/api/startups?sector=Fintech');
    expect(res.status).toBe(200);
    expect(res.body.results.every((s) => s.sector === 'Fintech')).toBe(true);
    expect(res.body.count).toBeGreaterThan(0);
  });

  it('filters by city', async () => {
    const res = await request(app).get('/api/startups?city=Adelaide');
    expect(res.status).toBe(200);
    expect(res.body.results.every((s) => s.city === 'Adelaide')).toBe(true);
    expect(res.body.count).toBeGreaterThan(0);
  });

  it('filters by investor', async () => {
    const res = await request(app).get('/api/startups?investor=Rampersand');
    expect(res.status).toBe(200);
    expect(res.body.results.every((s) => s.investors.includes('Rampersand'))).toBe(true);
    expect(res.body.count).toBeGreaterThan(0);
  });

  it('filters by stage', async () => {
    const res = await request(app).get('/api/startups?stage=Unicorn');
    expect(res.status).toBe(200);
    expect(res.body.results.every((s) => s.stage === 'Unicorn')).toBe(true);
    expect(res.body.count).toBeGreaterThan(0);
  });

  it('filters hiring=yes', async () => {
    const res = await request(app).get('/api/startups?hiring=yes');
    expect(res.status).toBe(200);
    expect(res.body.results.every((s) => s.hiring === true)).toBe(true);
  });

  it('filters hiring=no', async () => {
    const res = await request(app).get('/api/startups?hiring=no');
    expect(res.status).toBe(200);
    expect(res.body.results.every((s) => s.hiring === false)).toBe(true);
    expect(res.body.count).toBeGreaterThan(0);
  });

  it('filters taskGate=yes', async () => {
    const res = await request(app).get('/api/startups?taskGate=yes');
    expect(res.status).toBe(200);
    expect(res.body.results.every((s) => s.taskGate.enabled === true)).toBe(true);
    expect(res.body.count).toBeGreaterThan(0);
  });

  it('filters taskGate=no', async () => {
    const res = await request(app).get('/api/startups?taskGate=no');
    expect(res.status).toBe(200);
    expect(res.body.results.every((s) => s.taskGate.enabled === false)).toBe(true);
    expect(res.body.count).toBeGreaterThan(0);
  });

  it('filters by a comma-separated sector list, matching any one of them (curated lists use this to roll up real sector variants)', async () => {
    const res = await request(app).get('/api/startups?sector=HealthTech,Healthtech');
    expect(res.status).toBe(200);
    expect(res.body.results.every((s) => s.sector === 'HealthTech' || s.sector === 'Healthtech')).toBe(true);
    expect(res.body.count).toBeGreaterThan(0);
  });

  it('filters by a comma-separated city list, matching any one of them', async () => {
    const res = await request(app).get('/api/startups?city=Sydney,Sydney (Chippendale)');
    expect(res.status).toBe(200);
    expect(res.body.results.every((s) => s.city === 'Sydney' || s.city === 'Sydney (Chippendale)')).toBe(true);
    expect(res.body.count).toBeGreaterThan(0);
  });

  it('combines multiple filters', async () => {
    const res = await request(app).get('/api/startups?sector=Fintech&city=Sydney');
    expect(res.status).toBe(200);
    expect(res.body.results.every((s) => s.sector === 'Fintech' && s.city === 'Sydney')).toBe(true);
  });

  it('filters by search matching a founder name, not just the company name', async () => {
    const res = await request(app).get('/api/startups?search=Melanie Perkins');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.results[0].name).toBe('Canva');
  });

  it('returns empty results for a search with no matches', async () => {
    const res = await request(app).get('/api/startups?search=zzzznotarealstartupzzzz');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.results).toEqual([]);
    expect(res.body.total).toBe(TOTAL);
  });
});

describe('GET /api/startups/meta', () => {
  it('returns sorted, de-duplicated filter option lists', async () => {
    const res = await request(app).get('/api/startups/meta');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('sectors');
    expect(res.body).toHaveProperty('cities');
    expect(res.body).toHaveProperty('investors');
    expect(res.body).toHaveProperty('stages');

    expect(res.body.sectors).toContain('Fintech');
    expect(res.body.cities).toContain('Sydney');
    expect(res.body.investors).toContain('Blackbird');

    const isSorted = (arr) => JSON.stringify(arr) === JSON.stringify([...arr].sort());
    expect(isSorted(res.body.sectors)).toBe(true);

    const isUnique = (arr) => new Set(arr).size === arr.length;
    expect(isUnique(res.body.sectors)).toBe(true);
    expect(isUnique(res.body.investors)).toBe(true);
  });
});

