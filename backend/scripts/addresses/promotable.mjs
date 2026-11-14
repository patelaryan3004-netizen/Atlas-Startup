// Which researched companies may be promoted to an exact pin right now: the research called the address an office or facility, a cited page states it (research-results.json),
// the location system's own promotion plan would place it, AND the address that plan would use is the researched one (so an older, different address on file never wins).
//   node scripts/addresses/promotable.mjs            prints the company ids to promote, one per line, and why the others are not
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRaw, parseRaw } from '../../src/models/dataset.js';
import { applyPromotions } from '../../src/geo/locate.js';
import { sameAddress } from '../../src/models/identity.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(HERE, '..', '..', 'src', 'data');
const R = JSON.parse(readFileSync(path.join(HERE, 'research-results.json'), 'utf8')).results;
const ds = parseRaw(await loadRaw(dir));
const plan = new Map(applyPromotions(structuredClone(ds), { at: new Date().toISOString() }).map((r) => [r.company_id, r]));
const yes = []; const no = [];
for (const r of R) {
  if (!r.company_id || r.category !== 'Office / facility supported' || r.verdict !== 'corroborated' || r.country !== 'Australia') continue;
  const p = plan.get(r.company_id);
  const c = ds.companies.find((x) => x.id === r.company_id);
  if (c.location_precision === 'EXACT') { no.push(`${r.company}: already an exact pin`); continue; }
  if (!p) { no.push(`${r.company}: not a promotion candidate (${c.location_precision}${c.address ? ', it carries an address of its own' : ''}${c.verified === true ? '' : ', not verified'})`); continue; }
  if (p.action !== 'promoted') { no.push(`${r.company}: ${p.reason ?? (p.action === 'unasked' ? 'the geocoder has not been asked' : p.action)}`); continue; }
  if (!sameAddress(p.address, r.address)) { no.push(`${r.company}: the plan would use "${p.address}", the research says "${r.address}": a person decides`); continue; }
  yes.push(r.company_id);
}
console.log(`PROMOTE ${yes.length}`);
for (const id of yes) console.log(id);
console.log(`NOT ${no.length}`);
for (const n of no) console.log(n);
