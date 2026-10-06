// The Command Center's actions and reads, with no HTTP in them: a person (name and role) and what they ask.
//
// Every change is ONE transaction (store.js): it checks the person may do it, makes the change on a fresh copy
// of the data, and writes the change and its audit row together, or neither. So an action that is refused, or
// fails a check, leaves no trace; and an action that happened always has its record. One action, one audit row.
//
// The person is whoever the sign-in said they are. Nothing here reads who did it from the request body.
//
// Candidates are staging data and never public; what reaches a company (merge, publish, a settled conflict, an
// applied suggestion) is the admin's, and the role check is made here, not only in a route.
import { transact, snapshot, DataLockError, DataChangedError, DataValidationError } from '../models/store.js';
import { diffChanges } from '../models/auditTrail.js';
import { auditDataset } from '../models/audit.js';
import { seedFromAudit, enqueueTask, enqueueForApproved, enqueueForPublished, requeueTask, cancelTask, WANTABLE, PRIORITY } from '../models/enrichmentQueue.js';
import { approveCandidate, rejectCandidate, reopenCandidate, markDistinct, mergeCandidate, editCandidate, EDITABLE } from '../discovery/review.js';
import { publishCandidate } from '../discovery/publish.js';
import { createFetcher, DEFAULT_USER_AGENT } from '../discovery/http.js';
import { runQueue } from '../enrichment/worker.js';
import { MODES } from '../enrichment/policy.js';
import { resolveConflict, applySuggestion, dismissSuggestion, reasonOf } from './decisions.js';
import { buildOverview, listCandidates, candidateDetail, searchCompanies, missingData, companyDuplicates, listConflicts, listSuggestions, queuePanel, importsPanel, schedulerPanel, auditPage } from './overview.js';
import { requireRole } from './roles.js';
import { createJobRunner } from './jobs.js';
import { HttpError, BadRequestError, NotFoundError, ConflictError } from './errors.js';

const ID_RE = /^[a-z0-9][a-z0-9-]{0,119}$/;
const idOf = (v, what = 'id') => { if (typeof v !== 'string' || !ID_RE.test(v)) throw new BadRequestError(`${what} is not valid`); return v; };
const text = (v, { max = 500, required = false, what = 'text' } = {}) => {
  if (v == null || v === '') { if (required) throw new BadRequestError(`${what} is required`); return null; }
  if (typeof v !== 'string') throw new BadRequestError(`${what} must be text`);
  const s = v.replace(/\s+/g, ' ').trim();
  if (required && !s) throw new BadRequestError(`${what} is required`);
  if (s.length > max) throw new BadRequestError(`${what} is longer than ${max} characters`);
  return s || null;
};
const object = (v, what) => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new BadRequestError(`${what} must be an object`); return v; };

// A refusal the person should read (a rule said no) is a 400; something that is our bug is left to surface as a 500.
function translate(err) {
  if (err instanceof HttpError) return err;
  if (err instanceof DataValidationError) return new HttpError(422, err.message);
  if (err instanceof DataLockError) return new HttpError(503, 'the data files are busy: try again in a moment');
  if (err instanceof DataChangedError) return new ConflictError(err.message);
  if (err instanceof TypeError || err instanceof ReferenceError || err instanceof RangeError || err instanceof SyntaxError) return err;
  return new BadRequestError(err.message);
}

export function createAdminService({ dir, now = Date.now, fetcherFactory = () => createFetcher({ userAgent: DEFAULT_USER_AGENT }) }) {
  const jobs = createJobRunner({ now });
  const read = async (actor, fn) => { requireRole(actor, 'read'); const { ds } = await snapshot(dir, { now }); return fn(ds); };

  // The one way anything changes: permission, then a transaction that writes the change with its audit row.
  async function write(actor, permission, mutate) {
    requireRole(actor, permission);
    try {
      const out = await transact(dir, (work, ctx) => mutate(work, ctx), { now });
      return { ...(out.result ?? {}), audit_at: out.at };
    } catch (err) { throw translate(err); }
  }
  const entry = (actor, action, target, summary, extra = {}) => ({ actor: { name: actor.name, role: actor.role }, via: 'admin-ui', action, target, summary, ...extra });
  const candidateOf = (work, id) => work.candidates.find((c) => c.id === id) ?? (() => { throw new NotFoundError(`no candidate "${id}"`); })();

  const WITH_EVIDENCE_FIELDS = (c) => ({ sector: c.evidence.filter((e) => e.field === 'sector').at(-1)?.value ?? null, stage: c.evidence.filter((e) => e.field === 'stage' && e.source?.kind === 'user_supplied').at(-1)?.value ?? null });

  return {
    jobs,

    // ---------- reads ----------
    overview: (actor) => read(actor, (ds) => buildOverview(ds, now())),
    candidates: (actor, filters) => read(actor, (ds) => listCandidates(ds, now(), filters)),
    candidate: (actor, id) => read(actor, (ds) => candidateDetail(ds, idOf(id)) ?? (() => { throw new NotFoundError(`no candidate "${id}"`); })()),
    companies: (actor, q) => read(actor, (ds) => searchCompanies(ds, q)),
    missing: (actor) => read(actor, (ds) => missingData(ds, now())),
    duplicates: (actor) => read(actor, (ds) => companyDuplicates(ds)),
    conflicts: (actor) => read(actor, (ds) => listConflicts(ds)),
    suggestions: (actor) => read(actor, (ds) => listSuggestions(ds)),
    queue: (actor) => read(actor, (ds) => queuePanel(ds, now())),
    imports: (actor) => read(actor, (ds) => importsPanel(ds)),
    scheduler: (actor) => read(actor, (ds) => schedulerPanel(ds, now())),
    audit: (actor, filters) => read(actor, (ds) => auditPage(ds, filters)),
    job: (actor) => { requireRole(actor, 'read'); return jobs.current(); },

    // ---------- candidates ----------
    approve: (actor, id, body = {}) => write(actor, 'candidate.approve', (work, { at }) => {
      const note = text(body.note, { what: 'the note' });
      const c = approveCandidate(work, idOf(id), { by: actor.name, note, at });
      const queued = enqueueForApproved(work, c, { by: actor.name, at });
      return { result: { id: c.id, status: c.status, website_queued: Boolean(queued) }, audit: [entry(actor, 'candidate.approve', { type: 'candidate', id: c.id }, `Approved ${c.name}${queued ? '; its website is queued for reading' : ''}`, { reason: note, changes: [{ field: 'status', from: 'needs_review', to: 'approved' }] })] };
    }),

    reject: (actor, id, body = {}) => write(actor, 'candidate.reject', (work, { at }) => {
      const reason = reasonOf(body.reason);
      const before = candidateOf(work, idOf(id)).status;
      const c = rejectCandidate(work, id, { by: actor.name, reason, at });
      return { result: { id: c.id, status: c.status }, audit: [entry(actor, 'candidate.reject', { type: 'candidate', id: c.id }, `Rejected ${c.name}`, { reason, changes: [{ field: 'status', from: before, to: 'rejected' }] })] };
    }),

    reopen: (actor, id) => write(actor, 'candidate.reopen', (work, { at }) => {
      const before = candidateOf(work, idOf(id)).status;
      const c = reopenCandidate(work, id, { by: actor.name, at });
      return { result: { id: c.id, status: c.status }, audit: [entry(actor, 'candidate.reopen', { type: 'candidate', id: c.id }, `Reopened ${c.name} for review`, { changes: [{ field: 'status', from: before, to: c.status }] })] };
    }),

    edit: (actor, id, body = {}) => write(actor, 'candidate.edit', (work, { at }) => {
      const patch = object(body.patch, 'patch');
      const before = structuredClone(candidateOf(work, idOf(id)));
      const c = editCandidate(work, id, patch, { by: actor.name, at, keepOldName: body.keepOldName !== false });
      const changes = [...diffChanges(before, c, EDITABLE.filter((f) => !['sector', 'stage'].includes(f))), ...diffChanges(WITH_EVIDENCE_FIELDS(before), WITH_EVIDENCE_FIELDS(c), ['sector', 'stage'])];
      const moved = c.status !== before.status ? ` (now ${c.status})` : '';
      return { result: { id: c.id, status: c.status, resolution: c.resolution }, audit: [entry(actor, 'candidate.edit', { type: 'candidate', id: c.id }, `Edited ${c.name}: ${changes.map((x) => x.field).join(', ')}${moved}`, { reason: text(body.reason, { what: 'the reason' }), changes })] };
    }),

    note: (actor, id, body = {}) => write(actor, 'candidate.note', (work, { at }) => {
      const textOf = text(body.text, { required: true, max: 500, what: 'the note' });
      const c = candidateOf(work, idOf(id));
      c.notes = [...c.notes, { at, by: actor.name, text: textOf }];
      return { result: { id: c.id, notes: c.notes.length }, audit: [entry(actor, 'candidate.note', { type: 'candidate', id: c.id }, `Added a note to ${c.name}`, { reason: textOf })] };
    }),

    distinct: (actor, id, body = {}) => write(actor, 'candidate.distinct', (work, { at }) => {
      const from = idOf(body.from, 'the company');
      const note = text(body.note, { what: 'the note' });
      const c = markDistinct(work, idOf(id), from, { by: actor.name, at, note });
      return { result: { id: c.id, resolution: c.resolution, matches: c.matches.length }, audit: [entry(actor, 'candidate.distinct', { type: 'candidate', id: c.id }, `Confirmed ${c.name} is not ${from}`, { reason: note })] };
    }),

    merge: (actor, id, body = {}) => write(actor, 'candidate.merge', (work, { at }) => {
      const into = idOf(body.into, 'the company');
      const name = candidateOf(work, idOf(id)).name;
      const s = mergeCandidate(work, id, into, { by: actor.name, at });
      const changes = s.filled.map((f) => ({ field: f.split(':')[0], from: null, to: f.slice(f.indexOf(':') + 2) }));
      return { result: { id, company_id: s.company_id, evidence: s.evidence, filled: s.filled, held: s.held }, audit: [entry(actor, 'candidate.merge', { type: 'candidate', id }, `Merged ${name} into ${s.company_id}: ${s.evidence} evidence${s.filled.length ? `, filled ${s.filled.map((f) => f.split(':')[0]).join(', ')}` : ''}`, { changes })] };
    }),

    publish: (actor, id, body = {}) => write(actor, 'candidate.publish', (work, { at }) => {
      let location = null;
      if (body.location) {
        const l = object(body.location, 'location');
        location = { city: text(l.city, { max: 80, required: true, what: 'the city' }), lat: Number(l.lat), lng: Number(l.lng), address: text(l.address, { max: 200 }) ?? undefined };
        if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)) throw new BadRequestError('a location needs coordinates (latitude and longitude)');
      }
      const { company } = publishCandidate(work, idOf(id), { by: actor.name, at, location });
      const queued = enqueueForPublished(work, company, { by: actor.name, at });
      return { result: { id, company_id: company.id, on_map: company.verified, enrichment_queued: Boolean(queued) }, audit: [entry(actor, 'candidate.publish', { type: 'candidate', id }, `Published ${company.name} as ${company.id}${company.verified ? ' (on the map)' : ' (unconfirmed location: listed, not on the map)'}${queued ? '; queued for enrichment' : ''}`, { changes: [{ field: 'status', from: 'approved', to: 'published' }] })] };
    }),

    // ---------- evidence ----------
    resolveConflict: (actor, body = {}) => write(actor, 'conflict.resolve', (work, { at }) => {
      const r = resolveConflict(work, object(body, 'the request'), { by: actor.name, at });
      const field = body.field;
      return {
        result: { company_id: r.company.id, field, winner: r.winner, turned_down: r.turnedDown.length },
        audit: [entry(actor, 'conflict.resolve', { type: 'company', id: r.company.id }, `Settled ${r.company.name}'s ${field}: ${JSON.stringify(r.winner)} is right${r.turnedDown.length ? `; turned down ${r.turnedDown.length} claim(s)` : ''}`, { reason: r.reason, changes: r.changes })],
      };
    }),

    applySuggestion: (actor, body = {}) => write(actor, 'suggestion.apply', (work, { at }) => {
      const r = applySuggestion(work, object(body, 'the request'), { by: actor.name, at });
      return { result: { company_id: r.company.id, field: body.field, changes: r.changes }, audit: [entry(actor, 'suggestion.apply', { type: 'company', id: r.company.id }, `Applied ${body.field} to ${r.company.name}: ${JSON.stringify(body.value)}`, { changes: r.changes })] };
    }),

    dismissSuggestion: (actor, body = {}) => write(actor, 'suggestion.dismiss', (work, { at }) => {
      const r = dismissSuggestion(work, object(body, 'the request'), { by: actor.name, at });
      return { result: { company_id: r.company.id, field: body.field, rejected: r.evidence_ids.length }, audit: [entry(actor, 'suggestion.dismiss', { type: 'company', id: r.company.id }, `Turned down ${body.field} ${JSON.stringify(body.value)} for ${r.company.name}`, { reason: r.reason })] };
    }),

    // ---------- the enrichment queue ----------
    enqueue: (actor, body = {}) => write(actor, 'enrichment.enqueue', (work, { at }) => {
      const kind = body.kind === 'candidate' ? 'candidate' : 'company';
      const targetId = idOf(body.id);
      const target = (kind === 'candidate' ? work.candidates : work.companies).find((x) => x.id === targetId);
      if (!target) throw new NotFoundError(`no ${kind} "${targetId}"`);
      if (!target.website) throw new BadRequestError(`${target.name} has no website to read`);
      const { task, created } = enqueueTask(work, { kind, targetId, priority: PRIORITY.manual, reason: 'manual', wanted: WANTABLE, by: actor.name, at });
      return { result: { task_id: task.id, created }, audit: [entry(actor, 'enrichment.enqueue', { type: 'queue', id: task.id }, `Queued ${target.name} to have its website read${created ? '' : ' (it was already waiting; moved up)'}`)] };
    }),

    seedQueue: (actor, body = {}) => write(actor, 'enrichment.seed', (work, { at }) => {
      const limit = body.limit == null ? Infinity : Number(body.limit);
      if (!(limit >= 1)) throw new BadRequestError('limit must be a number from 1');
      const r = seedFromAudit(work, auditDataset(work, { asOf: at.slice(0, 10) }), { at, by: actor.name, limit, force: body.force === true });
      return { result: r, audit: [entry(actor, 'enrichment.seed', { type: 'queue', id: 'enrichment' }, `Queued ${r.queued} compan${r.queued === 1 ? 'y' : 'ies'} for enrichment (${r.no_website} without a website, ${r.fresh} checked recently)`)] };
    }),

    retryTask: (actor, id) => write(actor, 'enrichment.retry', (work, { at }) => {
      const t = requeueTask(work, idOf(id, 'the task'), { at });
      return { result: { id: t.id, status: t.status }, audit: [entry(actor, 'enrichment.retry', { type: 'queue', id: t.id }, `Retried the ${t.kind} task for ${t.target_id}`)] };
    }),

    cancelTask: (actor, id) => write(actor, 'enrichment.cancel', (work, { at }) => {
      const t = cancelTask(work, idOf(id, 'the task'), { at });
      return { result: { id: t.id, status: t.status }, audit: [entry(actor, 'enrichment.cancel', { type: 'queue', id: t.id }, `Cancelled the ${t.kind} task for ${t.target_id}`)] };
    }),

    // Starts reading websites in the background and returns at once. The page watches the job. Each task is
    // its own transaction (worker.js), so a person's decisions made meanwhile are never written over.
    startEnrichmentRun(actor, body = {}) {
      requireRole(actor, 'enrichment.run');
      const mode = body.mode ?? 'suggest';
      if (!MODES.includes(mode)) throw new BadRequestError(`mode must be one of ${MODES.join(', ')}`);
      const concurrency = body.concurrency == null ? 3 : Number(body.concurrency);
      const limit = body.limit == null ? Infinity : Number(body.limit);
      if (!(concurrency >= 1 && concurrency <= 6)) throw new BadRequestError('concurrency must be from 1 to 6');
      if (!(limit >= 1)) throw new BadRequestError('limit must be a number from 1');
      return jobs.start({
        kind: 'enrichment', by: actor.name,
        run: async ({ job, log, shouldStop }) => {
          log(`reading websites in ${mode} mode${mode === 'suggest' ? ' (evidence only: no company is changed)' : ''}`);
          const stats = await runQueue({
            dir, fetcher: fetcherFactory(), now, limit, mode, concurrency, by: 'enrichment', shouldStop,
            onEvent: (e) => { if (e.type !== 'start') log(`${e.type} ${e.task.target_id}${e.error ? `: ${e.error}` : ''}`); },
          });
          job.progress = stats;
          await transact(dir, () => ({ audit: [entry(actor, 'enrichment.run', { type: 'queue', id: 'enrichment' }, `Ran the enrichment queue in ${mode} mode: ${stats.done} read, ${stats.skipped} skipped, ${stats.failed} failed, ${stats.retried} to retry; ${stats.evidence_added} evidence added${stats.applied ? `, ${stats.applied} field(s) filled` : ''}`)] }), { now });
          return stats;
        },
      });
    },
    stopEnrichmentRun(actor) { requireRole(actor, 'enrichment.run'); return jobs.stop(); },

    // ---------- imports ----------
    dismissImport: (actor, body = {}) => write(actor, 'import.dismiss', (work, { at }) => {
      const run = (work.import_runs ?? []).find((r) => r.id === body.run_id);
      if (!run) throw new NotFoundError(`no import run "${body.run_id}"`);
      const sourceId = text(body.source_id, { required: true, what: 'the source' });
      if (!run.sources.some((s) => s.id === sourceId && s.error)) throw new BadRequestError(`${sourceId} did not fail in that run`);
      const note = reasonOf(body.note);
      run.acknowledged = [...run.acknowledged, { source_id: sourceId, by: actor.name, at, note }];
      return { result: { run_id: run.id, source_id: sourceId }, audit: [entry(actor, 'import.dismiss', { type: 'import_run', id: run.id }, `Acknowledged the failure of ${sourceId}`, { reason: note })] };
    }),
  };
}

export { HttpError };
