import { describe, it, expect } from 'vitest';
import { migrateDataset } from '../src/models/dataset.js';
import { makeEvidenceRow } from '../src/models/evidence.js';
import {
  auditDataset, classify, websiteProblems, isGenericSector, findPossibleDuplicates, labelVariants, pinStacks,
  ATTRIBUTES, TASKS, AUDIT_DEFAULTS,
} from '../src/models/audit.js';
import { renderConsole, renderMarkdown, queueToCsv, companiesToCsv, toCsv } from '../src/models/auditReport.js';

const AS_OF = '2026-10-05';
const daysBefore = (n) => new Date(Date.parse(`${AS_OF}T00:00:00.000Z`) - n * 86400000).toISOString();

const base = (name, over = {}) => ({
  name, sector: 'Fintech', sectorFull: 'Fintech', city: 'Sydney', lat: -33.87, lng: 151.2, investors: ['Blackbird'],
  stage: 'Seed', hiring: false, verified: true, website: `https://${name.toLowerCase().replace(/\W/g, '')}.example`,
  blurb: 'Does things.', taskGate: { enabled: false }, address: '1 George St, Sydney NSW 2000',
  founders: ['A Founder'], foundedYear: 2022, ...over,
});
const source = (id, retrieved_at = daysBefore(1)) => ({ id, kind: 'company_website', url: `https://${id}.example/`, title: id, publisher: null, retrieved_at, note: '' });
const build = (companies, { evidence = [], sources = [source('site')] } = {}) =>
  migrateDataset({ companies, people: [], investors: [], sources, evidence, funding_rounds: [], jobs: [], news: [] });
const deepFreeze = (o) => {
  Object.freeze(o);
  for (const v of Object.values(o)) if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  return o;
};

// One company per defect, so each check can be pinned on its own.
const COMPANIES = [
  base('Complete'),
  base('Stub', { website: '', sector: 'Unknown', stage: 'Unknown', blurb: '' }),
  base('Unconfirmed', { verified: false, city: 'Unknown', lat: null, lng: null, address: undefined }),
  base('BadUrl', { website: 'badurl.example' }),
  base('Generic', { sector: 'SaaS' }),
  base('Dead', { stage: 'Defunct (in liquidation)', hiring: true }),
  base('Bought', { stage: 'Acquired' }),
  base('Old', { stage: 'Seed', foundedYear: 2015 }),
  base('Hirer', { hiring: true, stage: 'Series C' }),
  base('NoPin', { lat: null, lng: null }),
  base('Offshore', { lat: 51.5, lng: -0.12 }),
  base('DupA', { website: 'https://dup.example' }),
  base('DupB', { website: 'http://www.dup.example/' }),
];
const run = (opts) => auditDataset(build(COMPANIES), { asOf: AS_OF, ...opts });
const names = (list) => list.map((x) => x.name).sort();
const entry = (audit, name) => audit.companies.find((c) => c.name === name);

describe('classify', () => {
  it('tells the ways of saying "unknown" apart from a real value', () => {
    expect(classify(undefined, 'string')).toBe('missing');
    expect(classify(null, 'string')).toBe('null');
    expect(classify('', 'string')).toBe('empty');
    expect(classify('   ', 'string')).toBe('empty');
    for (const s of ['Unknown', 'unknown', 'N/A', 'n/a', 'TBD', 'None', '-']) expect(classify(s, 'string'), s).toBe('unknown');
    expect(classify('Fintech', 'string')).toBe('present');
    expect(classify([], 'array')).toBe('empty');
    expect(classify(['x'], 'array')).toBe('present');
    expect(classify('x', 'array')).toBe('invalid');
    expect(classify(2022, 'number')).toBe('present');
    expect(classify(Number.NaN, 'number')).toBe('invalid');
    expect(classify(5, 'string')).toBe('invalid');
  });
});

describe('websiteProblems', () => {
  it('accepts ordinary company sites', () => {
    for (const url of ['https://acme.example', 'http://www.acme.com.au/', 'https://app.acme.io/path?x=1']) expect(websiteProblems(url), url).toEqual([]);
  });

  it('does not mistake a domain that merely ends in a social host for that host', () => {
    // airwallex.com and vulnetix.com end in "x.com"; neither is x.com.
    expect(websiteProblems('https://www.airwallex.com')).toEqual([]);
    expect(websiteProblems('https://vulnetix.com')).toEqual([]);
    expect(websiteProblems('https://wix.com')).toEqual([]);
  });

  it('flags a missing scheme, junk, odd schemes, non-public hosts and social profiles', () => {
    expect(websiteProblems('acme.example')).toEqual(['missing http(s):// scheme']);
    expect(websiteProblems('http//acme')).toEqual(['not a parseable URL']);
    expect(websiteProblems('ftp://acme.example')[0]).toMatch(/unsupported scheme/);
    expect(websiteProblems('https://localhost:3000')[0]).toMatch(/not a public domain/);
    expect(websiteProblems('https://192.168.0.1')[0]).toMatch(/not a public domain/);
    expect(websiteProblems('https://intranet')[0]).toMatch(/not a public domain/);
    expect(websiteProblems('https://www.linkedin.com/company/acme')[0]).toMatch(/linkedin\.com/);
    expect(websiteProblems('https://x.com/acme')[0]).toMatch(/x\.com/);
    expect(websiteProblems('https://au.linkedin.com/company/acme')[0]).toMatch(/linkedin\.com/);
  });
});

describe('isGenericSector', () => {
  it('matches business-model labels however they are cased or spaced, and leaves real industries alone', () => {
    for (const s of ['SaaS', 'saas', 'B2B SaaS', 'b2b  saas', 'Enterprise Software', 'Hardware', 'Marketplace']) expect(isGenericSector(s), s).toBe(true);
    for (const s of ['Fintech', 'AI', 'HealthTech', 'Construction SaaS', 'Climate SaaS']) expect(isGenericSector(s), s).toBe(false);
  });
});

describe('dataset-level helpers', () => {
  it('finds possible duplicates by website domain and by name', () => {
    const groups = findPossibleDuplicates([
      { id: 'a', name: 'DupA', website: 'https://dup.example' }, { id: 'b', name: 'DupB', website: 'http://www.dup.example/x' },
      { id: 'c', name: 'Cor (Cor AI)', website: '' }, { id: 'd', name: 'COR', website: '' },
      { id: 'e', name: 'Solo', website: 'https://solo.example' },
    ]);
    expect(groups).toEqual([
      expect.objectContaining({ reason: 'same website domain', names: ['DupA', 'DupB'] }),
      expect.objectContaining({ reason: 'same name', names: ['Cor (Cor AI)', 'COR'] }),
    ]);
  });

  it('groups sector spellings that differ only by case, spacing or punctuation', () => {
    const groups = labelVariants(['HealthTech', 'Healthtech', 'HealthTech', 'Legal tech', 'Legaltech', 'Fintech', 'Unknown', '']);
    expect(groups).toEqual([
      [{ label: 'HealthTech', count: 2 }, { label: 'Healthtech', count: 1 }],
      [{ label: 'Legal tech', count: 1 }, { label: 'Legaltech', count: 1 }],
    ]);
  });

  it('measures how many pins share a point, and how many of the largest stack lack an address', () => {
    const stacks = pinStacks([
      { name: 'A', lat: 1, lng: 2 }, { name: 'B', lat: 1, lng: 2, address: '' }, { name: 'C', lat: 1, lng: 2, address: '5 Main St' },
      { name: 'D', lat: 3, lng: 4 }, { name: 'E', lat: null, lng: null },
    ]);
    expect(stacks).toMatchObject({ pinned: 4, distinctPoints: 2, sharedPoints: 1, companiesOnSharedPoints: 3 });
    expect(stacks.largest[0]).toMatchObject({ point: '1,2', companies: 3, withoutAddress: 2 });
  });
});

describe('auditDataset: coverage', () => {
  it('counts each attribute and keeps the ways of being absent separate', () => {
    const a = run();
    const attr = Object.fromEntries(a.attributes.map((x) => [x.key, x]));
    expect(a.total).toBe(COMPANIES.length);
    expect(attr.website).toMatchObject({ present: 11, empty: 1, invalid: 1 }); // Stub empty, BadUrl invalid
    expect(attr.sector).toMatchObject({ present: 12, unknown: 1 });
    expect(attr.city).toMatchObject({ present: 12, unknown: 1 });
    expect(attr.coordinates).toMatchObject({ present: 10, null: 2, invalid: 1 }); // Unconfirmed + NoPin null, Offshore invalid
    expect(attr.state).toMatchObject({ present: 12, null: 1 });
    expect(attr.stage).toMatchObject({ present: 12, unknown: 1 });
    expect(attr.description).toMatchObject({ present: 12, empty: 1 });
    expect(attr.source).toMatchObject({ present: 0, empty: 13 });
    expect(attr.last_verified).toMatchObject({ present: 0, null: 13 });
    for (const x of a.attributes) {
      expect(x.present + x.unknown + x.empty + x.missing + x.null + x.invalid, x.key).toBe(a.total);
    }
  });

  it('reports the headline numbers, with location needing a city and state, and an in-Australia pin where the location claims to be one', () => {
    const { headline } = run();
    expect(headline).toMatchObject({ total: 13, website: 11, sector: 12, specificSector: 11, stage: 12, founder: 13, funding: 0, hiring: 13, source: 0 });
    // Unconfirmed has no city or state, and Offshore's exact pin is outside Australia. NoPin has an address but no
    // point, so it is only located to its city: it counts as located, and shows up as a missing pin instead.
    expect(headline.location).toBe(11);
  });

  it('lists all fourteen attributes the audit was specified with', () => {
    expect(ATTRIBUTES.map((a) => a.key)).toEqual([
      'website', 'sector', 'city', 'state', 'coordinates', 'stage', 'hiring', 'description',
      'founders', 'founded_year', 'funding', 'investors', 'source', 'last_verified',
    ]);
  });

  it('counts funding from any total, round or date, or a funding-round row', () => {
    const ds = migrateDataset({
      companies: [base('A', { funding_total: 5 }), base('B', { last_funding_round: 'Seed' }), base('C', { last_funding_date: '2026' }), base('D'), base('E')],
      people: [], investors: [], sources: [], evidence: [], jobs: [], news: [],
      funding_rounds: [{ id: 'r', company_id: 'e', round: 'Seed', amount: null, currency: null, announced_on: null, lead_investor_ids: [], investor_ids: [], source_ids: [] }],
    });
    expect(auditDataset(ds, { asOf: AS_OF }).headline.funding).toBe(4);
  });

  it('flags an implausible founded year as invalid rather than present', () => {
    const a = auditDataset(build([base('Future', { foundedYear: 2099 }), base('Ancient', { foundedYear: 1700 }), base('Fine', { foundedYear: 2020 })]), { asOf: AS_OF });
    expect(a.attributes.find((x) => x.key === 'founded_year')).toMatchObject({ present: 1, invalid: 2 });
  });

  it('counts a company as evidence-backed for an attribute only when it has active evidence for that field', () => {
    const ev = [
      makeEvidenceRow({ company_id: 'complete', field: 'website', value: 'https://complete.example', source_id: 'site', confidence: 'high', verified_at: daysBefore(1) }),
      makeEvidenceRow({ company_id: 'stub', field: 'website', value: 'https://stub.example', source_id: 'site', confidence: 'low', status: 'rejected', note: 'No.' }),
    ];
    const a = auditDataset(build(COMPANIES, { evidence: ev }), { asOf: AS_OF });
    expect(a.attributes.find((x) => x.key === 'website').evidenceBacked).toBe(1);
    expect(entry(a, 'Complete').evidence_backed.website).toBe(true);
    expect(entry(a, 'Stub').evidence_backed.website).toBe(false);
  });
});

describe('auditDataset: issue register', () => {
  const a = run();

  it('finds records with the literal "Unknown", empty core attributes and explicit nulls', () => {
    expect(names(a.issues.unknown_values)).toEqual(['Stub', 'Unconfirmed']);
    expect(a.issues.unknown_values.find((x) => x.name === 'Stub').detail).toBe('sector, stage');
    expect(a.issues.unknown_values.find((x) => x.name === 'Unconfirmed').detail).toBe('city');
    // Stub's website and description are empty; BadUrl's website is invalid, not empty.
    expect(a.issues.missing_values).toEqual([expect.objectContaining({ name: 'Stub', detail: 'website, description' })]);
    // NoPin has no pin; Unconfirmed has no state or pin. Offshore's pin is invalid, not null.
    expect(names(a.issues.null_values)).toEqual(['NoPin', 'Unconfirmed']);
  });

  it('finds invalid URLs, missing coordinates and pins outside Australia', () => {
    expect(a.issues.invalid_urls).toEqual([expect.objectContaining({ name: 'BadUrl', detail: 'missing http(s):// scheme' })]);
    expect(names(a.issues.missing_coordinates)).toEqual(['NoPin']);
    expect(names(a.issues.unpinned_unconfirmed)).toEqual(['Unconfirmed']);
    expect(names(a.issues.outside_australia)).toEqual(['Offshore']);
  });

  it('finds generic sectors, defunct and acquired companies, and a hiring flag on a defunct one', () => {
    expect(a.issues.generic_sectors).toEqual([expect.objectContaining({ name: 'Generic', detail: 'SaaS' })]);
    expect(names(a.issues.defunct)).toEqual(['Dead']);
    expect(names(a.issues.acquired)).toEqual(['Bought']);
    expect(names(a.issues.hiring_on_defunct)).toEqual(['Dead']);
  });

  it('finds possible duplicates', () => {
    expect(names(a.issues.possible_duplicates)).toEqual(['DupA', 'DupB']);
  });
});

describe('auditDataset: potentially stale', () => {
  const T = daysBefore;
  const row = (company_id, field, value, daysAgo) => makeEvidenceRow({ company_id, field, value, source_id: 'site', confidence: 'high', verified_at: T(daysAgo) });
  const stale = (a, key, name) => a.issues[key]?.find((x) => x.name === name);

  it('treats an undated hiring flag as stale, high risk when it says hiring and low when it does not', () => {
    const a = run();
    expect(stale(a, 'stale_hiring', 'Hirer').detail).toBe('high risk; no dated check on record');
    expect(stale(a, 'stale_hiring', 'Complete').detail).toBe('low risk; no dated check on record');
  });

  it('judges a dated check against the threshold, which can be changed', () => {
    const companies = [base('Fresh', { hiring: true }), base('Lapsed', { hiring: true })];
    const ev = [row('fresh', 'hiring_status', 'hiring', 10), row('lapsed', 'hiring_status', 'hiring', 100)];
    const a = auditDataset(build(companies, { evidence: ev }), { asOf: AS_OF });
    expect(stale(a, 'stale_hiring', 'Fresh')).toBeUndefined();
    expect(stale(a, 'stale_hiring', 'Lapsed').detail).toBe('high risk; last checked 100 days ago');
    const strict = auditDataset(build(companies, { evidence: ev }), { asOf: AS_OF, hiringStaleDays: 5 });
    expect(stale(strict, 'stale_hiring', 'Fresh').detail).toBe('high risk; last checked 10 days ago');
    expect(AUDIT_DEFAULTS).toMatchObject({ hiringStaleDays: 30, stageStaleDays: 180 });
  });

  it('judges staleness as of the date it is given, so a fresh check goes stale with time', () => {
    const ds = build([base('Checked', { hiring: true })], { evidence: [row('checked', 'hiring_status', 'hiring', 1)] });
    expect(stale(auditDataset(ds, { asOf: AS_OF }), 'stale_hiring', 'Checked')).toBeUndefined();
    expect(stale(auditDataset(ds, { asOf: '2026-12-01' }), 'stale_hiring', 'Checked').detail).toMatch(/last checked \d+ days ago/);
  });

  it('queues a stale hiring task only for a hiring flag that says hiring', () => {
    const a = run();
    const codes = (name) => entry(a, name).tasks.map((t) => t.code);
    expect(codes('Hirer')).toContain('stale_hiring');
    expect(codes('Complete')).not.toContain('stale_hiring');
  });

  it('lists an undated stage as stale in the register but queues it as unverified, a lower tier', () => {
    const a = run();
    expect(stale(a, 'stale_stage', 'Complete').detail).toMatch(/^high risk; no dated check/);
    const tasks = entry(a, 'Complete').tasks;
    expect(tasks.map((t) => t.code)).toContain('unverified_stage');
    expect(tasks.map((t) => t.code)).not.toContain('stale_stage');
    expect(tasks.find((t) => t.code === 'unverified_stage').tier).toBe(3);
  });

  it('queues a stage as stale when a known check is old, or an early-stage label sits on an old company', () => {
    const a = run();
    const old = entry(a, 'Old').tasks.find((t) => t.code === 'stale_stage');
    expect(old).toMatchObject({ tier: 2, detail: 'founded 2015 but still labelled Seed' });

    const ds = build([base('Dated', { stage: 'Series A' })], { evidence: [row('dated', 'stage', 'Series A', 400)] });
    const dated = auditDataset(ds, { asOf: AS_OF });
    expect(dated.companies[0].tasks.find((t) => t.code === 'stale_stage').detail).toBe('last checked 400 days ago');
  });

  it('lists late-stage labels as low risk and does not queue them', () => {
    const a = run();
    expect(stale(a, 'stale_stage', 'Hirer').detail).toMatch(/^low risk/);
    expect(entry(a, 'Hirer').tasks.map((t) => t.code)).not.toContain('unverified_stage');
  });

  it('leaves defunct and acquired companies out of stage staleness, and gives them a lifecycle task instead', () => {
    const a = run();
    for (const name of ['Dead', 'Bought']) {
      expect(stale(a, 'stale_stage', name)).toBeUndefined();
      expect(entry(a, name).tasks.map((t) => t.code)).toContain('lifecycle_check');
    }
  });

  it('rejects a date it cannot read', () => {
    expect(() => auditDataset(build(COMPANIES), { asOf: 'not a date' })).toThrow(/invalid asOf/);
  });
});

describe('auditDataset: the enrichment queue', () => {
  const a = run();
  const codes = (name) => entry(a, name).tasks.map((t) => t.code);

  it('turns each defect into the right task and tier', () => {
    expect(codes('Stub')).toEqual(expect.arrayContaining(['missing_website', 'unknown_sector', 'unknown_stage', 'missing_description']));
    expect(codes('Unconfirmed')).toContain('unconfirmed_location');
    expect(codes('BadUrl')).toContain('invalid_website');
    expect(codes('Generic')).toContain('generic_sector');
    expect(codes('Dead')).toEqual(expect.arrayContaining(['hiring_on_defunct', 'lifecycle_check']));
    expect(codes('NoPin')).toContain('missing_coordinates');
    expect(codes('Offshore')).toContain('coordinates_outside_australia');
    expect(codes('DupA')).toContain('possible_duplicate');
    for (const t of entry(a, 'Stub').tasks) expect(t.tier).toBe(TASKS[t.code].tier);
  });

  it('gives a confirmed location its own gaps but spares an unconfirmed one the consequences of being unconfirmed', () => {
    const unconfirmed = codes('Unconfirmed');
    for (const consequence of ['missing_coordinates', 'unknown_city', 'missing_state', 'approximate_pin']) expect(unconfirmed).not.toContain(consequence);
    expect(codes('Complete')).not.toContain('approximate_pin'); // it has an address
    expect(codes('Stub')).toContain('missing_website');
  });

  it('orders by most severe tier, then score, then prominence, then name, and numbers ranks from 1', () => {
    const tiers = a.queue.map((q) => q.priority);
    expect(tiers).toEqual([...tiers].sort());
    expect(a.queue.map((q) => q.rank)).toEqual(a.queue.map((_, i) => i + 1));
    for (let i = 1; i < a.queue.length; i += 1) {
      const [p, q] = [a.queue[i - 1], a.queue[i]];
      if (p.priority === q.priority) expect(p.score).toBeGreaterThanOrEqual(q.score);
    }
    expect(a.queue[0].priority).toBe('P0');
  });

  it('puts integrity problems (P0) ahead of everything else', () => {
    const p0 = a.queue.filter((q) => q.priority === 'P0').map((q) => q.name).sort();
    expect(p0).toEqual(['BadUrl', 'Dead', 'DupA', 'DupB', 'NoPin', 'Offshore']);
  });

  it('counts tiers and tasks consistently', () => {
    expect(Object.values(a.tierCounts).reduce((x, y) => x + y, 0)).toBe(a.queue.length);
    const taskTotal = a.queue.reduce((n, q) => n + q.tasks.length, 0);
    expect(Object.values(a.taskCounts).reduce((x, y) => x + y, 0)).toBe(taskTotal);
  });

  it('leaves a company with nothing open out of the queue altogether', () => {
    // Complete, sourced, not hiring, late-stage (so its stage is not queued), with funding on record.
    const ev = [makeEvidenceRow({ company_id: 'perfect', field: 'website', value: 'https://perfect.example', source_id: 'site', confidence: 'high', verified_at: daysBefore(1) })];
    const out = auditDataset(build([base('Perfect', { stage: 'Series C', funding_total: 1 })], { evidence: ev }), { asOf: AS_OF });
    expect(out.queue).toEqual([]);
    expect(out.companies[0].priority).toBeNull();
    expect(out.companies[0].tasks).toEqual([]);
  });
});

describe('auditDataset: provenance and evidence tasks', () => {
  it('queues each open source conflict as a P0 task naming the disagreement', () => {
    const ev = [
      makeEvidenceRow({ company_id: 'complete', field: 'stage', value: 'Seed', source_id: 'site', confidence: 'high', verified_at: daysBefore(1) }),
      makeEvidenceRow({ company_id: 'complete', field: 'stage', value: 'Series A', source_id: 'press', confidence: 'medium' }),
    ];
    const sources = [source('site'), { ...source('press'), kind: 'press' }];
    const a = auditDataset(build([base('Complete')], { evidence: ev, sources }), { asOf: AS_OF });
    const task = a.queue[0].tasks.find((t) => t.code === 'source_conflict');
    expect(a.queue[0].priority).toBe('P0');
    // Evidence is kept sorted by id, so the press row comes first.
    expect(task.detail).toBe('stage: "Series A" vs "Seed"');
    expect(a.provenance.conflicts).toHaveLength(1);
  });

  it('asks for a better source when a value rests only on low-confidence evidence', () => {
    const ev = [makeEvidenceRow({ company_id: 'complete', field: 'founded_year', value: 2022, source_id: 'site', confidence: 'low' })];
    const a = auditDataset(build([base('Complete')], { evidence: ev }), { asOf: AS_OF });
    expect(entry(a, 'Complete').tasks.find((t) => t.code === 'weak_evidence').detail).toBe('founded_year: 2022');
  });

  it('suggests reviewing recorded evidence that the record does not reflect yet', () => {
    const ev = [makeEvidenceRow({ company_id: 'stub', field: 'stage', value: 'Seed', source_id: 'site', confidence: 'high', verified_at: daysBefore(1) })];
    const a = auditDataset(build([base('Stub', { stage: 'Unknown' })], { evidence: ev }), { asOf: AS_OF });
    expect(entry(a, 'Stub').tasks.find((t) => t.code === 'unapplied_evidence').detail).toBe('stage: "Seed"');
  });

  it('drops the no-source task once a company has a source', () => {
    const ev = [makeEvidenceRow({ company_id: 'complete', field: 'website', value: 'https://complete.example', source_id: 'site', confidence: 'high', verified_at: daysBefore(1) })];
    const a = auditDataset(build([base('Complete')], { evidence: ev }), { asOf: AS_OF });
    expect(entry(a, 'Complete').tasks.map((t) => t.code)).not.toContain('no_source');
    expect(a.cohorts).toEqual({ withSources: 1, withoutSources: 0 });
  });
});

describe('auditDataset: read-only and never invents a value', () => {
  it('does not modify the dataset it is given', () => {
    const ds = deepFreeze(build(COMPANIES));
    expect(() => auditDataset(ds, { asOf: AS_OF })).not.toThrow();
  });

  it('is deterministic for the same input and date', () => {
    const ds = build(COMPANIES);
    expect(auditDataset(ds, { asOf: AS_OF })).toEqual(auditDataset(ds, { asOf: AS_OF }));
  });

  it('shows the stored value, empty or not, and never fills a gap: tasks carry questions, not answers', () => {
    const a = run();
    const stub = a.queue.find((q) => q.name === 'Stub');
    expect(stub.website).toBe(''); // still empty - nothing was proposed
    for (const q of a.queue) {
      for (const t of q.tasks) expect(Object.keys(t).sort()).toEqual(['action', 'code', 'detail', 'issue', 'tier', 'weight']);
    }
    expect(stub.tasks.find((t) => t.code === 'missing_website').detail).toBeNull();
    expect(stub.tasks.find((t) => t.code === 'unknown_sector').detail).toBeNull();
  });
});

describe('reports', () => {
  const a = run();

  it('escapes commas, quotes and line breaks in CSV, with a BOM for Excel and CRLF line ends', () => {
    const csv = toCsv(['a', 'b'], [{ a: 'x,y', b: 'say "hi"' }, { a: 'line\nbreak', b: null }]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toBe('﻿a,b\r\n"x,y","say ""hi"""\r\n"line\nbreak",\r\n');
  });

  it('writes the queue as one row per company with its tasks', () => {
    const lines = queueToCsv(a.queue).split('\r\n');
    expect(lines[0]).toBe('﻿rank,priority,score,company_id,name,website,city,stage,hiring,on_map,tasks,issues,next_actions');
    expect(lines.filter(Boolean)).toHaveLength(a.queue.length + 1);
    expect(queueToCsv(a.queue)).toContain('invalid_website');
  });

  it('writes a yes/problem matrix with one row per company for all fourteen attributes', () => {
    const lines = companiesToCsv(a).split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(a.total + 1);
    const header = lines[0].replace('﻿', '').split(',');
    expect(header).toEqual(expect.arrayContaining(ATTRIBUTES.map((x) => x.key)));
    const stub = lines.find((l) => l.includes(',Stub,')).split(',');
    expect(stub[header.indexOf('website')]).toBe('empty');
    expect(stub[header.indexOf('sector')]).toBe('unknown');
    expect(stub[header.indexOf('city')]).toBe('yes');
  });

  it('states coverage percentages that match the audit, and only mentions data age when told', () => {
    const md = renderMarkdown(a);
    expect(md).toContain(`- Website coverage: **${((100 * a.headline.website) / a.total).toFixed(1)}%** (${a.headline.website}/${a.total})`);
    expect(md).toContain('## Prioritized enrichment queue');
    expect(md).not.toContain('Data age');
    expect(renderMarkdown(a, { commitDates: ['2026-09-19', '2026-09-24'] })).toContain('2026-09-19, 2026-09-24');
  });

  it('does not bake any particular company or date into the report text', () => {
    const md = renderMarkdown(auditDataset(build([base('Solo')]), { asOf: '2031-01-01' }));
    expect(md).toContain('# Data completeness audit - 2031-01-01');
    expect(md).not.toMatch(/2026-10-05|Superstat|Forward/);
  });

  it('opens the console report with the totals', () => {
    expect(renderConsole(a).split('\n')[0]).toMatch(/^13 total companies \(13 with no recorded source, 0 with sources\)/);
  });

  it('counts companies, not findings, in the issues table', () => {
    const ev = [
      makeEvidenceRow({ company_id: 'complete', field: 'stage', value: 'Seed', source_id: 'site', confidence: 'high', verified_at: daysBefore(1) }),
      makeEvidenceRow({ company_id: 'complete', field: 'stage', value: 'Series A', source_id: 'press', confidence: 'medium' }),
      makeEvidenceRow({ company_id: 'complete', field: 'city', value: 'Sydney', source_id: 'site', confidence: 'high', verified_at: daysBefore(1) }),
      makeEvidenceRow({ company_id: 'complete', field: 'city', value: 'Perth', source_id: 'press', confidence: 'medium' }),
    ];
    const sources = [source('site'), { ...source('press'), kind: 'press' }];
    const out = auditDataset(build([base('Complete')], { evidence: ev, sources }), { asOf: AS_OF });
    expect(out.provenance.conflicts).toHaveLength(2);
    expect(renderMarkdown(out)).toMatch(/\| Sources disagree \| 1 \| Complete \(city\), Complete \(stage\) \|/);
  });
});
