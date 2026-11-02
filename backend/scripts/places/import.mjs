// Adds a city's companies from a research list (Perth, Melbourne: scripts/places/cities.mjs; --city), as research and not as fact: every row is checked against the directory, against the pages it cites and against the
// company's OWN website before it can be published, and what cannot be checked is kept in a review queue with what is missing. It sits on the discovery engine
// (docs/discovery.md), so a company the directory already has is never added twice and nothing is public until a person has approved it.
//
//   hubs     reads each page the research cites (once, robots.txt obeyed, LinkedIn never read) and records, for each company, whether the page names it, whether it says
//            Perth, any address with a Perth postcode, and the external links near its name. Writes hub-facts.json.
//   sites    for rows with no website anywhere in the research or on a list: the likeliest domains for the name are looked up (DNS), and a site is taken only when
//            its own homepage names the company. Writes site-guesses.json. A guess is never used on its own: the engine reads the site next and the company's own
//            pages must still name an address in Greater Perth.
//   ownpages for every row with a website: up to four pages of the company's OWN site (its home page and the pages the engine reads: contact, about, privacy, terms)
//            are read again and scanned for what they say about where the company is: an address in Western Australia, or a sentence that it is based in Perth;
//            and for a notice that it has closed or been acquired. Writes own-pages.json.
//   plan     DRY RUN. For every research row: what the directory already has (an update, or a duplicate), the website that would be read, and what the engine says so
//            far. Prints the proposed additions, updates, duplicates and review items. Writes nothing.
//   run      every row that is not established, a duplicate or already ours becomes a candidate (the engine resolves it by website domain and name and reads the
//            company's own website). Writes candidates.json only: no company changes.
//   reread   reads again the own sites that could not be read (a network failure, a slow page).
//   propose  classifies every row (add, update, review, established, excluded) with the reason and what is missing: proposals.json.
//   apply    a person (--by) approves what the rules clear and judgments.json accepts: new companies are published at the city (Perth), existing ones are enriched
//            (unknown fields only), and the rest stay as they are. Run `npm run locations -- geocode` and `promote` afterwards for exact pins.
//   report   the counts.
//
// Re-running changes nothing that is done. --data <dir> works on a copy of the data files. Every step that writes validates the whole dataset first.
//
//   node scripts/places/import.mjs hubs  --city perth|melbourne
//   node scripts/places/import.mjs sites  --city perth|melbourne
//   node scripts/places/import.mjs ownpages  --city perth|melbourne
//   node scripts/places/import.mjs plan    [--data dir]  --city perth|melbourne
//   node scripts/places/import.mjs run     --by "name" [--data dir] [--limit n]  --city perth|melbourne
//   node scripts/places/import.mjs reread  --by "name" [--data dir]  --city perth|melbourne
//   node scripts/places/import.mjs propose [--data dir]  --city perth|melbourne
//   node scripts/places/import.mjs apply   --by "name" [--data dir]  --city perth|melbourne
//   node scripts/places/import.mjs report  [--data dir]  --city perth|melbourne
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main as discovery, parseArgs } from '../discovery.js';
import { loadRaw, parseRaw } from '../../src/models/dataset.js';
import { transact } from '../../src/models/store.js';
import { approveCandidate, reopenCandidate, markDistinct } from '../../src/discovery/review.js';
import { createEngine } from '../../src/discovery/pipeline.js';
import { createFetcher, DEFAULT_USER_AGENT } from '../../src/discovery/http.js';
import { publishCandidate, applyEnrichment, promoteEvidence, ensureSource } from '../../src/discovery/publish.js';
import { buildIndex, identityOfLead, resolveLead, describeMatch } from '../../src/discovery/resolve.js';
import { canonicalDomain, nameKey } from '../../src/models/identity.js';
import { valuesEqual } from '../../src/models/evidence.js';
import { links, stripTags, decodeEntities } from '../../src/discovery/html.js';
import { placeOfAddress, metroOf } from '../../src/geo/metro.js';
import { parseAddress } from '../../src/models/location.js';
import { usableWebsite } from '../portfolio/sources.mjs';
import { readSite } from '../../src/discovery/enrich.js';
import { rowOf, CLOSED, sharedWords, cleanAddress } from './rows.mjs';
import { CITIES, matchersOf } from './cities.mjs';

const { positional: [step], flags } = parseArgs(process.argv.slice(2));
const CITY = CITIES[typeof flags.city === 'string' ? flags.city : 'perth'];
if (!CITY) throw new Error(`--city must be one of: ${Object.keys(CITIES).join(', ')}`);
const M = matchersOf(CITY);
const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HERE = path.join(BACKEND, 'scripts', CITY.dir); // the city's own folder: its research, what was read, the decisions and corrections a person wrote
const RESEARCH_FILE = path.join(HERE, 'research', CITY.researchFile);
const HUB_FILE = path.join(HERE, 'hub-facts.json');
const GUESS_FILE = path.join(HERE, 'site-guesses.json');
const OWN_FILE = path.join(HERE, 'own-pages.json');
const FIXES_FILE = path.join(HERE, 'fixes.json');
const JUDGMENTS = path.join(HERE, 'judgments.json');
const SOURCE_ID = CITY.sourceId;
const dir = path.resolve(typeof flags.data === 'string' ? flags.data : path.join(BACKEND, 'src', 'data'));
const by = typeof flags.by === 'string' ? flags.by : null;
const limit = Number(flags.limit) || Infinity;
const needBy = () => { if (!by) throw new Error('--by "name" is required: every decision is recorded with a name'); return by; };
const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback);

// ---------- the research rows ----------

const research = readJson(RESEARCH_FILE, { companies: [] });
const rows = research.companies.map(rowOf);
const domainOf = (website) => canonicalDomain(website)?.domain ?? null;

// ---------- hubs: the pages the research cites ----------

const HUB_FETCH = { minDelayMs: 1500, timeoutMs: 25000, maxBytes: 6000000 };
const SKIP_HOSTS = CITY.skipHosts;
const plain = (html) => decodeEntities(stripTags(String(html ?? ''))).replace(/\s+/g, ' ');
const fold = (s) => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hostKey = (url) => { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase().replace(/\.(com|org|net|co|io|ai|app|tech|life|earth|education|health)(\.au)?$/, '').replace(/\.au$/, ''); } catch { return ''; } };

async function hubs() {
  const urls = [...new Set(rows.flatMap((r) => r.sources))];
  const fetcher = createFetcher({ userAgent: process.env.DISCOVERY_USER_AGENT || DEFAULT_USER_AGENT, ...HUB_FETCH });
  const pages = {};
  for (const url of urls) {
    try {
      const page = await fetcher.get(url);
      pages[url] = { ok: true, final: page.finalUrl, html: page.text };
    } catch (e) {
      pages[url] = { ok: false, error: `${e.code ?? e.name}: ${String(e.message).slice(0, 140)}` };
    }
  }
  const out = { read_at: new Date().toISOString(), sources: {}, rows: {} };
  for (const [url, p] of Object.entries(pages)) out.sources[url] = p.ok ? { ok: true, final: p.final, bytes: p.html.length } : { ok: false, error: p.error };
  for (const r of rows) {
    const facts = { checks: [], links: [] };
    for (const url of r.sources) {
      const p = pages[url];
      if (!p?.ok) { facts.checks.push({ url, read: false, error: p.error }); continue; }
      const text = plain(p.html);
      const names = [r.name, ...r.aliases].filter((n) => n.length >= 3);
      const hit = names.map((n) => ({ n, i: fold(text).indexOf(fold(n)) })).find((x) => x.i >= 0);
      const around = hit ? text.slice(Math.max(0, hit.i - 250), hit.i + 450) : '';
      const check = { url, read: true, names_it: Boolean(hit), says_city: M.mentions.test(around), city_postcode: Boolean(placeOfAddress(around)?.city === CITY.name), context: around.slice(0, 500) };
      // a cited page on the company's own domain (a contact or about page): every address in Western Australia it writes, whole page
      const tokens0 = [r.name, ...r.aliases].map((n) => nameKey(n).replace(/ /g, ''));
      const hk = hostKey(url).replace(/[^a-z0-9]/g, '');
      const bare = (u) => new URL(u).hostname.replace(/^www\./, '');
      const ownDomain = (r.website && (() => { try { return bare(r.website) === bare(p.final); } catch { return false; } })()) || (hk.length >= 4 && tokens0.some((t) => t.length >= 4 && (hk.includes(t) || t.includes(hk))));
      if (ownDomain) {
        check.own_page = true;
        check.addresses = [...new Set([...text.matchAll(M.addrLong())].map((m) => m[1].replace(/\s+/g, ' ').trim()))].slice(0, 3);
      }
      facts.checks.push(check);
      // external links near its name in the page's own markup (every place the name is written, up to six): only on a page that lists many companies
      if (hit && rows.filter((x) => x.sources.includes(url)).length >= 3) {
        const raw = p.html;
        const re = new RegExp(escapeRe(hit.n).replace(/ /g, '\\s+'), 'gi');
        let count = 0;
        for (const m of raw.matchAll(re)) {
          if (count >= 6) break;
          count += 1;
          const window = raw.slice(Math.max(0, m.index - 1500), m.index + 1500);
          for (const l of links(window, p.final)) {
            let host;
            try { host = new URL(l.href).hostname; } catch { continue; }
            if (SKIP_HOSTS.test(host) || !usableWebsite(l.href) || host === new URL(p.final).hostname) continue;
            facts.links.push({ href: l.href, from: url });
          }
        }
      }
    }
    // the link whose domain carries the company's name is the one worth reading; the rest are not guessed at
    const tokens = [r.name, ...r.aliases].map((n) => nameKey(n).replace(/ /g, ''));
    facts.links = [...new Map(facts.links.map((l) => [l.href, l])).values()].filter((l) => tokens.some((t) => t.length >= 4 && (hostKey(l.href).replace(/[^a-z0-9]/g, '').includes(t) || t.includes(hostKey(l.href).replace(/[^a-z0-9]/g, '')))));
    out.rows[r.key] = facts;
  }
  writeFileSync(HUB_FILE, `${JSON.stringify(out, null, 1)}\n`);
  const bad = Object.entries(out.sources).filter(([, s]) => !s.ok);
  console.log(`${urls.length} cited pages: ${urls.length - bad.length} read, ${bad.length} not (${bad.map(([u, s]) => `${new URL(u).hostname}: ${s.error}`).join('; ').slice(0, 600)})`);
  console.log(`rows with a website link found near their name on a list: ${Object.values(out.rows).filter((x) => x.links.length).length}`);
}

// The website to read for a row: the research's own, else a link on a list that carries the company's name, else a domain whose homepage names the company (`sites`).
const hubFacts = () => readJson(HUB_FILE, { rows: {}, sources: {} });
const guessFacts = () => readJson(GUESS_FILE, { rows: {} });
function websiteFor(row, facts = hubFacts(), guesses = guessFacts()) {
  const chosen = judgments().rows[row.key]?.website;
  if (chosen) return { url: chosen, from: 'chosen by a person' };
  if (row.website && usableWebsite(row.website)) return { url: row.website, from: 'research' };
  const link = facts.rows[row.key]?.links?.[0];
  if (link) return { url: link.href, from: `a link on ${new URL(link.from).hostname}` };
  const guess = guesses.rows[row.key]?.found;
  return guess ? { url: guess.url, from: 'a domain whose homepage names the company' } : null;
}

// ---------- sites: likely domains for the rows that have none ----------

const TLDS = ['.com.au', '.com', '.au', '.io', '.ai', '.co', '.app', '.tech', '.org', '.com.au'];
async function sites() {
  const { promises: dns } = await import('node:dns');
  const existing = readJson(GUESS_FILE, { rows: {} });
  const facts = hubFacts();
  const todo = rows.filter((r) => !r.website && !r.established && !facts.rows[r.key]?.links?.length && !existing.rows[r.key]);
  const fetcher = createFetcher({ userAgent: process.env.DISCOVERY_USER_AGENT || DEFAULT_USER_AGENT, minDelayMs: 1200, timeoutMs: 20000, maxBytes: 1500000 });
  const exists = async (host) => { try { await dns.lookup(host); return true; } catch { return false; } };
  const out = existing;
  for (const row of todo) {
    const base = nameKey(row.name).replace(/ /g, '');
    const hyphen = nameKey(row.name).replace(/ /g, '-');
    const hosts = [...new Set([base, hyphen].filter((b) => b.length >= 4).flatMap((b) => [...new Set(TLDS)].map((t) => `${b}${t}`)))];
    const live = (await Promise.all(hosts.map(async (h) => ((await exists(h)) ? h : null)))).filter(Boolean);
    const record = { tried: hosts.length, resolved: live, found: null, seen: [] };
    for (const host of live.slice(0, 4)) {
      try {
        const page = await fetcher.get(`https://${host}/`);
        const part = (re) => re.exec(page.text)?.[1] ?? '';
        const head = `${part(/<title[^>]*>([\s\S]*?)<\/title>/i)} ${part(/property="og:site_name" content="([^"]*)"/i)} ${part(/<h1[^>]*>([\s\S]*?)<\/h1>/i)}`;
        const names = [row.name, ...row.aliases];
        const hit = names.some((n) => n.length >= 4 && fold(plain(head)).includes(fold(n)));
        record.seen.push({ url: page.finalUrl, title: plain(head).slice(0, 120), names_it: hit });
        if (hit && !record.found) record.found = { url: page.finalUrl.replace(/\/$/, ''), title: plain(head).slice(0, 120) };
      } catch (e) { record.seen.push({ url: `https://${host}/`, error: `${e.code ?? e.name}` }); }
    }
    out.rows[row.key] = record;
  }
  writeFileSync(GUESS_FILE, `${JSON.stringify(out, null, 1)}\n`);
  const found = Object.values(out.rows).filter((x) => x.found).length;
  console.log(`${todo.length} rows looked at; sites found whose homepage names the company: ${found} (of ${Object.keys(out.rows).length} looked at in all)`);
}

// ---------- ownpages: what the company's own pages say about where it is ----------

const normWA = M.normState; // the state's full name is its code ("Western Australia" is WA), and a suburb and postcode with no state gets the state
const BASED = M.based;
const PERTH_WA = M.statement;
const OTHER_STATE_ADDRESS = M.otherState;
const KIND_WORDS = [[/head office|headquarters|\bHQ\b|headquartered/i, 'HEADQUARTERS'], [/laborator|\blab\b|workshop|facility|factory|plant|warehouse/i, 'OTHER'], [/office|studio|co-?working/i, 'OFFICE']];
const kindOf = (t) => KIND_WORDS.find(([re]) => re.test(t))?.[1] ?? null;

async function ownpages() {
  const guesses = guessFacts();
  const facts = hubFacts();
  const existing = readJson(OWN_FILE, { rows: {} });
  const fetcher = createFetcher({ userAgent: process.env.DISCOVERY_USER_AGENT || DEFAULT_USER_AGENT, minDelayMs: 1500, timeoutMs: 20000, maxBytes: 1500000 });
  // --retry: a site whose read failed on the network (a DNS blip, a timeout) is read again; a site that answered is not
  const retry = process.argv.includes('--retry');
  const failed = (rec) => !rec.pages.length && rec.errors.some((e) => ['dns_failed', 'network_error', 'timeout'].includes(e.code));
  const todo = rows.filter((r) => !r.established && websiteFor(r, facts, guesses) && (!existing.rows[r.key] || (retry && failed(existing.rows[r.key]))));
  for (const row of todo) {
    const site = websiteFor(row, facts, guesses);
    const read = await readSite(site.url, { fetcher, maxPages: 4 });
    const record = { website: site.url, pages: read.pages.map((p) => ({ url: p.finalUrl, status: p.status })), errors: read.errors.map((e) => ({ url: e.url, code: e.code })), addresses: [], statements: [], elsewhere: [], closed: null, read_at: new Date().toISOString() };
    for (const page of read.pages) {
      const text = normWA(plain(page.html));
      for (const m of [...text.matchAll(M.addrFwd()), ...text.matchAll(M.addrBack())]) {
        const t = m[1].replace(/\s+/g, ' ').trim();
        const p = placeOfAddress(t);
        if (p?.city === CITY.name) record.addresses.push({ text: t, url: page.finalUrl, kind: kindOf(t) });
        else if (p) record.elsewhere.push({ text: t, url: page.finalUrl, state: p.state, kind: kindOf(t) });
      }
      const sentence = BASED.exec(text)?.[0] ?? PERTH_WA.exec(text)?.[0] ?? null;
      if (sentence) record.statements.push({ text: sentence.replace(/\s+/g, ' ').trim().slice(0, 140), url: page.finalUrl, kind: kindOf(sentence) });
      for (const m of text.matchAll(OTHER_STATE_ADDRESS)) { const t = m[1].replace(/\s+/g, ' ').trim(); const p = placeOfAddress(t); if (p) record.elsewhere.push({ text: t, url: page.finalUrl, state: p.state, kind: kindOf(t) }); }
      const closed = CLOSED.exec(text);
      if (closed && !record.closed) record.closed = { text: text.slice(Math.max(0, closed.index - 60), closed.index + 80).replace(/\s+/g, ' '), url: page.finalUrl };
    }
    record.addresses = [...new Map(record.addresses.map((a) => [a.text, a])).values()].slice(0, 3);
    record.elsewhere = [...new Map(record.elsewhere.map((a) => [a.text, a])).values()].slice(0, 3);
    existing.rows[row.key] = record;
    if (Object.keys(existing.rows).length % 15 === 0) writeFileSync(OWN_FILE, JSON.stringify(existing, null, 1) + '\n'); // a long read keeps what it has done if it is stopped
  }
  writeFileSync(OWN_FILE, JSON.stringify(existing, null, 1) + '\n');
  const done = Object.values(existing.rows);
  console.log(todo.length + ' sites read; with an address in ' + CITY.greater + ': ' + done.filter((r) => r.addresses.length).length + '; saying it is based in ' + CITY.name + ': ' + done.filter((r) => r.statements.length).length + '; nothing read: ' + done.filter((r) => !r.pages.length).length);
}
const ownFacts = () => readJson(OWN_FILE, { rows: {} });

// ---------- the leads ----------

const leadFor = (row, facts) => {
  const site = websiteFor(row, facts);
  return {
    key: row.key, name: row.name, aliases: row.aliases, website: site?.url ?? null, url: row.sources[0] ?? null, title: `${row.name} | ${row.group}`, publisher: `${CITY.name} research list`,
    observed_at: research.researched_on ? `${research.researched_on}T00:00:00.000Z` : new Date().toISOString(), retrieved_at: research.researched_on ? `${research.researched_on}T00:00:00.000Z` : new Date().toISOString(),
    city: null, state: null, founders: [], evidence: [], text: facts?.rows?.[row.key]?.checks?.map((c) => c.context).filter(Boolean).join(' ') ?? '',
  };
};

function classifyAgainstDirectory(ds) {
  const index = buildIndex(ds);
  const facts = hubFacts();
  return rows.map((row) => {
    const lead = leadFor(row, facts);
    const r = resolveLead(identityOfLead({ name: row.name, aliases: row.aliases, website: lead.website }), index);
    return { row, lead, outcome: r.outcome, matches: r.matches, site: websiteFor(row, facts) };
  });
}

// ---------- plan: the dry run ----------

async function plan() {
  const ds = parseRaw(await loadRaw(dir));
  const facts = hubFacts();
  const found = classifyAgainstDirectory(ds);
  const here = (c) => c.city === CITY.name;
  console.log(`research rows: ${rows.length} (${research.counts ? JSON.stringify(research.counts) : ''})`);
  console.log(`companies in the directory now: ${ds.companies.length}; in ${CITY.name}: ${ds.companies.filter(here).length}\n`);
  const byOutcome = {};
  for (const f of found) (byOutcome[f.outcome] ??= []).push(f);
  const readSources = Object.values(facts.sources ?? {});
  console.log(`cited pages: ${readSources.filter((s) => s.ok).length} read, ${readSources.filter((s) => !s.ok).length} not read (run \`hubs\` to read them)`);
  for (const outcome of ['EXACT_MATCH', 'LIKELY_MATCH', 'POSSIBLE_MATCH']) {
    for (const f of byOutcome[outcome] ?? []) console.log(`  ${outcome === 'EXACT_MATCH' ? 'UPDATE/DUPLICATE' : outcome} ${f.row.name} ~ ${f.matches.map((m) => describeMatch(m)).join(' | ').slice(0, 150)}`);
  }
  const fresh = byOutcome.NEW_COMPANY ?? [];
  const established = fresh.filter((f) => f.row.established);
  const toRead = fresh.filter((f) => !f.row.established);
  console.log(`\nnot in the directory: ${fresh.length}`);
  console.log(`  established, acquired or listed (kept apart from the startups, not added): ${established.length}`);
  console.log(`  would be read and judged (candidates): ${toRead.length}, of which a website to read is known for ${toRead.filter((f) => f.site).length} and not for ${toRead.filter((f) => !f.site).length} (those wait in the review queue as "official website not identified")`);
  const groups = {};
  for (const f of toRead) { const g = (groups[f.row.group] ??= { total: 0, site: 0 }); g.total += 1; if (f.site) g.site += 1; }
  for (const [g, c] of Object.entries(groups).sort()) console.log(`    ${g.padEnd(30)} ${String(c.total).padStart(3)} rows, ${String(c.site).padStart(3)} with a website`);
  const sourceProblems = Object.entries(facts.sources ?? {}).filter(([, s]) => !s.ok);
  if (sourceProblems.length) console.log(`\ncited pages that could not be read:\n${sourceProblems.map(([u, s]) => `  ${u}  ${s.error}`).join('\n')}`);
  const skipped = rows.filter((r) => r.skippedSources.length);
  console.log(`\nrows with a LinkedIn source (never read): ${skipped.length}`);
  console.log('\n(nothing was written)');
}

// ---------- run ----------

async function run() {
  const ds = parseRaw(await loadRaw(dir));
  const found = classifyAgainstDirectory(ds);
  const todo = found.filter((f) => !(f.outcome === 'EXACT_MATCH' && f.matches[0]?.target?.kind === 'company') && !f.row.established).slice(0, limit);
  const leads = todo.map((f) => f.lead);
  const sourceDef = { id: SOURCE_ID, kind: 'directory_listing', region: 'AU', license: { basis: 'permitted_page' }, licenseBasis: 'permitted_page', discover: async () => leads };
  console.log(`${leads.length} candidates to make or update (${leads.filter((l) => l.website).length} with a website to read)`);
  const code = await discovery(['run', '--by', needBy(), '--source', SOURCE_ID, '--data', dir], { sources: [sourceDef] });
  if (code) process.exitCode = code;
}

const candidatesOf = (ds) => ds.candidates.filter((c) => c.discoveries.some((d) => d.source_id === SOURCE_ID));
const trail = (action, target, summary, extra = {}) => ({ actor: { name: needBy(), role: 'cli' }, via: 'cli', action, target, summary, ...extra });
const OWN_PAGES = ['company_website', 'company_document'];

async function reread() {
  const ds = parseRaw(await loadRaw(dir));
  const ids = candidatesOf(ds).filter((c) => c.status === 'needs_review' && c.resolution === 'NEW_COMPANY' && c.website && !c.evidence.some((e) => OWN_PAGES.includes(e.source?.kind))).slice(0, limit).map((c) => c.id);
  console.log(`${ids.length} candidates have no page of their own site read yet`);
  for (let i = 0; i < ids.length; i += 20) {
    const fetcher = createFetcher({ userAgent: process.env.DISCOVERY_USER_AGENT || DEFAULT_USER_AGENT });
    await transact(dir, async (work) => {
      const engine = createEngine({ work, fetcher, options: { enrich: true } });
      const audit = [];
      for (const id of ids.slice(i, i + 20)) {
        const c = work.candidates.find((x) => x.id === id);
        if (!c || c.status !== 'needs_review') continue;
        try {
          const out = await engine.enrichCandidate(id, { website: c.website, by: needBy() });
          console.log(`  ${(out.name ?? id).padEnd(28)} ${out.status}`);
          audit.push(trail('candidate.enrich', { type: 'candidate', id }, `Read ${out.name}'s own website again (${c.website})`, { reason: `${CITY.name} research import: the first read failed` }));
        } catch (e) { console.log(`  ${id}: ${e.message}`); }
      }
      return { audit };
    });
    console.log(`  ...${Math.min(i + 20, ids.length)} of ${ids.length} done`);
  }
}

// ---------- classification ----------

const judgments = () => readJson(JUDGMENTS, { rows: {} });

// The places a company's own pages put it: every address with a state and a postcode, as { city, state, postcode, text }.
function addressesOf(c) {
  const out = [];
  for (const e of c.evidence.filter((x) => x.field === 'address' && OWN_PAGES.includes(x.source?.kind))) {
    const p = placeOfAddress(e.value);
    if (p) out.push({ ...p, text: String(e.value), url: e.source.url });
  }
  if (c.address) { const p = placeOfAddress(c.address); if (p && !out.some((o) => o.text === c.address)) out.push({ ...p, text: c.address, url: c.website }); }
  return out;
}

// What a row is, and why. kinds: update, add, review, established, excluded, duplicate.
function classify(ds) {
  const facts = hubFacts();
  const guesses = guessFacts();
  const owns = ownFacts();
  const j = judgments().rows;
  const index = buildIndex(ds);
  const byKey = new Map(candidatesOf(ds).map((c) => [c.discoveries.find((d) => d.source_id === SOURCE_ID)?.key, c]));
  const out = [];
  for (const row of rows) {
    const decision = j[row.key] ?? {};
    const lead = leadFor(row, facts);
    const resolved = resolveLead(identityOfLead({ name: row.name, aliases: row.aliases, website: lead.website }), index);
    const cand = byKey.get(row.key) ?? null;
    const item = { key: row.key, name: row.name, group: row.group, relationship: row.relationship, website: lead.website, sector: decision.sector ?? row.sector, candidate: cand?.id ?? null, checks: facts.rows[row.key]?.checks ?? [], missing: [], notes: [] };
    const push = (kind, reason) => out.push({ ...item, kind, reason });
    if (decision.exclude) { push('excluded', decision.exclude); continue; }
    if (decision.same_as) { push('update', `the same company as ${decision.same_as} (a person checked: ${decision.same_note ?? 'same business, name or website written differently'})`); out[out.length - 1].existing = decision.same_as; continue; }
    if (resolved.outcome === 'EXACT_MATCH' && resolved.matches[0]?.target?.kind === 'company' && !cand) {
      const target = resolved.matches[0].target;
      push('update', `already in the directory as ${target.name} (${target.id})`); out[out.length - 1].existing = target.id; continue;
    }
    if (cand && ['published', 'merged'].includes(cand.status)) { push(cand.status === 'merged' ? 'update' : 'add', cand.status === 'merged' ? `merged into ${cand.decisions?.same_as}` : `published as ${cand.published_company_id}`); out[out.length - 1].published = cand.published_company_id ?? cand.decisions?.same_as; continue; }
    if (row.established) { push('established', decision.note ?? 'established, listed or acquired: kept apart from the early-stage startups'); continue; }
    if (resolved.outcome !== 'NEW_COMPANY' && !cand && !decision.distinct_from) { push('review', `might be ${resolved.matches[0]?.target?.name} (${resolved.matches[0]?.target?.id}): ${describeMatch(resolved.matches[0] ?? {})}`.slice(0, 220)); continue; }
    if (cand && cand.resolution !== 'NEW_COMPANY' && !decision.distinct_from) { push('review', `might be ${cand.matches[0]?.name ?? 'a company we have'} (${cand.matches[0]?.id ?? '?'}, ${cand.resolution})`); continue; }
    if (decision.hold) { push('review', decision.hold); continue; }
    // the checks the research asks for
    const missing = [];
    if (!lead.website) missing.push('official website not identified');
    // the company's own pages read: by the engine (its site) or by `hubs` (a page the research cites on the company's own domain)
    const citedOwn = item.checks.filter((c) => c.own_page && c.read);
    const own = owns.rows[row.key] ?? null;
    const ownRead = cand?.evidence.some((e) => OWN_PAGES.includes(e.source?.kind)) || citedOwn.length > 0 || Boolean(own?.pages?.length) || Boolean(decision.presence);
    if (lead.website && !ownRead) missing.push('its own website could not be read');
    const identityBad = !decision.confirm_identity && (cand?.notes ?? []).some((n) => /does not appear to be/i.test(n.text));
    if (identityBad) missing.push('its own website does not appear to be this company');
    const cited = citedOwn.flatMap((c) => (c.addresses ?? []).map((text) => ({ ...placeOfAddress(normWA(text)), text, url: c.url, cited: true })).filter((a) => a.state));
    const fromOwn = [...(own?.addresses ?? []).map((a) => ({ ...placeOfAddress(a.text), text: a.text, url: a.url, kind: a.kind })), ...(own?.elsewhere ?? []).map((a) => ({ ...placeOfAddress(a.text), text: a.text, url: a.url, kind: a.kind }))].filter((a) => a.state);
    const addresses = [...(cand ? addressesOf(cand) : []), ...cited, ...fromOwn];
    const citedSays = citedOwn.find((c) => (c.says_city ?? c.says_perth) && M.cityNamed.test(c.context ?? ''));
    const citedStatement = citedSays ? { text: (M.cityStatement.exec(citedSays.context)?.[0] ?? citedSays.context).replace(/\s+/g, ' ').trim().slice(0, 140), url: citedSays.url, kind: null } : null;
    const statement = decision.presence ? { text: decision.presence.text, url: decision.presence.url, kind: decision.presence.kind ?? null } : own?.statements?.[0] ?? citedStatement;
    // (a post box is where mail goes, not where the company is)
    const isBox = (t) => M.box.test(t);
    const perthAddress = addresses.find((a) => a.city === CITY.name && !isBox(a.text)) ?? (statement ? { city: CITY.name, state: CITY.state, text: statement.text, url: statement.url, kind: statement.kind, statement: true } : null);
    // (a postal box and the privacy regulator's address that privacy policies quote are no company's place)
    const elsewhere = addresses.filter((a) => a.city !== CITY.name && !/GPO Box|Locked Bag|Information Commissioner|oaic/i.test(a.text));
    const text = (cand?.evidence ?? []).filter((e) => e.field === 'description').map((e) => e.value).join(' ');
    // a website found only by its domain must still be the company the list describes: the list's words and the site's words must meet
    const site = websiteFor(row, facts, guesses);
    if (site?.from.startsWith('a domain') && !decision.confirm_site) {
      const listed = `${item.checks.map((c) => c.context ?? '').join(' ')} ${row.sector ?? ''}`;
      const shared = sharedWords(listed, `${text} ${guesses.rows[row.key]?.found?.title ?? ''}`);
      item.corroboration = shared;
      if (shared.length < 2) missing.push('website found by its domain only, and its content does not match what the list says about the company');
    }
    item.websiteFrom = site?.from ?? null;
    if (CLOSED.test(text) || (own?.closed && CLOSED.test(own.closed.text ?? ""))) { push('excluded', 'its own pages say it has closed, been acquired or is now part of another business: "' + (own?.closed?.text ?? '').slice(0, 120) + '"'); continue; }
    if (ownRead && !perthAddress && !identityBad) {
      if (elsewhere.length && elsewhere.every((a) => a.state === CITY.state)) { push('excluded', `${CITY.regional}, not ${CITY.greater}: its own pages give ${elsewhere[0].text.slice(0, 80)}`); continue; }
      if (elsewhere.length) missing.push('its own pages give an address elsewhere (' + elsewhere[0].text.slice(0, 70) + `) and nothing places it in ${CITY.greater}`);
      else missing.push(`its own pages give no address or statement placing it in ${CITY.greater}`);
    }
    // the company's head office is somewhere else and the place here is an office of it: a person decides how the company is listed (a global headquarters is not a local one)
    const headOfficeElsewhere = elsewhere.find((a) => a.kind === 'HEADQUARTERS');
    if (perthAddress && headOfficeElsewhere && perthAddress.kind !== 'HEADQUARTERS' && !decision.confirm_local) missing.push(`its own pages give its head office elsewhere (${headOfficeElsewhere.text.slice(0, 70)}) and ${CITY.name} as an office: how it is listed needs a person`);
    if (ownRead && !text && !decision.blurb) missing.push('no description on its own pages or on a list that names it');
    if (!decision.sector || !decision.blurb) { if (!missing.length) missing.push('sector and description not yet decided (judgments.json)'); }
    item.missing = missing;
    item.place = perthAddress ?? null;
    item.placeAddresses = addresses.filter((a) => a.city === CITY.name && !isBox(a.text));
    if (missing.length) { push('review', missing.join('; ')); continue; }
    push('add', `its own website was read: it names a ${CITY.greater} address`);
    out[out.length - 1].place = perthAddress;
    out[out.length - 1].placeAddresses = addresses.filter((a) => a.city === CITY.name && !isBox(a.text));
  }
  return out;
}

async function propose() {
  const ds = parseRaw(await loadRaw(dir));
  const items = classify(ds);
  writeFileSync(path.join(HERE, 'proposals.json'), `${JSON.stringify(items, null, 1)}\n`);
  const tally = {};
  for (const i of items) tally[i.kind] = (tally[i.kind] ?? 0) + 1;
  console.log(JSON.stringify(tally));
}

// ---------- apply ----------

async function apply() {
  const j = judgments().rows;
  const hub = hubFacts();
  const researchRead = `${research.researched_on}T00:00:00.000Z`;
  const { changed } = await transact(dir, async (work, { at }) => {
    const items = classify(work);
    const audit = [];
    let published = 0;
    const blocked = [];
    let updated = 0;
    for (const item of items) {
      if (item.kind !== 'add' || item.published || !item.candidate) continue;
      const decision = j[item.key];
      if (!decision?.sector || !decision?.blurb || !item.place) continue;
      const cand = work.candidates.find((c) => c.id === item.candidate);
      if (!cand || cand.status === 'published') continue;
      // The engine rejects a company whose pages mention an ordinary trade (a gym, a law firm, plumbers, restaurants): a software company that serves them reads the same.
      // A person who has read the pages and written the decision reopens it.
      if (cand.status === 'rejected') {
        reopenCandidate(work, cand.id, { by: needBy(), at });
        audit.push(trail('candidate.reopen', { type: 'candidate', id: cand.id }, `Reopened ${cand.name}: the engine's rejection read a trade named on its pages, and its own pages were read by a person`));
      }
      // a possible duplicate is settled by a person: the one the decision names, and a match that only shares a name while its website or ABN differs (a template's legal name,
      // a similar word): both were read. A match that is strong, or has nothing against it, blocks the row and is reported.
      if (decision.distinct_from && cand.resolution !== 'NEW_COMPANY') markDistinct(work, cand.id, decision.distinct_from, { by: needBy(), at, note: decision.distinct_note ?? 'a different company with a similar name' });
      for (const m of work.candidates.find((c) => c.id === cand.id).matches ?? []) {
        if (work.candidates.find((c) => c.id === cand.id).resolution === 'NEW_COMPANY') break;
        const apart = m.outcome === 'POSSIBLE_MATCH' && (m.score < 0.36 || (m.conflicts ?? []).some((x) => ['domain_differs', 'abn_differs'].includes(x.code)));
        if (!apart || (work.candidates.find((c) => c.id === cand.id).decisions?.not_same_as ?? []).includes(m.id)) continue;
        markDistinct(work, cand.id, m.id, { by: needBy(), at, note: 'a different company: ' + (m.conflicts ?? []).map((x) => x.detail).join('; ').slice(0, 120) + ' (' + (m.reasons ?? []).join(', ') + ')' });
      }
      if (work.candidates.find((c) => c.id === cand.id).resolution !== 'NEW_COMPANY') { blocked.push(cand.name + ': ' + work.candidates.find((c) => c.id === cand.id).matches.map((m) => m.name + ' (' + m.outcome + ' ' + m.score + ')').join(', ')); continue; }
      approveCandidate(work, cand.id, { by: needBy(), note: `Added from the ${CITY.name} research list (${SOURCE_ID}) after its own website was read; see ${CITY.doc}.`, at });
      audit.push(trail('candidate.approve', { type: 'candidate', id: cand.id }, `Approved ${cand.name}`));
      const placeEvidence = cand.evidence.find((e) => e.field === 'address' && OWN_PAGES.includes(e.source?.kind) && e.source?.url);
      const location = { city: CITY.name, state: CITY.state, precision: 'CITY', source: 'company_website', sourceUrl: item.place.url ?? placeEvidence?.source?.url ?? cand.website, verifiedAt: placeEvidence?.source?.retrieved_at ?? at };
      const { company } = publishCandidate(work, cand.id, { by: needBy(), at, location });
      company.sector = decision.sector; company.sectorFull = decision.sectorFull ?? decision.sector; company.blurb = decision.blurb;
      if (decision.founders?.length) company.founders = decision.founders;
      delete company.address; // kept as evidence until the geocoder has put the house on the map (locations promote)
      // what the lists that name it say: the company is in the programme or portfolio, with the page and the day it was read
      const rowDef = rows.find((r) => r.key === item.key);
      const evidence = [];
      for (const check of hub.rows[item.key]?.checks ?? []) {
        if (!check.read || !check.names_it) continue;
        const own = OWN_PAGES.includes('company_website') && check.url.includes(new URL(company.website || 'https://x.invalid').hostname);
        if (own) continue;
        evidence.push({ field: 'website', value: company.website, confidence: 'medium', verified_at: researchRead, note: `Named on this page (${rowDef?.group.replace(/_/g, ' ')}); the page is not proof of a ${CITY.name} office.`, source: { kind: M.accelerator.test(check.url) ? 'accelerator_profile' : 'directory_listing', url: check.url, title: `${rowDef?.name} | ${new URL(check.url).hostname.replace(/^www\./, '')}`, publisher: new URL(check.url).hostname.replace(/^www\./, ''), retrieved_at: researchRead, note: 'A page the ${CITY.name} research list cites, read on this day (robots.txt allows it).' } });
      }
      const own = ownFacts().rows[item.key];
      const readAt = own?.read_at ?? researchRead;
      const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };
      for (const a of item.placeAddresses ?? []) {
        const street = a.statement || decision.no_pin ? null : cleanAddress(a.text);
        if (!street) continue;
        evidence.push({ field: 'address', value: street, confidence: 'high', verified_at: readAt, note: `An address in ${CITY.greater} on the company's own page.`, source: { kind: /privacy|terms|legal/i.test(a.url) ? 'company_document' : 'company_website', url: a.url, title: item.name + ': ' + hostOf(a.url), publisher: hostOf(a.url), retrieved_at: readAt, note: 'The company\'s own page, read by the ${CITY.name} importer (robots.txt obeyed).' } });
      }
      if (item.place?.statement || decision.no_pin) evidence.push({ field: 'city', value: CITY.name, confidence: 'medium', verified_at: readAt, note: (decision.no_pin ? 'The company\'s own page gives a postal or registered address in ' + CITY.name + ' (' + item.place.text.slice(0, 80) + '): not an operating site, so no pin.' : 'The company\'s own page says it is based in ' + CITY.name + ': "' + item.place.text + '".'), source: { kind: 'company_website', url: item.place.url, title: item.name + ': ' + hostOf(item.place.url), publisher: hostOf(item.place.url), retrieved_at: readAt, note: 'The company\'s own page, read by the ${CITY.name} importer (robots.txt obeyed).' } });
      if (evidence.length) promoteEvidence(work, company.id, evidence);
      audit.push(trail('candidate.publish', { type: 'candidate', id: cand.id }, `Published ${company.name} as ${company.id} (${CITY.name}, city-level until its address is placed${item.place?.kind ? `; its own page calls the place a ${item.place.kind.toLowerCase()}` : ''})`));
      published += 1;
    }
    // an existing company the research names: enriched (unknown fields only), never overwritten
    for (const item of items) {
      if (item.kind !== 'update' || item.published) continue;
      const cand = item.candidate ? work.candidates.find((c) => c.id === item.candidate) : null;
      if (!cand || !['needs_review', 'matched'].includes(cand.status)) continue;
      const target = work.companies.find((c) => c.id === cand.matches?.[0]?.id);
      if (!target) continue;
      applyEnrichment(work, cand, { by: needBy(), at, companyId: target.id, confirmedByPerson: true });
      updated += 1;
      audit.push(trail('candidate.merge', { type: 'candidate', id: cand.id }, `Merged ${cand.id} into ${target.id} (${CITY.name} research list)`));
    }
    console.log(`published ${published}; existing companies enriched ${updated}`);
    if (blocked.length) console.log(`not published, a possible duplicate a person must settle (${blocked.length}):\n  ${blocked.join('\n  ')}`);
    return { audit };
  });
  console.log(`wrote ${changed.join(', ') || 'nothing'}`);
}

// ---------- tidy ----------

// Rewrites the address evidence of the companies this import published so that it is the street address and not the page's wording around it ("Head office: 24 Hasler
// Road..." becomes "24 Hasler Road..."), which is what the geocoder is asked. Safe to run again.
async function tidy() {
  const { changed } = await transact(dir, async (work) => {
    const ids = new Set(candidatesOf(work).filter((c) => c.status === 'published').map((c) => c.published_company_id));
    const audit = [];
    const touched = new Map();
    // (two rows of one page can come out as the same street address once the label is off: the later one is kept as superseded, with the reason)
    const kept = new Map();
    const same = (x, y) => valuesEqual('address', x, y);
    const rowsOf = work.evidence.filter((e) => ids.has(e.company_id) && e.field === 'address' && e.status === 'active');
    for (const e of rowsOf) {
      const cleaned = cleanAddress(e.value);
      const k = e.company_id + '|' + e.source_id;
      const mine = kept.get(k) ?? [];
      const to = cleaned ?? e.value;
      if (mine.some((v) => same(v, to))) {
        touched.set(e.company_id, [...(touched.get(e.company_id) ?? []), { from: e.value, to: '(the same address as another row of this page)' }]);
        e.status = 'superseded';
        e.note = 'The same street address as another row of this page, written with the page\'s label.';
        continue;
      }
      mine.push(to);
      kept.set(k, mine);
      if (cleaned && cleaned !== e.value) { touched.set(e.company_id, [...(touched.get(e.company_id) ?? []), { from: e.value, to: cleaned }]); e.value = cleaned; }
    }
    for (const [id, list] of touched) audit.push(trail('enrichment.apply', { type: 'company', id }, 'The address its own page gives is kept as the street address, without the page\'s label', { changes: list.map((c) => ({ field: 'evidence.address', from: c.from, to: c.to })) }));
    console.log('tidied ' + touched.size + ' companies');
    return { audit };
  });
  console.log('wrote ' + (changed.join(', ') || 'nothing'));
}

// ---------- fixes: what a person corrected ----------

// fixes.json: for a company, evidence rows that are wrong (a row is never deleted: it is marked rejected or superseded, with the reason), evidence a person added from the
// company's own page, and a second location of the same company (a facility, another office) as a location of its own. Safe to run again.
async function fixes() {
  const fixesDoc = readJson(FIXES_FILE, { companies: {} });
  const { changed } = await transact(dir, async (work, { at }) => {
    const audit = [];
    work.company_locations ??= [];
    for (const [id, fix] of Object.entries(fixesDoc.companies)) {
      const company = work.companies.find((c) => c.id === id);
      if (!company) { console.log(id + ': not in the directory'); continue; }
      const changes = [];
      for (const r of fix.reject_evidence ?? []) {
        const row = work.evidence.find((e) => e.id === r.id);
        if (row && row.status === 'active') { row.status = r.status; row.note = r.note; changes.push({ field: 'evidence.' + r.id, from: 'active', to: r.status }); }
      }
      const added = [];
      for (const a of fix.add_evidence ?? []) {
        let host = null;
        try { host = new URL(a.url).hostname.replace(/^www\./, ''); } catch { /* the row below names no host */ }
        added.push({ field: a.field, value: a.value, confidence: a.confidence, verified_at: ownFacts().rows[company.slug?.replace(/-/g, '')]?.read_at ?? at, note: a.note, source: { kind: 'company_website', url: a.url, title: company.name + ': ' + host, publisher: host, retrieved_at: at, note: "The company's own page, read by the ${CITY.name} importer (robots.txt obeyed)." } });
      }
      const rows = promoteEvidence(work, id, added);
      if (rows.length) changes.push({ field: 'evidence', from: null, to: rows.length + ' row(s): ' + [...new Set(rows.map((r) => r.field))].join(', ') });
      for (const l of fix.add_locations ?? []) {
        if (work.company_locations.some((x) => x.id === l.id)) continue;
        work.company_locations.push({ id: l.id, company_id: id, kind: l.kind, label: l.label, address: l.address, suburb: l.suburb, city: l.city, state: l.state, country: 'Australia', postcode: l.postcode, latitude: null, longitude: null, location_precision: 'CITY', location_source: 'company_website', location_source_url: l.url, location_verified_at: at, location_confidence: 'medium', created_at: at, updated_at: at });
        changes.push({ field: 'company_locations', from: null, to: l.label + ' (' + l.address + ')' });
      }
      if (changes.length) { company.updated_at = at; audit.push(trail('enrichment.apply', { type: 'company', id }, company.name + ': a correction after reading its own pages (' + changes.map((c) => c.field.split('.')[0]).join(', ') + ')', { changes })); }
    }
    console.log('corrected ' + audit.length + ' companies');
    return { audit };
  });
  console.log('wrote ' + (changed.join(', ') || 'nothing'));
}

// ---------- update: what the research adds to a company the directory already has ----------

// For a company the directory already has (an EXACT_MATCH on website and name), the company's own pages were read for an address in the city. Nothing already known
// is overwritten. A company in this city with no street address on record gets the address its own page gives, as evidence (`locations geocode` and `promote` then
// put it on the map where the geocoder confirms the house). A company whose record is in another city and whose own pages give an office here gets that office as a
// location of its own (company_locations), so a head office elsewhere is never turned into a local one. An address that differs from the one on record is reported,
// not changed. Safe to run again.
async function update() {
  const owns = ownFacts().rows;
  const report = { evidence: [], offices: [], differs: [], nothing: [], websites: [] };
  const { changed } = await transact(dir, async (work, { at }) => {
    const audit = [];
    work.company_locations ??= [];
    for (const item of classify(work).filter((i) => i.kind === 'update' && i.existing)) {
      const company = work.companies.find((c) => c.id === item.existing);
      const own = owns[item.key];
      // a company with no website on record gets the research's own (or a link beside its name on a list) when that site answered and is the company's: unknown fields only
      const row = rows.find((r) => r.key === item.key);
      const site = company && !company.website && row ? websiteFor(row) : null;
      if (site && /^(research|a link on|chosen)/.test(site.from) && own?.pages?.length && domainOf(own.pages[0].url) === domainOf(site.url) && !own.closed) {
        const hostW = domainOf(site.url);
        const rowsW = promoteEvidence(work, company.id, [{ field: 'website', value: site.url, confidence: 'medium', verified_at: own.read_at ?? `${research.researched_on}T00:00:00.000Z`, note: `The website the ${CITY.name} research list gives for this company; its own page answered and was read (robots.txt obeyed).`, source: { kind: 'company_website', url: own.pages[0].url, title: company.name + ': ' + hostW, publisher: hostW, retrieved_at: own.read_at ?? at, note: "The company's own page, read by the " + CITY.name + ' importer.' } }]);
        company.website = site.url;
        company.updated_at = at;
        report.websites.push(company.name);
        audit.push(trail('enrichment.apply', { type: 'company', id: company.id }, `${company.name}: its website was recorded (it had none): ${site.url}`, { changes: [{ field: 'website', from: null, to: site.url }] }));
        void rowsW;
      }
      if (!company || !own?.addresses?.length) { report.nothing.push(item.name); continue; }
      const streets = [...new Map(own.addresses.filter((a) => !M.box.test(a.text)).map((a) => [cleanAddress(a.text), a]).filter(([street]) => street)).entries()];
      if (!streets.length) { report.nothing.push(item.name); continue; }
      const [street, a] = streets[0];
      const host = (() => { try { return new URL(a.url).hostname.replace(/^www\./, ''); } catch { return null; } })();
      const readAt = own.read_at ?? `${research.researched_on}T00:00:00.000Z`;
      const here = metroOf(company) === CITY.name || company.city === CITY.name;
      if (here) {
        if (typeof company.address === 'string' && company.address.trim()) {
          if (!valuesEqual('address', company.address, street)) report.differs.push(`${company.name}: record "${company.address}", own page "${street}"`);
          continue;
        }
        const rows = promoteEvidence(work, company.id, [{ field: 'address', value: street, confidence: 'high', verified_at: readAt, note: `An address in ${CITY.greater} on the company's own page.`, source: { kind: /privacy|terms|legal/i.test(a.url) ? 'company_document' : 'company_website', url: a.url, title: company.name + ': ' + host, publisher: host, retrieved_at: readAt, note: `The company's own page, read by the ${CITY.name} importer (robots.txt obeyed).` } }]);
        if (!rows.length) continue;
        company.updated_at = at;
        report.evidence.push(company.id);
        audit.push(trail('enrichment.apply', { type: 'company', id: company.id }, `${company.name}: the address its own page gives in ${CITY.name} was recorded as evidence`, { changes: [{ field: 'evidence.address', from: null, to: street }] }));
      } else {
        const id = `${company.id}.office.${CITY.id}`;
        if (work.company_locations.some((l) => l.id === id)) continue;
        const parsed = parseAddress(street);
        work.company_locations.push({ id, company_id: company.id, kind: a.kind === 'HEADQUARTERS' ? 'HEADQUARTERS' : 'OFFICE', label: `${CITY.name} office`, address: street, suburb: parsed.suburb ?? null, city: CITY.name, state: CITY.state, country: 'Australia', postcode: parsed.postcode ?? null, latitude: null, longitude: null, location_precision: 'CITY', location_source: 'company_website', location_source_url: a.url, location_verified_at: readAt, location_confidence: 'medium', created_at: at, updated_at: at });
        company.updated_at = at;
        report.offices.push(`${company.name} (${company.city ?? 'no city'})`);
        audit.push(trail('enrichment.apply', { type: 'company', id: company.id }, `${company.name}: its own page gives an office in ${CITY.name}, kept as a location of its own (the record stays in ${company.city ?? 'its city'})`, { changes: [{ field: 'company_locations', from: null, to: `${CITY.name} office (${street})` }] }));
      }
    }
    // an identifier the engine found when a duplicate candidate was merged into a company (a domain, a name it went by) names the page it came from: the company's own site
    const matched = new Set(classify(work).filter((i) => i.kind === 'update' && i.existing).map((i) => i.existing));
    for (const i of (work.identifiers ?? []).filter((x) => !x.source_id && matched.has(x.company_id))) {
      const company = work.companies.find((c) => c.id === i.company_id);
      const domain = i.scheme === 'domain' ? i.value : domainOf(company?.website);
      if (!domain) continue;
      const own = work.sources.find((x) => x.url && domainOf(x.url) === domain);
      i.source_id = own ? own.id : ensureSource(work, { kind: 'company_website', url: `https://${domain}/`, title: `${company.name}: ${domain}`, publisher: domain, retrieved_at: ownFacts().rows[company.slug?.replace(/-/g, '')]?.read_at ?? at, note: `The company's own site, named by the ${CITY.name} research list.` });
      audit.push(trail('enrichment.apply', { type: 'company', id: company.id }, `${company.name}: the identifier ${i.value} was given the page it came from`, { changes: [{ field: 'identifier.source', from: null, to: i.source_id }] }));
    }
    return { audit };
  });
  console.log(`address evidence added for ${report.evidence.length} companies already here: ${report.evidence.join(', ') || '-'}`);
  console.log(`an office in ${CITY.name} added as a location of its own for ${report.offices.length} companies based elsewhere: ${report.offices.join(', ') || '-'}`);
  if (report.differs.length) console.log(`an address on record that differs from its own page (not changed, for a person to look at):\n  ${report.differs.join('\n  ')}`);
  console.log(`a website recorded for ${report.websites.length} companies that had none: ${report.websites.join(', ') || '-'}`);
  console.log(`no ${CITY.name} address on its own pages: ${report.nothing.length}`);
  console.log('wrote ' + (changed.join(', ') || 'nothing'));
}

// ---------- report ----------

async function report() {
  const ds = parseRaw(await loadRaw(dir));
  const items = classify(ds);
  const tally = {};
  for (const i of items) (tally[i.kind] ??= []).push(i);
  const here = ds.companies.filter((c) => c.city === CITY.name);
  const out = {
    research_rows: rows.length, directory_total: ds.companies.length, city: CITY.name, city_companies: here.length,
    city_precise_pins: here.filter((c) => ['EXACT', 'SUBURB'].includes(c.location_precision) && Number.isFinite(c.lat)).length,
    by_kind: Object.fromEntries(Object.entries(tally).map(([k, v]) => [k, v.length])),
    excluded_reasons: Object.fromEntries(Object.entries(Object.groupBy(tally.excluded ?? [], (i) => i.reason.replace(/:.*/, ''))).map(([k, v]) => [k, v.length])),
    review_missing: Object.entries(Object.groupBy((tally.review ?? []).flatMap((i) => i.reason.split('; ').map((m) => ({ m }))), (x) => x.m.replace(/\(.*/, '').slice(0, 70))).map(([k, v]) => [k, v.length]).sort((a, b) => b[1] - a[1]),
  };
  console.log(JSON.stringify(out, null, 1));
}

if (step === 'hubs') await hubs();
else if (step === 'sites') await sites();
else if (step === 'ownpages') await ownpages();
else if (step === 'plan') await plan();
else if (step === 'run') await run();
else if (step === 'reread') await reread();
else if (step === 'propose') await propose();
else if (step === 'apply') await apply();
else if (step === 'tidy') await tidy();
else if (step === 'fixes') await fixes();
else if (step === 'update') await update();
else if (step === 'report') await report();
else console.log('steps: hubs, sites, ownpages, plan, run, reread, propose, apply, tidy, fixes, update, report (see the top of this file)');
