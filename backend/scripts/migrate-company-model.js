// Migration 001: company data model v2 (additive, idempotent).
//
//   node scripts/migrate-company-model.js            migrate and write the data files
//   node scripts/migrate-company-model.js --dry-run  show what would change, write nothing
//   node scripts/migrate-company-model.js --check    exit 1 if any file is out of date (CI / tests)
//
// Run it after adding or editing companies in startups.json: it assigns ids and
// slugs to new records, fills derived fields, regenerates the founder/investor
// id lists and creates any missing people/investor entities. A record that
// already has a value is never overwritten, and legacy fields are never
// touched - the run aborts before writing if one would change.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadRaw, parseRaw, serializeDataset, writeFiles, migrateDataset, validateDataset,
  investorReviewNotes,
} from '../src/models/dataset.js';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data');
const flags = new Set(process.argv.slice(2));
const dryRun = flags.has('--dry-run');
const check = flags.has('--check');

const raw = await loadRaw(DATA_DIR);
const before = parseRaw(raw);
const after = migrateDataset(before);

const problems = validateDataset(after);
if (problems.length) {
  console.error(`Validation failed (${problems.length}):`);
  problems.slice(0, 50).forEach((p) => console.error(`  - ${p}`));
  process.exit(1);
}

const next = serializeDataset(after);
const changed = Object.keys(next).filter((file) => next[file] !== raw[file]);

const count = (rows, pick) => rows.reduce((acc, r) => { const k = pick(r) ?? 'null'; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
const newIds = after.companies.filter((c, i) => before.companies[i].id == null).length;
console.log(`companies: ${after.companies.length} (${newIds} newly assigned an id)`);
console.log(`people: ${after.people.length}  investors: ${after.investors.length}  sources: ${after.sources.length}  funding_rounds: ${after.funding_rounds.length}  jobs: ${after.jobs.length}  news: ${after.news.length}`);
console.log('verification_status:', JSON.stringify(count(after.companies, (c) => c.verification_status)));
console.log('hiring_status:', JSON.stringify(count(after.companies, (c) => c.hiring_status)));
console.log('company_status:', JSON.stringify(count(after.companies, (c) => c.company_status)));
console.log('state:', JSON.stringify(count(after.companies, (c) => c.state)));
const noState = after.companies.filter((c) => c.verified && c.state == null).map((c) => c.name);
if (noState.length) console.log(`verified but state not derivable (left null): ${noState.join(', ')}`);

const notes = investorReviewNotes(after.investors);
if (notes.length) {
  console.log('\nInvestor names for a human to review (not merged automatically):');
  notes.forEach((n) => console.log(`  - "${n.name}": ${n.issue}`));
}

console.log(`\nfiles ${changed.length ? 'to change' : 'up to date'}: ${changed.join(', ') || '-'}`);

if (check) process.exit(changed.length ? 1 : 0);
if (dryRun || !changed.length) process.exit(0);

await writeFiles(DATA_DIR, Object.fromEntries(changed.map((f) => [f, next[f]])));
console.log('written.');
