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
//   npm run discovery -- queue status
//   npm run discovery -- queue seed --by name [--limit n] [--force]
//   npm run discovery -- queue run --by name [--limit n] [--mode suggest|fill] [--concurrency n]
//   npm run discovery -- queue add <company> [<company> ...] --by name
//   npm run discovery -- queue retry <task> --by name
//   npm run discovery -- queue cancel <task> --by name
//
// Add --data <dir> to work on a copy of the data files. Every command that changes
// data migrates and validates the whole dataset first and writes nothing if any check
// fails. run never approves, merges (unless --apply-exact) or publishes anything.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRaw, parseRaw } from '../src/models/dataset.js';
import { withLock, commit } from '../src/models/store.js';
import { appendAudit } from '../src/models/auditTrail.js';
import { buildImportRun } from '../src/models/importRuns.js';
import { auditDataset } from '../src/models/audit.js';
import { seedFromAudit, queueSummary, latestTasks, requeueTask, cancelTask, enqueueTask, enqueueForApproved, enqueueForPublished, WANTABLE, PRIORITY } from '../src/models/enrichmentQueue.js';
import { runQueue } from '../src/enrichment/worker.js';
import { MODES } from '../src/enrichment/policy.js';
import { transact } from '../src/models/store.js';
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

  if (!command || command === 'help') { out('Commands: run, list, show, resolve, enrich, approve, reject, reopen, distinct, merge, publish, rename, queue. See scripts/discovery.js.'); return 0; }

  const raw = await loadRaw(dir);
  const ds = parseRaw(raw);
  const work = structuredClone(ds);

  // Migrate and validate everything, check nobody else wrote the files while this ran, and write
  // only the files that changed - together with the audit trail rows for what was done. If the
  // data changed underneath this command, nothing is written (store.js).
  async function save(audit = []) {
    await withLock(dir, async () => {
      if (audit.length) appendAudit(work, audit, new Date(now()).toISOString());
      const { changed } = await commit(dir, raw, work);
      out(`\nwrote ${changed.join(', ') || 'nothing (no change)'}`);
    });
  }
  const candidate = (id) => work.candidates.find((c) => c.id === id) ?? (() => { throw new Error(`no candidate "${id}"`); })();
  const by = () => need(flags, 'by', 'every decision is recorded with a name');
  // The audit trail row for a command: who, what, to what. The CLI is a trusted local door, so its role is 'cli'.
  const trail = (action, target, summary, extra = {}) => ({ actor: { name: by(), role: 'cli' }, via: 'cli', action, target, summary, ...extra });

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
      if (!flags['dry-run']) {
        // The run is recorded with what it found, so "did the imports work?" outlives the terminal.
        const finishedAt = new Date(now()).toISOString();
        const runner = typeof flags.by === 'string' ? flags.by : 'cli';
        work.import_runs ??= [];
        const row = buildImportRun(report, { runs: work.import_runs, startedAt: report.started_at, finishedAt, trigger: 'cli', by: runner });
        work.import_runs.push(row);
        const failed = row.sources.filter((s) => s.error).length;
        await save([{
          actor: { name: runner, role: 'cli' }, via: 'cli', action: 'import.run', target: { type: 'import_run', id: row.id },
          summary: `Ran discovery: ${row.totals.new} new candidate(s), ${row.totals.attached} attached, ${row.totals.seen} seen before${failed ? `, ${failed} source(s) failed` : ''}`,
        }]);
      }
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
      const shown = await engine.enrichCandidate(args[0], { website: typeof flags.website === 'string' ? flags.website : undefined, by: by() });
      out(renderCandidate(shown));
      await save([trail('candidate.enrich', { type: 'candidate', id: shown.id }, `Read the website of ${shown.name}`)]);
      return 0;
    }
    case 'approve': {
      const c = approveCandidate(work, args[0], { by: by(), note: flags.note === true ? null : flags.note ?? null, at });
      const queued = enqueueForApproved(work, c, { by: by(), at });
      out(`${c.id} approved${queued ? ' (its website is queued to be read before it is published)' : ''}`);
      await save([trail('candidate.approve', { type: 'candidate', id: c.id }, `Approved ${c.name}${queued ? '; website queued for reading' : ''}`, { reason: c.review?.note ?? null })]);
      return 0;
    }
    case 'reject': {
      const c = rejectCandidate(work, args[0], { by: by(), reason: flags.reason === true ? undefined : flags.reason, at });
      out(`${c.id} rejected`);
      await save([trail('candidate.reject', { type: 'candidate', id: c.id }, `Rejected ${c.name}`, { reason: c.review?.note ?? null })]);
      return 0;
    }
    case 'reopen': {
      const c = reopenCandidate(work, args[0], { by: by(), at });
      out(`${c.id} reopened`);
      await save([trail('candidate.reopen', { type: 'candidate', id: c.id }, `Reopened ${c.name} for review`)]);
      return 0;
    }
    case 'distinct': {
      const from = need(flags, 'from', 'the company or candidate it is not');
      const c = markDistinct(work, args[0], from, { by: by(), at, note: typeof flags.note === 'string' ? flags.note : null });
      out(`${c.id}: ${c.resolution}${c.matches.length ? ` - still ${c.matches.length} possible duplicate(s)` : ''}`);
      await save([trail('candidate.distinct', { type: 'candidate', id: c.id }, `Confirmed ${c.name} is not ${from}`, { reason: typeof flags.note === 'string' ? flags.note : null })]);
      return 0;
    }
    case 'merge': {
      const s = mergeCandidate(work, args[0], need(flags, 'into', 'the company it is'), { by: by(), at });
      out(`merged into ${s.company_id}: ${s.evidence} evidence, ${s.identifiers.length} identifier(s)${s.filled.length ? `, filled ${s.filled.join('; ')}` : ''}${s.held.length ? `\n  held: ${s.held.join('; ')}` : ''}`);
      await save([trail('candidate.merge', { type: 'candidate', id: args[0] }, `Merged ${args[0]} into ${s.company_id}`, { changes: s.filled.map((f) => ({ field: f.split(':')[0], from: null, to: f.slice(f.indexOf(':') + 2) })) })]);
      return 0;
    }
    case 'publish': {
      const location = flags.lat !== undefined || flags.lng !== undefined || flags.city !== undefined
        ? { city: flags.city, lat: num(flags, 'lat'), lng: num(flags, 'lng'), address: typeof flags.address === 'string' ? flags.address : undefined } : null;
      const { company } = publishCandidate(work, args[0], { by: by(), at, location });
      const queued = enqueueForPublished(work, company, { by: by(), at });
      out(`published as ${company.id}${company.verified ? ' (on the map)' : ' (location unconfirmed: not on the map; listed under Unconfirmed)'}${queued ? '; queued for enrichment' : ''}`);
      await save([trail('candidate.publish', { type: 'candidate', id: args[0] }, `Published ${company.name} as ${company.id}${company.verified ? ' (on the map)' : ' (unconfirmed location)'}${queued ? '; queued for enrichment' : ''}`)]);
      return 0;
    }
    case 'rename': {
      const s = renameCompany(work, args[0], need(flags, 'to', 'the new name'), { by: by(), at, reason: typeof flags.reason === 'string' ? flags.reason : null });
      out(`renamed ${s.from} -> ${s.to}${s.kept.length ? `\n  kept: ${s.kept.join('; ')}` : ''}`);
      await save([trail('company.rename', { type: 'company', id: s.company_id }, `Renamed ${s.from} to ${s.to}`, { reason: typeof flags.reason === 'string' ? flags.reason : null, changes: [{ field: 'name', from: s.from, to: s.to }] })]);
      return 0;
    }
    case 'queue': return queueCommand(args, { work, flags, at, save, trail, by, dir, out, deps, env, now });
    default: throw new Error(`unknown command "${command}"`);
  }
}

// The enrichment queue. `run` is not like the other commands: it reads websites for as long as that takes,
// so it never holds a copy of the data. Each task is claimed, read, and committed in its own transaction.
async function queueCommand([sub, ...rest], { work, flags, at, save, trail, by, dir, out, deps, env, now }) {
  const line = (t) => `${t.id}  ${t.status.padEnd(9)} p${String(t.priority).padEnd(5)} ${t.kind}:${t.target_id}${t.last_error ? `  - ${t.last_error}` : ''}`;
  switch (sub) {
    case 'status': {
      const s = queueSummary(work.enrichment_queue ?? [], at);
      out([`${s.total} task(s): ${Object.entries(s.counts).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ') || 'none'}`, `${s.ready} ready now, ${s.backing_off} backing off`].join('\n'));
      const attention = latestTasks(work.enrichment_queue ?? []).filter((t) => t.status === 'failed' || ['mismatch', 'blocked'].includes(t.result?.outcome));
      if (attention.length) out(`\nNeeds a look:\n${attention.map((t) => `  ${line(t)}${t.result?.outcome === 'mismatch' ? '  - the website does not look like this company' : t.result?.outcome === 'blocked' ? '  - the site served a page that was not its own content' : ''}`).join('\n')}`);
      return 0;
    }
    case 'seed': {
      const audit = auditDataset(work, { asOf: at.slice(0, 10) });
      const limit = flags.limit === undefined ? Infinity : Number(flags.limit);
      const r = seedFromAudit(work, audit, { at, by: by(), limit, force: Boolean(flags.force) });
      out(`queued ${r.queued} compan${r.queued === 1 ? 'y' : 'ies'} in the audit's order; ${r.no_website} have no website (recorded as skipped); ${r.fresh} checked recently; ${r.already_queued} already waiting${r.limited ? `; ${r.limited} left for a later seed (limit)` : ''}`);
      await save([trail('enrichment.seed', { type: 'queue', id: 'enrichment' }, `Queued ${r.queued} compan${r.queued === 1 ? 'y' : 'ies'} for enrichment (${r.no_website} without a website, ${r.fresh} checked recently)`)]);
      return 0;
    }
    case 'run': {
      const mode = typeof flags.mode === 'string' ? flags.mode : 'suggest';
      if (!MODES.includes(mode)) throw new Error(`--mode must be one of ${MODES.join(', ')}`);
      const runner = by();
      const fetcher = deps.fetcher ?? createFetcher({ userAgent: env.DISCOVERY_USER_AGENT || DEFAULT_USER_AGENT });
      const limit = flags.limit === undefined ? Infinity : Number(flags.limit);
      out(`reading websites in ${mode} mode${mode === 'suggest' ? ' (evidence only: no company is changed)' : ''} ...`);
      const stats = await runQueue({
        dir, fetcher, now, limit, mode, by: 'enrichment', concurrency: flags.concurrency === undefined ? 3 : Number(flags.concurrency),
        onEvent: (e) => { if (e.type !== 'start') out(`${e.type.padEnd(7)} ${e.task.target_id}${e.error ? `  ${e.error}` : e.task.last_error && e.type === 'skipped' ? `  ${e.task.last_error}` : ''}`); },
      });
      await transact(dir, () => ({ audit: [trail('enrichment.run', { type: 'queue', id: 'enrichment' }, `Ran the enrichment queue in ${mode} mode: ${stats.done} read, ${stats.skipped} skipped, ${stats.failed} failed, ${stats.retried} to retry; ${stats.evidence_added} evidence added${stats.applied ? `, ${stats.applied} field(s) filled` : ''}`)] }), { now });
      out(`\n${stats.claimed} task(s): ${stats.done} read, ${stats.skipped} skipped, ${stats.failed} failed, ${stats.retried} to retry. ${stats.evidence_added} evidence added${stats.applied ? `, ${stats.applied} field(s) filled` : ''}.`);
      return stats.failed ? 2 : 0;
    }
    case 'add': {
      if (!rest.length) throw new Error('queue add needs one or more company ids');
      const added = rest.map((id) => {
        const company = work.companies.find((c) => c.id === id);
        if (!company) throw new Error(`no company "${id}"`);
        if (!company.website) throw new Error(`${company.name} has no website to read`);
        return enqueueTask(work, { kind: 'company', targetId: id, priority: PRIORITY.manual, reason: 'manual', wanted: WANTABLE, by: by(), at }).task;
      });
      out(`queued ${added.map((t) => t.target_id).join(', ')}`);
      await save(added.map((t) => trail('enrichment.enqueue', { type: 'queue', id: t.id }, `Queued ${t.target_id} to have its website read`)));
      return 0;
    }
    case 'retry': { const t = requeueTask(work, rest[0], { at }); out(`${t.id} queued again`); await save([trail('enrichment.retry', { type: 'queue', id: t.id }, `Retried ${t.kind} ${t.target_id}`)]); return 0; }
    case 'cancel': { const t = cancelTask(work, rest[0], { at }); out(`${t.id} cancelled`); await save([trail('enrichment.cancel', { type: 'queue', id: t.id }, `Cancelled ${t.kind} ${t.target_id}`)]); return 0; }
    default: throw new Error('queue needs one of: status, seed, add, run, retry, cancel');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => { console.error(`error: ${err.message}`); process.exitCode = 1; });
}
