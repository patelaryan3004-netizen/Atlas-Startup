// Data-completeness audit. Read-only: prints a coverage report and a prioritized
// enrichment queue, and never changes a data file.
//
//   npm run data:audit                          console summary
//   npm run data:audit -- --out ../docs/data-quality   also write the report and CSVs
//   npm run data:audit -- --as-of 2026-12-01    judge staleness as of another date
//   npm run data:audit -- --json                full audit as JSON
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRaw, parseRaw } from '../src/models/dataset.js';
import { auditDataset } from '../src/models/audit.js';
import { renderConsole, renderMarkdown, queueToCsv, companiesToCsv } from '../src/models/auditReport.js';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data');
const args = process.argv.slice(2);
const valueOf = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

// Optional context for the report: which days startups.json was committed. Not
// available outside a git checkout, in which case the report just omits it.
function commitDates() {
  try {
    const out = execFileSync('git', ['log', '--format=%cs', '--', path.join(DATA_DIR, 'startups.json')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return [...new Set(out.split('\n').filter(Boolean))].sort();
  } catch {
    return [];
  }
}

const ds = parseRaw(await loadRaw(DATA_DIR));
const audit = auditDataset(ds, { asOf: valueOf('--as-of') });

if (args.includes('--json')) {
  const { companies, ...rest } = audit;
  console.log(JSON.stringify({ ...rest, companies }, null, 2));
} else {
  console.log(renderConsole(audit));
}

const out = valueOf('--out');
if (out) {
  const dir = path.resolve(out);
  await mkdir(dir, { recursive: true });
  const files = {
    [`completeness-${audit.asOf}.md`]: renderMarkdown(audit, { commitDates: commitDates() }),
    [`completeness-by-company-${audit.asOf}.csv`]: companiesToCsv(audit),
    [`enrichment-queue-${audit.asOf}.csv`]: queueToCsv(audit.queue),
  };
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(dir, name), text, 'utf-8');
  console.log(`\nwrote ${Object.keys(files).join(', ')} to ${dir}`);
}
