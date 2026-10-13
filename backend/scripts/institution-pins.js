// The firms' offices on the map: what is drawn, and what is not and why.
//
//   node scripts/institution-pins.js status  [--json] [--file institutions_seed.json] [--data <dir>]
//        reads institutions_seed.json (in the data folder, or --file) and says, for every office: drawn, flagged (the geocoder's answer is not good
//        enough: it is NOT drawn, and is listed here for you to check), pending (a street address nobody has asked about yet), or not a pin
//        (no street address, so the firm is listed and not drawn); firms with offices: [] are listed only; entries in "hold" are never rendered.
//   node scripts/institution-pins.js geocode [--provider mapbox|nominatim] [--limit n] [--file ...] [--data <dir>]
//        asks the geocoder about each street address that has no answer from it yet, once each (answers are kept in geocode_cache.json, so an
//        address is never asked twice), then shows the same report. A match that fits poorly is in the report's "Flagged" list with how well it
//        fitted, and is not drawn.
//
// Two geocoders. Mapbox's Geocoding API is used when MAPBOX_TOKEN is set in the environment (the token is read from there, never from a file
// in the project and never printed); a match under 0.85 relevance is flagged. Without a token the run says so and uses OpenStreetMap's
// Nominatim, the one the companies' locations use, with the same rules (one request a second, a user agent that names this site, a 429 stops the
// run, an answer is only used when it found the street number in the state the address names). --provider mapbox with no token is an error,
// not a quiet fallback. MAPBOX_GEOCODING_PERMANENT=1 uses Mapbox's permanent endpoint (see geo/mapbox.js: the temporary one is not for keeping).
// An address is a firm's own published office address, never a person's. Exit code: 0 ok, 2 if the geocoder told the run to stop, 1 on an error.
import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { snapshot, transact } from '../src/models/store.js';
import { checkInstitutionSeed, SEED_FILE } from '../src/models/institutionSeed.js';
import { buildInstitutionPins } from '../src/catalog/institutionPins.js';
import { createGeocoder, geocodeCached, mergeCache, questionFor, PROVIDER } from '../src/geo/geocode.js';
import { createMapboxGeocoder, MAPBOX_PROVIDER } from '../src/geo/mapbox.js';
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
  section('Flagged (not drawn: check each)', report.flagged, (r) => `${r.name} (${r.office}): ${r.reason}${r.relevance != null ? ` (relevance ${r.relevance.toFixed(2)})` : ''}${r.found?.display_name ? ` [the geocoder said: ${r.found.display_name}]` : ''}`);
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
    const env = deps.env ?? process.env;
    const wanted = typeof flags.provider === 'string' ? flags.provider : env.MAPBOX_TOKEN ? MAPBOX_PROVIDER : PROVIDER;
    if (![MAPBOX_PROVIDER, PROVIDER].includes(wanted)) throw new Error(`--provider must be mapbox or nominatim, not "${wanted}"`);
    let gc = deps.geocoder;
    if (!gc && wanted === MAPBOX_PROVIDER) {
      if (!env.MAPBOX_TOKEN) throw new Error('there is no Mapbox token: set MAPBOX_TOKEN in the environment for this run (it is not read from any file, and is never printed)');
      gc = createMapboxGeocoder({ token: env.MAPBOX_TOKEN, permanent: env.MAPBOX_GEOCODING_PERMANENT === '1', fetchImpl: deps.fetchImpl, now, sleep: deps.sleep });
    }
    if (!gc) {
      gc = createGeocoder({ fetchImpl: deps.fetchImpl, now, sleep: deps.sleep });
      out('No Mapbox token (MAPBOX_TOKEN is not set): asking OpenStreetMap\'s geocoder instead.');
    }
    const provider = gc.provider ?? PROVIDER;
    // every street address of an office that has no point of its own, for the geocoder being used: one it has already answered is spared
    const questions = [];
    for (const firm of checked.institutions) {
      for (const office of firm.offices) {
        if (Number.isFinite(office.lat) && Number.isFinite(office.lng)) continue;
        const q = questionFor({ address: office.address, city: office.city, state: office.state });
        if (q?.kind === 'address' && !questions.some((x) => x.query === q.query)) questions.push({ name: firm.name, query: q.query });
      }
    }
    let asked = 0; let spared = 0;
    for (const p of questions) {
      if (lookup(cache, provider, p.query, now())) { spared += 1; continue; }
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
