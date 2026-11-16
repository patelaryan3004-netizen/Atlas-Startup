// The companies that have no cover picture, and why not, as docs/gallery-missing-covers.csv (what the gallery shows for them is their logo on a neutral tile).
//   node scripts/covers/missing.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRaw, parseRaw } from '../../src/models/dataset.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', '..', '..', 'docs', 'gallery-missing-covers.csv');
const ds = parseRaw(await loadRaw(path.join(HERE, '..', '..', 'src', 'data')));
const results = new Map(JSON.parse(readFileSync(path.join(HERE, 'cover-results.json'), 'utf8')).results.map((r) => [r.company_id, r]));

const REASONS = [
  [/robots_unavailable/, 'its site, or the server holding its preview picture, still would not answer a robots.txt request (a timeout, a 429 or a 5xx, or a 403 from its own site): the picture was left alone'],
  [/robots_disallow/, 'its robots.txt does not allow it'],
  [/^no_image/, 'the page names no preview picture'],
  [/too small/, 'its preview picture is too small to use (under 600x300)'],
  [/not a landscape/, 'its preview picture is not landscape (a logo or an icon)'],
  [/same picture/, 'its preview picture is shared with other companies (a template image)'],
  [/dns_failed/, 'its website did not resolve'],
  [/access_controlled/, 'its website is access-controlled (not worked around)'],
  [/unsupported_content/, 'its preview picture is a format that is not read (svg, gif...)'],
  [/too_large/, 'its preview picture is over the size limit'],
  [/http_error/, 'its website answered with an error'],
  [/timeout/, 'its website timed out'],
  [/noimageindex/, 'its page asks that images not be used (noimageindex)'],
];
const reasonOf = (c) => {
  if (c.cover) return null;
  if (!c.website) return 'no website on file';
  const r = results.get(c.id);
  if (!r) return 'not checked';
  return REASONS.find(([re]) => re.test(String(r.status)))?.[1] ?? String(r.status);
};

const missing = [];
const tally = new Map();
for (const c of ds.companies) {
  const why = reasonOf(c);
  if (!why) continue;
  missing.push([c.name, c.city ?? '', c.website ?? '', why]);
  tally.set(why, (tally.get(why) ?? 0) + 1);
}
missing.sort((a, b) => a[0].localeCompare(b[0]));
const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
writeFileSync(OUT, `${['Company,City,Website,Why it has no cover picture', ...missing.map((m) => m.map(q).join(','))].join('\n')}\n`);
console.log(`${ds.companies.length} companies, ${ds.companies.length - missing.length} with a cover, ${missing.length} without`);
for (const [why, n] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(4)}  ${why}`);
const byCity = {};
for (const c of ds.companies) { const k = c.city || '(none)'; byCity[k] ??= [0, 0]; byCity[k][c.cover ? 0 : 1] += 1; }
console.log(['Melbourne', 'Sydney', 'Perth', 'Brisbane', 'Adelaide'].map((k) => `${k} ${byCity[k]?.[0]}/${(byCity[k]?.[0] ?? 0) + (byCity[k]?.[1] ?? 0)}`).join('  '));
