// What a refresh changed that is worth a commit, and whether it is worth a redeploy of the API. A refresh that finds nothing new makes NO commit and no deploy, so the repository and the
// API are not churned twice a day for dates alone.
//
// Volatile: the two confirmation dates (a whole read moves them every refresh) and the ledgers' own bookkeeping dates. Everything else on a role is visible. A board going from healthy to
// failing, or back, is visible too: the desk says so. How many reads it took, and when, is not.
//
// What must be committed although no visitor sees it, or the next refresh (which starts from the committed data) would forget it:
//   - how many times in a row a board has failed (so "three in a row" can ever be reached) and the first empty answer from a board (so the second, which is what closes its roles, can happen);
//   - a board approved or put in review, a company whose job-board outcome changed, a lead, a venture board whose platform or access changed.
//
// And one heartbeat: when nothing else is worth it, one commit and deploy a day, so the "last read" stamp on the hiring desk is true and no role looks unchecked for long.
const VOLATILE = new Set(['retrieved_at', 'last_confirmed_at']);

const stable = (row) => JSON.stringify(Object.fromEntries(Object.entries(row).filter(([k]) => !VOLATILE.has(k)).sort(([a], [b]) => (a < b ? -1 : 1))));

export function compareJobs(before = [], after = []) {
  const was = new Map(before.map((r) => [r.id, r]));
  const now = new Map(after.map((r) => [r.id, r]));
  const out = { added: 0, removed: 0, status: 0, edited: 0, redated: 0 };
  for (const [id, row] of now) {
    const old = was.get(id);
    if (!old) { out.added += 1; continue; }
    if (old.status !== row.status) out.status += 1;
    else if (stable(old) !== stable(row)) out.edited += 1;
    else if (old.last_confirmed_at !== row.last_confirmed_at || old.retrieved_at !== row.retrieved_at) out.redated += 1;
  }
  for (const id of was.keys()) if (!now.has(id)) out.removed += 1;
  return out;
}

// Boards going failing or healthy, a failing board failing once more, and a first empty answer (all of which have to survive to the next refresh).
export function compareHealth(before = [], after = []) {
  const was = new Map(before.map((r) => [r.source_id, r]));
  let changed = 0;
  for (const r of after) {
    const old = was.get(r.source_id);
    const failedNow = r.consecutive_failures ?? 0;
    const failedThen = old?.consecutive_failures ?? 0;
    if (failedNow !== failedThen) changed += 1;
    else if ((r.empty_reads ?? 0) !== (old?.empty_reads ?? 0)) changed += 1;
  }
  return changed;
}

// The ledgers, as one number: boards approved or put in review (or taken out), companies whose outcome changed or that a network said are hiring, new leads and leads that moved on, venture boards whose platform or access changed.
export function compareLedgers(before = {}, after = {}) {
  let n = 0;
  const idsOf = (rows, pick = (r) => r.id) => new Map((rows ?? []).map((r) => [pick(r), r]));
  const sources = idsOf(before.job_sources);
  for (const r of after.job_sources ?? []) { const old = sources.get(r.id); if (!old || old.status !== r.status || old.token !== r.token) n += 1; }
  const now = idsOf(after.job_sources);
  for (const id of sources.keys()) if (!now.has(id)) n += 1;
  const coverage = idsOf(before.job_coverage, (r) => r.company_id);
  for (const r of after.job_coverage ?? []) { const old = coverage.get(r.company_id); if (!old || old.outcome !== r.outcome || (old.boards ?? []).length !== (r.boards ?? []).length || old.hiring_hint_at !== r.hiring_hint_at) n += 1; }
  const leads = idsOf(before.job_leads);
  for (const r of after.job_leads ?? []) { const old = leads.get(r.id); if (!old || old.status !== r.status) n += 1; }
  const vc = idsOf(before.job_vc_boards);
  for (const r of after.job_vc_boards ?? []) { const old = vc.get(r.id); if (!old || old.platform !== r.platform || old.access !== r.access || old.board_url !== r.board_url) n += 1; }
  return n;
}

// Should the refresh's files be committed, and the API redeployed? `ageHours` is how long since the data was last committed.
export function worthCommitting({ jobs, health, ledger = 0, ageHours = 0, heartbeatHours = 20 }) {
  const visible = jobs.added + jobs.removed + jobs.status + jobs.edited;
  if (visible > 0) return { commit: true, reason: `roles changed (${jobs.added} new, ${jobs.status} changed status, ${jobs.edited} edited, ${jobs.removed} removed)`, deploy: true };
  if (health > 0) return { commit: true, reason: `${health} board(s) failed, recovered, or answered empty`, deploy: true };
  if (ledger > 0) return { commit: true, reason: `${ledger} change(s) to the boards, the companies' coverage or the venture boards`, deploy: false };
  if (ageHours >= heartbeatHours) return { commit: true, reason: `nothing changed, but the last commit is ${Math.floor(ageHours)} hours old: the confirmation dates and the "last read" stamp are brought up to date`, deploy: true };
  return { commit: false, reason: 'only confirmation dates moved', deploy: false };
}
