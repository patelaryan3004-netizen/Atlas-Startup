import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { writeFile, cp, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir, removeTempDirs } from './helpers/catalog.js';
import { createApp } from '../src/app.js';
import { createCatalog, backedFacts, select, readFilters, suggest } from '../src/catalog/catalog.js';
import { CSV_COLUMNS } from '../src/catalog/exportCsv.js';
import { generateCompanies } from '../scripts/scale/fixtures.js';
import { COHORTS, COHORT_IDS, cohortTerms, programOf, isCohort } from '../src/models/cohorts.js';
import { loadRaw, parseRaw, migrateDataset, validateDataset } from '../src/models/dataset.js';
import { canonicalDomain } from '../src/models/identity.js';

afterEach(removeTempDirs);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', 'src', 'data');
const ago = (days) => new Date(Date.now() - days * 86400000).toISOString().replace(/\.\d+Z$/, 'Z');

// Ten synthetic companies: 0 is in Startmate Winter 2026 and Startmate's page says so; 1 says it is but only a low-confidence lead supports it;
// 2 says it is and nothing backs it; the rest have no cohort.
async function world() {
  const dir = await tempDir();
  const rows = generateCompanies(10, { seed: 5 }).map((r) => ({ ...r }));
  const evidence = [];
  const back = (i, value, { confidence = 'high', source = 's-startmate', verified_at = ago(1) } = {}) => evidence.push({
    id: `${rows[i].id}.cohorts.${source}.${evidence.length}`, company_id: rows[i].id, field: 'cohorts', value, source_id: source, confidence, verified_at, status: 'active', note: null,
  });
  rows[0].cohorts = ['startmate-w26']; back(0, 'startmate-w26'); back(0, 'startmate-w26', { source: 's-article' });
  rows[1].cohorts = ['startmate-w26']; back(1, 'startmate-w26', { confidence: 'low', verified_at: null });
  rows[2].cohorts = ['startmate-w26'];
  const sources = [
    { id: 's-startmate', kind: 'accelerator_profile', url: 'https://www.startmate.test/portfolio-companies/acme', title: 'Acme', publisher: 'Startmate', retrieved_at: ago(1), note: null },
    { id: 's-article', kind: 'accelerator_profile', url: 'https://www.startmate.test/writing/cohort', title: 'Cohort', publisher: 'Startmate', retrieved_at: ago(1), note: null },
  ];
  for (const [name, data] of [['startups.json', rows], ['sources.json', sources], ['evidence.json', evidence], ['jobs.json', []]]) await writeFile(path.join(dir, name), `${JSON.stringify(data, null, 2)}\n`);
  const catalog = createCatalog({ file: path.join(dir, 'startups.json'), reloadMs: 0 });
  await catalog.refresh();
  return { rows, catalog, app: createApp({ catalog }), snap: await catalog.snapshot() };
}

describe('the cohort registry', () => {
  it('knows Startmate Winter 2026 and its searchable words', () => {
    expect(COHORT_IDS).toContain('startmate-w26');
    expect(COHORTS['startmate-w26']).toMatchObject({ accelerator: 'Startmate', cohort: 'Winter 2026', label: 'Startmate · Winter 2026' });
    expect(COHORTS['startmate-w26'].aliases).toContain('W26');
    const terms = cohortTerms('startmate-w26');
    for (const t of ['startmate', 'winter 2026', 'w26', 'startmate w26', 'startmate winter 2026']) expect(terms).toContain(t);
    expect(cohortTerms('nope')).toEqual([]);
    expect(isCohort('startmate-w26')).toBe(true);
    expect(isCohort('toString')).toBe(false);
  });

  it('describes a cohort with the page that says a company was in it', () => {
    expect(programOf('startmate-w26', { url: 'https://x.test/', verified_at: '2026-10-21T00:00:00Z' })).toMatchObject({ id: 'startmate-w26', label: 'Startmate · Winter 2026', source_url: 'https://x.test/', verified_at: '2026-10-21T00:00:00Z' });
    expect(programOf('startmate-w26').source_url).toBeNull();
  });
});

describe('a cohort is served only where a public page backs it', () => {
  it('serves it with the page behind it and the day it was read', async () => {
    const { app, rows } = await world();
    const res = await request(app).get(`/api/startups/${rows[0].slug}`);
    expect(res.body.cohorts).toEqual(['startmate-w26']);
    expect(res.body.programs).toEqual([expect.objectContaining({ id: 'startmate-w26', accelerator: 'Startmate', cohort: 'Winter 2026', label: 'Startmate · Winter 2026', aliases: expect.arrayContaining(['W26']), source_url: expect.stringContaining('startmate.test'), verified_at: expect.stringMatching(/^\d{4}-/) })]);
    expect(res.body.facts.cohorts).toEqual({ source_url: expect.stringContaining('startmate.test'), verified_at: expect.any(String) });
  });

  it('does not serve one that nothing backs, or only a low-confidence lead supports', async () => {
    const { app, rows } = await world();
    for (const i of [1, 2]) {
      const res = await request(app).get(`/api/startups/${rows[i].slug}`);
      expect(res.body.cohorts ?? null).toBeNull();
      expect(res.body.programs).toBeUndefined();
    }
  });

  it('keeps only the cohorts a page names', () => {
    const found = { facts: { cohorts: [{ value: 'startmate-w26', url: 'https://a.test/', verified_at: null }] } };
    expect(backedFacts({ cohorts: ['startmate-w26'] }, found).values.cohorts).toEqual(['startmate-w26']);
    expect(backedFacts({ cohorts: ['startmate-w26'] }, undefined).values.cohorts).toBeNull();
  });

  it('puts the cohort on a card', async () => {
    const { app, rows } = await world();
    const res = await request(app).get('/api/startups?view=card&limit=200');
    const card = res.body.results.find((c) => c.slug === rows[0].slug);
    expect(card.programs[0].label).toBe('Startmate · Winter 2026');
    expect(res.body.results.filter((c) => c.programs).length).toBe(1);
  });
});

describe('finding the companies of a cohort', () => {
  it('filters by cohort, and the filtered answer is not served for the unfiltered question', async () => {
    const { app, rows } = await world();
    const all = await request(app).get('/api/startups?view=card&limit=200');
    const some = await request(app).get('/api/startups?view=card&limit=200&cohort=startmate-w26');
    const none = await request(app).get('/api/startups?view=card&limit=200&cohort=nope');
    expect(all.body.count).toBe(10);
    expect(some.body.results.map((r) => r.slug)).toEqual([rows[0].slug]);
    expect(none.body.count).toBe(0);
    expect((await request(app).get('/api/startups/count?cohort=startmate-w26')).body.count).toBe(1);
    expect((await request(app).get('/api/startups/markers?cohort=startmate-w26')).body.count).toBe(1);
    expect((await request(app).get('/api/startups/summary?cohort=startmate-w26')).body.count).toBe(1);
  });

  it('finds them by searching for the accelerator, the intake or its alias', async () => {
    const { snap, rows } = await world();
    const found = (search) => [...select(snap, readFilters({ search }))].map((i) => snap.records[i].slug);
    for (const q of ['startmate', 'Startmate', 'W26', 'w26', 'winter 2026', 'Startmate Winter 2026', 'startmate w26']) expect(found(q), q).toEqual([rows[0].slug]);
    expect(found('antler')).toEqual([]);
  });

  it('lists the cohort among the filter options only while some company is in it, and suggests it', async () => {
    const { app, snap } = await world();
    const meta = (await request(app).get('/api/startups/meta')).body;
    expect(meta.cohorts).toEqual([{ id: 'startmate-w26', label: 'Startmate · Winter 2026', accelerator: 'Startmate', cohort: 'Winter 2026', count: 1 }]);
    expect(suggest(snap, 'w2').cohorts).toEqual([{ id: 'startmate-w26', label: 'Startmate · Winter 2026', count: 1 }]);
    expect(suggest(snap, 'zzz').cohorts).toEqual([]);
  });

  it('puts the cohort in the spreadsheet', async () => {
    const { app } = await world();
    expect(CSV_COLUMNS.map(([n]) => n)).toEqual(expect.arrayContaining(['accelerator_cohorts', 'accelerator_cohort_source_url', 'accelerator_cohort_verified_at']));
    const res = await request(app).get('/api/startups/export.csv?cohort=startmate-w26').buffer(true).parse((r, cb) => { const parts = []; r.on('data', (d) => parts.push(d)); r.on('end', () => cb(null, Buffer.concat(parts).toString('utf8'))); });
    const lines = res.body.trim().split(/\r?\n/);
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain('Startmate · Winter 2026');
  });
});

describe('the dataset checks a cohort', () => {
  it('refuses a cohort the registry does not know, an empty list and a repeat', async () => {
    const ds = migrateDataset(structuredClone(parseRaw(await loadRaw(DATA))));
    const bad = (cohorts) => { const copy = structuredClone(ds); copy.companies[0].cohorts = cohorts; return validateDataset(copy).filter((e) => /cohorts must be/.test(e)); };
    expect(bad(['startmate-w26'])).toEqual([]);
    expect(bad(['nope'])).toHaveLength(1);
    expect(bad([])).toHaveLength(1);
    expect(bad(['startmate-w26', 'startmate-w26'])).toHaveLength(1);
  });

  it('refuses cohort evidence that names a cohort the registry does not know', async () => {
    const ds = migrateDataset(structuredClone(parseRaw(await loadRaw(DATA))));
    const row = ds.evidence.find((e) => e.field === 'cohorts');
    const copy = structuredClone(ds);
    copy.evidence.find((e) => e.id === row.id).value = 'nope';
    expect(validateDataset(copy).some((e) => /value for "cohorts" must be one of/.test(e))).toBe(true);
  });
});

// The 16 companies Startmate lists for Winter 2026 (backend/scripts/enrich/startmate_w26_import.mjs): who is in the directory, who is held, and that a rerun adds nothing.
describe('the Startmate Winter 2026 import', () => {
  const ADDED = ['ansight', 'antares-aerospace', 'brandviz-ai', 'clausifai', 'coco', 'derive', 'develpr', 'estimate', 'glowback', 'hyperlocalise', 'securitybreak', 'sunburnt-space-co', 'quarter', 'veltora'];
  const load = async () => {
    const ds = parseRaw(await loadRaw(DATA));
    return { ds, byId: new Map(ds.companies.map((c) => [c.id, c])) };
  };

  it('has the fourteen new companies and Forward in the cohort, each backed by Startmate\'s own pages', async () => {
    const { ds, byId } = await load();
    const inCohort = ds.companies.filter((c) => (c.cohorts ?? []).includes('startmate-w26')).map((c) => c.id).sort();
    expect(inCohort).toEqual([...ADDED, 'forward'].sort());
    for (const id of inCohort) {
      const rows = ds.evidence.filter((e) => e.company_id === id && e.field === 'cohorts' && e.status === 'active');
      expect(rows.length, id).toBeGreaterThanOrEqual(2);
      for (const r of rows) {
        const s = ds.sources.find((x) => x.id === r.source_id);
        expect(s.kind).toBe('accelerator_profile');
        expect(s.url).toMatch(/^https:\/\/www\.startmate\.com\//);
        expect(r.verified_at).toMatch(/^2026-10-21T/);
      }
    }
    for (const id of ADDED) {
      // a cohort says nothing about funding, hiring or any tie to this site
      expect(byId.get(id).stage, id).toBe('Unknown');
      expect(byId.get(id).hiring, id).toBe(false);
      expect(byId.get(id).hiring_status ?? null, id).toBeNull();
      expect(byId.get(id).investors, id).toEqual([]);
    }
  });

  it('puts each at the place its pages support, never a city centre as an office', async () => {
    const { byId } = await load();
    expect(byId.get('securitybreak')).toMatchObject({ location_precision: 'EXACT', address: expect.stringContaining('290 Boundary Street'), city: 'Brisbane', state: 'QLD' });
    for (const id of ADDED.filter((x) => x !== 'securitybreak')) {
      const c = byId.get(id);
      expect(c.location_precision, id).toBe('CITY');
      expect(c.lat ?? null, id).toBeNull();
      expect(c.address ?? null, id).toBeNull();
    }
    expect(byId.get('forward').location_precision).toBe('UNKNOWN'); // not in Australia as far as a page says
  });

  it('holds Orva for review and records Quarter\'s Wellington office without drawing it', async () => {
    const { ds, byId } = await load();
    expect(byId.has('orva')).toBe(false);
    const orva = ds.candidates.find((c) => c.discoveries.some((d) => d.key === 'orva' && d.source_id === 'startmate-w26-2026-10-21'));
    expect(orva.status).toBe('needs_review');
    expect(orva.notes.some((n) => /HELD/.test(n.text))).toBe(true);
    const office = ds.company_locations.find((r) => r.id === 'quarter.office.wellington');
    expect(office).toMatchObject({ kind: 'OFFICE', country: 'New Zealand', city: 'Wellington', location_precision: 'CITY' });
    expect(byId.get('quarter')).toMatchObject({ city: 'Melbourne', country: 'Australia' });
  });

  it('keeps the name and the website the company\'s own, and the old addresses as identifiers', async () => {
    const { ds, byId } = await load();
    expect(byId.get('coco').website).toBe('https://www.trustcoco.ai');
    expect(byId.get('glowback').website).toBe('https://glowback.com.au');
    for (const [id, domain] of [['coco', 'cocothecreator.com'], ['glowback', 'glowback.tech']]) {
      expect(ds.identifiers.some((i) => i.company_id === id && i.scheme === 'domain' && i.value === domain), id).toBe(true);
    }
  });

  it('has no two companies on one website', async () => {
    const { ds } = await load();
    const seen = new Map();
    for (const c of ds.companies) {
      const d = canonicalDomain(c.website)?.domain;
      if (!d) continue;
      if (seen.has(d)) throw new Error(`${c.id} and ${seen.get(d)} share ${d}`);
      seen.set(d, c.id);
    }
  });

  it('adds nothing when it is run again', async () => {
    const copy = await mkdtemp(path.join(os.tmpdir(), 'w26-'));
    try {
      await cp(DATA, copy, { recursive: true });
      const before = parseRaw(await loadRaw(copy));
      const out = execFileSync('node', ['scripts/enrich/startmate_w26_import.mjs', 'all', '--by', 'test', '--data', copy], { cwd: path.join(HERE, '..'), encoding: 'utf8' });
      expect(out).toMatch(/wrote nothing/);
      const after = parseRaw(await loadRaw(copy));
      expect(after.companies.length).toBe(before.companies.length);
      expect(after.candidates.length).toBe(before.candidates.length);
      expect(after.evidence.length).toBe(before.evidence.length);
      expect(after.import_runs.length).toBe(before.import_runs.length);
      expect(after.audit_trail.length).toBe(before.audit_trail.length);
    } finally {
      await rm(copy, { recursive: true, force: true });
    }
  }, 60000);
});
