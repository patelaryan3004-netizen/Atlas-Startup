import { describe, it, expect } from 'vitest';
import {
  slugify, uniqueSlug, deriveState, migrateCompanyRecord, toCanonical,
  ADDED_FIELDS, LEGACY_FIELDS,
} from '../src/models/company.js';
import {
  migrateDataset, validateDataset, investorReviewNotes, getCompanyWithRelations,
} from '../src/models/dataset.js';

const legacy = (o = {}) => ({
  name: 'Acme', sector: 'AI', sectorFull: 'AI / Testing', city: 'Sydney', lat: -33.9, lng: 151.2,
  investors: [], stage: 'Seed', hiring: false, verified: true, website: '', blurb: '',
  taskGate: { enabled: false, type: null }, ...o,
});
const dataset = (companies, extra = {}) => ({
  companies, people: [], investors: [], sources: [], funding_rounds: [], jobs: [], news: [], ...extra,
});

describe('slugify / uniqueSlug', () => {
  it('produces short url-safe slugs', () => {
    expect(slugify('Canva')).toBe('canva');
    expect(slugify('me&u')).toBe('me-and-u');
    expect(slugify(':Different')).toBe('different');
    expect(slugify('Biza.io')).toBe('biza-io');
    expect(slugify('Café Co')).toBe('cafe-co');
  });

  it('drops a parenthetical alias so ids stay short', () => {
    expect(slugify('Hone (HoneAg)')).toBe('hone');
    expect(slugify('Sherpa (4You Innovation)')).toBe('sherpa');
  });

  it('keeps the parenthetical when it is the whole name, rather than returning an empty slug', () => {
    expect(slugify('(odd)')).toBe('odd');
  });

  it('suffixes on collision and never returns an empty id', () => {
    expect(uniqueSlug('foo', new Set(['foo']))).toBe('foo-2');
    expect(uniqueSlug('foo', new Set(['foo', 'foo-2']))).toBe('foo-3');
    expect(uniqueSlug('', new Set())).toBe('item');
  });
});

describe('deriveState', () => {
  it('reads the state from the address when there is one', () => {
    expect(deriveState(legacy({ city: 'Richmond', address: '18 Wangaratta Street, Richmond VIC 3121' }))).toBe('VIC');
  });

  it('lets the address win over the city lookup', () => {
    expect(deriveState(legacy({ city: 'Sydney', address: '1 Queen St, Brisbane QLD 4000' }))).toBe('QLD');
  });

  it('falls back to an unambiguous city', () => {
    expect(deriveState(legacy({ city: 'Melbourne' }))).toBe('VIC');
    expect(deriveState(legacy({ city: 'Canberra' }))).toBe('ACT');
  });

  it('leaves state null for a city that exists in several states and has no address', () => {
    for (const city of ['Richmond', 'Carlton', 'Milton', 'Deakin', 'Cremorne']) {
      expect(deriveState(legacy({ city }))).toBeNull();
    }
  });

  it('never asserts a state for an unverified record, even with an address (it may be historical)', () => {
    expect(deriveState(legacy({ verified: false, city: 'Unknown', address: '161 Castlereagh Street, Sydney NSW 2000 (historical)' }))).toBeNull();
  });
});

describe('migrateCompanyRecord', () => {
  const ids = { id: 'acme', slug: 'acme' };

  it('adds every v2 field after the legacy ones, in a fixed order', () => {
    const out = migrateCompanyRecord(legacy(), ids);
    const keys = Object.keys(out);
    expect(keys.slice(0, Object.keys(legacy()).length)).toEqual(Object.keys(legacy()));
    expect(keys.slice(-ADDED_FIELDS.length)).toEqual(ADDED_FIELDS);
  });

  it('defaults unknown fields to null / [] rather than inventing values', () => {
    const out = migrateCompanyRecord(legacy(), ids);
    for (const key of ['logo', 'subsector', 'employee_range', 'funding_total', 'last_funding_date', 'last_funding_round', 'confidence_score', 'created_at', 'updated_at', 'last_verified_at']) {
      expect(out[key]).toBeNull();
    }
    expect(out.source_ids).toEqual([]);
  });

  it('derives only from data the record already has', () => {
    const out = migrateCompanyRecord(legacy({ hiring: true }), ids);
    expect(out.state).toBe('NSW');
    expect(out.country).toBe('Australia');
    expect(out.hiring_status).toBe('hiring');
    expect(out.verification_status).toBe('location_verified');
  });

  it('does not turn hiring:false into "not_hiring" - the legacy flag cannot tell that from "none observed"', () => {
    expect(migrateCompanyRecord(legacy({ hiring: false }), ids).hiring_status).toBeNull();
  });

  it('does not call a company "active" without evidence', () => {
    expect(migrateCompanyRecord(legacy({ stage: 'Seed' }), ids).company_status).toBeNull();
  });

  it('maps the status-like legacy stages to company_status', () => {
    expect(migrateCompanyRecord(legacy({ stage: 'Acquired' }), ids).company_status).toBe('acquired');
    expect(migrateCompanyRecord(legacy({ stage: 'Subsidiary' }), ids).company_status).toBe('subsidiary');
    expect(migrateCompanyRecord(legacy({ stage: 'Defunct (in liquidation)' }), ids).company_status).toBe('defunct');
    expect(migrateCompanyRecord(legacy({ stage: 'Defunct (in administration)' }), ids).company_status).toBe('defunct');
  });

  it('marks unverified records as such and leaves their location fields null', () => {
    const out = migrateCompanyRecord(legacy({ verified: false, city: 'Unknown', lat: null, lng: null }), ids);
    expect(out.verification_status).toBe('unverified');
    expect(out.state).toBeNull();
    expect(out.country).toBeNull();
  });

  it('never overwrites a value that is already set', () => {
    const out = migrateCompanyRecord(legacy({ state: 'VIC', company_status: 'active', id: 'kept', slug: 'kept-slug' }), ids);
    expect(out.state).toBe('VIC');
    expect(out.company_status).toBe('active');
    expect(out.id).toBe('kept');
    expect(out.slug).toBe('kept-slug');
  });
});

describe('toCanonical', () => {
  it('exposes exactly the long-term model fields plus the three id lists', () => {
    expect(Object.keys(toCanonical(migrateCompanyRecord(legacy(), { id: 'acme', slug: 'acme' })))).toEqual([
      'id', 'name', 'slug', 'website', 'description', 'logo', 'sector', 'subsector', 'city', 'state', 'country',
      'suburb', 'postcode', 'latitude', 'longitude', 'location_precision', 'location_source', 'location_source_url',
      'location_verified_at', 'location_confidence', 'founded_year', 'stage', 'company_status', 'hiring_status', 'hiring_verified_at', 'employee_range',
      'funding_total', 'last_funding_date', 'last_funding_round', 'verification_status', 'confidence_score',
      'created_at', 'updated_at', 'last_verified_at', 'founder_ids', 'investor_ids', 'source_ids',
    ]);
  });

  it('collapses the legacy encodings of "unknown" into null and maps aliases without duplicating storage', () => {
    const canonical = toCanonical(migrateCompanyRecord(
      legacy({ website: '', blurb: '', stage: 'Unknown', city: 'Unknown', sector: 'Unknown', foundedYear: 2012 }),
      { id: 'acme', slug: 'acme' },
    ));
    expect(canonical.website).toBeNull();
    expect(canonical.description).toBeNull();
    expect(canonical.stage).toBeNull();
    expect(canonical.city).toBeNull();
    expect(canonical.sector).toBeNull();
    expect(canonical.founded_year).toBe(2012);
    expect(canonical.latitude).toBe(-33.9);
    expect(canonical.longitude).toBe(151.2);
  });
});

describe('migrateDataset', () => {
  it('assigns unique ids and slugs, suffixing collisions', () => {
    const out = migrateDataset(dataset([legacy({ name: 'Foo' }), legacy({ name: 'foo' }), legacy({ name: 'Bar' })]));
    expect(out.companies.map((c) => c.id)).toEqual(['foo', 'foo-2', 'bar']);
    expect(out.companies.map((c) => c.slug)).toEqual(['foo', 'foo-2', 'bar']);
  });

  it('preserves every legacy field and the record order', () => {
    const input = [legacy({ name: 'A', founders: ['X Y'], foundedYear: 2010, address: '1 A St, Sydney NSW 2000' }), legacy({ name: 'B', website: '', blurb: '' })];
    const before = JSON.parse(JSON.stringify(input));
    const out = migrateDataset(dataset(input));
    out.companies.forEach((c, i) => {
      for (const key of LEGACY_FIELDS) if (key in before[i]) expect(c[key]).toEqual(before[i][key]);
      expect(c.name).toBe(before[i].name);
    });
  });

  it('is idempotent', () => {
    const once = migrateDataset(dataset([legacy({ name: 'A', founders: ['X Y'], investors: ['Blackbird'] })]));
    expect(migrateDataset(once)).toEqual(once);
  });

  it('keeps an id once assigned, even if the company is later renamed', () => {
    const once = migrateDataset(dataset([legacy({ name: 'Old Name' })]));
    const renamed = { ...once, companies: [{ ...once.companies[0], name: 'New Name' }] };
    expect(migrateDataset(renamed).companies[0].id).toBe('old-name');
  });

  it('links founders to people and investors to investor entities, in order', () => {
    const out = migrateDataset(dataset([legacy({ founders: ['Jane Doe', 'John Roe'], investors: ['Blackbird', 'Startmate'] })]));
    expect(out.companies[0].founder_ids).toEqual(['jane-doe', 'john-roe']);
    expect(out.companies[0].investor_ids).toEqual(['blackbird', 'startmate']);
    expect(out.people.map((p) => p.name)).toEqual(['Jane Doe', 'John Roe']);
  });

  it('reuses one person entity for a founder of two companies', () => {
    const out = migrateDataset(dataset([legacy({ name: 'A', founders: ['Jane Doe'] }), legacy({ name: 'B', founders: ['jane doe'] })]));
    expect(out.people).toHaveLength(1);
    expect(out.companies[0].founder_ids).toEqual(out.companies[1].founder_ids);
  });

  it('merges only case variants of an investor, keeping the other spelling as an alias', () => {
    const out = migrateDataset(dataset([
      legacy({ name: 'A', investors: ['AirTree'] }), legacy({ name: 'B', investors: ['AirTree'] }), legacy({ name: 'C', investors: ['Airtree'] }),
    ]));
    expect(out.investors).toHaveLength(1);
    expect(out.investors[0]).toMatchObject({ name: 'AirTree', aliases: ['Airtree'] });
  });

  it('does not merge near-duplicates that need a human call', () => {
    const out = migrateDataset(dataset([
      legacy({ name: 'A', investors: ['Latitude'] }), legacy({ name: 'B', investors: ['Latitude 37'] }), legacy({ name: 'C', investors: ['Prosus', 'Prosus Ventures'] }),
    ]));
    expect(out.investors.map((i) => i.name)).toEqual(['Latitude', 'Latitude 37', 'Prosus', 'Prosus Ventures']);
  });

  it('never removes an existing person or investor when a company stops referencing them', () => {
    const first = migrateDataset(dataset([legacy({ founders: ['Jane Doe'], investors: ['Blackbird'] })]));
    const edited = { ...first, companies: [{ ...first.companies[0], founders: [], investors: [] }] };
    const again = migrateDataset(edited);
    expect(again.people).toHaveLength(1);
    expect(again.investors).toHaveLength(1);
    expect(again.companies[0].founder_ids).toEqual([]);
  });
});

describe('investorReviewNotes', () => {
  const entities = (...names) => names.map((name, i) => ({ id: `i${i}`, name, slug: `i${i}`, aliases: [] }));

  it('flags qualifier and compound names and prefix near-duplicates', () => {
    const notes = investorReviewNotes(entities('OneVentures', 'OneVentures etc.', 'x15', 'x15/CBA', 'Prosus', 'Prosus Ventures'));
    expect(notes.map((n) => n.name)).toEqual(expect.arrayContaining(['OneVentures etc.', 'x15/CBA', 'Prosus Ventures']));
  });

  it('does not flag unrelated names that merely share letters', () => {
    expect(investorReviewNotes(entities('Tidal', 'Tank Stream', 'Square Peg', 'Squarely'))).toEqual([]);
  });
});

describe('validateDataset', () => {
  const valid = () => migrateDataset(dataset([legacy({ name: 'A', hiring: true, founders: ['Jane Doe'], investors: ['Blackbird'] })]));

  it('accepts a freshly migrated dataset', () => {
    expect(validateDataset(valid())).toEqual([]);
  });

  it('rejects a duplicate id', () => {
    const ds = valid();
    ds.companies.push({ ...ds.companies[0], name: 'Dup', slug: 'dup' });
    expect(validateDataset(ds).join('\n')).toMatch(/duplicate id "a"/);
  });

  it('rejects an invalid enum value', () => {
    const ds = valid();
    ds.companies[0].company_status = 'thriving';
    expect(validateDataset(ds).join('\n')).toMatch(/invalid company_status/);
  });

  it('rejects hiring and hiring_status disagreeing', () => {
    const ds = valid();
    ds.companies[0].hiring = false;
    expect(validateDataset(ds).join('\n')).toMatch(/hiring and hiring_status disagree/);
  });

  it('rejects a verification date with nothing cited', () => {
    const ds = valid();
    ds.companies[0].last_verified_at = '2026-10-05T00:00:00.000Z';
    expect(validateDataset(ds).join('\n')).toMatch(/last_verified_at is set but source_ids is empty/);
  });

  it('rejects a state that is not an Australian state or territory', () => {
    const ds = valid();
    ds.companies[0].state = 'CA';
    expect(validateDataset(ds).join('\n')).toMatch(/invalid state/);
  });

  it('rejects half a coordinate pair', () => {
    const ds = valid();
    ds.companies[0].lng = null;
    expect(validateDataset(ds).join('\n')).toMatch(/lat and lng must both be set or both null/);
  });

  it('rejects a founder id that no longer matches the founders list', () => {
    const ds = valid();
    ds.companies[0].founders = ['Someone Else'];
    expect(validateDataset(ds).join('\n')).toMatch(/does not match founders|founder_ids/);
  });

  it('rejects a funding round pointing at a company or investor that does not exist', () => {
    const ds = valid();
    ds.funding_rounds.push({ id: 'r1', company_id: 'ghost', round: 'Seed', amount: 1, currency: 'AUD', announced_on: null, lead_investor_ids: [], investor_ids: ['nobody'], source_ids: [] });
    const text = validateDataset(ds).join('\n');
    expect(text).toMatch(/unknown company_id "ghost"/);
    expect(text).toMatch(/unknown investor id "nobody"/);
  });

  it('rejects a funding amount with no currency', () => {
    const ds = valid();
    ds.funding_rounds.push({ id: 'r1', company_id: 'a', round: 'Seed', amount: 5, currency: null, announced_on: null, lead_investor_ids: [], investor_ids: [], source_ids: [] });
    expect(validateDataset(ds).join('\n')).toMatch(/needs a 3-letter currency/);
  });

  it('rejects jobs and news that reference missing companies', () => {
    const ds = valid();
    ds.jobs.push({ id: 'j1', company_id: 'ghost', title: 'Engineer', status: 'open', apply_url: null, source_id: null });
    ds.news.push({ id: 'n1', headline: 'H', url: 'https://example.com', company_ids: ['ghost'], source_id: null });
    const text = validateDataset(ds).join('\n');
    expect(text).toMatch(/job "j1": unknown company_id/);
    expect(text).toMatch(/news "n1": unknown company id/);
  });
});

describe('getCompanyWithRelations', () => {
  const ds = migrateDataset(dataset(
    [legacy({ name: 'A', founders: ['Jane Doe'], investors: ['Blackbird'], source_ids: ['s1'] })],
    {
      sources: [{ id: 's1', kind: 'press', url: 'https://example.com', title: 'T', publisher: 'P', retrieved_at: null, note: '' }],
      funding_rounds: [{ id: 'r1', company_id: 'a', round: 'Seed', amount: 1000, currency: 'AUD', announced_on: '2026-01', lead_investor_ids: [], investor_ids: ['blackbird'], source_ids: ['s1'] }],
    },
  ));

  it('resolves founders, investors, funding rounds and sources by id or slug', () => {
    const company = getCompanyWithRelations(ds, 'a');
    expect(company.founders.map((p) => p.name)).toEqual(['Jane Doe']);
    expect(company.investors.map((i) => i.name)).toEqual(['Blackbird']);
    expect(company.funding_rounds.map((r) => r.id)).toEqual(['r1']);
    expect(company.sources.map((s) => s.id)).toEqual(['s1']);
    expect(getCompanyWithRelations(ds, 'a').id).toBe('a');
  });

  it('returns empty lists - not guesses - for relationships with no data', () => {
    const company = getCompanyWithRelations(ds, 'a');
    expect(company.jobs).toEqual([]);
    expect(company.news).toEqual([]);
  });

  it('returns null for an unknown company', () => {
    expect(getCompanyWithRelations(ds, 'nope')).toBeNull();
  });
});
