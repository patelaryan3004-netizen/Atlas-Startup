// The two jobs that read feeds and queues instead of company websites: DISCOVERY (find companies we do not have)
// and FUNDING (find what a publisher says about companies we do). They read the same sources, so each source is
// read once per run and its stories are shared: funding takes the stories that are plainly about one of our
// companies and records them as evidence (scheduler/funding.js); discovery takes the rest and hands them to the
// discovery engine, which turns them into candidates for a person to review. A candidate is never published here.
//
// A source is read when its own clock says so (a feed every two days, our submissions queue every six hours); a
// source that failed backs off like any other failure and shows up under "failed imports" in the Command Center,
// because discovery writes the same import-run row the command line does.
import { loadRaw, parseRaw } from '../../models/dataset.js';
import { transact, withLock, commit, DataChangedError } from '../../models/store.js';
import { buildImportRun } from '../../models/importRuns.js';
import { indexState } from '../../models/refreshState.js';
import { createEngine, knownInvestorNames } from '../../discovery/pipeline.js';
import { stampCheck } from '../state.js';
import { partitionLeads, recordFunding } from '../funding.js';

const isDue = (row, at, force) => force || !row || row.next_check_at == null || Date.parse(row.next_check_at) <= Date.parse(at);
const message = (err) => `${err.code ? `${err.code}: ` : ''}${err.message}`;
const isPress = (source) => source.kind === 'press';

// Stamps a source's clock after a read: it answered (and whether it gave anything), or it did not.
function stampSource(work, source, facet, { at, error = null, gave = 0, changed = false, runId = null, baseDays = null }) {
  const row = indexState(work.refresh_state ??= []).getOrCreate('source', source.id, facet);
  if (error) stampCheck(row, { at, outcome: 'failed', error, runId, baseDays });
  else stampCheck(row, { at, outcome: 'read', changed, verified: gave > 0, runId, meta: { leads: gave }, baseDays });
  return row;
}

// Reads every source that is due for either job, once. Returns { leads: Map(id -> lead[]), errors: Map(id -> message), requests }.
async function readSources(ctx, sources, knownInvestors) {
  const leads = new Map();
  const errors = new Map();
  const before = ctx.fetcher.log.requests.length;
  for (const source of sources) {
    try {
      leads.set(source.id, await source.discover({ fetcher: ctx.memo, now: ctx.now, knownInvestors, fetchImpl: ctx.fetchImpl }));
    } catch (err) {
      errors.set(source.id, message(err));
    }
  }
  return { leads, errors, requests: ctx.fetcher.log.requests.length - before };
}

export async function runFeedJobs(ctx, { snapshot }) {
  const { jobs, at, force } = ctx;
  const state = indexState(snapshot.refresh_state ?? []);
  const wantFunding = jobs.has('funding');
  const wantDiscovery = jobs.has('discovery');
  const dueFunding = wantFunding ? ctx.sources.filter((s) => isPress(s) && isDue(state.get('source', s.id, 'funding'), at, force)) : [];
  const dueDiscovery = wantDiscovery ? ctx.sources.filter((s) => isDue(state.get('source', s.id, 'discovery'), at, force)) : [];
  const out = {
    funding: wantFunding ? { due: dueFunding.length, processed: 0, changed: 0, failed: 0, requests: 0, summary: '', details: null, error: null } : null,
    discovery: wantDiscovery ? { due: dueDiscovery.length, processed: 0, changed: 0, failed: 0, requests: 0, summary: '', details: null, error: null } : null,
  };
  if (ctx.dryRun) {
    if (out.funding) out.funding.summary = `${dueFunding.length} feed(s) due: ${dueFunding.map((s) => s.id).join(', ') || 'none'}`;
    if (out.discovery) out.discovery.summary = `${dueDiscovery.length} source(s) due: ${dueDiscovery.map((s) => s.id).join(', ') || 'none'}`;
    return out;
  }
  if (!dueFunding.length && !dueDiscovery.length) return idle(out, wantFunding, wantDiscovery);

  const needed = [...new Map([...dueFunding, ...dueDiscovery].map((s) => [s.id, s])).values()];
  const { leads, errors } = await readSources(ctx, needed, knownInvestorNames(snapshot));

  // ---- funding: the stories that are plainly about our companies become evidence
  if (out.funding && dueFunding.length) {
    const f = out.funding;
    const before = ctx.fetcher.log.requests.length;
    try {
      const { result } = await transact(ctx.dir, (work, { at: now }) => {
        const sums = { stories: 0, attached: 0, evidence_added: 0, companies: new Set(), rounds: [], passed: {}, sources: [] };
        for (const source of dueFunding) {
          const error = errors.get(source.id);
          const baseDays = ctx.refreshDays?.[source.id] ?? null;
          if (error) { stampSource(work, source, 'funding', { at: now, error, runId: ctx.runIds.funding, baseDays }); sums.sources.push({ id: source.id, error }); continue; }
          const read = leads.get(source.id) ?? [];
          const { attach, passed } = partitionLeads(read, work, { at: now });
          const recorded = recordFunding(work, attach, { at: now });
          sums.stories += read.length;
          sums.attached += attach.length;
          sums.evidence_added += recorded.evidence_added;
          recorded.companies.forEach((id) => sums.companies.add(id));
          sums.rounds.push(...recorded.rounds);
          for (const [reason, n] of Object.entries(passed)) sums.passed[reason] = (sums.passed[reason] ?? 0) + n;
          stampSource(work, source, 'funding', { at: now, gave: read.length, changed: recorded.evidence_added > 0, runId: ctx.runIds.funding, baseDays });
          sums.sources.push({ id: source.id, stories: read.length, attached: attach.length, evidence_added: recorded.evidence_added });
        }
        return { result: sums };
      }, ctx.lock);
      f.processed = result.sources.filter((s) => !s.error).length;
      f.failed = result.sources.filter((s) => s.error).length;
      f.changed = result.companies.size;
      f.error = f.failed && !f.processed ? result.sources.find((s) => s.error).error : null;
      f.summary = `Read ${f.processed} feed(s): ${result.stories} stories, ${result.attached} about our companies (${result.evidence_added} evidence row(s) added to ${result.companies.size} compan${result.companies.size === 1 ? 'y' : 'ies'}), ${result.stories - result.attached} left to discovery${f.failed ? `; ${f.failed} feed(s) failed` : ''}`;
      f.details = { sources: result.sources, passed: result.passed, rounds: result.rounds.slice(0, 20) };
    } catch (err) {
      f.error = err.message; f.failed = dueFunding.length; f.summary = `Funding could not be recorded: ${err.message}`;
    }
    f.requests = ctx.fetcher.log.requests.length - before;
  }

  // ---- discovery: everything else goes to the engine, which makes candidates and never publishes one
  if (out.discovery && dueDiscovery.length) {
    const d = out.discovery;
    const before = ctx.fetcher.log.requests.length;
    try {
      // Stories the funding job just took are left out, but only if it ran: otherwise nobody has taken them.
      const r = await discover(ctx, dueDiscovery, leads, errors, { filterFunding: dueFunding.length > 0 });
      Object.assign(d, r);
    } catch (err) {
      d.error = err.message; d.failed = dueDiscovery.length; d.summary = `Discovery could not be recorded: ${err.message}`;
    }
    d.requests = ctx.fetcher.log.requests.length - before;
  }
  return out;
}

function idle(out, wantFunding, wantDiscovery) {
  if (wantFunding) out.funding.summary = 'No feed is due';
  if (wantDiscovery) out.discovery.summary = 'No source is due';
  return out;
}

// One pass of the engine over the stories already read. It reads candidate websites (that is the engine's job) and so
// runs on a copy of the data, outside the lock, and is written in one commit that fails if anyone else wrote
// meanwhile; then it starts again from the data as it is now, which costs no requests (everything it read is kept
// for the run).
async function discover(ctx, dueSources, leads, errors, { filterFunding }) {
  for (let attempt = 1; ; attempt += 1) {
    const raw = await loadRaw(ctx.dir);
    const work = structuredClone(parseRaw(raw));
    const startedAt = new Date(ctx.now()).toISOString();
    let held = 0;
    const sources = dueSources.map((source) => ({
      ...source,
      async discover() {
        const error = errors.get(source.id);
        if (error) throw new Error(error);
        const all = leads.get(source.id) ?? [];
        if (!filterFunding || !isPress(source)) return all;
        const { rest } = partitionLeads(all, work, { at: startedAt });
        held += all.length - rest.length;
        return rest;
      },
    }));
    const engine = createEngine({ work, fetcher: ctx.memo, now: ctx.now, fetchImpl: ctx.fetchImpl, options: { enrich: true, applyExact: false } });
    const report = await engine.run(sources);
    report.requests = ctx.fetcher.log.requests.length;
    report.refused = ctx.fetcher.log.refused;
    const finishedAt = new Date(ctx.now()).toISOString();
    work.import_runs ??= [];
    const row = buildImportRun(report, { runs: work.import_runs, startedAt: report.started_at, finishedAt, trigger: 'scheduler', by: ctx.by });
    work.import_runs.push(row);
    for (const source of dueSources) {
      const entry = report.sources.find((s) => s.id === source.id);
      const items = report.items.filter((i) => i.source === source.id);
      stampSource(work, source, 'discovery', { at: finishedAt, error: entry?.error ?? null, gave: entry?.leads ?? 0, changed: items.length > 0, runId: ctx.runIds.discovery, baseDays: ctx.refreshDays?.[source.id] ?? null });
    }
    try {
      await withLock(ctx.dir, async () => { await commit(ctx.dir, raw, work); }, ctx.lock);
    } catch (err) {
      if (err instanceof DataChangedError && attempt < 3) continue;
      throw err;
    }
    const failed = row.sources.filter((s) => s.error).length;
    const created = report.items.filter((i) => !i.attached).length;
    return {
      processed: row.sources.length - failed, failed, changed: created + report.attached,
      error: failed && failed === row.sources.length ? row.sources.find((s) => s.error).error : null,
      summary: `Read ${row.sources.length} source(s): ${created} new candidate(s), ${report.attached} attached to ones we had, ${report.already_seen} seen before${held ? `, ${held} funding stories left to the funding job` : ''}${failed ? `; ${failed} source(s) failed` : ''}`,
      details: { import_run: row.id, candidates: report.items.filter((i) => !i.attached).slice(0, 20).map((i) => ({ id: i.id, name: i.name, status: i.status })), sources: row.sources },
    };
  }
}
