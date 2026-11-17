// Puts a pin at the building of an office address a company's own website states, using the point the state's own open address data gives for that address:
//   NSW  NSW Spatial Services, Geocoded Addressing Theme, Address Point (open data, CC BY 4.0)
//   WA   Landgate (SLIP), Cadastre Address (LGATE-002): the parcel with that street number, street and locality (the point is the middle of the parcel)
// A street-only answer from OpenStreetMap's Nominatim, which is all the location tool's geocoder finds for many Australian addresses, puts a pin somewhere along a street; these are the buildings.
// The address is the one the company's own page states (office-claims-*.json, kind "office"); only a verified, city-level company is placed; a point more than 1.5 km from where OpenStreetMap puts the
// street (a different street of the same name) or a lookup that finds more than one place for the address is reported and not applied.
//
//   node scripts/addresses/place-offices.mjs lookup  [--claims <json>]          what the official data says for each; writes nothing
//   node scripts/addresses/place-offices.mjs apply   [--claims <json>] --by "name"
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRaw, parseRaw } from '../../src/models/dataset.js';
import { transact } from '../../src/models/store.js';
import { confirmLocation } from '../../src/enrichment/fill.js';
import { parseAddress } from '../../src/models/location.js';
import { distanceMetres } from '../../src/geo/places.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(HERE, '..', '..', 'src', 'data');
const [, , step = 'lookup', ...rest] = process.argv;
const flag = (name) => { const i = rest.indexOf(name); return i < 0 ? null : (rest[i + 1] ?? true); };
const claims = JSON.parse(readFileSync(path.resolve(HERE, flag('--claims') ?? 'office-claims-2026-11-17.json'), 'utf8')).claims.filter((c) => c.kind === 'office');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// How each address is written in the official data (several forms for a range or a unit, since a point is held for the building under any of them).
const LOOKUP = {
  'sunburnt-space-co': { state: 'NSW', forms: ['7-9 RHODES STREET WEST RYDE', '7 RHODES STREET WEST RYDE', '9 RHODES STREET WEST RYDE', '12/7-9 RHODES STREET WEST RYDE'] },
  bioscout: { state: 'NSW', forms: ['6 SLOANE STREET MARRICKVILLE'] },
  // (the gazetteer calls the suburb of postcode 2016 Redfern)
  carma: { state: 'NSW', forms: ['219-241 CLEVELAND STREET REDFERN', '219-241 CLEVELAND STREET STRAWBERRY HILLS', '219 CLEVELAND STREET REDFERN'] },
  'harvest-b': { state: 'NSW', forms: ['83-85 FOVEAUX STREET SURRY HILLS', '83 FOVEAUX STREET SURRY HILLS', '85 FOVEAUX STREET SURRY HILLS', '1/83-85 FOVEAUX STREET SURRY HILLS'] },
  'harrison-ai': { state: 'NSW', forms: ['24 CAMPBELL STREET HAYMARKET', '24-28 CAMPBELL STREET HAYMARKET', '24 CAMPBELL STREET SYDNEY'] },
  'samsara-eco': { state: 'NSW', forms: ['19 WOLSELEY PLACE JERRABOMBERRA'] },
  amlab: { state: 'WA', number: '24', road: 'HASLER', locality: 'OSBORNE PARK' },
  chironix: { state: 'WA', number: '33', road: 'MILLROSE', locality: 'MALAGA' },
  corametix: { state: 'WA', number: '4', road: 'GOULD', locality: 'OSBORNE PARK' },
  veintech: { state: 'WA', number: '4', road: 'GOULD', locality: 'OSBORNE PARK' },
  flyone: { state: 'WA', number: '3', road: 'BARON', locality: 'JANDAKOT' },
  hyprfire: { state: 'WA', number: '152', road: 'ST GEORGES', locality: 'PERTH' },
};

async function nsw(forms) {
  const where = `address IN (${forms.map((f) => `'${f}'`).join(',')})`;
  const res = await fetch(`https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Geocoded_Addressing_Theme/FeatureServer/1/query?${new URLSearchParams({ where, outFields: 'address', outSR: '4326', f: 'json', resultRecordCount: '40' })}`, { signal: AbortSignal.timeout(90000) });
  const json = await res.json();
  if (json.error) throw new Error(`NSW: ${json.error.message}`);
  return (json.features ?? []).map((f) => ({ label: f.attributes.address, lat: f.geometry.y, lng: f.geometry.x }));
}
const ringCentre = (ring) => { // the area centroid of a polygon ring, in degrees (small areas: flat is fine)
  let a = 0; let x = 0; let y = 0;
  for (let i = 0; i < ring.length - 1; i += 1) { const [x1, y1] = ring[i]; const [x2, y2] = ring[i + 1]; const k = x1 * y2 - x2 * y1; a += k; x += (x1 + x2) * k; y += (y1 + y2) * k; }
  return a === 0 ? { lng: ring[0][0], lat: ring[0][1] } : { lng: x / (3 * a), lat: y / (3 * a) };
};
async function wa({ number, road, locality }) {
  const where = `road_number_1='${number}' AND road_name='${road}' AND locality='${locality}'`;
  const res = await fetch(`https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Places_and_Addresses/MapServer/4/query?${new URLSearchParams({ where, outFields: 'road_number_1,road_number_2,road_name,road_type,locality,lot_number', returnGeometry: 'true', outSR: '4326', f: 'json', resultRecordCount: '40' })}`, { signal: AbortSignal.timeout(90000) });
  const json = await res.json();
  if (json.error) throw new Error(`WA: ${json.error.message}`);
  return (json.features ?? []).map((f) => ({ label: `${f.attributes.road_number_1} ${f.attributes.road_name} ${f.attributes.road_type ?? ''}, ${f.attributes.locality} (lot ${f.attributes.lot_number ?? '?'})`, ...ringCentre(f.geometry.rings[0]) }));
}

// the nominatim street point already kept for the address (a sanity check: the building is on the street the geocoder knows)
const cache = JSON.parse(readFileSync(path.join(dir, 'geocode_cache.json'), 'utf8'));
const cacheRows = Array.isArray(cache) ? cache : cache.rows ?? cache.geocode_cache ?? [];
const streetPoint = (address) => {
  const p = parseAddress(address);
  const want = `${String(address).split(',')[0].replace(/^(unit|suite|level)\s*[\w./ -]*?,?\s*/i, '')}`.toLowerCase();
  const row = cacheRows.find((r) => r.status === 'found' && r.result && r.query.toLowerCase().includes((p.street ?? want).toLowerCase().split(' ').slice(-2).join(' ')) && r.query.includes(p.postcode ?? '----'));
  return row ? { lat: row.result.lat, lng: row.result.lng } : null;
};

async function look(claim) {
  const spec = LOOKUP[claim.id];
  if (!spec) return { claim, problem: 'no official lookup is set up for it' };
  let hits;
  try { hits = spec.state === 'NSW' ? await nsw(spec.forms) : await wa(spec); } catch (e) { return { claim, problem: e.message }; }
  if (!hits.length) return { claim, problem: 'the official data has no such address' };
  // the same building: every hit within 80 m of the first, else it is more than one place
  const [first] = hits;
  const spread = Math.max(...hits.map((h) => distanceMetres(first.lat, first.lng, h.lat, h.lng)));
  const point = hits.length === 1 ? first : { lat: hits.reduce((s, h) => s + h.lat, 0) / hits.length, lng: hits.reduce((s, h) => s + h.lng, 0) / hits.length };
  if (spread > 80) return { claim, hits, problem: `more than one place (${Math.round(spread)} m apart)` };
  const street = streetPoint(claim.address);
  const away = street ? Math.round(distanceMetres(point.lat, point.lng, street.lat, street.lng)) : null;
  if (away != null && away > 1500) return { claim, hits, point, away, problem: `${away} m from the street the geocoder knows: another street of the same name?` };
  return { claim, hits, point, away, spec };
}

const ds = parseRaw(await loadRaw(dir));
const found = [];
for (const claim of claims) {
  const c = ds.companies.find((x) => x.id === claim.id);
  if (!c) { console.log(`${claim.company}: not in the data`); continue; }
  if (c.verified !== true || c.location_precision !== 'CITY' || c.address) { console.log(`${c.name}: left alone (${c.verified === true ? c.location_precision : 'the record is not verified'}${c.address ? ', it has an address' : ''})`); continue; }
  const r = await look(claim);
  await sleep(500);
  if (r.problem) console.log(`${c.name}: NOT PLACED: ${r.problem}${r.hits ? ` [${r.hits.map((h) => h.label).join(' | ')}]` : ''}`);
  else { console.log(`${c.name}: ${r.point.lat.toFixed(6)}, ${r.point.lng.toFixed(6)}  from ${r.hits.length} official point${r.hits.length === 1 ? '' : 's'} [${r.hits[0].label}]${r.away != null ? `, ${r.away} m from the street point` : ''}`); found.push({ c, ...r }); }
}

if (step === 'apply') {
  const by = flag('--by'); if (typeof by !== 'string') throw new Error('--by "name" is required');
  const placed = [];
  await transact(dir, (work, { at }) => {
    const audit = [];
    for (const f of found) {
      const company = work.companies.find((x) => x.id === f.c.id);
      const parsed = parseAddress(f.claim.address);
      const before = structuredClone(company);
      const changes = confirmLocation(company, {
        city: company.city, address: f.claim.address, suburb: parsed.suburb ?? null, state: parsed.state ?? company.state, postcode: parsed.postcode ?? null,
        lat: Number(f.point.lat.toFixed(6)), lng: Number(f.point.lng.toFixed(6)), precision: 'EXACT', source: 'company_website', sourceUrl: f.claim.url, verifiedAt: at, geocodeAgrees: true,
      }, { at });
      if (!changes.length) continue;
      company.updated_at = at;
      placed.push(company.name);
      audit.push({ actor: { name: by, role: 'cli' }, via: 'cli', action: 'location.set', target: { type: 'company', id: company.id }, summary: `Set ${company.name}'s location (EXACT)`,
        reason: `Its own website states the office at ${f.claim.address} (${f.claim.page}); the point is the ${f.spec.state === 'NSW' ? 'NSW Spatial Services address point' : "Landgate cadastre parcel's centre"} for that address.`, changes: changes.map((ch) => ({ field: ch.field, from: ch.from ?? null, to: ch.to ?? null })) });
    }
    return { audit };
  });
  console.log(`\n${placed.length} placed: ${placed.join(', ')}`);
} else console.log(`\n${found.length} could be placed (nothing was written)`);
