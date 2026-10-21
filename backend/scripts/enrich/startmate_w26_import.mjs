// Adds the companies Startmate lists for its Winter 2026 accelerator cohort, through the same pipeline a discovered company goes through (docs/discovery.md),
// and gives each its cohort. Safe to run again: every step looks at what is already there and changes nothing that is.
//
//   plan     -> what each of the 16 resembles in the directory today, and what would be done (nothing is written)
//   run      -> each becomes a candidate (the engine resolves it against the companies and candidates there are, and judges it); no website is read here
//   enrich   -> what Startmate's pages and each company's OWN pages say (startmate_w26_startmate.json, startmate_w26_scan.json) goes in as evidence,
//               every row with the page it came from and the day that page was read
//   publish  -> a person (--by) approves each clean new company and it is published at the place its pages support (city level unless a page gives a
//               street address and the geocoder finds it); the company already in the directory is enriched, not added again; a company that is
//               not in Australia stays a candidate waiting for review, with the reason
//   all      -> run, enrich and publish in order
//
// The decisions (description wording, sector, who is a founder, where each is placed, what to flag) are in startmate_w26_judgements.json.
// Add --data <dir> to work on a copy of the data files. Every step that writes validates the whole dataset first and writes nothing if a check fails.
//
//   node backend/scripts/enrich/startmate_w26_import.mjs plan    [--data <dir>]
//   node backend/scripts/enrich/startmate_w26_import.mjs all     --by "name" [--data <dir>]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main as discovery, parseArgs } from '../discovery.js';
import { loadRaw, parseRaw } from '../../src/models/dataset.js';
import { transact } from '../../src/models/store.js';
import { createEngine } from '../../src/discovery/pipeline.js';
import { approveCandidate, reopenCandidate } from '../../src/discovery/review.js';
import { publishCandidate, applyEnrichment, promoteEvidence, addIdentifier, ensureSource } from '../../src/discovery/publish.js';
import { buildIndex, identityOfLead, resolveLead, describeMatch } from '../../src/discovery/resolve.js';
import { valuesEqual, makeEvidenceRow } from '../../src/models/evidence.js';
import { isValidABN, isValidACN } from '../../src/models/identity.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.join(HERE, '..', '..');
const read = (name) => JSON.parse(readFileSync(path.join(HERE, name), 'utf8'));
const J = read('startmate_w26_judgements.json');
const SM = read('startmate_w26_startmate.json');
const SCAN = read('startmate_w26_scan.json');
const SOURCE_ID = J.source_id;
const COHORT = J.cohort;
const { positional: [step], flags } = parseArgs(process.argv.slice(2));
const dir = path.resolve(typeof flags.data === 'string' ? flags.data : path.join(BACKEND, 'src', 'data'));
const by = typeof flags.by === 'string' ? flags.by : null;
const needBy = () => { if (!by) throw new Error('--by "name" is required: every decision is recorded with a name'); return by; };

const norm = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
const squash = (s) => String(s).replace(/\s+/g, ' ').trim();
const slugs = Object.keys(J.companies);
// The pages read on the company's own site, from the scan: its main result and the follow-up reads of another of its sites.
const EXTRA = { quarter: 'quarter-au', coco: 'coco-trust' };
const ownResults = (slug) => [SCAN.results.find((r) => r.id === slug), SCAN.extra_results.find((r) => r.id === EXTRA[slug])].filter((r) => r?.read);
const startmate = (slug) => SM.companies.find((c) => c.slug === slug);

// ---------- the sources ----------

const profileSource = (slug) => ({ kind: 'accelerator_profile', url: startmate(slug).profile_url, title: `${startmate(slug).article.name} | Startmate portfolio`, publisher: 'Startmate', retrieved_at: J.startmate_checked_at, note: 'Startmate\'s own page for the company, read on this day (robots.txt allows it).' });
const articleSource = () => ({ kind: 'accelerator_profile', url: SM.article_url, title: 'Meet our Winter ’26 accelerator cohort | Startmate', publisher: 'Startmate', retrieved_at: J.startmate_checked_at, note: 'Startmate\'s announcement of the cohort, read on this day (robots.txt allows it).' });
const ownSource = (slug, pageUrl) => {
  const main = ownResults(slug)[0];
  const home = ownResults(slug).find((r) => r.pages_read?.[0] === pageUrl);
  // The page's own title when it is a home page the scan read first; otherwise the company and the page's address, so a source always has a name.
  const where = new URL(pageUrl);
  const title = home?.title ?? `${J.companies[slug].name}: ${where.hostname.replace(/^www\./, '')}${where.pathname === '/' ? '' : where.pathname}`;
  return { kind: 'company_website', url: pageUrl, title, publisher: J.companies[slug].legal_names?.[0] ?? main.site_name ?? new URL(pageUrl).hostname.replace(/^www\./, ''), retrieved_at: J.own_site_checked_at, note: 'The company\'s own page, read by startmate_w26_scan.py (robots.txt obeyed).' };
};

// A sentence the company's own pages gave, found in the scan (so no page address or quote is typed by hand): { url } of the page it is on.
function findOwn(slug, quote) {
  const want = squash(quote);
  for (const r of ownResults(slug)) {
    for (const p of r.places ?? []) if (squash(p.quote).includes(want)) return { url: p.source_url, result: r };
    if (squash(r.description ?? '').includes(want)) return { url: r.pages_read[0], result: r };
  }
  throw new Error(`${slug}: "${quote}" is not in what the company's own pages said (startmate_w26_scan.json)`);
}

// ---------- the evidence ----------

// The rows that go in with the candidate. `late` rows (an address, a claim that a newer reading replaced) are added once the company exists.
function evidenceFor(slug) {
  const j = J.companies[slug];
  const sm = startmate(slug);
  const own = ownResults(slug)[0];
  const rows = [];
  const add = (field, value, confidence, note, source, verified = confidence === 'low' ? J.startmate_checked_at : source.retrieved_at) => rows.push({ field, value, confidence, verified_at: verified, note, source });
  const profile = profileSource(slug);
  const article = articleSource();

  for (const [source, what] of [[profile, 'profile'], [article, 'announcement']]) add('cohorts', COHORT, 'high', `Listed as a W26 Accelerator company on Startmate's ${what}.`, source);

  if (own?.read) add('website', j.website, 'high', `The company's own site, read ${J.own_site_checked_at.slice(0, 10)}${own.redirected ? ` (it redirects from ${own.website_asked})` : ''}.`, ownSource(slug, own.pages_read[0]));
  if (sm.profile.website && valuesEqual('website', sm.profile.website, j.website)) add('website', j.website, 'high', 'The website Startmate lists.', profile);
  if (own?.description) add('description', squash(own.description).slice(0, 400), 'medium', 'The page\'s own description.', ownSource(slug, own.pages_read[0]));
  if (sm.profile.tagline) add('description', squash(sm.profile.tagline), 'medium', `Startmate's tagline for the company (tags: ${sm.profile.tags.join(', ')}).`, profile);

  const inList = (list, names) => names.some((n) => list.some((x) => norm(x) === norm(n)));
  const articleNames = (sm.article.founders ?? '').split(/,\s*|\s+&\s+/).filter(Boolean);
  for (const f of j.founders ?? []) {
    const names = [f, ...(j.founder_variants?.[f] ?? [])];
    const written = (list) => list.find((x) => names.some((n) => norm(n) === norm(x)));
    const spelled = (list) => { const w = written(list); return w && norm(w) !== norm(f) ? ` (written "${w}")` : ''; };
    if (inList(sm.profile.founders, names)) add('founders', f, 'high', `Named as a founder on Startmate's profile${spelled(sm.profile.founders)}.`, profile);
    if (inList(articleNames, names)) add('founders', f, 'high', `Named as a founder in Startmate's announcement${spelled(articleNames)}.`, article);
    for (const n of names) {
      const page = own?.founders_on_own_pages?.[n]?.[0];
      if (page) { add('founders', f, 'high', `Named on the company's own page${norm(n) !== norm(f) ? ` (written "${n}")` : ''}.`, ownSource(slug, page)); break; }
    }
  }
  for (const r of j.founder_review ?? []) add('founders', r.name, 'low', `${r.why} (Not applied to the record.)`, r.from === 'article' ? article : profile);

  if (j.place) {
    const p = j.place;
    if (p.from === 'own') {
      const hit = findOwn(slug, p.quote);
      add('city', p.city, 'high', `The company's own page says where it is: "${squash(p.quote)}".`, ownSource(slug, hit.url));
    }
    if (norm(sm.article.location ?? '').includes(norm(p.city))) add('city', p.city, 'high', `Startmate lists the company in "${sm.article.location}".`, article);
  }
  if (j.foundedYear) add('founded_year', j.foundedYear.value, 'medium', `The company's own page says "${j.foundedYear.quote}".`, ownSource(slug, findOwn(slug, j.foundedYear.quote).url));
  return rows;
}

// Rows added after the company exists: its street address (kept as evidence until the geocoder puts the house on the map) and a claim a newer reading replaced.
function lateEvidence(slug) {
  const j = J.companies[slug];
  const sm = startmate(slug);
  const rows = [];
  if (j.address) rows.push({ field: 'address', value: j.address.text, confidence: 'high', verified_at: J.own_site_checked_at, note: 'The street address on the company\'s own page.', source: ownSource(slug, findOwn(slug, j.address.quote).url) });
  if (j.listed_website && sm.profile.website && !valuesEqual('website', sm.profile.website, j.website)) {
    rows.push({ field: 'website', value: sm.profile.website, confidence: 'high', verified_at: J.startmate_checked_at, status: 'superseded', note: `Startmate lists this address; it redirects to ${j.website} (read ${J.own_site_checked_at.slice(0, 10)}), which is the company's site now.`, source: profileSource(slug) });
  }
  return rows;
}

// ---------- the leads ----------

function leadFor(slug) {
  const j = J.companies[slug];
  const p = profileSource(slug);
  return {
    key: slug, name: j.name, aliases: [], website: j.website, url: p.url, title: `${j.name} | Startmate Winter 2026`, publisher: 'Startmate',
    observed_at: J.startmate_checked_at, retrieved_at: J.startmate_checked_at, city: j.place?.city ?? null, state: j.place?.state ?? null,
    founders: j.founders ?? [], evidence: [], text: '',
  };
}

const sourceDef = { id: SOURCE_ID, kind: 'accelerator_profile', region: null, license: { basis: 'company_website' }, licenseBasis: 'company_website', discover: async () => slugs.map(leadFor) };

const candidatesOfSource = (ds) => ds.candidates.filter((c) => c.discoveries.some((d) => d.source_id === SOURCE_ID));
const candidateOf = (ds, slug) => candidatesOfSource(ds).find((c) => c.discoveries[0].key === slug);
const trail = (action, target, summary, extra = {}) => ({ actor: { name: needBy(), role: 'cli' }, via: 'cli', action, target, summary, ...extra });

// ---------- the steps ----------

async function plan() {
  const ds = parseRaw(await loadRaw(dir));
  const index = buildIndex(ds);
  const problems = [];
  for (const slug of slugs) {
    const j = J.companies[slug];
    const r = resolveLead(identityOfLead(leadFor(slug)), index);
    const mine = candidateOf(ds, slug);
    const abn = j.abn && !isValidABN(j.abn) ? ` ABN ${j.abn} IS NOT VALID` : '';
    const acn = j.acn && !isValidACN(j.acn) ? ` ACN ${j.acn} IS NOT VALID` : '';
    if (abn || acn) problems.push(`${slug}:${abn}${acn}`);
    console.log(`${slug.padEnd(18)} plan:${j.plan.padEnd(7)} now:${r.outcome.padEnd(13)} ${r.matches.length ? `matches ${r.matches.map((m) => describeMatch(m)).join(' | ')}` : 'nothing like it'}${mine ? ` | candidate ${mine.id} is ${mine.status}` : ''}${abn}${acn}`);
  }
  for (const slug of slugs) evidenceFor(slug); // throws if a quote is not in what the company's pages said
  console.log(`\n${slugs.length} companies; every quote found in the scan${problems.length ? `; PROBLEMS: ${problems.join('; ')}` : ''}.`);
}

async function run() {
  const ds = parseRaw(await loadRaw(dir));
  if (slugs.every((s) => candidateOf(ds, s))) { console.log('run: all candidates exist already; nothing to do'); return; }
  const code = await discovery(['run', '--by', needBy(), '--source', SOURCE_ID, '--no-enrich', '--data', dir], { sources: [sourceDef] });
  if (code) process.exitCode = code;
}

async function enrich() {
  const { changed } = await transact(dir, async (work, { at }) => {
    const engine = createEngine({ work, fetcher: null, options: { enrich: false } });
    const audit = [];
    for (const slug of slugs) {
      const j = J.companies[slug];
      const cand = candidateOf(work, slug);
      if (!cand) { console.log(`${slug}: no candidate (run first)`); continue; }
      if (cand.evidence.some((e) => e.source?.url === profileSource(slug).url)) { console.log(`${slug}: evidence is there already`); continue; }
      if (cand.status === 'rejected') { reopenCandidate(work, cand.id, { by: needBy(), at }); console.log(`${slug}: the engine rejected it; reopened for review`); }
      const warnings = [...(j.plan === 'hold' ? [`HELD: ${j.hold_reason}`] : []), ...j.flags];
      const result = {
        evidence: evidenceFor(slug), external_ids: { abn: j.abn ?? null, acn: j.acn ?? null }, legalNames: j.legal_names ?? [], aliases: j.aliases ?? [],
        signals: { phones: 0 }, warnings, errors: [],
      };
      const out = await engine.enrichCandidateWith(cand.id, result);
      console.log(`${slug}: ${result.evidence.length} evidence rows added; now ${out.status}, ${out.resolution}`);
      audit.push(trail('candidate.enrich', { type: 'candidate', id: cand.id }, `Put what Startmate's pages and ${j.name}'s own pages say on ${j.name} as evidence (${result.evidence.length} rows)`, { reason: 'Startmate Winter 2026 cohort import: read 2026-10-21, see startmate_w26_startmate.json and startmate_w26_scan.json' }));
    }
    return { audit };
  });
  console.log(`wrote ${changed.join(', ') || 'nothing'}`);
}

// What a company that is in the directory gets from the import, beyond what publishing or enriching did: written only where the record is still empty.
function finish(work, company, slug, at, sourceIds) {
  const j = J.companies[slug];
  const changes = [];
  const set = (field, to) => { const from = company[field] ?? null; if (JSON.stringify(from) !== JSON.stringify(to)) { company[field] = to; changes.push({ field, from, to }); } };
  if (!(company.cohorts ?? []).includes(COHORT)) set('cohorts', [...(company.cohorts ?? []), COHORT]);
  if (j.plan === 'add') {
    // The address its own site answers at (the engine keeps the bare domain; some of these sites are only at www., or move to it).
    if (company.website !== j.website) set('website', j.website);
    if (!company.blurb) set('blurb', j.blurb);
    if (company.sector === 'Unknown') { set('sector', j.sector); set('sectorFull', j.sectorFull); }
  }
  const late = promoteEvidence(work, company.id, lateEvidence(slug).filter((e) => e.status == null));
  for (const e of lateEvidence(slug).filter((x) => x.status)) {
    const sourceId = ensureSource(work, e.source);
    if (work.evidence.some((x) => x.company_id === company.id && x.field === e.field && x.source_id === sourceId && valuesEqual(e.field, x.value, e.value))) continue;
    work.evidence.push(makeEvidenceRow({ company_id: company.id, field: e.field, value: e.value, source_id: sourceId, confidence: e.confidence, verified_at: e.verified_at, status: e.status, note: e.note }, new Set(work.evidence.map((x) => x.id))));
    late.push(e);
  }
  if (late.length) changes.push({ field: 'evidence', from: null, to: `${late.length} row(s): ${[...new Set(late.map((e) => e.field))].join(', ')}` });
  for (const domain of j.old_domains ?? []) {
    const r = addIdentifier(work, company, 'domain', domain, { sourceId: sourceIds.profile, note: `The domain Startmate lists for ${company.name}; its site has moved (${j.website}).` });
    if (r.added) changes.push({ field: 'identifiers', from: null, to: `domain: ${domain}` });
  }
  if (j.office) {
    const id = `${company.id}.office.${norm(j.office.city).replace(/ /g, '-')}`;
    work.company_locations ??= [];
    if (!work.company_locations.some((r) => r.id === id)) {
      work.company_locations.push({
        id, company_id: company.id, kind: 'OFFICE', label: j.office.label, address: null, suburb: null, city: j.office.city, state: null, country: j.office.country, postcode: null,
        latitude: null, longitude: null, location_precision: j.office.precision, location_source: 'credible_profile', location_source_url: SM.article_url,
        location_verified_at: J.startmate_checked_at, location_confidence: 'medium', created_at: at, updated_at: at,
      });
      changes.push({ field: 'company_locations', from: null, to: `${j.office.label} (an office, not drawn on the map)` });
    }
  }
  if (changes.length) company.updated_at = at;
  return changes;
}

async function publish() {
  const { changed } = await transact(dir, async (work, { at }) => {
    const audit = [];
    for (const slug of slugs) {
      const j = J.companies[slug];
      const cand = candidateOf(work, slug);
      if (!cand) { console.log(`${slug}: no candidate (run first)`); continue; }
      if (j.plan === 'hold') {
        if (cand.status === 'rejected') reopenCandidate(work, cand.id, { by: needBy(), at });
        console.log(`${slug}: held for review (${candidateOf(work, slug).status}): ${j.hold_reason.slice(0, 90)}...`);
        continue;
      }
      const summaryLine = [];
      let company = null;
      if (cand.status === 'needs_review' || cand.status === 'matched') {
        if (j.plan === 'add') {
          if (cand.resolution !== 'NEW_COMPANY') { console.log(`${slug}: NOT published: the engine thinks it resembles ${cand.matches.map((m) => m.name).join(', ')}`); continue; }
          if (cand.australian?.verdict === 'no' || cand.startup?.verdict === 'no') { console.log(`${slug}: NOT published: the engine judges it ${cand.australian?.verdict === 'no' ? 'not Australian' : 'not a startup'}`); continue; }
          const note = `Added from Startmate's Winter 2026 cohort (${SM.article_url}), checked 2026-10-21; see startmate_w26_judgements.json for what was decided and why.`;
          approveCandidate(work, cand.id, { by: needBy(), note, at });
          audit.push(trail('candidate.approve', { type: 'candidate', id: cand.id }, `Approved ${j.name}`, { reason: note }));
          const p = j.place;
          const own = p.from === 'own' ? findOwn(slug, p.quote) : null;
          const location = { city: p.city, state: p.state, precision: p.precision, source: own ? 'company_website' : 'credible_profile', sourceUrl: own ? own.url : SM.article_url, verifiedAt: own ? J.own_site_checked_at : J.startmate_checked_at };
          ({ company } = publishCandidate(work, cand.id, { by: needBy(), at, location }));
          audit.push(trail('candidate.publish', { type: 'candidate', id: cand.id }, `Published ${company.name} as ${company.id} (city-level: a group in ${p.city}, not a pin)`));
          summaryLine.push('published');
        } else {
          const target = work.companies.find((c) => c.id === cand.matches[0]?.id && cand.matches[0]?.kind === 'company');
          if (!target || target.id !== slug) { console.log(`${slug}: NOT merged: expected the existing company "${slug}", the engine found ${cand.matches.map((m) => m.name).join(', ') || 'nothing'}`); continue; }
          const { candidate, summary } = applyEnrichment(work, cand, { by: needBy(), at, companyId: target.id, confirmedByPerson: true });
          company = target;
          audit.push(trail('candidate.merge', { type: 'candidate', id: candidate.id }, `Merged ${candidate.id} into ${company.id}: ${summary.evidence} evidence, ${summary.identifiers.length} identifier(s)`));
          summaryLine.push(`merged into ${company.id}${summary.held.length ? ` (held: ${summary.held.join('; ')})` : ''}`);
        }
      } else if (cand.status === 'published' || cand.status === 'merged') {
        company = work.companies.find((c) => c.id === (cand.published_company_id ?? cand.decisions.same_as));
      } else { console.log(`${slug}: ${cand.status}: left as it is`); continue; }
      if (!company) continue;
      const profileId = ensureSource(work, profileSource(slug));
      const changes = finish(work, company, slug, at, { profile: profileId });
      if (changes.length) {
        audit.push(trail('enrichment.apply', { type: 'company', id: company.id }, `${company.name}: Startmate Winter 2026 import (${changes.map((c) => c.field).join(', ')})`, { changes, reason: 'Startmate Winter 2026 cohort import; the choices of sector and description wording are ours, see startmate_w26_judgements.json' }));
        summaryLine.push(`finished (${changes.map((c) => c.field).join(', ')})`);
      }
      console.log(`${slug}: ${summaryLine.join('; ') || 'already in place'}`);
    }
    return { audit };
  });
  console.log(`wrote ${changed.join(', ') || 'nothing'}`);
}

if (step === 'plan') await plan();
else if (step === 'run') await run();
else if (step === 'enrich') await enrich();
else if (step === 'publish') await publish();
else if (step === 'all') { await run(); await enrich(); await publish(); }
else console.log('steps: plan, run, enrich, publish, all (see the top of this file)');
