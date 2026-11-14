// Turns a pasted table of company addresses that has NO source pages (a lead from a list, not research with citations) into the CSV that research-import.mjs reads: for each claim, the
// pages where the company itself would state it (its home page and the usual contact, about, locations, privacy and terms pages) plus the pages already cited for it in the data.
// A claim the directory already holds (as evidence or a location of its own) is left out. Nothing is stored here; `research-import.mjs verify --input ... --results ...` reads the pages.
//   node scripts/addresses/build-claims-csv.mjs <claims.json> <out.csv>      claims.json: [{ "company": "...", "address": "...", "type": "...", "note": "..." }]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRaw, parseRaw } from '../../src/models/dataset.js';
import { nameKey, looseNameKey, sameAddress } from '../../src/models/identity.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [, , claimsFile, outFile] = process.argv;
const claims = JSON.parse(readFileSync(path.resolve(claimsFile), 'utf8'));
const ds = parseRaw(await loadRaw(path.join(HERE, '..', '..', 'src', 'data')));
const PATHS = ['', 'contact', 'contact-us', 'about', 'about-us', 'locations', 'offices', 'privacy', 'privacy-policy', 'terms', 'terms-and-conditions'];
const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
const header = ['Company', 'Public address', 'Address type', 'Research result', 'Address availability', 'Locality', 'State', 'Postcode', 'Country', 'Map action', 'Source URL', 'Second source URL', 'More sources', 'Notes', 'Alternative public addresses', 'Research date', 'Company website', 'List order'];
const rows = [header.join(',')];
const left = [];
let order = 0;
for (const c of claims) {
  const co = ds.companies.find((x) => nameKey(x.name) === nameKey(c.company) || looseNameKey(x.name) === looseNameKey(c.company));
  if (!co) { left.push(`${c.company}: not in the directory`); continue; }
  const held = [
    ...ds.evidence.filter((e) => e.company_id === co.id && e.field === 'address').map((e) => e.value),
    ...ds.company_locations.filter((l) => l.company_id === co.id).map((l) => l.address),
    co.address,
  ].filter(Boolean);
  if (held.some((a) => sameAddress(a, c.address))) { left.push(`${co.name}: "${c.address}" is already on file`); continue; }
  const site = (() => { try { return new URL(co.website).origin; } catch { return null; } })();
  const cited = ds.evidence.filter((e) => e.company_id === co.id && e.field === 'address').map((e) => ds.sources.find((s) => s.id === e.source_id)?.url).filter((u) => u && /^https?:/.test(u));
  const urls = [...new Set([...cited, ...(site ? PATHS.map((p) => `${site}/${p}`.replace(/\/$/, p ? '' : '/')) : [])])];
  const m = /([A-Z]{2,3})\s+(\d{4})\b/.exec(c.address) ?? [];
  const [a, b, ...more] = urls;
  order += 1;
  rows.push([q(co.name), q(c.address), q(c.type ?? 'pasted address'), q('Street address; office unconfirmed'), q('Street address'), q(''), q(m[1] ?? ''), q(m[2] ?? ''), q('Australia'), q(''), q(a), q(b), q(more.join(' ')), q(c.note ?? ''), q(''), q('2026-11-15'), q(co.website ?? ''), order].join(','));
}
writeFileSync(path.resolve(outFile), `${rows.join('\n')}\n`);
console.log(`${order} claim(s) to check; left out:\n  ${left.join('\n  ') || '-'}`);
