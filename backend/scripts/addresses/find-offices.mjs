// Finds the street address a company's own website states, for companies known only to their city. READ-ONLY: it reads pages through the project's compliant fetcher (robots.txt obeyed,
// the honest AUStartupMapBot user agent, pacing, no login or access control worked around, LinkedIn and aggregators never) and lists what the pages say, with the words around it, so a person
// reads each one before anything is recorded. It decides nothing: an address a page prints as a postal box, a registered office or another country's office is only a candidate to look at.
//
//   node scripts/addresses/find-offices.mjs --only "OwnHome;Harrison.ai"     the named companies
//   node scripts/addresses/find-offices.mjs --curated                          every company the owner's curated list says to pin that has no point location yet
//   options: --out <json> (default scripts/addresses/office-candidates.json)   --pages n (pages tried per company, default 6)
//            --slice k/n (only every nth company, from the kth: to run several at once; each site is still read at the same pace)
//
// Pages tried: the home page, then the pages it links to on its own site whose address or text says contact, about, locations, offices, visit, legal, terms or privacy, then the usual /contact
// and /about addresses. A candidate is (a) a schema.org address in the page's data (streetAddress with its suburb, state and postcode) or (b) a street address in the page's text that ends
// in an Australian state and postcode.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFetcher, DEFAULT_USER_AGENT, FetchPolicyError } from '../../src/discovery/http.js';
import { createCatalog } from '../../src/catalog/catalog.js';
import { parseAddress } from '../../src/models/location.js';
import { decodeEntities } from '../../src/discovery/html.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i < 0 ? null : (args[i + 1] ?? true); };
const OUT = path.resolve(HERE, typeof flag('--out') === 'string' ? flag('--out') : 'office-candidates.json');
const MAX_PAGES = Number(flag('--pages') ?? 6);

const catalog = createCatalog({ file: path.join(ROOT, 'src', 'data', 'startups.json'), reloadMs: 0 });
await catalog.refresh();
const snap = await catalog.snapshot();

let targets;
if (flag('--curated')) {
  const rows = JSON.parse(readFileSync(path.join(HERE, '..', 'curation', 'curated-list.json'), 'utf8')).rows.filter((r) => r.change === 'Add pin');
  targets = rows.map((r) => snap.records.find((c) => c.name === r.startup)).filter((c, i) => c && !snap.markers[snap.records.indexOf(c)]);
} else {
  const only = String(flag('--only') ?? '').split(';').map((s) => s.trim().toLowerCase()).filter(Boolean);
  targets = snap.records.filter((c) => only.includes(c.name.toLowerCase()));
}

if (typeof flag('--slice') === 'string') { const [k, n] = flag('--slice').split('/').map(Number); targets = targets.filter((_, i) => i % n === k - 1); }

const fetcher = createFetcher({ userAgent: DEFAULT_USER_AGENT, minDelayMs: 1500, maxBytes: 2500000, timeoutMs: 25000 });
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };
const registrable = (h) => (h ? h.split('.').slice(-(/\.(com|net|org|gov|edu|co)\.[a-z]{2}$/.test(h) ? 3 : 2)).join('.') : null);

const STREET = '(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Place|Pl|Drive|Dr|Highway|Hwy|Parade|Pde|Terrace|Tce|Boulevard|Blvd|Way|Court|Ct|Crescent|Cres|Close|Cl|Square|Sq|Circuit|Cct|Esplanade|Esp|Walk|Mews|Row|Arcade|Quay|Wharf|Broadway|Promenade|Link|Rise|Grove|Gr)';
const STATE = '(?:NSW|VIC|QLD|WA|SA|TAS|ACT|NT|New South Wales|Victoria|Queensland|Western Australia|South Australia|Tasmania|Australian Capital Territory|Northern Territory)';
// "Level 4, 123 Example Street, Surry Hills NSW 2010": an optional building/level part, a street number and name and type, then up to ~70 characters of place, then a state and postcode.
const TEXT_ADDRESS = new RegExp(`((?:(?:Level|Floor|Suite|Unit|Shop|Lot|Tower|Building|Bldg|Ground|G)\\s*[\\w/.-]*[,\\s-]*){0,3}\\d+[A-Za-z]?(?:\\s?[-/]\\s?\\d+[A-Za-z]?)?[,\\s]+(?:[A-Z][A-Za-z'’.-]*\\s+){1,4}${STREET}\\b\\.?[^|<>]{0,70}?\\b${STATE}\\b\\.?[,\\s]*\\d{4})`, 'g');

function textOf(html) {
  return decodeEntities(html.replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|li|h\d|address|tr|td)>/gi, ', ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
}
// schema.org addresses: JSON-LD PostalAddress objects (and the microdata streetAddress spans)
function structuredAddresses(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data; try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      const a = node.address && typeof node.address === 'object' ? node.address : node;
      if (a.streetAddress) out.push([a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode].filter(Boolean).join(', ').replace(/\s+/g, ' '));
      Object.values(node).forEach(walk);
    };
    walk(data);
  }
  return out;
}
const LINK_WORDS = /contact|about|locat|office|visit|find-us|findus|where|company|legal|terms|privacy|imprint|team|careers/i;
function linksOf(html, base, ownDomain) {
  const found = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url; try { url = new URL(decodeEntities(m[1]), base); } catch { continue; }
    if (!/^https?:$/.test(url.protocol) || registrable(hostOf(url.href)) !== ownDomain) continue;
    if (/\.(pdf|png|jpe?g|gif|svg|webp|zip|docx?)$/i.test(url.pathname)) continue;
    const label = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (LINK_WORDS.test(url.pathname) || LINK_WORDS.test(label)) found.push(url.href.replace(/[?#].*$/, ''));
  }
  return found;
}

const results = [];
for (const company of targets) {
  const rec = { company: company.name, id: company.id, city: company.city, website: company.website, pages: [], candidates: [], note: '' };
  if (!company.website) { rec.note = 'no website on file'; results.push(rec); console.log(`${company.name}: no website on file`); continue; }
  const own = registrable(hostOf(company.website));
  const queue = [company.website]; const seen = new Set();
  const guessed = ['/contact', '/contact-us', '/about', '/about-us'].map((p) => { try { return new URL(p, company.website).href; } catch { return null; } }).filter(Boolean);
  while (queue.length && rec.pages.length < MAX_PAGES) {
    const url = queue.shift();
    const key = url.replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const page = await fetcher.get(url);
      const html = page.text;
      rec.pages.push({ url: page.finalUrl, status: page.status });
      for (const a of structuredAddresses(html)) rec.candidates.push({ address: a, url: page.finalUrl, how: 'schema.org', context: '' });
      const text = textOf(html);
      for (const m of text.matchAll(TEXT_ADDRESS)) {
        const at = m.index ?? 0;
        rec.candidates.push({ address: m[1].replace(/\s+/g, ' ').trim(), url: page.finalUrl, how: 'text', context: text.slice(Math.max(0, at - 90), at + m[0].length + 40) });
      }
      if (rec.pages.length === 1) {
        for (const l of linksOf(html, page.finalUrl, own)) if (!seen.has(l.replace(/\/$/, ''))) queue.push(l);
        for (const g of guessed) queue.push(g);
      }
    } catch (e) {
      rec.pages.push({ url, status: e instanceof FetchPolicyError ? e.code : String(e.message ?? e).slice(0, 50) });
      if (rec.pages.length === 1 && e instanceof FetchPolicyError && /robots|access/.test(e.code)) { rec.note = `its site could not be read (${e.code})`; break; }
    }
  }
  // each address once, as it is stated, and only those that read as a street address
  const unique = new Map();
  for (const c of rec.candidates) {
    const parsed = parseAddress(c.address);
    if (!parsed.streetLevel) continue;
    const key = c.address.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!unique.has(key)) unique.set(key, { ...c, parsed: { street: parsed.street, suburb: parsed.suburb, state: parsed.state, postcode: parsed.postcode } });
  }
  rec.candidates = [...unique.values()];
  results.push(rec);
  console.log(`${company.name}: ${rec.pages.filter((p) => p.status === 200).length}/${rec.pages.length} pages read, ${rec.candidates.length} address${rec.candidates.length === 1 ? '' : 'es'}${rec.note ? ` (${rec.note})` : ''}`);
  for (const c of rec.candidates.slice(0, 4)) console.log(`   [${c.how}] ${c.address}  <- ${c.url}`);
}
writeFileSync(OUT, `${JSON.stringify({ found_on: new Date().toISOString(), results }, null, 1)}\n`);
console.log(`\nwrote ${OUT}`);
