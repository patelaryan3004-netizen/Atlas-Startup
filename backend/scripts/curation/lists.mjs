// Two lists from the curated map, as CSV in docs/:
//   docs/curated-map-check.csv                    the companies the list could not say about (maturity "Unverified", flagged maturity_check): kept on the map for now
//   docs/curated-map-pins-needing-addresses.csv   the companies the list says to pin ("Add pin") that have no point location, so no pin can be drawn for them yet
//   node scripts/curation/lists.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCatalog } from '../../src/catalog/catalog.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const list = JSON.parse(readFileSync(path.join(HERE, 'curated-list.json'), 'utf8')).rows;
const catalog = createCatalog({ file: path.join(ROOT, 'src', 'data', 'startups.json'), reloadMs: 0 });
await catalog.refresh();
const snap = await catalog.snapshot();
const at = (name) => snap.records.findIndex((r) => r.name === name);
const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
const PLACE = { CITY: 'only the city is on file', STATE: 'only the state is on file', UNKNOWN: 'no location on file (the record is not verified)', EXACT: 'an exact address', SUBURB: 'a suburb' };

const check = list.filter((r) => r.change === 'Check').map((r) => {
  const i = at(r.startup); const c = snap.records[i];
  return [r.startup, c.city, c.website, c.stage, PLACE[snap.precisions[i]], snap.markers[i] ? 'Pin on the map' : 'No pin', r.note];
});
writeFileSync(path.join(ROOT, '..', 'docs', 'curated-map-check.csv'), `${[['Company', 'City', 'Website', 'Funding stage on file', 'Where it is known', 'On the map', 'Why it is flagged'].map(q).join(','), ...check.map((row) => row.map(q).join(','))].join('\n')}\n`);

const noPoint = list.filter((r) => r.change === 'Add pin').map((r) => ({ r, i: at(r.startup) })).filter(({ i }) => !snap.markers[i]).map(({ r, i }) => {
  const c = snap.records[i];
  return [r.startup, c.city, c.state ?? '', c.website, r.stage ?? '', PLACE[snap.precisions[i]], 'a street address for its office (found on its own site or confirmed by the company), then the geocoder'];
});
writeFileSync(path.join(ROOT, '..', 'docs', 'curated-map-pins-needing-addresses.csv'), `${[['Company', 'City', 'State', 'Website', 'Maturity (from the list)', 'What is on file', 'What a pin needs'].map(q).join(','), ...noPoint.map((row) => row.map(q).join(','))].join('\n')}\n`);
console.log(`${check.length} flagged to check; ${noPoint.length} to pin that have no point location`);
