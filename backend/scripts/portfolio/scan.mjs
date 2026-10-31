// Reads the portfolio pages in sources.mjs and writes what each names to scans/<source>.json: the company's name, its own website, the page's description,
// the address of the page it came from and the day it was read. Nothing is decided here and no company is changed: import.mjs takes the scans on.
//
//   node scripts/portfolio/scan.mjs [--source blackbird-portfolio] [--refresh] [--limit 20]
//
// A scan that already exists is kept, and only companies it does not have yet are read, so a run can be repeated or resumed. --refresh reads every page
// again, and writes the result only if the listing page was reachable and named companies: a site that is down never empties an earlier scan.
// Every read goes through the discovery engine's fetcher, so robots.txt is obeyed and the pace is polite; a page it refuses is recorded as a problem, not worked around.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFetcher } from '../../src/discovery/http.js';
import { SOURCES } from './sources.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'scans');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); return i < 0 ? null : (args[i + 1]?.startsWith('--') || args[i + 1] == null ? true : args[i + 1]); };
const only = flag('source');
const refresh = flag('refresh') === true;
const limit = Number(flag('limit')) || Infinity;
mkdirSync(OUT, { recursive: true });

const fetcher = createFetcher({ minDelayMs: 1500, timeoutMs: 25000, maxBytes: 6000000 });
const slugOf = (url) => new URL(url).pathname.replace(/\/+$/, '').split('/').pop();
const failure = (e) => `${e.code ?? e.name}: ${String(e.message).slice(0, 120)}`;

async function scan(source) {
  const file = path.join(OUT, `${source.id}.json`);
  const before = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  const now = new Date().toISOString();
  let list;
  try { list = await fetcher.get(source.listUrl); } catch (e) { console.log(`${source.id}: listing not read (${failure(e)}); the earlier scan is kept`); return; }
  const items = source.parseList(list.text, list.finalUrl);
  const seen = new Set();
  const unique = items.filter((i) => { const k = i.profile_url ?? `${i.name}|${i.website}`; if (seen.has(k)) return false; seen.add(k); return true; });
  if (!unique.length) { console.log(`${source.id}: the listing named no companies (its layout may have changed); the earlier scan is kept`); return; }

  const old = new Map((before?.leads ?? []).map((l) => [l.profile_url ?? `${l.name}|${l.website}`, l]));
  const leads = [];
  const problems = [];
  let read = 0;
  for (const item of unique) {
    const key = item.profile_url ?? `${item.name}|${item.website}`;
    const kept = !refresh && old.get(key);
    if (kept) { leads.push(kept); continue; }
    if (read >= limit) continue;
    if (source.mode === 'direct') {
      leads.push({ key: slugOf(item.website) || item.name, name: item.name, website: item.website, description: item.description, profile_url: null, list_url: list.finalUrl, retrieved_at: now });
      continue;
    }
    read += 1;
    try {
      const page = await fetcher.get(item.profile_url);
      const facts = source.parseProfile(page.text, page.finalUrl);
      const name = facts.name || item.list_text;
      if (!name) { problems.push({ profile_url: item.profile_url, reason: 'no name on the page' }); continue; }
      leads.push({ key: slugOf(item.profile_url), name, website: facts.website, description: facts.description, profile_url: page.finalUrl, list_url: list.finalUrl, retrieved_at: now });
      if (!facts.website) problems.push({ profile_url: item.profile_url, name, reason: 'no website found on the page' });
    } catch (e) {
      problems.push({ profile_url: item.profile_url, reason: failure(e) });
    }
    if (read % 20 === 0) console.log(`  ${source.id}: ${read} profiles read, ${leads.length} leads`);
  }
  const result = {
    source_id: source.id, publisher: source.publisher, kind: source.kind, investor: source.investor, list_url: list.finalUrl, retrieved_at: now,
    robots: 'robots.txt read and obeyed by the fetcher before every page', leads, problems,
  };
  writeFileSync(file, `${JSON.stringify(result, null, 1)}\n`);
  console.log(`${source.id}: ${leads.length} companies named, ${leads.filter((l) => l.website).length} with a website, ${problems.length} problem(s) -> scans/${source.id}.json`);
}

for (const source of SOURCES.filter((s) => !only || s.id === only)) await scan(source);
console.log(`requests: ${fetcher.log.requests.length}, refused by policy: ${fetcher.log.refused.length}`);
for (const r of fetcher.log.refused.slice(0, 10)) console.log(`  refused ${r.url}: ${r.code}`);
