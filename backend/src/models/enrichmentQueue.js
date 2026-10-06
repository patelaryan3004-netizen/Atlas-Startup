// The enrichment queue: work waiting to be done, so reading a company's own website
// can happen asynchronously, in order of importance, and survive a crash. One task per
// company (or candidate) at a time. The queue is a data collection like the others
// (enrichment_queue.json), changed only through the store's transactions.
//
//   enrichment_queue.json
//   {
//     id, kind ('company' | 'candidate'), target_id,
//     status, priority (higher first), reason,
//     wanted[]                      the fields that are unknown or unchecked: they choose which pages to read
//     created_at, created_by, not_before   not_before: a retry's back-off, or a scheduled start
//     attempts, started_at, finished_at, lease_until, last_error,
//     result                        what the last attempt found, applied, suggested and flagged
//   }
//
// Statuses:  queued -> running -> done | failed | skipped,   and cancelled by a person.
//   done      the site was read (nothing may have been found: that is a result)
//   skipped   there was nothing to read, or the site does not allow it: no website, robots.txt disallows
//   failed    kept failing for a reason that may be ours (network, a bug), after MAX_ATTEMPTS
// A running task holds a lease. A worker that dies leaves it to expire; the next claim counts
// that as a failed attempt and puts the task back.
import { ISO_RE, isStr } from './company.js';

export const QUEUE_STATUSES = ['queued', 'running', 'done', 'failed', 'skipped', 'cancelled'];
export const QUEUE_KINDS = ['company', 'candidate'];
export const QUEUE_REASONS = ['audit', 'approved', 'published', 'manual', 'refresh', 'retry'];
// What a task can ask a website for. 'jobs' are individual postings; hiring_status is the company-level flag.
// Sector, subsector, stage and funding are not here: a company's own site is not a legitimate source for
// them (stage and funding come from the news feeds through discovery), so a task never claims to look for them.
export const WANTABLE = ['website', 'description', 'address', 'city', 'state', 'founded_year', 'founders', 'investors', 'hiring_status', 'jobs'];

export const MAX_ATTEMPTS = 3;
export const BACKOFF_MS = [10 * 60000, 60 * 60000, 6 * 3600000];
export const LEASE_MS = 15 * 60000;
export const REFRESH_DAYS = 30;

const ACTIVE = new Set(['queued', 'running']);
export const isActive = (t) => ACTIVE.has(t.status);
const unique = (list) => [...new Set(list)];
const iso = (ms) => new Date(ms).toISOString();

// Priorities: a person's own request or a newly approved company goes first.
export const PRIORITY = { published: 5000, approved: 4500, manual: 3000, retry: 3000, refresh: 200 };

function nextId(tasks, targetId) {
  const taken = new Set(tasks.map((t) => t.id));
  for (let n = 1; ; n += 1) { const id = `enq-${targetId}-${n}`; if (!taken.has(id)) return id; }
}

export function enqueueTask(work, { kind, targetId, priority = PRIORITY.manual, reason = 'manual', wanted = [], by, at, notBefore = null, status = 'queued', lastError = null, result = null }) {
  work.enrichment_queue ??= [];
  const existing = work.enrichment_queue.find((t) => t.kind === kind && t.target_id === targetId && isActive(t));
  if (existing && status === 'queued') {
    // One active task per target: a second request raises its priority and widens what it wants.
    existing.priority = Math.max(existing.priority, priority);
    existing.wanted = unique([...existing.wanted, ...wanted]);
    return { task: existing, created: false };
  }
  const task = {
    id: nextId(work.enrichment_queue, targetId), kind, target_id: targetId, status, priority, reason, wanted: unique(wanted),
    created_at: at, created_by: by, not_before: notBefore, attempts: 0,
    started_at: null, finished_at: status === 'queued' ? null : at, lease_until: null, last_error: lastError, result,
  };
  work.enrichment_queue.push(task);
  return { task, created: true };
}

const find = (work, id) => {
  const t = (work.enrichment_queue ?? []).find((x) => x.id === id);
  if (!t) throw new Error(`no enrichment task "${id}"`);
  return t;
};

// Running tasks whose lease ran out: the worker that held them is gone. Counts as a failed attempt.
export function recoverExpired(work, at) {
  const recovered = [];
  for (const t of work.enrichment_queue ?? []) {
    if (t.status === 'running' && t.lease_until && Date.parse(t.lease_until) <= Date.parse(at)) {
      failTask(work, t.id, { at, error: 'the worker stopped before finishing (lease expired)', retryable: true });
      recovered.push(t.id);
    }
  }
  return recovered;
}

export function claimNext(work, { at, leaseMs = LEASE_MS, kinds = null }) {
  recoverExpired(work, at);
  const now = Date.parse(at);
  const ready = (work.enrichment_queue ?? [])
    .filter((t) => t.status === 'queued' && (!t.not_before || Date.parse(t.not_before) <= now) && (!kinds || kinds.includes(t.kind)))
    .sort((a, b) => b.priority - a.priority || Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id));
  const task = ready[0];
  if (!task) return null;
  Object.assign(task, { status: 'running', started_at: at, finished_at: null, lease_until: iso(now + leaseMs) });
  return task;
}

export function finishTask(work, id, { at, status = 'done', result = null, error = null }) {
  if (!['done', 'skipped'].includes(status)) throw new Error(`a task finishes as done or skipped, not ${status}`);
  const t = find(work, id);
  Object.assign(t, { status, finished_at: at, lease_until: null, last_error: error, result, not_before: null });
  return t;
}

// retryable: a network error or timeout is worth another try later; the back-off grows.
export function failTask(work, id, { at, error, retryable = true }) {
  const t = find(work, id);
  t.attempts += 1;
  t.last_error = String(error).slice(0, 300);
  t.lease_until = null;
  if (retryable && t.attempts < MAX_ATTEMPTS) {
    Object.assign(t, { status: 'queued', started_at: null, finished_at: null, not_before: iso(Date.parse(at) + BACKOFF_MS[Math.min(t.attempts, BACKOFF_MS.length) - 1]) });
  } else {
    Object.assign(t, { status: 'failed', finished_at: at, not_before: null });
  }
  return t;
}

export function cancelTask(work, id, { at }) {
  const t = find(work, id);
  if (!isActive(t)) throw new Error(`task ${id} is ${t.status}: only a queued or running task can be cancelled`);
  Object.assign(t, { status: 'cancelled', finished_at: at, lease_until: null, not_before: null });
  return t;
}

// A failed, cancelled or skipped task, tried again from the start.
export function requeueTask(work, id, { at, priority = PRIORITY.retry }) {
  const t = find(work, id);
  if (isActive(t) || t.status === 'done') throw new Error(`task ${id} is ${t.status}: only a failed, cancelled or skipped task can be retried`);
  if (work.enrichment_queue.some((x) => x.id !== id && x.kind === t.kind && x.target_id === t.target_id && isActive(x))) {
    throw new Error(`${t.target_id} already has a task waiting`);
  }
  Object.assign(t, { status: 'queued', attempts: 0, started_at: null, finished_at: null, lease_until: null, last_error: null, not_before: null, reason: 'retry', priority: Math.max(t.priority, priority), created_at: at });
  return t;
}

// ---------- seeding ----------

// What each gap in the completeness audit is asking a website for. A gap with no entry
// (stage, funding, a missing website) cannot be filled from a company's own site.
const WANTS = {
  unconfirmed_location: ['address', 'city', 'state'], unknown_city: ['address', 'city'], missing_state: ['address', 'state'], approximate_pin: ['address'],
  missing_description: ['description'], stale_hiring: ['hiring_status', 'jobs'],
  missing_founders: ['founders'], missing_founded_year: ['founded_year'], missing_investors: ['investors'], no_source: ['website'],
};

const lastTask = (tasks, kind, targetId) => tasks.filter((t) => t.kind === kind && t.target_id === targetId).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];

// Puts the existing companies on the queue in the order the completeness audit ranks them:
// integrity problems and core gaps first, a company with no gaps last. A company with no
// website gets a 'skipped' task that says so (so the reason is visible in one place) and is
// queued properly once a website is added. A company checked within refreshDays is left
// alone unless force is set.
export function seedFromAudit(work, audit, { at, by, refreshDays = REFRESH_DAYS, force = false, limit = Infinity }) {
  work.enrichment_queue ??= [];
  const report = { queued: 0, no_website: 0, fresh: 0, already_queued: 0, limited: 0 };
  const rank = new Map(audit.queue.map((q) => [q.company_id, q]));
  const byId = new Map(work.companies.map((c) => [c.id, c]));
  const order = [...audit.companies].sort((a, b) => (rank.get(a.id)?.rank ?? Infinity) - (rank.get(b.id)?.rank ?? Infinity));
  const freshAfter = Date.parse(at) - refreshDays * 86400000;

  for (const a of order) {
    const company = byId.get(a.id);
    if (!company) continue;
    const entry = rank.get(a.id);
    const priority = entry ? (4 - Number(entry.priority.slice(1))) * 1000 + Math.min(entry.score, 999) : 100;
    const wanted = unique([...(entry?.tasks ?? []).flatMap((t) => WANTS[t.code] ?? []), 'website']);

    if (work.enrichment_queue.some((t) => t.kind === 'company' && t.target_id === a.id && isActive(t))) { report.already_queued += 1; continue; }
    const previous = lastTask(work.enrichment_queue, 'company', a.id);
    if (a.states.website !== 'present') {
      if (previous?.status === 'skipped' && previous.result?.outcome === 'no_website') continue;
      enqueueTask(work, { kind: 'company', targetId: a.id, priority, reason: 'audit', wanted, by, at, status: 'skipped', lastError: 'no website on record: add one (an investor portfolio page is a good start), then seed again', result: { outcome: 'no_website' } });
      report.no_website += 1;
      continue;
    }
    if (!force) {
      const doneAt = previous?.status === 'done' ? Date.parse(previous.finished_at) : -Infinity;
      const verifiedAt = company.last_verified_at ? Date.parse(company.last_verified_at) : -Infinity;
      if (Math.max(doneAt, verifiedAt) > freshAfter) { report.fresh += 1; continue; }
    }
    if (report.queued >= limit) { report.limited += 1; continue; }
    enqueueTask(work, { kind: 'company', targetId: a.id, priority, reason: 'audit', wanted, by, at });
    report.queued += 1;
  }
  return report;
}

// ---------- new companies join the same queue ----------

const WEBSITE_SOURCES = new Set(['company_website', 'company_document']);

// A candidate a person has approved: its website is read before it is published, unless the discovery
// engine already read it. Nothing is queued for a candidate with no website.
export function enqueueForApproved(work, candidate, { by, at }) {
  if (!candidate.website || candidate.evidence.some((e) => WEBSITE_SOURCES.has(e.source?.kind))) return null;
  return enqueueTask(work, { kind: 'candidate', targetId: candidate.id, priority: PRIORITY.approved, reason: 'approved', wanted: WANTABLE, by, at }).task;
}

// A company that has just been published: read by the same pipeline as every other, ahead of the rest.
export function enqueueForPublished(work, company, { by, at }) {
  if (!company.website) return null;
  return enqueueTask(work, { kind: 'company', targetId: company.id, priority: PRIORITY.published, reason: 'published', wanted: WANTABLE, by, at }).task;
}

// The most recent task for each company or candidate: what is true of it now. Older tasks are history.
export function latestTasks(tasks) {
  const latest = new Map();
  for (const t of tasks) {
    const key = `${t.kind}:${t.target_id}`;
    const prior = latest.get(key);
    if (!prior || Date.parse(t.created_at) >= Date.parse(prior.created_at)) latest.set(key, t);
  }
  return [...latest.values()];
}

export function queueSummary(tasks, at = new Date().toISOString()) {
  const counts = Object.fromEntries(QUEUE_STATUSES.map((s) => [s, 0]));
  for (const t of tasks) counts[t.status] += 1;
  const queued = tasks.filter((t) => t.status === 'queued');
  const waiting = queued.filter((t) => !t.not_before || Date.parse(t.not_before) <= Date.parse(at));
  return {
    counts, total: tasks.length, ready: waiting.length, backing_off: queued.length - waiting.length,
    oldest_ready: waiting.map((t) => t.created_at).sort()[0] ?? null,
  };
}

// ---------- validation ----------

export function validateEnrichmentQueue(ds) {
  const errors = [];
  const bad = (where, msg) => errors.push(`${where}: ${msg}`);
  const companies = new Set(ds.companies.map((c) => c.id));
  const candidates = new Set((ds.candidates ?? []).map((c) => c.id));
  const seen = new Set();
  const active = new Set();
  const isoOrNull = (v) => v == null || ISO_RE.test(v);
  for (const t of ds.enrichment_queue ?? []) {
    const at = `enrichment task "${t.id}"`;
    if (!isStr(t.id) || !/^enq-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(t.id)) bad('enrichment_queue', `invalid id ${JSON.stringify(t.id)}`);
    else if (seen.has(t.id)) bad(at, 'duplicate id');
    seen.add(t.id);
    if (!QUEUE_KINDS.includes(t.kind)) bad(at, `invalid kind "${t.kind}"`);
    else if (!(t.kind === 'company' ? companies : candidates).has(t.target_id)) bad(at, `unknown ${t.kind} "${t.target_id}"`);
    if (!QUEUE_STATUSES.includes(t.status)) bad(at, `invalid status "${t.status}"`);
    if (!QUEUE_REASONS.includes(t.reason)) bad(at, `invalid reason "${t.reason}"`);
    if (typeof t.priority !== 'number' || !Number.isFinite(t.priority)) bad(at, 'priority must be a number');
    if (!Array.isArray(t.wanted) || t.wanted.some((w) => !WANTABLE.includes(w))) bad(at, `wanted must be a list of ${WANTABLE.join(', ')}`);
    if (!ISO_RE.test(t.created_at ?? '') || !isStr(t.created_by)) bad(at, 'needs an ISO created_at and a created_by');
    for (const k of ['not_before', 'started_at', 'finished_at', 'lease_until']) if (!isoOrNull(t[k])) bad(at, `${k} must be ISO-8601 UTC or null`);
    if (!Number.isInteger(t.attempts) || t.attempts < 0) bad(at, 'attempts must be a whole number');
    if (t.status === 'running' && (t.started_at == null || t.lease_until == null)) bad(at, 'a running task needs started_at and lease_until');
    if (['done', 'failed', 'skipped', 'cancelled'].includes(t.status) && t.finished_at == null) bad(at, `${t.status} needs finished_at`);
    if ((t.status === 'queued' || t.status === 'running') && t.finished_at != null) bad(at, `${t.status} must not have finished_at`);
    if (isActive(t)) {
      const key = `${t.kind}:${t.target_id}`;
      if (active.has(key)) bad(at, `${t.target_id} has more than one task waiting or running`);
      active.add(key);
    }
  }
  return errors;
}
