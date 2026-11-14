// Three companies, with the sources the owner named (15 Nov 2026). Each source was read first with the compliant fetcher (scripts/addresses/peek.mjs); what is recorded is only what the page says.
//
//   Affinda   its own recruitment page says the team works at "Dover House, Cremorne, Melbourne" (no street); Dover House's own website gives "6 Fitzgibbon Street, Cremorne". Both are
//             recorded as evidence, each as what its page states, and the building is put to the geocoder. The existing promotion criteria then decide (they need a source that states the
//             street and is the company's own: neither page does, so it is not promoted by them).
//   Bellroy   14 Mason Street, Collingwood is the registered owner's address on a Canadian trademark record (CIPO 1756364): kept as evidence from a public register and as a location of its
//             own, with the current office occupancy NOT confirmed. It is never a pin.
//   AmazingCo nothing is recorded: the Indeed listing cannot be read (robots.txt disallows /viewjob, and its company page answers 403), and no page of the company states Mollison Street.
//
//   node scripts/addresses/source-decisions-2026-11-15.mjs plan | apply --by "name"
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transact, snapshot } from '../../src/models/store.js';
import { loadRaw, parseRaw } from '../../src/models/dataset.js';
import { promoteEvidence } from '../../src/discovery/publish.js';
import { createGeocoder, geocodeCached, mergeCache, questionFor, cachedVerdict } from '../../src/geo/geocode.js';
import { promotionCandidates } from '../../src/geo/locate.js';
import { sameAddress } from '../../src/models/identity.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'data');
const [, , step, , by] = process.argv;

const AFFINDA_PAGE = 'https://affindagroup.applytojob.com/apply/E1eAsBdTPg/Affinda-Summer-Internship-Program-2027';
const DOVER_ADDRESS = '6 Fitzgibbon Street, Cremorne VIC 3121';
const CIPO = 'https://ised-isde.canada.ca/cipo/trademark-search/1756364';
const BELLROY_ADDRESS = '14 Mason Street, Collingwood VIC 3066';

function run(work, { write, at, rows }) {
  const out = []; const audit = [];
  const note = (company, text, changes) => { out.push(`${company}: ${text}`); if (changes?.length) audit.push({ actor: { name: by ?? 'plan', role: 'cli' }, via: 'cli', action: 'enrichment.apply', target: { type: 'company', id: company.toLowerCase() }, summary: `${company}: ${text}`, changes }); };

  // Affinda: its own recruitment page (names the building) + Dover House's website (gives the street)
  const aff = work.companies.find((c) => c.id === 'affinda');
  const hasPage = work.evidence.some((e) => e.company_id === 'affinda' && e.field === 'address' && /Dover House, Cremorne/.test(e.value) && !/Fitzgibbon/.test(e.value));
  if (!hasPage) {
    if (write) promoteEvidence(work, 'affinda', [{ field: 'address', value: 'Dover House, Cremorne VIC', confidence: 'medium', verified_at: at, note: 'Its own recruitment page gives the location as "Dover House, Cremorne, Melbourne": it names the building, not the street.', source: { kind: 'company_website', url: AFFINDA_PAGE, title: 'Affinda: recruitment page (Summer Internship Program 2027)', publisher: 'affindagroup.applytojob.com', retrieved_at: at } }]);
    note('Affinda', 'its own recruitment page, which names Dover House as where the team works, was recorded as evidence (the building, not the street)', [{ field: 'evidence.address', from: null, to: 'Dover House, Cremorne VIC' }]);
  } else out.push('Affinda: the recruitment-page evidence is already there');
  const dover = work.evidence.find((e) => e.company_id === 'affinda' && e.field === 'address' && sameAddress(e.value, DOVER_ADDRESS));
  out.push(`Affinda: Dover House's website (${dover ? 'already recorded' : 'NOT recorded'}) gives ${DOVER_ADDRESS}`);
  const verdict = cachedVerdict({ ...aff, address: DOVER_ADDRESS, state: 'VIC' }, [...(work.geocode_cache ?? []), ...(rows ?? [])]);
  out.push(`Affinda: building geocode of ${DOVER_ADDRESS}: ${verdict ? `${verdict.decision.action}${verdict.decision.reason ? ` (${verdict.decision.reason})` : ''}` : 'not asked yet'}`);
  const cand = promotionCandidates(work, { company: 'affinda' });
  out.push(`Affinda: existing promotion criteria: ${cand.length ? 'a candidate' : 'NOT met: no source that is the company\'s own states the street (its recruitment page names only the building, Dover House\'s website is not Affinda\'s)'}`);

  // Bellroy: the trademark owner's address, kept apart from any pin
  const bell = work.companies.find((c) => c.id === 'bellroy');
  if (!work.evidence.some((e) => e.company_id === 'bellroy' && e.field === 'address' && sameAddress(e.value, BELLROY_ADDRESS))) {
    if (write) promoteEvidence(work, 'bellroy', [{ field: 'address', value: BELLROY_ADDRESS, confidence: 'low', verified_at: at, note: 'The registered owner\'s address (Bellroy Pty Ltd) on a Canadian trademark record. It is not evidence of a working office: current occupancy is not confirmed.', source: { kind: 'open_dataset', url: CIPO, title: 'Canadian Trademarks Database: BELLROY (1756364)', publisher: 'Canadian Intellectual Property Office', retrieved_at: at } }]);
    note('Bellroy', `${BELLROY_ADDRESS} was recorded as the trademark owner's address (a public register); office occupancy is not confirmed`, [{ field: 'evidence.address', from: null, to: BELLROY_ADDRESS }]);
  } else out.push('Bellroy: the trademark evidence is already there');
  work.company_locations ??= [];
  if (!work.company_locations.some((l) => l.company_id === 'bellroy' && sameAddress(l.address ?? '', BELLROY_ADDRESS))) {
    if (write) work.company_locations.push({ id: 'bellroy.addr.research', company_id: 'bellroy', kind: 'OTHER', label: 'Trademark owner address (Canadian register); office occupancy not confirmed', address: BELLROY_ADDRESS, suburb: 'Collingwood', city: 'Melbourne', state: 'VIC', country: 'Australia', postcode: '3066', latitude: null, longitude: null, location_precision: 'CITY', location_source: 'ecosystem_source', location_source_url: CIPO, location_verified_at: at, location_confidence: 'low', created_at: at, updated_at: at });
    note('Bellroy', 'and kept as a location of its own (no coordinates, never a pin)', [{ field: 'company_locations', from: null, to: `Trademark owner address: ${BELLROY_ADDRESS}` }]);
  }
  out.push(`Bellroy: ${bell.location_precision}: it stays as it is`);
  out.push('AmazingCo: nothing recorded (the Indeed listing cannot be read; no page of the company states Mollison Street)');
  return { out, audit };
}

if (step === 'apply') {
  if (!by) throw new Error('--by "name" is required');
  const { ds } = await snapshot(dir);
  // the building geocode (one request, kept in the cache), outside the lock
  const rows = structuredClone(ds.geocode_cache ?? []);
  const q = questionFor({ ...ds.companies.find((c) => c.id === 'affinda'), address: DOVER_ADDRESS, state: 'VIC' });
  for (let attempt = 1; q && attempt <= 3; attempt += 1) { // (a network error is not an answer: try again, a little later)
    const { row } = await geocodeCached(createGeocoder({}), rows, q.query, Date.now());
    if (row.status !== 'error') break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  let result;
  await transact(dir, (work, { at }) => { work.geocode_cache = mergeCache(work.geocode_cache ?? [], rows); result = run(work, { write: true, at, rows: [] }); return { audit: result.audit }; });
  console.log(result.out.join('\n'));
} else {
  const ds = parseRaw(await loadRaw(dir));
  console.log(run(structuredClone(ds), { write: false, at: new Date().toISOString(), rows: [] }).out.join('\n'));
  console.log('(nothing was written)');
}
