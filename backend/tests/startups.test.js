import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';

describe('GET /api/startups', () => {
  it('returns all startups with no filters', async () => {
    const res = await request(app).get('/api/startups');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(213);
    expect(res.body.count).toBe(213);
    expect(res.body.results).toHaveLength(213);
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

  it('combines multiple filters', async () => {
    const res = await request(app).get('/api/startups?sector=Fintech&city=Sydney');
    expect(res.status).toBe(200);
    expect(res.body.results.every((s) => s.sector === 'Fintech' && s.city === 'Sydney')).toBe(true);
  });

  it('returns empty results for a search with no matches', async () => {
    const res = await request(app).get('/api/startups?search=zzzznotarealstartupzzzz');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.results).toEqual([]);
    expect(res.body.total).toBe(213);
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

