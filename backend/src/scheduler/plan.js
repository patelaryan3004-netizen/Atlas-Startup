// Deciding what is due, and putting it on the enrichment queue. No network, and nothing is read here: a company is
// due for a facet when its clock says so, and the reading is the queue worker's job (enrichment/worker.js).
//
// A company is read once for everything that is due at that moment: if its hiring and its description are both due,
// that is one task asking for both, not two reads of the same site. The queue already holds at most one task per
// company, so asking again for a company that is waiting widens the task it has instead of adding another.
import { lifecycleOf } from '../models/company.js';
import { enqueueTask } from '../models/enrichmentQueue.js';
import { indexState } from '../models/refreshState.js';
import { CADENCE, COMPANY_FACETS, taskPriority, DAY_MS } from './cadence.js';
import { hostOf } from './state.js';

const unique = (list) => [...new Set(list)];

export const facetsForJobs = (jobs) => COMPANY_FACETS.filter((f) => jobs.includes(CADENCE.company[f].job));

// Every company with something due, most important first. `force` ignores the clocks and takes the facets that were
// checked longest ago first. Companies with no website cannot be read; those on a website that asked us to slow
// down wait; a company that has closed or been acquired is only asked about its status.
export function dueRefreshes(work, { at, facets = COMPANY_FACETS, force = false, cooling = new Set() }) {
  const state = indexState(work.refresh_state ?? []);
  const now = Date.parse(at);
  const out = [];
  const skipped = { no_website: 0, cooling: 0 };
  for (const company of work.companies) {
    if (!company.website) { skipped.no_website += 1; continue; }
    const host = hostOf(company.website);
    if (host && cooling.has(host)) { skipped.cooling += 1; continue; }
    const retired = Boolean(lifecycleOf(company));
    const due = [];
    for (const facet of facets) {
      if (retired && facet !== 'status') continue;
      const spec = CADENCE.company[facet];
      const row = state.get('company', company.id, facet);
      let reason = null;
      if (force) reason = 'forced';
      else if (!row) reason = 'never';
      else if (row.last_outcome === 'no_website') reason = 'website_added'; // it had none when last looked, and has one now
      else if (row.next_check_at == null) reason = 'asked';
      else if (Date.parse(row.next_check_at) <= now) reason = 'due';
      if (!reason) continue;
      const waited = row?.last_checked_at ? (now - Date.parse(row.last_checked_at)) / DAY_MS : 1000;
      const overdue = row?.next_check_at ? Math.max(0, (now - Date.parse(row.next_check_at)) / DAY_MS) : 0;
      const score = spec.importance * 100 + (reason === 'never' ? 1000 : 0) + (force ? Math.min(waited, 900) : Math.min(overdue / spec.baseDays, 10) * 50);
      due.push({ facet, reason, overdueDays: Math.round(overdue * 10) / 10, score });
    }
    if (due.length) out.push({ company, due, score: Math.max(...due.map((d) => d.score)) });
  }
  out.sort((a, b) => b.score - a.score || a.company.id.localeCompare(b.company.id));
  return { due: out, skipped };
}

// Queues one task per company for what is due, up to `limit` companies; the rest stay due for the next run.
// Returns what was due, what was taken, and how it breaks down.
export function planSiteReads(work, { at, limit = 40, facets = COMPANY_FACETS, force = false, cooling = new Set(), by = 'scheduler' }) {
  const { due, skipped } = dueRefreshes(work, { at, facets, force, cooling });
  const take = due.slice(0, limit);
  const count = (list) => list.reduce((acc, d) => ({ ...acc, [d.facet]: (acc[d.facet] ?? 0) + 1 }), {});
  const tasks = [];
  for (const { company, due: dueFacets } of take) {
    const names = dueFacets.map((d) => d.facet);
    const wanted = unique(names.flatMap((f) => CADENCE.company[f].wants));
    const maxPages = Math.max(...names.map((f) => CADENCE.company[f].maxPages));
    const { task, created } = enqueueTask(work, { kind: 'company', targetId: company.id, priority: taskPriority(names), reason: 'refresh', wanted, maxPages, by, at });
    tasks.push({ id: task.id, company_id: company.id, facets: names, created });
  }
  return {
    due: due.length, planned: take.length, deferred: due.length - take.length, tasks, skipped,
    dueByFacet: count(due.flatMap((d) => d.due)), plannedByFacet: count(take.flatMap((d) => d.due)),
    never: due.filter((d) => d.due.some((x) => x.reason === 'never')).length,
  };
}

// Leaves a task for later if its company's website asked us to slow down.
export function eligibleUnless(cooling) {
  if (!cooling.size) return null;
  return (task, work) => {
    if (task.kind !== 'company') return true;
    const company = work.companies.find((c) => c.id === task.target_id);
    const host = company?.website ? hostOf(company.website) : null;
    return !(host && cooling.has(host));
  };
}
