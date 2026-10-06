// One scheduler tick: look at what is due, do a bounded amount of it politely, and log every job's run.
//
//   jobs      discovery   find companies we do not have: feeds and submissions, into candidates for review
//             funding     stories that are plainly about companies we have, recorded as evidence
//             hiring      open roles and the hiring flag, from the careers page and the job board it links to
//             status      acquired, closed or renamed, from the homepage
//             enrichment  description, address, founders, investors and founded year, from the company's own pages
//             quality     what is stale, in conflict or failing; brings the right things forward to be looked at again
//
// The order of a tick:  1 note that the jobs started, and learn from any task that finished since last time
//                       2 read the feeds (discovery, funding)
//                       3 queue what is due on company sites, and work the queue within the run's limits
//                       4 move each company's clocks by what the reading found
//                       5 the quality pass       6 write each job's run and the audit trail
//
// Properties it keeps, and which the tests hold it to:
//   - idempotent     a second tick at the same moment does nothing but log that nothing was due; a tick that was
//                    cut short, or died, is finished by the next one, which neither repeats nor loses its work
//   - polite         one request per host every few seconds, robots.txt and Retry-After, a request budget per run,
//                    a wait that grows each time a host asks us to slow down, and nothing on a host that did
//   - out of the way it is its own process, below normal priority, never loaded by the public server, and it
//                    holds the data lock only for the moments it writes
//   - honest         every job leaves a row in the run log whatever happened, including "nothing was due"
import { snapshot, transact } from '../models/store.js';
import { indexState } from '../models/refreshState.js';
import { JOBS, closeInterrupted, finishJobRun, startJobRun, tickIdOf } from '../models/jobRuns.js';
import { runQueue } from '../enrichment/worker.js';
import { createFetcher } from '../discovery/http.js';
import { loadSources } from '../discovery/sources/index.js';
import { buildSourceConfig } from '../discovery/config.js';
import { CADENCE, COMPANY_FACETS } from './cadence.js';
import { createBudget, memoFetcher, DEFAULT_LIMITS } from './budget.js';
import { acquireTickLock } from './lock.js';
import { coolingHosts, reconcileFromQueue, recordHostCooldowns, stampCheck } from './state.js';
import { eligibleUnless, facetsForJobs, planSiteReads } from './plan.js';
import { runFeedJobs } from './jobs/feeds.js';
import { runQuality, qualitySummary } from './jobs/quality.js';

export { JOBS };
export const SITE_JOBS = ['hiring', 'status', 'enrichment'];
export const DEFAULT_USER_AGENT = 'AUStartupMapBot/1.0 (+https://au-startup-map.netlify.app/; scheduled refresh)';
const SYSTEM = (by) => ({ name: by, role: 'system' });
const iso = (ms) => new Date(ms).toISOString();
const facetsOf = (job) => COMPANY_FACETS.filter((f) => CADENCE.company[f].job === job);
const sum = (obj, keys) => keys.reduce((n, k) => n + (obj?.[k] ?? 0), 0);

// ---------- what is due, without doing any of it ----------

// Reads nothing and writes nothing. For `plan` and `tick --dry-run`.
export async function plan({ dir, sources = null, sourceConfig = null, env = process.env, now = Date.now, jobs = JOBS, limits = {}, force = false }) {
  const at = iso(now());
  const { ds } = await snapshot(dir, { now });
  const work = structuredClone(ds);
  reconcileFromQueue(work);
  const cooling = coolingHosts(work, at);
  const selected = jobs.filter((j) => JOBS.includes(j));
  const ctx = { at, jobs: new Set(selected), force, dryRun: true, sources: sources ?? loadSources(sourceConfig ?? buildSourceConfig(env), { env }).sources, runIds: {} };
  const feeds = await runFeedJobs(ctx, { snapshot: work });
  const siteJobs = selected.filter((j) => SITE_JOBS.includes(j));
  const maxSites = limits.maxSites ?? DEFAULT_LIMITS.maxSites;
  const reads = siteJobs.length ? planSiteReads(work, { at, limit: maxSites, facets: facetsForJobs(siteJobs), force, cooling }) : null;
  const quality = selected.includes('quality') ? runQuality(work, { at }) : null;
  return {
    at, jobs: selected, feeds, reads, quality: quality ? { summary: qualitySummary(quality), details: quality.details } : null, cooling: [...cooling],
  };
}

// ---------- one tick ----------

export async function tick({
  dir, fetcher = null, sources = null, sourceConfig = null, env = process.env, fetchImpl = undefined,
  now = Date.now, jobs = JOBS, mode = 'suggest', by = 'scheduler', trigger = 'cli', limits = {}, force = false,
  out = () => {}, shouldStop = () => false,
}) {
  const selected = JOBS.filter((j) => jobs.includes(j));
  const startedAt = iso(now());
  const tickId = tickIdOf(startedAt);
  const lockOpts = { now };

  const lock = await acquireTickLock(dir, { now });
  if (lock.held) return refused(dir, { selected, tickId, trigger, by, held: lock.held, lockOpts });

  try {
    // ---- 1. the jobs have started; learn from whatever finished since last time
    const begun = (await transact(dir, (work, { at }) => {
      work.job_runs ??= [];
      const interrupted = closeInterrupted(work.job_runs, { at, ownTickId: tickId });
      const runIds = {};
      for (const job of selected) runIds[job] = startJobRun(work.job_runs, { job, tickId, at, trigger, by, mode: SITE_JOBS.includes(job) ? mode : null }).id;
      const learned = reconcileFromQueue(work, { runIds });
      return { result: { runIds, interrupted, learned, cooling: [...coolingHosts(work, at)] } };
    }, lockOpts)).result;
    const { runIds } = begun;
    if (begun.interrupted.length) out(`marked ${begun.interrupted.length} earlier run(s) as interrupted`);

    const userAgent = env.SCHEDULER_USER_AGENT || DEFAULT_USER_AGENT;
    const base = fetcher ?? createFetcher({ userAgent, coolDownHosts: begun.cooling });
    const budget = createBudget({ ...limits, now });
    const wrapped = budget.wrap(base);
    const configs = sourceConfig ?? buildSourceConfig(env);
    const loaded = sources ? { sources, skipped: [] } : loadSources(configs, { env });
    const ctx = {
      dir, at: startedAt, now, by, mode, force, dryRun: false, jobs: new Set(selected), runIds, lock: lockOpts,
      fetcher: wrapped, memo: memoFetcher(wrapped), fetchImpl, sources: loaded.sources,
      refreshDays: Object.fromEntries(configs.filter((c) => c.refresh_days).map((c) => [c.id, c.refresh_days])),
    };
    const results = Object.fromEntries(selected.map((j) => [j, { due: 0, processed: 0, changed: 0, failed: 0, deferred: 0, requests: 0, summary: '', details: null, error: null }]));
    const phase = async (jobsInPhase, label, fn) => {
      try { await fn(); } catch (err) {
        out(`${label} failed: ${err.message}`);
        for (const job of jobsInPhase.filter((j) => selected.includes(j))) { results[job].error ??= err.message; results[job].failed ||= 1; results[job].summary ||= `${label} failed: ${err.message}`; }
      }
    };

    // ---- 2. the feeds
    await phase(['funding', 'discovery'], 'reading the feeds', async () => {
      if (!selected.includes('funding') && !selected.includes('discovery')) return;
      const { ds } = await snapshot(dir, lockOpts);
      const feeds = await runFeedJobs(ctx, { snapshot: ds });
      for (const job of ['funding', 'discovery']) if (feeds[job]) Object.assign(results[job], feeds[job]);
      if (loaded.skipped.length && results.discovery) results.discovery.details = { ...(results.discovery.details ?? {}), skipped_sources: loaded.skipped };
      for (const job of ['funding', 'discovery']) if (feeds[job]?.summary) out(`${job}: ${feeds[job].summary}`);
    });

    // ---- 3. company sites: queue what is due, work the queue within the limits
    const siteJobs = selected.filter((j) => SITE_JOBS.includes(j));
    let planned = null;
    let drained = null;
    const reqBeforeSites = base.log.requests.length;
    await phase(SITE_JOBS, 'reading company sites', async () => {
      if (!siteJobs.length) return;
      const cooling = new Set(begun.cooling);
      planned = (await transact(dir, (work, { at }) => ({ result: planSiteReads(work, { at, limit: budget.maxSites, facets: facetsForJobs(siteJobs), force, cooling, by }) }), lockOpts)).result;
      out(`sites: ${planned.due} company/companies due, ${planned.planned} queued${planned.deferred ? `, ${planned.deferred} left for the next run` : ''}`);
      if (!planned.tasks.length) return;
      drained = await runQueue({
        dir, fetcher: wrapped, now, mode, by, limit: budget.maxSites, concurrency: limits.concurrency ?? DEFAULT_LIMITS.concurrency, maxPages: 4,
        eligible: eligibleUnless(cooling), shouldStop: () => budget.shouldStop() || shouldStop(),
        onEvent: (e) => { if (e.type !== 'start') out(`  ${e.type.padEnd(7)} ${e.task.target_id}${e.error ? `  ${e.error}` : ''}`); },
      });
    });
    const siteRequests = base.log.requests.length - reqBeforeSites;

    // ---- 4. move the clocks by what was found, and remember which hosts asked us to slow down
    const counts = Object.fromEntries(SITE_JOBS.map((j) => [j, { read: 0, changed: 0, failed: 0, refused: 0, byFacet: {} }]));
    const watch = [];
    await phase(SITE_JOBS, 'updating the clocks', async () => {
      const used = new Set(base.log.requests.map((r) => { try { return new URL(r.url).hostname; } catch { return null; } }).filter(Boolean));
      const asked = base.askedToWait?.() ?? [];
      await transact(dir, (work, { at }) => {
        reconcileFromQueue(work, {
          runIds,
          onStamp: (facet, companyId, row, judged) => {
            const c = counts[CADENCE.company[facet].job];
            const f = (c.byFacet[facet] ??= { read: 0, changed: 0, failed: 0, refused: 0 });
            if (judged.outcome === 'read') { c.read += 1; f.read += 1; if (judged.changed) { c.changed += 1; f.changed += 1; } }
            else if (['failed', 'unreachable', 'incomplete'].includes(judged.outcome)) { c.failed += 1; f.failed += 1; }
            else { c.refused += 1; f.refused += 1; }
            if (facet === 'status' && judged.changed && (row.meta?.signals ?? []).length) watch.push({ company_id: companyId, signals: row.meta.signals.map((s) => s.code) });
          },
        });
        recordHostCooldowns(work, { asked, used, at });
        return {};
      }, lockOpts);
    });

    // ---- 5. the quality pass
    await phase(['quality'], 'the quality pass', async () => {
      if (!selected.includes('quality')) return;
      const r = (await transact(dir, (work, { at }) => {
        const row = indexState(work.refresh_state ??= []).getOrCreate('source', 'data-quality', 'quality');
        const due = force || row.next_check_at == null || Date.parse(row.next_check_at) <= Date.parse(startedAt);
        if (!due) return { result: null };
        const found = runQuality(work, { at });
        stampCheck(row, { at, outcome: 'read', changed: found.changed > 0, verified: true, runId: runIds.quality });
        return { result: found };
      }, lockOpts)).result;
      if (r) Object.assign(results.quality, { due: 1, processed: 1, changed: r.changed, summary: qualitySummary({ ...r }), details: r.details });
      else results.quality.summary = 'Not due yet';
    });

    // ---- 6. the run log and the audit trail
    for (const job of siteJobs) {
      const facets = facetsOf(job);
      const c = counts[job];
      const due = sum(planned?.dueByFacet, facets);
      const queued = sum(planned?.plannedByFacet, facets);
      Object.assign(results[job], {
        due, processed: c.read, changed: c.changed, failed: c.failed, deferred: Math.max(0, due - queued),
        details: {
          by_facet: c.byFacet, refused: c.refused, skipped: planned?.skipped ?? null, never_checked: planned?.never ?? 0,
          shared_with: SITE_JOBS.filter((j) => j !== job && selected.includes(j)), requests_for_all_site_jobs: siteRequests,
          ...(job === 'status' ? { watch: watch.slice(0, 20) } : {}),
        },
      });
      const idle = due === 0 && c.read === 0 && c.failed === 0 && c.refused === 0;
      results[job].summary = results[job].error ? results[job].summary : idle ? 'Nothing was due' : siteSummary(job, results[job], c, drained);
    }
    const stoppedFor = budget.stoppedFor();
    await phase(selected, 'writing the run log', async () => {
      await transact(dir, (work, { at }) => {
        const byId = new Map(work.job_runs.map((r) => [r.id, r]));
        const audit = [];
        for (const job of selected) {
          const row = byId.get(runIds[job]);
          const r = results[job];
          const idle = !r.error && r.due === 0 && r.processed === 0 && r.failed === 0 && r.changed === 0;
          const status = r.error && r.processed === 0 ? 'failed' : r.failed > 0 ? 'partial' : idle ? 'idle' : 'ok';
          finishJobRun(row, {
            at, status, due: r.due, processed: r.processed, changed: r.changed, failed: r.failed, deferred: r.deferred, requests: r.requests,
            budget: { ...budget.limits, stopped_for: SITE_JOBS.includes(job) ? stoppedFor : null }, summary: r.summary || (idle ? 'Nothing was due' : ''),
            details: r.details, error: status === 'failed' ? (r.error ?? 'the job failed') : null,
          });
          if (r.changed > 0 && !r.error) audit.push({ actor: SYSTEM(by), via: 'worker', action: 'scheduler.run', target: { type: 'job_run', id: row.id }, summary: `${job}: ${r.summary}`.slice(0, 280) });
        }
        return { audit };
      }, lockOpts);
    });

    const finishedAt = iso(now());
    const mine = new Set(Object.values(runIds));
    const final = (await snapshot(dir, lockOpts)).ds.job_runs.filter((r) => mine.has(r.id));
    return {
      tick_id: tickId, started_at: startedAt, finished_at: finishedAt, runs: final, requests: base.log.requests.length, stopped_for: stoppedFor,
      status: final.some((r) => r.status === 'failed') ? 'failed' : final.some((r) => r.status === 'partial') ? 'partial' : 'ok',
    };
  } finally {
    await lock.release();
  }
}

function siteSummary(job, r, c, drained) {
  const bits = [`${c.read} read`];
  if (c.changed) bits.push(`${c.changed} found something new`);
  if (c.failed) bits.push(`${c.failed} failed`);
  if (c.refused) bits.push(`${c.refused} refused or unreadable`);
  const verb = { hiring: 'careers pages and job boards', status: 'homepages', enrichment: 'company pages' }[job];
  const left = r.deferred ? `; ${r.deferred} still due` : '';
  const shared = drained && drained.claimed ? ` (${drained.claimed} site read(s) shared by the site jobs)` : '';
  return `Checked ${verb}: ${bits.join(', ')}${left}${shared}`;
}

// Another tick holds the lock: every selected job gets a 'skipped' row saying so, and nothing else happens.
async function refused(dir, { selected, tickId, trigger, by, held, lockOpts }) {
  const why = `another scheduler tick has held the lock since ${held.since ?? 'an unknown time'}${held.pid ? ` (process ${held.pid})` : ''}`;
  await transact(dir, (work, { at }) => {
    work.job_runs ??= [];
    for (const job of selected) {
      const row = startJobRun(work.job_runs, { job, tickId, at, trigger, by });
      finishJobRun(row, { at, status: 'skipped', summary: `Not run: ${why}` });
    }
    return {};
  }, lockOpts);
  return { tick_id: tickId, status: 'locked', held, runs: [], requests: 0, stopped_for: null };
}
