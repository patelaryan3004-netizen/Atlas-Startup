// Refresh state: for each thing the scheduler keeps fresh, when it was last looked at, when a source last
// confirmed it, when it last actually changed, and when it is next due. The scheduler (src/scheduler) is the
// only writer, through the store's transactions; nothing public reads it.
//
//   refresh_state.json
//   {
//     id, scope, target_id, facet,
//     last_checked_at      the last check that worked: a page was read, a feed answered
//     last_verified_at     the last time a source gave a positive reading of this facet (a claim read, or a claim
//                          confirmed again). A check that finds nothing is checked but not verified
//     last_changed_at      the last time a check found something new (a claim, a role opened or closed, a signal)
//     next_check_at        when it is next due; null means "due now" (never checked, or a person asked)
//     last_attempt_at      the last try, whether or not it worked
//     checks, unchanged_streak, failures   how many checks, how many in a row found nothing new, how many
//                          attempts in a row failed. A long streak lengthens the interval; failures back off
//     last_outcome, last_error, last_task_id, last_run_id
//     meta                 what only one facet needs: the signals seen on a company's site, or a source's note
//   }
//
// One row per (scope, target, facet), so a move to a real database is a table with that composite key.
//
//   company:  hiring (roles and the hiring flag), status (acquired, closed, renamed), description, profile
//             (address, city, state, founders, investors) and founded_year are read from the company's own site
//             at different cadences; funding is event-driven: a row exists once a story about the company was found
//   source:   a feed or queue the discovery and funding jobs read; 'quality' is the data-quality job itself
//   host:     'access': a website that told us to slow down, so it is left alone for longer each time
import { ISO_RE, isStr } from './company.js';

export const REFRESH_SCOPES = ['company', 'source', 'host'];
export const FACETS_BY_SCOPE = {
  company: ['hiring', 'status', 'description', 'profile', 'founded_year', 'funding'],
  source: ['funding', 'discovery', 'quality'],
  host: ['access'],
};
export const REFRESH_OUTCOMES = [
  'read', 'changed', 'unchanged', 'incomplete', 'no_website', 'refused', 'mismatch', 'blocked', 'unreachable', 'failed', 'gone',
];

const MAX_META = 8000;

export const stateId = (scope, targetId, facet) => `rs-${scope}-${targetId}-${facet}`;

export function emptyState(scope, targetId, facet) {
  return {
    id: stateId(scope, targetId, facet), scope, target_id: targetId, facet,
    last_checked_at: null, last_verified_at: null, last_changed_at: null, next_check_at: null, last_attempt_at: null,
    checks: 0, unchanged_streak: 0, failures: 0,
    last_outcome: null, last_error: null, last_task_id: null, last_run_id: null, meta: null,
  };
}

// The rows by id, for looking one up without scanning the file. Rows added to `rows` later are not in it:
// use getOrCreate, which adds to both.
export function indexState(rows) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    rows, byId,
    get: (scope, targetId, facet) => byId.get(stateId(scope, targetId, facet)) ?? null,
    getOrCreate(scope, targetId, facet) {
      const id = stateId(scope, targetId, facet);
      let row = byId.get(id);
      if (!row) { row = emptyState(scope, targetId, facet); rows.push(row); byId.set(id, row); }
      return row;
    },
    remove(id) {
      if (!byId.delete(id)) return;
      rows.splice(rows.findIndex((r) => r.id === id), 1);
    },
  };
}

export function validateRefreshState(ds) {
  const errors = [];
  const bad = (where, msg) => errors.push(`${where}: ${msg}`);
  const companies = new Set(ds.companies.map((c) => c.id));
  const seen = new Set();
  const isoOrNull = (v) => v == null || ISO_RE.test(v);
  const count = (v) => Number.isInteger(v) && v >= 0;
  for (const r of ds.refresh_state ?? []) {
    const at = `refresh state "${r.id}"`;
    if (!REFRESH_SCOPES.includes(r.scope)) { bad(at, `invalid scope "${r.scope}"`); continue; }
    if (!FACETS_BY_SCOPE[r.scope].includes(r.facet)) bad(at, `"${r.facet}" is not a facet of a ${r.scope}`);
    if (!isStr(r.target_id)) bad(at, 'needs a target_id');
    else if (r.id !== stateId(r.scope, r.target_id, r.facet)) bad(at, `id should be "${stateId(r.scope, r.target_id, r.facet)}"`);
    if (seen.has(r.id)) bad(at, 'duplicate id');
    seen.add(r.id);
    if (r.scope === 'company' && isStr(r.target_id) && !companies.has(r.target_id)) bad(at, `unknown company "${r.target_id}"`);
    for (const k of ['last_checked_at', 'last_verified_at', 'last_changed_at', 'next_check_at', 'last_attempt_at']) if (!isoOrNull(r[k])) bad(at, `${k} must be ISO-8601 UTC or null`);
    for (const k of ['checks', 'unchanged_streak', 'failures']) if (!count(r[k])) bad(at, `${k} must be a whole number`);
    if (r.last_outcome != null && !REFRESH_OUTCOMES.includes(r.last_outcome)) bad(at, `invalid last_outcome "${r.last_outcome}"`);
    for (const k of ['last_error', 'last_task_id', 'last_run_id']) if (r[k] != null && typeof r[k] !== 'string') bad(at, `${k} must be a string or null`);
    if (r.meta != null && (typeof r.meta !== 'object' || Array.isArray(r.meta) || JSON.stringify(r.meta).length > MAX_META)) bad(at, `meta must be a small object or null (under ${MAX_META} characters)`);
    if (r.last_verified_at && !r.last_checked_at) bad(at, 'last_verified_at is set but nothing was ever checked');
  }
  return errors;
}
