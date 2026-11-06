// Makes the pins that rest on an unconfirmed directory address city-level (legacy-pin-decisions.json), without losing the company, its city, or the address it had.
//
//   node scripts/citypack/legacy-pins.mjs plan
//   node scripts/citypack/legacy-pins.mjs apply --by "name"
//
// For each company in the decisions file whose pin still rests on the original directory record (not on its own page):
//   - the point is removed and the precision is CITY ("Exact location not published"); the suburb and postcode go with it (a city-level record carries neither);
//   - the company stays in its city's view: its `city` becomes the city its postcode belongs to (a company recorded as "Richmond" is in Melbourne);
//   - the address it had is NOT shown or used for a pin again: it becomes a location of its own (kind OTHER, no coordinates, "not confirmed") and is in the audit row;
//     it is taken out of the record's `address` so that no geocoding run can put a pin back from it. Any address the company's own pages gave stays in the evidence, untouched, for review;
//   - no replacement address is chosen, and nothing is geocoded.
// Safe to run again: a company already at city level is left alone, and one that has since been confirmed from its own page is not touched.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../discovery.js';
import { loadRaw, parseRaw } from '../../src/models/dataset.js';
import { transact } from '../../src/models/store.js';
import { metroOf } from '../../src/geo/metro.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(HERE, '..', '..', 'src', 'data');
const { positional: [step], flags } = parseArgs(process.argv.slice(2));
const { decisions } = JSON.parse(readFileSync(path.join(HERE, 'legacy-pin-decisions.json'), 'utf8'));
const OFFICIAL = ['company_website', 'company_document'];
const FIELDS = ['lat', 'lng', 'location_precision', 'address', 'suburb', 'postcode', 'city', 'location_source_url', 'location_verified_at', 'location_confidence'];

function run(work, { write, by, at }) {
  const report = { demoted: [], left: [] };
  const audit = [];
  work.company_locations ??= [];
  for (const [id, d] of Object.entries(decisions)) {
    const c = work.companies.find((x) => x.id === id);
    if (!c) { report.left.push(`${id}: not in the directory`); continue; }
    if (c.location_precision === 'CITY' && !Number.isFinite(c.lat)) { report.left.push(`${c.name}: already city-level`); continue; }
    if (!Number.isFinite(c.lat) || OFFICIAL.includes(c.location_source)) { report.left.push(`${c.name}: its pin no longer rests on the original record (${c.location_source ?? 'no source'}): not touched`); continue; }
    const before = Object.fromEntries(FIELDS.map((k) => [k, c[k] ?? null]));
    const city = metroOf(c) ?? c.city;
    const locId = `${id}.addr.original`;
    if (write) {
      if (before.address && !work.company_locations.some((l) => l.id === locId)) {
        work.company_locations.push({
          id: locId, company_id: id, kind: 'OTHER', label: 'Address on the original directory record (not confirmed)', address: before.address, suburb: before.suburb, city, state: c.state ?? null, country: 'Australia',
          postcode: before.postcode, latitude: null, longitude: null, location_precision: 'CITY', location_source: c.location_source ?? 'directory_record', location_source_url: null, location_verified_at: null, location_confidence: 'low', created_at: at, updated_at: at,
        });
      }
      Object.assign(c, { lat: null, lng: null, location_precision: 'CITY', address: null, suburb: null, postcode: null, city, location_source_url: null, location_verified_at: null, location_confidence: 'low', updated_at: at });
    }
    const after = { lat: null, lng: null, location_precision: 'CITY', address: null, suburb: null, postcode: null, city, location_source_url: null, location_verified_at: null, location_confidence: 'low' };
    const changes = FIELDS.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map((field) => ({ field, from: before[field], to: after[field] }));
    report.demoted.push(`${c.name} (${city}): ${before.address ?? 'no address'}`);
    audit.push({ actor: { name: by ?? 'plan', role: 'cli' }, via: 'cli', action: 'location.set', target: { type: 'company', id }, summary: `${c.name}: made city-level; the pin rested on an unconfirmed address from the original directory record`, reason: d.why, changes });
  }
  return { report, audit };
}

const by = typeof flags.by === 'string' ? flags.by : null;
if (step === 'apply') {
  if (!by) throw new Error('--by "name" is required: every change is recorded with a name');
  let out;
  const { changed } = await transact(dir, async (work, { at }) => { out = run(work, { write: true, by, at }); return { audit: out.audit }; });
  console.log(JSON.stringify({ demoted: out.report.demoted.length, left: out.report.left, wrote: changed }));
  console.log(out.report.demoted.join('\n'));
} else {
  const ds = parseRaw(await loadRaw(dir));
  const { report } = run(structuredClone(ds), { write: false, at: new Date().toISOString() });
  console.log(JSON.stringify({ would_demote: report.demoted.length, left: report.left }));
  console.log(report.demoted.join('\n'));
  console.log('(nothing was written)');
}
