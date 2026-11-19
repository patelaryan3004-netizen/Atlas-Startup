// Records the addresses a person approved after reading what find-offices.mjs found (scripts/addresses/office-claims-*.json). Each claim names the company, the address as the page states it, the page,
// the sentence that states it, and what the page calls it:
//   "office"          the page presents it as where the company is (an office, a head office, a contact or footer address with its name): stored as ACTIVE address evidence from the company's own website,
//                     which is what lets `npm run locations -- geocode` and `promote` put a pin there, and only where the geocoder finds the building
//   "correspondence"  the page gives it only as where to write, a registered office or a postal address: kept as a location of its own (kind OTHER), never a pin
// Nothing is placed here. Run with `plan` first (writes nothing), then `apply --by "name"`.
//
//   node scripts/addresses/apply-offices.mjs plan  --claims scripts/addresses/office-claims-2026-11-17.json
//   node scripts/addresses/apply-offices.mjs apply --claims <file> --by "name"
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRaw, parseRaw } from '../../src/models/dataset.js';
import { transact } from '../../src/models/store.js';
import { promoteEvidence } from '../../src/discovery/publish.js';
import { parseAddress } from '../../src/models/location.js';
import { sameAddress } from '../../src/models/identity.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(HERE, '..', '..', 'src', 'data');
const [, , step = 'plan', ...rest] = process.argv;
const flag = (name) => { const i = rest.indexOf(name); return i < 0 ? null : (rest[i + 1] ?? true); };
const claims = JSON.parse(readFileSync(path.resolve(HERE, flag('--claims') ?? 'office-claims-2026-11-17.json'), 'utf8')).claims;
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };
const stateWords = { 'New South Wales': 'NSW', Victoria: 'VIC', Queensland: 'QLD', 'Western Australia': 'WA', 'South Australia': 'SA', Tasmania: 'TAS' };

function run(work, { write, at, by }) {
  const out = []; const audit = []; let stored = 0;
  for (const claim of claims) {
    const c = work.companies.find((x) => x.id === claim.id);
    if (!c) { out.push(`${claim.company}: NOT IN THE DATA (${claim.id})`); continue; }
    const parsed = parseAddress(claim.address);
    if (!parsed.streetLevel) { out.push(`${c.name}: "${claim.address}" does not read as a street address: skipped`); continue; }
    const own = hostOf(claim.url)?.endsWith(hostOf(c.website ?? '') ?? '#none#');
    if (claim.kind === 'office' && !own) { out.push(`${c.name}: the page ${claim.url} is not on the company's own site (${c.website}): skipped`); continue; }
    const note = `${claim.kind === 'office' ? 'Its own website states this as where the company is' : 'Its own website gives this only as where to write (a correspondence address)'}: "${claim.quote}" Read ${at.slice(0, 10)}.`;
    if (claim.kind === 'office') {
      if (write && !promoteEvidence(work, c.id, [{ field: 'address', value: claim.address, confidence: 'high', verified_at: at, note, source: { kind: 'company_website', url: claim.url, title: `${c.name}: ${claim.page ?? 'its website'}`, publisher: hostOf(claim.url), retrieved_at: at } }]).length) { out.push(`${c.name}: that evidence is already there`); continue; }
      if (!write && work.evidence.some((e) => e.company_id === c.id && e.field === 'address' && sameAddress(e.value, claim.address) && e.status === 'active')) { out.push(`${c.name}: that address is already evidence`); continue; }
      out.push(`${c.name}: office evidence "${claim.address}" [${hostOf(claim.url)}]`);
      audit.push({ actor: { name: by ?? 'plan', role: 'cli' }, via: 'cli', action: 'enrichment.apply', target: { type: 'company', id: c.id }, summary: `${c.name}: the address its own website states for its office was added as evidence (${claim.address})`, changes: [{ field: 'evidence.address', from: null, to: claim.address }] });
    } else {
      const locId = `${c.id}.addr.offices`;
      if (work.company_locations?.some((l) => l.company_id === c.id && l.kind === 'OTHER' && sameAddress(l.address ?? '', claim.address))) { out.push(`${c.name}: that correspondence address is already a location of its own`); continue; }
      if (write) {
        work.company_locations ??= [];
        work.company_locations.push({ id: work.company_locations.some((l) => l.id === locId) ? `${locId}.${work.company_locations.length}` : locId, company_id: c.id, kind: 'OTHER', label: 'Correspondence address on its own website (where to write); not confirmed as an office', address: claim.address, suburb: parsed.suburb ?? null, city: c.city ?? null, state: parsed.state ?? c.state ?? null, country: 'Australia', postcode: parsed.postcode ?? null, latitude: null, longitude: null, location_precision: 'CITY', location_source: 'company_website', location_source_url: claim.url, location_verified_at: at, location_confidence: 'low', created_at: at, updated_at: at });
      }
      out.push(`${c.name}: correspondence address "${claim.address}" kept as a location of its own (never a pin) [${hostOf(claim.url)}]`);
      audit.push({ actor: { name: by ?? 'plan', role: 'cli' }, via: 'cli', action: 'enrichment.apply', target: { type: 'company', id: c.id }, summary: `${c.name}: an address its website gives only as where to write was kept as a location of its own; it is not a pin`, changes: [{ field: 'company_locations', from: null, to: `Correspondence address: ${claim.address}` }] });
    }
    stored += 1;
  }
  return { out, audit, stored };
}

if (step === 'apply') {
  const by = flag('--by'); if (typeof by !== 'string') throw new Error('--by "name" is required');
  let result;
  await transact(dir, (work, { at }) => { result = run(work, { write: true, at, by }); return { audit: result.audit }; });
  console.log(result.out.join('\n')); console.log(`\n${result.stored} claims recorded`);
} else {
  const ds = parseRaw(await loadRaw(dir));
  const result = run(structuredClone(ds), { write: false, at: new Date().toISOString(), by: 'plan' });
  console.log(result.out.join('\n')); console.log(`\n${result.stored} claims would be recorded (nothing was written)`);
}
