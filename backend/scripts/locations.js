// The location system's command line. See docs/locations.md.
//
//   npm run locations -- status  [--json]                  how well companies' locations are known, and what to look at
//   npm run locations -- review  [--issue code] [--limit n] [--json]      the review queue, worst first
//   npm run locations -- geocode [--company id] [--limit n] [--apply]      ask the geocoder about addresses (answers are
//                                                          kept, so an address is asked once); --apply puts good answers on the records
//   npm run locations -- verify    [--apply]               attach the page that states an address to a location with no source
//   npm run locations -- promote   [--company id] [--apply]   give a city-level company the street address its own website
//                                                          states, once the geocoder has put that address on the map (geocode first)
//   npm run locations -- normalize [--apply]               take the coordinates off city- and state-level companies
//   npm run locations -- places                            check the city-centre reference points against the geocoder
//   npm run locations -- set <company> --city X [--suburb S] [--address A] [--state NSW] [--postcode 2000]
//                         [--lat n --lng n] [--precision EXACT|SUBURB|CITY|STATE] [--source kind] [--source-url url] --reason why
//                                                          record a place by hand
//
// verify, promote and normalize show what they would do and write nothing unless told to --apply. Add --data <dir> to work on a
// copy of the data files. The geocoder is OpenStreetMap's Nominatim: one request a second, a user agent that names this
// site, answers kept in geocode_cache.json (see src/geo/geocode.js). Exit code: 0 ok, 2 if the geocoder told the run
// to stop, 1 on a usage or data error.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshot, transact } from '../src/models/store.js';
import { reviewLocations, LOCATION_ISSUES } from '../src/models/locationAudit.js';
import { createGeocoder, geocodeCached, mergeCache, PROVIDER } from '../src/geo/geocode.js';
import { geocodeTargets, applyGeocodes, applyPromotions, verifyFromEvidence, clearAreaCoordinates } from '../src/geo/locate.js';
import { lookup } from '../src/models/geocodeCache.js';
import { confirmLocation } from '../src/enrichment/fill.js';
import { diffChanges } from '../src/models/auditTrail.js';
import { CITIES, STATES, distanceMetres } from '../src/geo/places.js';
import { PRECISIONS } from '../src/models/location.js';

const DEFAULT_DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data');

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    const value = next === undefined || next.startsWith('--') ? true : (i += 1, next);
    flags[key] = key in flags ? [].concat(flags[key], value) : value;
  }
  return { positional, flags };
}

const whole = (flags, name, min = 1) => {
  if (flags[name] === undefined) return undefined;
  const n = Number(flags[name]);
  if (!Number.isFinite(n) || n < min) throw new Error(`--${name} must be a number (at least ${min})`);
  return n;
};
const text = (flags, name) => (typeof flags[name] === 'string' ? flags[name] : undefined);
const pad = (n, w = 4) => String(n).padStart(w);

function renderStatus(r, cache) {
  const p = r.precision;
  const lines = [`Locations at ${r.asOf}: ${r.total} companies`, '',
    `  Exact locations:       ${pad(p.EXACT)}`, `  Suburb locations:      ${pad(p.SUBURB)}`, `  City-only locations:   ${pad(p.CITY)}`,
    `  State-only locations:  ${pad(p.STATE)}`, `  Unknown locations:     ${pad(p.UNKNOWN)}`, '',
    'Flags',
    `  Duplicate coordinates:                  ${pad(r.flags.duplicate_coordinates)}  (a pin shared with a company at a different address)`,
    `  City-centroid coordinates:              ${pad(r.flags.city_centroid_coordinates)}  (coordinates that are a city centre, not a company)`,
    `  Location conflicts:                     ${pad(r.flags.location_conflicts)}  (the point is not where the record, or the geocoder, says)`,
    `  Missing coordinates:                    ${pad(r.flags.missing_coordinates)}  (a point is expected and there is none)`,
    `  Potentially stale locations:            ${pad(r.flags.potentially_stale)}  (last checked over a year ago, or the company has closed or been acquired)`,
    `  Addresses not checked against a source: ${pad(r.flags.unverified_addresses)}`, ''];
  const found = cache.filter((x) => x.status === 'found').length;
  lines.push(`Review queue: ${r.rows.length} companies`);
  for (const [code, spec] of Object.entries(r.issues)) if (spec.count) lines.push(`  ${pad(spec.count)}  ${spec.label} (${spec.severity}) [${code}]`);
  lines.push('', `Geocode cache: ${cache.length} answer(s), ${found} found, ${cache.filter((x) => x.status === 'none').length} with nothing found`);
  return lines.join('\n');
}

function renderRows(rows, limit) {
  return rows.slice(0, limit).map((r) => `${r.name.padEnd(28)} ${r.precision.padEnd(8)} ${String(r.city ?? '-').padEnd(16)} ${r.issues.map((i) => i.code).join(', ')}`).join('\n');
}

const entry = (by, action, company, summary, extra = {}) => ({ actor: { name: by, role: 'cli' }, via: 'cli', action, target: { type: 'company', id: company.company_id ?? company.id }, summary, ...extra });

// deps lets a test supply a data directory, an output sink, a clock, and a geocoder (or the pieces of one).
export async function main(argv, deps = {}) {
  const { dataDir = DEFAULT_DATA_DIR, out = (s) => console.log(s), now = Date.now } = deps;
  const { positional: [command, ...args], flags } = parseArgs(argv);
  const dir = typeof flags.data === 'string' ? path.resolve(flags.data) : dataDir;
  const at = new Date(now()).toISOString();
  const by = text(flags, 'by') ?? 'locations';
  const apply = Boolean(flags.apply);

  if (!command || command === 'help') { out('Commands: status, review, geocode, verify, promote, normalize, places, set. See scripts/locations.js and docs/locations.md.'); return 0; }

  const geocoder = () => deps.geocoder ?? createGeocoder({ fetchImpl: deps.fetchImpl, now, sleep: deps.sleep });
  const show = (label, results, shown = 12) => {
    out(`${label}: ${results.length} compan${results.length === 1 ? 'y' : 'ies'}`);
    for (const r of results.slice(0, shown)) out(`  ${r.name}: ${r.changes.map((c) => `${c.field} ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`).join('; ')}`);
    if (results.length > shown) out(`  ... and ${results.length - shown} more`);
  };

  switch (command) {
    case 'status': {
      const { ds } = await snapshot(dir, { now });
      const r = reviewLocations(ds, { asOf: at });
      out(flags.json ? JSON.stringify({ precision: r.precision, flags: r.flags, issues: r.issues, cache: ds.geocode_cache.length }, null, 2) : renderStatus(r, ds.geocode_cache));
      return 0;
    }
    case 'review': {
      const { ds } = await snapshot(dir, { now });
      const r = reviewLocations(ds, { asOf: at });
      const code = text(flags, 'issue');
      if (code && !LOCATION_ISSUES[code]) throw new Error(`unknown issue "${code}": the issues are ${Object.keys(LOCATION_ISSUES).join(', ')}`);
      const rows = code ? r.rows.filter((x) => x.issues.some((i) => i.code === code)) : r.rows;
      out(flags.json ? JSON.stringify(rows, null, 2) : (rows.length ? renderRows(rows, whole(flags, 'limit') ?? 40) : 'Nothing to review.'));
      return 0;
    }
    case 'geocode': {
      const { ds } = await snapshot(dir, { now });
      const company = text(flags, 'company');
      if (company && !ds.companies.some((c) => c.id === company)) throw new Error(`no company "${company}"`);
      const targets = geocodeTargets(ds, { company, candidates: true });
      const limit = whole(flags, 'limit') ?? Infinity;
      const gc = geocoder();
      const rows = structuredClone(ds.geocode_cache);
      let asked = 0; let spared = 0; let failed = 0; let stopped = null;
      for (const t of targets) {
        if (lookup(rows, PROVIDER, t.question.query, now())) { spared += 1; continue; }
        if (asked >= limit) break;
        asked += 1;
        const { row } = await geocodeCached(gc, rows, t.question.query, now());
        if (row.status === 'error') { failed += 1; out(`  ${t.company.name}: ${row.error}`); }
        if (gc.stopped) { stopped = gc.stopped; break; }
      }
      // The answers are kept either way. Only with --apply do they go on the records: otherwise what would happen is
      // worked out on a copy and reported.
      const { result } = await transact(dir, (work, ctx) => {
        work.geocode_cache = mergeCache(work.geocode_cache ?? [], rows);
        const results = applyGeocodes(apply ? work : structuredClone(work), { at: ctx.at, company });
        const audit = [];
        if (asked) audit.push({ actor: { name: by, role: 'cli' }, via: 'cli', action: 'location.geocode', target: { type: 'system', id: 'geocoder' }, summary: `Asked the geocoder about ${asked} address(es), ${spared} answered from the cache${stopped ? `; stopped: ${stopped}` : ''}` });
        if (apply) for (const r of results.filter((x) => x.changes.length)) audit.push(entry(by, 'location.geocode', r, `Put the geocoder's point on ${r.name} (${r.kind}, ${r.away == null ? 'new' : `${r.away} m from the old one`})`, { changes: r.changes }));
        return { result: { results }, audit };
      }, { now });
      const results = result.results;
      const count = (a) => results.filter((r) => r.action === a).length;
      out(`${targets.length} compan${targets.length === 1 ? 'y' : 'ies'} with an address to check: ${asked} asked of the geocoder, ${spared} answered from the cache${failed ? `, ${failed} failed` : ''}${stopped ? `; stopped early: ${stopped}` : ''}`);
      out(`  agrees with the point on file: ${count('agrees') + count('confirm')}   point to place: ${count('place')}   conflicts: ${count('conflict')}   not settled: ${count('skip') + count('unasked')}`);
      if (apply) show('Changed', results.filter((r) => r.changes.length));
      else out(`(nothing on a record was changed; add --apply to put the ${count('confirm') + count('place')} good answer(s) on the records)`);
      for (const r of results.filter((x) => x.action === 'conflict')) out(`  CONFLICT ${r.name}: ${r.reason}`);
      for (const r of results.filter((x) => x.action === 'skip').slice(0, 15)) out(`  not settled ${r.name}: ${r.reason}`);
      return stopped ? 2 : 0;
    }
    case 'verify':
    case 'normalize': {
      const run = command === 'verify' ? verifyFromEvidence : clearAreaCoordinates;
      const action = command === 'verify' ? 'location.verify' : 'location.normalize';
      const summarize = command === 'verify' ? (r) => `Recorded where ${r.name}'s address was found (${r.source})` : (r) => `Cleared the coordinates of ${r.name}: it is only known to its ${'city or state'}, and a city centre is not where it is`;
      if (!apply) {
        const { ds } = await snapshot(dir, { now });
        show(command === 'verify' ? 'Would record a source for' : 'Would clear the coordinates of', run(structuredClone(ds), { at }));
        out('(nothing was changed; add --apply)');
        return 0;
      }
      const { result } = await transact(dir, (work, ctx) => {
        const results = run(work, { at: ctx.at });
        return { result: results, audit: results.map((r) => entry(by, action, r, summarize(r), { changes: r.changes })) };
      }, { now });
      show(command === 'verify' ? 'Recorded a source for' : 'Cleared the coordinates of', result);
      return 0;
    }
    case 'promote': {
      const company = text(flags, 'company');
      const summarize = (r) => `Gave ${r.name} the address its own ${r.source === 'company_document' ? 'document' : 'website'} states (${r.address.slice(0, 90)}), at the point the geocoder puts it`;
      let results;
      if (!apply) {
        const { ds } = await snapshot(dir, { now });
        if (company && !ds.companies.some((c) => c.id === company)) throw new Error(`no company "${company}"`);
        results = applyPromotions(structuredClone(ds), { at, company });
      } else {
        ({ result: results } = await transact(dir, (work, ctx) => {
          if (company && !work.companies.some((c) => c.id === company)) throw new Error(`no company "${company}"`);
          const done = applyPromotions(work, { at: ctx.at, company });
          return { result: done, audit: done.filter((r) => r.action === 'promoted').map((r) => entry(by, 'location.promote', r, summarize(r), { changes: r.changes })) };
        }, { now }));
      }
      const promoted = results.filter((r) => r.action === 'promoted');
      out(`${apply ? 'Promoted' : 'Would promote'}: ${promoted.length} compan${promoted.length === 1 ? 'y' : 'ies'}`);
      for (const r of promoted) out(`  ${r.name}: ${r.address} (${r.source})`);
      for (const r of results.filter((x) => x.action !== 'promoted')) out(`  not promoted ${r.name}: ${r.reason ?? (r.action === 'unasked' ? 'the geocoder has not been asked: run `geocode` first' : r.action)}`);
      if (!apply && promoted.length) out('(nothing was changed; add --apply)');
      return 0;
    }
    case 'places': {
      const { ds } = await snapshot(dir, { now });
      const gc = geocoder();
      const rows = structuredClone(ds.geocode_cache);
      let stopped = null;
      const lines = [];
      for (const city of CITIES) {
        const query = `${city.name}, ${STATES[city.state].name}, Australia`;
        const { row } = await geocodeCached(gc, rows, query, now());
        if (row.status !== 'found') { lines.push(`${city.name.padEnd(16)} ${row.status === 'none' ? 'not found by the geocoder' : row.error}`); if (gc.stopped) { stopped = gc.stopped; break; } continue; }
        const km = distanceMetres(city.lat, city.lng, row.result.lat, row.result.lng) / 1000;
        lines.push(`${city.name.padEnd(16)} ${km.toFixed(1).padStart(6)} km from the geocoder's centre${km > 3 ? '   <-- check this point in src/geo/places.js' : ''}`);
      }
      await transact(dir, (work) => { work.geocode_cache = mergeCache(work.geocode_cache ?? [], rows); return { result: null }; }, { now });
      out(lines.join('\n'));
      return stopped ? 2 : 0;
    }
    case 'set': {
      const [id] = args;
      if (!id) throw new Error('set needs a company id');
      const reason = text(flags, 'reason');
      if (!reason || reason.trim().length < 3) throw new Error('say why, with --reason');
      const precision = text(flags, 'precision')?.toUpperCase();
      if (precision && !PRECISIONS.includes(precision)) throw new Error(`--precision must be one of ${PRECISIONS.join(', ')}`);
      const num = (name) => { const v = text(flags, name); if (v === undefined) return null; const n = Number(v); if (!Number.isFinite(n)) throw new Error(`--${name} must be a number`); return n; };
      const { result } = await transact(dir, (work, ctx) => {
        const company = work.companies.find((c) => c.id === id);
        if (!company) throw new Error(`no company "${id}"`);
        const before = structuredClone(company);
        const changes = confirmLocation(company, {
          city: text(flags, 'city'), suburb: text(flags, 'suburb'), address: text(flags, 'address'), state: text(flags, 'state'), postcode: text(flags, 'postcode'),
          lat: num('lat'), lng: num('lng'), precision: precision ?? null, ...(text(flags, 'source') ? { source: text(flags, 'source') } : {}), sourceUrl: text(flags, 'source-url') ?? null,
        }, { at: ctx.at });
        if (changes.length) company.updated_at = ctx.at;
        return { result: { name: company.name, changes, precision: company.location_precision }, audit: [entry(by, 'location.set', company, `Set ${company.name}'s location (${company.location_precision})`, { reason, changes: diffChanges(before, company, changes.map((c) => c.field)) })] };
      }, { now });
      out(`${result.name}: ${result.precision}${result.changes.length ? `, changed ${result.changes.map((c) => c.field).join(', ')}` : ' (nothing changed)'}`);
      return 0;
    }
    default: throw new Error(`unknown command "${command}"`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not allowed here: carry on */ }
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => { console.error(`error: ${err.message}`); process.exitCode = 1; });
}
