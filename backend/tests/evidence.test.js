import { describe, it, expect } from 'vitest';
import { migrateDataset, validateDataset, getCompanyWithRelations } from '../src/models/dataset.js';
import { toPublic, INTERNAL_FIELDS } from '../src/models/company.js';
import {
  EVIDENCE_FIELDS, FIELD_ALIASES, normalizeField, valuesEqual, makeEvidenceRow, validateEvidence,
  detectConflicts, findUnappliedEvidence, findWeakEvidence, flattenEvidence, evidenceCoverage, bestConfidence,
} from '../src/models/evidence.js';

const T = '2026-10-05T00:00:00.000Z';
const source = (id, extra = {}) => ({
  id, kind: 'company_website', url: `https://${id}.example/`, title: `${id} page`, publisher: null, retrieved_at: T, note: '', ...extra,
});
const company = (over = {}) => ({
  name: 'Acme', sector: 'Fintech', sectorFull: 'Fintech', city: 'Sydney', lat: -33.87, lng: 151.2, investors: ['Blackbird'],
  stage: 'Seed', hiring: false, verified: true, website: 'https://acme.example', blurb: 'Payments.', taskGate: { enabled: false }, ...over,
});
const SOURCES = [
  source('acme-site'), source('press-1', { kind: 'press' }), source('press-2', { kind: 'press' }),
  source('unfetched', { kind: 'directory_listing', retrieved_at: null }), source('owner-notes', { kind: 'user_supplied' }),
];
// Always goes through the migration, as real data does, so source_ids and
// last_verified_at are in step with the evidence.
function dataset({ companies = [company()], evidence = [] } = {}) {
  return migrateDataset({ companies, people: [], investors: [], sources: SOURCES, evidence, funding_rounds: [], jobs: [], news: [] });
}
let n = 0;
const ev = (over = {}) => makeEvidenceRow({
  company_id: 'acme', field: 'stage', value: 'Seed', source_id: 'acme-site', confidence: 'high', verified_at: T, ...over,
}, new Set([`taken-${(n += 1)}`]));
const deepFreeze = (o) => {
  Object.freeze(o);
  for (const v of Object.values(o)) if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  return o;
};

describe('field registry', () => {
  it('maps everyday names onto the canonical field, and leaves everything else alone', () => {
    expect(normalizeField('headquarters')).toBe('city');
    expect(normalizeField('hq')).toBe('city');
    expect(normalizeField('blurb')).toBe('description');
    expect(normalizeField('foundedYear')).toBe('founded_year');
    expect(normalizeField('hiring')).toBe('hiring_status');
    expect(normalizeField('stage')).toBe('stage');
    expect(normalizeField('made_up')).toBe('made_up');
  });

  it('gives every field a cardinality and type, and never maps an alias onto a missing field', () => {
    for (const [field, spec] of Object.entries(EVIDENCE_FIELDS)) {
      expect(['single', 'multi', 'text'], field).toContain(spec.cardinality);
      expect(spec.type, field).toBeTruthy();
    }
    for (const target of Object.values(FIELD_ALIASES)) expect(EVIDENCE_FIELDS).toHaveProperty(target);
  });

  it('keeps coordinates out: they are derived from the address, which is evidenced', () => {
    expect(EVIDENCE_FIELDS).not.toHaveProperty('latitude');
    expect(EVIDENCE_FIELDS).not.toHaveProperty('longitude');
    expect(EVIDENCE_FIELDS).toHaveProperty('address');
  });
});

describe('valuesEqual', () => {
  it('treats URLs as the same site regardless of scheme, www, case, query or a trailing slash', () => {
    expect(valuesEqual('website', 'https://www.Acme.example/', 'http://acme.example')).toBe(true);
    expect(valuesEqual('website', 'https://acme.example/?utm=1', 'https://acme.example')).toBe(true);
    expect(valuesEqual('website', 'https://acme.example/careers', 'https://acme.example')).toBe(false);
    expect(valuesEqual('website', 'https://acme.example', 'https://acme.org')).toBe(false);
  });

  it('ignores case and spacing in text, and a parenthetical suffix on a city', () => {
    expect(valuesEqual('stage', 'Pre-seed', 'pre-seed ')).toBe(true);
    expect(valuesEqual('stage', 'Seed', 'Pre-seed')).toBe(false);
    expect(valuesEqual('city', 'Sydney (Chippendale)', 'Sydney')).toBe(true);
    expect(valuesEqual('city', 'Sydney', 'San Francisco')).toBe(false);
  });

  it('compares money by amount, and by currency only when both sides state one', () => {
    expect(valuesEqual('funding_total', { amount: 5, currency: 'AUD' }, { amount: 5, currency: null })).toBe(true);
    expect(valuesEqual('funding_total', { amount: 5, currency: 'AUD' }, { amount: 5, currency: 'USD' })).toBe(false);
    expect(valuesEqual('funding_total', { amount: 5, currency: 'AUD' }, { amount: 6, currency: 'AUD' })).toBe(false);
  });

  it('compares years numerically and states case-insensitively', () => {
    expect(valuesEqual('founded_year', 2026, '2026')).toBe(true);
    expect(valuesEqual('state', 'nsw', 'NSW')).toBe(true);
  });

  it('treats two nulls as equal and a null against a value as different', () => {
    expect(valuesEqual('stage', null, undefined)).toBe(true);
    expect(valuesEqual('stage', null, 'Seed')).toBe(false);
  });
});

describe('makeEvidenceRow', () => {
  it('builds a readable id, applies field aliases and fills defaults', () => {
    const row = makeEvidenceRow({ company_id: 'acme', field: 'headquarters', value: 'Sydney', source_id: 'acme-site', confidence: 'high', verified_at: T });
    expect(row).toEqual({
      id: 'acme.city.acme-site', company_id: 'acme', field: 'city', value: 'Sydney', source_id: 'acme-site',
      confidence: 'high', verified_at: T, status: 'active', note: null,
    });
  });

  it('puts the member in the id for list fields and suffixes a clash', () => {
    const a = makeEvidenceRow({ company_id: 'acme', field: 'investors', value: 'Y Combinator', source_id: 'press-1', confidence: 'medium' });
    expect(a.id).toBe('acme.investors.y-combinator.press-1');
    const b = makeEvidenceRow({ company_id: 'acme', field: 'investors', value: 'Y Combinator', source_id: 'press-1', confidence: 'medium' }, new Set([a.id]));
    expect(b.id).toBe('acme.investors.y-combinator.press-1.2');
  });
});

describe('validateEvidence', () => {
  it('accepts well-formed evidence', () => {
    const ds = dataset({ evidence: [ev(), ev({ field: 'website', value: 'https://acme.example/' }), ev({ field: 'funding_total', value: { amount: 5, currency: null }, confidence: 'medium', verified_at: null, source_id: 'press-1' })] });
    expect(validateDataset(ds)).toEqual([]);
  });

  const errorsFor = (row, tweak) => {
    const ds = dataset({ evidence: [row] });
    tweak?.(ds);
    return validateEvidence(ds);
  };

  it('rejects unknown companies, sources and fields, naming the right field for an alias', () => {
    expect(errorsFor({ ...ev(), company_id: 'nobody' })).toEqual(expect.arrayContaining([expect.stringContaining('unknown company_id "nobody"')]));
    expect(errorsFor({ ...ev(), source_id: 'nowhere' })).toEqual(expect.arrayContaining([expect.stringContaining('unknown source_id "nowhere"')]));
    expect(errorsFor({ ...ev(), field: 'made_up' })).toEqual(expect.arrayContaining([expect.stringContaining('unknown field "made_up"')]));
    expect(errorsFor({ ...ev(), field: 'headquarters' })).toEqual(expect.arrayContaining([expect.stringContaining('use "city"')]));
  });

  it('checks each value against its field type', () => {
    const bad = (field, value) => errorsFor({ ...ev({ field, value, confidence: 'medium', verified_at: null }) });
    expect(bad('website', 'acme.example')).toEqual(expect.arrayContaining([expect.stringContaining('http(s) URL')]));
    expect(bad('state', 'California')).toEqual(expect.arrayContaining([expect.stringContaining('one of NSW')]));
    expect(bad('hiring_status', 'maybe')).toEqual(expect.arrayContaining([expect.stringContaining('one of hiring, not_hiring')]));
    expect(bad('founded_year', '2026')).toEqual(expect.arrayContaining([expect.stringContaining('integer year')]));
    expect(bad('last_funding_date', '5 May')).toEqual(expect.arrayContaining([expect.stringContaining('YYYY')]));
    expect(bad('funding_total', 5000)).toEqual(expect.arrayContaining([expect.stringContaining('amount')]));
    expect(bad('funding_total', { amount: 5000 })).toEqual(expect.arrayContaining([expect.stringContaining('amount')]));
    expect(bad('funding_total', { amount: 5000, currency: 'aud' })).toEqual(expect.arrayContaining([expect.stringContaining('amount')]));
    expect(bad('funding_total', { amount: -1, currency: null })).toEqual(expect.arrayContaining([expect.stringContaining('amount')]));
    expect(bad('investors', '')).toEqual(expect.arrayContaining([expect.stringContaining('non-empty string')]));
  });

  it('rejects an invalid confidence or status', () => {
    expect(errorsFor({ ...ev(), confidence: 'certain' })).toEqual(expect.arrayContaining([expect.stringContaining('invalid confidence')]));
    expect(errorsFor({ ...ev(), status: 'pending' })).toEqual(expect.arrayContaining([expect.stringContaining('invalid status')]));
  });

  it('will not call a claim high confidence without a verification date', () => {
    expect(errorsFor({ ...ev(), verified_at: null })).toEqual(expect.arrayContaining([expect.stringContaining('high confidence requires verified_at')]));
  });

  it('will not mark a claim verified against a source nobody retrieved', () => {
    const row = ev({ source_id: 'unfetched', confidence: 'medium', verified_at: T });
    expect(errorsFor(row)).toEqual(expect.arrayContaining([expect.stringContaining('was never retrieved')]));
    expect(errorsFor(ev({ source_id: 'unfetched', confidence: 'medium', verified_at: null }))).toEqual([]);
  });

  it('requires a note on rejected and superseded evidence', () => {
    expect(errorsFor({ ...ev(), status: 'rejected' })).toEqual(expect.arrayContaining([expect.stringContaining('rejected evidence needs a note')]));
    expect(errorsFor({ ...ev(), status: 'superseded', note: '  ' })).toEqual(expect.arrayContaining([expect.stringContaining('superseded evidence needs a note')]));
    expect(errorsFor({ ...ev(), status: 'rejected', note: 'Looked at it; the company page says otherwise.' })).toEqual([]);
  });

  it('rejects duplicate ids and a claim the same source already makes', () => {
    const a = ev();
    const dupId = validateEvidence(dataset({ evidence: [a, { ...a, field: 'website', value: 'https://acme.example' }] }));
    expect(dupId).toEqual(expect.arrayContaining([expect.stringContaining('duplicate id')]));
    const repeat = validateEvidence(dataset({ evidence: [a, { ...a, id: 'acme.stage.again', value: 'seed' }] }));
    expect(repeat).toEqual(expect.arrayContaining([expect.stringContaining('repeats a claim')]));
  });

  it('requires the company to list every source its evidence cites, and last_verified_at to keep up', () => {
    const missingSource = errorsFor(ev(), (ds) => { ds.companies[0].source_ids = []; });
    expect(missingSource).toEqual(expect.arrayContaining([expect.stringContaining('does not list "acme-site"')]));
    const lagging = errorsFor(ev(), (ds) => { ds.companies[0].last_verified_at = '2020-01-01T00:00:00.000Z'; });
    expect(lagging).toEqual(expect.arrayContaining([expect.stringContaining('last_verified_at is older')]));
  });
});

describe('detectConflicts', () => {
  it('flags two active sources that give a field different values, naming each side', () => {
    const ds = dataset({ evidence: [
      ev({ value: 'Seed', source_id: 'acme-site', confidence: 'high' }),
      ev({ value: 'Pre-seed', source_id: 'press-1', confidence: 'medium', verified_at: null }),
    ] });
    const [c, ...rest] = detectConflicts(ds);
    expect(rest).toEqual([]);
    expect(c).toMatchObject({ company_id: 'acme', company_name: 'Acme', field: 'stage', kind: 'sources_disagree', stored: 'Seed' });
    expect(c.values).toEqual([
      expect.objectContaining({ value: 'Seed', best_confidence: 'high', matches_stored: true, source_ids: ['acme-site'] }),
      expect.objectContaining({ value: 'Pre-seed', best_confidence: 'medium', matches_stored: false, source_ids: ['press-1'] }),
    ]);
  });

  it('treats sources that agree as corroboration, not conflict', () => {
    const ds = dataset({ evidence: [ev({ source_id: 'acme-site' }), ev({ source_id: 'press-1', confidence: 'medium' }), ev({ source_id: 'press-2', value: 'seed', confidence: 'medium' })] });
    expect(detectConflicts(ds)).toEqual([]);
  });

  it('ignores rejected and superseded rows', () => {
    const ds = dataset({ evidence: [
      ev({ source_id: 'acme-site' }),
      ev({ value: 'Series A', source_id: 'press-1', confidence: 'medium', status: 'rejected', note: 'Wrong company.' }),
      ev({ value: 'Pre-seed', source_id: 'press-2', confidence: 'medium', status: 'superseded', note: 'Replaced by the round above.' }),
    ] });
    expect(detectConflicts(ds)).toEqual([]);
  });

  it('never conflicts list or text fields: investors add up and descriptions coexist', () => {
    const ds = dataset({ evidence: [
      ev({ field: 'investors', value: 'Blackbird', source_id: 'press-1', confidence: 'medium' }),
      ev({ field: 'investors', value: 'AirTree', source_id: 'press-2', confidence: 'medium' }),
      ev({ field: 'description', value: 'A payments company.', source_id: 'press-1', confidence: 'medium' }),
      ev({ field: 'description', value: 'Money software.', source_id: 'press-2', confidence: 'medium' }),
    ] });
    expect(detectConflicts(ds)).toEqual([]);
  });

  it('flags evidence that agrees with itself but not with the record, and does not call an unknown field a conflict', () => {
    const differs = dataset({ evidence: [ev({ value: 'Series A' })] });
    expect(detectConflicts(differs)).toEqual([expect.objectContaining({ kind: 'stored_differs', field: 'stage', stored: 'Seed' })]);
    const unknown = dataset({ companies: [company({ stage: 'Unknown' })], evidence: [ev({ value: 'Series A' })] });
    expect(detectConflicts(unknown)).toEqual([]);
  });

  it('lets a source that says "hiring" contradict the legacy hiring:false flag, but not hiring:true', () => {
    const row = ev({ field: 'hiring_status', value: 'hiring' });
    expect(detectConflicts(dataset({ companies: [company({ hiring: false })], evidence: [row] }))).toEqual([expect.objectContaining({ field: 'hiring_status', stored: 'not_hiring' })]);
    expect(detectConflicts(dataset({ companies: [company({ hiring: true })], evidence: [row] }))).toEqual([]);
  });

  it('compares websites, cities and money the way valuesEqual does', () => {
    const ok = dataset({ companies: [company({ city: 'Sydney (Chippendale)' })], evidence: [
      ev({ field: 'website', value: 'https://www.acme.example/' }),
      ev({ field: 'city', value: 'Sydney' }),
      ev({ field: 'funding_total', value: { amount: 5, currency: 'AUD' }, source_id: 'press-1', confidence: 'medium', verified_at: null }),
      ev({ field: 'funding_total', value: { amount: 5, currency: null }, source_id: 'press-2', confidence: 'medium', verified_at: null }),
    ] });
    expect(detectConflicts(ok)).toEqual([]);
    const clash = dataset({ evidence: [
      ev({ field: 'funding_total', value: { amount: 5, currency: 'AUD' }, source_id: 'press-1', confidence: 'medium', verified_at: null }),
      ev({ field: 'funding_total', value: { amount: 5, currency: 'USD' }, source_id: 'press-2', confidence: 'medium', verified_at: null }),
    ] });
    expect(detectConflicts(clash)).toEqual([expect.objectContaining({ field: 'funding_total', kind: 'sources_disagree' })]);
  });
});

describe('findUnappliedEvidence', () => {
  it('offers evidence for a field the record leaves unknown, but only when the evidence agrees with itself', () => {
    const one = dataset({ companies: [company({ stage: 'Unknown' })], evidence: [ev({ value: 'Series A' })] });
    expect(findUnappliedEvidence(one)).toEqual([expect.objectContaining({ company_id: 'acme', field: 'stage', value: 'Series A', best_confidence: 'high' })]);
    const two = dataset({ companies: [company({ stage: 'Unknown' })], evidence: [ev({ value: 'Series A' }), ev({ value: 'Seed', source_id: 'press-1', confidence: 'medium', verified_at: null })] });
    expect(findUnappliedEvidence(two)).toEqual([]);
  });

  it('offers a list member the record does not list, and nothing for one it does', () => {
    const ds = dataset({ evidence: [
      ev({ field: 'investors', value: 'blackbird', source_id: 'press-1', confidence: 'medium' }),
      ev({ field: 'investors', value: 'AirTree', source_id: 'press-1', confidence: 'medium' }),
    ] });
    expect(findUnappliedEvidence(ds)).toEqual([expect.objectContaining({ field: 'investors', value: 'AirTree' })]);
  });
});

describe('findWeakEvidence', () => {
  it('flags a stored value whose only support is low confidence, and clears it once anything better backs it', () => {
    const weak = dataset({ evidence: [ev({ source_id: 'owner-notes', confidence: 'low', verified_at: null })] });
    expect(findWeakEvidence(weak)).toEqual([expect.objectContaining({ field: 'stage', value: 'Seed' })]);
    const backed = dataset({ evidence: [ev({ source_id: 'owner-notes', confidence: 'low', verified_at: null }), ev({ source_id: 'press-1', confidence: 'medium', verified_at: null })] });
    expect(findWeakEvidence(backed)).toEqual([]);
  });

  it('judges each list member on its own', () => {
    const ds = dataset({ companies: [company({ investors: ['Blackbird', 'AirTree'] })], evidence: [
      ev({ field: 'investors', value: 'Blackbird', source_id: 'press-1', confidence: 'medium' }),
      ev({ field: 'investors', value: 'AirTree', source_id: 'owner-notes', confidence: 'low' }),
    ] });
    expect(findWeakEvidence(ds).map((w) => w.value)).toEqual(['AirTree']);
  });
});

describe('flattenEvidence', () => {
  it('returns each claim joined to its source, with the specified fields first and in order', () => {
    const ds = dataset({ evidence: [ev({ source_id: 'press-1', confidence: 'medium', verified_at: T })] });
    const [row] = flattenEvidence(ds);
    expect(Object.keys(row).slice(0, 10)).toEqual([
      'source_id', 'company_id', 'field', 'value', 'source_name', 'source_url', 'source_type', 'retrieved_at', 'verified_at', 'confidence',
    ]);
    expect(row).toMatchObject({
      source_id: 'press-1', company_id: 'acme', field: 'stage', value: 'Seed', source_name: 'press-1 page',
      source_url: 'https://press-1.example/', source_type: 'press', retrieved_at: T, verified_at: T, confidence: 'medium', status: 'active',
    });
  });

  it('filters by company', () => {
    const ds = dataset({ companies: [company(), company({ name: 'Other Co' })], evidence: [ev(), ev({ company_id: 'other-co', source_id: 'press-1', confidence: 'medium', verified_at: null })] });
    expect(flattenEvidence(ds, { companyId: 'other-co' })).toHaveLength(1);
    expect(flattenEvidence(ds)).toHaveLength(2);
  });
});

describe('evidenceCoverage and bestConfidence', () => {
  it('counts rows by status and confidence and companies by field', () => {
    const ds = dataset({ evidence: [ev(), ev({ field: 'website', value: 'https://acme.example' }), ev({ value: 'Series A', source_id: 'press-1', confidence: 'low', verified_at: null, status: 'rejected', note: 'No.' })] });
    const cov = evidenceCoverage(ds);
    expect(cov.rows).toBe(3);
    expect(cov.byStatus).toEqual({ active: 2, rejected: 1 });
    expect(cov.byConfidence).toEqual({ high: 2, low: 1 });
    expect(cov.companiesWithEvidence).toBe(1);
    expect(cov.byField.stage).toEqual({ rows: 1, companies: 1 });
  });

  it('ranks high above medium above low', () => {
    expect(bestConfidence(['low', 'high', 'medium'])).toBe('high');
    expect(bestConfidence(['low', 'medium'])).toBe('medium');
    expect(bestConfidence(['low'])).toBe('low');
  });
});

describe('migrateDataset with evidence', () => {
  it('lists every cited source on the company and advances last_verified_at, never backwards', () => {
    const later = '2026-11-01T00:00:00.000Z';
    const ds = dataset({
      companies: [company({ source_ids: ['acme-site'], last_verified_at: '2026-12-01T00:00:00.000Z' }), company({ name: 'Other Co' })],
      evidence: [ev({ verified_at: later }), ev({ company_id: 'other-co', source_id: 'press-1', confidence: 'medium', verified_at: later })],
    });
    const [acme, other] = ds.companies;
    expect(acme.source_ids).toEqual(['acme-site']);
    expect(acme.last_verified_at).toBe('2026-12-01T00:00:00.000Z');
    expect(other.source_ids).toEqual(['press-1']);
    expect(other.last_verified_at).toBe(later);
  });

  it('keeps sources the company already lists, and appends new ones', () => {
    const ds = dataset({ companies: [company({ source_ids: ['press-2'] })], evidence: [ev({ source_id: 'acme-site' })] });
    expect(ds.companies[0].source_ids).toEqual(['press-2', 'acme-site']);
  });

  it('sorts evidence by id, is idempotent, and does not mutate its input', () => {
    const input = deepFreeze({
      companies: [company()], people: [], investors: [], sources: SOURCES, funding_rounds: [], jobs: [], news: [],
      evidence: [ev({ field: 'website', value: 'https://acme.example' }), ev()],
    });
    const once = migrateDataset(input);
    expect(once.evidence.map((e) => e.id)).toEqual([...once.evidence.map((e) => e.id)].sort());
    expect(migrateDataset(once)).toEqual(once);
  });

  it('never changes a stored company value because of evidence - it reports the disagreement instead', () => {
    const ds = dataset({ evidence: [ev({ value: 'Series B', source_id: 'press-1', confidence: 'medium', verified_at: null }), ev({ value: 'Seed' })] });
    expect(ds.companies[0].stage).toBe('Seed');
    expect(detectConflicts(ds)).toHaveLength(1);
    expect(migrateDataset(ds).companies[0].stage).toBe('Seed');
  });

  it('works for datasets that have no evidence collection at all', () => {
    const { evidence, ...bare } = { companies: [company()], people: [], investors: [], sources: SOURCES, funding_rounds: [], jobs: [], news: [] };
    expect(evidence).toBeUndefined();
    const ds = migrateDataset(bare);
    expect(ds.evidence).toEqual([]);
    expect(validateDataset(ds)).toEqual([]);
  });
});

describe('getCompanyWithRelations (internal read path)', () => {
  it('includes the evidence and the open conflicts for the company', () => {
    const ds = dataset({ evidence: [ev(), ev({ value: 'Pre-seed', source_id: 'press-1', confidence: 'medium', verified_at: null })] });
    const full = getCompanyWithRelations(ds, 'acme');
    expect(full.evidence).toHaveLength(2);
    expect(full.conflicts).toEqual([expect.objectContaining({ field: 'stage', kind: 'sources_disagree' })]);
    expect(full.sources.map((s) => s.id).sort()).toEqual(['acme-site', 'press-1']);
  });
});

describe('public projection', () => {
  const record = { id: 'acme', name: 'Acme', stage: 'Seed', source_ids: ['x'], confidence_score: 0.9, last_verified_at: T, created_at: T, updated_at: T, hiring_status: 'hiring' };

  it('drops the record-keeping fields and keeps the facts', () => {
    const out = toPublic(record);
    for (const key of INTERNAL_FIELDS) expect(out).not.toHaveProperty(key);
    expect(out).toEqual({ id: 'acme', name: 'Acme', stage: 'Seed', hiring_status: 'hiring' });
  });

  it('does not mutate the record it is given', () => {
    const frozen = deepFreeze({ ...record });
    expect(() => toPublic(frozen)).not.toThrow();
    expect(frozen.source_ids).toEqual(['x']);
  });

  it('pins the list of internal fields, so exposing one is a deliberate change', () => {
    expect([...INTERNAL_FIELDS].sort()).toEqual([
      'confidence_score', 'created_at', 'last_verified_at', 'location_confidence', 'location_source', 'location_source_url',
      'location_verified_at', 'source_ids', 'updated_at',
    ]);
  });
});
