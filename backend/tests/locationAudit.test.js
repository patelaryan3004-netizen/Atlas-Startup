import { describe, it, expect } from 'vitest';
import { reviewLocations, LOCATION_ISSUES, MAX_KM_FROM_CITY, CENTRE_METRES } from '../src/models/locationAudit.js';
import { remember } from '../src/models/geocodeCache.js';
import { PRECISIONS } from '../src/models/location.js';
import { co, dataset, source, evidenceRow, NOW, ISO, KIPPAX, KIPPAX_QUERY, KIPPAX_POINT, WILLIAM, WILLIAM_POINT } from './helpers/locations.js';

const ASOF = ISO;
const review = (companies, extra = {}, asOf = ASOF) => reviewLocations(dataset(companies, extra), { asOf });
const codes = (r, name) => r.rows.find((x) => x.name === name)?.issues.map((i) => i.code) ?? [];
const cache = (...rows) => rows.reduce((acc, [query, quality, result]) => { remember(acc, { provider: 'nominatim', query, status: 'found', quality, result }, NOW); return acc; }, []);
const SYDNEY = { lat: -33.8688, lng: 151.2093 };
const backing = (id, address) => ({ sources: [source('site')], evidence: [evidenceRow(id, 'address', address, 'site')] });

describe('how well locations are known', () => {
  const mix = () => review([
    co('Exact', { address: KIPPAX, ...KIPPAX_POINT }), co('Suburban', { address: 'Surry Hills, Sydney NSW 2010', lat: -33.8848, lng: 151.2098 }),
    co('Citywide'), co('Statewide', { city: 'Unknown', state: 'VIC' }), co('Nowhere', { city: 'Unknown', verified: false }),
  ]);

  it('counts the companies at each precision, and all of them', () => {
    const r = mix();
    expect(r.total).toBe(5);
    expect(r.precision).toEqual({ EXACT: 1, SUBURB: 1, CITY: 1, STATE: 1, UNKNOWN: 1 });
    expect(Object.keys(r.precision)).toEqual(PRECISIONS);
    expect(r.asOf).toBe('2026-10-05');
  });

  it('says what is missing for each precision short of an exact one', () => {
    const r = mix();
    expect(codes(r, 'Citywide')).toContain('city_level_only');
    expect(codes(r, 'Statewide')).toContain('state_level_only');
    expect(codes(r, 'Suburban')).toContain('suburb_level_only');
    expect(codes(r, 'Nowhere')).toEqual(['unknown_location']);
  });

  it('says what an unknown location\'s address on file is: not counted, and not discarded', () => {
    const r = review([co('Nowhere', { city: 'Unknown', verified: false, address: '1 Some Street, Perth WA 6000' })]);
    const issue = r.rows[0].issues[0];
    expect(issue.code).toBe('unknown_location');
    expect(issue.detail).toBe('an address on file ("1 Some Street, Perth WA 6000") is not counted as the company\'s place');
    expect(r.rows[0]).toMatchObject({ lat: null, lng: null, precision: 'UNKNOWN' });
  });

  it('has nothing to say about a located company that is backed by its own page and agrees with the geocoder', () => {
    const r = review([co('Clean', { address: KIPPAX, ...KIPPAX_POINT })], {
      ...backing('clean', KIPPAX), geocode_cache: cache([KIPPAX_QUERY, 'house', { ...KIPPAX_POINT, address: { house_number: '110', road: 'Kippax Street', suburb: 'Surry Hills', state: 'New South Wales', postcode: '2010' } }]),
    });
    expect(r.rows).toEqual([]);
    expect(r.flags).toEqual({ duplicate_coordinates: 0, city_centroid_coordinates: 0, location_conflicts: 0, missing_coordinates: 0, potentially_stale: 0, unverified_addresses: 0 });
  });
});

describe('what is wrong with a pin', () => {
  it('flags a city-level company that carries coordinates: a city centre, not the company', () => {
    const r = review([co('Citywide', { lat: -33.86984, lng: 151.20828 })]);
    expect(codes(r, 'Citywide')).toEqual(expect.arrayContaining(['city_level_only', 'coordinates_on_area_location']));
    expect(r.rows[0].issues.find((i) => i.code === 'coordinates_on_area_location').detail).toBe('-33.86984, 151.20828');
    expect(r.flags.city_centroid_coordinates).toBe(1);
    expect(r.rows[0]).toMatchObject({ lat: -33.86984, lng: 151.20828 }); // the queue shows what is on file: that is the problem
  });

  it('flags a pin on a city centre that nothing backs, but not one a source has checked', () => {
    const bare = review([co('Acme', { address: KIPPAX, ...SYDNEY })]);
    expect(codes(bare, 'Acme')).toContain('city_centre_coordinates');
    expect(bare.rows[0].issues.find((i) => i.code === 'city_centre_coordinates').detail).toBe('0 m from the centre of Sydney');
    expect(bare.flags.city_centroid_coordinates).toBe(1);
    const checked = review([co('Acme', { address: KIPPAX, ...SYDNEY })], backing('acme', KIPPAX));
    expect(codes(checked, 'Acme')).not.toContain('city_centre_coordinates');
    expect(CENTRE_METRES).toBe(120);
    const near = review([co('Acme', { address: KIPPAX, lat: -33.8688 + 0.0008, lng: 151.2093 })]); // 89 m away
    expect(codes(near, 'Acme')).toContain('city_centre_coordinates');
    const away = review([co('Acme', { address: KIPPAX, lat: -33.8688 + 0.002, lng: 151.2093 })]); // 222 m away
    expect(codes(away, 'Acme')).not.toContain('city_centre_coordinates');
  });

  it('does not call a pin a city-centre fallback when the geocoder puts the company\'s own address exactly there', () => {
    const answer = { ...SYDNEY, address: { house_number: '110', road: 'Kippax Street', suburb: 'Surry Hills', state: 'New South Wales', postcode: '2010' } };
    const backed = review([co('Acme', { address: KIPPAX, ...SYDNEY })], { geocode_cache: cache([KIPPAX_QUERY, 'house', answer]) });
    expect(codes(backed, 'Acme')).not.toContain('city_centre_coordinates');
    expect(backed.flags.city_centroid_coordinates).toBe(0);
    const elsewhere = review([co('Acme', { address: KIPPAX, ...SYDNEY })], { geocode_cache: cache([KIPPAX_QUERY, 'house', { ...answer, lat: KIPPAX_POINT.lat, lng: KIPPAX_POINT.lng }]) });
    expect(codes(elsewhere, 'Acme')).toContain('city_centre_coordinates'); // the geocoder puts it elsewhere: the pin is the centre
  });

  it('flags companies at different addresses that share a point, but not companies at the same address', () => {
    const shared = review([
      co('Alpha', { address: '1 George Street, Sydney NSW 2000', ...KIPPAX_POINT }), co('Beta', { address: '200 Pitt Street, Sydney NSW 2000', ...KIPPAX_POINT }),
      co('Cowork One', { address: WILLIAM, city: 'Melbourne', ...WILLIAM_POINT }), co('Cowork Two', { address: 'Level 9, 15 William Street, Melbourne VIC 3000', city: 'Melbourne', ...WILLIAM_POINT }),
    ]);
    expect(codes(shared, 'Alpha')).toContain('shared_coordinates');
    expect(codes(shared, 'Beta')).toContain('shared_coordinates');
    expect(codes(shared, 'Cowork One')).not.toContain('shared_coordinates');
    expect(codes(shared, 'Cowork Two')).not.toContain('shared_coordinates');
    expect(shared.flags.duplicate_coordinates).toBe(2);
    expect(shared.rows.find((x) => x.name === 'Alpha').issues.find((i) => i.code === 'shared_coordinates').detail).toBe('with Beta');
  });

  it('does not call two companies in the same suburb a duplicate pin', () => {
    const point = { lat: -33.8885, lng: 151.2113 };
    const r = review([co('One', { address: 'Surry Hills, Sydney NSW 2010', ...point }), co('Two', { address: 'Surry Hills, Sydney NSW 2010', ...point })]);
    expect(r.flags.duplicate_coordinates).toBe(0);
  });

  it('says how many it is sharing with, and names the first three', () => {
    const r = review(['A', 'B', 'C', 'D', 'E'].map((n, i) => co(`Co ${n}`, { address: `${i + 1} George Street, Sydney NSW 2000`, ...KIPPAX_POINT })));
    expect(r.rows.find((x) => x.name === 'Co A').issues.find((i) => i.code === 'shared_coordinates').detail).toBe('with Co B, Co C, Co D and 1 more');
  });

  it('flags a point that is not in the state the record names, and one that is far from its city', () => {
    const wrongState = review([co('Acme', { address: KIPPAX, lat: -37.8136, lng: 144.9631 })]);
    expect(codes(wrongState, 'Acme')).toContain('coordinates_conflict');
    expect(wrongState.rows[0].issues.find((i) => i.code === 'coordinates_conflict').detail).toBe('the point is not in NSW');
    expect(wrongState.flags.location_conflicts).toBe(1);
    const far = review([co('Acme', { address: KIPPAX, lat: -32.9283, lng: 151.7817 })]); // Newcastle, in NSW, 117 km from Sydney
    expect(MAX_KM_FROM_CITY).toBe(100);
    expect(far.rows[0].issues.find((i) => i.code === 'coordinates_conflict').detail).toMatch(/^the point is 11\d km from Sydney$/);
    const near = review([co('Acme', { address: KIPPAX, ...KIPPAX_POINT })]);
    expect(codes(near, 'Acme')).not.toContain('coordinates_conflict');
  });

  it('flags a location that says it is a point and has none, and a street address that was never plotted', () => {
    const ds = dataset([co('Lost', { address: KIPPAX, ...KIPPAX_POINT }), co('Unplotted', { address: WILLIAM, city: 'Melbourne' })]);
    const lost = ds.companies.find((c) => c.name === 'Lost');
    lost.lat = null; lost.lng = null; // an EXACT location whose point has gone
    const r = reviewLocations(ds, { asOf: ASOF });
    expect(codes(r, 'Lost')).toContain('missing_coordinates');
    expect(codes(r, 'Unplotted')).toEqual(expect.arrayContaining(['city_level_only', 'address_not_geocoded']));
    expect(r.flags.missing_coordinates).toBe(2);
    expect(r.rows.find((x) => x.name === 'Unplotted').issues.find((i) => i.code === 'address_not_geocoded').detail).toBe(WILLIAM);
  });

  it('flags an address the geocoder puts somewhere else, as a conflict to look at', () => {
    const r = review([co('Acme', { address: KIPPAX, ...KIPPAX_POINT })], {
      geocode_cache: cache([KIPPAX_QUERY, 'house', { lat: KIPPAX_POINT.lat - 0.03, lng: KIPPAX_POINT.lng, address: { house_number: '110', road: 'Kippax Street', suburb: 'Surry Hills', state: 'New South Wales', postcode: '2010' } }]),
    });
    expect(codes(r, 'Acme')).toContain('geocode_disagrees');
    expect(r.rows[0].issues.find((i) => i.code === 'geocode_disagrees').detail).toMatch(/^the point on file is \d\.\d km from where the geocoder puts the address \(the geocoder's point: -33\.91437, 151\.20963\)$/);
    expect(r.flags.location_conflicts).toBe(1);
  });

  it('flags a city field that holds a suburb', () => {
    const r = review([co('Acme', { city: 'Richmond', address: '33 Stewart Street, Richmond VIC 3121', lat: -37.8183, lng: 144.9981 })]);
    expect(codes(r, 'Acme')).toContain('suburb_in_city_field');
    const fine = review([co('Acme', { city: 'Melbourne', address: '33 Stewart Street, Richmond VIC 3121', lat: -37.8183, lng: 144.9981 })]);
    expect(codes(fine, 'Acme')).not.toContain('suburb_in_city_field');
  });

  it('flags a located company with no state', () => {
    const r = review([co('Acme', { city: 'Narnia' })]);
    expect(codes(r, 'Acme')).toContain('no_state');
    expect(codes(review([co('Acme')]), 'Acme')).not.toContain('no_state');
  });
});

describe('what is stale or unchecked', () => {
  it('flags an address that no source has been checked for, and counts it', () => {
    const r = review([co('Acme', { address: KIPPAX, ...KIPPAX_POINT })]);
    expect(codes(r, 'Acme')).toEqual(['address_unverified']);
    expect(r.flags.unverified_addresses).toBe(1);
    expect(codes(review([co('Acme', { address: KIPPAX, ...KIPPAX_POINT })], backing('acme', KIPPAX)), 'Acme')).toEqual([]);
  });

  it('flags a location last checked over a year ago, and not one checked this week', () => {
    const old = review([co('Acme', { address: KIPPAX, ...KIPPAX_POINT })], { sources: [source('site')], evidence: [evidenceRow('acme', 'address', KIPPAX, 'site', { verified_at: '2025-06-01T00:00:00.000Z' })] });
    expect(codes(old, 'Acme')).toEqual(['stale_location']);
    expect(old.rows[0].issues[0].detail).toBe('checked 2025-06-01');
    expect(old.flags.potentially_stale).toBe(1);
    const fresh = review([co('Acme', { address: KIPPAX, ...KIPPAX_POINT })], backing('acme', KIPPAX));
    expect(fresh.flags.potentially_stale).toBe(0);
    // it goes stale with the clock: the same data a year and a day on
    const later = reviewLocations(dataset([co('Acme', { address: KIPPAX, ...KIPPAX_POINT })], backing('acme', KIPPAX)), { asOf: '2027-10-07T04:00:00.000Z' });
    expect(codes(later, 'Acme')).toEqual(['stale_location']);
  });

  it('flags a company that has closed, been acquired or become a subsidiary: its place may be a past one', () => {
    for (const stage of ['Defunct', 'Acquired', 'Subsidiary']) {
      const r = review([co('Acme', { address: KIPPAX, ...KIPPAX_POINT, stage })], backing('acme', KIPPAX));
      expect(codes(r, 'Acme'), stage).toEqual(['historical_location']);
      expect(r.rows[0].issues[0].detail).toBe(stage.toLowerCase());
      expect(r.flags.potentially_stale).toBe(1);
    }
  });
});

describe('the queue itself', () => {
  const messy = () => review([
    co('Aaa Conflict', { address: KIPPAX, lat: -37.8136, lng: 144.9631 }), co('Bbb City'), co('Ccc Unverified', { address: WILLIAM, city: 'Melbourne', ...WILLIAM_POINT }),
    co('Ddd Clean', { address: '5 Collins Street, Melbourne VIC 3000', city: 'Melbourne', lat: -37.8142, lng: 144.9696 }),
  ], { ...backing('ddd-clean', '5 Collins Street, Melbourne VIC 3000') });

  it('lists the worst first, then by how much is wrong, then by name', () => {
    const r = messy();
    expect(r.rows.map((x) => [x.name, x.worst])).toEqual([['Aaa Conflict', 'high'], ['Bbb City', 'medium'], ['Ccc Unverified', 'low']]);
    expect(r.rows[0].issues.map((i) => i.severity)).toEqual([...r.rows[0].issues.map((i) => i.severity)].sort((a, b) => 'highmediumlow'.indexOf(a) - 'highmediumlow'.indexOf(b)));
  });

  it('says for each company what it is, where it is, where that came from, and each problem with what to do about it', () => {
    const row = messy().rows[0];
    expect(row).toMatchObject({ name: 'Aaa Conflict', city: 'Sydney', state: 'NSW', precision: 'EXACT', source: 'directory_record', source_url: null, verified_at: null, confidence: 'low', address: KIPPAX });
    expect(row.company_id).toBe('aaa-conflict');
    for (const issue of row.issues) {
      expect(Object.keys(issue).sort()).toEqual(['action', 'code', 'detail', 'label', 'severity']);
      expect(issue.detail === null || typeof issue.detail === 'string').toBe(true);
    }
    expect(row.issues.find((i) => i.code === 'coordinates_conflict').action).toBe(LOCATION_ISSUES.coordinates_conflict.action);
  });

  it('counts how many companies have each problem, including those with none', () => {
    const r = messy();
    expect(Object.keys(r.issues).sort()).toEqual(Object.keys(LOCATION_ISSUES).sort());
    expect(r.issues.coordinates_conflict).toMatchObject({ count: 1, severity: 'high' });
    expect(r.issues.city_level_only.count).toBe(1);
    expect(r.issues.stale_location.count).toBe(0);
    expect(r.issues.coordinates_conflict.action).toBe(LOCATION_ISSUES.coordinates_conflict.action);
  });

  it('gives every problem a severity, a label and something to do about it', () => {
    for (const [code, spec] of Object.entries(LOCATION_ISSUES)) {
      expect(['high', 'medium', 'low'], code).toContain(spec.severity);
      expect(spec.label.length, code).toBeGreaterThan(8);
      expect(spec.action.length, code).toBeGreaterThan(8);
    }
  });

  it('reads a record that predates the location fields as what it would be worked out to be, and changes nothing', () => {
    const legacy = { id: 'old', name: 'Old', city: 'Sydney', lat: -33.86984, lng: 151.20828, verified: true, stage: 'Seed', address: undefined };
    const ds = { companies: [legacy], geocode_cache: [] };
    const before = structuredClone(ds);
    const r = reviewLocations(ds, { asOf: ASOF });
    expect(r.precision.CITY).toBe(1);
    expect(codes(r, 'Old')).toEqual(expect.arrayContaining(['city_level_only', 'coordinates_on_area_location']));
    expect(ds).toEqual(before);
  });

  it('never changes the dataset it is given', () => {
    const ds = dataset([co('Aaa Conflict', { address: KIPPAX, lat: -37.8136, lng: 144.9631 }), co('Citywide', { lat: -33.86984, lng: 151.20828 })]);
    const before = structuredClone(ds);
    reviewLocations(ds, { asOf: ASOF });
    expect(ds).toEqual(before);
  });
});
