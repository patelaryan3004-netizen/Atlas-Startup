// The data-quality job: finds records that are stale or in conflict, says so, and does something about it.
// It reads nothing from the network. It looks at the dataset and at the scheduler's own clocks, and:
//
//   reports    how far behind each facet is, which companies have never been checked, which have a conflict between
//              what a source says and what the record says, which say they are hiring but have not been seen to be
//              for a month, which have a signal on their status clock (the site moved, says it was acquired, has
//              gone quiet), which sources keep failing, and the completeness audit's totals
//   acts       a record in conflict, or a "hiring now" nobody has confirmed, is brought forward on its clock so the
//              next run reads its site again (not more than once a week for a conflict, so a record that stays in
//              conflict is not re-read every run), and the log is kept short: finished queue tasks older than a
//              month, run rows that did nothing, and clocks of companies that are gone are dropped
//
// It never resolves a conflict and never changes a company: those are for a person, in the Command Center.
import { auditDataset } from '../../models/audit.js';
import { failedImports } from '../../models/importRuns.js';
import { pruneJobRuns } from '../../models/jobRuns.js';
import { pruneFinished } from '../../models/enrichmentQueue.js';
import { indexState } from '../../models/refreshState.js';
import { CADENCE, COMPANY_FACETS } from '../cadence.js';
import { dueRefreshes } from '../plan.js';
import { makeDue, dropOrphans } from '../state.js';

const RECHECK_CONFLICT_DAYS = 7;
const RECHECK_HIRING_DAYS = 3;
const MAX_LISTED = 10;

// The facet whose reading can settle a claim about this field.
const FIELD_FACET = (() => {
  const map = { company_status: 'status', website: 'status' };
  for (const facet of COMPANY_FACETS) for (const f of CADENCE.company[facet].wants) map[f] ??= facet;
  map.jobs = 'hiring';
  return map;
})();

export function runQuality(work, { at }) {
  const state = indexState(work.refresh_state ??= []);
  const audit = auditDataset(work, { asOf: at.slice(0, 10) });
  const reverify = { conflicts: 0, hiring: 0 };

  // ---- act: bring the facets that could settle a conflict, or confirm a hiring claim, forward
  for (const c of audit.provenance.conflicts) {
    const facet = FIELD_FACET[c.field];
    const row = facet ? state.get('company', c.company_id, facet) : null;
    if (row && makeDue(row, { at, recheckAfterDays: RECHECK_CONFLICT_DAYS })) reverify.conflicts += 1;
  }
  for (const company of audit.companies) {
    if (!company.tasks.some((t) => t.code === 'stale_hiring')) continue;
    const row = state.get('company', company.id, 'hiring');
    if (row && makeDue(row, { at, recheckAfterDays: RECHECK_HIRING_DAYS })) reverify.hiring += 1;
  }

  // ---- report: how far behind each facet is (after the above, so what was just brought forward counts as due)
  const { due, skipped } = dueRefreshes(work, { at });
  const facets = {};
  for (const facet of COMPANY_FACETS) {
    const spec = CADENCE.company[facet];
    const mine = due.flatMap((d) => d.due.filter((x) => x.facet === facet));
    const rows = work.refresh_state.filter((r) => r.scope === 'company' && r.facet === facet);
    facets[facet] = {
      checked: rows.filter((r) => r.last_checked_at).length,
      never: mine.filter((x) => x.reason === 'never').length,
      due: mine.length,
      behind: mine.filter((x) => x.overdueDays > spec.baseDays).length,
      oldest_check: rows.map((r) => r.last_checked_at).filter(Boolean).sort()[0] ?? null,
      failing: rows.filter((r) => r.failures > 0).length,
    };
  }
  const watch = work.refresh_state
    .filter((r) => r.scope === 'company' && r.facet === 'status' && (r.meta?.signals ?? []).length)
    .map((r) => ({ company_id: r.target_id, signals: r.meta.signals.map((s) => s.code), since: r.meta.signals.map((s) => s.since).sort()[0] ?? null }))
    .sort((a, b) => a.company_id.localeCompare(b.company_id));
  const failingSources = failedImports(work.import_runs ?? []);
  const sourceTrouble = work.refresh_state.filter((r) => r.scope === 'source' && r.failures > 0).map((r) => ({ source: r.target_id, facet: r.facet, failures: r.failures, error: r.last_error }));
  const hosts = work.refresh_state.filter((r) => r.scope === 'host' && r.next_check_at && Date.parse(r.next_check_at) > Date.parse(at)).map((r) => ({ host: r.target_id, until: r.next_check_at, failures: r.failures }));

  // ---- act: keep the log short
  const runs = pruneJobRuns(work.job_runs ?? [], { at });
  work.job_runs = runs.rows;
  const pruned = { runs: runs.dropped, queue: pruneFinished(work, { at }), orphans: dropOrphans(work) };

  const changed = reverify.conflicts + reverify.hiring;
  return {
    changed,
    details: {
      companies: audit.total, tiers: audit.tierCounts,
      conflicts: audit.provenance.conflicts.length, unapplied_suggestions: audit.provenance.unapplied.length, weak_evidence: audit.provenance.weak.length,
      possible_duplicates: audit.duplicates.length,
      stale_hiring: audit.taskCounts.stale_hiring ?? 0, no_source: audit.taskCounts.no_source ?? 0,
      facets, no_website: skipped.no_website, cooling_hosts: hosts,
      status_watch: watch.slice(0, MAX_LISTED), status_watch_total: watch.length,
      failed_imports: failingSources.map((f) => ({ source: f.source_id, error: f.error })),
      source_trouble: sourceTrouble,
      brought_forward: reverify, pruned,
      attention: audit.queue.slice(0, MAX_LISTED).map((q) => ({ company_id: q.company_id, priority: q.priority, first: q.tasks[0]?.code ?? null })),
    },
  };
}

export function qualitySummary(result) {
  const d = result.details;
  const behind = Object.values(d.facets).reduce((n, f) => n + f.behind, 0);
  const bits = [`${d.companies} companies`, `${d.conflicts} conflict(s)`, `${d.stale_hiring} stale hiring`, `${behind} facet check(s) behind`];
  if (d.status_watch_total) bits.push(`${d.status_watch_total} on the status watch`);
  if (d.failed_imports.length) bits.push(`${d.failed_imports.length} failing source(s)`);
  const moved = result.changed ? `; brought ${result.changed} record(s) forward for another look` : '';
  return `Checked ${bits.join(', ')}${moved}`;
}
