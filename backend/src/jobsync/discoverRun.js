// One pass of board discovery over the companies that are due: read each one's own website (outside any lock), then write what was found in one transaction per company, so a
// failure on one site loses nothing already written and nothing is written half way. The catalogue (job_sources.json) is rebuilt from sources.json after each approval.
import { snapshot, transact } from '../models/store.js';
import { lifecycleOf } from '../models/company.js';
import { discoverCompany, applyDiscovery, dueForDiscovery, reconcileCoverage } from './discover.js';
import { buildCatalogue } from './sources.js';
import { applyRead } from './engine.js';
import { stateRow, noteSuccess } from './state.js';

export const DEFAULT_DISCOVERY_PER_RUN = 90;

// A company that has closed is not looked at: the catalogue's own rule (catalog/catalog.js isInactive), written here because the scheduler never loads the public read model.
const isInactive = (c) => lifecycleOf(c) === 'defunct' || c.maturity === 'Collapsed';

// The review rows already in the catalogue (boards named but not confirmed), kept as they are when the catalogue is rebuilt.
export const keptReview = (ds) => (ds.job_sources ?? []).filter((r) => r.status === 'review').map((r) => ({ company_id: r.company_id, provider: r.provider, token: r.token, reason: r.basis, sighted: r.sighted }));

// plan: reads nothing, writes nothing.
export async function planDiscovery(dir, { now = Date.now, limit = DEFAULT_DISCOVERY_PER_RUN, force = false, only = null } = {}) {
  const { ds } = await snapshot(dir, { now });
  const sub = only ? { ...ds, companies: ds.companies.filter((c) => only.includes(c.id)) } : ds;
  return dueForDiscovery(sub, { now: now(), limit, force, isInactive });
}

export async function runDiscovery({ dir, fetcher, now = Date.now, limit = DEFAULT_DISCOVERY_PER_RUN, force = false, only = null, concurrency = 4, shouldStop = () => false, onResult = () => {} }) {
  const lock = { now };
  const plan = await planDiscovery(dir, { now, limit, force, only });
  const stats = { eligible: plan.eligible, due: plan.due, read: 0, boards: 0, roles_added: 0, outcomes: {}, errors: 0, stopped: false };
  let next = 0;
  const worker = async () => {
    while (next < plan.planned.length) {
      if (shouldStop()) { stats.stopped = true; return; }
      const company = plan.planned[next]; next += 1;
      let result;
      try {
        result = await discoverCompany(company, { fetcher, now });
      } catch (err) {
        // A failure that is not a site refusing (a bug, a budget): leave the company due, record nothing.
        stats.errors += 1; onResult({ company, error: err.message }); continue;
      }
      await transact(dir, (work, { at }) => {
        const c = work.companies.find((x) => x.id === company.id);
        if (!c) return {};
        applyDiscovery(work, c, result, { at });
        if (result.verified.length) {
          work.job_sources = buildCatalogue(work, { review: keptReview(work), at });
          // The board was just read whole to be sure it answers: that read is the board's first, so its roles and its state are written now, and the boards step does not ask again.
          work.job_sync_state ??= [];
          for (const v of result.verified) {
            const source = work.job_sources.find((s) => s.id === `${c.id}-${v.provider}-jobs` && s.status === 'approved');
            if (!source) continue;
            const s = applyRead(work.jobs, source, v.read, { now: now() });
            noteSuccess(stateRow(work.job_sync_state, source.id), { at, counts: s, runId: null, pages: v.read.pages, attempts: v.read.attempts });
            stats.roles_added += s.added;
          }
        }
        return {};
      }, lock);
      stats.read += 1;
      stats.boards += result.verified.length;
      stats.outcomes[result.outcome] = (stats.outcomes[result.outcome] ?? 0) + 1;
      onResult({ company, result });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  await transact(dir, (work, { at }) => { stats.reconciled = reconcileCoverage(work, { at }); return {}; }, lock);
  stats.deferred = Math.max(0, plan.due - stats.read - stats.errors);
  return stats;
}
