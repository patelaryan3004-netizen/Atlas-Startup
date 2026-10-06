import { describe, it, expect } from 'vitest';
import { geocodeTargets, applyGeocodes, applyPromotions, promotionCandidates, verifyFromEvidence, clearAreaCoordinates } from '../src/geo/locate.js';
import { remember } from '../src/models/geocodeCache.js';
import { migrateDataset, validateDataset } from '../src/models/dataset.js';
import { co, dataset, source, evidenceRow, NOW, ISO, KIPPAX, KIPPAX_QUERY, KIPPAX_POINT, WILLIAM, WILLIAM_QUERY, WILLIAM_POINT } from './helpers/locations.js';

const T = '2026-10-06T04:00:00.000Z';
const EARLIER = '2026-10-04T04:00:00.000Z'; // a day before ISO, when the evidence the other tests use was read
const answer = (point, address = {}) => ({ ...point, address: { house_number: '110', road: 'Kippax Street', suburb: 'Surry Hills', city: 'Sydney', state: 'New South Wales', postcode: '2010', ...address } });
const cache = (...rows) => rows.reduce((acc, [query, quality, result]) => {
  remember(acc, { provider: 'nominatim', query, status: result ? 'found' : 'none', quality, result }, NOW);
  return acc;
}, []);

describe('which companies a geocoder is asked about', () => {
  const mix = () => dataset([
    co('Exact', { address: KIPPAX, ...KIPPAX_POINT }),
    co('Unplotted', { address: WILLIAM, city: 'Melbourne' }),
    co('Suburban', { address: 'Surry Hills, Sydney NSW 2010', lat: -33.8848, lng: 151.2098 }),
    co('Citywide'),
    co('Nowhere', { city: 'Unknown', verified: false, address: '1 Some Street, Perth WA 6000' }),
  ]);

  it('is a located company with a street address (to place it, or to check it) and a suburb-level one, and nobody else', () => {
    const targets = geocodeTargets(mix());
    expect(targets.map((t) => [t.company.name, t.question.kind]).sort()).toEqual([['Exact', 'address'], ['Suburban', 'suburb'], ['Unplotted', 'address']]);
  });

  it('can be limited to one company', () => {
    const ds = mix();
    const id = ds.companies.find((c) => c.name === 'Exact').id;
    expect(geocodeTargets(ds, { company: id }).map((t) => t.company.name)).toEqual(['Exact']);
    expect(geocodeTargets(ds, { company: 'nobody' })).toEqual([]);
  });
});

describe('putting the geocoder\'s answer on a company', () => {
  it('places a company that has an address and no point, at the exact precision, and does not call it verified', () => {
    const ds = dataset([co('Acme', { address: KIPPAX })], { geocode_cache: cache([KIPPAX_QUERY, 'house', answer(KIPPAX_POINT)]) });
    expect(ds.companies[0]).toMatchObject({ location_precision: 'CITY', lat: null });
    const work = structuredClone(ds);
    const [r] = applyGeocodes(work, { at: T });
    expect(r).toMatchObject({ company_id: 'acme', kind: 'address', action: 'place', away: null });
    expect(r.changes.map((c) => c.field)).toEqual(expect.arrayContaining(['lat', 'lng', 'suburb', 'postcode', 'location_precision']));
    expect(work.companies[0]).toMatchObject({
      location_precision: 'EXACT', lat: KIPPAX_POINT.lat, lng: KIPPAX_POINT.lng, suburb: 'Surry Hills', postcode: '2010', address: KIPPAX,
      updated_at: T, location_source: 'directory_record', location_verified_at: null, location_confidence: 'low',
    });
    const out = migrateDataset(work);
    expect(validateDataset(out)).toEqual([]);
    expect(out.company_locations[0]).toMatchObject({ latitude: KIPPAX_POINT.lat, longitude: KIPPAX_POINT.lng, location_precision: 'EXACT' });
  });

  it('replaces a point that is the same place with the geocoder\'s, and is surer of it when a source backs the address', () => {
    const ds = dataset([co('Acme', { address: KIPPAX, lat: KIPPAX_POINT.lat + 0.0007, lng: KIPPAX_POINT.lng })], {
      sources: [source('site')], evidence: [evidenceRow('acme', 'address', KIPPAX, 'site')], geocode_cache: cache([KIPPAX_QUERY, 'house', answer(KIPPAX_POINT)]),
    });
    expect(ds.companies[0]).toMatchObject({ location_precision: 'EXACT', location_source: 'company_website', location_confidence: 'medium' });
    const work = structuredClone(ds);
    const [r] = applyGeocodes(work, { at: T });
    expect(r).toMatchObject({ action: 'confirm' });
    expect(r.away).toBeGreaterThan(60);
    expect(r.away).toBeLessThan(100);
    expect(work.companies[0]).toMatchObject({ lat: KIPPAX_POINT.lat, lng: KIPPAX_POINT.lng, location_confidence: 'high', location_source: 'company_website', location_verified_at: ISO });
  });

  it('says it agrees, and changes nothing, when the point on file is the geocoder\'s own', () => {
    const ds = dataset([co('Acme', { address: KIPPAX, ...KIPPAX_POINT })], { geocode_cache: cache([KIPPAX_QUERY, 'house', answer(KIPPAX_POINT)]) });
    const work = structuredClone(ds);
    const results = applyGeocodes(work, { at: T });
    expect(results).toEqual([expect.objectContaining({ action: 'agrees', changes: [] })]);
    expect(work.companies).toEqual(ds.companies);
  });

  it('does not move a point the geocoder agrees with, but is surer of it when a source backs the address', () => {
    const ds = dataset([co('Acme', { address: KIPPAX, ...KIPPAX_POINT })], {
      sources: [source('site')], evidence: [evidenceRow('acme', 'address', KIPPAX, 'site')], geocode_cache: cache([KIPPAX_QUERY, 'house', answer({ lat: KIPPAX_POINT.lat + 0.00005, lng: KIPPAX_POINT.lng })]),
    });
    const work = structuredClone(ds);
    const [r] = applyGeocodes(work, { at: T });
    expect(r).toMatchObject({ action: 'agrees', changes: [{ field: 'location_confidence', from: 'medium', to: 'high' }] });
    expect(work.companies[0]).toMatchObject({ lat: KIPPAX_POINT.lat, lng: KIPPAX_POINT.lng, location_confidence: 'high' });
  });

  it('reports a conflict and leaves the company alone when the geocoder puts the address somewhere else', () => {
    const far = { lat: KIPPAX_POINT.lat - 0.03, lng: KIPPAX_POINT.lng };
    const ds = dataset([co('Acme', { address: KIPPAX, ...KIPPAX_POINT })], { geocode_cache: cache([KIPPAX_QUERY, 'house', answer(far)]) });
    const work = structuredClone(ds);
    const [r] = applyGeocodes(work, { at: T });
    expect(r).toMatchObject({ action: 'conflict', changes: [] });
    expect(r.reason).toMatch(/the point on file is \d\.\d km from where the geocoder puts the address/);
    expect(work.companies).toEqual(ds.companies);
  });

  it('reports a conflict, not a correction, when the geocoder puts the address in another state', () => {
    const ds = dataset([co('Acme', { address: WILLIAM, city: 'Melbourne', ...WILLIAM_POINT })], {
      geocode_cache: cache([WILLIAM_QUERY, 'house', answer(WILLIAM_POINT, { house_number: '15', road: 'William Street', state: 'Western Australia', postcode: '6000', suburb: 'Perth', city: 'Perth' })]),
    });
    const [r] = applyGeocodes(structuredClone(ds), { at: T });
    expect(r.action).toBe('conflict');
    expect(r.reason).toMatch(/^the geocoder put it in WA, not VIC/); // every disagreement is listed, the state first
  });

  it('leaves a suburb-level company\'s point where it is when it is inside the suburb the geocoder found, and keeps it suburb-level', () => {
    const centre = { lat: -33.8885, lng: 151.2113 };
    const ds = dataset([co('Acme', { address: 'Surry Hills, Sydney NSW 2010', lat: -33.8848, lng: 151.2098 })], {
      geocode_cache: cache(['Surry Hills, NSW, 2010, Australia', 'suburb', { ...centre, address: { suburb: 'Surry Hills', city: 'Sydney', state: 'New South Wales', postcode: '2010' } }]),
    });
    expect(ds.companies[0].location_precision).toBe('SUBURB');
    const work = structuredClone(ds);
    const [r] = applyGeocodes(work, { at: T });
    expect(r).toMatchObject({ kind: 'suburb', action: 'agrees', changes: [] });
    expect(work.companies).toEqual(ds.companies);
  });

  it('reports a suburb-level company whose point is outside the suburb the geocoder found', () => {
    const centre = { lat: -33.8885, lng: 151.2113 };
    const ds = dataset([co('Acme', { address: 'Surry Hills, Sydney NSW 2010', lat: -33.8848 - 0.05, lng: 151.2098 })], {
      geocode_cache: cache(['Surry Hills, NSW, 2010, Australia', 'suburb', { ...centre, address: { suburb: 'Surry Hills', city: 'Sydney', state: 'New South Wales', postcode: '2010' } }]),
    });
    const work = structuredClone(ds);
    const [r] = applyGeocodes(work, { at: T });
    expect(r.action).toBe('conflict');
    expect(work.companies).toEqual(ds.companies);
  });

  it('does not settle an address the geocoder only half-knows: a street without the number is not an exact location', () => {
    const ds = dataset([co('Acme', { address: KIPPAX })], { geocode_cache: cache([KIPPAX_QUERY, 'street', { ...KIPPAX_POINT, address: { road: 'Kippax Street', suburb: 'Surry Hills', state: 'New South Wales', postcode: '2010' } }]) });
    const work = structuredClone(ds);
    const [r] = applyGeocodes(work, { at: T });
    expect(r).toMatchObject({ action: 'skip', reason: 'the geocoder found only the street, not the house', changes: [] });
    expect(work.companies).toEqual(ds.companies);
  });

  it('says so for an address nobody asked about yet, and leaves a company that has no address to ask about out of it', () => {
    const ds = dataset([co('Acme', { address: KIPPAX, ...KIPPAX_POINT }), co('Citywide')]);
    const results = applyGeocodes(structuredClone(ds), { at: T });
    expect(results.map((r) => [r.name, r.action])).toEqual([['Acme', 'unasked']]);
  });

  it('can be limited to one company', () => {
    const ds = dataset([co('Acme', { address: KIPPAX }), co('Beta', { address: WILLIAM, city: 'Melbourne' })], {
      geocode_cache: cache([KIPPAX_QUERY, 'house', answer(KIPPAX_POINT)], [WILLIAM_QUERY, 'house', answer(WILLIAM_POINT, { house_number: '15', road: 'William Street', suburb: 'Melbourne', city: 'Melbourne', state: 'Victoria', postcode: '3000' })]),
    });
    const work = structuredClone(ds);
    const results = applyGeocodes(work, { at: T, company: 'beta' });
    expect(results.map((r) => r.company_id)).toEqual(['beta']);
    expect(work.companies.find((c) => c.id === 'acme').lat).toBeNull();
    expect(work.companies.find((c) => c.id === 'beta').lat).toBe(WILLIAM_POINT.lat);
  });
});

describe('recording where an address was found', () => {
  const backed = (extra = {}) => ({ sources: [source('site'), source('press', 'press', 'https://news.example/acme')], evidence: [evidenceRow('acme', 'address', KIPPAX, 'site')], ...extra });

  it('attaches the page that states the address to a location nobody could trace, and says when it was read', () => {
    const ds = dataset([co('Acme', { address: KIPPAX, ...KIPPAX_POINT })]);
    expect(ds.companies[0]).toMatchObject({ location_source: 'directory_record', location_verified_at: null, location_confidence: 'low' });
    const work = structuredClone({ ...ds, ...backed() });
    const [r] = verifyFromEvidence(work, { at: T });
    expect(r).toMatchObject({ company_id: 'acme', action: 'verified', source: 'company_website' });
    expect(r.changes.map((c) => c.field)).toEqual(['location_source', 'location_source_url', 'location_verified_at', 'location_confidence']);
    expect(work.companies[0]).toMatchObject({ location_source: 'company_website', location_source_url: 'https://site.example/contact', location_verified_at: ISO, location_confidence: 'medium', updated_at: T });
    // the point and the precision are untouched: a source says where the address was found, not where the pin goes
    expect(work.companies[0]).toMatchObject({ lat: KIPPAX_POINT.lat, lng: KIPPAX_POINT.lng, location_precision: 'EXACT' });
  });

  it('is surer of it when the geocoder puts the address on the same spot', () => {
    const ds = dataset([co('Acme', { address: KIPPAX, ...KIPPAX_POINT })], { geocode_cache: cache([KIPPAX_QUERY, 'house', answer(KIPPAX_POINT)]) });
    const work = structuredClone({ ...ds, ...backed() });
    verifyFromEvidence(work, { at: T });
    expect(work.companies[0].location_confidence).toBe('high');
  });

  it('is not surer of it when the geocoder puts the address somewhere else', () => {
    const far = { lat: KIPPAX_POINT.lat - 0.03, lng: KIPPAX_POINT.lng };
    const ds = dataset([co('Acme', { address: KIPPAX, ...KIPPAX_POINT })], { geocode_cache: cache([KIPPAX_QUERY, 'house', answer(far)]) });
    const work = structuredClone({ ...ds, ...backed() });
    verifyFromEvidence(work, { at: T });
    expect(work.companies[0].location_confidence).toBe('medium');
  });

  it('only ever improves what is on record: a better source, or the same kind read more recently', () => {
    const ds = dataset([co('Acme', { address: KIPPAX, ...KIPPAX_POINT })], {
      sources: [source('site'), source('press', 'press', 'https://news.example/acme')],
      evidence: [evidenceRow('acme', 'address', KIPPAX, 'site')],
    });
    expect(ds.companies[0].location_source).toBe('company_website');
    // a worse source than the one on record: nothing changes
    const worse = structuredClone({ ...ds, evidence: [evidenceRow('acme', 'address', KIPPAX, 'press')] });
    expect(verifyFromEvidence(worse, { at: T })).toEqual([]);
    expect(worse.companies).toEqual(ds.companies);
    // the same page read again: newer wins
    const newer = structuredClone({ ...ds, evidence: [evidenceRow('acme', 'address', KIPPAX, 'site', { verified_at: T })] });
    const [r] = verifyFromEvidence(newer, { at: T });
    expect(r.changes.map((c) => c.field)).toEqual(['location_verified_at']);
    expect(newer.companies[0].location_verified_at).toBe(T);
    // the same page read earlier: nothing changes
    const older = structuredClone({ ...ds, evidence: [evidenceRow('acme', 'address', KIPPAX, 'site', { verified_at: EARLIER })] });
    expect(verifyFromEvidence(older, { at: T })).toEqual([]);
    // run again on what it just did: nothing more to do
    expect(verifyFromEvidence(newer, { at: T })).toEqual([]);
  });

  it('passes over a company that nothing backs, a company that is not located, and a page that states a different address', () => {
    const ds = dataset([
      co('Acme', { address: KIPPAX, ...KIPPAX_POINT }), co('Beta', { address: WILLIAM, city: 'Melbourne', ...WILLIAM_POINT }),
      co('Gamma', { city: 'Unknown', verified: false }), co('Delta', { address: undefined, state: 'VIC', city: 'Unknown', verified: false }),
    ]);
    const work = structuredClone({ ...ds, ...backed({ evidence: [evidenceRow('beta', 'address', '5 Other Road, Perth WA 6000', 'site')] }) });
    expect(verifyFromEvidence(work, { at: T })).toEqual([]);
    expect(work.companies).toEqual(ds.companies);
  });

  it('records the page that states the city for a company known only to its city', () => {
    const ds = dataset([co('Acme', {})]);
    const work = structuredClone({ ...ds, sources: [source('site')], evidence: [evidenceRow('acme', 'city', 'Sydney', 'site')] });
    const [r] = verifyFromEvidence(work, { at: T });
    expect(r).toMatchObject({ action: 'verified', source: 'company_website' });
    expect(work.companies[0]).toMatchObject({ location_precision: 'CITY', location_source: 'company_website', location_verified_at: ISO });
  });
});

describe('giving a city-level company the address its own website states', () => {
  const ADDRESS = '24 Campbell St, Sydney NSW 2000';
  const QUERY = '24 Campbell St, Sydney, NSW, 2000, Australia';
  const POINT = { lat: -33.8764, lng: 151.2049 };
  const found = (over = {}) => answer(POINT, { house_number: '24', road: 'Campbell Street', suburb: 'Sydney', state: 'New South Wales', postcode: '2000', ...over });
  const stated = (value, id = 'site', over = {}) => evidenceRow('harrison', 'address', value, id, over);
  const build = ({ companies = [co('Harrison')], evidence = [stated(ADDRESS)], sources = [source('site'), source('doc', 'company_document', 'https://doc.example/privacy')], geocode_cache = cache([QUERY, 'house', found()]) } = {}) =>
    dataset(companies, { sources, evidence, geocode_cache });

  it('finds a company known only to its city whose own pages state a street address, and no one else', () => {
    const ds = build({
      companies: [co('Harrison'), co('Housed', { address: KIPPAX }), co('Pressed'), co('Vague'), co('Pinned', { address: KIPPAX, ...KIPPAX_POINT })],
      sources: [source('site'), source('press', 'press', 'https://news.example/p')],
      evidence: [stated(ADDRESS), evidenceRow('housed', 'address', WILLIAM, 'site'), evidenceRow('pressed', 'address', ADDRESS, 'press'), evidenceRow('vague', 'address', 'Sydney NSW 2000', 'site'), evidenceRow('pinned', 'address', WILLIAM, 'site')],
    });
    const found2 = promotionCandidates(ds);
    expect(found2.map((p) => p.company.name)).toEqual(['Harrison']);
    expect(found2[0]).toMatchObject({ address: ADDRESS, disagree: false, question: { kind: 'address', query: QUERY } });
    expect(found2[0].asked).toMatchObject({ address: ADDRESS, name: 'Harrison' });
    expect(ds.companies.find((c) => c.name === 'Harrison').address).toBeUndefined(); // the record itself is not touched
  });

  it('takes the better source, and says so when the official sources do not agree', () => {
    const agreeing = build({ evidence: [stated('24 Campbell St, Sydney NSW 2000', 'site'), stated('24 Campbell Street, Sydney NSW 2000', 'doc')] });
    const [p] = promotionCandidates(agreeing);
    expect(p.evidence.source.kind).toBe('company_website');
    expect(p.disagree).toBe(false);
    const differing = build({ evidence: [stated('24 Campbell St, Sydney NSW 2000', 'site'), stated('99 George Street, Sydney NSW 2000', 'doc')] });
    expect(promotionCandidates(differing)[0].disagree).toBe(true);
  });

  it('is asked of the geocoder along with the other addresses, when asked for, and never applied as one', () => {
    const ds = build();
    expect(geocodeTargets(ds)).toEqual([]);
    const targets = geocodeTargets(ds, { candidates: true });
    expect(targets).toEqual([expect.objectContaining({ candidate: true, question: expect.objectContaining({ query: QUERY }) })]);
    const work = structuredClone(ds);
    expect(applyGeocodes(work, { at: T })).toEqual([]);
    expect(work.companies).toEqual(ds.companies);
  });

  it('puts the company at that address: exact, sourced to the page it was read on, and as sure as can be', () => {
    const ds = build();
    const work = structuredClone(ds);
    const [r] = applyPromotions(work, { at: T });
    expect(r).toMatchObject({ company_id: 'harrison', action: 'promoted', address: ADDRESS, source: 'company_website' });
    expect(r.changes.map((c) => c.field)).toEqual(expect.arrayContaining(['address', 'lat', 'lng', 'suburb', 'postcode', 'location_precision', 'location_source', 'location_confidence']));
    expect(work.companies[0]).toMatchObject({
      address: ADDRESS, location_precision: 'EXACT', lat: POINT.lat, lng: POINT.lng, postcode: '2000', city: 'Sydney', state: 'NSW', location_source: 'company_website',
      location_source_url: 'https://site.example/contact', location_verified_at: ISO, location_confidence: 'high', updated_at: T,
    });
    const out = migrateDataset(work);
    expect(validateDataset(out)).toEqual([]);
    expect(out.company_locations[0]).toMatchObject({ address: ADDRESS, latitude: POINT.lat, location_precision: 'EXACT' });
    expect(applyPromotions(work, { at: T })).toEqual([]); // it has an address now: nothing left to promote
  });

  it('does not, when its own page puts it in another state than the record does', () => {
    const ds = build({ companies: [co('Harrison', { city: 'Canberra', state: 'ACT' })] });
    const work = structuredClone(ds);
    const [r] = applyPromotions(work, { at: T });
    expect(r).toMatchObject({ action: 'conflict', reason: 'its own page puts it in NSW, the record in ACT', changes: [] });
    expect(work.companies).toEqual(ds.companies);
  });

  it('does not, when the official sources state different addresses', () => {
    const ds = build({ evidence: [stated('24 Campbell St, Sydney NSW 2000', 'site'), stated('99 George Street, Sydney NSW 2000', 'doc')] });
    const [r] = applyPromotions(structuredClone(ds), { at: T });
    expect(r).toMatchObject({ action: 'conflict', reason: "the company's own pages do not all state the same address" });
  });

  it('does not, when the geocoder cannot find the house, finds it in the wrong place, or has not been asked', () => {
    const street = build({ geocode_cache: cache([QUERY, 'street', found()]) });
    expect(applyPromotions(structuredClone(street), { at: T })[0]).toMatchObject({ action: 'skip', reason: 'the geocoder found only the street, not the house' });
    const wrong = build({ geocode_cache: cache([QUERY, 'house', found({ postcode: '2049', suburb: 'Petersham' })]) });
    expect(applyPromotions(structuredClone(wrong), { at: T })[0]).toMatchObject({ action: 'conflict', reason: "the geocoder's postcode is 2049, not 2000" });
    const far = build({ geocode_cache: cache([QUERY, 'house', { ...found(), lat: -37.81, lng: 144.96 }]) });
    expect(applyPromotions(structuredClone(far), { at: T })[0].action).toBe('conflict');
    const unasked = build({ geocode_cache: [] });
    expect(applyPromotions(structuredClone(unasked), { at: T })[0]).toMatchObject({ action: 'unasked', changes: [] });
  });

  it('can be limited to one company', () => {
    const ds = build();
    expect(applyPromotions(structuredClone(ds), { at: T, company: 'nobody' })).toEqual([]);
    expect(applyPromotions(structuredClone(ds), { at: T, company: 'harrison' })).toHaveLength(1);
  });
});

describe('taking a city centre off a company that is not at it', () => {
  it('clears the coordinates of a city-level company, and of a state-level one, and nobody else\'s', () => {
    const ds = dataset([
      co('Citywide', { lat: -33.86984, lng: 151.20828 }), co('Statewide', { city: 'Unknown', state: 'VIC', lat: -37.4713, lng: 144.7852 }),
      co('Exact', { address: KIPPAX, ...KIPPAX_POINT }), co('Suburban', { address: 'Surry Hills, Sydney NSW 2010', lat: -33.8848, lng: 151.2098 }),
    ]);
    const by = Object.fromEntries(ds.companies.map((c) => [c.name, c.location_precision]));
    expect(by).toEqual({ Citywide: 'CITY', Statewide: 'STATE', Exact: 'EXACT', Suburban: 'SUBURB' });
    const work = structuredClone(ds);
    const results = clearAreaCoordinates(work, { at: T });
    expect(results.map((r) => r.name).sort()).toEqual(['Citywide', 'Statewide']);
    expect(results[0]).toMatchObject({ action: 'cleared', changes: [{ field: 'lat', to: null }, { field: 'lng', to: null }] });
    for (const c of work.companies) {
      if (c.location_precision === 'CITY' || c.location_precision === 'STATE') expect(c).toMatchObject({ lat: null, lng: null, updated_at: T });
      else expect(c.lat).not.toBeNull();
    }
    expect(validateDataset(migrateDataset(work))).toEqual([]);
    expect(clearAreaCoordinates(work, { at: T })).toEqual([]); // nothing left to clear
  });
});
