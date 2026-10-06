import { describe, it, expect } from 'vitest';
import {
  PRECISIONS, POINT_PRECISIONS, LOCATION_SOURCES, parseAddress, streetLine, suburbIsCity, deriveBlock, locationProblems, companyLocationProblems,
  hqRowFor, validateLocationRows, describeLocation, locationSourceProblem, confidenceFor, locationSourceFor, locationEvidenceIndex,
} from '../src/models/location.js';
import { migrateDataset, validateDataset } from '../src/models/dataset.js';
import { toPublic } from '../src/models/company.js';

const T = '2026-10-05T04:00:00.000Z';
const co = (name, over = {}) => ({
  name, sector: 'AI', sectorFull: 'AI', city: 'Sydney', lat: -33.8848, lng: 151.2098, investors: [], stage: 'Seed', hiring: false, verified: true,
  website: 'https://acme.example', blurb: 'A company.', taskGate: { enabled: false }, address: '110 Kippax Street, Surry Hills, Sydney NSW 2010', ...over,
});
const source = (id, kind = 'company_website', url = `https://${id}.example/contact`) => ({ id, kind, url, title: id, publisher: null, retrieved_at: T, note: '' });
const evidence = (company_id, field, value, source_id, over = {}) => ({ id: `${company_id}.${field}.${source_id}`, company_id, field, value, source_id, confidence: 'medium', verified_at: T, status: 'active', note: null, ...over });
const migrate = (companies, { sources = [], evidence: ev = [], company_locations = [] } = {}) => migrateDataset({ companies, people: [], investors: [], sources, evidence: ev, funding_rounds: [], jobs: [], news: [], company_locations });

describe('reading an address', () => {
  it('finds the street, suburb, city, state and postcode of an ordinary address', () => {
    expect(parseAddress('110 Kippax Street, Surry Hills, Sydney NSW 2010')).toMatchObject({
      streetLevel: true, street: '110 Kippax Street', suburb: 'Surry Hills', locality: 'Sydney', localityIsCity: true, state: 'NSW', postcode: '2010',
    });
  });

  it('leaves the level, suite, unit and building out of the street', () => {
    expect(parseAddress('Level 7, 15 William Street, Melbourne VIC 3000')).toMatchObject({ street: '15 William Street', suburb: 'Melbourne', state: 'VIC', postcode: '3000' });
    expect(parseAddress('Level 2/29 Stewart St, Richmond VIC 3121')).toMatchObject({ street: '29 Stewart St', suburb: 'Richmond' });
    expect(parseAddress('Suite 1007, 120 High Street, North Sydney NSW 2060')).toMatchObject({ street: '120 High Street', suburb: 'North Sydney' });
    expect(parseAddress('The Foundry, 1 Locomotive St, Eveleigh NSW 2015')).toMatchObject({ street: '1 Locomotive St', suburb: 'Eveleigh' });
    expect(streetLine('Mezzanine, Levels 1–3, 388 George Street, Sydney NSW 2000')).toBe('388 George Street');
  });

  it('treats a parenthetical as a note, not part of the address', () => {
    const p = parseAddress('300 Elizabeth Street, Surry Hills, Sydney NSW 2010 (Sydney office; global HQ in Singapore)');
    expect(p).toMatchObject({ street: '300 Elizabeth Street', suburb: 'Surry Hills', postcode: '2010' });
  });

  it('says so when there is no street: a suburb, a campus, a named building', () => {
    expect(parseAddress('Surry Hills, Sydney NSW 2010')).toMatchObject({ streetLevel: false, street: null, suburb: 'Surry Hills', state: 'NSW' });
    // The campus is a building, not the suburb: the suburb is the last place name when that is not a city.
    expect(parseAddress('UNSW Innovation Hub, Kensington NSW 2052')).toMatchObject({ streetLevel: false, suburb: 'Kensington' });
    expect(parseAddress('Wade Institute, University of Melbourne, Parkville VIC 3010')).toMatchObject({ suburb: 'Parkville' });
    // A building before a city is not a suburb either: all that is known is the city.
    const p = parseAddress('Macquarie University Cyber Hub, Sydney NSW 2109');
    expect(p).toMatchObject({ streetLevel: false, suburb: 'Sydney', localityIsCity: true });
    expect(suburbIsCity(p)).toBe(true);
    expect(suburbIsCity(parseAddress('Surry Hills, Sydney NSW 2010'))).toBe(false);
  });

  it('reads a state written out in full at the end, and leaves a street named after a state alone', () => {
    expect(parseAddress('Unit 2, 33 Stewart Street, Richmond, Victoria 3121')).toMatchObject({ state: 'VIC', postcode: '3121', suburb: 'Richmond', street: '33 Stewart Street' });
    expect(parseAddress('33 Victoria Street, Richmond VIC 3121')).toMatchObject({ street: '33 Victoria Street', state: 'VIC', suburb: 'Richmond' });
    expect(parseAddress('1 George Street, Sydney NSW 2000, Australia')).toMatchObject({ state: 'NSW', postcode: '2000' });
  });

  it('copes with nothing, and with an address that is only a place', () => {
    expect(parseAddress(undefined)).toMatchObject({ text: '', streetLevel: false, suburb: null, state: null });
    expect(parseAddress('')).toMatchObject({ streetLevel: false });
    expect(parseAddress('Yatala QLD 4207')).toMatchObject({ streetLevel: false, suburb: 'Yatala', state: 'QLD', postcode: '4207' });
  });
});

describe('what a record without a location block is worked out to be', () => {
  it('is UNKNOWN, with nothing to back it, when the Australian location was never confirmed', () => {
    expect(deriveBlock(co('Acme', { verified: false, city: 'Unknown', lat: null, lng: null }))).toEqual({
      suburb: null, postcode: null, location_precision: 'UNKNOWN', location_source: null, location_source_url: null, location_verified_at: null, location_confidence: null,
    });
  });

  it('is EXACT for a street address with a point, and says it is an untraced directory record when nothing backs it', () => {
    expect(deriveBlock(co('Acme'))).toEqual({
      suburb: 'Surry Hills', postcode: '2010', location_precision: 'EXACT', location_source: 'directory_record', location_source_url: null, location_verified_at: null, location_confidence: 'low',
    });
  });

  it('records the company\'s own page, and when it was read, when that page states the same address', () => {
    const rows = locationEvidenceIndex({ evidence: [evidence('acme', 'address', 'Level 3, 110 Kippax St, Surry Hills NSW 2010', 'site')], sources: [source('site')] });
    expect(deriveBlock(co('Acme'), { evidence: rows.get('acme') })).toMatchObject({
      location_precision: 'EXACT', location_source: 'company_website', location_source_url: 'https://site.example/contact', location_verified_at: T, location_confidence: 'medium',
    });
  });

  it('prefers the best source, and is not backed by a page that states a different address', () => {
    const rows = locationEvidenceIndex({
      evidence: [evidence('acme', 'address', '110 Kippax Street, Surry Hills, Sydney NSW 2010', 'press'), evidence('acme', 'address', '110 Kippax Street, Surry Hills NSW 2010', 'site'), evidence('acme', 'address', '5 Other Road, Perth WA 6000', 'doc')],
      sources: [source('press', 'press', 'https://news.example/acme'), source('site'), source('doc', 'company_document', 'https://doc.example/terms.pdf')],
    });
    expect(deriveBlock(co('Acme'), { evidence: rows.get('acme') })).toMatchObject({ location_source: 'company_website', location_source_url: 'https://site.example/contact' });
    const only = locationEvidenceIndex({ evidence: [evidence('acme', 'address', '5 Other Road, Perth WA 6000', 'doc')], sources: [source('doc', 'company_document')] });
    expect(deriveBlock(co('Acme'), { evidence: only.get('acme') })).toMatchObject({ location_source: 'directory_record', location_verified_at: null });
  });

  it('ignores evidence that is not active, or whose source is not on file', () => {
    const rows = locationEvidenceIndex({ evidence: [evidence('acme', 'address', '110 Kippax Street, Surry Hills NSW 2010', 'site', { status: 'rejected' }), evidence('acme', 'address', '110 Kippax Street, Surry Hills NSW 2010', 'ghost')], sources: [source('site')] });
    expect(rows.get('acme')).toBeUndefined();
  });

  it('is SUBURB for a suburb and a point, and CITY when the "suburb" is only the city', () => {
    expect(deriveBlock(co('Acme', { address: 'Surry Hills, Sydney NSW 2010' }))).toMatchObject({ location_precision: 'SUBURB', suburb: 'Surry Hills', postcode: '2010' });
    expect(deriveBlock(co('Acme', { address: 'Macquarie University Cyber Hub, Sydney NSW 2109' }))).toMatchObject({ location_precision: 'CITY', suburb: null, postcode: null });
  });

  it('is CITY for a city and no address, whatever coordinates it carries: a city centre is not the company', () => {
    expect(deriveBlock(co('Acme', { address: undefined, lat: -33.86984, lng: 151.20828 }))).toMatchObject({ location_precision: 'CITY', suburb: null, postcode: null, location_source: 'directory_record' });
    expect(deriveBlock(co('Acme', { address: undefined, lat: null, lng: null }))).toMatchObject({ location_precision: 'CITY' });
  });

  it('is CITY, not EXACT, for a street address that has no point yet', () => {
    expect(deriveBlock(co('Acme', { lat: null, lng: null }))).toMatchObject({ location_precision: 'CITY' });
  });

  it('is STATE when the city is unknown but the state is not, and UNKNOWN when neither is', () => {
    expect(deriveBlock(co('Acme', { city: 'Unknown', address: undefined, lat: null, lng: null, state: 'VIC' }))).toMatchObject({ location_precision: 'STATE' });
    expect(deriveBlock(co('Acme', { city: 'Unknown', address: undefined, lat: null, lng: null }))).toMatchObject({ location_precision: 'UNKNOWN' });
  });

  it('uses the evidence for the city when there is no address', () => {
    const rows = locationEvidenceIndex({ evidence: [evidence('acme', 'city', 'Sydney', 'site')], sources: [source('site')] });
    expect(deriveBlock(co('Acme', { address: undefined, lat: null, lng: null }), { evidence: rows.get('acme') })).toMatchObject({ location_precision: 'CITY', location_source: 'company_website', location_verified_at: T });
  });
});

describe('the rules every location obeys', () => {
  const block = (over = {}) => ({ precision: 'EXACT', verified: true, address: '1 George Street, Sydney NSW 2000', suburb: 'Sydney', city: 'Sydney', state: 'NSW', country: 'Australia', postcode: '2000', lat: -33.86, lng: 151.2, source: 'company_website', url: 'https://acme.example/contact', verifiedAt: T, confidence: 'high', ...over });

  it('accepts a sound location at each precision', () => {
    expect(locationProblems(block())).toEqual([]);
    expect(locationProblems(block({ precision: 'SUBURB', address: null, suburb: 'Surry Hills' }))).toEqual([]);
    expect(locationProblems(block({ precision: 'CITY', lat: null, lng: null }))).toEqual([]);
    expect(locationProblems(block({ precision: 'STATE', city: null, lat: null, lng: null }))).toEqual([]);
    expect(locationProblems(block({ precision: 'UNKNOWN', verified: false, lat: null, lng: null, source: null, url: null, verifiedAt: null, confidence: null, city: 'Unknown', state: null }))).toEqual([]);
  });

  it('refuses a precision that is not one of the five, and verified and precision that disagree', () => {
    expect(locationProblems(block({ precision: 'ROUGH' }))[0]).toMatch(/must be one of EXACT, SUBURB, CITY, STATE, UNKNOWN/);
    expect(locationProblems(block({ verified: false }))).toEqual([expect.stringMatching(/verified and location_precision disagree/)]);
    expect(locationProblems(block({ precision: 'UNKNOWN', verified: true, lat: null, lng: null, source: null, url: null, verifiedAt: null, confidence: null }))).toEqual([expect.stringMatching(/disagree/)]);
  });

  it('wants a point for EXACT and SUBURB, no point for UNKNOWN, and the thing each precision names', () => {
    expect(locationProblems(block({ lat: null, lng: null }))).toEqual(['a EXACT location needs coordinates']);
    expect(locationProblems(block({ precision: 'SUBURB', suburb: null, address: null }))).toEqual(['a SUBURB location needs the suburb']);
    expect(locationProblems(block({ address: '' }))).toEqual(['an EXACT location needs the address it is']);
    expect(locationProblems(block({ precision: 'CITY', city: 'Unknown', lat: null, lng: null }))).toEqual(['a CITY location needs the city']);
    expect(locationProblems(block({ precision: 'STATE', state: null, lat: null, lng: null }))).toEqual(['a STATE location needs the state']);
    expect(locationProblems(block({ precision: 'UNKNOWN', verified: false, source: null, url: null, verifiedAt: null, confidence: null }))).toEqual([expect.stringMatching(/must not carry coordinates/)]);
    expect(locationProblems(block({ lat: -33.86, lng: null }))).toContain('lat and lng must both be set or both null');
  });

  it('refuses coordinates that are not in Australia, and a bad postcode', () => {
    expect(locationProblems(block({ lat: 51.5, lng: -0.12 }))).toEqual(['the coordinates are not in Australia']);
    expect(locationProblems(block({ postcode: '20' }))).toEqual(['postcode must be four digits']);
  });

  it('allows a city-level record that still carries coordinates (the audit flags it) but not an UNKNOWN one with a source', () => {
    expect(locationProblems(block({ precision: 'CITY', lat: -33.87, lng: 151.2 }))).toEqual([]);
    expect(locationProblems(block({ precision: 'UNKNOWN', verified: false, lat: null, lng: null, city: 'Unknown', state: null })).join(' ')).toMatch(/UNKNOWN location has no source/);
  });

  it('checks where it came from: a known kind, an http(s) link that is not a person\'s profile, a time that is a time', () => {
    expect(locationProblems(block({ source: 'a_guess' }))).toEqual(expect.arrayContaining([expect.stringMatching(/location_source must be one of/)]));
    expect(locationProblems(block({ url: 'https://www.linkedin.com/company/acme' }))).toEqual([expect.stringMatching(/says where a person is/)]);
    expect(locationProblems(block({ url: 'ftp://x.test/a' }))).toEqual([expect.stringMatching(/http\(s\) link/)]);
    expect(locationProblems(block({ verifiedAt: 'yesterday' }))).toEqual([expect.stringMatching(/ISO-8601/)]);
    expect(locationProblems(block({ source: null, url: null }))).toEqual([expect.stringMatching(/must say where it came from/)]);
    expect(locationProblems(block({ confidence: 'certain' }))).toEqual([expect.stringMatching(/location_confidence must be one of/)]);
  });

  it('never accepts a person\'s profile, a founder\'s home or a guess as the source of a location', () => {
    for (const host of ['linkedin.com', 'www.linkedin.com', 'au.linkedin.com', 'facebook.com', 'x.com', 'instagram.com']) {
      expect(locationSourceProblem('company_website', `https://${host}/someone`), host).toMatch(/says where a person is/);
    }
    expect(locationSourceProblem('company_website', 'https://airwallex.com/contact')).toBeNull(); // ends in "x.com", is not x.com
    expect(locationSourceProblem('founders_home', null)).toMatch(/not a kind of location source/);
    expect(LOCATION_SOURCES).not.toEqual(expect.arrayContaining(['linkedin', 'residence', 'search_snippet', 'postcode_guess']));
  });

  it('knows which precisions are points', () => {
    expect(PRECISIONS).toEqual(['EXACT', 'SUBURB', 'CITY', 'STATE', 'UNKNOWN']);
    expect(POINT_PRECISIONS).toEqual(['EXACT', 'SUBURB']);
  });

  it('is more confident of a source that was read, an official one, and one a geocoder agrees with: high needs all three', () => {
    expect(confidenceFor({ source: null })).toBeNull();
    expect(confidenceFor({ source: 'directory_record' })).toBe('low');
    expect(confidenceFor({ source: 'directory_record', geocodeAgrees: true })).toBe('low');
    expect(confidenceFor({ source: 'company_website', verified: true })).toBe('medium');
    expect(confidenceFor({ source: 'manual', verified: true })).toBe('medium');
    expect(confidenceFor({ source: 'ecosystem_source', verified: true })).toBe('medium');
    expect(confidenceFor({ source: 'company_website', verified: true, geocodeAgrees: true })).toBe('high');
    expect(confidenceFor({ source: 'company_document', verified: true, geocodeAgrees: true })).toBe('high');
    expect(confidenceFor({ source: 'credible_profile', verified: false })).toBe('medium');
  });

  it('maps what an evidence source is onto where a location came from', () => {
    expect(locationSourceFor('company_website')).toBe('company_website');
    expect(locationSourceFor('accelerator_profile')).toBe('credible_profile');
    expect(locationSourceFor('press')).toBe('credible_profile');
    expect(locationSourceFor('investor_post')).toBe('ecosystem_source');
    expect(locationSourceFor('user_supplied')).toBe('manual');
    expect(locationSourceFor('something_new')).toBe('ecosystem_source');
  });
});

describe('the company_locations relationship', () => {
  it('has a headquarters row for every company, derived from the company, and nothing else', () => {
    const ds = migrate([co('Acme'), co('Beta', { verified: false, city: 'Unknown', lat: null, lng: null, address: undefined })]);
    expect(ds.company_locations.map((r) => [r.id, r.kind, r.location_precision])).toEqual([['acme.hq', 'HEADQUARTERS', 'EXACT'], ['beta.hq', 'HEADQUARTERS', 'UNKNOWN']]);
    expect(ds.company_locations[0]).toMatchObject({ company_id: 'acme', address: '110 Kippax Street, Surry Hills, Sydney NSW 2010', suburb: 'Surry Hills', city: 'Sydney', state: 'NSW', country: 'Australia', postcode: '2010', latitude: -33.8848, longitude: 151.2098 });
    expect(ds.company_locations[1]).toMatchObject({ city: null, state: null, latitude: null, address: null });
    expect(validateDataset(ds)).toEqual([]);
  });

  it('is derived again every time, so the company and its headquarters row cannot drift apart, and migrating twice changes nothing', () => {
    const once = migrate([co('Acme')]);
    once.companies[0].suburb = 'Redfern'; // the company is edited and its headquarters row is stale
    expect(validateDataset(once)).toEqual([expect.stringMatching(/"suburb" differs from the company's own/)]);
    const again = migrateDataset(once);
    expect(again.company_locations[0].suburb).toBe('Redfern');
    expect(validateDataset(again)).toEqual([]);
    expect(migrateDataset(again)).toEqual(again);
  });

  it('keeps the rows for other offices as they are, and drops a headquarters row nobody derived', () => {
    const office = { id: 'acme.office-melbourne', company_id: 'acme', kind: 'OFFICE', label: 'Melbourne office', address: '5 Collins Street, Melbourne VIC 3000', suburb: 'Melbourne', city: 'Melbourne', state: 'VIC', country: 'Australia', postcode: '3000', latitude: -37.8136, longitude: 144.9631, location_precision: 'EXACT', location_source: 'company_website', location_source_url: 'https://acme.example/contact', location_verified_at: T, location_confidence: 'medium', created_at: T, updated_at: T };
    const stale = { ...office, id: 'acme.hq-old', kind: 'HEADQUARTERS' };
    const ds = migrate([co('Acme')], { company_locations: [office, stale] });
    expect(ds.company_locations.map((r) => r.id)).toEqual(['acme.hq', 'acme.office-melbourne']);
    expect(validateDataset(ds)).toEqual([]);
    expect(ds.company_locations[1].kind).toBe('OFFICE');
  });

  it('checks the rows: a known company and kind, one headquarters, an office that is located, the same rules as a company', () => {
    const base = migrate([co('Acme')]);
    const row = (over) => ({ ...base.company_locations[0], id: 'acme.office-x', kind: 'OFFICE', ...over });
    const check = (rows) => validateLocationRows({ companies: base.companies, company_locations: rows });
    expect(check([base.company_locations[0], row({})])).toEqual([]);
    expect(check([row({ company_id: 'nobody' })])).toEqual([expect.stringMatching(/unknown company_id "nobody"/)]);
    expect(check([row({ kind: 'BRANCH' })])).toEqual([expect.stringMatching(/kind must be one of HEADQUARTERS, OFFICE, OTHER/)]);
    expect(check([base.company_locations[0], base.company_locations[0]]).join(' ')).toMatch(/duplicate id/);
    expect(check([row({ latitude: null, longitude: null })])).toEqual([expect.stringMatching(/needs coordinates/)]);
    expect(check([row({ location_precision: 'UNKNOWN', latitude: null, longitude: null, location_source: null, location_source_url: null, location_verified_at: null, location_confidence: null })])).toEqual([expect.stringMatching(/not located is not a row/)]);
    expect(check([{ ...base.company_locations[0], id: 'acme.hq-2' }])).toEqual([]); // a different id is another row; only one HEADQUARTERS per company
    expect(check([base.company_locations[0], { ...base.company_locations[0], id: 'acme.hq-2' }]).join(' ')).toMatch(/a company has one headquarters/);
    const missing = { ...row({}) };
    delete missing.suburb;
    expect(check([missing])).toEqual([expect.stringMatching(/missing field "suburb"/)]);
  });

  it('is part of a company with its relations', () => {
    const ds = migrate([co('Acme')]);
    expect(hqRowFor(ds.companies[0])).toEqual(ds.company_locations[0]);
  });
});

describe('what the public sees', () => {
  const record = (precision, over = {}) => ({ ...migrate([co('Acme')]).companies[0], location_precision: precision, ...over });

  it('gets coordinates only for a company whose location is a point', () => {
    expect(toPublic(record('EXACT'))).toMatchObject({ lat: -33.8848, lng: 151.2098, location_precision: 'EXACT' });
    expect(toPublic(record('SUBURB'))).toMatchObject({ lat: -33.8848, lng: 151.2098 });
    for (const precision of ['CITY', 'STATE', 'UNKNOWN']) expect(toPublic(record(precision)), precision).toMatchObject({ lat: null, lng: null, location_precision: precision });
  });

  it('is told whether the location was checked against a source, and nothing about the source itself', () => {
    expect(toPublic(record('EXACT'))).toMatchObject({ location_verified: false });
    const out = toPublic(record('EXACT', { location_verified_at: T, location_source: 'company_website', location_source_url: 'https://acme.example/', location_confidence: 'medium' }));
    expect(out.location_verified).toBe(true);
    for (const key of ['location_source', 'location_source_url', 'location_verified_at', 'location_confidence']) expect(out).not.toHaveProperty(key);
  });

  it('leaves a record that predates the location fields as it was', () => {
    const legacy = { name: 'Old', city: 'Sydney', lat: -33.87, lng: 151.2, verified: true };
    expect(toPublic(legacy)).toEqual(legacy);
  });
});

describe('how a location is put to a visitor', () => {
  it('says what is known and how well, in the words the map and the panel use', () => {
    const base = { city: 'Sydney', state: 'NSW', address: null, suburb: null, location_verified_at: null };
    expect(describeLocation({ ...base, location_precision: 'CITY' })).toEqual({ precision: 'CITY', place: 'Sydney, NSW', quality: 'Location: city-level' });
    expect(describeLocation({ ...base, location_precision: 'SUBURB', suburb: 'Surry Hills' })).toEqual({ precision: 'SUBURB', place: 'Surry Hills, Sydney', quality: 'Location: suburb-level' });
    expect(describeLocation({ ...base, city: 'Melbourne', state: 'VIC', suburb: 'Melbourne', address: 'Level 7, 15 William Street, Melbourne VIC 3000', location_precision: 'EXACT', location_verified_at: T }))
      .toEqual({ precision: 'EXACT', place: '15 William Street, Melbourne', quality: 'Verified office' });
    expect(describeLocation({ ...base, suburb: 'Surry Hills', address: '110 Kippax Street, Surry Hills, Sydney NSW 2010', location_precision: 'EXACT' }))
      .toEqual({ precision: 'EXACT', place: '110 Kippax Street, Surry Hills, Sydney', quality: 'Office address on file' });
    expect(describeLocation({ state: 'VIC', city: 'Unknown', location_precision: 'STATE' })).toEqual({ precision: 'STATE', place: 'VIC', quality: 'Location: state-level' });
    expect(describeLocation({ city: 'Unknown', location_precision: 'UNKNOWN' })).toEqual({ precision: 'UNKNOWN', place: null, quality: 'Location unknown' });
    expect(describeLocation({ city: 'Sydney' })).toMatchObject({ precision: 'UNKNOWN' });
  });
});

describe('a company\'s own location block', () => {
  it('reports the rules it breaks, by name', () => {
    const [c] = migrate([co('Acme')]).companies;
    expect(companyLocationProblems(c)).toEqual([]);
    expect(companyLocationProblems({ ...c, location_precision: 'EXACT', lat: null, lng: null })).toEqual(['a EXACT location needs coordinates']);
    expect(companyLocationProblems({ ...c, verified: false })).toEqual([expect.stringMatching(/disagree/)]);
  });
});
