// The firms' offices on the map: what is drawn, and what is not and why.
//
//   node scripts/institution-pins.js status  [--json] [--file institutions_seed.json] [--data <dir>]
//        reads institutions_seed.json (in the data folder, or --file) and says, for every office: drawn, flagged (the geocoder's answer is not good
//        enough: it is NOT drawn, and is listed here for you to check), pending (a street address nobody has asked about yet), or not a pin
//        (no street address, so the firm is listed and not drawn); firms with offices: [] are listed only; entries in "hold" are never rendered.
//   node scripts/institution-pins.js geocode [--limit n] [--file ...] [--data <dir>]
//        asks the geocoder about the pending street addresses, once each (answers are kept in geocode_cache.json, so an address is never
//        asked twice), then shows the same report.
//
// The geocoder is OpenStreetMap's Nominatim, the one the companies' locations use, with the same rules (one request a second, a user agent
// that names this site, a 429 stops the run, an answer is only used when it found the street number in the state the address names).
// It stands in for Mapbox's: there is no Mapbox token on this site (frontend/.env has an empty VITE_MAPBOX_TOKEN and Vercel has none).
// An address is a firm's own published office address, never a person's. Exit code: 0 ok, 2 if the geocoder told the run to stop, 1 on an error.
import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { snapshot, transact } from '../src/models/store.js';
import { checkInstitutionSeed, SEED_FILE } from '../src/models/institutionSeed.js';
import { buildInstitutionPins } from '../src/catalog/institutionPins.js';
import { createGeocoder, geocodeCached, mergeCache, PROVIDER } from '../src/geo/geocode.js';
import { lookup } from '../src/models/geocodeCache.js';

const DEFAULT_DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data');

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) { positional.push(argv[i]); continue; }
    const next = argv[i + 1];
    flags[argv[i].slice(2)] = next === undefined || next.startsWith('--') ? true : (i += 1, next);
  }
  return { positional, flags };
}

async function readSeed(file) {
  try { return { json: JSON.parse(await readFile(file, 'utf8')), file }; } catch (err) {
    if (err.code === 'ENOENT') return { json: null, file, missing: true };
    throw new Error(`${file} could not be read: ${err.message}`);
  }
}

export function renderReport(report, out) {
  out(`Drawn: ${report.pinned} office${report.pinned === 1 ? '' : 's'}`);
  const section = (title, rows, line) => {
    out(`${title}: ${rows.length}`);
    for (const r of rows.slice(0, 25)) out(`  ${line(r)}`);
    if (rows.length > 25) out(`  ... and ${rows.length - 25} more`);
  };
  section('Flagged (not drawn: check each)', report.flagged, (r) => `${r.name} (${r.office}): ${r.reason}${r.found?.display_name ? ` [the geocoder said: ${r.found.display_name}]` : ''}`);
  section('Pending (street address not yet asked of the geocoder: run geocode)', report.pending, (r) => `${r.name} (${r.office}): ${r.query}`);
  section('Not a pin (no street address)', report.noPin, (r) => `${r.name} (${r.office ?? 'office'}): ${r.reason}`);
  section('Listed, with no offices (no pin)', report.noOffices.map((name) => ({ name })), (r) => r.name);
  out(`On hold (never shown): ${report.held}`);
  if (report.problems.length) section('Problems in the file', report.problems.map((p) => ({ p })), (r) => r.p);
}

export async function main(argv, deps = {}) {
  const { dataDir = DEFAULT_DATA_DIR, out = (s) => console.log(s), now = Date.now } = deps;
  const { positional: [command], flags } = parseArgs(argv);
  const dir = typeof flags.data === 'string' ? path.resolve(flags.data) : dataDir;
  const file = typeof flags.file === 'string' ? path.resolve(flags.file) : path.join(dir, SEED_FILE);
  if (!command || command === 'help') { out('Commands: status, geocode. See scripts/institution-pins.js.'); return 0; }
  if (!['status', 'geocode'].includes(command)) throw new Error(`unknown command "${command}"`);

  const seed = await readSeed(file);
  if (seed.missing) { out(`There is no ${path.basename(file)} at ${file}: no institution is drawn, and the Institutions layer is hidden.`); return 0; }
  const checked = checkInstitutionSeed(seed.json);
  const { ds } = await snapshot(dir, { now });
  let cache = structuredClone(ds.geocode_cache ?? []);
  let stopped = null;

  if (command === 'geocode') {
    const limit = Number.isFinite(Number(flags.limit)) ? Number(flags.limit) : Infinity;
    const gc = deps.geocoder ?? createGeocoder({ fetchImpl: deps.fetchImpl, now, sleep: deps.sleep });
    const { report } = buildInstitutionPins(checked, cache);
    let asked = 0; let spared = 0;
    for (const p of report.pending) {
      if (lookup(cache, PROVIDER, p.query, now())) { spared += 1; continue; }
      if (asked >= limit) break;
      asked += 1;
      const { row } = await geocodeCached(gc, cache, p.query, now());
      if (row.status === 'error') out(`  ${p.name}: ${row.error}`);
      if (gc.stopped) { stopped = gc.stopped; break; }
    }
    await transact(dir, (work) => {
      work.geocode_cache = mergeCache(work.geocode_cache ?? [], cache);
      return { result: null, audit: asked ? [{ actor: { name: 'institution-pins', role: 'cli' }, via: 'cli', action: 'location.geocode', target: { type: 'system', id: 'geocoder' }, summary: `Asked the geocoder about ${asked} institution office address(es)${stopped ? `; stopped: ${stopped}` : ''}` }] : [] };
    }, { now });
    out(`Asked the geocoder about ${asked} address${asked === 1 ? '' : 'es'}, ${spared} answered from the cache${stopped ? `; stopped early: ${stopped}` : ''}.`);
    cache = (await snapshot(dir, { now })).ds.geocode_cache ?? cache;
  }

  const built = buildInstitutionPins(checked, cache);
  if (flags.json) out(JSON.stringify({ pinned: built.report.pinned, flagged: built.report.flagged, pending: built.report.pending, noPin: built.report.noPin, noOffices: built.report.noOffices, held: built.report.held, problems: built.report.problems }, null, 2));
  else renderReport(built.report, out);
  return stopped ? 2 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not allowed here: carry on */ }
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => { console.error(`error: ${err.message}`); process.exitCode = 1; });
}
