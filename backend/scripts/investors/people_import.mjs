// Imports a list of investors (people at firms) from a public directory into the investor layer. Read docs/investors.md ("Importing a directory of people").
//
// The list is a FILE this script reads (CSV or JSON). It never fetches a page: whoever exports the list from the page they are allowed to read says where it
// came from and when, and the importer records that and does not claim to have read the page itself. (Lyra Capital's network list loads from /api/connections,
// which that site's robots.txt disallows, so this project does not fetch it; see docs/investors.md.)
//
// The columns: name, role, firm, location, profile_url (a LinkedIn /in/ address or a personal site), firm_website. Other names for them are understood
// (title, company, area, linkedin, website...). A row needs a name, a role and a firm.
//
//   node scripts/investors/people_import.mjs --from list.csv --source-url https://example.com/network --retrieved-at 2026-10-23 --retrieved-by "who exported it"
//        [--source-name "Name of the directory"] [--data <dir>] [--report <file.json>] [--limit-lines 12] [--runs <dir>]
//           a DRY RUN: says what each row would do, and writes nothing
//   ... --apply --by "name"
//           does it: backs up the files it will change to backend/.import-runs/<run>/before/, writes a manifest of what it made, and records it in the audit trail
//   node scripts/investors/people_import.mjs --undo <run> --by "name" [--data <dir>]
//           takes out what that run made, if no person has worked on it since
//
// Everything new is a candidate: nothing is public until a person checks it against pages the firm publishes and publishes it.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../discovery.js';
import { transact } from '../../src/models/store.js';
import { loadRaw, parseRaw } from '../../src/models/dataset.js';
import { readTable, planImport, applyPlan, undoRun, reportText } from '../../src/investors/peopleImport.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.join(HERE, '..', '..');
const DEFAULT_RUNS = path.join(BACKEND, '.import-runs');
const FILES = ['investors.json', 'investor_people.json', 'investor_people_organisations.json', 'verification_records.json', 'sources.json', 'audit_trail.json'];

const { flags } = parseArgs(process.argv.slice(2));
const text = (name) => (typeof flags[name] === 'string' && flags[name].trim() ? flags[name].trim() : null);
const dir = path.resolve(text('data') ?? path.join(BACKEND, 'src', 'data'));
const by = text('by');
const RUNS = path.resolve(text('runs') ?? DEFAULT_RUNS); // where a run keeps its backup, manifest and report (a test points it at a temporary folder)
const need = (name, why) => { const v = text(name); if (!v) throw new Error(`--${name} is required: ${why}`); return v; };
const stamp = (d = new Date()) => d.toISOString().replace(/\D/g, '').slice(0, 17); // to the millisecond: two runs are never one folder
const audit = (action, runId, summary, reason) => [{ actor: { name: by, role: 'cli' }, via: 'cli', action, target: { type: 'system', id: runId }, summary, reason: reason ?? null }];

async function main() {
  if (text('undo')) {
    const runId = text('undo');
    const manifestFile = path.join(RUNS, runId, 'manifest.json');
    if (!existsSync(manifestFile)) throw new Error(`no import run "${runId}" (looked for ${manifestFile}); runs: ${existsSync(RUNS) ? readdirSync(RUNS).join(', ') || 'none' : 'none'}`);
    need('by', 'every change is recorded with a name');
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    const { result } = await transact(dir, (work) => {
      const done = undoRun(work, manifest.made);
      return { result: done, audit: audit('investor.import', runId, `Undid import run ${runId}: took out ${done.people} people and ${done.firms} firms it made`, 'Undone with people_import.mjs --undo') };
    });
    console.log(`undone: ${result.people} people, ${result.firms} firms, ${result.filled} filled fields put back`);
    return;
  }

  const from = need('from', 'the file to read (CSV or JSON)');
  const sourceUrl = need('source-url', 'the address of the page the list was read from');
  const retrievedAt = need('retrieved-at', 'the day the list was read (this script never claims to have read a page itself)');
  const table = readTable(readFileSync(path.resolve(from), 'utf8'), { format: from.toLowerCase().endsWith('.json') ? 'json' : null });
  const source = { url: sourceUrl, retrievedAt, retrievedBy: text('retrieved-by'), name: text('source-name') ?? undefined };
  const limit = Number(flags['limit-lines'] ?? 12);

  if (!flags.apply) {
    const ds = parseRaw(await loadRaw(dir));
    const plan = planImport(ds, table, source);
    console.log(reportText(plan, { limit }));
    if (text('report')) { writeFileSync(path.resolve(text('report')), `${JSON.stringify(plan.report, null, 2)}\n`); console.log(`\nreport written to ${text('report')}`); }
    console.log('\nNothing was written. Add --apply --by "name" to do it.');
    return;
  }

  need('by', 'every change is recorded with a name');
  const runId = `${text('source-name') ? text('source-name').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : 'import'}-${stamp()}`;
  let shown;
  const { changed } = await transact(dir, (work, { at }) => {
    const plan = planImport(work, table, source);
    shown = plan;
    // The backup is taken inside the transaction, so it is the very files this run changes, before it changes them.
    const before = path.join(RUNS, runId, 'before');
    mkdirSync(before, { recursive: true });
    for (const f of FILES) if (existsSync(path.join(dir, f))) copyFileSync(path.join(dir, f), path.join(before, f));
    const made = applyPlan(work, plan, { at });
    writeFileSync(path.join(RUNS, runId, 'manifest.json'), `${JSON.stringify({ runId, at, by, source: plan.source, made }, null, 2)}\n`);
    writeFileSync(path.join(RUNS, runId, 'report.json'), `${JSON.stringify({ report: plan.report, rows: plan.rows.map((r) => ({ n: r.n, listed: r.listed, status: r.status, reason: r.reason, notes: r.notes })) }, null, 2)}\n`);
    const summary = `Imported ${made.investor_people.length} people and ${made.investors.length} firms from ${plan.source.name} (read ${plan.source.retrieved_at.slice(0, 10)}); ${plan.report.conflicts} conflicts and ${plan.report.skipped} skipped rows kept for review`;
    return { audit: audit('investor.import', runId, summary, `Run ${runId}; backup and manifest in backend/.import-runs/${runId}`) };
  });
  console.log(reportText(shown, { applied: true, limit }));
  console.log(`\nwrote ${changed.join(', ') || 'nothing'}\nrun ${runId}: backup, manifest and report are in backend/.import-runs/${runId}; undo with --undo ${runId} --by "name"`);
}

main().catch((err) => { console.error(`error: ${err.message}`); process.exitCode = 1; });
