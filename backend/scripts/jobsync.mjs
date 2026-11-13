// The job sync's own commands. The hourly run itself is the scheduler's job (`npm run scheduler -- tick --job jobsync`); this is for setting it up and looking at it.
// See docs/jobs-sync.md.
//
//   npm run jobsync -- sources [--write]     the catalogue of employer boards: approved ones from sources.json, the pilot's named-but-unconfirmed ones in review
//   npm run jobsync -- status                where every board stands: last whole read, failures, next try, roles held
//   npm run jobsync -- read <source-id>      read one board now and show what it WOULD do to the roles; writes nothing
//   npm run jobsync -- board                 the hiring desk's counts, as the API will serve them
//   npm run jobsync -- meaningful            did the last run change anything a visitor could see (against the last commit)? the hourly workflow commits only if so, or once a day
//
// Add --data <dir> to work on a copy of the data files.
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { snapshot, transact } from '../src/models/store.js';
import { createFetcher } from '../src/discovery/http.js';
import { readSource, SyncError, SUPPORTED } from '../src/jobsync/adapters.js';
import { applyRead } from '../src/jobsync/engine.js';
import { buildCatalogue, coverage } from '../src/jobsync/sources.js';
import { buildBoard } from '../src/network/board.js';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { compareJobs, compareHealth, worthCommitting } from '../src/jobsync/changes.js';

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

export async function main(argv, { out = console.log, now = Date.now } = {}) {
  const { positional: [command = 'status', ...args], flags } = parse(argv);
  const dir = path.resolve(typeof flags.data === 'string' ? flags.data : DEFAULT_DIR);
  const at = new Date(now()).toISOString();
  switch (command) {
    case 'sources': {
      const review = JSON.parse(await readFile(path.join(HERE, 'jobsync-candidates.json'), 'utf8'));
      const { ds } = await snapshot(dir, { now });
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
      const fetcher = createFetcher({ userAgent: 'AUStartupMapBot/1.0 (+https://stillearly-au.vercel.app/; job board sync)', maxBytes: 4000000, minDelayMs: 1500 });
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
      const cards = new Map(ds.companies.map((c) => [c.id, { name: c.name, slug: c.slug, city: c.city ?? '', sector: c.sector ?? '', stage: c.stage ?? '', website: c.website ?? '' }]));
      const board = buildBoard({ jobs: ds.jobs, cardOf: (id) => cards.get(id) ?? null, sync: { sources: ds.job_sources ?? [], state: ds.job_sync_state ?? [] }, names: new Map(ds.companies.map((c) => [c.id, { name: c.name, slug: c.slug }])), now: now() });
      out(JSON.stringify({ generated_at: board.generated_at, ...board.totals, last_success_at: board.sync.last_success_at, boards: board.sync.boards }, null, 2));
      return 0;
    }
    case 'meaningful': {
      // Against what is committed: the working data files against HEAD. Used by the hourly workflow (docs/jobs-sync.workflow.yml) to decide whether a run is worth a commit.
      const repo = path.resolve(HERE, '..', '..');
      const rel = (f) => path.relative(repo, path.join(dir, f)).split(path.sep).join('/');
      const committed = (f) => { try { return JSON.parse(execFileSync('git', ['show', `HEAD:${rel(f)}`], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'ignore'] })); } catch (e) { return []; } };
      const working = async (f) => JSON.parse(await readFile(path.join(dir, f), 'utf8'));
      const jobs = compareJobs(committed('jobs.json'), await working('jobs.json'));
      const health = compareHealth(committed('job_sync_state.json'), await working('job_sync_state.json'));
      let ageHours = Infinity;
      try { ageHours = (now() - Date.parse(execFileSync('git', ['log', '-1', '--format=%cI', '--', rel('job_sync_state.json')], { cwd: repo, encoding: 'utf8' }).trim())) / 3600000; } catch (e) { /* never committed */ }
      const verdict = worthCommitting({ jobs, health, ageHours: Number.isFinite(ageHours) ? ageHours : 1e6 });
      out(JSON.stringify({ ...verdict, jobs, health_flipped: health, age_hours: Number.isFinite(ageHours) ? Math.round(ageHours * 10) / 10 : null }));
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `commit=${verdict.commit ? 'yes' : 'no'}
deploy=${verdict.deploy ? 'yes' : 'no'}
reason=${verdict.reason}
`);
      return 0;
    }
    default: throw new Error(`unknown command "${command}": sources, status, read, board, meaningful`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => { console.error(`error: ${err.message}`); process.exitCode = 1; });
}
