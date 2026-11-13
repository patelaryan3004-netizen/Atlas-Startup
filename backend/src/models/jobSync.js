// The hourly job sync's two collections.
//
//   job_sources.json     the employers' job boards the sync reads, one row per board: which company it is, which provider and token, and WHY it is trusted.
//                        { id, company_id, provider, token, board_url, status, basis, note, added_at }
//                        id is the sources.json row that says the company's own careers page links to the board (sources.json is how a board is approved: the reader only
//                        counts a board the company's own site points at). status: 'approved' (polled), 'review' (named by someone but not confirmed from the employer's own
//                        page: never polled, never guessed), 'paused' (a person stopped it). A review row has no sources.json row.
//   job_sync_state.json  what the sync knows about each board right now, one row per source id: when it last tried, when it last read the whole board, the failures in a row,
//                        when it may try again, and what the last read found. It is the lock-step with jobs.json: a role's dates move only through a row here that says a read succeeded.
//                        { source_id, last_attempt_at, last_success_at, next_attempt_at, consecutive_failures, last_error, empty_reads, last_run_id, last_counts, pages, attempts }
import { ISO_RE, isStr } from './company.js';

export const SOURCE_STATUSES = ['approved', 'review', 'paused'];
export const SOURCE_PROVIDERS = ['greenhouse', 'lever', 'workable', 'ashby', 'recruitee', 'smartrecruiters'];

const when = (v) => v == null || ISO_RE.test(v);

export function validateJobSources(ds) {
  const errors = [];
  const bad = (where, msg) => errors.push(`${where}: ${msg}`);
  const companies = new Set((ds.companies ?? []).map((c) => c.id));
  const sourceIds = new Set((ds.sources ?? []).map((s) => s.id));
  const seen = new Set();
  for (const r of ds.job_sources ?? []) {
    const at = `job source "${r.id}"`;
    if (!isStr(r.id)) { bad('job_sources', `invalid id ${JSON.stringify(r.id)}`); continue; }
    if (seen.has(r.id)) bad(at, 'duplicate id');
    seen.add(r.id);
    if (!companies.has(r.company_id)) bad(at, `unknown company_id "${r.company_id}"`);
    if (!SOURCE_PROVIDERS.includes(r.provider)) bad(at, `unknown provider "${r.provider}"`);
    if (!isStr(r.token) || !/^[A-Za-z0-9][A-Za-z0-9_.-]{1,80}$/.test(r.token)) bad(at, 'token must be the board\'s name');
    if (!/^https:\/\/\S+$/.test(r.board_url ?? '')) bad(at, 'board_url must be https');
    if (!SOURCE_STATUSES.includes(r.status)) bad(at, `invalid status "${r.status}"`);
    if (r.status === 'approved' && !sourceIds.has(r.id)) bad(at, 'an approved board is one the company\'s own careers page links to: there must be a sources.json row with this id');
    if (!isStr(r.basis)) bad(at, 'basis says why the board is trusted, or why it is not yet');
  }
  return errors;
}

export function validateJobSyncState(ds) {
  const errors = [];
  const bad = (where, msg) => errors.push(`${where}: ${msg}`);
  const known = new Set((ds.job_sources ?? []).map((s) => s.id));
  const seen = new Set();
  for (const r of ds.job_sync_state ?? []) {
    const at = `job sync state "${r.source_id}"`;
    if (!isStr(r.source_id)) { bad('job_sync_state', 'a row needs a source_id'); continue; }
    if (seen.has(r.source_id)) bad(at, 'duplicate row');
    seen.add(r.source_id);
    if (!known.has(r.source_id)) bad(at, 'no such job source');
    for (const k of ['last_attempt_at', 'last_success_at', 'next_attempt_at']) if (!when(r[k])) bad(at, `${k} must be ISO-8601 UTC or null`);
    if (!Number.isInteger(r.consecutive_failures) || r.consecutive_failures < 0) bad(at, 'consecutive_failures must be a whole number');
    if (r.last_error != null && (typeof r.last_error !== 'object' || !isStr(r.last_error.code))) bad(at, 'last_error is { code, message, at } or null');
    if (r.last_success_at && r.last_attempt_at && Date.parse(r.last_success_at) > Date.parse(r.last_attempt_at)) bad(at, 'a success cannot be after the last attempt');
  }
  return errors;
}
