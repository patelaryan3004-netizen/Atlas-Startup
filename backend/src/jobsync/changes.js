// What a run changed that a visitor could see, as against what it only re-dated. The hourly workflow commits the data files only when this says something changed (or it has been a day), so an
// hour in which every board was read and nothing moved does not make a commit, and does not redeploy the API.
//
// Volatile: the two confirmation dates (a whole read moves them every hour). Everything else on a role is visible. A board going from healthy to failing, or back, is visible too: the desk says
// so. How many reads it took, and when, is not.
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

export function compareHealth(before = [], after = []) {
  const failing = (rows) => new Map(rows.map((r) => [r.source_id, (r.consecutive_failures ?? 0) > 0]));
  const was = failing(before);
  let flipped = 0;
  for (const [id, bad] of failing(after)) if ((was.get(id) ?? false) !== bad) flipped += 1;
  return flipped;
}

// Should the run's files be committed? `ageHours` is how long since the data was last committed.
export function worthCommitting({ jobs, health, ageHours = 0, heartbeatHours = 23 }) {
  const visible = jobs.added + jobs.removed + jobs.status + jobs.edited;
  if (visible > 0) return { commit: true, reason: `roles changed (${jobs.added} new, ${jobs.status} changed status, ${jobs.edited} edited, ${jobs.removed} removed)`, deploy: true };
  if (health > 0) return { commit: true, reason: `${health} board(s) went healthy or failing`, deploy: true };
  if (ageHours >= heartbeatHours) return { commit: true, reason: `nothing changed, but the last commit is ${Math.floor(ageHours)} hours old: the confirmation dates are brought up to date`, deploy: false };
  return { commit: false, reason: 'only confirmation dates moved', deploy: false };
}
