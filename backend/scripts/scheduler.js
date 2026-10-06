// The scheduler's command line. See docs/scheduler.md.
//
//   npm run scheduler -- status [--json]
//   npm run scheduler -- plan   [--job a,b] [--max-sites n]            what is due, reading and writing nothing
//   npm run scheduler -- tick   [--job a,b] [limits] [--mode suggest|fill] [--force] [--dry-run] [--by name]
//   npm run scheduler -- run <job> [limits] [--mode ...]               one job now, whatever its clock says
//   npm run scheduler -- loop   [--every minutes] [--max-ticks n] [tick flags]
//   npm run scheduler -- runs   [--job j] [--status s] [--limit n]     the run log
//   npm run scheduler -- reset <company> [--facet f]                   make a company due again now
//   npm run scheduler -- learn                                         set the clocks from the queue's history (no network)
//
//   limits: --max-sites n (companies read per run, 40)  --max-requests n (300)  --max-minutes n (20)  --concurrency n (2)
//   jobs:   discovery, funding, hiring, status, enrichment, quality
//
// Add --data <dir> to work on a copy of the data files. A tick reads other people's websites politely (robots.txt,
// pacing, Retry-After, a request budget) and writes evidence, never a company: the default mode is 'suggest'.
// --mode fill lets it fill only what the enrichment policy allows (src/enrichment/policy.js).
// Exit code: 0 ok, 2 if a job failed, 1 on a usage or data error.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshot, transact } from '../src/models/store.js';
import { JOBS } from '../src/models/jobRuns.js';
import { MODES } from '../src/enrichment/policy.js';
import { buildSourceConfig } from '../src/discovery/config.js';
import { COMPANY_FACETS } from '../src/scheduler/cadence.js';
import { tick, plan } from '../src/scheduler/scheduler.js';
import { schedulerStatus } from '../src/scheduler/status.js';
import { reconcileFromQueue } from '../src/scheduler/state.js';

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

function jobsFrom(flags, positional) {
  const raw = positional[0] && !String(positional[0]).startsWith('-') ? positional[0] : flags.job;
  if (raw === undefined) return JOBS;
  const list = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = list.filter((j) => !JOBS.includes(j));
  if (unknown.length) throw new Error(`unknown job ${unknown.map((j) => `"${j}"`).join(', ')}: the jobs are ${JOBS.join(', ')}`);
  return list;
}

const limitsFrom = (flags) => Object.fromEntries(Object.entries({
  maxSites: whole(flags, 'max-sites'), maxRequests: whole(flags, 'max-requests'), maxMinutes: whole(flags, 'max-minutes'), concurrency: whole(flags, 'concurrency'),
}).filter(([, v]) => v !== undefined));

const ago = (iso, at) => {
  if (!iso) return 'never';
  const mins = Math.round((Date.parse(at) - Date.parse(iso)) / 60000);
  if (mins < 90) return `${Math.max(mins, 0)} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
};
const until = (iso, at) => {
  if (!iso) return 'now';
  const mins = Math.round((Date.parse(iso) - Date.parse(at)) / 60000);
  if (mins <= 0) return 'now';
  if (mins < 90) return `in ${mins} min`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `in ${hours} h` : `in ${Math.round(hours / 24)} d`;
};

function renderRuns(rows) {
  return rows.map((r) => `${r.started_at.slice(0, 16).replace('T', ' ')}  ${r.job.padEnd(10)} ${r.status.padEnd(8)} due ${String(r.due).padStart(3)}  read ${String(r.processed).padStart(3)}  new ${String(r.changed).padStart(3)}  failed ${String(r.failed).padStart(2)}  ${r.summary}${r.error ? `  [${r.error}]` : ''}`).join('\n');
}

function renderStatus(s) {
  const lines = [`Scheduler status at ${s.at}`, ''];
  lines.push('Job         last run                 result    next due     due now');
  for (const j of s.jobs) {
    const run = j.last_run;
    lines.push(`${j.job.padEnd(11)} ${(run ? `${ago(run.started_at, s.at)}` : 'never').padEnd(24)} ${(run?.status ?? '-').padEnd(9)} ${until(j.next_due, s.at).padEnd(12)} ${j.due_now}`);
  }
  lines.push('', 'Company facets (each is read from the company\'s own pages at its own pace)');
  for (const [name, f] of Object.entries(s.facets)) {
    lines.push(`  ${name.padEnd(13)} every ${String(f.every_days).padStart(3)} d  ${String(f.checked).padStart(4)} checked, ${String(f.never_checked).padStart(4)} never, ${String(f.due_now).padStart(4)} due now${f.failing ? `, ${f.failing} failing` : ''}`);
  }
  if (s.sources.length) {
    lines.push('', 'Sources');
    for (const src of s.sources) {
      const f = src.funding; const d = src.discovery;
      lines.push(`  ${src.id}: discovery ${d ? `read ${ago(d.last_checked_at, s.at)}, next ${until(d.next_check_at, s.at)}${d.failures ? `, ${d.failures} failure(s): ${d.last_error}` : ''}` : 'not read yet'}${f ? `; funding read ${ago(f.last_checked_at, s.at)}, next ${until(f.next_check_at, s.at)}` : ''}`);
    }
  }
  if (s.hosts.length) lines.push('', `Websites that asked us to slow down: ${s.hosts.map((h) => `${h.host} (until ${h.until.slice(0, 16).replace('T', ' ')})`).join(', ')}`);
  if (s.watch.length) lines.push('', `Status watch (${s.watch.length}): ${s.watch.slice(0, 8).map((w) => `${w.company_id} [${w.signals.map((x) => x.code).join(', ')}]`).join('; ')}`);
  lines.push('', `Queue: ${s.queue.total} task(s), ${s.queue.ready} ready, ${s.queue.backing_off} backing off. ${s.totals.state_rows} clock row(s), ${s.totals.runs} run(s) logged.`);
  return lines.join('\n');
}

function renderPlan(p) {
  const lines = [`Due at ${p.at} (nothing was read or written)`];
  if (p.feeds.funding) lines.push(`  funding     ${p.feeds.funding.summary}`);
  if (p.feeds.discovery) lines.push(`  discovery   ${p.feeds.discovery.summary}`);
  if (p.reads) {
    const by = Object.entries(p.reads.dueByFacet).map(([f, n]) => `${f} ${n}`).join(', ') || 'nothing';
    lines.push(`  company sites: ${p.reads.due} compan${p.reads.due === 1 ? 'y' : 'ies'} due (${by}); a run would read ${p.reads.planned}${p.reads.deferred ? ` and leave ${p.reads.deferred}` : ''}; ${p.reads.never} never checked; ${p.reads.skipped.no_website} have no website, ${p.reads.skipped.cooling} are on a website that asked us to slow down`);
    for (const t of p.reads.tasks.slice(0, 12)) lines.push(`      ${t.company_id}: ${t.facets.join(', ')}`);
    if (p.reads.tasks.length > 12) lines.push(`      ... and ${p.reads.tasks.length - 12} more`);
  }
  if (p.quality) lines.push(`  quality     ${p.quality.summary}`);
  return lines.join('\n');
}

// deps lets a test supply a data directory, an output sink, a clock, a fetcher and sources.
export async function main(argv, deps = {}) {
  const { dataDir = DEFAULT_DATA_DIR, out = (s) => console.log(s), env = process.env, now = Date.now } = deps;
  const { positional: [command, ...args], flags } = parseArgs(argv);
  const dir = typeof flags.data === 'string' ? path.resolve(flags.data) : dataDir;
  const at = new Date(now()).toISOString();

  if (!command || command === 'help') { out('Commands: status, plan, tick, run, loop, runs, reset, learn. See scripts/scheduler.js and docs/scheduler.md.'); return 0; }

  const common = () => {
    const mode = typeof flags.mode === 'string' ? flags.mode : env.SCHEDULER_MODE || 'suggest';
    if (!MODES.includes(mode)) throw new Error(`--mode must be one of ${MODES.join(', ')}`);
    return {
      dir, now, env, mode, limits: limitsFrom(flags), fetcher: deps.fetcher ?? null, sources: deps.sources ?? null, sourceConfig: deps.sourceConfig ?? null, fetchImpl: deps.fetchImpl,
      by: typeof flags.by === 'string' ? flags.by : 'scheduler', trigger: typeof flags.trigger === 'string' ? flags.trigger : 'cli',
    };
  };
  const report = (result) => {
    out(renderRuns(result.runs));
    out(`\n${result.requests} request(s)${result.stopped_for ? `; stopped early: the ${result.stopped_for} limit was reached, so what is left stays due` : ''}`);
    return result.status === 'failed' ? 2 : 0;
  };

  switch (command) {
    case 'status': {
      const { ds } = await snapshot(dir, { now });
      const configured = (deps.sourceConfig ?? buildSourceConfig(env)).filter((c) => c.enabled !== false);
      const status = schedulerStatus(ds, { at, sourceIds: configured.map((c) => c.id), fundingIds: configured.filter((c) => c.adapter === 'rss').map((c) => c.id) });
      out(flags.json ? JSON.stringify(status, null, 2) : renderStatus(status));
      return 0;
    }
    case 'plan': {
      const c = common();
      out(renderPlan(await plan({ ...c, jobs: jobsFrom(flags, []), force: Boolean(flags.force) })));
      return 0;
    }
    case 'tick':
    case 'run': {
      const c = common();
      const jobs = jobsFrom(flags, command === 'run' ? args : []);
      if (command === 'run' && !args.length && flags.job === undefined) throw new Error('run needs a job: ' + JOBS.join(', '));
      if (flags['dry-run']) { out(renderPlan(await plan({ ...c, jobs, force: command === 'run' || Boolean(flags.force) }))); return 0; }
      out(`running ${jobs.join(', ')} in ${c.mode} mode${c.mode === 'suggest' ? ' (evidence only: no company is changed)' : ''} ...`);
      return report(await tick({ ...c, jobs, force: command === 'run' || Boolean(flags.force), out, shouldStop: deps.shouldStop }));
    }
    case 'loop': {
      const c = common();
      const jobs = jobsFrom(flags, []);
      const every = whole(flags, 'every', 1) ?? 60;
      const maxTicks = whole(flags, 'max-ticks', 1) ?? Infinity;
      const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
      let stop = false;
      const halt = () => { stop = true; };
      if (!deps.sleep) { process.once('SIGINT', halt); process.once('SIGTERM', halt); }
      let code = 0;
      for (let n = 1; n <= maxTicks && !stop; n += 1) {
        out(`\n== tick ${n} ==`);
        code = Math.max(code, report(await tick({ ...c, jobs, trigger: 'loop', out, shouldStop: () => stop })));
        if (n < maxTicks && !stop) await sleep(every * 60000);
      }
      return code;
    }
    case 'learn': {
      // No network: only what the queue's finished tasks already say. A tick does this first anyway; this is for
      // seeing the clocks (`status`) before the first run, and it changes nothing when run twice.
      const { result } = await transact(dir, (work) => ({ result: reconcileFromQueue(work) }), { now });
      out(`learned from ${result.tasks} finished task(s): ${result.stamped} clock(s) set${result.gone ? `; ${result.gone} task(s) were for companies that are gone` : ''}`);
      return 0;
    }
    case 'runs': {
      const { ds } = await snapshot(dir, { now });
      let rows = [...ds.job_runs].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at) || b.id.localeCompare(a.id));
      if (typeof flags.job === 'string') rows = rows.filter((r) => r.job === flags.job);
      if (typeof flags.status === 'string') rows = rows.filter((r) => r.status === flags.status);
      out(rows.length ? renderRuns(rows.slice(0, whole(flags, 'limit') ?? 20)) : 'No runs logged yet.');
      return 0;
    }
    case 'reset': {
      const [id] = args;
      if (!id) throw new Error('reset needs a company id');
      const facets = typeof flags.facet === 'string' ? [flags.facet] : COMPANY_FACETS;
      const bad = facets.filter((f) => !COMPANY_FACETS.includes(f));
      if (bad.length) throw new Error(`unknown facet "${bad[0]}": the facets are ${COMPANY_FACETS.join(', ')}`);
      const { result } = await transact(dir, (work) => {
        if (!work.companies.some((c) => c.id === id)) throw new Error(`no company "${id}"`);
        let moved = 0;
        for (const r of work.refresh_state ?? []) if (r.scope === 'company' && r.target_id === id && facets.includes(r.facet) && r.next_check_at != null) { r.next_check_at = null; moved += 1; }
        return { result: moved };
      }, { now });
      out(`${id}: ${result} clock(s) set to due now (${facets.join(', ')}); a company never checked is due already`);
      return 0;
    }
    default: throw new Error(`unknown command "${command}"`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Below normal priority: a run beside a public site should lose any argument about the CPU.
  try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not allowed here: carry on */ }
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => { console.error(`error: ${err.message}`); process.exitCode = 1; });
}
