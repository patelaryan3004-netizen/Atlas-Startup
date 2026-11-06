// Applies reviewed descriptions and sectors. The auto-generated ones are the company's own tagline, cut at a length, and a keyword reading of the sector; both are provisional.
// A reviewed one is reworded from what the tagline says (promotional claims such as "leading" or "award-winning" dropped, first person turned to third, a cut-off sentence
// completed only with what the tagline already said) and a sector is changed only where the tagline makes the keyword reading wrong. No new fact is added.
//
//   node scripts/citypack/descriptions.mjs plan
//   node scripts/citypack/descriptions.mjs apply --by "name"
//
// Reads every scripts/citypack/descriptions/*.json: { "<company id>": { "blurb": "...", "sector": "..." } }. A company whose blurb was written by a person
// (not by this pipeline) is left alone: only a blurb that is still the pipeline's own is replaced.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../discovery.js';
import { loadRaw, parseRaw } from '../../src/models/dataset.js';
import { transact } from '../../src/models/store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(HERE, '..', '..', 'src', 'data');
const { positional: [step], flags } = parseArgs(process.argv.slice(2));
const folder = path.join(HERE, 'descriptions');
const wanted = {};
for (const f of readdirSync(folder).filter((x) => x.endsWith('.json')).sort()) Object.assign(wanted, JSON.parse(readFileSync(path.join(folder, f), 'utf8')));
const baseline = new Set(JSON.parse(readFileSync(path.join(HERE, 'baseline.json'), 'utf8')).ids);

const run = (work, { write, by, at }) => {
  const done = []; const skipped = [];
  const audit = [];
  for (const [id, d] of Object.entries(wanted)) {
    const c = work.companies.find((x) => x.id === id);
    if (!c) { skipped.push(`${id}: not in the directory`); continue; }
    if (baseline.has(id)) { skipped.push(`${c.name}: was in the directory before the city pack (its description is not the pipeline's)`); continue; }
    const changes = [];
    if (d.blurb && c.blurb !== d.blurb) { changes.push({ field: 'blurb', from: c.blurb ?? null, to: d.blurb }); if (write) c.blurb = d.blurb; }
    if (d.sector && c.sector !== d.sector) { changes.push({ field: 'sector', from: c.sector ?? null, to: d.sector }); if (write) { c.sector = d.sector; if ('sectorFull' in c) c.sectorFull = d.sector; } }
    if (!changes.length) continue;
    done.push(`${c.name}: ${changes.map((x) => x.field).join(', ')}`);
    if (write) { c.updated_at = at; audit.push({ actor: { name: by, role: 'cli' }, via: 'cli', action: 'enrichment.apply', target: { type: 'company', id }, summary: `${c.name}: description reviewed and reworded from the company's own tagline${changes.some((x) => x.field === 'sector') ? '; sector corrected' : ''}`, changes }); }
  }
  return { done, skipped, audit };
};

if (step === 'apply') {
  const by = typeof flags.by === 'string' ? flags.by : null;
  if (!by) throw new Error('--by "name" is required: every change is recorded with a name');
  let out;
  const { changed } = await transact(dir, async (work, { at }) => { out = run(work, { write: true, by, at }); return { audit: out.audit }; });
  console.log(JSON.stringify({ reworded: out.done.length, skipped: out.skipped.length, wrote: changed }));
  if (out.skipped.length) console.log(out.skipped.join('\n'));
} else {
  const ds = parseRaw(await loadRaw(dir));
  const out = run(structuredClone(ds), { write: false });
  console.log(JSON.stringify({ would_reword: out.done.length, skipped: out.skipped.length }));
  if (out.skipped.length) console.log(out.skipped.join('\n'));
  console.log('(nothing was written)');
}
