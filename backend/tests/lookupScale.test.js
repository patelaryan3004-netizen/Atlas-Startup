import { describe, it, expect } from 'vitest';
import { migrateDataset, validateDataset } from '../src/models/dataset.js';
import { generateCompanies } from '../scripts/scale/fixtures.js';
import { co, dataset, source, evidenceRow, ISO } from './helpers/locations.js';

// Validating the dataset runs on every commit. It looked up each company's founders and investors, and each evidence row's twins, by
// reading a table through once per item, so the time grew faster than the directory (about 1.6 s for 4,000 companies on a quiet machine, now
// near 0.2 s). These pin what it answers (the lookups are by index now) and that it stays quick.

const problems = (ds) => validateDataset(ds);

describe('looking up what a company names', () => {
  const base = () => dataset([co('Acme', { investors: ['Blackbird'], founders: ['Ann Founder'] })]);

  it('finds an investor by any spelling it has, whatever the case and spacing, when the company links it', () => {
    const ds = base();
    ds.investors[0].aliases.push('Blackbird Ventures');
    ds.companies[0].investors = ['  BLACKBIRD   ventures '];
    expect(problems(ds)).toEqual([]);
  });

  it('says an investor is not linked when the company names it and does not link it', () => {
    const ds = base();
    ds.companies[0].investor_ids = [];
    expect(problems(ds).join('\n')).toMatch(/investor "Blackbird" is not linked in investor_ids/);
  });

  it('says so when a company names an investor no record has', () => {
    const ds = base();
    ds.companies[0].investors = ['Nobody Capital'];
    expect(problems(ds).join('\n')).toMatch(/investor "Nobody Capital" is not linked in investor_ids/);
  });

  it('takes the first investor that has a spelling when two have it, as reading the table in order did', () => {
    const ds = dataset([co('Acme', { investors: ['Alpha'] }), co('Beta Co', { investors: ['Beta'] })]);
    // "Alpha" is also an alias of the second investor: the first one is the match, and the company links the first
    ds.investors[1].aliases.push('Alpha');
    expect(problems(ds)).toEqual([]);
    ds.companies[0].investor_ids = [ds.investors[1].id];
    expect(problems(ds).join('\n')).toMatch(/investor "Alpha" is not linked in investor_ids/);
  });

  it('finds a founder by id, and says when the id is not a person', () => {
    expect(problems(base())).toEqual([]);
    const ds = base();
    ds.companies[0].founder_ids = ['ghost'];
    expect(problems(ds).join('\n')).toMatch(/unknown founder id "ghost"/);
  });

  it('says when a founder id is a different person from the name beside it', () => {
    const ds = dataset([co('Acme', { founders: ['Ann Founder', 'Bob Founder'] })]);
    const [ann, bob] = ds.companies[0].founder_ids;
    ds.companies[0].founder_ids = [bob, ann];
    expect(problems(ds).join('\n')).toMatch(/does not match founders\[0\]/);
  });
});

describe('a claim a source makes twice', () => {
  const ds = (rows) => dataset([{ ...co('Acme'), id: 'acme', slug: 'acme' }], { sources: [source('a'), source('b')], evidence: rows });
  const text = (rows) => problems(ds(rows)).join('\n');

  it('is flagged when the same source says the same value for the same field twice', () => {
    expect(text([evidenceRow('acme', 'description', 'A company.', 'a', { id: 'one' }), evidenceRow('acme', 'description', 'A company.', 'a', { id: 'two' })])).toMatch(/repeats a claim this source already makes/);
  });

  it('is not flagged when another source says it, or the same source says another value, or the field differs', () => {
    expect(text([evidenceRow('acme', 'description', 'A company.', 'a', { id: 'one' }), evidenceRow('acme', 'description', 'A company.', 'b', { id: 'two' })])).toBe('');
    expect(text([evidenceRow('acme', 'description', 'A company.', 'a', { id: 'one' }), evidenceRow('acme', 'description', 'Another line.', 'a', { id: 'two' })])).toBe('');
    expect(text([evidenceRow('acme', 'description', 'Acme', 'a', { id: 'one' }), evidenceRow('acme', 'website', 'https://acme.example', 'a', { id: 'two' })])).toBe('');
  });
});

describe('validating a large directory', () => {
  it('validates 4,000 companies and 12,000 pieces of evidence in well under two seconds', () => {
    const n = 4000;
    const pool = Array.from({ length: 300 }, (_, i) => `Investor ${i} Capital`);
    const companies = generateCompanies(n).map((c, i) => ({ ...c, investors: [pool[i % pool.length], pool[(i * 7 + 3) % pool.length]], founders: [`Founder ${i}`, `Cofounder ${i}`] }));
    const sources = companies.map((c, i) => ({ id: `s${i}`, kind: 'company_website', url: `https://c${i}.example/`, title: `c${i}`, publisher: null, retrieved_at: ISO, note: '' }));
    const evidence = companies.flatMap((c, i) => ['description', 'website', 'city'].map((field) => ({
      id: `e${i}.${field}`, company_id: c.id ?? c.slug, field, value: field === 'website' ? c.website || `https://c${i}.example` : field === 'city' ? c.city : (c.blurb || 'A company.'), source_id: `s${i}`,
      confidence: 'medium', verified_at: ISO, status: 'active', note: null,
    })));
    const ds = migrateDataset({ companies, people: [], investors: [], sources, evidence, funding_rounds: [], jobs: [], news: [] });
    const started = performance.now();
    const found = validateDataset(ds);
    const ms = performance.now() - started;
    expect(found).toEqual([]);
    expect(ms).toBeLessThan(2000); // measured near 200 ms (about 1.6 s when each lookup read a table). A guard against a gross slowdown, with room for a loaded machine.
  });
});
