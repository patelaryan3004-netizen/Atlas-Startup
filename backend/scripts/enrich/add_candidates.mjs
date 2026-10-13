// Adds the companies in candidates_to_add.json to the directory, through the SAME pipeline a discovered company goes through (docs/discovery.md):
//   run      -> each becomes a candidate; the engine resolves it against the 216 (is it one we have?), judges it (Australian? a startup?) and reads its OWN
//               website (robots.txt obeyed) into evidence, each row with the page it came from
//   review   -> where each one stands (nothing is written)
//   publish  -> a person (--by) approves each clean new company and it is published: sector and stage stay "Unknown", the description is left to the
//               enrichment, the place unconfirmed
//   places   -> each is put at its city (or state), with the page that says so as the source: `locations set`
//   curate   -> keeps only each company's own names as aliases (the engine also reads competitors' and customers' names off a page)
//   apply    -> the open roles Pass 1 read from a company's own job board go in as hiring evidence (and Harvest B's site is the www. address)
//   tidy     -> a company placed only at its city carries no street address on the record (the address stays as evidence for `locations promote`)
// Add --data <dir> to work on a copy of the data files. Every step that writes validates the whole dataset first and writes nothing if a check fails.
//
//   node backend/scripts/enrich/add_candidates.mjs run     --data <dir> --by "name"
//   node backend/scripts/enrich/add_candidates.mjs curate  --data <dir> --by "name"
//   node backend/scripts/enrich/add_candidates.mjs review  --data <dir>
//   node backend/scripts/enrich/add_candidates.mjs publish --data <dir> --by "name" [--note "why"]
//   node backend/scripts/enrich/add_candidates.mjs places  --data <dir> --by "name"
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main as discovery, parseArgs } from '../discovery.js';
import { loadRaw, parseRaw } from '../../src/models/dataset.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.join(HERE, '..', '..');
const SOURCE_ID = 'owner-leads-2026-10-14';
const ALIASES = { index: ['Alloy Planning'] }; // index.inc now redirects to alloy.app/planning ("Alloy Planning"): its site calls itself that, so the name check needs both

const read = (name) => JSON.parse(readFileSync(path.join(HERE, name), 'utf8'));
const { positional: [step], flags } = parseArgs(process.argv.slice(2));
const dir = path.resolve(typeof flags.data === 'string' ? flags.data : path.join(BACKEND, 'src', 'data'));
const by = typeof flags.by === 'string' ? flags.by : null;
const needBy = () => { if (!by) throw new Error('--by "name" is required: every decision is recorded with a name'); return by; };
const scan = read('candidates_to_add.json');

function leadsFrom(candidates, now) {
  return candidates.map((c) => ({
    key: c.id, name: c.name, aliases: ALIASES[c.id] ?? [], website: c.website.value,
    url: c.website.value, title: 'Owner lead list', publisher: 'Owner lead list (names only)', observed_at: now, retrieved_at: now,
    evidence: [{ field: 'website', value: c.website.value, confidence: 'low', note: 'Supplied by the owner from a list of names; the engine reads the company\'s own website.' }],
    text: '', extraction: { method: 'owner_list', agreed: false },
  }));
}

async function candidatesOfSource() {
  const ds = parseRaw(await loadRaw(dir));
  return ds.candidates.filter((c) => c.discoveries.some((d) => d.source_id === SOURCE_ID));
}

if (step === 'run') {
  const now = new Date().toISOString();
  // the source states why it may be used: these leads are names from the owner, and everything else is read from the company's own pages
  const source = { id: SOURCE_ID, kind: 'user_supplied', region: null, license: { basis: 'company_website' }, licenseBasis: 'company_website', discover: async () => leadsFrom(scan.candidates, now) };
  process.exitCode = await discovery(['run', '--by', needBy(), '--source', SOURCE_ID, '--data', dir], { sources: [source] });
} else if (step === 'review') {
  const mine = await candidatesOfSource();
  for (const c of mine) {
    const notes = (c.notes ?? []).slice(-2).map((n) => n.text.slice(0, 110));
    console.log(`${c.id.padEnd(20)} ${c.status.padEnd(12)} ${String(c.resolution).padEnd(14)} AU:${(c.australian?.verdict ?? '-').padEnd(8)} startup:${(c.startup?.verdict ?? '-').padEnd(8)} conf:${String(c.confidence?.score ?? '-').padEnd(5)} evidence:${String(c.evidence.length).padEnd(3)} ${c.matches.length ? `matches: ${c.matches.map((m) => m.name).join(', ')}` : ''}${notes.length ? ` | ${notes.join(' | ')}` : ''}`);
  }
  const byStatus = {};
  for (const c of mine) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
  console.log(`\n${mine.length} candidates: ${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(', ')}`);
} else if (step === 'curate') {
  // What the engine reads off a company's pages can include names that are not the company's: a competitor's product on a comparison table, a customer's
  // or an insurer's legal name, a heading ("Data Processor X Pty Ltd"). Left in, each would become an alias that could later match some other company.
  // So the aliases are set to the company's own: its trading names and its own legal entities (the ones its own legal pages name).
  const OWN = {
    adora: ['Adora Software Pty Ltd'], 'alloy-robotics': ['Alloy Technologies Operations Pty Ltd'], apromore: ['Apromore Pty Ltd'], bellroy: ['Bellroy Pty Ltd'],
    'block-earner': ['Web3 Ventures Pty Ltd', 'Web3 Loans Pty Ltd'], dovetail: ['Dovetail Research Pty Ltd'], emesent: ['Emesent Pty Ltd'], 'hello-clever': ['Hello Clever Pty Ltd'],
    ignition: ['Practice Ignition Pty Ltd'], indebted: ['InDebted Holdings Pty Ltd', 'InDebted Australia Pty Ltd'], index: ['Alloy Planning', 'Index Technologies Pty Ltd'],
    instant: ['Instant Checkout Pty Ltd'], intelligencebank: ['IntelligenceBank Pty Ltd'], isaacus: ['Isaacus Pty Ltd'], lombard: ['Lombard Finance'], nutromics: ['Nutromics Pty Ltd', 'Nutromics Technology Pty Ltd'],
    qsic: ['Qsic Pty Ltd'], reejig: ['Reejig Pty Ltd'], 'relevance-ai': ['OnSearch Pty Ltd'], roller: ['Roller Networks Pty Ltd', 'ROLLER Software'], simpro: [],
    tribe: ['TRIBE Digital Pty Ltd', 'TRIBE Group'], upcover: ['upcover Pty Ltd'], vivi: ['Vivi International Pty Ltd'], wemoney: ['WeMoney Pty Ltd'],
  };
  // Instant's page gives an ABN and an ACN that do not belong together; its own terms name "Instant Checkout Pty Ltd (ACN 642 933 462)", which its ABN ends with.
  const NUMBERS = { instant: { acn: '642933462', why: 'the page also gives ACN 008651232, which is not the ACN its ABN ends with: it names another legal entity' } };
  const { editCandidate } = await import('../../src/discovery/review.js');
  const { transact } = await import('../../src/models/store.js');
  const { isValidACN } = await import('../../src/models/identity.js');
  const { changed } = await transact(dir, (work, { at }) => {
    const log = [];
    for (const c of work.candidates.filter((x) => x.discoveries.some((d) => d.source_id === SOURCE_ID) && x.status === 'needs_review')) {
      const key = c.discoveries[0].key;
      if (key in OWN) {
        const before = c.aliases.length;
        try { editCandidate(work, c.id, { aliases: OWN[key] }, { by: needBy(), at }); log.push(`${c.id}: aliases ${before} -> ${OWN[key].length}`); } catch (err) { if (!/nothing was changed/.test(err.message)) throw err; }
      }
      if (NUMBERS[key]) {
        const cur = work.candidates.find((x) => x.id === c.id);
        if (!isValidACN(NUMBERS[key].acn)) throw new Error(`${key}: ACN ${NUMBERS[key].acn} is not valid`);
        cur.external_ids = { ...cur.external_ids, acn: NUMBERS[key].acn };
        cur.notes = [...cur.notes, { at, by, text: `ACN set to ${NUMBERS[key].acn}: ${NUMBERS[key].why}.` }];
        log.push(`${c.id}: ACN ${NUMBERS[key].acn}`);
      }
    }
    console.log(log.join('\n'));
    return { audit: [{ actor: { name: by, role: 'cli' }, via: 'cli', action: 'candidate.edit', target: { type: 'candidate', id: SOURCE_ID }, summary: `Kept only each company's own names (and one corrected ACN) on ${log.length} candidate(s) added from the lead list` }] };
  });
  console.log(`wrote ${changed.join(', ') || 'nothing'}`);
} else if (step === 'publish') {
  const mine = await candidatesOfSource();
  const note = typeof flags.note === 'string' ? flags.note : 'Added at the owner\'s go-ahead (add them all) from the lead list of 2026-10-13; see candidates_to_add.json for its evidence and flags.';
  const left = [];
  for (const c of mine) {
    if (c.status !== 'needs_review' || c.resolution !== 'NEW_COMPANY') { left.push(`${c.id}: ${c.status}, ${c.resolution} (left as it is)`); continue; }
    await discovery(['approve', c.id, '--by', needBy(), '--note', note, '--data', dir]);
    await discovery(['publish', c.id, '--by', by, '--data', dir]);
  }
  if (left.length) console.log(`\nnot published:\n  ${left.join('\n  ')}`);
} else if (step === 'apply') {
  // The Pass 1 readings that found a job board (candidates_to_add.json) go in through the same code the enrichment worker and apply_enriched.js use:
  // evidence rows, the job board as a source, the open roles, hiring_status "hiring" with the time the page was read. (Pass 2, the postings' remote
  // policy, tech stack and dates, is NOT merged: that decision is still the owner's, as for the 24 companies already in.)
  const { analysisFor } = await import('./apply_enriched.js');
  const { applyCompanyEnrichment } = await import('../../src/enrichment/apply.js');
  const { transact } = await import('../../src/models/store.js');
  const RESOLVED = ['roles_found_board', 'roles_found_structured', 'board_empty'];
  const WWW = { 'harvest-b': 'https://www.harvestb.io' }; // https://harvestb.io (no www) does not answer; the site is at www.
  await transact(dir, (work, { at }) => {
    const audit = [];
    for (const c of scan.candidates.filter((x) => RESOLVED.includes(x.pass1.read.result))) {
      if (!work.companies.some((x) => x.id === c.id)) continue;
      const r = { id: c.id, name: c.name, website: c.website.value, fields: c.pass1.fields, pass1: c.pass1.read };
      const s = applyCompanyEnrichment(work, { companyId: c.id, analysis: analysisFor(r, scan.generated_at), at, mode: 'fill' });
      console.log(`${c.id}: ${c.pass1.read.result}, ${s.evidence_added} evidence added, jobs +${s.jobs.added}`);
      audit.push({ actor: { name: needBy(), role: 'cli' }, via: 'cli', action: 'enrichment.apply', target: { type: 'company', id: c.id }, changes: s.changes,
        summary: `Pass 1 reading of ${new URL(c.website.value).hostname} (${c.pass1.read.result}): ${s.evidence_added} evidence added, jobs +${s.jobs.added}` });
    }
    for (const [id, url] of Object.entries(WWW)) {
      const company = work.companies.find((x) => x.id === id);
      if (!company || company.website === url) continue;
      audit.push({ actor: { name: by, role: 'cli' }, via: 'cli', action: 'enrichment.apply', target: { type: 'company', id }, changes: [{ field: 'website', from: company.website, to: url }],
        reason: `${company.website} does not answer over https; the company's site is at ${url}`, summary: `${company.name}: website ${company.website} -> ${url}` });
      company.website = url;
      company.updated_at = at;
    }
    return { audit };
  });
} else if (step === 'tidy') {
  // A company known only to its city (or state, or not at all) carries no street address on its record: its own page's address stays as evidence, and
  // `locations promote` puts it on the record, with a pin, once the geocoder finds the house (docs/locations.md). An address on a record with no point
  // is what the location review calls "address on record but not plotted".
  const { transact } = await import('../../src/models/store.js');
  const ids = new Set(scan.candidates.map((c) => c.id));
  const { changed } = await transact(dir, (work, { at }) => {
    const audit = [];
    for (const c of work.companies.filter((x) => ids.has(x.id) && ['CITY', 'STATE', 'UNKNOWN'].includes(x.location_precision) && typeof x.address === 'string' && x.address.trim())) {
      audit.push({ actor: { name: needBy(), role: 'cli' }, via: 'cli', action: 'location.set', target: { type: 'company', id: c.id }, changes: [{ field: 'address', from: c.address, to: null }],
        reason: 'Its place is known to the city or state: the address its own page states is kept as evidence (not on the record) until the geocoder can put it on the map.',
        summary: `${c.name}: address moved from the record to its evidence` });
      delete c.address;
      c.updated_at = at;
    }
    console.log(`${audit.length} record(s) had a street address with no point`);
    return { audit };
  });
  console.log(`wrote ${changed.join(', ') || 'nothing'}`);
} else if (step === 'places') {
  const places = read('candidates_places.json');
  const only = typeof flags.only === 'string' ? new Set(flags.only.split(',')) : null;
  const ds = parseRaw(await loadRaw(dir));
  const mine = ds.candidates.filter((c) => c.discoveries.some((d) => d.source_id === SOURCE_ID) && c.status === 'published' && (!only || only.has(c.discoveries[0].key)));
  for (const cand of mine) {
    const key = cand.discoveries[0].key;
    const place = places[key];
    const entry = scan.candidates.find((x) => x.id === key);
    if (!place || !entry) { console.log(`${cand.published_company_id}: no confirmed place, left unconfirmed`); continue; }
    const basis = entry.australian.hq_basis;
    const own = basis?.source_kind === 'own_site';
    const args = ['scripts/locations.js', 'set', cand.published_company_id, ...(place.city ? ['--city', place.city] : []), ...(place.state ? ['--state', place.state] : []), ...(place.precision ? ['--precision', place.precision] : []),
      '--source', own ? 'company_website' : 'credible_profile', '--source-url', basis.source_url,
      '--reason', `${own ? 'Its own page' : 'A press page'} puts it in ${place.city ?? place.state} (${(basis.quote ?? basis.summary ?? '').replace(/\s+/g, ' ').slice(0, 120)}); added at the owner's go-ahead`,
      '--by', needBy(), '--data', dir];
    try { console.log(execFileSync('node', args, { cwd: BACKEND, encoding: 'utf8' }).trim().split('\n').slice(-2).join(' | ')); }
    catch (err) { console.log(`${cand.published_company_id}: NOT set: ${(err.stderr || err.message).toString().trim().split('\n').slice(-1)[0]}`); }
  }
} else {
  console.log('steps: run, review, publish, places (see the top of this file)');
}
