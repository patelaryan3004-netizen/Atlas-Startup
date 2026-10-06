// The scheduler's run log: one row for every run of every job, including a run that found nothing to do, one
// that was refused because another was still going, and one that died (it is marked as such by the next run).
// "Did the refresh work?" has an answer that outlives the terminal.
//
//   job_runs.json
//   {
//     id, tick_id, job, trigger ('cli' | 'ci' | 'loop' | 'admin'), by, mode ('suggest' | 'fill' | null), dry_run,
//     started_at, finished_at,
//     status      running (not finished), ok, partial (some failed), failed (the job itself broke or all failed),
//                 idle (nothing was due), skipped (not run: disabled, or another tick held the lock)
//     due, processed, changed, failed, deferred    how many were due, read, found something new, failed, left for a later run
//     requests, budget { max_requests, max_sites, max_minutes, stopped_for },
//     summary     one line a person can read, details  what only this job reports, error
//   }
//
// This is a log, not the audit trail: it is not append-only, and idle rows are dropped after a month so a job
// that runs every few hours does not fill the file. A run that changed data also leaves a row in the audit trail.
import { ISO_RE, isStr } from './company.js';

export const JOBS = ['discovery', 'funding', 'hiring', 'status', 'enrichment', 'quality'];
export const RUN_STATUSES = ['running', 'ok', 'partial', 'failed', 'idle', 'skipped'];
export const RUN_TRIGGERS = ['cli', 'ci', 'loop', 'admin'];
export const IDLE_KEEP_DAYS = 30;
export const RUN_KEEP_DAYS = 365;

const DAY = 86400000;

export function jobRunId(rows, at, job) {
  const prefix = `jr-${at.replace(/\D/g, '')}-${job}`;
  const taken = new Set(rows.map((r) => r.id));
  let id = prefix;
  for (let n = 2; taken.has(id); n += 1) id = `${prefix}-${n}`;
  return id;
}

export const tickIdOf = (at) => `tick-${at.replace(/\D/g, '')}`;

// A run that has started: the row exists before the work does, so a run that dies still left a record.
export function startJobRun(rows, { job, tickId, at, trigger = 'cli', by = 'scheduler', mode = null, dryRun = false }) {
  const row = {
    id: jobRunId(rows, at, job), tick_id: tickId, job, trigger, by, mode, dry_run: dryRun,
    started_at: at, finished_at: null, status: 'running',
    due: 0, processed: 0, changed: 0, failed: 0, deferred: 0, requests: 0,
    budget: null, summary: '', details: null, error: null,
  };
  rows.push(row);
  return row;
}

export function finishJobRun(row, { at, status, due = 0, processed = 0, changed = 0, failed = 0, deferred = 0, requests = 0, budget = null, summary = '', details = null, error = null }) {
  Object.assign(row, { finished_at: at, status, due, processed, changed, failed, deferred, requests, budget, summary: String(summary).slice(0, 300), details, error: error == null ? null : String(error).slice(0, 300) });
  return row;
}

// Rows still 'running' that no live tick owns: the process stopped. Said so, by the next run.
export function closeInterrupted(rows, { at, ownTickId = null }) {
  const closed = [];
  for (const r of rows) {
    if (r.status !== 'running' || r.tick_id === ownTickId) continue;
    finishJobRun(r, { at, status: 'failed', error: 'the run stopped before it finished (the process ended or was stopped)', summary: 'Interrupted' });
    closed.push(r.id);
  }
  return closed;
}

// What each job last did, for the status view: its newest row.
export function lastRunByJob(rows) {
  const latest = new Map();
  for (const r of rows) {
    const prior = latest.get(r.job);
    if (!prior || Date.parse(r.started_at) >= Date.parse(prior.started_at)) latest.set(r.job, r);
  }
  return Object.fromEntries(latest);
}

// Idle and skipped rows older than a month, and anything older than a year, are dropped. Returns the rows kept
// and how many went.
export function pruneJobRuns(rows, { at, idleDays = IDLE_KEEP_DAYS, keepDays = RUN_KEEP_DAYS }) {
  const now = Date.parse(at);
  const keep = rows.filter((r) => {
    const age = now - Date.parse(r.started_at);
    if (age > keepDays * DAY) return false;
    if ((r.status === 'idle' || r.status === 'skipped') && age > idleDays * DAY) return false;
    return true;
  });
  return { rows: keep, dropped: rows.length - keep.length };
}

export function validateJobRuns(ds) {
  const errors = [];
  const bad = (where, msg) => errors.push(`${where}: ${msg}`);
  const seen = new Set();
  const count = (v) => Number.isInteger(v) && v >= 0;
  for (const r of ds.job_runs ?? []) {
    const at = `job run "${r.id}"`;
    if (!isStr(r.id) || !/^jr-\d+-[a-z]+(?:-\d+)?$/.test(r.id)) bad('job_runs', `invalid id ${JSON.stringify(r.id)}`);
    else if (seen.has(r.id)) bad(at, 'duplicate id');
    seen.add(r.id);
    if (!JOBS.includes(r.job)) bad(at, `unknown job "${r.job}"`);
    if (!RUN_STATUSES.includes(r.status)) bad(at, `invalid status "${r.status}"`);
    if (!RUN_TRIGGERS.includes(r.trigger)) bad(at, `invalid trigger "${r.trigger}"`);
    if (!isStr(r.tick_id) || !isStr(r.by)) bad(at, 'needs a tick_id and a by');
    if (r.mode != null && !['suggest', 'fill'].includes(r.mode)) bad(at, `invalid mode "${r.mode}"`);
    if (!ISO_RE.test(r.started_at ?? '')) bad(at, 'started_at must be ISO-8601 UTC');
    if (r.status === 'running') {
      if (r.finished_at != null) bad(at, 'a running row has no finished_at');
    } else if (!ISO_RE.test(r.finished_at ?? '')) bad(at, 'finished_at must be ISO-8601 UTC');
    else if (Date.parse(r.finished_at) < Date.parse(r.started_at)) bad(at, 'finished_at is before started_at');
    for (const k of ['due', 'processed', 'changed', 'failed', 'deferred', 'requests']) if (!count(r[k])) bad(at, `${k} must be a whole number`);
    if (r.status === 'failed' && !isStr(r.error)) bad(at, 'a failed run says why');
    if (typeof r.summary !== 'string') bad(at, 'summary must be a string');
    if (r.details != null && (typeof r.details !== 'object' || Array.isArray(r.details))) bad(at, 'details must be an object or null');
  }
  return errors;
}
