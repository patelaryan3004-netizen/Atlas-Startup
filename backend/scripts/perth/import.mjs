// Adds Perth companies from a research list, as research and not as fact: every row is checked against the directory, against the pages it cites and against the
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
//   propose  classifies every row (add, update, review, established, excluded) with the reason and what is missing: proposals.json and perth-review.json.
//   apply    a person (--by) approves what the rules clear and judgments.json accepts: new companies are published at the city (Perth), existing ones are enriched
//            (unknown fields only), and the rest stay as they are. Run `npm run locations -- geocode` and `promote` afterwards for exact pins.
//   report   the counts.
//
// Re-running changes nothing that is done. --data <dir> works on a copy of the data files. Every step that writes validates the whole dataset first.
//
//   node scripts/perth/import.mjs hubs
//   node scripts/perth/import.mjs sites
//   node scripts/perth/import.mjs ownpages
//   node scripts/perth/import.mjs plan    [--data dir]
//   node scripts/perth/import.mjs run     --by "name" [--data dir] [--limit n]
//   node scripts/perth/import.mjs reread  --by "name" [--data dir]
//   node scripts/perth/import.mjs propose [--data dir]
//   node scripts/perth/import.mjs apply   --by "name" [--data dir]
//   node scripts/perth/import.mjs report  [--data dir]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main as discovery, parseArgs } from '../discovery.js';
import { loadRaw, parseRaw } from '../../src/models/dataset.js';
import { transact } from '../../src/models/store.js';
import { approveCandidate, reopenCandidate, markDistinct } from '../../src/discovery/review.js';
import { createEngine } from '../../src/discovery/pipeline.js';
import { createFetcher, DEFAULT_USER_AGENT } from '../../src/discovery/http.js';
import { publishCandidate, applyEnrichment, promoteEvidence } from '../../src/discovery/publish.js';
import { buildIndex, identityOfLead, resolveLead, describeMatch } from '../../src/discovery/resolve.js';
import { canonicalDomain, nameKey } from '../../src/models/identity.js';
import { valuesEqual } from '../../src/models/evidence.js';
import { links, stripTags, decodeEntities } from '../../src/discovery/html.js';
import { placeOfAddress } from '../../src/geo/metro.js';
import { usableWebsite } from '../portfolio/sources.mjs';
import { readSite } from '../../src/discovery/enrich.js';
import { rowOf, CLOSED, sharedWords, cleanAddress } from './rows.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.join(HERE, '..', '..');
const RESEARCH_FILE = path.join(HERE, 'research', 'perth-startups-research-2026-10-31.json');
const HUB_FILE = path.join(HERE, 'hub-facts.json');
const GUESS_FILE = path.join(HERE, 'site-guesses.json');
const OWN_FILE = path.join(HERE, 'own-pages.json');
const FIXES_FILE = path.join(HERE, 'fixes.json');
const JUDGMENTS = path.join(HERE, 'judgments.json');
const SOURCE_ID = 'perth-research-2026-10-31';
const { positional: [step], flags } = parseArgs(process.argv.slice(2));
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
const SKIP_HOSTS = /(^|\.)(spacecubed\.com|ventureuwa\.com\.au|curtin\.edu\.au|wa\.gov\.au|remjobs\.works|purpose\.ventures|fundwa\.com\.au|biodesign\.au|perthbiodesign\.au|startupblink\.com|techboard\.com\.au|third-derivative\.org|austrade\.gov\.au|abr\.business\.gov\.au|walga\.asn\.au|startupnews\.com\.au|verbund\.com|zfrmz\.com\.au|biodesignmelbourne\.com)$/i;
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
      const check = { url, read: true, names_it: Boolean(hit), says_perth: /\bPerth\b|Fremantle|Joondalup|Subiaco|Osborne Park|Western Australia|\bWA\b/.test(around), perth_postcode: Boolean(placeOfAddress(around)?.city === 'Perth'), context: around.slice(0, 500) };
      // a cited page on the company's own domain (a contact or about page): every address in Western Australia it writes, whole page
      const tokens0 = [r.name, ...r.aliases].map((n) => nameKey(n).replace(/ /g, ''));
      const hk = hostKey(url).replace(/[^a-z0-9]/g, '');
      const bare = (u) => new URL(u).hostname.replace(/^www\./, '');
      const ownDomain = (r.website && (() => { try { return bare(r.website) === bare(p.final); } catch { return false; } })()) || (hk.length >= 4 && tokens0.some((t) => t.length >= 4 && (hk.includes(t) || t.includes(hk))));
      if (ownDomain) {
        check.own_page = true;
        check.addresses = [...new Set([...text.matchAll(/([^.;|]{0,90}?\b(?:WA|Western Australia)\b[\s,]*6\d{3}\b)/g)].map((m) => m[1].replace(/\s+/g, ' ').trim()))].slice(0, 3);
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
  const todo = rows.filter((r) => !r.website && r.group !== 'established_or_listed_tech' && !facts.rows[r.key]?.links?.length && !existing.rows[r.key]);
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

const normWA = (t) => String(t).replace(/\bWestern Australia\b/gi, 'WA').replace(/\b(Perth|West Perth|East Perth|South Perth|Subiaco|Osborne Park|Fremantle|Nedlands|Joondalup|Malaga|Bentley|Claremont|Leederville|Northbridge)\s+(6\d{3})\b/g, '$1 WA $2');
const PERTH_SUBURBS = "Perth|Fremantle|Subiaco|Nedlands|Crawley|Joondalup|Osborne Park|Leederville|Northbridge|West Perth|East Perth|South Perth|Victoria Park|Bentley|Malaga|Belmont|Cannington|Canning Vale|Welshpool|Kewdale|Jandakot|Henderson|Murdoch|Claremont|Cottesloe|Scarborough|Wangara|Balcatta|Myaree|Bibra Lake|O'Connor|Osborne|Mount Lawley|Innaloo|Rockingham|Midland|Maylands|Burswood|Applecross|Booragoon|Cockburn|Spearwood|Kwinana|Morley|Bayswater|Wembley|Karrinyup|Stirling|Balga|Rivervale|Hazelmere|Bassendean|Guildford|Forrestfield|Kelmscott|Armadale|Gosnells|Thornlie|Maddington|Wattle Grove|Kensington|Como|Mosman Park";
const BASED = new RegExp('(?:based|located|headquartered|head office|headquarters|HQ|our office|offices?|studio|laborator(?:y|ies)|lab|workshop|facility)[^.]{0,70}\\b(?:' + PERTH_SUBURBS + ')\\b[^.]{0,30}', 'i');
const PERTH_WA = new RegExp('\\b(?:' + PERTH_SUBURBS + ')\\s*,?\\s*(?:WA|Western Australia)\\b|\\b(?:Perth|Fremantle)(?:[- ]based|[- ](?:company|startup|start-up|business|firm|biotech|technology company))\\b', 'i');
const OTHER_STATE_ADDRESS = /([^.;|]{0,80}\b(?:NSW|VIC|QLD|SA|TAS|NT|ACT)\b[\s,]*\d{4}\b)/g;
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
  const todo = rows.filter((r) => r.group !== 'established_or_listed_tech' && websiteFor(r, facts, guesses) && (!existing.rows[r.key] || (retry && failed(existing.rows[r.key]))));
  for (const row of todo) {
    const site = websiteFor(row, facts, guesses);
    const read = await readSite(site.url, { fetcher, maxPages: 4 });
    const record = { website: site.url, pages: read.pages.map((p) => ({ url: p.finalUrl, status: p.status })), errors: read.errors.map((e) => ({ url: e.url, code: e.code })), addresses: [], statements: [], elsewhere: [], closed: null, read_at: new Date().toISOString() };
    for (const page of read.pages) {
      const text = normWA(plain(page.html));
      for (const m of [...text.matchAll(/([^.;|]{0,90}?\bWA\b[\s,]*6\d{3}\b)/g), ...text.matchAll(/([^.;|]{0,90}?\b6\d{3}\b[\s,]*WA\b)/g)]) {
        const t = m[1].replace(/\s+/g, ' ').trim();
        const p = placeOfAddress(t);
        if (p?.city === 'Perth') record.addresses.push({ text: t, url: page.finalUrl, kind: kindOf(t) });
        else if (p) record.elsewhere.push({ text: t, url: page.finalUrl, state: p.state });
      }
      const sentence = BASED.exec(text)?.[0] ?? PERTH_WA.exec(text)?.[0] ?? null;
      if (sentence) record.statements.push({ text: sentence.replace(/\s+/g, ' ').trim().slice(0, 140), url: page.finalUrl, kind: kindOf(sentence) });
      for (const m of text.matchAll(OTHER_STATE_ADDRESS)) { const t = m[1].replace(/\s+/g, ' ').trim(); const p = placeOfAddress(t); if (p) record.elsewhere.push({ text: t, url: page.finalUrl, state: p.state }); }
      const closed = CLOSED.exec(text);
      if (closed && !record.closed) record.closed = { text: text.slice(Math.max(0, closed.index - 60), closed.index + 80).replace(/\s+/g, ' '), url: page.finalUrl };
    }
    record.addresses = [...new Map(record.addresses.map((a) => [a.text, a])).values()].slice(0, 3);
    record.elsewhere = [...new Map(record.elsewhere.map((a) => [a.text, a])).values()].slice(0, 3);
    existing.rows[row.key] = record;
  }
  writeFileSync(OWN_FILE, JSON.stringify(existing, null, 1) + '\n');
  const done = Object.values(existing.rows);
  console.log(todo.length + ' sites read; with an address in Greater Perth: ' + done.filter((r) => r.addresses.length).length + '; saying it is based in Perth: ' + done.filter((r) => r.statements.length).length + '; nothing read: ' + done.filter((r) => !r.pages.length).length);
}
const ownFacts = () => readJson(OWN_FILE, { rows: {} });

// ---------- the leads ----------

const leadFor = (row, facts) => {
  const site = websiteFor(row, facts);
  return {
    key: row.key, name: row.name, aliases: row.aliases, website: site?.url ?? null, url: row.sources[0] ?? null, title: `${row.name} | ${row.group}`, publisher: 'Perth research list',
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
  const perth = (c) => c.city === 'Perth';
  console.log(`research rows: ${rows.length} (${research.counts ? JSON.stringify(research.counts) : ''})`);
  console.log(`companies in the directory now: ${ds.companies.length}; in Perth: ${ds.companies.filter(perth).length}\n`);
  const byOutcome = {};
  for (const f of found) (byOutcome[f.outcome] ??= []).push(f);
  const readSources = Object.values(facts.sources ?? {});
  console.log(`cited pages: ${readSources.filter((s) => s.ok).length} read, ${readSources.filter((s) => !s.ok).length} not read (run \`hubs\` to read them)`);
  for (const outcome of ['EXACT_MATCH', 'LIKELY_MATCH', 'POSSIBLE_MATCH']) {
    for (const f of byOutcome[outcome] ?? []) console.log(`  ${outcome === 'EXACT_MATCH' ? 'UPDATE/DUPLICATE' : outcome} ${f.row.name} ~ ${f.matches.map((m) => describeMatch(m)).join(' | ').slice(0, 150)}`);
  }
  const fresh = byOutcome.NEW_COMPANY ?? [];
  const established = fresh.filter((f) => f.row.group === 'established_or_listed_tech');
  const toRead = fresh.filter((f) => f.row.group !== 'established_or_listed_tech');
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
  const todo = found.filter((f) => f.outcome !== 'EXACT_MATCH' && f.row.group !== 'established_or_listed_tech').slice(0, limit);
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
          audit.push(trail('candidate.enrich', { type: 'candidate', id }, `Read ${out.name}'s own website again (${c.website})`, { reason: 'Perth research import: the first read failed' }));
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
    if (resolved.outcome === 'EXACT_MATCH' && !cand) {
      const target = resolved.matches[0].target;
      push('update', `already in the directory as ${target.name} (${target.id})`); out[out.length - 1].existing = target.id; continue;
    }
    if (cand && ['published', 'merged'].includes(cand.status)) { push(cand.status === 'merged' ? 'update' : 'add', cand.status === 'merged' ? `merged into ${cand.decisions?.same_as}` : `published as ${cand.published_company_id}`); out[out.length - 1].published = cand.published_company_id ?? cand.decisions?.same_as; continue; }
    if (row.group === 'established_or_listed_tech') { push('established', decision.note ?? 'established, listed or acquired: kept apart from the early-stage startups'); continue; }
    if (resolved.outcome !== 'NEW_COMPANY' && !cand && !decision.distinct_from) { push('review', `might be ${resolved.matches[0]?.name}: ${describeMatch(resolved.matches[0] ?? {})}`.slice(0, 200)); continue; }
    if (cand && cand.resolution !== 'NEW_COMPANY' && !decision.distinct_from) { push('review', `might be ${cand.matches[0]?.name ?? 'a company we have'} (${cand.resolution})`); continue; }
    if (decision.hold) { push('review', decision.hold); continue; }
    // the checks the research asks for
    const missing = [];
    if (!lead.website) missing.push('official website not identified');
    // the company's own pages read: by the engine (its site) or by `hubs` (a page the research cites on the company's own domain)
    const citedOwn = item.checks.filter((c) => c.own_page && c.read);
    const own = owns.rows[row.key] ?? null;
    const ownRead = cand?.evidence.some((e) => OWN_PAGES.includes(e.source?.kind)) || citedOwn.length > 0 || Boolean(own?.pages?.length);
    if (lead.website && !ownRead) missing.push('its own website could not be read');
    const identityBad = (cand?.notes ?? []).some((n) => /does not appear to be/i.test(n.text));
    if (identityBad) missing.push('its own website does not appear to be this company');
    const cited = citedOwn.flatMap((c) => (c.addresses ?? []).map((text) => ({ ...placeOfAddress(normWA(text)), text, url: c.url, cited: true })).filter((a) => a.state));
    const fromOwn = [...(own?.addresses ?? []).map((a) => ({ ...placeOfAddress(a.text), text: a.text, url: a.url, kind: a.kind })), ...(own?.elsewhere ?? []).map((a) => ({ ...placeOfAddress(a.text), text: a.text, url: a.url }))].filter((a) => a.state);
    const addresses = [...(cand ? addressesOf(cand) : []), ...cited, ...fromOwn];
    const citedSays = citedOwn.find((c) => c.says_perth && /\bPerth\b|Fremantle|Osborne Park|Subiaco|Nedlands|Joondalup/.test(c.context ?? ''));
    const citedStatement = citedSays ? { text: (/[^.]{0,70}\b(?:Perth|Fremantle|Osborne Park|Subiaco|Nedlands|Joondalup)\b[^.]{0,50}/.exec(citedSays.context)?.[0] ?? citedSays.context).replace(/\s+/g, ' ').trim().slice(0, 140), url: citedSays.url, kind: null } : null;
    const statement = own?.statements?.[0] ?? citedStatement;
    // (a post box is where mail goes, not where the company is)
    const isBox = (t) => /\b(?:P\.?\s?O\.?\s*Box|GPO Box|Locked Bag)\b/i.test(t);
    const perthAddress = addresses.find((a) => a.city === 'Perth' && !isBox(a.text)) ?? (statement ? { city: 'Perth', state: 'WA', text: statement.text, url: statement.url, kind: statement.kind, statement: true } : null);
    // (a postal box and the privacy regulator's address that privacy policies quote are no company's place)
    const elsewhere = addresses.filter((a) => a.city !== 'Perth' && !/GPO Box|Locked Bag|Information Commissioner|oaic/i.test(a.text));
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
    if (CLOSED.test(text) || own?.closed) { push('excluded', 'its own pages say it has closed, been acquired or is now part of another business: "' + (own?.closed?.text ?? '').slice(0, 120) + '"'); continue; }
    if (ownRead && !perthAddress && !identityBad) {
      if (elsewhere.length && elsewhere.every((a) => a.state === 'WA')) { push('excluded', `regional WA, not Greater Perth: its own pages give ${elsewhere[0].text.slice(0, 80)}`); continue; }
      if (elsewhere.length) missing.push('its own pages give an address elsewhere (' + elsewhere[0].text.slice(0, 70) + ') and nothing places it in Greater Perth');
      else missing.push('its own pages give no address or statement placing it in Greater Perth');
    }
    if (ownRead && !text && !decision.blurb) missing.push('no description on its own pages or on a list that names it');
    if (!decision.sector || !decision.blurb) { if (!missing.length) missing.push('sector and description not yet decided (judgments.json)'); }
    item.missing = missing;
    item.perth = perthAddress ?? null;
    item.perthAddresses = addresses.filter((a) => a.city === 'Perth' && !isBox(a.text));
    if (missing.length) { push('review', missing.join('; ')); continue; }
    push('add', 'its own website was read: it names a Greater Perth address');
    out[out.length - 1].perth = perthAddress;
    out[out.length - 1].perthAddresses = addresses.filter((a) => a.city === 'Perth' && !isBox(a.text));
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
    let updated = 0;
    for (const item of items) {
      if (item.kind !== 'add' || item.published || !item.candidate) continue;
      const decision = j[item.key];
      if (!decision?.sector || !decision?.blurb || !item.perth) continue;
      const cand = work.candidates.find((c) => c.id === item.candidate);
      if (!cand || cand.status === 'published') continue;
      // The engine rejects a company whose pages mention an ordinary trade (a gym, a law firm, plumbers, restaurants): a software company that serves them reads the same.
      // A person who has read the pages and written the decision reopens it.
      if (cand.status === 'rejected') {
        reopenCandidate(work, cand.id, { by: needBy(), at });
        audit.push(trail('candidate.reopen', { type: 'candidate', id: cand.id }, `Reopened ${cand.name}: the engine's rejection read a trade named on its pages, and its own pages were read by a person`));
      }
      if (decision.distinct_from && cand.resolution !== 'NEW_COMPANY') markDistinct(work, cand.id, decision.distinct_from, { by: needBy(), at, note: decision.distinct_note ?? 'a different company with a similar name' });
      approveCandidate(work, cand.id, { by: needBy(), note: `Added from the Perth research list (${SOURCE_ID}) after its own website was read; see docs/perth-import.md.`, at });
      audit.push(trail('candidate.approve', { type: 'candidate', id: cand.id }, `Approved ${cand.name}`));
      const placeEvidence = cand.evidence.find((e) => e.field === 'address' && OWN_PAGES.includes(e.source?.kind) && e.source?.url);
      const location = { city: 'Perth', state: 'WA', precision: 'CITY', source: 'company_website', sourceUrl: item.perth.url ?? placeEvidence?.source?.url ?? cand.website, verifiedAt: placeEvidence?.source?.retrieved_at ?? at };
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
        evidence.push({ field: 'website', value: company.website, confidence: 'medium', verified_at: researchRead, note: `Named on this page (${rowDef?.group.replace(/_/g, ' ')}); the page is not proof of a Perth office.`, source: { kind: /spacecubed|curtin|ventureuwa|biodesign/.test(check.url) ? 'accelerator_profile' : 'directory_listing', url: check.url, title: `${rowDef?.name} | ${new URL(check.url).hostname.replace(/^www\./, '')}`, publisher: new URL(check.url).hostname.replace(/^www\./, ''), retrieved_at: researchRead, note: 'A page the Perth research list cites, read on this day (robots.txt allows it).' } });
      }
      const own = ownFacts().rows[item.key];
      const readAt = own?.read_at ?? researchRead;
      const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };
      for (const a of item.perthAddresses ?? []) {
        const street = a.statement ? null : cleanAddress(a.text);
        if (!street) continue;
        evidence.push({ field: 'address', value: street, confidence: 'high', verified_at: readAt, note: 'An address in Greater Perth on the company\'s own page.', source: { kind: /privacy|terms|legal/i.test(a.url) ? 'company_document' : 'company_website', url: a.url, title: item.name + ': ' + hostOf(a.url), publisher: hostOf(a.url), retrieved_at: readAt, note: 'The company\'s own page, read by the Perth importer (robots.txt obeyed).' } });
      }
      if (item.perth?.statement) evidence.push({ field: 'city', value: 'Perth', confidence: 'medium', verified_at: readAt, note: 'The company\'s own page says it is based in Perth: "' + item.perth.text + '".', source: { kind: 'company_website', url: item.perth.url, title: item.name + ': ' + hostOf(item.perth.url), publisher: hostOf(item.perth.url), retrieved_at: readAt, note: 'The company\'s own page, read by the Perth importer (robots.txt obeyed).' } });
      if (evidence.length) promoteEvidence(work, company.id, evidence);
      audit.push(trail('candidate.publish', { type: 'candidate', id: cand.id }, `Published ${company.name} as ${company.id} (Perth, city-level until its address is placed${item.perth?.kind ? `; its own page calls the place a ${item.perth.kind.toLowerCase()}` : ''})`));
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
      audit.push(trail('candidate.merge', { type: 'candidate', id: cand.id }, `Merged ${cand.id} into ${target.id} (Perth research list)`));
    }
    console.log(`published ${published}; existing companies enriched ${updated}`);
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
        added.push({ field: a.field, value: a.value, confidence: a.confidence, verified_at: ownFacts().rows[company.slug?.replace(/-/g, '')]?.read_at ?? at, note: a.note, source: { kind: 'company_website', url: a.url, title: company.name + ': ' + host, publisher: host, retrieved_at: at, note: "The company's own page, read by the Perth importer (robots.txt obeyed)." } });
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

// ---------- report ----------

async function report() {
  const ds = parseRaw(await loadRaw(dir));
  const items = classify(ds);
  const tally = {};
  for (const i of items) (tally[i.kind] ??= []).push(i);
  const perth = ds.companies.filter((c) => c.city === 'Perth');
  const out = {
    research_rows: rows.length, directory_total: ds.companies.length, perth_companies: perth.length,
    perth_precise_pins: perth.filter((c) => ['EXACT', 'SUBURB'].includes(c.location_precision) && Number.isFinite(c.lat)).length,
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
else if (step === 'report') await report();
else console.log('steps: hubs, sites, ownpages, plan, run, reread, propose, apply, tidy, fixes, report (see the top of this file)');
