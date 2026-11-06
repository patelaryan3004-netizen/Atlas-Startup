// Keeps contact details and undated claims out of the data that is public in the repository.
//
//   node scripts/citypack/hygiene.mjs plan                  DRY RUN: what would be redacted, by collection and field. Writes nothing.
//   node scripts/citypack/hygiene.mjs apply --by "name"      redacts the data collections and dates the pins that rest on a company's own page
//   node scripts/citypack/hygiene.mjs files [--write] [--all]  the working files the commit would add or change (own-pages, proposals, staging, evidence, reviews): dry run, or --write; --all adds the committed ones
//
//   1. Free text that quotes a company's page (a title, an evidence note, a description, a source's note, an alias, a candidate's evidence) can carry an email address or a phone number the page printed.
//      Those are contact details of people or desks, not facts about where a company is, and a number on a page can belong to a person: they become "[email removed]" and "[phone removed]"
//      (src/models/contact.js). Structured fields (an address, a website, an identifier, an id, a date) are never touched. The audit trail is append-only and is never changed (the store refuses it).
//   2. A pin that rests on the company's own page says so only if it has the day the page was read. Where the record has the page (location_source_url) and a source row for it with a retrieved_at,
//      that day is recorded as location_verified_at (never later than the source row says, never invented).
//   3. `files` does the same to the working files that the importers write (own-pages.json, proposals.json ...): the text is kept as a sanitised excerpt, the URLs, dates and structure stay.
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../discovery.js';
import { loadRaw, parseRaw } from '../../src/models/dataset.js';
import { transact } from '../../src/models/store.js';
import { findContacts, redactContacts } from '../../src/models/contact.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.join(HERE, '..', '..');
const dir = path.join(BACKEND, 'src', 'data');
const { positional: [step], flags } = parseArgs(process.argv.slice(2));
// the free-text keys of the data collections; `value` only where the row says its field is a description
const TEXT_KEYS = new Set(['note', 'notes', 'reason', 'summary', 'detail', 'context', 'title', 'description', 'publisher', 'text', 'headline', 'meta']);
const SOURCES_OWN = ['company_website', 'company_document'];
// never redacted, in a working file: a link, a date, a name of a file
const KEEP_KEYS = new Set(['url', 'website', 'final', 'finalUrl', 'domain', 'dataset_url', 'source_url', 'location_source_url', 'id', 'slug', 'key', 'read_at', 'checked_at', 'researched_on', 'retrieved_on']);

const bump = (report, where, kinds) => {
  report.total += 1;
  report.by[where] = (report.by[where] ?? 0) + 1;
  for (const k of kinds) report.kinds[k] = (report.kinds[k] ?? 0) + 1;
};

// a data collection: free-text keys only, `aliases` and `notes` arrays, and a description's value
function redactCollection(name, rows, report, write) {
  const walk = (node, trail) => {
    if (Array.isArray(node)) { node.forEach((x, i) => { if (typeof x === 'string' && (trail.at(-1) === 'aliases' || trail.at(-1) === 'notes')) { const hits = findContacts(x); if (hits.length) { bump(report, `${name}.${trail.at(-1)}[]`, hits.map((h) => h.kind)); if (write) node[i] = redactContacts(x); } } else walk(x, trail); }); return; }
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string') {
        const isText = TEXT_KEYS.has(k) || (k === 'value' && node.field === 'description');
        const hits = isText ? findContacts(v) : [];
        if (hits.length) { bump(report, `${name}.${trail.filter((t) => !/^\d+$/.test(t)).join('.')}${trail.length ? '.' : ''}${k}`.replace(/\.$/, ''), hits.map((h) => h.kind)); report.found.push({ where: `${name}:${node.id ?? node.company_id ?? ''}`, key: k, kinds: hits.map((h) => `${h.kind}:${h.text.trim()}`) }); if (write) node[k] = redactContacts(v); }
      } else if (v && typeof v === 'object') walk(v, [...trail, k]);
    }
  };
  for (const row of rows) walk(row, []);
}

function run(work, { write }) {
  const report = { total: 0, by: {}, kinds: {}, found: [], dated: [] };
  for (const [collection, rows] of Object.entries(work)) {
    if (!Array.isArray(rows) || collection === 'audit_trail' || collection === 'geocode_cache') continue; // the audit trail is append-only; the cache holds addresses
    redactCollection(collection, rows, report, write);
  }
  const sources = new Map(work.sources.map((s) => [s.url, s]));
  for (const c of work.companies) {
    if (!Number.isFinite(c.lat) || c.location_verified_at || !SOURCES_OWN.includes(c.location_source) || !c.location_source_url) continue;
    const read = sources.get(c.location_source_url)?.retrieved_at ?? null;
    if (!read) continue;
    if (write) c.location_verified_at = read;
    report.dated.push(`${c.name}: ${String(read).slice(0, 10)}`);
  }
  return report;
}

// the working files
// the working files the commit would add or change (git's own dry run: nothing is staged); --all also looks at the ones already committed and unchanged
const WORKING = () => {
  if (flags.all !== true) {
    const root = path.join(BACKEND, '..');
    return execFileSync('git', ['-C', root, 'add', '-n', '-A', '--', 'backend/scripts'], { encoding: 'utf8' }).split('\n').map((l) => /^add '(.+)'$/.exec(l)?.[1]).filter((x) => x && x.endsWith('.json')).map((x) => path.join(root, x));
  }
  const out = [];
  for (const d of readdirSync(path.join(BACKEND, 'scripts'))) {
    const p = path.join(BACKEND, 'scripts', d);
    if (!statSync(p).isDirectory()) continue;
    const walkDir = (x) => { for (const e of readdirSync(x, { withFileTypes: true })) { const q = path.join(x, e.name); if (e.isDirectory()) walkDir(q); else if (e.name.endsWith('.json')) out.push(q); } };
    walkDir(p);
  }
  return out;
};
function redactFile(file, write) {
  const text = readFileSync(file, 'utf8');
  if (!findContacts(text).length) return null;
  let json; try { json = JSON.parse(text); } catch { return null; }
  const hits = [];
  const walk = (node, key) => {
    if (typeof node === 'string') { if (KEEP_KEYS.has(key)) return node; const f = findContacts(node); if (f.length) { hits.push(...f.map((x) => x.kind)); return redactContacts(node); } return node; }
    if (Array.isArray(node)) return node.map((x) => walk(x, key));
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v, k)]));
    return node;
  };
  const next = walk(json, '');
  const indent = /^\{\r?\n( +)"/.exec(text)?.[1].length ?? /^\[\r?\n( +)[\{"]/.exec(text)?.[1].length ?? 1;
  if (write) writeFileSync(file, `${JSON.stringify(next, null, indent)}${text.endsWith('\n') ? '\n' : ''}`);
  return { file: path.relative(BACKEND, file).replace(/\\/g, '/'), n: hits.length, kinds: [...new Set(hits)] };
}

const by = typeof flags.by === 'string' ? flags.by : null;
if (step === 'apply') {
  if (!by) throw new Error('--by "name" is required: every change is recorded with a name');
  let report;
  const { changed } = await transact(dir, async (work, { at }) => {
    report = run(work, { write: true });
    if (report.dated.length) for (const c of work.companies) if (c.location_verified_at && report.dated.some((d) => d.startsWith(`${c.name}:`))) c.updated_at = at;
    return { audit: [{ actor: { name: by, role: 'cli' }, via: 'cli', action: 'enrichment.apply', target: { type: 'system', id: 'hygiene' }, summary: `Contact details quoted from pages were removed from ${report.total} free-text fields (${Object.entries(report.kinds).map(([k, n]) => `${n} ${k}`).join(', ') || 'none'}); ${report.dated.length} pins that rest on a company's own page were given the day the page was read` }] };
  });
  console.log(JSON.stringify({ redacted: report.total, by_field: report.by, kinds: report.kinds, dated: report.dated.length, wrote: changed }));
} else if (step === 'files') {
  const write = flags.write === true;
  const rows = WORKING().map((f) => redactFile(f, write)).filter(Boolean);
  console.log(JSON.stringify({ files_with_contact_details: rows.length, strings_redacted: rows.reduce((n, r) => n + r.n, 0), written: write, files: rows }, null, 1));
  if (!write) console.log('(nothing was written)');
} else {
  const ds = parseRaw(await loadRaw(dir));
  const report = run(structuredClone(ds), { write: false });
  console.log(JSON.stringify({ would_redact: report.total, by_field: report.by, kinds: report.kinds, would_date: report.dated.length }, null, 1));
  for (const f of report.found) console.log(`  ${f.where} .${f.key}: ${f.kinds.join(' ; ')}`);
  console.log('(nothing was written)');
}
