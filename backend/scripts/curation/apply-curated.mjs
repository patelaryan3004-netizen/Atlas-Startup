// Applies the owner's curated list (scripts/curation/curated-list.json, from Still-Early-startups-curated.xlsx) to the companies:
//   Recommended "Pin"      -> show_on_map true  (the company is drawn on the map)
//   Recommended "Not pin"  -> show_on_map false (it stays in the data, the list, the gallery and the search; it is left off the map)
//   Stage                  -> maturity (Early, Growth, Late-stage / mature, Listed, Global corp, Community / coworking, Collapsed, Unverified); a row with no stage leaves it null
//   Change "Check"         -> maturity_check true (the list could not say; the company stays on the map: the flag is how to find them again)
// Nothing else on a company is touched: not its funding `stage`, its place, its address or its description. Rows are matched to companies by name (exact, then with case, punctuation, ".ai",
// legal suffixes and "(formerly X)" taken out); a row that matches no company, or more than one, is listed and changes nothing, and so is a company the list does not name.
//
//   node scripts/curation/apply-curated.mjs plan                  what would change; nothing is written
//   node scripts/curation/apply-curated.mjs apply --by "name"     write it (one audit entry)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRaw, parseRaw } from '../../src/models/dataset.js';
import { transact } from '../../src/models/store.js';
import { MATURITIES } from '../../src/models/company.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(HERE, '..', '..', 'src', 'data');
const list = JSON.parse(readFileSync(path.join(HERE, 'curated-list.json'), 'utf8'));
const [, , step = 'plan', ...rest] = process.argv;
const by = rest[rest.indexOf('--by') + 1];

const exact = (s) => String(s ?? '').trim().toLowerCase();
const loose = (s) => String(s ?? '').toLowerCase()
  .replace(/\(formerly[^)]*\)/g, ' ').replace(/\(.*?\)/g, ' ')
  .replace(/\b(pty|ltd|limited|inc|group|holdings|co|company)\b\.?/g, ' ')
  .replace(/\.(ai|io|com|com\.au|co)\b/g, ' ').replace(/&/g, ' and ')
  .normalize('NFKD').replace(/[^a-z0-9]+/g, '');

// What the list says about each company, and what could not be matched.
function match(companies) {
  const byExact = new Map(); const byLoose = new Map();
  for (const c of companies) {
    (byExact.get(exact(c.name)) ?? byExact.set(exact(c.name), []).get(exact(c.name))).push(c);
    (byLoose.get(loose(c.name)) ?? byLoose.set(loose(c.name), []).get(loose(c.name))).push(c);
  }
  const found = []; const unmatched = []; const ambiguous = []; const used = new Map();
  for (const row of list.rows) {
    let hits = byExact.get(exact(row.startup)) ?? [];
    let how = 'exact';
    if (hits.length === 0) { hits = byLoose.get(loose(row.startup)) ?? []; how = 'normalised'; }
    if (hits.length === 0) unmatched.push(row);
    else if (hits.length > 1) ambiguous.push({ row, candidates: hits.map((c) => c.name) });
    else { found.push({ row, company: hits[0], how }); used.set(hits[0].id, (used.get(hits[0].id) ?? 0) + 1); }
  }
  const notInList = companies.filter((c) => !used.has(c.id));
  const twice = [...used].filter(([, n]) => n > 1).map(([id]) => id);
  return { found, unmatched, ambiguous, notInList, twice };
}

const wanted = (row) => ({
  show_on_map: row.recommended === 'Pin',
  maturity: row.stage && MATURITIES.includes(row.stage) ? row.stage : null,
  maturity_check: row.change === 'Check' ? true : null,
});
const problems = (row) => {
  const out = [];
  if (!['Pin', 'Not pin'].includes(row.recommended)) out.push(`Recommended is "${row.recommended}"`);
  if (row.stage && !MATURITIES.includes(row.stage)) out.push(`Stage "${row.stage}" is not one of the known stages`);
  return out;
};

function run(work, { write }) {
  const m = match(work.companies);
  const bad = m.found.filter((f) => problems(f.row).length);
  let changed = 0;
  const counts = { shown: 0, hidden: 0, check: 0, byMaturity: {} };
  for (const { row, company } of m.found) {
    if (problems(row).length) continue;
    const next = wanted(row);
    counts[next.show_on_map ? 'shown' : 'hidden'] += 1;
    if (next.maturity_check) counts.check += 1;
    counts.byMaturity[next.maturity ?? '(none given)'] = (counts.byMaturity[next.maturity ?? '(none given)'] ?? 0) + 1;
    const differs = ['show_on_map', 'maturity', 'maturity_check'].some((k) => (company[k] ?? null) !== next[k]);
    if (differs) { changed += 1; if (write) Object.assign(company, next); }
  }
  return { m, bad, changed, counts };
}

const ds = parseRaw(await loadRaw(dataDir));
if (step === 'plan') {
  const { m, bad, changed, counts } = run(structuredClone(ds), { write: false });
  console.log(JSON.stringify({ companies: ds.companies.length, sheetRows: list.rows.length, matchedExact: m.found.filter((f) => f.how === 'exact').length, matchedNormalised: m.found.filter((f) => f.how === 'normalised').length, unmatchedSheetRows: m.unmatched.length, ambiguous: m.ambiguous.length, companiesNotInList: m.notInList.length, companiesNamedTwice: m.twice.length, rowsWithAProblem: bad.length, companiesThatWouldChange: changed }, null, 1));
  console.log('unmatched sheet rows:', m.unmatched.map((r) => r.startup));
  console.log('ambiguous rows:', JSON.stringify(m.ambiguous));
  console.log('companies the list does not name:', m.notInList.map((c) => c.name));
  console.log('would show on the map:', counts.shown, ' would leave off the map:', counts.hidden, ' flagged to check:', counts.check);
  console.log('by maturity:', JSON.stringify(counts.byMaturity));
  console.log('(nothing was written)');
} else if (step === 'apply') {
  if (!by) throw new Error('--by "name" is required');
  let result;
  await transact(dataDir, (work, { at }) => {
    result = run(work, { write: true });
    if (result.m.unmatched.length || result.m.ambiguous.length || result.bad.length) throw new Error(`${result.m.unmatched.length} unmatched, ${result.m.ambiguous.length} ambiguous and ${result.bad.length} rows with a problem: nothing was written`);
    const { counts } = result;
    const audit = result.changed > 0 ? [{ actor: { name: by, role: 'cli' }, via: 'cli', action: 'enrichment.apply', target: { type: 'system', id: 'curated-map' },
      summary: `The owner's curated list: ${counts.shown} companies shown on the map, ${counts.hidden} left off it (they stay in the directory), a maturity set for ${Object.entries(counts.byMaturity).filter(([k]) => k !== '(none given)').reduce((a, [, n]) => a + n, 0)} companies, ${counts.check} flagged to check; ${result.changed} companies changed`, changes: [] }] : [];
    return { audit };
  });
  console.log(`${result.changed} companies changed: ${result.counts.shown} shown on the map, ${result.counts.hidden} left off it, ${result.counts.check} flagged to check`);
} else console.log('Steps: plan, apply. See the top of this file.');
