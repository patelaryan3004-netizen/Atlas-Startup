import { describe, it, expect } from 'vitest';
import { resolveConflict, applySuggestion, dismissSuggestion, suggestionsOf, reasonOf } from '../src/admin/decisions.js';
import { migrateDataset, validateDataset } from '../src/models/dataset.js';
import { detectConflicts } from '../src/models/evidence.js';
import { BadRequestError, NotFoundError } from '../src/admin/errors.js';
import { dataset, co } from './helpers/discovery.js';

const AT = '2026-10-06T01:00:00.000Z';
const BY = 'Reviewer';
const T = '2026-10-05T04:00:00.000Z';

const source = (id, over = {}) => ({ id, kind: 'company_website', url: `https://${id}.example/`, title: id, publisher: null, retrieved_at: T, note: '', ...over });
let n = 0;
const ev = (company_id, field, value, source_id, over = {}) => ({ id: `${company_id}.${field}.${source_id}.${n += 1}`, company_id, field, value, source_id, confidence: 'medium', verified_at: T, status: 'active', note: null, ...over });

const world = (companies, evidence) => structuredClone(migrateDataset({
  ...dataset(companies),
  sources: ['site', 'press', 'yc'].map((id) => source(id)),
  evidence,
}));
const valid = (work) => validateDataset(migrateDataset(work));
const resolve = (work, input) => resolveConflict(work, { reason: 'Checked the company page.', ...input }, { by: BY, at: AT });
const statusOf = (work, id) => work.evidence.find((e) => e.id === id).status;

describe('settling a conflict between sources', () => {
  it('turns down the claims that lose, keeping them with the reason, and puts the winner on the record', () => {
    const work = world([co('Acme', { foundedYear: undefined })], [ev('acme', 'founded_year', 2019, 'site'), ev('acme', 'founded_year', 2021, 'press')]);
    expect(detectConflicts(migrateDataset(work))).toHaveLength(1);
    const r = resolve(work, { company_id: 'acme', field: 'founded_year', winner: { value: 2019 } });
    expect(work.companies[0].foundedYear).toBe(2019);
    expect(r.changes).toEqual([{ field: 'foundedYear', from: null, to: 2019 }]);
    const lost = work.evidence.find((e) => e.value === 2021);
    expect(lost).toMatchObject({ status: 'rejected', note: 'Turned down by Reviewer on 2026-10-06: Checked the company page.' });
    expect(work.evidence.find((e) => e.value === 2019).status).toBe('active');
    expect(detectConflicts(migrateDataset(work))).toEqual([]);
    expect(valid(work)).toEqual([]);
  });

  it('can say the record is right: the claim that disagrees with it is turned down and the record is not touched', () => {
    const work = world([co('Acme', { stage: 'Seed' })], [ev('acme', 'stage', 'Series A', 'press')]);
    const r = resolve(work, { company_id: 'acme', field: 'stage', winner: 'stored' });
    expect(work.companies[0].stage).toBe('Seed');
    expect(r.changes).toEqual([]);
    expect(statusOf(work, work.evidence[0].id)).toBe('rejected');
    expect(detectConflicts(migrateDataset(work))).toEqual([]);
  });

  it('can say the evidence is right: the record changes, and what it said is in the changes for the audit trail', () => {
    const work = world([co('Acme', { stage: 'Seed' })], [ev('acme', 'stage', 'Series A', 'press')]);
    const r = resolve(work, { company_id: 'acme', field: 'stage', winner: { value: 'Series A' } });
    expect(work.companies[0].stage).toBe('Series A');
    expect(r.changes).toEqual([{ field: 'stage', from: 'Seed', to: 'Series A' }]);
    expect(work.evidence[0].status).toBe('active');
    expect(valid(work)).toEqual([]);
  });

  it('refuses without a reason, for a winner that no source claims, for a field with no conflict, and for a field that holds a list', () => {
    const work = world([co('Acme', { stage: 'Seed' })], [ev('acme', 'stage', 'Series A', 'press')]);
    const bad = (input, message) => expect(() => resolveConflict(work, input, { by: BY, at: AT })).toThrow(message);
    bad({ company_id: 'acme', field: 'stage', winner: 'stored', reason: '' }, 'say why');
    bad({ company_id: 'acme', field: 'stage', winner: { value: 'Series Z' }, reason: 'Because.' }, 'the winner must be one of the claims');
    bad({ company_id: 'acme', field: 'sector', winner: 'stored', reason: 'Because.' }, 'there is no open conflict');
    bad({ company_id: 'acme', field: 'investors', winner: 'stored', reason: 'Because.' }, 'can hold several values');
    bad({ company_id: 'acme', field: 'banana', winner: 'stored', reason: 'Because.' }, 'unknown field');
    bad({ company_id: 'nobody', field: 'stage', winner: 'stored', reason: 'Because.' }, 'no company');
    expect(work.companies[0].stage).toBe('Seed');
    expect(work.evidence[0].status).toBe('active'); // a refusal changes nothing
  });

  it('cannot keep a record value that is not there', () => {
    const work = world([co('Acme', { foundedYear: undefined })], [ev('acme', 'founded_year', 2019, 'site'), ev('acme', 'founded_year', 2021, 'press')]);
    expect(() => resolve(work, { company_id: 'acme', field: 'founded_year', winner: 'stored' })).toThrow('the record has no value to keep');
  });
});

describe('settling a conflict about where a company is', () => {
  // Quantum Brilliance, as found: on file in Canberra, its own site says Sydney.
  const quantum = () => world(
    [co('Quantum Brilliance', { city: 'Canberra', lat: -35.28, lng: 149.13, state: undefined })],
    [ev('quantum-brilliance', 'city', 'Sydney', 'site'), ev('quantum-brilliance', 'state', 'NSW', 'site')],
  );

  it('will not leave a company on the map in a place the record contradicts: it needs a confirmed location or to be taken off', () => {
    const work = quantum();
    expect(() => resolve(work, { company_id: 'quantum-brilliance', field: 'city', winner: { value: 'Sydney' } })).toThrow(/confirm a location \(with coordinates\) or take the company off the map/);
    expect(work.companies[0].city).toBe('Canberra');
  });

  it('moves it to the confirmed place, and the conflict about its state is settled by the same decision', () => {
    const work = quantum();
    resolve(work, { company_id: 'quantum-brilliance', field: 'city', winner: { value: 'Sydney' }, record: { type: 'confirm', location: { city: 'Sydney', lat: -33.87, lng: 151.2, address: '1/477 Pitt Street, Sydney NSW 2000' } } });
    expect(work.companies[0]).toMatchObject({ city: 'Sydney', state: 'NSW', verified: true, lat: -33.87, address: '1/477 Pitt Street, Sydney NSW 2000' });
    expect(detectConflicts(migrateDataset(work))).toEqual([]);
    expect(valid(work)).toEqual([]);
  });

  it('refuses a point that is not an address or a suburb, or is outside Australia', () => {
    for (const location of [{ city: 'Sydney', lat: -33.87, lng: 151.2 }, { city: 'Sydney', lat: 37.77, lng: -122.4, state: 'NSW' }]) {
      const work = quantum();
      expect(() => resolve(work, { company_id: 'quantum-brilliance', field: 'city', winner: { value: 'Sydney' }, record: { type: 'confirm', location } })).toThrow(/need an address|not in Australia/);
      expect(work.companies[0].city).toBe('Canberra');
    }
  });

  it('accepts the city alone: the company is then located to its city, with no pin, and says so', () => {
    const work = quantum();
    resolve(work, { company_id: 'quantum-brilliance', field: 'city', winner: { value: 'Sydney' }, record: { type: 'confirm', location: { city: 'Sydney', state: 'NSW' } } });
    expect(work.companies[0]).toMatchObject({ city: 'Sydney', state: 'NSW', verified: true, lat: null, lng: null, location_precision: 'CITY', location_source: 'manual' });
    expect(work.companies[0].location_verified_at).toBe(AT);
    expect(detectConflicts(migrateDataset(work))).toEqual([]);
    expect(valid(work)).toEqual([]);
  });

  it('takes a company off the map when its headquarters is not in Australia, keeping the true claim and turning down the one that was wrong (Forward)', () => {
    const work = world(
      [co('Forward', { city: 'Sydney', lat: -33.87, lng: 151.2 })],
      [ev('forward', 'city', 'Sydney', 'site'), ev('forward', 'city', 'San Francisco', 'yc', { confidence: 'high' })],
    );
    resolve(work, { company_id: 'forward', field: 'city', winner: { value: 'San Francisco' }, record: { type: 'unconfirm' }, reason: 'YC says San Francisco; Sydney is an office.' });
    expect(work.companies[0]).toMatchObject({ city: 'Unknown', lat: null, lng: null, verified: false, verification_status: 'unverified', state: null, country: null });
    expect(work.evidence.find((e) => e.value === 'San Francisco').status).toBe('active'); // true, and kept visible to later checks
    expect(work.evidence.find((e) => e.value === 'Sydney')).toMatchObject({ status: 'rejected' });
    expect(valid(work)).toEqual([]);
  });

  it('only accepts keep, confirm or unconfirm', () => {
    const work = quantum();
    expect(() => resolve(work, { company_id: 'quantum-brilliance', field: 'city', winner: 'stored', record: { type: 'teleport' } })).toThrow('record must be keep, confirm or unconfirm');
  });
});

describe('applying and turning down a suggestion', () => {
  const suggested = () => world(
    [co('Acme', { blurb: '', founders: undefined, investors: ['Blackbird'], foundedYear: undefined, hiring: false, verified: false, city: 'Unknown', lat: null, lng: null })],
    [
      ev('acme', 'description', 'Acme builds robots for warehouses.', 'site'), ev('acme', 'founded_year', 2019, 'site'), ev('acme', 'founders', 'Jane Doe', 'site'),
      ev('acme', 'investors', 'Startmate', 'site'), ev('acme', 'hiring_status', 'hiring', 'site', { confidence: 'high' }), ev('acme', 'address', '1 George Street, Sydney NSW 2000', 'site'),
    ],
  );
  const apply = (work, input) => applySuggestion(work, { company_id: 'acme', ...input }, { by: BY, at: AT });

  it('lists what the evidence says that the record does not, including a description for a blank one', () => {
    const fields = suggestionsOf(migrateDataset(suggested())).map((s) => s.field).sort();
    expect(fields).toEqual(['address', 'description', 'founded_year', 'founders', 'investors']);
    expect(suggestionsOf(migrateDataset(suggested())).find((s) => s.field === 'address')).toMatchObject({ location: true, pinned: false });
    expect(suggestionsOf(migrateDataset(suggested())).find((s) => s.field === 'description')).toMatchObject({ value: 'Acme builds robots for warehouses.', confidence: 'medium' });
  });

  it('does not suggest a description for a company that has one, and takes the strongest when there are several', () => {
    const work = suggested();
    work.evidence.push(ev('acme', 'description', 'A short high-confidence line.', 'yc', { confidence: 'high' }));
    expect(suggestionsOf(migrateDataset(work)).find((s) => s.field === 'description').value).toBe('A short high-confidence line.');
    work.companies[0].blurb = 'Written by hand.';
    expect(suggestionsOf(migrateDataset(work)).some((s) => s.field === 'description')).toBe(false);
  });

  it('shows a company that is hiring on its job board but is not flagged as one as a conflict, not a suggestion', () => {
    const work = suggested();
    expect(suggestionsOf(migrateDataset(work)).some((s) => s.field === 'hiring_status')).toBe(false);
    expect(detectConflicts(migrateDataset(work)).map((c) => `${c.field}:${c.kind}`)).toContain('hiring_status:stored_differs');
    resolve(work, { company_id: 'acme', field: 'hiring_status', winner: { value: 'hiring' } });
    expect(work.companies[0]).toMatchObject({ hiring: true, hiring_status: 'hiring' });
    expect(valid(work)).toEqual([]);
  });

  it('puts a value on the record, and says what changed', () => {
    const work = suggested();
    expect(apply(work, { field: 'founded_year', value: 2019 }).changes).toEqual([{ field: 'foundedYear', from: null, to: 2019 }]);
    expect(apply(work, { field: 'description', value: 'Acme builds robots for warehouses.' }).changes[0]).toMatchObject({ field: 'blurb', to: 'Acme builds robots for warehouses.' });
    expect(apply(work, { field: 'founders', value: 'Jane Doe' }).changes).toEqual([{ field: 'founders', from: [], to: ['Jane Doe'] }]);
    expect(apply(work, { field: 'investors', value: 'Startmate' }).changes[0].to).toEqual(['Blackbird', 'Startmate']);
    expect(apply(work, { field: 'hiring_status', value: 'hiring' }).changes).toEqual([{ field: 'hiring', from: false, to: true }, { field: 'hiring_status', from: null, to: 'hiring' }]);
    expect(work.companies[0].updated_at).toBe(AT);
    expect(valid(work)).toEqual([]);
  });

  it('refuses a value no active evidence claims, a list member already there, and a field the record already has', () => {
    const work = suggested();
    expect(() => apply(work, { field: 'founded_year', value: 1999 })).toThrow(NotFoundError);
    apply(work, { field: 'founded_year', value: 2019 });
    expect(() => apply(work, { field: 'founded_year', value: 2019 })).toThrow(/already has a founded_year: if the evidence disagrees, settle it as a conflict/);
    expect(() => apply(work, { field: 'investors', value: 'Blackbird' })).toThrow(NotFoundError); // no evidence for it
    work.evidence.push(ev('acme', 'investors', 'Blackbird', 'press'));
    expect(() => apply(work, { field: 'investors', value: 'Blackbird' })).toThrow(/already on the record/);
  });

  it('will not put a location on the map from a suggestion without coordinates: it can record the address text, or confirm a place', () => {
    const work = suggested();
    expect(() => apply(work, { field: 'address', value: '1 George Street, Sydney NSW 2000' })).toThrow(/needs coordinates/);
    apply(work, { field: 'address', value: '1 George Street, Sydney NSW 2000', record: { type: 'address_only' } });
    expect(work.companies[0]).toMatchObject({ address: '1 George Street, Sydney NSW 2000', verified: false, lat: null });
    apply(work, { field: 'address', value: '1 George Street, Sydney NSW 2000', record: { type: 'confirm', location: { city: 'Sydney', lat: -33.86, lng: 151.2, address: '1 George Street, Sydney NSW 2000' } } });
    expect(work.companies[0]).toMatchObject({ verified: true, city: 'Sydney', state: 'NSW', lat: -33.86 });
    expect(valid(work)).toEqual([]);
  });

  it('records the page an address came from, and when it was read, as where the location came from', () => {
    const work = suggested();
    apply(work, { field: 'address', value: '1 George Street, Sydney NSW 2000', record: { type: 'confirm', location: { city: 'Sydney', lat: -33.86, lng: 151.2, address: '1 George Street, Sydney NSW 2000' } } });
    // The evidence is a company page (source "site"), read at T: medium, because the point has not been checked against a geocoder.
    expect(work.companies[0]).toMatchObject({ location_precision: 'EXACT', location_source: 'company_website', location_source_url: 'https://site.example/', location_verified_at: T, location_confidence: 'medium' });
    expect(valid(work)).toEqual([]);
  });

  it('turns a suggestion down with a reason, keeps it on file, and it stops being suggested', () => {
    const work = suggested();
    const r = dismissSuggestion(work, { company_id: 'acme', field: 'founders', value: 'Jane Doe', reason: 'That is the advisor.' }, { by: BY, at: AT });
    expect(r.evidence_ids).toHaveLength(1);
    expect(work.evidence.find((e) => e.value === 'Jane Doe')).toMatchObject({ status: 'rejected', note: 'Dismissed by Reviewer on 2026-10-06: That is the advisor.' });
    expect(suggestionsOf(migrateDataset(work)).map((s) => s.field)).not.toContain('founders');
    expect(() => dismissSuggestion(work, { company_id: 'acme', field: 'founders', value: 'Jane Doe', reason: 'x' }, { by: BY, at: AT })).toThrow(BadRequestError);
    expect(() => dismissSuggestion(work, { company_id: 'acme', field: 'founders', value: 'Nobody', reason: 'Not there.' }, { by: BY, at: AT })).toThrow(NotFoundError);
    expect(valid(work)).toEqual([]);
  });

  it('wants a reason that is a few words, and not an essay', () => {
    expect(reasonOf('  Looks   right  ')).toBe('Looks right');
    expect(() => reasonOf('ok')).toThrow('say why');
    expect(() => reasonOf(undefined)).toThrow('say why');
    expect(() => reasonOf('x'.repeat(501))).toThrow('longer than 500');
  });
});
