// Stages the Still Early city pack (the reference directory's Sydney, Melbourne and Perth lists, 2026-11-05) as RESEARCH, not as fact, and reconciles it with the
// directory. Nothing here makes a company public: a row is a lead until its own pages have been read (the places importer, scripts/places, does that and publishes).
//
//   plan      DRY RUN. Stages every row in memory, matches it with what the directory already has (website domain, then name and aliases, through the discovery engine's
//             resolver), and prints the counts. Writes nothing.
//   stage     writes the staging dataset (scripts/citypack/staging/<city>.json, one row per source row) and the reconciliation report. Deterministic and safe to run again:
//             a person's decisions (decisions.json) are read, never written, and a row's status is recomputed from the sources, so a rerun changes nothing that was not changed.
//   research  writes, for each city, the research file the places importer reads (the rows not already in the directory, as research leads): the pipeline then reads each
//             company's OWN website and publishes only what its own pages support.
//   types     gives the companies a person agreed with (type-decisions.json) the type the pack's category suggested. Nothing is changed when a record has a type.
//   report    before and after counts for the three cities.
//
// What a source row is, here: a candidate. `source_latitude`/`source_longitude`, `source_pin_flag` and `source_approximate` are the reference's own metadata and are kept
// under `source_coordinates` for audit; the canonical coordinates are null until an address is geocoded and approved (scripts/locations.js). A source category is not a
// verified type: "startups" can hold a listed company, "companies" a young one. The type here is a candidate until a person or a page says so.
//
//   node scripts/citypack/import.mjs plan
//   node scripts/citypack/import.mjs stage [--data dir] [--out dir]
//   node scripts/citypack/import.mjs research
//   node scripts/citypack/import.mjs report
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../discovery.js';
import { loadRaw, parseRaw } from '../../src/models/dataset.js';
import { transact } from '../../src/models/store.js';
import { buildIndex, identityOfLead, resolveLead } from '../../src/discovery/resolve.js';
import { canonicalDomain, nameKey } from '../../src/models/identity.js';
import { metroOf, placeOfAddress } from '../../src/geo/metro.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.join(HERE, '..', '..');
const INPUT = path.join(HERE, 'input');
const { positional: [step], flags } = parseArgs(process.argv.slice(2));
const STAGING = path.resolve(typeof flags.out === 'string' ? flags.out : path.join(HERE, 'staging')); // --out <dir> writes the staging elsewhere (a test, a trial)
const dir = path.resolve(typeof flags.data === 'string' ? flags.data : path.join(BACKEND, 'src', 'data'));
const readJson = (file, fallback = null) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback);
const CITIES = [['sydney', 'Sydney', 'NSW'], ['melbourne', 'Melbourne', 'VIC'], ['perth', 'Perth', 'WA']];
const TYPE_OF = { startups: 'startup', companies: 'company', vcs: 'investor', ecosystem: 'space' }; // the source's word -> the candidate type (not verified)
const CITY_CENTRES = { Sydney: [-33.8688, 151.2093], Melbourne: [-37.8136, 144.9631], Perth: [-31.9505, 115.8605] };

// A person's decisions about staged rows, kept beside this script and never written by it: { rows: { "<source_record_id>": { hold|exclude|same_as|organisation_type, note } } }.
const decisions = readJson(path.join(HERE, 'decisions.json'), { rows: {} }).rows;
const duplicateReview = new Map((readJson(path.join(HERE, 'duplicate-review.json'), { rows: [] }).rows ?? []).map((x) => [`${x.city}|${x.source_record_id}`, x]));

// How complete the address the source gives is: a street (a number, a street name and the state with a postcode), a suburb only, or the city only.
function completeness(row) {
  const text = row.street_address_candidate ?? '';
  const placed = placeOfAddress(text);
  if (/\d/.test(text) && placed?.postcode && /\b(?:street|st|road|rd|avenue|ave|drive|dr|terrace|tce|highway|hwy|lane|ln|parade|pde|place|pl|court|ct|boulevard|blvd|way|crescent|cres|close|circuit|cct|square|sq|esplanade|walk|loop|grove|mews)\b/i.test(text)) return 'street';
  if (row.source_suburb && row.source_suburb !== row.city && !/\bCBD\b/i.test(row.source_suburb) && !text) return 'suburb';
  return text ? 'partial' : 'city_only';
}

const nearCentre = (row) => {
  const c = CITY_CENTRES[row.city];
  return c && Number.isFinite(row.source_latitude) && Math.abs(row.source_latitude - c[0]) < 0.0015 && Math.abs(row.source_longitude - c[1]) < 0.0015;
};

function loadPack() {
  const out = {};
  for (const [id] of CITIES) {
    const doc = readJson(path.join(INPUT, `${id}-worldtechmap-candidates.json`), { records: [] });
    out[id] = { meta: doc, records: doc.records ?? [] };
  }
  return out;
}

// What the places importer concluded about the earlier research lists (Melbourne 342, Perth 210), by website domain and by name, so a row the earlier import already published,
// held or excluded is reconciled with that outcome and not judged again.
function earlierOutcomes() {
  const byDomain = new Map();
  const byName = new Map();
  for (const city of ['melbourne', 'perth']) {
    const proposals = readJson(path.join(BACKEND, 'scripts', city, 'proposals.json'), []);
    for (const p of proposals) {
      const entry = { city, key: p.key, kind: p.kind, reason: p.reason, group: p.group, relationship: p.relationship, published: p.published ?? null, existing: p.existing ?? null };
      const d = canonicalDomain(p.website)?.domain;
      if (d && !byDomain.has(d)) byDomain.set(d, entry);
      const k = nameKey(p.name);
      if (k && !byName.has(`${city}:${k}`)) byName.set(`${city}:${k}`, entry);
    }
  }
  return { byDomain, byName };
}

// The staged rows for every city, matched with the directory.
async function buildStaging() {
  const pack = loadPack();
  const ds = parseRaw(await loadRaw(dir));
  const index = buildIndex(ds);
  const earlier = earlierOutcomes();
  const stagedAt = pack.sydney.meta.retrieved_on ?? '2026-11-05';
  const rows = [];
  // the same organisation in several cities: one organisation key (its website domain), many location rows
  const byDomain = new Map();
  for (const [cityId] of CITIES) for (const r of pack[cityId].records) {
    const d = canonicalDomain(r.website_candidate)?.domain ?? null;
    if (d) (byDomain.get(d) ?? byDomain.set(d, []).get(d)).push(`${cityId}:${r.source_record_id}`);
  }
  for (const [cityId, cityName] of CITIES) {
    const seenInCity = new Map();
    for (const r of pack[cityId].records) {
      const domain = canonicalDomain(r.website_candidate)?.domain ?? null;
      const type = TYPE_OF[r.source_category] ?? 'unknown';
      const decision = decisions[r.source_record_id] ?? null;
      const resolved = resolveLead(identityOfLead({ name: r.name, aliases: [], website: r.website_candidate }), index);
      const top = resolved.matches?.[0] ?? null;
      let reconciliation;
      if (decision?.same_as) reconciliation = { status: 'matched_by_a_person', target: { kind: 'company', id: decision.same_as }, outcome: 'DECIDED', reasons: [decision.note ?? 'a person matched it'] };
      else if (resolved.outcome === 'EXACT_MATCH' && top && top.conflicts?.length === 0 && top.target.kind === 'company') reconciliation = { status: 'existing_company', target: { kind: 'company', id: top.target.id, name: top.target.name }, outcome: resolved.outcome, reasons: top.reasons };
      else if (resolved.outcome === 'EXACT_MATCH' && top && top.target.kind === 'candidate') reconciliation = { status: 'existing_candidate', target: { kind: 'candidate', id: top.target.id, name: top.target.name }, outcome: resolved.outcome, reasons: top.reasons };
      else if (resolved.outcome === 'EXACT_MATCH') reconciliation = { status: 'review_possible_subsidiary_or_conflict', target: top ? { kind: top.target.kind, id: top.target.id, name: top.target.name } : null, outcome: resolved.outcome, reasons: [...(top?.reasons ?? []), ...(top?.conflicts ?? []).map((c) => c.detail)] };
      else if (resolved.outcome === 'LIKELY_MATCH' || resolved.outcome === 'POSSIBLE_MATCH') reconciliation = { status: 'review_ambiguous_name', target: top ? { kind: top.target.kind, id: top.target.id, name: top.target.name } : null, outcome: resolved.outcome, reasons: top?.reasons ?? [] };
      else reconciliation = { status: 'new', target: null, outcome: resolved.outcome, reasons: [] };
      // a name that only looked alike, reviewed against both websites (duplicate-review.json): a genuine duplicate or a separate company, recorded; nothing is merged
      const reviewed = duplicateReview.get(`${cityName}|${r.source_record_id}`);
      if (reconciliation.status === 'review_ambiguous_name' && reviewed && reviewed.verdict !== 'unverified') reconciliation = { ...reconciliation, status: reviewed.verdict === 'genuine_duplicate' ? 'duplicate_confirmed' : 'distinct_confirmed', reasons: [...(reconciliation.reasons ?? []), `reviewed 2026-11-05: ${reviewed.evidence}`] };
      if (type === 'investor' && reconciliation.status === 'existing_company') reconciliation.status = 'review_investor_matches_a_company';
      const completenessOf = completeness(r);
      const key = `${cityId}:${domain ?? nameKey(r.name)}`;
      const duplicateOf = seenInCity.get(key) ?? null;
      seenInCity.set(key, duplicateOf ?? r.source_record_id);
      const found = (domain && earlier.byDomain.get(domain)) || earlier.byName.get(`${cityId}:${nameKey(r.name)}`) || null;
      const prior = found && found.city === cityId ? found : null; // the earlier list for this city only
      const notes = [];
      if (nearCentre(r)) notes.push('the source coordinates are the city centre: never used as a place');
      if (r.source_approximate) notes.push('the source marks its own point approximate');
      if (!r.source_pin_flag) notes.push('the source does not place it (city-only)');
      if (duplicateOf) notes.push(`the same organisation is listed twice in this city (see ${duplicateOf})`);
      if (decision?.hold) notes.push(`held by a person: ${decision.hold}`);
      rows.push({
        entity_id: `cp-${cityId}-${r.source_record_id}`,
        organisation_key: domain ? `domain:${domain}` : `name:${nameKey(r.name)}`,
        source_record_id: r.source_record_id,
        city: cityName,
        name: r.name,
        canonical_domain: domain,
        website_candidate: r.website_candidate ?? null,
        organisation_type: { candidate: decision?.organisation_type ?? type, basis: decision?.organisation_type ? 'person' : 'directory_category', source_category: r.source_category },
        other_cities: (byDomain.get(domain) ?? []).filter((x) => !x.startsWith(`${cityId}:`)).map((x) => x.split(':')[0]),
        location: {
          relationship: 'directory_listing',
          address_type: 'unknown',
          address_text: r.street_address_candidate ?? null,
          address_status: r.address_evidence_status ?? 'directory_address_unverified',
          completeness: completenessOf,
          suburb: r.source_suburb ?? null,
          postcode_text: r.source_postcode_text ?? null,
          greater_city_by_postcode: metroOf({ address: r.street_address_candidate ?? '', city: null }) ?? null,
          source_coordinates: { latitude: r.source_latitude ?? null, longitude: r.source_longitude ?? null, approximate: Boolean(r.source_approximate), pin_flag: Boolean(r.source_pin_flag), at_city_centre: nearCentre(r) },
          canonical: { latitude: null, longitude: null, ready_to_publish_exact_pin: false },
          evidence: { url: r.source_url ?? null, dataset_url: r.source_dataset_url ?? null, retrieved_on: r.retrieved_on ?? stagedAt },
        },
        reconciliation,
        duplicate_of: duplicateOf,
        earlier_research: prior,
        verification: { identity: 'unverified', website: 'unverified', operating: 'unverified', location: 'unverified', funding: 'not_collected', hiring: 'not_collected' },
        publication: { state: decision?.exclude ? 'excluded' : decision?.hold ? 'held' : 'staged', reasons: [decision?.exclude, decision?.hold].filter(Boolean) },
        review_notes: notes,
      });
    }
  }
  return { rows, ds, stagedAt };
}

const tally = (rows, fn) => rows.reduce((a, r) => { const k = fn(r); a[k] = (a[k] ?? 0) + 1; return a; }, {});

function summarise(rows, ds) {
  const out = { staged_rows: rows.length, by_city: {}, unique_organisations: new Set(rows.map((r) => r.organisation_key)).size };
  for (const [, cityName] of CITIES) {
    const mine = rows.filter((r) => r.city === cityName);
    out.by_city[cityName] = {
      rows: mine.length,
      by_source_category: tally(mine, (r) => r.organisation_type.source_category),
      unique_organisations: new Set(mine.map((r) => r.organisation_key)).size,
      reconciliation: tally(mine, (r) => r.reconciliation.status),
      address_completeness: tally(mine, (r) => r.location.completeness),
      source_marks_approximate: mine.filter((r) => r.location.source_coordinates.approximate).length,
      source_point_at_city_centre: mine.filter((r) => r.location.source_coordinates.at_city_centre).length,
      source_pin_flag_false: mine.filter((r) => !r.location.source_coordinates.pin_flag).length,
      listed_twice_in_city: mine.filter((r) => r.duplicate_of).length,
      also_in_another_city: mine.filter((r) => r.other_cities.length).length,
      earlier_research_overlap: mine.filter((r) => r.earlier_research).length,
    };
  }
  out.organisations_in_more_than_one_city = (() => {
    const m = new Map();
    for (const r of rows) (m.get(r.organisation_key) ?? m.set(r.organisation_key, new Set()).get(r.organisation_key)).add(r.city);
    return [...m.values()].filter((s) => s.size > 1).length;
  })();
  out.directory_now = {
    companies: ds.companies.length,
    by_city: Object.fromEntries(CITIES.map(([, name]) => [name, ds.companies.filter((c) => c.city === name || metroOf(c) === name).length])),
    exact_or_suburb_pins_by_city: Object.fromEntries(CITIES.map(([, name]) => [name, ds.companies.filter((c) => (c.city === name || metroOf(c) === name) && Number.isFinite(c.lat)).length])),
  };
  return out;
}

async function plan() {
  const { rows, ds } = await buildStaging();
  console.log(JSON.stringify(summarise(rows, ds), null, 1));
  console.log('\n(nothing was written)');
}

async function stage() {
  const { rows, ds, stagedAt } = await buildStaging();
  mkdirSync(STAGING, { recursive: true });
  for (const [cityId, cityName] of CITIES) {
    const mine = rows.filter((r) => r.city === cityName);
    writeFileSync(path.join(STAGING, `${cityId}.json`), `${JSON.stringify({ city: cityName, staged_from: `${cityId}-worldtechmap-candidates.json`, retrieved_on: stagedAt, publication_status: 'research_staging_only', rows: mine }, null, 1)}\n`);
  }
  const summary = summarise(rows, ds);
  writeFileSync(path.join(STAGING, 'reconciliation.json'), `${JSON.stringify(summary, null, 1)}\n`);
  console.log(`staged ${rows.length} rows (${summary.unique_organisations} unique organisations) into ${path.relative(BACKEND, STAGING)}/`);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(summary.by_city).map(([c, v]) => [c, v.reconciliation])), null, 1));
}

// The research files the places importer reads: for each city, the staged rows that are not already companies in the directory (and not investors: investors go through the
// investor directory's own checks), as research leads with no sector, no description and nothing claimed. The source's category is carried as the group.
const keptApart = (cityName) => new Set(readJson(path.join(HERE, 'triage.json'), { kept_apart: {} }).kept_apart?.[cityName] ?? []);

async function research() {
  const { rows, ds } = await buildStaging();
  const out = {};
  for (const [cityId, cityName] of CITIES) {
    // a row the places importer has already made a candidate of stays in its file (the file is the list of rows it judges): it is now matched to that candidate
    const packSource = `${cityId}-pack-2026-11-05`;
    const ours = new Set(ds.candidates.filter((c) => c.discoveries.some((d) => d.source_id === packSource)).map((c) => c.id));
    // the rows whose directory gives a street address first (the most likely to be placed by their own pages), then a suburb, a part of an address, and the city only
    const RANK = { street: 0, suburb: 1, partial: 2, city_only: 3 };
    const mine = rows.filter((r) => r.city === cityName && (r.reconciliation.status === 'new' || r.reconciliation.status === 'distinct_confirmed' || (r.reconciliation.status === 'existing_candidate' && ours.has(r.reconciliation.target?.id))) && r.organisation_type.candidate !== 'investor' && !r.duplicate_of && r.publication.state === 'staged' && r.canonical_domain)
      .sort((a, b) => (RANK[a.location.completeness] ?? 4) - (RANK[b.location.completeness] ?? 4));
    const companies = mine.map((r) => ({
      name: r.name,
      sector: null,
      website: r.website_candidate,
      // a global or listed company a person kept apart (triage.json) is in the file but is not read or added: the places importer treats this group as "established"
      group: keptApart(cityName).has(r.name) ? 'established_or_listed_tech' : `worldtechmap_${r.organisation_type.source_category}`,
      perth_relationship: 'directory_listing_not_location_proof',
      sources: [],
      note: null,
      aliases: [],
      source_record_id: r.source_record_id,
      organisation_type: r.organisation_type.candidate,
    }));
    out[cityId] = companies.length;
    const folder = path.join(BACKEND, 'scripts', `${cityId}-pack`, 'research');
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, `${cityId}-worldtechmap-2026-11-05.json`), `${JSON.stringify({ title: `${cityName}: reference directory rows not yet in Still Early (research leads)`, researched_on: '2026-11-05', geography: cityName, counts: { total: companies.length }, import_guidance: ['A directory listing is not a verified office: each row is read on its own website before it can be published.'], companies }, null, 1)}\n`);
  }
  console.log('research files written (rows not yet in the directory):', JSON.stringify(out));
}

// The type of the companies a person agreed with. Never overwrites a type that is already there; each change is in the audit trail with the reason.
async function types() {
  const by = typeof flags.by === 'string' ? flags.by : null;
  if (!by) throw new Error('--by "name" is required: every change is recorded with a name');
  const { companies } = readJson(path.join(HERE, 'type-decisions.json'), { companies: {} });
  const { changed } = await transact(dir, async (work, { at }) => {
    const audit = [];
    for (const [id, d] of Object.entries(companies)) {
      const c = work.companies.find((x) => x.id === id);
      if (!c || c.organisation_type) continue;
      c.organisation_type = d.type;
      c.updated_at = at;
      audit.push({ actor: { name: by, role: 'cli' }, via: 'cli', action: 'enrichment.apply', target: { type: 'company', id }, summary: `${c.name}: typed as ${d.type} (${d.why})`, changes: [{ field: 'organisation_type', from: null, to: d.type }] });
    }
    console.log('typed ' + audit.length + ' companies');
    return { audit };
  });
  console.log('wrote ' + (changed.join(', ') || 'nothing'));
}

// Before and after, by city and by type, with the staged rows kept apart from what is in the directory: a staged row is a lead, a directory listing is a company whose own pages were
// read, a pin is an address the geocoder confirmed, and an unlocated company is in the directory with no place on record. Unique organisations are counted apart from rows.
async function report() {
  const { rows, ds } = await buildStaging();
  const base = readJson(path.join(HERE, 'baseline.json'), null);
  const before = new Set(base?.ids ?? []);
  const out = { baseline: base ? { from: base.taken_from, companies: base.companies, by_city: base.by_city } : null, now: { companies: ds.companies.length, by_city: {} }, staged: summarise(rows, ds).by_city, new_since_baseline: {} };
  for (const [, cityName] of CITIES) {
    const mine = ds.companies.filter((c) => c.city === cityName || metroOf(c) === cityName);
    const type = (c) => c.organisation_type ?? 'startup';
    out.now.by_city[cityName] = {
      in_view: mine.length,
      by_type: { startup: mine.filter((c) => type(c) === 'startup').length, company: mine.filter((c) => type(c) === 'company').length, space: mine.filter((c) => type(c) === 'space').length },
      pins: mine.filter((c) => Number.isFinite(c.lat)).length,
      exact: mine.filter((c) => c.location_precision === 'EXACT').length,
      suburb: mine.filter((c) => c.location_precision === 'SUBURB').length,
      city_level: mine.filter((c) => c.location_precision === 'CITY').length,
      unlocated: mine.filter((c) => c.location_precision === 'UNKNOWN' || !c.location_precision).length,
    };
    out.new_since_baseline[cityName] = mine.filter((c) => !before.has(c.id)).length;
  }
  out.staged_leads_not_yet_in_the_directory = Object.fromEntries(CITIES.map(([, cityName]) => [cityName, rows.filter((r) => r.city === cityName && r.reconciliation.status === 'new' && r.organisation_type.candidate !== 'investor').length]));
  out.rows_for_a_person = Object.fromEntries(CITIES.map(([, cityName]) => [cityName, rows.filter((r) => r.city === cityName && r.reconciliation.status.startsWith('review')).length]));
  console.log(JSON.stringify(out, null, 1));
}

if (step === 'plan') await plan();
else if (step === 'stage') await stage();
else if (step === 'research') await research();
else if (step === 'types') await types();
else if (step === 'report') await report();
else console.log('steps: plan, stage, research, types, report (see the top of this file)');
