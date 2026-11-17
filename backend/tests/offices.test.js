import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRaw, parseRaw } from '../src/models/dataset.js';
import { parseAddress } from '../src/models/location.js';
import { cityCentre, distanceMetres } from '../src/geo/places.js';

// The office addresses companies' own websites state (scripts/addresses/office-claims-2026-11-17.json, found by find-offices.mjs and read by a person), and the pins placed from them
// (place-offices.mjs, at the building the state's own address data gives).
const HERE = path.dirname(fileURLToPath(import.meta.url));
const claims = JSON.parse(readFileSync(path.join(HERE, '..', 'scripts', 'addresses', 'office-claims-2026-11-17.json'), 'utf8')).claims;
const PLACED = ['amlab', 'bioscout', 'carma', 'chironix', 'corametix', 'harrison-ai', 'harvest-b', 'hyprfire', 'samsara-eco', 'sunburnt-space-co', 'veintech'];
let ds; let byId;
beforeAll(async () => { ds = parseRaw(await loadRaw(path.join(HERE, '..', 'src', 'data'))); byId = new Map(ds.companies.map((c) => [c.id, c])); });

describe('the claims', () => {
  it('are each a street address on the company\'s own website, read as one, in an Australian state', () => {
    expect(claims.length).toBeGreaterThan(15);
    for (const claim of claims) {
      const c = byId.get(claim.id);
      expect(c, claim.id).toBeTruthy();
      expect(parseAddress(claim.address).streetLevel, claim.address).toBe(true);
      expect(['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT']).toContain(parseAddress(claim.address).state);
      expect(['office', 'correspondence']).toContain(claim.kind);
      expect(new URL(claim.url).hostname.replace(/^www\./, '').endsWith(new URL(c.website).hostname.replace(/^www\./, '')), claim.company).toBe(true);
      expect(claim.quote.length, claim.company).toBeGreaterThan(20);
    }
  });
});

describe('the pins placed from them', () => {
  it('are exact, at the address the company\'s own page states, sourced to that page, and in the city the record names', () => {
    for (const id of PLACED) {
      const c = byId.get(id);
      const claim = claims.find((x) => x.id === id && x.kind === 'office');
      expect(c.location_precision, id).toBe('EXACT');
      expect(c.location_source, id).toBe('company_website');
      expect(c.location_source_url, id).toBe(claim.url);
      expect(c.address, id).toBe(claim.address);
      expect(Number.isFinite(c.lat) && Number.isFinite(c.lng), id).toBe(true);
      expect(c.verified, id).toBe(true);
      expect(c.location_confidence, id).toBe('high');
      const centre = cityCentre(c.city, c.state);
      if (centre) expect(distanceMetres(c.lat, c.lng, centre.lat, centre.lng) / 1000, `${id} is far from ${c.city}`).toBeLessThan(60);
    }
  });

  it('are the only ones from this search: an address given only as where to write is never a pin, and a company whose record is not verified is not pinned by it', () => {
    for (const claim of claims.filter((x) => x.kind === 'correspondence')) {
      const c = byId.get(claim.id);
      expect(['EXACT', 'SUBURB'], claim.company).not.toContain(c.location_precision);
      expect(ds.company_locations.some((l) => l.company_id === c.id && l.kind === 'OTHER' && l.address === claim.address || (l.company_id === c.id && /correspondence|postal|mailing/i.test(l.label ?? ''))), claim.company).toBe(true);
    }
    for (const id of ['darwinium', 'kinde', 'kite-magnetics', 'nomad-atomics']) {
      const c = byId.get(id);
      expect(c.verified, id).not.toBe(true);
      expect(['EXACT', 'SUBURB'], id).not.toContain(c.location_precision);
      expect(ds.evidence.some((e) => e.company_id === id && e.field === 'address' && e.status === 'active'), id).toBe(true); // its own site's address is kept as evidence for when it is verified
    }
    expect(byId.get('flyone').location_precision).toBe('CITY'); // on airport land the state's address data has no point for it
  });
});
