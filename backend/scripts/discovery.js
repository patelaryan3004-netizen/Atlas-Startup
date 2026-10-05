// The discovery engine's command line. See docs/discovery.md.
//
//   npm run discovery -- run [--source ids] [--no-enrich] [--apply-exact] [--dry-run]
//   npm run discovery -- list [--status s] [--outcome o] [--limit n]
//   npm run discovery -- show <candidate>
//   npm run discovery -- resolve --name "Leonardo.Ai" [--website url] [--city c] [--founder "A B"]
//   npm run discovery -- enrich <candidate> [--website url] --by name
//   npm run discovery -- approve <candidate> --by name [--note text]
//   npm run discovery -- reject <candidate> --by name --reason text
//   npm run discovery -- reopen <candidate> --by name
//   npm run discovery -- distinct <candidate> --from <company-or-candidate> --by name [--note text]
//   npm run discovery -- merge <candidate> --into <company> --by name
//   npm run discovery -- publish <candidate> --by name [--city c --lat n --lng n --address a]
//   npm run discovery -- rename <company> --to "New Name" --by name [--reason text]
//
// Add --data <dir> to work on a copy of the data files. Every command that changes
// data migrates and validates the whole dataset first and writes nothing if any check
// fails. run never approves, merges (unless --apply-exact) or publishes anything.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRaw, parseRaw, serializeDataset, migrateDataset, validateDataset, writeFiles } from '../src/models/dataset.js';
import { createFetcher, DEFAULT_USER_AGENT } from '../src/discovery/http.js';
import { loadSources } from '../src/discovery/sources/index.js';
import { buildSourceConfig } from '../src/discovery/config.js';
import { createEngine } from '../src/discovery/pipeline.js';
import { buildIndex, identityOfLead, resolveLead, describeMatch } from '../src/discovery/resolve.js';
import { approveCandidate, rejectCandidate, reopenCandidate, markDistinct, mergeCandidate, renameCompany } from '../src/discovery/review.js';
import { publishCandidate } from '../src/discovery/publish.js';
import { renderRunReport, renderQueue, renderCandidate } from '../src/discovery/report.js';

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

const need = (flags, name, why) => {
  if (typeof flags[name] !== 'string' || !flags[name].trim()) throw new Error(`--${name} is required${why ? `: ${why}` : ''}`);
  return flags[name];
};
const num = (flags, name) => (flags[name] === undefined ? undefined : Number(flags[name]));

// deps lets a test supply a data directory, an output sink, a fetcher and sources.
export async function main(argv, deps = {}) {
  const { dataDir = DEFAULT_DATA_DIR, out = (s) => console.log(s), env = process.env, now = Date.now } = deps;
  const { positional: [command, ...args], flags } = parseArgs(argv);
  const dir = typeof flags.data === 'string' ? path.resolve(flags.data) : dataDir;
  const at = new Date(now()).toISOString();

  if (!command || command === 'help') { out('Commands: run, list, show, resolve, enrich, approve, reject, reopen, distinct, merge, publish, rename. See scripts/discovery.js.'); return 0; }

  const raw = await loadRaw(dir);
  const ds = parseRaw(raw);
  const work = structuredClone(ds);

  // Migrate and validate everything, then write only the files that changed.
  async function save() {
    const migrated = migrateDataset(work);
    const errors = validateDataset(migrated);
    if (errors.length) throw new Error(`nothing was written: ${errors.length} problem(s)\n${errors.slice(0, 10).map((e) => `  - ${e}`).join('\n')}`);
    const files = serializeDataset(migrated);
    const changed = Object.fromEntries(Object.entries(files).filter(([file, text]) => raw[file] !== text));
    await writeFiles(dir, changed);
    out(`\nwrote ${Object.keys(changed).join(', ') || 'nothing (no change)'}`);
  }
  const candidate = (id) => work.candidates.find((c) => c.id === id) ?? (() => { throw new Error(`no candidate "${id}"`); })();
  const by = () => need(flags, 'by', 'every decision is recorded with a name');

  switch (command) {
    case 'run': {
      const only = typeof flags.source === 'string' ? flags.source.split(',') : null;
      const { sources, skipped } = loadSources(deps.sourceConfig ?? buildSourceConfig(env), { env, only });
      const fetcher = deps.fetcher ?? createFetcher({ userAgent: env.DISCOVERY_USER_AGENT || DEFAULT_USER_AGENT });
      const engine = createEngine({ work, fetcher, now, fetchImpl: deps.fetchImpl, options: { enrich: !flags['no-enrich'], applyExact: Boolean(flags['apply-exact']) } });
      const report = await engine.run(deps.sources ?? sources);
      report.requests = fetcher.log.requests.length;
      report.refused = fetcher.log.refused;
      out(renderRunReport(report, { skippedSources: skipped, dryRun: Boolean(flags['dry-run']) }));
      if (!flags['dry-run']) await save();
      return report.sources.some((s) => s.error) ? 2 : 0;
    }
    case 'list': {
      let list = work.candidates;
      if (typeof flags.status === 'string') list = list.filter((c) => c.status === flags.status);
      if (typeof flags.outcome === 'string') list = list.filter((c) => c.resolution === flags.outcome);
      list = [...list].sort((a, b) => (b.confidence?.score ?? 0) - (a.confidence?.score ?? 0));
      out(renderQueue(list.slice(0, num(flags, 'limit') ?? 50)));
      return 0;
    }
    case 'show': out(renderCandidate(candidate(args[0]))); return 0;
    case 'resolve': {
      const lead = {
        name: need(flags, 'name'), website: flags.website, city: flags.city, state: flags.state,
        founders: [].concat(flags.founder ?? []).filter((f) => typeof f === 'string'),
        external_ids: { abn: flags.abn, acn: flags.acn },
      };
      const r = resolveLead(identityOfLead(lead), buildIndex(work));
      out(r.matches.length ? [`${r.outcome}`, ...r.matches.map((m) => `  ${describeMatch(m)}`)].join('\n') : `${r.outcome}: nothing resembles "${lead.name}".`);
      return 0;
    }
    case 'enrich': {
      const fetcher = deps.fetcher ?? createFetcher({ userAgent: env.DISCOVERY_USER_AGENT || DEFAULT_USER_AGENT });
      const engine = createEngine({ work, fetcher, now, fetchImpl: deps.fetchImpl });
      out(renderCandidate(await engine.enrichCandidate(args[0], { website: typeof flags.website === 'string' ? flags.website : undefined, by: by() })));
      await save();
      return 0;
    }
    case 'approve': out(`${approveCandidate(work, args[0], { by: by(), note: flags.note === true ? null : flags.note ?? null, at }).id} approved`); await save(); return 0;
    case 'reject': out(`${rejectCandidate(work, args[0], { by: by(), reason: flags.reason === true ? undefined : flags.reason, at }).id} rejected`); await save(); return 0;
    case 'reopen': out(`${reopenCandidate(work, args[0], { by: by(), at }).id} reopened`); await save(); return 0;
    case 'distinct': {
      const c = markDistinct(work, args[0], need(flags, 'from', 'the company or candidate it is not'), { by: by(), at, note: typeof flags.note === 'string' ? flags.note : null });
      out(`${c.id}: ${c.resolution}${c.matches.length ? ` - still ${c.matches.length} possible duplicate(s)` : ''}`);
      await save();
      return 0;
    }
    case 'merge': {
      const s = mergeCandidate(work, args[0], need(flags, 'into', 'the company it is'), { by: by(), at });
      out(`merged into ${s.company_id}: ${s.evidence} evidence, ${s.identifiers.length} identifier(s)${s.filled.length ? `, filled ${s.filled.join('; ')}` : ''}${s.held.length ? `\n  held: ${s.held.join('; ')}` : ''}`);
      await save();
      return 0;
    }
    case 'publish': {
      const location = flags.lat !== undefined || flags.lng !== undefined || flags.city !== undefined
        ? { city: flags.city, lat: num(flags, 'lat'), lng: num(flags, 'lng'), address: typeof flags.address === 'string' ? flags.address : undefined } : null;
      const { company } = publishCandidate(work, args[0], { by: by(), at, location });
      out(`published as ${company.id}${company.verified ? ' (on the map)' : ' (location unconfirmed: not on the map; listed under Unconfirmed)'}`);
      await save();
      return 0;
    }
    case 'rename': {
      const s = renameCompany(work, args[0], need(flags, 'to', 'the new name'), { by: by(), at, reason: typeof flags.reason === 'string' ? flags.reason : null });
      out(`renamed ${s.from} -> ${s.to}${s.kept.length ? `\n  kept: ${s.kept.join('; ')}` : ''}`);
      await save();
      return 0;
    }
    default: throw new Error(`unknown command "${command}"`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => { console.error(`error: ${err.message}`); process.exitCode = 1; });
}
