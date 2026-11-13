// The hourly job sync: read every approved employer board that is due, whole, and bring jobs.json in line with what the employer lists.
//
// A tick of this job does, for each due board, in this order and one board at a time:
//   1. READ the board through the compliant fetcher (adapters.js), outside any lock. A complete read, or a SyncError.
//   2. WRITE, inside the data lock and the dataset's validation: a complete read goes through the rules in engine.js (hide / archive / reopen, the three dates); a failure writes
//      only the board's state row (when it failed, why, when to try again). A failure never touches a role.
// One board's trouble never stops the next; the run's budget (requests, boards, minutes) does, and says so. What was not reached stays due.
//
// "Due" is the state row's next_attempt_at (state.js): about an hour after a whole read, further out after a failure. So a timer that fires every hour, or twice in an hour, polls each
// board once an hour.
import { snapshot, transact } from '../../models/store.js';
import { readSource, SyncError, SUPPORTED } from '../../jobsync/adapters.js';
import { applyRead } from '../../jobsync/engine.js';
import { stateRow, isDue, noteSuccess, noteFailure, EMPTY_CONFIRM_MS } from '../../jobsync/state.js';

export const DEFAULT_MAX_BOARDS = 60;

const blank = () => ({ due: 0, processed: 0, changed: 0, failed: 0, deferred: 0, requests: 0, summary: '', details: null, error: null });
const changedBy = (s) => (s.added + s.reopened + s.hidden + s.archived + s.adopted) > 0;

// What would be read, and why not the rest. Reads and writes nothing.
export function planJobSync(ds, { now, force = false, limit = DEFAULT_MAX_BOARDS } = {}) {
  const approved = (ds.job_sources ?? []).filter((s) => s.status === 'approved');
  const unsupported = approved.filter((s) => !SUPPORTED.includes(s.provider));
  const polled = approved.filter((s) => SUPPORTED.includes(s.provider));
  const due = polled.filter((s) => force || isDue((ds.job_sync_state ?? []).find((r) => r.source_id === s.id), now));
  return { approved: approved.length, polled: polled.length, unsupported, due, planned: due.slice(0, limit), deferred: Math.max(0, due.length - limit), waiting: polled.length - due.length };
}

export async function runJobSync(ctx, { budget, limit = DEFAULT_MAX_BOARDS, readOptions = {} } = {}) {
  const { dir, now = Date.now, fetcher, force = false, lock: lockOpts, runIds = {}, dryRun = false } = ctx;
  const out = blank();
  const { ds } = await snapshot(dir, lockOpts);
  const planned = planJobSync(ds, { now: now(), force, limit });
  out.due = planned.due.length;
  out.deferred = planned.deferred;
  const boards = [];
  if (dryRun || planned.due.length === 0) {
    out.summary = planned.polled === 0 ? 'No approved boards to read' : `Nothing was due (${planned.polled} board(s) read within the last hour)`;
    out.details = { approved: planned.approved, polled: planned.polled, unsupported: planned.unsupported.map((s) => `${s.company_id} (${s.provider})`), would_read: dryRun ? planned.planned.map((s) => s.id) : undefined };
    return out;
  }
  const requestsAtStart = fetcher.log?.requests?.length ?? 0;
  const websites = new Map(ds.companies.map((c) => [c.id, c.website ?? '']));
  const totals = { added: 0, updated: 0, reopened: 0, adopted: 0, hidden: 0, archived: 0, duplicates: 0, out_of_scope: 0, listed: 0 };
  let stoppedAt = null;

  for (const source of planned.planned) {
    if (budget?.shouldStop()) { stoppedAt = source.id; break; }
    let read = null;
    let failure = null;
    try {
      read = await readSource(source, { fetcher, now: now(), companyWebsite: websites.get(source.company_id) ?? '', ...readOptions });
    } catch (err) {
      failure = err instanceof SyncError ? err : new SyncError('network', String(err?.message ?? err).slice(0, 200));
    }
    const at = new Date(now()).toISOString();
    const entry = { id: source.id, company_id: source.company_id, provider: source.provider };
    await transact(dir, (work) => {
      work.job_sync_state ??= [];
      const row = stateRow(work.job_sync_state, source.id);
      if (failure) {
        noteFailure(row, { at, error: failure, runId: runIds.jobsync, attempts: failure.attempts ?? 1 });
        Object.assign(entry, { outcome: 'failed', error: failure.code, message: failure.message });
        return {};
      }
      const mine = work.jobs.filter((j) => j.company_id === source.company_id && j.status === 'open' && (j.source_id === source.id || j.provider === source.provider)).length;
      // An empty list from a board we hold open roles for is read once with suspicion: a provider glitch looks the same, and it would close a whole company. A second empty read in a row is believed.
      if (read.seen.size === 0 && mine > 0 && (row.empty_reads < 1 || Date.parse(at) - Date.parse(row.empty_first_at ?? at) < EMPTY_CONFIRM_MS)) {
        if (row.empty_reads < 1) { row.empty_reads = 1; row.empty_first_at = at; }
        Object.assign(row, { last_attempt_at: at, next_attempt_at: new Date(Date.parse(at) + 15 * 60000).toISOString(), last_run_id: runIds.jobsync ?? null });
        Object.assign(entry, { outcome: 'suspicious_empty', message: `The board listed nothing but ${mine} open role(s) are held: nothing was changed; the next read decides` });
        return {};
      }
      const stats = applyRead(work.jobs, source, read, { now: now() });
      noteSuccess(row, { at, counts: stats, runId: runIds.jobsync, pages: read.pages, attempts: read.attempts });
      Object.assign(entry, { outcome: 'read', ...stats, pages: read.pages });
      return {};
    }, lockOpts);
    boards.push(entry);
  }

  let held = 0;
  for (const b of boards) {
    if (b.outcome === 'read') { out.processed += 1; if (changedBy(b)) out.changed += 1; for (const k of Object.keys(totals)) totals[k] += b[k] ?? 0; }
    else if (b.outcome === 'suspicious_empty') held += 1; // not a failure: it answered, and the answer is held for a second read
    else out.failed += 1;
  }
  out.requests = (fetcher.log?.requests?.length ?? 0) - requestsAtStart;
  out.deferred += stoppedAt ? planned.planned.length - boards.length : 0;
  const bits = [`${out.processed} board(s) read whole`];
  if (out.failed) bits.push(`${out.failed} could not be read (roles left as they were)`);
  if (held) bits.push(`${held} listed nothing and is held for a second read`);
  const moves = [totals.added && `${totals.added} role(s) new`, totals.reopened && `${totals.reopened} listed again`, totals.hidden && `${totals.hidden} hidden`, totals.archived && `${totals.archived} archived`].filter(Boolean);
  out.summary = `${bits.join(', ')}${moves.length ? `; ${moves.join(', ')}` : '; no role changed'}${stoppedAt ? '; stopped early (the run\'s limit), the rest are still due' : ''}`;
  out.details = { totals, boards: boards.map(({ id, outcome, error, message, listed, added, updated, reopened, adopted, hidden, archived, duplicates, out_of_scope: oos, pages }) => ({ id, outcome, error, message, listed, added, updated, reopened, adopted, hidden, archived, duplicates, out_of_scope: oos, pages })), unsupported: planned.unsupported.map((s) => `${s.company_id} (${s.provider})`), stopped_for: budget?.stoppedFor?.() ?? null };
  return out;
}
