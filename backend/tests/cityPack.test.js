import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSnapshot, select, markers, readFilters } from '../src/catalog/catalog.js';
import { co } from './helpers/locations.js';
import { loadRaw, parseRaw, validateDataset } from '../src/models/dataset.js';
import { sameAddress } from '../src/models/identity.js';

// The city pack (the reference directory's Sydney, Melbourne and Perth lists, and the 62 address records): its rows are research, a type is a candidate, a source
// point is not a place, and a postal or registered address is never a pin.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.join(HERE, '..');
const PACK = path.join(BACKEND, 'scripts', 'citypack');
const staged = (city) => JSON.parse(readFileSync(path.join(PACK, 'staging', `${city}.json`), 'utf8')).rows;
const node = (script, ...args) => execFileSync(process.execPath, [path.join(PACK, script), ...args], { cwd: BACKEND, encoding: 'utf8', maxBuffer: 1e8 });
const rows = (id, name, over = {}) => ({ ...co(name, over), id, slug: id });

describe('the organisation type and the search', () => {
  const snap = buildSnapshot(JSON.stringify([
    rows('a', 'Alpha', { organisation_type: 'startup' }),
    rows('b', 'Beta Works', { organisation_type: 'company', sector: 'Energy' }),
    rows('c', 'Commons', { organisation_type: 'space', sector: 'Community' }),
    rows('d', 'Delta', { organisation_type: null, suburb: 'Fitzroy', city: 'Melbourne' }),
  ]), 'v');
  const names = (q) => [...select(snap, readFilters(q))].map((i) => snap.records[i].name);

  it('is a startup unless a record says it is another type, and filters by orgType (one or several)', () => {
    expect(names({ orgType: 'startup' })).toEqual(['Alpha', 'Delta']);
    expect(names({ orgType: 'company' })).toEqual(['Beta Works']);
    expect(names({ orgType: 'space' })).toEqual(['Commons']);
    expect(names({ orgType: 'company,space' })).toEqual(['Beta Works', 'Commons']);
    expect(names({})).toHaveLength(4);
  });

  it('puts the type on a card', () => {
    expect(snap.cards[1].organisation_type).toBe('company');
  });

  it('finds a company by its sector and by its suburb, as well as by its name', () => {
    expect(names({ search: 'energy' })).toEqual(['Beta Works']);
    expect(names({ search: 'fitzroy' })).toEqual(['Delta']);
    expect(names({ search: 'commons' })).toEqual(['Commons']);
  });

  it('keeps the type of a pin in step with the answer: a type filter narrows the pins as well', () => {
    const pinned = buildSnapshot(JSON.stringify([
      rows('a', 'Alpha', { lat: -37.8, lng: 144.9, location_precision: 'EXACT', organisation_type: 'startup' }),
      rows('b', 'Beta', { lat: -37.81, lng: 144.95, location_precision: 'EXACT', organisation_type: 'company' }),
    ]), 'v');
    expect(markers(pinned, select(pinned, readFilters({ orgType: 'company' }))).map((m) => m[1])).toEqual(['Beta']);
  });
});

describe('the staging of the pack', () => {
  const sydney = staged('sydney');
  const melbourne = staged('melbourne');
  const perth = staged('perth');
  const all = [...sydney, ...melbourne, ...perth];

  it('holds every row the pack supplied, once, and no row has a place of its own yet', () => {
    expect([sydney.length, melbourne.length, perth.length]).toEqual([1463, 1032, 39]);
    expect(new Set(all.map((r) => r.entity_id)).size).toBe(all.length);
    for (const r of all) {
      expect(r.location.canonical, r.name).toEqual({ latitude: null, longitude: null, ready_to_publish_exact_pin: false });
      expect(r.location.relationship, r.name).toBe('directory_listing');
      expect(r.verification.identity, r.name).toBe('unverified');
      expect(r.verification.funding, r.name).toBe('not_collected');
      expect(r.verification.hiring, r.name).toBe('not_collected');
    }
  });

  it('keeps the source\'s own points as audit metadata, and says when one is the city centre', () => {
    const centre = melbourne.filter((r) => r.location.source_coordinates.at_city_centre);
    expect(centre.length).toBeGreaterThan(100);
    for (const r of centre) expect(r.review_notes.join(' ')).toMatch(/city centre: never used as a place/);
  });

  it('takes the type from the source\'s category as a candidate, never as verified', () => {
    for (const r of all) {
      expect(['startup', 'company', 'investor', 'space']).toContain(r.organisation_type.candidate);
      expect(r.organisation_type.basis).toBe('directory_category');
    }
  });

  it('gives an organisation in several cities one key, and does not merge a name that only looks alike', () => {
    const byKey = new Map();
    for (const r of all) (byKey.get(r.organisation_key) ?? byKey.set(r.organisation_key, []).get(r.organisation_key)).push(r.city);
    expect([...byKey.values()].filter((c) => new Set(c).size > 1).length).toBeGreaterThan(100);
    for (const r of all.filter((x) => x.reconciliation.status === 'review_ambiguous_name')) expect(r.reconciliation.target, r.name).not.toBeNull();
  });

  it('is the same every time: staging the same data again changes nothing', () => {
    const work = mkdtempSync(path.join(os.tmpdir(), 'citypack-'));
    try {
      cpSync(path.join(BACKEND, 'src', 'data'), path.join(work, 'data'), { recursive: true });
      node('import.mjs', 'stage', '--data', path.join(work, 'data'), '--out', path.join(work, 'one'));
      node('import.mjs', 'stage', '--data', path.join(work, 'data'), '--out', path.join(work, 'two'));
      for (const city of ['sydney', 'melbourne', 'perth', 'reconciliation']) {
        expect(readFileSync(path.join(work, 'two', city + '.json'), 'utf8'), city).toBe(readFileSync(path.join(work, 'one', city + '.json'), 'utf8'));
      }
    } finally { rmSync(work, { recursive: true, force: true }); }
  }, 180000);

  it('leaves no company that the directory already has in the research leads, and no investor', () => {
    for (const city of ['sydney', 'melbourne', 'perth']) {
      for (const dir of city === 'sydney' ? ['sydney-pack'] : [`${city}-pack`]) {
        const file = path.join(BACKEND, 'scripts', dir, 'research', `${city}-worldtechmap-2026-11-05.json`);
        if (!existsSync(file)) continue;
        const leads = JSON.parse(readFileSync(file, 'utf8')).companies;
        expect(leads.every((l) => l.organisation_type !== 'investor')).toBe(true);
        expect(leads.every((l) => l.website)).toBe(true);
      }
    }
  });
});

describe('the 62 address records in the shipped data', () => {
  const input = JSON.parse(readFileSync(path.join(PACK, 'input', 'address-updates-62.json'), 'utf8')).records;
  let ds;
  beforeAll(async () => { ds = parseRaw(await loadRaw(path.join(BACKEND, 'src', 'data'))); });
  const byName = (name) => ds.companies.find((c) => c.name.toLowerCase().replace(/[^a-z0-9]/g, '') === name.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const NOT_AN_OFFICE = (r) => !['office', 'operating_site', 'hub'].includes(r.address_type) || r.address_status !== 'published_operating_location';

  it('matches every record to one company', () => {
    for (const r of input) expect(byName(r.name), r.name).toBeTruthy();
  });

  it('never makes a postal, registered, listed, historical, incomplete, conflicting or unconfirmed address a pin', () => {
    for (const r of input.filter(NOT_AN_OFFICE)) {
      const c = byName(r.name);
      const pinned = Number.isFinite(c.lat) && ['EXACT', 'SUBURB'].includes(c.location_precision);
      if (r.address_candidate && pinned) expect(sameAddress(String(c.address ?? ''), r.address_candidate), `${r.name}: ${r.address_status} address is the pin`).toBe(false);
      // and no active evidence row of the company's own says it is where the company works
      const active = ds.evidence.filter((e) => e.company_id === c.id && e.field === 'address' && e.status === 'active');
      if (['postal', 'registered'].includes(r.address_type) && r.address_candidate) for (const e of active) expect(sameAddress(e.value, r.address_candidate), `${r.name}: ${e.value}`).toBe(false);
    }
  });

  it('keeps those addresses as locations of their own, with no coordinates', () => {
    const mine = ds.company_locations.filter((l) => /\.addr\./.test(l.id));
    expect(mine.length).toBeGreaterThan(20);
    for (const l of mine) { expect(l.latitude, l.id).toBeNull(); expect(l.longitude, l.id).toBeNull(); expect(l.location_precision, l.id).toBe('CITY'); }
  });

  it('carries the consulted dates forward: nothing is "verified today"', () => {
    // (the 62 address records' own rows: the address kept from a pin made city-level has no date, because nobody read a page for it)
    const dates = new Set(ds.company_locations.filter((l) => /\.addr\./.test(l.id) && !/\.addr\.original$/.test(l.id)).map((l) => String(l.location_verified_at).slice(0, 10)));
    for (const d of dates) expect(['2026-11-02', '2026-11-05']).toContain(d);
  });

  it('resolves the named cases the way the evidence says', () => {
    const q = byName('Qsic');
    expect(ds.evidence.some((e) => e.company_id === q.id && e.field === 'address' && /Fitzroy/.test(e.value) && e.status === 'active')).toBe(true);
    expect(ds.evidence.some((e) => e.company_id === q.id && e.field === 'address' && /Abbotsford/.test(e.value))).toBe(false);
    const bellroy = byName('Bellroy');
    expect(['EXACT', 'SUBURB']).not.toContain(bellroy.location_precision); // a registered office at a consulting firm is not a working office
    const vino = byName('Vinomofo');
    expect(ds.evidence.filter((e) => e.company_id === vino.id && e.field === 'address' && e.status === 'active').every((e) => /204 Ingles/.test(e.value))).toBe(true);
    const amlab = byName('AMLab');
    expect(ds.company_locations.some((l) => l.company_id === amlab.id && /Collingwood/.test(l.address ?? ''))).toBe(true); // the R&D facility, kept apart from the head office
    const markMyWords = byName('Mark My Words');
    expect(markMyWords.address ?? '').not.toMatch(/Swanston/); // "700 Connect" is not turned into a street
  });

  it('is applied once: running it again would add nothing', () => {
    const out = node('addresses.mjs', 'plan');
    const summary = JSON.parse(out.slice(out.indexOf('{'), out.indexOf('}\n') + 1));
    expect(summary.evidence_rows_added).toBe(0);
    expect(summary.locations_added).toBe(0);
    expect(summary.evidence_rows_superseded).toBe(0);
  });

  it('leaves the dataset valid', () => {
    expect(validateDataset(ds)).toEqual([]);
  });
});

describe('no pin is a city centre', () => {
  it('has no company pinned on the reference point of a city, and the two with an invented address are not pinned', () => {
    const companies = JSON.parse(readFileSync(path.join(BACKEND, 'src', 'data', 'startups.json'), 'utf8'));
    const centres = [[-33.8688, 151.2093], [-37.8136, 144.9631], [-31.9505, 115.8605]];
    for (const c of companies.filter((x) => Number.isFinite(x.lat))) {
      for (const [la, lo] of centres) expect(Math.abs(c.lat - la) < 0.00005 && Math.abs(c.lng - lo) < 0.00005, `${c.name} is on the centre point of a city`).toBe(false);
    }
    // Slyp has no address on any page: city-level. Edstart's own privacy page gives a street address in Surry Hills, which the geocoder placed; the placeholder is on no page.
    const slyp = companies.find((x) => x.id === 'slyp');
    expect(slyp.location_precision).toBe('CITY');
    expect(slyp.lat).toBeNull();
    for (const id of ['edstart', 'slyp']) expect(String(companies.find((x) => x.id === id).address ?? ''), id).not.toMatch(/Interface Lane|Launch Lane/);
    const edstart = companies.find((x) => x.id === 'edstart');
    if (Number.isFinite(edstart.lat)) expect(edstart.address ?? '').toMatch(/Commonwealth/);
  });
});

describe('the 26 pins made city-level (legacy-pin-decisions.json)', () => {
  const decisions = JSON.parse(readFileSync(path.join(PACK, 'legacy-pin-decisions.json'), 'utf8')).decisions;
  let ds;
  beforeAll(async () => { ds = parseRaw(await loadRaw(path.join(BACKEND, 'src', 'data'))); });

  it('keeps each company, in its city, at city level with no point, no address and no suburb or postcode of an address nobody confirmed', () => {
    expect(Object.keys(decisions)).toHaveLength(26);
    for (const [id, d] of Object.entries(decisions)) {
      const c = ds.companies.find((x) => x.id === id);
      expect(c, id).toBeTruthy();
      expect(c.location_precision, d.name).toBe('CITY');
      expect(c.lat, d.name).toBeNull();
      expect(c.lng, d.name).toBeNull();
      expect(c.address ?? null, d.name).toBeNull();
      expect(c.suburb ?? null, d.name).toBeNull();
      expect(c.postcode ?? null, d.name).toBeNull();
      expect(c.location_verified_at ?? null, d.name).toBeNull();
    }
  });

  it('keeps the address each one had as a location of its own: not confirmed, not drawn, no coordinates', () => {
    for (const [id, d] of Object.entries(decisions)) {
      const row = ds.company_locations.find((l) => l.id === `${id}.addr.original`);
      expect(row, d.name).toBeTruthy();
      expect(row.address, d.name).toBe(d.recorded_address);
      expect(row.latitude).toBeNull();
      expect(row.longitude).toBeNull();
      expect(row.label).toMatch(/not confirmed/);
    }
  });

  it('puts none of them back on the map from an address: nothing that is still pinned rests on one of these records', () => {
    for (const id of Object.keys(decisions)) expect(Number.isFinite(ds.companies.find((x) => x.id === id).lat), id).toBe(false);
    // the pins that rest on the original directory record and were kept: exact ones say "Office address on file", suburb-level ones say so; Contactile and Diraq stay at suburb level
    const kept = ds.companies.filter((c) => Number.isFinite(c.lat) && !['company_website', 'company_document'].includes(c.location_source));
    expect(kept).toHaveLength(95);
    for (const id of ['contactile', 'diraq']) expect(ds.companies.find((c) => c.id === id).location_precision).toBe('SUBURB');
  });

  it('records each change in the audit trail with the address it had, and nothing else about the company is lost', () => {
    for (const [id, d] of Object.entries(decisions)) {
      const row = ds.audit_trail.find((r) => r.action === 'location.set' && r.target.id === id && /made city-level/.test(r.summary));
      expect(row, d.name).toBeTruthy();
      expect(row.changes.some((c) => c.field === 'address' && c.from === d.recorded_address && c.to === null), d.name).toBe(true);
    }
    expect(ds.companies.filter((c) => Object.keys(decisions).includes(c.id)).every((c) => c.name && c.website !== undefined)).toBe(true);
  });
});
