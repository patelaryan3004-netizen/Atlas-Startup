import { describe, it, expect } from 'vitest';
import { companyConfidence, confidenceLabel, syncConfidence, CONFIDENCE_WEIGHTS, UNSOURCED, CONFLICTED } from '../src/models/confidence.js';
import { migrateDataset } from '../src/models/dataset.js';
import { dataset, co } from './helpers/discovery.js';

const row = (field, value, confidence = 'high', over = {}) => ({ id: `x.${field}.${String(value)}`, company_id: 'acme', field, value, source_id: 's', confidence, verified_at: null, status: 'active', note: null, ...over });
const acme = (over = {}) => ({ id: 'acme', name: 'Acme', website: '', city: 'Unknown', sector: 'Unknown', stage: 'Unknown', blurb: '', investors: [], ...over });

describe('how far the facts a record states are backed by evidence', () => {
  it('is null when the record states nothing a score can rest on', () => {
    expect(companyConfidence(acme(), [])).toBeNull();
  });

  it('gives a stated fact nothing backs a low score, so an unchecked legacy record is not trusted', () => {
    expect(companyConfidence(acme({ website: 'https://acme.com' }), [])).toBe(UNSOURCED);
  });

  it('scores by the best active evidence for the stated value: high 1, medium 0.7, low 0.4', () => {
    const c = acme({ website: 'https://acme.com' });
    expect(companyConfidence(c, [row('website', 'https://acme.com', 'high')])).toBe(1);
    expect(companyConfidence(c, [row('website', 'https://acme.com', 'medium')])).toBe(0.7);
    expect(companyConfidence(c, [row('website', 'https://acme.com', 'low')])).toBe(0.4);
    expect(companyConfidence(c, [row('website', 'https://acme.com', 'low'), row('website', 'https://www.acme.com/', 'high')])).toBe(1); // the best row, and the same URL
  });

  it('drops to the conflicted score when another active source disagrees with what the record says', () => {
    const c = acme({ website: 'https://acme.com' });
    expect(companyConfidence(c, [row('website', 'https://acme.com', 'high'), row('website', 'https://other.example', 'medium')])).toBe(CONFLICTED);
  });

  it('weights what the map rests on: website and city count double', () => {
    const c = acme({ website: 'https://acme.com', sector: 'AI' });
    const rows = [row('website', 'https://acme.com', 'high')]; // website 1.0 (x2), sector unsourced 0.25 (x1)
    expect(companyConfidence(c, rows)).toBe(Math.round(((1 * 2 + UNSOURCED * 1) / 3) * 100) / 100);
    expect(CONFIDENCE_WEIGHTS.website).toBe(2);
  });

  it('averages a list, member by member: one confirmed investor and one unchecked', () => {
    const c = acme({ investors: ['Blackbird', 'AirTree'] });
    expect(companyConfidence(c, [row('investors', 'Blackbird', 'high')])).toBe(Math.round(((1 + UNSOURCED) / 2) * 100) / 100);
  });

  it('does not treat a free-text description as confirmed unless it is the description the evidence gives', () => {
    expect(companyConfidence(acme({ blurb: 'A hand-written line.' }), [row('description', 'The meta description.', 'medium')])).toBe(UNSOURCED);
    expect(companyConfidence(acme({ blurb: 'The meta description.' }), [row('description', 'The meta description.', 'medium')])).toBe(0.7);
  });

  it('labels a score', () => {
    expect([null, 0.9, 0.75, 0.6, 0.5, 0.49].map(confidenceLabel)).toEqual(['not assessed', 'high', 'high', 'medium', 'medium', 'low']);
  });
});

describe('the derived score in the dataset', () => {
  const ds = () => dataset([co('Acme', { website: 'https://acme.com' }), co('Other', { website: 'https://other.com' })], {
    sources: [{ id: 's', kind: 'company_website', url: 'https://acme.com/', title: null, publisher: null, retrieved_at: '2026-10-05T04:00:00.000Z', note: '' }],
  });

  it('is set for a company with active evidence, and left null for one without', () => {
    const base = ds();
    const acmeId = base.companies.find((c) => c.name === 'Acme').id;
    const withEvidence = migrateDataset({ ...base, evidence: [{ id: `${acmeId}.website.s`, company_id: acmeId, field: 'website', value: 'https://acme.com', source_id: 's', confidence: 'high', verified_at: '2026-10-05T04:00:00.000Z', status: 'active', note: null }] });
    // A confirmed website (x2) among a city, sector, stage and description nothing backs: (2 + 0.25 x 5) / 7.
    expect(withEvidence.companies.find((c) => c.id === acmeId).confidence_score).toBe(0.46);
    expect(withEvidence.companies.find((c) => c.name === 'Other').confidence_score).toBeNull();
  });

  it('ignores rejected evidence, and is stable when migrated again', () => {
    const base = ds();
    const acmeId = base.companies.find((c) => c.name === 'Acme').id;
    const rejected = { id: `${acmeId}.website.s`, company_id: acmeId, field: 'website', value: 'https://acme.com', source_id: 's', confidence: 'high', verified_at: '2026-10-05T04:00:00.000Z', status: 'rejected', note: 'Turned down.' };
    const once = migrateDataset({ ...base, evidence: [rejected] });
    expect(once.companies.find((c) => c.id === acmeId).confidence_score).toBeNull();
    const active = migrateDataset({ ...base, evidence: [{ ...rejected, status: 'active', note: null }] });
    expect(migrateDataset(active)).toEqual(active);
  });

  it('syncConfidence only touches companies that have active evidence', () => {
    const companies = [{ id: 'a', website: 'https://a.com', confidence_score: null }, { id: 'b', website: 'https://b.com', confidence_score: 0.9 }];
    syncConfidence(companies, [{ ...row('website', 'https://a.com'), company_id: 'a' }]);
    expect(companies[0].confidence_score).toBe(1);
    expect(companies[1].confidence_score).toBe(0.9);
  });
});
