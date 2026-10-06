import { describe, it, expect, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCompanies, writeFixture, SIZES } from '../scripts/scale/fixtures.js';
import real from '../src/data/startups.json' with { type: 'json' };
import { tempDir, removeTempDirs } from './helpers/catalog.js';

afterEach(removeTempDirs);
const REAL_DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data');

describe('synthetic companies for scale tests', () => {
  it('are the same every time for the same size and seed, and different for another seed', () => {
    expect(generateCompanies(300)).toEqual(generateCompanies(300));
    expect(generateCompanies(300, { seed: 2 })).not.toEqual(generateCompanies(300));
  });

  it('are unique at the largest size: no two share a name, id, slug or website', () => {
    const rows = generateCompanies(Math.max(...SIZES));
    for (const key of ['name', 'id', 'slug']) expect(new Set(rows.map((r) => r[key])).size, key).toBe(rows.length);
    const sites = rows.map((r) => r.website).filter(Boolean);
    expect(new Set(sites).size).toBe(sites.length);
  });

  it('have exactly the fields a real company record has', () => {
    const realKeys = new Set(real.flatMap((c) => Object.keys(c)));
    const keys = new Set(generateCompanies(500).flatMap((c) => Object.keys(c)));
    expect([...keys].sort()).toEqual([...realKeys].sort());
  });

  it('are invented: no real company, founder or investor, and websites only on the reserved .test domain', () => {
    const rows = generateCompanies(2000);
    const names = new Set(real.map((c) => c.name.toLowerCase()));
    const people = new Set(real.flatMap((c) => c.founders ?? []));
    const investors = new Set(real.flatMap((c) => c.investors));
    for (const r of rows) {
      expect(names.has(r.name.toLowerCase()), r.name).toBe(false);
      for (const f of r.founders ?? []) expect(people.has(f), f).toBe(false);
      for (const i of r.investors) expect(investors.has(i), i).toBe(false);
      if (r.website) expect(r.website, r.name).toMatch(/^https:\/\/www\.[a-z0-9-]+\.test$/);
    }
  });

  it('are shaped like the real directory: dense in Sydney and Melbourne, a third hiring, a few without a confirmed location', () => {
    const rows = generateCompanies(5000);
    const share = (pred) => rows.filter(pred).length / rows.length;
    expect(share((r) => r.city === 'Sydney')).toBeGreaterThan(0.4);
    expect(share((r) => r.city === 'Sydney')).toBeLessThan(0.52);
    expect(share((r) => r.city === 'Melbourne')).toBeGreaterThan(0.2);
    expect(share((r) => r.hiring)).toBeGreaterThan(0.28);
    expect(share((r) => r.hiring)).toBeLessThan(0.36);
    expect(share((r) => !r.verified)).toBeGreaterThan(0.04);
    expect(share((r) => !r.verified)).toBeLessThan(0.09);
    for (const r of rows) {
      if (['EXACT', 'SUBURB'].includes(r.location_precision)) { expect(r.lat).toBeGreaterThan(-44); expect(r.lat).toBeLessThan(-10); expect(r.lng).toBeGreaterThan(112); expect(r.lng).toBeLessThan(154); } else expect([r.lat, r.lng]).toEqual([null, null]);
    }
  });

  it('know where they are as well as the real directory does: mostly an exact office, some a suburb, a fifth only the city, and a city has no point', () => {
    const rows = generateCompanies(5000);
    const share = (pred) => rows.filter(pred).length / rows.length;
    const at = (precision) => share((r) => r.location_precision === precision);
    expect(at('EXACT')).toBeGreaterThan(0.64);
    expect(at('EXACT')).toBeLessThan(0.72);
    expect(at('SUBURB')).toBeGreaterThan(0.03);
    expect(at('SUBURB')).toBeLessThan(0.07);
    expect(at('CITY')).toBeGreaterThan(0.17);
    expect(at('CITY')).toBeLessThan(0.23);
    expect(at('UNKNOWN')).toBeCloseTo(share((r) => !r.verified), 10);
    for (const r of rows) {
      if (r.location_precision === 'EXACT') expect(r.address, r.name).toMatch(/^\d+ .+, .+, .+ [A-Z]+ \d{4}$/);
      if (r.location_precision === 'SUBURB') expect(r.address, r.name).toMatch(/^.+, .+ [A-Z]+ \d{4}$/);
      if (r.location_precision === 'CITY') expect(r.address, r.name).toBeUndefined();
      if (r.location_precision === 'UNKNOWN') expect([r.state, r.suburb, r.postcode, r.location_source], r.name).toEqual([null, null, null, null]);
    }
  });

  it('are valid companies once migrated: every location obeys the rules, whatever its precision', async () => {
    const { migrateDataset, validateDataset } = await import('../src/models/dataset.js');
    const ds = migrateDataset({ companies: generateCompanies(400), people: [], investors: [], sources: [], evidence: [], funding_rounds: [], jobs: [], news: [] });
    expect(validateDataset(ds)).toEqual([]);
    expect(ds.company_locations).toHaveLength(400);
  });

  it('are never written into the real data folder, or any src/data folder, whatever path is given', async () => {
    await expect(writeFixture(5, REAL_DATA)).rejects.toThrow(/refusing to write synthetic companies/);
    await expect(writeFixture(5, path.join(REAL_DATA, 'nested'))).rejects.toThrow(/refusing/);
    await expect(writeFixture(5, path.join(REAL_DATA, '..', 'data', '.'))).rejects.toThrow(/refusing/);
    await expect(writeFixture(5, path.join(await tempDir(), 'src', 'data'))).rejects.toThrow(/src\/data folder/);
  });

  it('are written to a folder you choose, as a startups.json that parses', async () => {
    const dir = await tempDir();
    const file = await writeFixture(25, dir);
    expect(JSON.parse(await readFile(file, 'utf8'))).toHaveLength(25);
    expect(path.basename(file)).toBe('startups.json');
  });
});
