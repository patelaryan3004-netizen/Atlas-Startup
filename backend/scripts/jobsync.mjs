// The job sync's own commands. The hourly run itself is the scheduler's job (`npm run scheduler -- tick --job jobsync`); this is for setting it up and looking at it.
// See docs/jobs-sync.md.
//
//   npm run jobsync -- sources [--write]     the catalogue of employer boards: approved ones from sources.json, the pilot's named-but-unconfirmed ones in review
//   npm run jobsync -- status                where every board stands: last whole read, failures, next try, roles held
//   npm run jobsync -- read <source-id>      read one board now and show what it WOULD do to the roles; writes nothing
//   npm run jobsync -- board                 the hiring desk's counts, as the API will serve them
//   npm run jobsync -- discover [--all|--limit N|--company a,b] [--force] [--plan]   find the job board of companies from their own websites (see src/jobsync/discover.js)
//   npm run jobsync -- network [--all] [--limit N]   read Innovation Bay now: its board's sample and company list (this half-day's slice, or every company with --all), matched against the directory
//   npm run jobsync -- portfolio [--all] [--source id] [--limit N]   read the official portfolio pages now (each is read once a week by the refresh): new companies become leads
//   npm run jobsync -- leads [--status s] [--kind k]            the companies and venture firms the boards and networks named that the directory does not hold
//   npm run jobsync -- leads --promote --by "name" [--limit N] [--source id]  hand the eligible startups to the directory's review queue (candidates.json): the engine reads each one's own website
//   npm run jobsync -- confirmed [--write]    approve the boards read in a browser (scripts/jobsync-confirmed.json), each only if its own feed confirms the page
//   npm run jobsync -- verify [--links]      the final check: duplicates, expired roles, Australian eligibility, application links, timestamps
//   npm run jobsync -- slot [--force] [--now ISO]   is a refresh due now (8:00 am / 8:00 pm Melbourne time, once each)? run=yes|no
//   npm run jobsync -- meaningful            did the last run change anything a visitor could see (against the last commit)? the hourly workflow commits only if so, or once a day
//
// Add --data <dir> to work on a copy of the data files.
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { snapshot, transact } from '../src/models/store.js';
import { jobSyncFetcher } from '../src/jobsync/fetcher.js';
import { runDiscovery, planDiscovery, keptReview, DEFAULT_DISCOVERY_PER_RUN } from '../src/jobsync/discoverRun.js';
import { readSource, SyncError, SUPPORTED } from '../src/jobsync/adapters.js';
import { applyRead } from '../src/jobsync/engine.js';
import { buildCatalogue, coverage } from '../src/jobsync/sources.js';
import { buildBoard } from '../src/network/board.js';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { compareJobs, compareHealth, compareLedgers, worthCommitting } from '../src/jobsync/changes.js';
import { decide } from '../src/jobsync/slot.js';
import { verifyData, verifyLinks } from '../src/jobsync/verify.js';
import { confirmFromFile } from '../src/jobsync/confirm.js';
import { employerMap } from '../src/jobsync/employers.js';
import { runNetwork, runPortfolio } from '../src/jobsync/refresh.js';
import { NETWORKS, NETWORK_READS_PER_RUN, queueable, engineLead, markQueued } from '../src/jobsync/network.js';
import { discoverySources } from '../src/jobsync/discoverySources.js';
import { PORTFOLIO_READS_PER_RUN, SOURCES as PORTFOLIOS } from '../src/jobsync/portfolio.js';
import { main as discovery } from './discovery.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = path.join(HERE, '..', 'src', 'data');

function parse(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const next = argv[i + 1];
    flags[a.slice(2)] = next === undefined || next.startsWith('--') ? true : (i += 1, next);
  }
  return { positional, flags };
}

const ago = (iso, now) => {
  if (!iso) return 'never';
  const m = Math.round((now - Date.parse(iso)) / 60000);
  return m < 90 ? `${Math.max(m, 0)} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

// `fetcher`: a test's own (the leads --promote path reads company websites); otherwise each command makes the compliant fetcher it needs.
export async function main(argv, { out = console.log, now = Date.now, fetcher: injected = null } = {}) {
  const { positional: [command = 'status', ...args], flags } = parse(argv);
  const dir = path.resolve(typeof flags.data === 'string' ? flags.data : DEFAULT_DIR);
  const at = new Date(now()).toISOString();
  switch (command) {
    case 'sources': {
      const named = JSON.parse(await readFile(path.join(HERE, 'jobsync-candidates.json'), 'utf8'));
      const { ds } = await snapshot(dir, { now });
      // The boards already waiting in the catalogue (named by a venture firm's board, say) are kept beside the ones in the candidates file: rebuilding must not drop them.
      const review = [...named, ...keptReview(ds).filter((k) => !named.some((n) => n.company_id === k.company_id && n.provider === k.provider && String(n.token).toLowerCase() === String(k.token).toLowerCase()))];
      const rows = buildCatalogue(ds, { review, at });
      if (flags.write) {
        await transact(dir, (work) => { work.job_sources = rows; return {}; }, { now });
        out(`wrote ${rows.length} board(s) to job_sources.json`);
      } else out('(nothing written: add --write)');
      const c = coverage({ ...ds, job_sources: rows });
      out(`${c.approved} approved (${c.polled} the sync can read, covering ${c.companies_polled} of ${c.companies_in_directory} companies), ${c.review.length} in review, ${c.unsupported.length} approved but unsupported`);
      for (const r of rows) out(`  ${r.status.padEnd(9)} ${r.provider.padEnd(16)} ${r.company_id.padEnd(22)} ${SUPPORTED.includes(r.provider) ? '' : '(no reader yet)'}`);
      return 0;
    }
    case 'status': {
      const { ds } = await snapshot(dir, { now });
      const byId = new Map((ds.job_sync_state ?? []).map((r) => [r.source_id, r]));
      const held = (id) => ds.jobs.filter((j) => j.source_id === id && j.status === 'open').length;
      out(`${'board'.padEnd(34)} ${'status'.padEnd(9)} ${'last whole read'.padEnd(14)} ${'fails'.padEnd(5)} ${'next try'.padEnd(14)} open roles`);
      for (const s of ds.job_sources ?? []) {
        const r = byId.get(s.id);
        const next = r?.next_attempt_at ? (Date.parse(r.next_attempt_at) <= now() ? 'due' : `in ${Math.round((Date.parse(r.next_attempt_at) - now()) / 60000)} min`) : 'due';
        out(`${s.id.padEnd(34)} ${(SUPPORTED.includes(s.provider) ? s.status : `${s.status}*`).padEnd(9)} ${ago(r?.last_success_at, now()).padEnd(14)} ${String(r?.consecutive_failures ?? 0).padEnd(5)} ${next.padEnd(14)} ${held(s.id)}${r?.last_error ? `   last error: ${r.last_error.code}` : ''}`);
      }
      out('* approved, but the sync has no reader for this provider yet');
      return 0;
    }
    case 'read': {
      const [id] = args;
      const { ds } = await snapshot(dir, { now });
      const source = (ds.job_sources ?? []).find((s) => s.id === id);
      if (!source) throw new Error(`no board "${id}" in job_sources.json (run: sources --write)`);
      const fetcher = jobSyncFetcher();
      const company = ds.companies.find((c) => c.id === source.company_id);
      try {
        const read = await readSource(source, { fetcher, now: now(), companyWebsite: company?.website ?? '' });
        const rows = structuredClone(ds.jobs);
        const stats = applyRead(rows, source, read, { now: now() });
        out(`${id}: read whole (${read.pages} page(s), ${read.attempts} attempt(s)): ${stats.listed} listed, ${stats.usable} usable`);
        out(JSON.stringify(stats));
        out('(a dry read: nothing was written)');
        return 0;
      } catch (err) {
        if (!(err instanceof SyncError)) throw err;
        out(`${id}: could not be read (${err.code}): ${err.message}`);
        return 2;
      }
    }
    case 'board': {
      const { ds } = await snapshot(dir, { now });
      const employers = employerMap(ds);
      const cards = new Map([...employers].map(([id, e]) => [id, { name: e.name, slug: e.slug, city: e.city, sector: e.sector, stage: e.stage, website: e.website, kind: e.kind, logo: e.logo, investors: e.investors }]));
      const board = buildBoard({ jobs: ds.jobs, cardOf: (id) => cards.get(id) ?? null, sync: { sources: ds.job_sources ?? [], state: ds.job_sync_state ?? [] }, names: new Map([...employers].map(([id, e]) => [id, { name: e.name, slug: e.slug }])), now: now() });
      out(JSON.stringify({ generated_at: board.generated_at, ...board.totals, last_success_at: board.sync.last_success_at, boards: board.sync.boards }, null, 2));
      return 0;
    }
    case 'discover': {
      const only = typeof flags.company === 'string' ? flags.company.split(',').map((s) => s.trim()).filter(Boolean) : null;
      const limit = flags.all ? Infinity : flags.limit ? Number(flags.limit) : DEFAULT_DISCOVERY_PER_RUN;
      const force = Boolean(flags.force);
      if (flags.plan) {
        const p = await planDiscovery(dir, { now, limit, force, only });
        out(JSON.stringify({ eligible: p.eligible, ineligible: p.ineligible, due: p.due, planned: p.planned.length }));
        return 0;
      }
      const fetcher = jobSyncFetcher();
      let n = 0;
      const stats = await runDiscovery({
        dir, fetcher, now, limit, force, only, concurrency: Number(flags.concurrency ?? 6),
        onResult: ({ company, result, error }) => { n += 1; out(`${String(n).padStart(4)} ${company.id.padEnd(30)} ${error ? `error: ${error}` : `${result.outcome}${result.boards.length ? ' ' + result.boards.map((b) => `${b.provider}:${b.token ?? b.host}${b.listed != null ? '(' + b.listed + ')' : ''}`).join(',') : ''}`}`); },
      });
      out(JSON.stringify(stats));
      return 0;
    }
    case 'network': {
      const fetcher = injected ?? jobSyncFetcher({ minDelayMs: Math.max(...NETWORKS.map((n) => n.delay_ms)), maxBytes: 3000000 });
      const all = Boolean(flags.all);
      const limit = flags.limit ? Number(flags.limit) : all ? Infinity : NETWORK_READS_PER_RUN;
      const stats = await runNetwork({ dir, now, fetcher, networkFetcher: fetcher, lock: { now }, force: true }, null, { all, limit });
      out(JSON.stringify(stats));
      return 0;
    }
    case 'portfolio': {
      const fetcher = injected ?? jobSyncFetcher({ minDelayMs: 1500, maxBytes: 6000000 });
      const only = typeof flags.source === 'string' ? flags.source.split(',') : null;
      const stats = await runPortfolio({ dir, now, fetcher, lock: { now }, force: true }, null, { all: Boolean(flags.all) || Boolean(only), only, limit: flags.limit ? Number(flags.limit) : flags.all ? Infinity : PORTFOLIO_READS_PER_RUN });
      out(JSON.stringify(stats));
      return 0;
    }
    case 'leads': {
      const { ds } = await snapshot(dir, { now });
      if (!flags.promote) {
        const rows = (ds.job_leads ?? []).filter((l) => (typeof flags.status !== 'string' || l.status === flags.status) && (typeof flags.kind !== 'string' || l.kind === flags.kind));
        for (const l of rows) out(`${l.status.padEnd(12)} ${l.kind.padEnd(16)} ${l.name.padEnd(34)} ${(l.profile?.locations?.[0] ?? '').padEnd(28)} ${l.profile?.employees ?? '-'} people, ${l.profile?.active_jobs ?? '-'} jobs  ${l.profile?.website ?? ''}`);
        const by = {}; for (const l of ds.job_leads ?? []) by[`${l.kind}/${l.status}`] = (by[`${l.kind}/${l.status}`] ?? 0) + 1;
        out(JSON.stringify({ leads: (ds.job_leads ?? []).length, shown: rows.length, by }));
        return 0;
      }
      if (typeof flags.by !== 'string') throw new Error('--by "name" is required: every decision is recorded with a name');
      const wanted = typeof flags.source === 'string' ? flags.source.split(',') : null;
      const sources = discoverySources().filter((x) => !wanted || wanted.includes(x.id));
      if (!sources.length) throw new Error(`unknown source "${flags.source}" (${discoverySources().map((x) => x.id).join(', ')})`);
      let room = flags.limit ? Number(flags.limit) : 25;
      let code = 0;
      for (const src of sources) {
        const { ds: now0 } = await snapshot(dir, { now });
        const picks = queueable(now0, { limit: room, firm: src.id });
        if (!picks.length) continue;
        out(`${src.name}: ${picks.length} lead(s) to hand to the directory's review queue`);
        room -= picks.length;
        if (flags['dry-run']) { for (const l of picks) out(`  ${l.name} (${l.profile.website})`); continue; }
        // The directory's own engine: matches each against the directory and the queue again, reads the company's OWN website (robots.txt obeyed, three pages), judges Australian and startup.
        const source = { id: src.id, kind: src.evidence_kind, region: 'AU', license: { basis: 'permitted_page' }, licenseBasis: 'permitted_page', discover: async () => picks.map((l) => engineLead(l, src)) };
        code = (await discovery(['run', '--by', flags.by, '--source', src.id, '--data', dir], { sources: [source], out, now, ...(injected ? { fetcher: injected } : {}) })) || code;
        let marked;
        await transact(dir, (work, { at }) => { marked = markQueued(work, src, { at }); return {}; }, { now });
        out(JSON.stringify({ source: src.id, ...marked }));
        if (room <= 0) break;
      }
      if (room === (flags.limit ? Number(flags.limit) : 25)) out("0 lead(s) to hand to the directory's review queue");
      return code;
    }
    case 'confirmed': {
      // Approve the boards listed in scripts/jobsync-confirmed.json (companies whose careers page draws its jobs by script, read in a browser): each only if its feed answers whole and the
      // page's claim is confirmed by that feed. Dry run unless --write.
      const entries = JSON.parse(await readFile(path.join(HERE, 'jobsync-confirmed.json'), 'utf8'));
      const results = await confirmFromFile({ dir, entries, fetcher: jobSyncFetcher(), now, write: Boolean(flags.write) });
      for (const r of results) out(`  ${r.ok ? (r.already ? 'already  ' : flags.write ? 'APPROVED ' : 'would approve') : 'KEPT OUT '} ${r.company_id.padEnd(14)} ${r.provider}:${r.token}  ${r.ok ? (r.listed != null ? r.listed + ' listed' + (r.roles_added != null ? ', ' + r.roles_added + ' role(s) added' : '') : '') : r.note}`);
      if (!flags.write) out('(nothing written: add --write)');
      return results.every((r) => r.ok) ? 0 : 2;
    }
    case 'verify': {
      // The final check: duplicates, expired vacancies, Australian eligibility, application links and timestamps. --links also asks each open role's application address whether it still answers.
      const { ds } = await snapshot(dir, { now });
      const r = verifyData(ds, { now: now() });
      const result = { counts: r.counts, violations: r.violations.length, by_kind: r.violations.reduce((m, v) => ({ ...m, [v.kind]: (m[v.kind] ?? 0) + 1 }), {}), notes: r.notes };
      let links = null;
      if (flags.links) {
        const onDesk = new Set(r.board.roles.map((x) => x.id));
        const roles = ds.jobs.filter((j) => onDesk.has(j.id));
        links = await verifyLinks(roles, { fetcher: jobSyncFetcher({ minDelayMs: 1000, maxBytes: 3000000 }), concurrency: Number(flags.concurrency ?? 6) });
        result.links = { checked: roles.length, ok: links.ok, gone: links.gone.length, not_checked: links.not_checked.length, unreachable: links.unreachable.length };
      }
      out(JSON.stringify(result, null, 1));
      for (const v of r.violations.slice(0, 60)) out(`  VIOLATION ${v.kind.padEnd(11)} ${v.id}: ${v.msg}`);
      if (links) for (const g of links.gone) out(`  LINK GONE  ${g.id}: ${g.url} (${g.why})`);
      if (links?.not_checked.length) out(`  not checked (robots, login or rate limit): ${[...new Set(links.not_checked.map((x) => new URL(x.url).hostname))].join(', ')}`);
      if (links?.unreachable.length) out(`  unreachable (not proof of anything): ${links.unreachable.slice(0, 5).map((x) => x.url).join(' ')}`);
      return r.violations.length || links?.gone.length ? 2 : 0;
    }
    case 'slot': {
      // Should the timer's firing run a refresh? Writes run=yes|no and slot=... for the workflow (GITHUB_OUTPUT). See src/jobsync/slot.js.
      const { ds } = await snapshot(dir, { now });
      const when = typeof flags.now === 'string' ? Date.parse(flags.now) : now();
      const verdict = decide({ now: when, done: (ds.job_health ?? []).map((r) => r.slot).filter(Boolean), force: Boolean(flags.force) });
      out(JSON.stringify(verdict));
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run=${verdict.run ? 'yes' : 'no'}\nslot=${verdict.slot ?? ''}\n`);
      return 0;
    }
    case 'meaningful': {
      // Against what is committed: the working data files against HEAD. Used by the twice-daily workflow (docs/jobs-sync.workflow.yml) to decide whether a refresh is worth a commit, and whether that commit should redeploy the API.
      const repo = path.resolve(HERE, '..', '..');
      const rel = (f) => path.relative(repo, path.join(dir, f)).split(path.sep).join('/');
      const committed = (f) => { try { return JSON.parse(execFileSync('git', ['show', `HEAD:${rel(f)}`], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'ignore'] })); } catch (e) { return []; } };
      const working = async (f) => JSON.parse(await readFile(path.join(dir, f), 'utf8'));
      const jobs = compareJobs(committed('jobs.json'), await working('jobs.json'));
      const health = compareHealth(committed('job_sync_state.json'), await working('job_sync_state.json'));
      const ledgerFiles = ['job_sources', 'job_coverage', 'job_leads', 'job_vc_boards'];
      const ledger = compareLedgers(Object.fromEntries(ledgerFiles.map((f) => [f, committed(f + '.json')])), Object.fromEntries(await Promise.all(ledgerFiles.map(async (f) => [f, await working(f + '.json')]))));
      let ageHours = Infinity;
      try { const t = Date.parse(execFileSync('git', ['log', '-1', '--format=%cI', '--', rel('job_health.json')], { cwd: repo, encoding: 'utf8' }).trim()); if (Number.isFinite(t)) ageHours = (now() - t) / 3600000; } catch (e) { /* never committed */ }
      const verdict = worthCommitting({ jobs, health, ledger, ageHours: Number.isFinite(ageHours) ? ageHours : 1e6 });
      out(JSON.stringify({ ...verdict, jobs, health_changed: health, ledger_changed: ledger, age_hours: Number.isFinite(ageHours) ? Math.round(ageHours * 10) / 10 : null }));
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `commit=${verdict.commit ? 'yes' : 'no'}
deploy=${verdict.deploy ? 'yes' : 'no'}
reason=${verdict.reason}
`);
      return 0;
    }
    default: throw new Error(`unknown command "${command}": sources, status, read, board, discover, network, portfolio, leads, confirmed, slot, verify, meaningful`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => { console.error(`error: ${err.message}`); process.exitCode = 1; });
}
