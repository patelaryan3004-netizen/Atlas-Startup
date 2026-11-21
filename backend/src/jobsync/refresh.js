// One refresh of the hiring desk's data: everything the twice-a-day schedule does, in this order, each step bounded and none able to undo another's work.
//
//   vc        the venture firms' job boards that are due: what platform, what may be read, and (from the page's sample) companies and boards to queue for approval. vc.js
//   network   a job network's board (Innovation Bay): its sample, and this refresh's slice of its company list matched against the directory: leads for the ones we do not hold, a look at the
//             websites of the ones we hold that are hiring and have no board read. network.js
//   portfolio the official portfolio pages of the venture firms and accelerators (Blackbird, AirTree, ...): each read once a week, the companies on it that nothing has seen matched against the
//             directory: leads for the ones we do not hold. Never stores a role. portfolio.js
//   confirm   a board a venture firm's board named for a company we hold is asked of the EMPLOYER: approved only if its own feed lists the job that was shown and the board is the company's.
//             confirm.js
//   discover  the companies due for a look at their own website for a job board (each company without one, once a week, by rotation; never-looked-at at once): a board found is approved, the
//             rest is written down for review. discover.js
//   boards    every approved employer board that is due, read whole, into jobs.json: a new role, a changed one, one gone. jobs/jobsync.js, engine.js
//   dedupe    the same role listed by two boards, shown once. dedupe.js
//   health    one row for the whole refresh. health.js
//
// No step calls a paid or language-model service: it is HTTP reads of public pages and feeds, and arithmetic. A failure in a step is the step's own: it is said, and the next step runs.
import { snapshot, transact } from '../models/store.js';
import { runJobSync } from '../scheduler/jobs/jobsync.js';
import { runDiscovery, keptReview, DEFAULT_DISCOVERY_PER_RUN } from './discoverRun.js';
import { checkFirm, applySample, VC_FIRMS } from './vc.js';
import { NETWORKS, NETWORK_READS_PER_RUN, readNetwork, applyProfiles, coveredBy } from './network.js';
import { blockOf } from './discover.js';
import { SOURCES as PORTFOLIOS, PORTFOLIO_READS_PER_RUN, readPortfolio, applyPortfolio, judgeEntries, toJudge, recheckEntries, applyRecheck, savedScanKeys, seenUrls, portfolioDue, portfolioRow, portfolioRowId } from './portfolio.js';
import { buildCatalogue } from './sources.js';
import { confirmReviewBoards } from './confirm.js';
import { PROVIDERS } from './adapters.js';
import { applyRead } from './engine.js';
import { stateRow, noteSuccess } from './state.js';
import { vcEmployerId } from './employers.js';
import { dedupeRoles } from './dedupe.js';
import { buildHealthRow, pushHealth } from './health.js';

export const STEPS = ['vc', 'network', 'portfolio', 'confirm', 'discover', 'boards', 'dedupe', 'health'];

async function runVc(ctx, budget) {
  const { dir, now = Date.now, fetcher, lock, force = false } = ctx;
  const stats = { due: 0, checked: 0, readable: 0, sighted: 0, known: 0, review_boards: 0, leads: 0, own_boards: 0, roles_added: 0, errors: 0 };
  const { ds } = await snapshot(dir, lock);
  const byId = new Map((ds.job_vc_boards ?? []).map((r) => [r.id, r]));
  const due = VC_FIRMS.filter((f) => force || !byId.get(f.id)?.next_check_at || Date.parse(byId.get(f.id).next_check_at) <= now());
  stats.due = due.length;
  for (const firm of due) {
    if (budget?.shouldStop()) break;
    let res;
    try { res = await checkFirm(firm, { fetcher, now }); } catch (err) { stats.errors += 1; continue; }
    await transact(dir, (work, { at }) => {
      work.job_vc_boards ??= [];
      const i = work.job_vc_boards.findIndex((r) => r.id === firm.id);
      // The firm's record in the directory, when the directory still holds it: a directory without it keeps the row, unlinked.
      const row = { ...res.row, investor_id: work.investors.some((x) => x.id === res.row.investor_id) ? res.row.investor_id : null };
      if (i === -1) work.job_vc_boards.push(row); else work.job_vc_boards[i] = row;
      if (res.sample.length) {
        const { stats: s, reviews } = applySample(work, firm, res.sample, { at, keptReview: keptReview(work) });
        work.job_sources = buildCatalogue(work, { review: reviews, at });
        for (const k of ['sighted', 'known', 'review_boards', 'leads']) stats[k] += s[k];
      }
      // The firm's OWN vacancies: a board its own careers page links to, whose name is the firm's and whose feed answered whole. The firm is the employer (vc-<investor id>), approved by the same
      // rule as a company: its own page links to the board. Read now, so the roles are there in this refresh.
      if (res.own.length && row.investor_id) {
        const employer = vcEmployerId(row.investor_id);
        work.sources ??= [];
        for (const o of res.own) {
          const id = `${employer}-${o.provider}-jobs`;
          const name = PROVIDERS[o.provider].name;
          if (!work.sources.some((x) => x.id === id)) {
            work.sources.push({ id, kind: 'investor_website', url: PROVIDERS[o.provider].page(o.token), title: `${name} job board`, publisher: new URL(firm.site).hostname.replace(/^www\./, ''), retrieved_at: at, note: `${firm.name}'s own careers page links to its ${name} job board, read through the board's public feed. Linked from ${o.evidence_url}.` });
          }
        }
        work.job_sources = buildCatalogue(work, { review: keptReview(work), at });
        work.job_sync_state ??= [];
        for (const o of res.own) {
          const source = work.job_sources.find((x) => x.id === `${employer}-${o.provider}-jobs` && x.status === 'approved');
          if (!source) continue;
          const s = applyRead(work.jobs, source, o.read, { now: now() });
          noteSuccess(stateRow(work.job_sync_state, source.id), { at, counts: s, runId: null, pages: o.read.pages, attempts: o.read.attempts });
          stats.own_boards += 1;
          stats.roles_added += s.added;
        }
      }
      return {};
    }, lock);
    stats.checked += 1;
    if (res.row.access === 'public_sample') stats.readable += 1;
  }
  return stats;
}

// The job networks (Innovation Bay) that are due: their board's sample, and this refresh's slice of their company list, matched against the directory. network.js
// `all`: every company on the list this time, not just this half-day's slice (a first fill, or a catch-up: `jobsync network --all`), up to `limit` pages.
export async function runNetwork(ctx, budget, { all = false, limit = NETWORK_READS_PER_RUN } = {}) {
  const { dir, now = Date.now, lock, force = false } = ctx;
  const fetcher = ctx.networkFetcher ?? ctx.fetcher;
  const stats = { due: 0, checked: 0, sighted: 0, known: 0, review_boards: 0, leads: 0, profiles_read: 0, in_directory: 0, hiring_hints: 0, already_queued: 0, new_leads: 0, investor_leads: 0, settled: 0, errors: 0, stopped: null };
  const { ds } = await snapshot(dir, lock);
  const byId = new Map((ds.job_vc_boards ?? []).map((r) => [r.id, r]));
  const due = NETWORKS.filter((n) => force || !byId.get(n.id)?.next_check_at || Date.parse(byId.get(n.id).next_check_at) <= now());
  stats.due = due.length;
  for (const net of due) {
    if (budget?.shouldStop()) break;
    const before = byId.get(net.id);
    // A second refresh in the same half-day block (a manual run after a scheduled one) reads the board but not the company list again.
    const wantProfiles = all || !before?.profiles_block || before.profiles_block !== blockOf(now());
    let res;
    try { res = await readNetwork(net, { fetcher, now, covered: coveredBy(ds), profiles: wantProfiles || all, force: all, limit, shouldStop: () => budget?.shouldStop() ?? false }); } catch (err) { stats.errors += 1; continue; }
    await transact(dir, (work, { at }) => {
      work.job_vc_boards ??= [];
      const row = { ...res.row };
      if (!wantProfiles && before?.profiles_block) row.profiles_block = before.profiles_block;
      const i = work.job_vc_boards.findIndex((r) => r.id === net.id);
      if (i === -1) work.job_vc_boards.push(row); else work.job_vc_boards[i] = row;
      if (res.sample.length) {
        const { stats: s, reviews } = applySample(work, { id: net.id, name: net.name, label: net.label }, res.sample, { at, keptReview: keptReview(work) });
        work.job_sources = buildCatalogue(work, { review: reviews, at });
        for (const k of ['sighted', 'known', 'review_boards', 'leads']) stats[k] += s[k];
      }
      const p = applyProfiles(work, net, res.profiles, { at, now });
      stats.profiles_read += p.read; stats.in_directory += p.in_directory; stats.hiring_hints += p.hints; stats.already_queued += p.already_queued;
      stats.new_leads += p.leads_new; stats.investor_leads += p.investor_leads; stats.settled += p.settled;
      return {};
    }, lock);
    stats.checked += 1;
    stats.stopped = res.stats.stopped ?? stats.stopped;
  }
  return stats;
}

// The official portfolio pages that are due (each once a week): the companies they name that nothing has seen, matched against the directory. portfolio.js
// `all`: every page now (`jobsync portfolio --all`); `only`: these page ids.
export async function runPortfolio(ctx, budget, { all = false, only = null, limit = PORTFOLIO_READS_PER_RUN } = {}) {
  const { dir, now = Date.now, lock, fetcher, force = false } = ctx;
  const stats = { due: 0, checked: 0, listed: 0, new: 0, read: 0, errors: 0, entries: 0, in_directory: 0, already_queued: 0, same_name: 0, rejected_by_check: 0, new_leads: 0, rechecked: 0, now_australian: 0, unread: [], layout_changed: [], stopped: null };
  const { ds } = await snapshot(dir, lock);
  const seen = seenUrls(ds);
  const rows = new Map((ds.job_vc_boards ?? []).map((r) => [r.id, r]));
  const due = PORTFOLIOS.filter((p) => (!only || only.includes(p.id)) && (all || force || portfolioDue(rows.get(portfolioRowId(p)), now())));
  stats.due = due.length;
  for (const source of due) {
    if (budget?.shouldStop()) break;
    const saved = savedScanKeys(source);
    let res;
    try { res = await readPortfolio(source, { fetcher, now, known: (k) => saved.has(k) || seen.has(k), limit: Math.max(0, limit - stats.read), shouldStop: () => budget?.shouldStop() ?? false }); } catch (err) { stats.errors += 1; continue; }
    if (res.status === 'ok') stats.checked += 1;
    stats.listed += res.listed; stats.new += res.new; stats.read += res.read; stats.errors += res.errors;
    if (res.status === 'unread') stats.unread.push(source.id);
    if (res.status === 'layout_changed') stats.layout_changed.push(source.id);
    stats.stopped = res.stopped ?? stats.stopped;
    const writeRow = (work, at, leads) => { work.job_vc_boards ??= []; const row = portfolioRow(source, res, { at, now: now(), leads }); const i = work.job_vc_boards.findIndex((r) => r.id === row.id); if (i === -1) work.job_vc_boards.push(row); else work.job_vc_boards[i] = row; };
    if (!res.entries.length) { await transact(dir, (work, { at }) => { writeRow(work, at, 0); return {}; }, lock); continue; }
    // The company's own website, read by the directory's engine on a scratch copy (outside the lock: it is slow), then what it said is written in one checked transaction.
    let verdicts = null;
    try { const { ds: current } = await snapshot(dir, lock); const todo = toJudge(current, res.entries); if (todo.length) verdicts = await judgeEntries(current, source, todo, { fetcher, now }); } catch (err) { stats.errors += 1; }
    await transact(dir, (work, { at }) => {
      const p = applyPortfolio(work, source, res.entries, { at, verdicts });
      writeRow(work, at, p.leads_new);
      stats.entries += p.entries; stats.rejected_by_check += p.rejected_by_check; stats.in_directory += p.in_directory; stats.already_queued += p.already_queued; stats.same_name += p.same_name; stats.new_leads += p.leads_new;
      return {};
    }, lock);
    for (const e of res.entries) seen.add(e.key);
  }
  // A few portfolio leads whose own site said nothing about where the company is, judged again a month on (portfolio.js).
  if (!only && !budget?.shouldStop()) {
    try {
      const { ds: current } = await snapshot(dir, lock);
      const again = recheckEntries(current, { now: now() });
      if (again.length) {
        const verdicts = await judgeEntries(current, { id: 'portfolio-recheck', publisher: 'a portfolio page', kind: 'vc_portfolio' }, again, { fetcher, now });
        await transact(dir, (work, { at }) => { const r = applyRecheck(work, again, verdicts, { at }); stats.rechecked += r.rechecked; stats.now_australian += r.now_australian; return {}; }, lock);
      }
    } catch (err) { stats.errors += 1; }
  }
  return stats;
}

// `steps`: which of STEPS to run (all by default). `only` (catalogue ids) narrows the boards step to those boards, and skips vc and discover.
export async function runJobRefresh(ctx, { budget, limit, only = null, steps = STEPS, discoveryLimit = DEFAULT_DISCOVERY_PER_RUN, discoveryConcurrency = 4, trigger = 'cli', slot = null } = {}) {
  const { dir, now = Date.now, lock } = ctx;
  const want = new Set(steps);
  const full = !only;
  const notes = [];
  const details = {};
  let vc = null;
  let discovery = null;

  if (want.has('vc') && full) {
    try { vc = await runVc(ctx, budget); details.vc = vc; if (vc.checked) notes.push(`${vc.checked} venture board(s) checked`); } catch (err) { details.vc = { error: err.message }; notes.push(`venture boards failed: ${err.message}`); }
  }
  let network = null;
  if (want.has('network') && full) {
    try {
      network = await runNetwork(ctx, budget); details.network = network;
      if (network.checked) notes.push(`${network.profiles_read} network company page(s) read${network.new_leads ? `, ${network.new_leads} new lead(s)` : ''}${network.hiring_hints ? `, ${network.hiring_hints} hiring company(ies) to look at` : ''}`);
    } catch (err) { details.network = { error: err.message }; notes.push(`job network failed: ${err.message}`); }
  }
  let portfolio = null;
  if (want.has('portfolio') && full) {
    try {
      portfolio = await runPortfolio(ctx, budget); details.portfolio = portfolio;
      if (portfolio.checked) notes.push(`${portfolio.checked} portfolio page(s) read, ${portfolio.read} new compan${portfolio.read === 1 ? 'y' : 'ies'} looked at${portfolio.new_leads ? `, ${portfolio.new_leads} new lead(s)` : ''}`);
    } catch (err) { details.portfolio = { error: err.message }; notes.push(`portfolio pages failed: ${err.message}`); }
  }
  let confirmed = null;
  if (want.has('confirm') && full) {
    try {
      confirmed = await confirmReviewBoards({ dir, fetcher: ctx.fetcher, now, lock, shouldStop: () => budget?.shouldStop() ?? false });
      details.confirm = confirmed;
      if (confirmed.approved.length) notes.push(`${confirmed.approved.length} venture-named board(s) confirmed through the employer`);
    } catch (err) { details.confirm = { error: err.message }; notes.push(`confirming boards failed: ${err.message}`); }
  }
  if (want.has('discover') && full) {
    try {
      discovery = await runDiscovery({ dir, fetcher: ctx.fetcher, now, limit: discoveryLimit, concurrency: discoveryConcurrency, shouldStop: () => budget?.shouldStop() ?? false });
      details.discovery = discovery;
      if (discovery.read) notes.push(`${discovery.read} company website(s) looked at, ${discovery.boards} new job board(s) found${discovery.deferred ? `, ${discovery.deferred} still due` : ''}`);
    } catch (err) { details.discovery = { error: err.message }; notes.push(`board discovery failed: ${err.message}`); }
  }

  const out = want.has('boards')
    ? await runJobSync(ctx, { budget, limit, only })
    : { due: 0, processed: 0, changed: 0, failed: 0, deferred: 0, requests: 0, summary: '', details: null, error: null };
  out.details = { ...(out.details ?? {}), ...details };

  let dedupe = { removed: 0, released: 0, hidden: 0, groups: 0 };
  if (want.has('dedupe') || want.has('health')) {
    try {
      await transact(dir, (work, { at }) => {
        if (want.has('dedupe')) dedupe = dedupeRoles(work.jobs, { now: now() });
        if (want.has('health') && full) {
          const boards = out.details?.boards ?? [];
          const row = buildHealthRow(work, {
            at, trigger, slot, boards: { ok: out.processed + (discovery?.boards ?? 0) + (vc?.own_boards ?? 0) + (confirmed?.approved.length ?? 0), failed: out.failed, held: boards.filter((b) => b.outcome === 'suspicious_empty').length },
            totals: { ...(out.details?.totals ?? {}), added: (out.details?.totals?.added ?? 0) + (discovery?.roles_added ?? 0) + (vc?.roles_added ?? 0) + (confirmed?.approved ?? []).reduce((n, a) => n + a.roles_added, 0) }, dedupe, discovery: discovery ? { eligible: discovery.eligible } : null, vc, stoppedFor: budget?.stoppedFor?.() ?? null,
          });
          pushHealth(work, row);
          details.health = row;
        }
        return {};
      }, lock);
      out.details.dedupe = dedupe;
      if (details.health) out.details.health = details.health;
      if (dedupe.removed) notes.push(`${dedupe.removed} duplicate role(s) hidden`);
    } catch (err) { out.details.dedupe = { error: err.message }; notes.push(`dedupe/health failed: ${err.message}`); }
  }

  // The counts a run log row carries cover every step, so a refresh that only looked at companies is not "idle".
  if (vc) { out.due += vc.due; out.processed += vc.checked; out.failed += vc.errors; }
  if (network) { out.due += network.due; out.processed += network.checked; out.failed += network.errors; }
  if (portfolio) { out.due += portfolio.due; out.processed += portfolio.checked; out.failed += portfolio.errors; }
  if (discovery) { out.due += discovery.due; out.processed += discovery.read; out.failed += discovery.errors; out.changed += discovery.boards; out.deferred += discovery.deferred ?? 0; }
  out.changed += dedupe.removed;
  if (notes.length) out.summary = [out.summary, ...notes].filter(Boolean).join('; ');
  return out;
}
