// One decision by the owner (15 Nov 2026): Matrak's current address is 3 Albert Coates Lane, Melbourne VIC 3000 (its contact page on matrak.com, the company's own site; the
// record's website field says matrak.com.au). The older address 10 St Andrews Place came from its terms document and is out of date. Recorded as: the old evidence row superseded,
// the contact page's source kept as the company's own website. Nothing is placed here: the location system's geocode and promote steps do that.
//   node scripts/addresses/matrak-update.mjs plan | apply --by "name"
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transact } from '../../src/models/store.js';
import { loadRaw, parseRaw } from '../../src/models/dataset.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'data');
const [, , step, , by] = process.argv;
const OLD = 'matrak.address.matrak-free-user-and-invited-user-terms';
const NEW = 'matrak.address.matrak-com-contact';
const SOURCE = 'matrak-com-contact';

function run(work, { write, at }) {
  const old = work.evidence.find((e) => e.id === OLD);
  const fresh = work.evidence.find((e) => e.id === NEW);
  const src = work.sources.find((s) => s.id === SOURCE);
  if (!old || !fresh || !src) throw new Error('Matrak\'s evidence or source row is missing: nothing to do');
  const changes = [];
  if (old.status !== 'superseded') { changes.push({ field: `evidence.${OLD}`, from: old.status, to: 'superseded' }); if (write) { old.status = 'superseded'; old.note = 'Replaced by the company\'s current contact page (3 Albert Coates Lane); confirmed by the owner 2026-11-15.'; } }
  if (src.kind !== 'company_website') { changes.push({ field: `source.${SOURCE}.kind`, from: src.kind, to: 'company_website' }); if (write) { src.kind = 'company_website'; src.note = 'The company\'s own contact page (matrak.com; the record\'s website field says matrak.com.au). Confirmed by the owner 2026-11-15.'; } }
  if (fresh.confidence !== 'high') { changes.push({ field: `evidence.${NEW}.confidence`, from: fresh.confidence, to: 'high' }); if (write) fresh.confidence = 'high'; }
  return { changes, audit: changes.length ? [{ actor: { name: by ?? 'plan', role: 'cli' }, via: 'cli', action: 'enrichment.apply', target: { type: 'company', id: 'matrak' }, summary: 'Matrak: its current address is 3 Albert Coates Lane (its own contact page); the older 10 St Andrews Place was superseded, as the owner confirmed', changes }] : [] };
}

if (step === 'apply') {
  if (!by) throw new Error('--by "name" is required');
  let out;
  await transact(dir, (work, { at }) => { out = run(work, { write: true, at }); return { audit: out.audit }; });
  console.log(JSON.stringify(out.changes, null, 1));
} else {
  const ds = parseRaw(await loadRaw(dir));
  console.log(JSON.stringify(run(structuredClone(ds), { write: false }).changes, null, 1));
  console.log('(nothing was written)');
}
