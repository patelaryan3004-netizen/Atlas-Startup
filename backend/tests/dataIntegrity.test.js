import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadRaw, parseRaw, serializeDataset, migrateDataset, validateDataset, getCompanyWithRelations,
  COLLECTION_FILES,
} from '../src/models/dataset.js';
import { ADDED_FIELDS, LEGACY_FIELDS } from '../src/models/company.js';
import { detectConflicts, flattenEvidence, EVIDENCE_FIELDS } from '../src/models/evidence.js';
import { auditDataset, ATTRIBUTES } from '../src/models/audit.js';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data');
const deepFreeze = (o) => {
  Object.freeze(o);
  for (const v of Object.values(o)) if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  return o;
};

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

describe('provenance in the shipped data', () => {
  const rejected = () => ds.evidence.filter((e) => e.status === 'rejected');

  it('only claims high confidence for a claim verified against a source that was actually retrieved', () => {
    const sources = new Map(ds.sources.map((s) => [s.id, s]));
    for (const e of ds.evidence.filter((x) => x.confidence === 'high')) {
      expect(e.verified_at, `${e.id} is high confidence but unverified`).not.toBeNull();
      expect(sources.get(e.source_id).retrieved_at, `${e.id} cites a source nobody retrieved`).not.toBeNull();
    }
  });

  it('keeps the claims that were checked and turned down as rejected evidence, with the reason, instead of discarding them', () => {
    const find = (company, field) => rejected().find((e) => e.company_id === company && e.field === field);
    expect(find('superstat', 'funding_total').value).toEqual({ amount: 120000, currency: null });
    expect(find('fastlane', 'city').value).toBe('San Francisco');
    expect(find('forward', 'founders').value).toBe('Freddie Harris');
    for (const e of rejected()) expect(e.note.length, `${e.id} needs a reason`).toBeGreaterThan(20);
  });

  it('keeps rejected claims out of conflict detection and out of the records', () => {
    const inConflicts = detectConflicts(ds).flatMap((c) => c.values.flatMap((v) => v.evidence_ids));
    for (const e of rejected()) expect(inConflicts).not.toContain(e.id);
    const superstat = ds.companies.find((c) => c.id === 'superstat');
    expect(superstat.funding_total).toBe(3500000);
    expect(ds.companies.find((c) => c.id === 'fastlane').city).toBe('Sydney');
    expect(ds.companies.find((c) => c.id === 'forward').founders).not.toContain('Freddie Harris');
  });

  it('reports every disagreement between sources with each side named, so nothing is settled silently', () => {
    const ids = new Set(ds.evidence.filter((e) => e.status === 'active').map((e) => e.id));
    for (const c of detectConflicts(ds)) {
      expect(EVIDENCE_FIELDS[c.field].cardinality).toBe('single');
      if (c.kind === 'sources_disagree') expect(c.values.length).toBeGreaterThanOrEqual(2);
      for (const side of c.values) for (const id of side.evidence_ids) expect(ids.has(id), `${id} is not active evidence`).toBe(true);
    }
  });

  it('joins every evidence row to its source in the specified shape', () => {
    const flat = flattenEvidence(ds);
    expect(flat).toHaveLength(ds.evidence.length);
    for (const row of flat) {
      expect(row.source_name, row.evidence_id).toEqual(expect.any(String));
      expect(row.source_type, row.evidence_id).toEqual(expect.any(String));
    }
  });
});

describe('the completeness audit of the shipped data', () => {
  // A frozen copy, so any attempt by the audit to modify the data throws.
  const frozen = () => deepFreeze(parseRaw(raw));
  const present = (v) => typeof v === 'string' && v.trim() !== '' && !/^unknown$/i.test(v.trim());

  it('runs without modifying a single value', () => {
    expect(() => auditDataset(frozen(), { asOf: '2026-10-05' })).not.toThrow();
  });

  it('accounts for every company under every attribute', () => {
    const audit = auditDataset(frozen(), { asOf: '2026-10-05' });
    expect(audit.total).toBe(ds.companies.length);
    expect(audit.attributes.map((a) => a.key)).toEqual(ATTRIBUTES.map((a) => a.key));
    for (const a of audit.attributes) {
      expect(a.present + a.unknown + a.empty + a.missing + a.null + a.invalid, a.key).toBe(audit.total);
    }
  });

  it('agrees with a plain recount of the raw records', () => {
    const { headline } = auditDataset(frozen(), { asOf: '2026-10-05' });
    const n = (pred) => ds.companies.filter(pred).length;
    expect(headline.website).toBe(n((c) => present(c.website)));
    expect(headline.sector).toBe(n((c) => present(c.sector)));
    expect(headline.stage).toBe(n((c) => present(c.stage)));
    expect(headline.description).toBe(n((c) => present(c.blurb)));
    expect(headline.founder).toBe(n((c) => (c.founders ?? []).length > 0));
    expect(headline.investors).toBe(n((c) => (c.investors ?? []).length > 0));
    expect(headline.founded_year).toBe(n((c) => typeof c.foundedYear === 'number'));
    expect(headline.source).toBe(n((c) => c.source_ids.length > 0));
    expect(headline.last_verified).toBe(n((c) => c.last_verified_at != null));
    expect(headline.location).toBe(n((c) => present(c.city) && c.state != null && typeof c.lat === 'number' && typeof c.lng === 'number'));
    const rounds = new Set(ds.funding_rounds.map((r) => r.company_id));
    expect(headline.funding).toBe(n((c) => c.funding_total != null || c.last_funding_round != null || c.last_funding_date != null || rounds.has(c.id)));
  });

  it('builds a queue of real companies, in order, whose tiers add up', () => {
    const audit = auditDataset(frozen(), { asOf: '2026-10-05' });
    const ids = new Set(ds.companies.map((c) => c.id));
    expect(audit.queue.every((q) => ids.has(q.company_id))).toBe(true);
    expect(audit.queue.map((q) => q.rank)).toEqual(audit.queue.map((_, i) => i + 1));
    expect(Object.values(audit.tierCounts).reduce((x, y) => x + y, 0)).toBe(audit.queue.length);
    const tiers = audit.queue.map((q) => q.priority);
    expect(tiers).toEqual([...tiers].sort());
  });

  it('finds no invalid URLs, no confirmed location without a pin and no duplicates today - and would say so if that changed', () => {
    const { issues, duplicates } = auditDataset(frozen(), { asOf: '2026-10-05' });
    expect(issues.invalid_urls ?? []).toEqual([]);
    expect(issues.missing_coordinates ?? []).toEqual([]);
    expect(issues.outside_australia ?? []).toEqual([]);
    expect(duplicates).toEqual([]);
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
