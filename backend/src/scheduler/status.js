// What the scheduler has been doing and what it will do next, as plain data: for `scheduler status` and for the
// Command Center. Pure; reads the dataset only.
import { lastRunByJob, JOBS } from '../models/jobRuns.js';
import { queueSummary } from '../models/enrichmentQueue.js';
import { indexState } from '../models/refreshState.js';
import { CADENCE, COMPANY_FACETS } from './cadence.js';
import { dueRefreshes } from './plan.js';
import { coolingHosts } from './state.js';

const earliest = (rows) => rows.map((r) => r.next_check_at).filter(Boolean).sort()[0] ?? null;
const RECENT = 20;

// sourceIds: the sources configured to be read (discovery/config.js), so a source never read yet still shows as due.
// fundingIds: which of them are publishers' feeds, the only ones the funding job reads (the rest are discovery's alone).
export function schedulerStatus(ds, { at = new Date().toISOString(), sourceIds = [], fundingIds = sourceIds } = {}) {
  const state = indexState(ds.refresh_state ?? []);
  const rows = ds.refresh_state ?? [];
  const { due, skipped } = dueRefreshes(ds, { at });
  const last = lastRunByJob(ds.job_runs ?? []);
  const isDue = (r) => !r || r.next_check_at == null || Date.parse(r.next_check_at) <= Date.parse(at);

  const facets = {};
  for (const facet of COMPANY_FACETS) {
    const spec = CADENCE.company[facet];
    const mine = rows.filter((r) => r.scope === 'company' && r.facet === facet);
    facets[facet] = {
      label: spec.label, pace: spec.pace, every_days: spec.baseDays, job: spec.job,
      checked: mine.filter((r) => r.last_checked_at).length,
      due_now: due.filter((d) => d.due.some((x) => x.facet === facet)).length,
      never_checked: due.filter((d) => d.due.some((x) => x.facet === facet && x.reason === 'never')).length,
      next: earliest(mine), failing: mine.filter((r) => r.failures > 0).length,
      last_checked: mine.map((r) => r.last_checked_at).filter(Boolean).sort().at(-1) ?? null,
    };
  }

  const sources = sourceIds.map((id) => {
    const out = { id };
    for (const facet of ['funding', 'discovery']) {
      const r = state.get('source', id, facet);
      out[facet] = r ? { last_checked_at: r.last_checked_at, next_check_at: r.next_check_at, failures: r.failures, last_error: r.last_error, last_outcome: r.last_outcome } : null;
    }
    out.is_funding_feed = fundingIds.includes(id);
    return out;
  });

  const feedDue = (facet) => (facet === 'funding' ? fundingIds : sourceIds).filter((id) => isDue(state.get('source', id, facet))).length;
  const jobs = JOBS.map((job) => {
    const facetNames = COMPANY_FACETS.filter((f) => CADENCE.company[f].job === job);
    let dueNow = 0;
    let next = null;
    if (facetNames.length) {
      dueNow = due.filter((d) => d.due.some((x) => facetNames.includes(x.facet))).length;
      next = earliest(rows.filter((r) => r.scope === 'company' && facetNames.includes(r.facet)));
    } else if (job === 'funding' || job === 'discovery') {
      dueNow = feedDue(job);
      next = earliest(rows.filter((r) => r.scope === 'source' && r.facet === job));
    } else if (job === 'quality') {
      const r = state.get('source', 'data-quality', 'quality');
      dueNow = isDue(r) ? 1 : 0;
      next = r?.next_check_at ?? null;
    }
    const run = last[job] ?? null;
    return {
      job, due_now: dueNow, next_due: next,
      last_run: run ? { id: run.id, status: run.status, started_at: run.started_at, finished_at: run.finished_at, summary: run.summary, due: run.due, processed: run.processed, changed: run.changed, failed: run.failed, error: run.error } : null,
    };
  });

  const watch = rows.filter((r) => r.scope === 'company' && r.facet === 'status' && (r.meta?.signals ?? []).length)
    .map((r) => ({ company_id: r.target_id, signals: r.meta.signals })).sort((a, b) => a.company_id.localeCompare(b.company_id));
  const hosts = [...coolingHosts(ds, at)].map((h) => { const r = state.get('host', h, 'access'); return { host: h, until: r.next_check_at, failures: r.failures }; });
  const recent = [...(ds.job_runs ?? [])].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at) || b.id.localeCompare(a.id)).slice(0, RECENT)
    .map((r) => ({ id: r.id, job: r.job, status: r.status, trigger: r.trigger, by: r.by, started_at: r.started_at, finished_at: r.finished_at, due: r.due, processed: r.processed, changed: r.changed, failed: r.failed, deferred: r.deferred, requests: r.requests, summary: r.summary, error: r.error, mode: r.mode, stopped_for: r.budget?.stopped_for ?? null }));
  return {
    at, jobs, facets, sources, hosts, watch, recent, skipped,
    queue: queueSummary(ds.enrichment_queue ?? [], at),
    totals: { companies: ds.companies.length, state_rows: rows.length, runs: (ds.job_runs ?? []).length },
  };
}
