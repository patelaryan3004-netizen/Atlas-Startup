// Adds the companies the portfolio scans (scan.mjs) name, through the discovery engine, so a company we already have is never added twice and nothing is
// public until a person has approved it. Safe to run again: every step looks at what is already there and changes nothing that is.
//
//   plan     what each scan names and what it resembles in the directory today: already ours (exact), a possible duplicate, or new. Writes nothing.
//   run      each lead that is not already ours becomes a candidate. The engine resolves it by website domain and name, reads the company's OWN website (robots.txt
//            obeyed, at most three pages) and judges whether it is Australian and a startup. Writes candidates.json only: no company changes.
//   reread   the candidates whose own website could not be read when they were made (the network failed, a page was slow) are read again, one at a time.
//            A site that refuses (robots.txt, a login, a 403) is not worked around: it stays as it is, with that reason.
//   propose  for the candidates that are clean, new, Australian and a startup: a sector and a one-line description proposed from what their own pages say,
//            written to proposals.json for a person to read and correct into judgments.json
//   publish  a person (--by) approves what judgments.json accepts and the company is published at the place its own pages support (city level unless an address
//            was confirmed), with the portfolio page that named it as evidence. Anything the rules do not clear stays a candidate, with the reason.
//   report   the counts: collected, already ours, duplicates inside the scans, added, held, and why
//
// Add --data <dir> to work on a copy of the data files. Every step that writes validates the whole dataset first and writes nothing if a check fails.
//
//   node scripts/portfolio/import.mjs plan    [--data <dir>] [--source id]
//   node scripts/portfolio/import.mjs run     --by "name" [--data <dir>] [--source id] [--limit n]
//   node scripts/portfolio/import.mjs reread  --by "name" [--data <dir>] [--limit n]
//   node scripts/portfolio/import.mjs propose [--data <dir>]
//   node scripts/portfolio/import.mjs publish --by "name" [--data <dir>]
//   node scripts/portfolio/import.mjs report  [--data <dir>]
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main as discovery, parseArgs } from '../discovery.js';
import { loadRaw, parseRaw } from '../../src/models/dataset.js';
import { transact } from '../../src/models/store.js';
import { approveCandidate } from '../../src/discovery/review.js';
import { createEngine } from '../../src/discovery/pipeline.js';
import { createFetcher, DEFAULT_USER_AGENT } from '../../src/discovery/http.js';
import { publishCandidate, promoteEvidence, ensureSource } from '../../src/discovery/publish.js';
import { buildIndex, identityOfLead, resolveLead, describeMatch } from '../../src/discovery/resolve.js';
import { canonicalDomain, nameKey } from '../../src/models/identity.js';
import { usableWebsite } from './sources.mjs';
import { placeOfAddress } from './places.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.join(HERE, '..', '..');
const SCANS = path.join(HERE, 'scans');
const { positional: [step], flags } = parseArgs(process.argv.slice(2));
const dir = path.resolve(typeof flags.data === 'string' ? flags.data : path.join(BACKEND, 'src', 'data'));
const by = typeof flags.by === 'string' ? flags.by : null;
const only = typeof flags.source === 'string' ? flags.source.split(',') : null;
const limit = Number(flags.limit) || Infinity;
const needBy = () => { if (!by) throw new Error('--by "name" is required: every decision is recorded with a name'); return by; };

const SOURCE_KIND = { vc_portfolio: 'investor_website', accelerator_portfolio: 'accelerator_profile' };
const loadScans = () => readdirSync(SCANS).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(path.join(SCANS, f), 'utf8'))).filter((s) => !only || only.includes(s.source_id));
const JUDGMENTS = path.join(HERE, 'judgments.json');
const judgments = () => (existsSync(JUDGMENTS) ? JSON.parse(readFileSync(JUDGMENTS, 'utf8')) : { companies: {} });
const domainOf = (website) => canonicalDomain(website)?.domain ?? null;

// ---------- the leads ----------

// One entry per company across all the scans (the same company in two portfolios is one lead with two sources), keyed by website domain, else by name.
function mergedLeads(scans) {
  const byKey = new Map();
  let collected = 0;
  let withoutWebsite = 0;
  for (const scan of scans) {
    for (const lead of scan.leads) {
      collected += 1;
      if (lead.website && !usableWebsite(lead.website)) lead.website = null; // a map link or a social page is not the company's site
      const domain = domainOf(lead.website);
      if (!domain) { withoutWebsite += 1; }
      const key = domain ?? `name:${nameKey(lead.name)}`;
      const entry = byKey.get(key) ?? { key, domain, name: lead.name, website: lead.website ?? null, sources: [] };
      entry.sources.push({ scan, lead });
      if (!entry.website && lead.website) { entry.website = lead.website; entry.domain = domain; }
      byKey.set(key, entry);
    }
  }
  return { leads: [...byKey.values()], collected, withoutWebsite };
}

const leadFor = (entry, { scan, lead }) => ({
  key: lead.key, name: entry.name, website: entry.website, url: lead.profile_url ?? scan.list_url, title: `${lead.name} | ${scan.publisher} portfolio`, publisher: scan.publisher,
  observed_at: scan.retrieved_at, retrieved_at: scan.retrieved_at, city: null, state: null, founders: [], evidence: [], text: lead.description ?? '',
});

function classify(ds, merged) {
  const index = buildIndex(ds);
  return merged.leads.map((entry) => {
    const r = resolveLead(identityOfLead({ name: entry.name, website: entry.website }), index);
    return { entry, outcome: r.outcome, matches: r.matches };
  });
}

// ---------- plan ----------

async function plan() {
  const ds = parseRaw(await loadRaw(dir));
  const scans = loadScans();
  const merged = mergedLeads(scans);
  const rows = classify(ds, merged);
  const count = (o) => rows.filter((r) => r.outcome === o).length;
  for (const scan of scans) console.log(`${scan.source_id.padEnd(24)} ${String(scan.leads.length).padStart(4)} named, ${String(scan.leads.filter((l) => l.website).length).padStart(4)} with a website  (read ${scan.retrieved_at.slice(0, 10)})`);
  console.log(`\ncollected ${merged.collected} names across ${scans.length} scans; ${merged.collected - merged.leads.length} are the same company named by more than one page; ${merged.leads.length} unique`);
  console.log(`already in the directory (exact): ${count('EXACT_MATCH')} | a likely or possible duplicate, left for a person: ${count('LIKELY_MATCH') + count('POSSIBLE_MATCH')} | new: ${count('NEW_COMPANY')} (${merged.withoutWebsite} names have no website on their page and cannot be read)`);
  for (const r of rows.filter((x) => x.outcome === 'LIKELY_MATCH' || x.outcome === 'POSSIBLE_MATCH')) console.log(`  ${r.outcome.padEnd(14)} ${r.entry.name} (${r.entry.domain}) ~ ${r.matches.map((m) => describeMatch(m)).join(' | ').slice(0, 160)}`);
}

// ---------- run ----------

async function run() {
  const ds = parseRaw(await loadRaw(dir));
  const scans = loadScans();
  const merged = mergedLeads(scans);
  const rows = classify(ds, merged);
  // Not already ours, and with a website to read. A company a second portfolio names is attached to the candidate the first one made (the engine matches the domain).
  const todo = new Set(rows.filter((r) => r.outcome !== 'EXACT_MATCH' && r.entry.website).map((r) => r.entry.key));
  let budget = limit;
  for (const scan of scans) {
    const leads = [];
    for (const entry of merged.leads) {
      if (!todo.has(entry.key) || budget <= 0) continue;
      const mine = entry.sources.find((s) => s.scan === scan);
      if (!mine) continue;
      leads.push(leadFor(entry, mine));
      budget -= 1;
    }
    if (!leads.length) { console.log(`${scan.source_id}: nothing new to read`); continue; }
    const sourceDef = { id: scan.source_id, kind: SOURCE_KIND[scan.kind], region: 'AU', license: { basis: 'permitted_page' }, licenseBasis: 'permitted_page', discover: async () => leads };
    console.log(`${scan.source_id}: ${leads.length} companies' own sites to read...`);
    const code = await discovery(['run', '--by', needBy(), '--source', scan.source_id, '--data', dir], { sources: [sourceDef] });
    if (code) process.exitCode = code;
  }
}

// ---------- where a company is ----------

// Where a candidate is: the city its address puts it in, else the city its own pages named, with the state.
// (a company's own pages: its site, and its privacy and terms pages, which the engine records as its own documents)
const OWN_PAGES = ['company_website', 'company_document'];
const placeOf = (c) => {
  const address = c.address ?? c.evidence.find((e) => e.field === 'address' && OWN_PAGES.includes(e.source?.kind))?.value;
  const fromAddress = placeOfAddress(address);
  const city = fromAddress?.city ?? c.city ?? null;
  const state = fromAddress?.state ?? c.state ?? null;
  return city && state ? { city, state, address: address ?? null } : null;
};

// ---------- reread ----------

// A candidate that is still waiting, is new to the directory, has a website and has nothing read from it: its site is read again with the engine's own reader (the same
// robots.txt and pacing rules; a site that refuses is not worked around), which also checks identity again and rescores. Done in batches of twenty, each one a single
// checked write, so a stopped run keeps what it had read.
async function reread() {
  const ds = parseRaw(await loadRaw(dir));
  const ids = candidatesFromPortfolios(ds)
    .filter((c) => c.status === 'needs_review' && c.resolution === 'NEW_COMPANY' && c.website && !c.evidence.some((e) => e.source?.kind === 'company_website'))
    .slice(0, limit).map((c) => c.id);
  console.log(`${ids.length} candidates have no page of their own site read yet`);
  const BATCH = 20;
  for (let i = 0; i < ids.length; i += BATCH) {
    const fetcher = createFetcher({ userAgent: process.env.DISCOVERY_USER_AGENT || DEFAULT_USER_AGENT });
    await transact(dir, async (work) => {
      const engine = createEngine({ work, fetcher, options: { enrich: true } });
      const audit = [];
      for (const id of ids.slice(i, i + BATCH)) {
        const c = work.candidates.find((x) => x.id === id);
        if (!c || c.status !== 'needs_review') continue;
        try {
          const out = await engine.enrichCandidate(id, { website: c.website, by: needBy() });
          console.log(`  ${(out.name ?? id).padEnd(28)} ${out.status.padEnd(13)} Australian: ${out.australian?.verdict ?? '-'}`);
          audit.push(trail('candidate.enrich', { type: 'candidate', id }, `Read ${out.name}'s own website again (${c.website})`, { reason: 'Portfolio import: the first read failed (network)' }));
        } catch (e) { console.log(`  ${id}: ${e.message}`); }
      }
      return { audit };
    });
    console.log(`  ...${Math.min(i + BATCH, ids.length)} of ${ids.length} done`);
  }
}

// ---------- the rules for what may be published ----------

const candidatesFromPortfolios = (ds) => ds.candidates.filter((c) => c.discoveries.some((d) => scanIds.has(d.source_id)));
const scanIds = new Set(readdirSync(SCANS).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')));

// What stops a candidate being published, or null when it may be. A person reads this list; it is not hidden.
function problemWith(c, j) {
  if (c.status === 'published' || c.status === 'merged') return null;
  if (c.status === 'rejected') return `rejected by the engine: ${c.notes?.at(-1)?.text ?? ''}`.slice(0, 160);
  if (c.resolution !== 'NEW_COMPANY') return `might be ${c.matches[0]?.name ?? 'a company we have'} (${c.resolution})`;
  if (c.startup?.verdict === 'no') return 'not a startup, from its own pages';
  const au = c.australian?.verdict;
  const hasPlace = Boolean(placeOf(c));
  if (au === 'no') return 'not Australian, from its own pages';
  // Australian: the engine says yes, or likely with a place its own pages give, or likely on a signal that is itself a registration: an .au domain (auDA only licenses
  // one to a person or company with an Australian connection), an ABN/ACN printed on its pages, or an Australian street address.
  const registered = (c.australian?.signals ?? []).some((s) => ['au_domain', 'registry_number', 'au_address'].includes(s.code));
  if (!(au === 'yes' || (au === 'likely' && (hasPlace || registered)))) return 'its own pages do not show it is Australian';
  if (!c.evidence.some((e) => e.source?.kind === 'company_website')) return 'its own website could not be read';
  if (!j) return 'no sector and description decided yet (judgments.json)';
  if (j.hold) return `held: ${j.hold}`;
  return null;
}

// ---------- propose ----------

const SECTOR_RULES = [
  ['Cybersecurity', /cyber|security|zero.?trust|threat|fraud|identity verification/i],
  ['Fintech', /fintech|payments?|banking|lending|loan|insurance|invest(?:ing|ment)|wealth|mortgage|credit|accounting|invoice|tax|crypto|treasury|financ/i],
  ['HealthTech', /health|clinic|patient|medical|medicine|doctor|care\b|therap|diagnos|pharma|biotech|disease|hospital|nurs|mental/i],
  ['Climate', /climate|carbon|emission|renewable|solar|energy|battery|hydrogen|sustainab|net.?zero|recycl|waste|decarbon|electric/i],
  ['AgTech', /agri|farm|crop|livestock|soil|food|aquaculture|grain|horticult/i],
  ['Space', /space|satellite|orbit|launch vehicle|rocket/i],
  ['Robotics', /robot|autonomous|drone|uav|unmanned/i],
  ['EdTech', /education|learning|student|school|teach|course|training|skills/i],
  ['PropTech', /property|real estate|housing|construction|building|tenant|landlord|rental/i],
  ['HR Tech', /recruit|hiring|talent|payroll|employee|workforce|hr\b|people ops|candidate/i],
  ['Legal tech', /legal|law\b|lawyer|contract|compliance|regulat/i],
  ['Logistics', /logistic|freight|shipping|supply chain|delivery|fleet|transport/i],
  ['Martech', /marketing|advertis|brand|campaign|seo\b|social media|customer engagement/i],
  ['Marketplace', /marketplace|e-?commerce|retail|shopping|consumer brand|buy and sell/i],
  ['DevTools', /developer|devops|software engineer|code\b|api\b|open.?source|infrastructure as code|observability/i],
  ['Hardware', /hardware|sensor|semiconductor|chip|device|materials|manufactur/i],
  ['AI', /\bai\b|artificial intelligence|machine learning|llm|generative|agentic|neural|computer vision|nlp/i],
  ['SaaS', /software|platform|saas|cloud|automation|workflow|analytics|data/i],
];
const sectorOf = (text) => SECTOR_RULES.find(([, re]) => re.test(text))?.[0] ?? 'Unknown';

function oneLine(text, name) {
  let t = String(text ?? '').replace(/\s+/g, ' ').trim();
  t = t.replace(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(is|:|-|–|—)\\s*`, 'i'), '');
  const first = t.split(/(?<=[.!?])\s+/)[0] ?? t;
  let line = first.length > 150 ? `${first.slice(0, 147).replace(/\s+\S*$/, '')}...` : first;
  line = line.replace(/\.$/, '');
  return line.charAt(0).toUpperCase() + line.slice(1);
}

async function propose() {
  const ds = parseRaw(await loadRaw(dir));
  const j = judgments();
  const out = {};
  for (const c of candidatesFromPortfolios(ds)) {
    const problem = problemWith(c, { ok: true });
    const key = c.domain ?? nameKey(c.name);
    const desc = c.evidence.find((e) => e.field === 'description' && e.source?.kind === 'company_website')?.value ?? c.description ?? c.discoveries.map((d) => d.title).join(' ');
    out[key] = {
      name: c.name, website: c.website, status: c.status, resolution: c.resolution, australian: c.australian?.verdict, startup: c.startup?.verdict,
      city: c.city ?? null, state: c.state ?? null, problem, decided: Boolean(j.companies[key]),
      sector: sectorOf(`${desc} ${c.name}`), blurb: oneLine(desc, c.name), from: (c.evidence.find((e) => e.field === 'description' && e.source?.kind === 'company_website') ? 'its own site' : 'the portfolio page'),
    };
  }
  writeFileSync(path.join(HERE, 'proposals.json'), `${JSON.stringify(out, null, 1)}\n`);
  const clean = Object.values(out).filter((p) => !p.problem);
  console.log(`${Object.keys(out).length} candidates from the portfolios; ${clean.length} clear the rules; the rest wait, with a reason (see proposals.json)`);
}

// ---------- publish ----------

const trail = (action, target, summary, extra = {}) => ({ actor: { name: needBy(), role: 'cli' }, via: 'cli', action, target, summary, ...extra });

async function publish() {
  const j = judgments();
  const scans = new Map(loadScans().map((s) => [s.source_id, s]));
  const { changed } = await transact(dir, async (work, { at }) => {
    const audit = [];
    let published = 0;
    for (const c of candidatesFromPortfolios(work)) {
      const key = c.domain ?? nameKey(c.name);
      const decision = j.companies[key];
      const problem = problemWith(c, decision);
      if (c.status === 'published' || c.status === 'merged') continue;
      if (problem) { continue; }
      const note = `Added from ${c.discoveries.map((d) => scans.get(d.source_id)?.publisher ?? d.source_id).join(', ')} portfolio page(s) and the company's own website; see docs/portfolio-import.md.`;
      approveCandidate(work, c.id, { by: needBy(), note, at });
      audit.push(trail('candidate.approve', { type: 'candidate', id: c.id }, `Approved ${c.name}`, { reason: note }));
      const place = placeOf(c);
      const placeEvidence = c.evidence.find((e) => ['address', 'city'].includes(e.field) && OWN_PAGES.includes(e.source?.kind) && e.source?.url);
      const location = place ? { city: place.city, state: place.state, precision: 'CITY', source: 'company_website', sourceUrl: placeEvidence?.source?.url ?? c.website, verifiedAt: placeEvidence?.source?.retrieved_at ?? at } : null;
      const { company } = publishCandidate(work, c.id, { by: needBy(), at, location });
      // The sector and the line that describes it are a person's decisions (judgments.json), recorded as such.
      company.sector = decision.sector; company.sectorFull = decision.sectorFull ?? decision.sector; company.blurb = decision.blurb;
      // The street address its own pages state stays as evidence until the geocoder has put the house on the map (locations promote): a record that carries an address
      // without a point is a gap the completeness audit reports, and a company known to its city is a group, not a pin.
      if (!location || location.precision === 'CITY') delete company.address;
      // What the portfolio pages say: the company is theirs (website, and the investor where the firm invests), each row with the page and the day it was read.
      const rows = [];
      for (const d of c.discoveries) {
        const scan = scans.get(d.source_id);
        if (!scan) continue;
        const lead = scan.leads.find((l) => (l.profile_url ?? scan.list_url) === d.url || l.key === d.key);
        const source = { kind: SOURCE_KIND[scan.kind], url: d.url, title: d.title, publisher: scan.publisher, retrieved_at: scan.retrieved_at, note: `${scan.publisher}'s public portfolio page, read on this day (robots.txt allows it).` };
        if (lead?.website) rows.push({ field: 'website', value: company.website, confidence: 'high', verified_at: scan.retrieved_at, note: `The website ${scan.publisher} lists for the company.`, source });
        if (scan.investor) rows.push({ field: 'investors', value: scan.investor, confidence: 'high', verified_at: scan.retrieved_at, note: `Listed in ${scan.publisher}'s portfolio.`, source });
      }
      const investors = [...new Set(rows.filter((r) => r.field === 'investors').map((r) => r.value))];
      if (investors.length) company.investors = investors;
      promoteEvidence(work, company.id, rows);
      audit.push(trail('candidate.publish', { type: 'candidate', id: c.id }, `Published ${company.name} as ${company.id} (${location ? `city-level: a group in ${location.city}, not a pin` : 'place not known'})`));
      published += 1;
    }
    console.log(`published ${published}`);
    return { audit };
  });
  console.log(`wrote ${changed.join(', ') || 'nothing'}`);
}

// ---------- tidy ----------

// Takes the street address off the companies this import published at city level (or with no place), where an earlier run left it on the record: it is evidence
// (it stays), not yet a located address. Safe to run again.
async function tidy() {
  const { changed } = await transact(dir, async (work, { at }) => {
    const ids = new Set(candidatesFromPortfolios(work).filter((c) => c.status === 'published').map((c) => c.published_company_id));
    const audit = [];
    for (const company of work.companies) {
      if (!ids.has(company.id) || !company.address || !['CITY', 'UNKNOWN', 'STATE'].includes(company.location_precision)) continue;
      audit.push(trail('enrichment.apply', { type: 'company', id: company.id }, `${company.name}: the street address is kept as evidence only until it is placed on the map`, { changes: [{ field: 'address', from: company.address, to: null }] }));
      delete company.address;
      company.updated_at = at;
    }
    console.log(`tidied ${audit.length}`);
    return { audit };
  });
  console.log(`wrote ${changed.join(', ') || 'nothing'}`);
}

// ---------- report ----------

async function report() {
  const ds = parseRaw(await loadRaw(dir));
  const scans = loadScans();
  const merged = mergedLeads(scans);
  const cands = candidatesFromPortfolios(ds);
  const j = judgments();
  const states = {};
  for (const c of cands) states[c.status] = (states[c.status] ?? 0) + 1;
  const reasons = {};
  for (const c of cands.filter((x) => x.status !== 'published' && x.status !== 'merged')) {
    const p = problemWith(c, j.companies[c.domain ?? nameKey(c.name)]) ?? 'clears the rules, not yet published';
    reasons[p] = (reasons[p] ?? 0) + 1;
  }
  console.log(JSON.stringify({
    companies_in_directory: ds.companies.length, scans: scans.map((s) => ({ source: s.source_id, named: s.leads.length, read: s.retrieved_at.slice(0, 10) })),
    collected: merged.collected, unique: merged.leads.length, named_by_more_than_one_page: merged.collected - merged.leads.length,
    candidates: cands.length, by_status: states, held_reasons: reasons,
  }, null, 1));
}

if (step === 'plan') await plan();
else if (step === 'run') await run();
else if (step === 'reread') await reread();
else if (step === 'propose') await propose();
else if (step === 'publish') await publish();
else if (step === 'tidy') await tidy();
else if (step === 'report') await report();
else console.log('steps: plan, run, reread, propose, publish, tidy, report (see the top of this file)');
