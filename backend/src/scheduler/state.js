// Keeping the refresh clocks: stamping a check on a row, learning from the queue tasks that have finished, and
// remembering which websites asked us to slow down. Everything here works on a working copy of the dataset, inside
// a store transaction, and does no network.
//
// The clocks are learned from the queue, not kept by whoever did the reading. The worker reads a site and finishes
// a task; this turns each finished task into stamps on the facets it covered, exactly once (a row remembers the
// last task it learned from, and a task older than a row's last attempt is never applied). So a task a person
// queued by hand moves the same clocks as one the scheduler queued, a crash between "the task finished" and "the
// clocks moved" is repaired by the next run, and running it twice changes nothing.
import { canonicalDomain } from '../models/identity.js';
import { indexState } from '../models/refreshState.js';
import { CADENCE, nextCheckAt, addDays, DAY_MS } from './cadence.js';

const clip = (s, n = 200) => (s == null ? null : String(s).slice(0, n));
export const hostOf = (website) => { try { return canonicalDomain(website)?.host ?? null; } catch { return null; } };
const hostOfUrl = (url) => { try { return new URL(url).hostname; } catch { return null; } };

const TRANSIENT_CODES = new Set(['timeout', 'network_error', 'rate_limited', 'dns_failed', 'budget_exhausted']);
const UNREACHABLE_AFTER_DAYS = 21;
const UNREACHABLE_AFTER_CHECKS = 3;

// ---------- stamping one check ----------

// outcome: 'read' (the source answered: changed says whether it said anything new, verified whether it gave a
// positive reading), or what stopped it: incomplete, no_website, refused, mismatch, blocked, unreachable, failed.
// Mutates the row and says when to look again.
export function stampCheck(row, { at, outcome, changed = false, verified = false, error = null, code = null, taskId = null, runId = null, company = null, meta, retryAfterSeconds = null, baseDays = null }) {
  const worked = outcome === 'read';
  row.last_attempt_at = at;
  row.last_outcome = worked ? (changed ? 'changed' : 'unchanged') : outcome;
  if (worked) {
    row.last_checked_at = at;
    row.checks += 1;
    row.failures = 0;
    row.last_error = null;
    if (verified) row.last_verified_at = at;
    if (changed) { row.last_changed_at = at; row.unchanged_streak = 0; } else row.unchanged_streak += 1;
  } else {
    // A failure counts against the back-off; a refusal, a mismatch or a missing website is a result and does not.
    if (['incomplete', 'unreachable', 'failed'].includes(outcome)) row.failures += 1;
    row.last_error = clip(error);
  }
  if (taskId != null) row.last_task_id = taskId;
  if (runId != null) row.last_run_id = runId;
  if (meta !== undefined) row.meta = meta;
  row.next_check_at = nextCheckAt({ scope: row.scope, facet: row.facet, at, outcome, row, company, code, retryAfterSeconds, baseDays });
  return row;
}

// ---------- what a finished task covers, and what it came to ----------

// A read of a company's site always reads its homepage, so it always bears on the status facet; the other facets
// are covered when the task asked for their fields.
export function facetsOfTask(task) {
  const wanted = new Set(task.wanted ?? []);
  const facets = ['status'];
  for (const [facet, spec] of Object.entries(CADENCE.company)) {
    if (spec.scheduled === false || facet === 'status') continue;
    if (spec.wants.some((w) => wanted.has(w))) facets.push(facet);
  }
  return facets;
}

const intersects = (list, fields) => fields.some((f) => list.has(f));
const signature = (signals) => (signals ?? []).map((s) => s.code).sort().join(',');
const codeOf = (error) => /^([a-z_]+):/.exec(error ?? '')?.[1] ?? null;
// A homepage that is not there at all (as opposed to one we may not read) says something about the company.
const isGone = (task) => /HTTP (?:404|410)\b|dns_failed/.test(task.last_error ?? '');

// What one finished task says about one facet of one company, as the arguments of stampCheck.
function judge(facet, task, row, company, at) {
  const r = task.result ?? {};
  const error = task.last_error ?? null;
  const base = { error, code: r.code ?? codeOf(error), taskId: task.id };
  const status = facet === 'status';
  const unreachableMeta = (since = row.meta?.unreachable_since ?? at) => ({ signals: row.meta?.signals ?? [], unreachable_since: since });

  if (task.status === 'failed') return { ...base, outcome: 'failed', ...(status ? { meta: unreachableMeta() } : {}) };
  if (task.status === 'skipped') {
    if (r.outcome === 'no_website') return { ...base, outcome: 'no_website' };
    if (r.outcome === 'refused' && isGone(task)) return { ...base, outcome: 'unreachable', ...(status ? { meta: unreachableMeta() } : {}) };
    return { ...base, outcome: 'refused' };
  }
  // done
  if (r.outcome === 'blocked') return { ...base, outcome: 'blocked' };
  if (r.outcome === 'unreachable') return { ...base, outcome: 'unreachable', ...(status ? { meta: unreachableMeta() } : {}) };
  if (r.outcome === 'mismatch' && !status) return { ...base, outcome: 'mismatch' };

  if (status) {
    // The homepage was read (even a mismatch is a reading: of someone else's page). The signals on it are the answer.
    const before = row.meta?.signals ?? [];
    const now = (r.status_signals ?? []).map((s) => ({ ...s, since: before.find((b) => b.code === s.code)?.since ?? at }));
    return { ...base, outcome: 'read', changed: signature(now) !== signature(before), verified: now.length === 0, meta: { signals: now, unreachable_since: null } };
  }

  const spec = CADENCE.company[facet];
  const legacy = r.added_fields === undefined; // a task from before the fields were recorded: only totals are known
  const added = new Set(r.added_fields ?? []);
  const seen = new Set([...added, ...(r.refreshed_fields ?? []), ...(r.confirmed_fields ?? [])]);
  const applied = new Set(r.applied ?? []);
  const jobs = r.jobs ?? {};
  let changed = intersects(added, spec.wants) || intersects(applied, spec.wants);
  let verified = intersects(seen, spec.wants);
  if (legacy) { changed = (r.evidence_added ?? 0) > 0; verified = changed || (r.evidence_refreshed ?? 0) > 0; }

  if (facet === 'hiring') {
    if ((jobs.added ?? 0) > 0 || (jobs.closed ?? 0) > 0) changed = true;
    if ((jobs.added ?? 0) > 0 || (jobs.updated ?? 0) > 0) verified = true;
    // A job board the careers page pointed at that would not answer is a hiring check half done: try again soon.
    const own = hostOf(company.website);
    const missed = (r.refused ?? []).some((x) => TRANSIENT_CODES.has(x.code) && hostOfUrl(x.url) && hostOfUrl(x.url) !== own);
    if (missed) return { ...base, outcome: 'incomplete', error: 'a job board the careers page links to would not answer' };
  }
  return { ...base, outcome: 'read', changed, verified };
}

// The status facet remembers when the site went quiet. Once it has been unreachable for several checks over
// three weeks, that is a signal worth a person's look (never evidence: an outage is not a shutdown).
function noteUnreachable(row, at) {
  const meta = row.meta ?? { signals: [], unreachable_since: null };
  const rest = (meta.signals ?? []).filter((s) => s.code !== 'unreachable');
  const since = meta.unreachable_since;
  const long = since && Date.parse(at) - Date.parse(since) >= UNREACHABLE_AFTER_DAYS * DAY_MS && row.failures >= UNREACHABLE_AFTER_CHECKS;
  row.meta = { signals: long ? [...rest, { code: 'unreachable', detail: `the website has not answered since ${since.slice(0, 10)} (${row.failures} checks in a row)`, since: (meta.signals ?? []).find((s) => s.code === 'unreachable')?.since ?? at }] : rest, unreachable_since: since };
}

// ---------- learning from the queue ----------

const finishedCompanyTasks = (work) => (work.enrichment_queue ?? [])
  .filter((t) => t.kind === 'company' && t.finished_at && ['done', 'skipped', 'failed'].includes(t.status))
  .sort((a, b) => Date.parse(a.finished_at) - Date.parse(b.finished_at) || a.id.localeCompare(b.id));

// Applies every finished task the clocks have not learned from yet. runIds says which run to credit, by job (the
// facet's job, see cadence.js). `onStamp(facet, companyId, row, judged)` lets the caller count what happened.
// Returns { tasks, stamped, gone }.
export function reconcileFromQueue(work, { runIds = {}, onStamp = () => {} } = {}) {
  work.refresh_state ??= [];
  const state = indexState(work.refresh_state);
  const companies = new Map(work.companies.map((c) => [c.id, c]));
  const result = { tasks: 0, stamped: 0, gone: 0 };

  for (const task of finishedCompanyTasks(work)) {
    const company = companies.get(task.target_id);
    if (!company || task.result?.outcome === 'gone') { result.gone += 1; continue; }
    let used = false;
    for (const facet of facetsOfTask(task)) {
      const existing = state.get('company', company.id, facet);
      if (existing && (existing.last_task_id === task.id || (existing.last_attempt_at && Date.parse(task.finished_at) <= Date.parse(existing.last_attempt_at)))) continue;
      const row = existing ?? state.getOrCreate('company', company.id, facet);
      const judged = judge(facet, task, row, company, task.finished_at);
      stampCheck(row, { ...judged, at: task.finished_at, runId: runIds[CADENCE.company[facet].job] ?? null, company });
      if (facet === 'status') noteUnreachable(row, task.finished_at);
      onStamp(facet, company.id, row, judged);
      result.stamped += 1;
      used = true;
    }
    if (used) result.tasks += 1;
  }
  return result;
}

// A row for a company that no longer exists is not kept.
export function dropOrphans(work) {
  const live = new Set(work.companies.map((c) => c.id));
  const before = (work.refresh_state ?? []).length;
  work.refresh_state = (work.refresh_state ?? []).filter((r) => r.scope !== 'company' || live.has(r.target_id));
  return before - work.refresh_state.length;
}

// ---------- websites that asked us to slow down ----------

// Hosts still inside the wait a row set for them.
export function coolingHosts(work, at) {
  return new Set((work.refresh_state ?? [])
    .filter((r) => r.scope === 'host' && r.next_check_at && Date.parse(r.next_check_at) > Date.parse(at))
    .map((r) => r.target_id));
}

// After a run: each host that answered 429 or 503 waits longer each time it does (a day, three, a week, ...), at
// least as long as its own Retry-After; a host that was used and was fine this time starts again from nothing.
export function recordHostCooldowns(work, { asked = [], used = new Set(), at }) {
  work.refresh_state ??= [];
  const state = indexState(work.refresh_state);
  const touched = [];
  for (const { host, retryAfterSeconds } of asked) {
    const row = state.getOrCreate('host', host, 'access');
    stampCheck(row, { at, outcome: 'failed', error: 'asked us to slow down (HTTP 429 or 503)', retryAfterSeconds });
    touched.push(host);
  }
  const askedNow = new Set(asked.map((a) => a.host));
  for (const row of work.refresh_state) {
    if (row.scope !== 'host' || askedNow.has(row.target_id) || !used.has(row.target_id)) continue;
    if (row.next_check_at && Date.parse(row.next_check_at) > Date.parse(at)) continue; // still waiting: it was not really used
    row.failures = 0; row.last_outcome = 'unchanged'; row.last_error = null; row.next_check_at = null;
  }
  return touched;
}

// Brings a row's next check forward to now (a person asked, or something about it needs another look). Not if it
// is due already, nor if it was checked within `recheckAfterDays`: a record that stays in conflict is not re-read
// every run. Says whether it changed the row.
export function makeDue(row, { at, recheckAfterDays = 0 }) {
  if (row.next_check_at == null || Date.parse(row.next_check_at) <= Date.parse(at)) return false;
  if (recheckAfterDays && row.last_checked_at && Date.parse(row.last_checked_at) > Date.parse(addDays(at, -recheckAfterDays))) return false;
  row.next_check_at = at;
  return true;
}
