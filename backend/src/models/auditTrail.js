// The audit trail: an append-only record of every decision a person (or the
// pipeline) makes about the data. One row per action, written in the SAME write as
// the change it describes, so an action and its record are both there or neither is
// (see store.js). Rows are never edited or removed: the store refuses a write that
// would change an existing row.
//
//   audit_trail.json
//   {
//     id, at,                      when, ISO-8601 UTC
//     actor, role, via,            who (a name), their role, and the door they used
//     action,                      one of AUDIT_ACTIONS
//     target { type, id },         what it was done to
//     summary,                     one line a person can read
//     reason,                      the note the actor gave, or null
//     changes[{ field, from, to }] what moved, for edits and fills
//   }
//
// This is not the data-completeness audit (audit.js): that measures the data, this
// records what was done to it.
import { ISO_RE, isStr } from './company.js';

export const AUDIT_ROLES = ['viewer', 'reviewer', 'admin', 'system', 'cli'];
export const AUDIT_VIA = ['admin-ui', 'cli', 'worker'];
export const AUDIT_TARGET_TYPES = ['candidate', 'company', 'evidence', 'queue', 'import_run', 'system'];
export const AUDIT_ACTIONS = [
  'candidate.approve', 'candidate.reject', 'candidate.reopen', 'candidate.edit', 'candidate.note',
  'candidate.distinct', 'candidate.merge', 'candidate.publish', 'candidate.enrich',
  'company.rename',
  'conflict.resolve', 'suggestion.apply', 'suggestion.dismiss',
  'enrichment.seed', 'enrichment.enqueue', 'enrichment.task', 'enrichment.retry', 'enrichment.cancel', 'enrichment.run',
  'import.run', 'import.dismiss',
];

const CLOCK_TOLERANCE_MS = 10 * 60000;
const MAX_TEXT = 300;
const clip = (v) => (typeof v === 'string' && v.length > MAX_TEXT ? `${v.slice(0, MAX_TEXT - 3)}...` : v);
// A change value is kept small: a long description is clipped, a long list is cut.
export function clipValue(v) {
  if (Array.isArray(v)) return v.slice(0, 20).map(clipValue);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).slice(0, 20).map(([k, x]) => [k, clipValue(x)]));
  return clip(v);
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// The fields of `after` that differ from `before`, as the audit trail records them.
export function diffChanges(before, after, fields) {
  return fields.filter((f) => !same(before?.[f], after?.[f])).map((field) => ({ field, from: clipValue(before?.[field] ?? null), to: clipValue(after?.[field] ?? null) }));
}

export function makeAuditRow(entry, id, at) {
  const { actor, role, via, action, target, summary, reason = null, changes = [] } = entry;
  return {
    id, at, actor: actor?.name ?? actor, role: actor?.role ?? role, via, action,
    target: { type: target.type, id: target.id },
    summary: clip(String(summary)), reason: reason == null ? null : clip(String(reason)),
    changes: changes.map((c) => ({ field: c.field, from: clipValue(c.from ?? null), to: clipValue(c.to ?? null) })),
  };
}

// Adds rows to the end of work.audit_trail. Ids are readable and sort by time:
// aud-<yyyymmddhhmmssmmm>-<n>.
export function appendAudit(work, entries, at) {
  work.audit_trail ??= [];
  const prefix = `aud-${at.replace(/\D/g, '')}`;
  let n = work.audit_trail.filter((r) => r.id.startsWith(`${prefix}-`)).length;
  const rows = [];
  for (const entry of entries) {
    n += 1;
    const row = makeAuditRow(entry, `${prefix}-${n}`, at);
    work.audit_trail.push(row);
    rows.push(row);
  }
  return rows;
}

export function validateAuditTrail(ds) {
  const errors = [];
  const bad = (where, msg) => errors.push(`${where}: ${msg}`);
  const seen = new Set();
  let previous = null;
  for (const [i, r] of (ds.audit_trail ?? []).entries()) {
    const at = `audit_trail[${i}] "${r.id}"`;
    if (!isStr(r.id) || !/^aud-\d+-\d+$/.test(r.id)) bad(at, 'invalid id');
    else if (seen.has(r.id)) bad(at, 'duplicate id');
    seen.add(r.id);
    if (!ISO_RE.test(r.at ?? '')) bad(at, 'at must be an ISO-8601 UTC timestamp');
    else {
      // Position, not the clock, is what puts the trail in order (it is append-only), so a clock that stepped back
      // a little (an NTP adjustment, two machines writing to one repository) must not stop every later write. Only
      // an entry far earlier than the one before it is wrong: rows spliced in from somewhere else.
      if (previous != null && Date.parse(r.at) < Date.parse(previous) - CLOCK_TOLERANCE_MS) bad(at, 'is much earlier than the entry before it: the trail is in time order');
      previous = r.at;
    }
    if (!isStr(r.actor) || r.actor.length > 80) bad(at, 'actor must be a name');
    if (!AUDIT_ROLES.includes(r.role)) bad(at, `invalid role "${r.role}"`);
    if (!AUDIT_VIA.includes(r.via)) bad(at, `invalid via "${r.via}"`);
    if (!AUDIT_ACTIONS.includes(r.action)) bad(at, `unknown action "${r.action}"`);
    if (!AUDIT_TARGET_TYPES.includes(r.target?.type) || !isStr(r.target?.id)) bad(at, 'target needs a type and an id');
    if (!isStr(r.summary)) bad(at, 'summary is required');
    if (r.reason != null && typeof r.reason !== 'string') bad(at, 'reason must be a string or null');
    if (!Array.isArray(r.changes) || r.changes.some((c) => !isStr(c?.field))) bad(at, 'changes must be a list of { field, from, to }');
  }
  return errors;
}
