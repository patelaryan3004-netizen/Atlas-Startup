// The enrichment worker: takes tasks from the queue and reads each company's (or candidate's) own website.
//
// A task is three steps, and only the middle one touches the network:
//
//   1. claim   in a transaction: take the highest-priority ready task and mark it running.
//   2. read    outside any lock: fetch the pages through the compliant fetcher (robots.txt, pacing,
//              no access control bypassed). Several tasks may be read at once, as they are different sites.
//   3. commit  in a transaction: re-read the data as it is NOW, apply what the pages said to it, finish
//              the task, and record it in the audit trail, all in one write.
//
// So a run that lasts twenty minutes never holds a stale copy of the data, and cannot write over a
// decision a person made while it ran. If the commit fails, only that task fails.
//
// What reaches a company record stays narrow: this fills only what the policy allows (policy.js) and only
// in 'fill' mode. In 'suggest' mode (the default) it gathers evidence and changes no company.
import { transact, snapshot } from '../models/store.js';
import { claimNext, finishTask, failTask } from '../models/enrichmentQueue.js';
import { readSite, enrichFromWebsite } from '../discovery/enrich.js';
import { createEngine, knownInvestorNames } from '../discovery/pipeline.js';
import { analyzeCompanySite, namesOf } from './analyze.js';
import { applyCompanyEnrichment } from './apply.js';

// A network failure may pass, and so may a site telling us to slow down (a 429 or a server error, even on its
// robots.txt, or a robots.txt we could not fetch at all); anything else the fetcher refused is a result, not a
// failure: robots.txt says no, access is controlled, there is nothing at that address.
const TRANSIENT = new Set(['timeout', 'network_error', 'rate_limited', 'dns_failed']);
const isTransient = (e) => TRANSIENT.has(e.code)
  || (e.code === 'http_error' && /HTTP (?:429|5\d\d)/.test(e.message ?? ''))
  || (e.code === 'robots_unavailable' && !/access-controlled|HTTP (?:401|403|404|410)/.test(e.message ?? ''));

export const SYSTEM = (by) => ({ name: by, role: 'system' });

// What a finished task keeps: small, and enough to see what happened without opening the evidence.
const brief = (s) => ({
  outcome: s.outcome, pages: s.pages.length, evidence_added: s.evidence_added, evidence_refreshed: s.evidence_refreshed,
  applied: s.applied.map((a) => a.field), suggested: s.suggested.map((a) => a.field), conflicts: s.conflicts.map((c) => c.field),
  held: s.held.slice(0, 10), jobs: s.jobs, warnings: s.warnings.slice(0, 5), refused: s.refused.slice(0, 5).map(({ url, code }) => ({ url, code })),
});

function describe(host, s) {
  const bits = [`${s.evidence_added} evidence added`];
  if (s.evidence_refreshed) bits.push(`${s.evidence_refreshed} re-checked`);
  if (s.applied.length) bits.push(`filled ${s.applied.map((a) => a.field).join(', ')}`);
  if (s.suggested.length) bits.push(`${s.suggested.length} suggestion(s)`);
  if (s.conflicts.length) bits.push(`${s.conflicts.length} conflict(s)`);
  if (s.jobs.added || s.jobs.closed) bits.push(`jobs +${s.jobs.added}/-${s.jobs.closed}`);
  return `Read ${host}: ${bits.join('; ')}`;
}

export async function runQueue({ dir, fetcher, now = Date.now, limit = Infinity, mode = 'suggest', concurrency = 3, by = 'enrichment', kinds = null, maxPages = 4, onEvent = () => {}, shouldStop = () => false }) {
  const stats = { claimed: 0, done: 0, skipped: 0, failed: 0, retried: 0, evidence_added: 0, applied: 0 };
  const lock = { now };

  const claim = async () => (await transact(dir, (work, { at }) => ({ result: claimNext(work, { at, kinds }) }), lock)).result;
  const skip = async (task, error, result) => {
    await transact(dir, (work, { at }) => { finishTask(work, task.id, { at, status: 'skipped', error, result }); }, lock);
    return { status: 'skipped', summary: null };
  };
  // The homepage could not be read. A refusal is a result (the site says no): the task is skipped and says why.
  // A network failure may pass: it goes back with a growing back-off, and fails for good after the last try.
  const unreadable = (task, error) => {
    if (isTransient(error)) throw Object.assign(new Error(`${error.code}: ${error.message}`), { retryable: true });
    return skip(task, `${error.code}: ${error.message}`, { outcome: 'refused', code: error.code, refused: [{ url: error.url, code: error.code }] });
  };

  async function companyTask(task, ds) {
    const company = ds.companies.find((c) => c.id === task.target_id);
    if (!company) return skip(task, 'the company no longer exists', { outcome: 'gone' });
    if (!company.website) return skip(task, 'no website on record', { outcome: 'no_website' });
    const site = await readSite(company.website, { fetcher, now, maxPages, wanted: task.wanted });
    if (site.pages.length === 0) return unreadable(task, site.errors[0]);
    const analysis = analyzeCompanySite(site, { names: namesOf(company, ds.identifiers), knownInvestors: knownInvestorNames(ds), website: company.website, now });
    let summary = null;
    await transact(dir, (work, { at }) => {
      if (!work.companies.some((c) => c.id === company.id)) { finishTask(work, task.id, { at, status: 'skipped', error: 'the company no longer exists', result: { outcome: 'gone' } }); return {}; }
      summary = applyCompanyEnrichment(work, { companyId: company.id, analysis, at, mode });
      finishTask(work, task.id, { at, status: 'done', result: brief(summary) });
      const changed = summary.evidence_added || summary.evidence_refreshed || summary.applied.length || summary.jobs.added || summary.jobs.updated || summary.jobs.closed;
      return {
        audit: changed ? [{ actor: SYSTEM(by), via: 'worker', action: 'enrichment.task', target: { type: 'company', id: company.id }, summary: describe(site.domain.host, summary), changes: summary.changes }] : [],
      };
    }, lock);
    if (!summary) return { status: 'skipped', summary: null };
    stats.evidence_added += summary.evidence_added;
    stats.applied += summary.applied.length;
    return { status: 'done', summary };
  }

  async function candidateTask(task, ds) {
    const candidate = ds.candidates.find((c) => c.id === task.target_id);
    if (!candidate) return skip(task, 'the candidate no longer exists', { outcome: 'gone' });
    if (!candidate.website) return skip(task, 'no website on record', { outcome: 'no_website' });
    const result = await enrichFromWebsite(candidate.website, { fetcher, now, candidateNames: [candidate.name, ...candidate.aliases], maxPages: Math.min(maxPages, 3), wanted: task.wanted });
    if (result.pages.length === 0) return unreadable(task, result.errors[0]);
    let status = 'done';
    await transact(dir, async (work, { at }) => {
      const current = work.candidates.find((c) => c.id === candidate.id);
      if (!current || !['needs_review', 'matched', 'approved'].includes(current.status)) {
        status = 'skipped';
        finishTask(work, task.id, { at, status: 'skipped', error: `the candidate is ${current?.status ?? 'gone'}`, result: { outcome: 'not_waiting' } });
        return {};
      }
      await createEngine({ work, fetcher: null, now: () => Date.parse(at) }).enrichCandidateWith(current.id, result);
      finishTask(work, task.id, { at, status: 'done', result: { outcome: result.mismatch ? 'mismatch' : 'read', pages: result.pages.length, evidence: result.evidence.length, warnings: result.warnings.slice(0, 5) } });
      return { audit: [{ actor: SYSTEM(by), via: 'worker', action: 'candidate.enrich', target: { type: 'candidate', id: current.id }, summary: `Read the website of ${current.name}: ${result.evidence.length} claim(s)` }] };
    }, lock);
    if (status === 'done') stats.evidence_added += result.evidence.length;
    return { status, summary: null };
  }

  async function handle(task) {
    onEvent({ type: 'start', task });
    try {
      const { ds } = await snapshot(dir, lock);
      const { status, summary } = await (task.kind === 'company' ? companyTask(task, ds) : candidateTask(task, ds));
      stats[status] += 1;
      onEvent({ type: status, task, summary });
    } catch (err) {
      const failed = (await transact(dir, (work, { at }) => ({ result: failTask(work, task.id, { at, error: err.message, retryable: err.retryable === true }) }), lock)).result;
      stats[failed.status === 'queued' ? 'retried' : 'failed'] += 1;
      onEvent({ type: failed.status === 'queued' ? 'retry' : 'failed', task: failed, error: err.message });
    }
  }

  const running = new Set();
  while (stats.claimed < limit && !shouldStop()) {
    while (running.size < concurrency && stats.claimed < limit && !shouldStop()) {
      const task = await claim();
      if (!task) break;
      stats.claimed += 1;
      const p = handle(task).finally(() => running.delete(p));
      running.add(p);
    }
    if (running.size === 0) break;
    await Promise.race(running);
  }
  await Promise.all(running);
  return stats;
}
