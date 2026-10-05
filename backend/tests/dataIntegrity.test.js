import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadRaw, parseRaw, serializeDataset, migrateDataset, validateDataset, getCompanyWithRelations,
  COLLECTION_FILES,
} from '../src/models/dataset.js';
import { ADDED_FIELDS, LEGACY_FIELDS } from '../src/models/company.js';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data');

let raw;
let ds;
beforeAll(async () => {
  raw = await loadRaw(DATA_DIR);
  ds = parseRaw(raw);
});

describe('shipped data files', () => {
  it('has every collection file on disk', () => {
    for (const file of Object.values(COLLECTION_FILES)) expect(raw[file], `${file} is missing`).not.toBeNull();
  });

  it('is up to date with the migration - run `npm run data:migrate` in backend/ if this fails', () => {
    const expected = serializeDataset(migrateDataset(ds));
    for (const [file, text] of Object.entries(expected)) expect(raw[file], `${file} is stale`).toBe(text);
  });

  it('passes every referential-integrity and enum check', () => {
    expect(validateDataset(ds)).toEqual([]);
  });

  // A ratchet: companies are only ever removed on purpose. If you really mean to
  // remove one, lower this floor in the same commit.
  it('has not silently lost companies', () => {
    expect(ds.companies.length).toBeGreaterThanOrEqual(216);
  });

  it('gives every company a unique id and slug and every v2 field', () => {
    expect(new Set(ds.companies.map((c) => c.id)).size).toBe(ds.companies.length);
    expect(new Set(ds.companies.map((c) => c.slug)).size).toBe(ds.companies.length);
    for (const c of ds.companies) {
      for (const key of [...LEGACY_FIELDS.filter((k) => !['address', 'founders', 'foundedYear'].includes(k)), ...ADDED_FIELDS]) {
        expect(c, `${c.name} is missing "${key}"`).toHaveProperty(key);
      }
    }
  });

  it('records no confidence score until a verification pipeline exists to compute one', () => {
    expect(ds.companies.every((c) => c.confidence_score === null)).toBe(true);
  });

  it('only claims a verification date for records that cite sources', () => {
    for (const c of ds.companies) {
      if (c.last_verified_at != null) expect(c.source_ids.length, `${c.name} has no sources`).toBeGreaterThan(0);
    }
  });

  it('asserts no state or country for unverified records, whose location is unconfirmed', () => {
    for (const c of ds.companies.filter((x) => !x.verified)) {
      expect(c.state).toBeNull();
      expect(c.country).toBeNull();
      expect(c.verification_status).toBe('unverified');
    }
  });

  it('has not guessed hiring_status for companies not known to be hiring', () => {
    for (const c of ds.companies.filter((x) => !x.hiring)) expect(c.hiring_status).toBeNull();
  });
});

describe('companies added from the owner-supplied research (2026-10-05)', () => {
  const company = (name) => ds.companies.find((c) => c.name === name);

  it('records Superstat with its sourced funding round and only corroborated claims', () => {
    const c = getCompanyWithRelations(ds, 'superstat');
    expect(c.stage).toBe('Pre-seed');
    expect(c.founders.map((p) => p.name)).toEqual(['Cordelia King', 'Kai Bloomfield', 'Sam Hung']);
    expect(c.investors.map((i) => i.name)).toEqual(['Blackbird', 'Startmate']);
    expect(c.funding_total).toBe(3500000);
    expect(c.funding_rounds).toHaveLength(1);
    expect(c.funding_rounds[0]).toMatchObject({ round: 'Pre-seed', amount: 3500000, currency: 'AUD', lead_investor_ids: ['blackbird'] });
    expect(c.last_funding_date).toBeNull();
    expect(c.sources.length).toBeGreaterThan(3);
  });

  it('does not store the pasted "$120k raised / $240k ARR" figures that conflict with the reported A$3.5M round', () => {
    const text = JSON.stringify(company('Superstat'));
    expect(text).not.toMatch(/120k|240k|120,000|240,000/);
  });

  it('records Fastlane at the address in its own privacy policy, without stated investors or traction claims', () => {
    const c = company('Fastlane');
    expect(c.address).toBe('17-19 Bridge Street, Sydney NSW 2000');
    expect(c.state).toBe('NSW');
    expect(c.investors).toEqual([]);
    expect(c.funding_total).toBeNull();
    expect(JSON.stringify(c)).not.toMatch(/ARR|1M\+|20,000/);
  });

  it('records Forward with the three founders both primary sources list - not the unconfirmed fourth', () => {
    const c = company('Forward');
    expect(c.founders).toEqual(['Daniel Yoon', 'Riley Janjis', 'Darryl Luo']);
    expect(JSON.stringify(c)).not.toContain('Freddie Harris');
    expect(c.address).toBeUndefined();
    expect(c.employee_range).toBe('1-10');
  });

  it('keeps "Latitude 37" (Airwallex program) separate from the existing "Latitude" investor', () => {
    const names = ds.investors.map((i) => i.name);
    expect(names).toContain('Latitude 37');
    expect(names).toContain('Latitude');
    expect(ds.investors.find((i) => i.name === 'Latitude 37').id).not.toBe(ds.investors.find((i) => i.name === 'Latitude').id);
  });

  it('merges the case-variant AirTree spellings into one investor with an alias', () => {
    const airtree = ds.investors.filter((i) => i.name.toLowerCase() === 'airtree');
    expect(airtree).toHaveLength(1);
    expect(airtree[0].aliases).toContain('Airtree');
  });
});
