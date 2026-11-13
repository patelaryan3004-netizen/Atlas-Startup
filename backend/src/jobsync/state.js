// When each board may be read again, and what happened the last time. Rows of job_sync_state.json (models/jobSync.js), one per source.
//
//   after a whole read      the next try is SUCCESS_WAIT_MS later (a little under an hour, so an hourly timer that fires a minute early or late never skips a round)
//   after a failure         the wait grows on a ladder, 15 minutes up to a day, and a provider's own Retry-After is never undercut
//   a failure never         changes a role, moves a date, or counts as a read. It only says so here, and when to try again.
export const SUCCESS_WAIT_MS = 55 * 60 * 1000;
export const BACKOFF_MS = [15, 60, 180, 360, 720, 1440].map((m) => m * 60000);
export const MAX_RETRY_AFTER_MS = 24 * 3600 * 1000;
// A board that lists nothing, when we hold open roles for it, is believed only if it is still empty at a read this long after the first empty one.
export const EMPTY_CONFIRM_MS = 10 * 60000;
// A board that has failed this many times in a row is called out in the status view: a person should look.
export const ATTENTION_FAILURES = 3;

const iso = (ms) => new Date(ms).toISOString();

export function stateRow(rows, sourceId) {
  let row = rows.find((r) => r.source_id === sourceId);
  if (!row) {
    row = { source_id: sourceId, last_attempt_at: null, last_success_at: null, next_attempt_at: null, consecutive_failures: 0, last_error: null, empty_reads: 0, last_run_id: null, last_counts: null, pages: 0, attempts: 0 };
    rows.push(row);
  }
  return row;
}

export const isDue = (row, now) => !row?.next_attempt_at || Date.parse(row.next_attempt_at) <= now;

export function noteSuccess(row, { at, counts, runId, pages = 1, attempts = 1 }) {
  Object.assign(row, {
    last_attempt_at: at, last_success_at: at, next_attempt_at: iso(Date.parse(at) + SUCCESS_WAIT_MS), consecutive_failures: 0, last_error: null, empty_reads: 0, empty_first_at: null,
    last_run_id: runId ?? null, last_counts: counts, pages, attempts,
  });
}

export function noteFailure(row, { at, error, runId, attempts = 1 }) {
  const failures = row.consecutive_failures + 1;
  const ladder = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1];
  const asked = Math.min(MAX_RETRY_AFTER_MS, (error.retryAfterSeconds ?? 0) * 1000);
  // A board that is not there, or refuses us, is not tried again soon: a person is told (ATTENTION_FAILURES) and it waits the longest step.
  const wait = error.transient === false ? BACKOFF_MS[BACKOFF_MS.length - 1] : Math.max(ladder, asked);
  Object.assign(row, {
    last_attempt_at: at, next_attempt_at: iso(Date.parse(at) + wait), consecutive_failures: failures,
    last_error: { code: error.code, message: String(error.message).slice(0, 200), at, transient: error.transient !== false }, last_run_id: runId ?? null, attempts,
  });
}

// Why a row is flagged for a person.
export const needsAttention = (row) => Boolean(row && row.consecutive_failures >= ATTENTION_FAILURES);
