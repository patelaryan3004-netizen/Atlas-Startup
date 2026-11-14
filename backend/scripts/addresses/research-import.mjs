// Brings a researched list of company addresses (a CSV someone else compiled, with a source page per address) into the directory, by the project's own rules:
// the list is a LEAD, not a source. An address is stored only where a page it cites actually states it, and nothing is placed on the map by this script.
//
//   node scripts/addresses/research-import.mjs verify [--only "Company"] [--limit n]   read each cited page (the compliant fetcher: robots.txt, pacing, no LinkedIn) and write research-results.json
//   node scripts/addresses/research-import.mjs plan                                      what apply would do, from research-results.json; writes nothing
//   node scripts/addresses/research-import.mjs apply --by "name"                         write it (recorded in the audit trail under that name)
//
// What apply does, per researched company, and ONLY when a cited page states the address:
//   "Office / facility supported"   -> active address evidence from that page. It becomes a pin only through the location system's own steps
//                                      (`npm run locations -- geocode`, then `promote`), which need the geocoder to find the building.
//   any other kind of address       -> a location of its own (postal, registered, historical, an office the research could not confirm): no coordinates, never a pin.
//   an address no cited page we could read states (or none we could read at all) -> not stored; listed in the report for a person.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './csv.mjs';
import { createFetcher, FetchPolicyError, DEFAULT_USER_AGENT, blockedReason } from '../../src/discovery/http.js';
import { nameKey, looseNameKey, registrableDomain, canonicalDomain, addressParts, sameAddress } from '../../src/models/identity.js';
import { loadRaw, parseRaw } from '../../src/models/dataset.js';
import { transact } from '../../src/models/store.js';
import { promoteEvidence } from '../../src/discovery/publish.js';
import { locationSourceFor } from '../../src/models/location.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(HERE, '..', '..', 'src', 'data');
const [, , step, ...rest] = process.argv;
const flag = (name) => { const i = rest.indexOf(name); return i < 0 ? null : (rest[i + 1] ?? true); };
// Another list can be run the same way: --input <csv in the same columns> --results <json> (and --max-urls n pages tried per company). The defaults are the 150-company list.
const INPUT = path.resolve(HERE, typeof flag('--input') === 'string' ? flag('--input') : path.join('input', 'company-addresses-150.csv'));
const RESULTS = path.resolve(HERE, typeof flag('--results') === 'string' ? flag('--results') : 'research-results.json');
const MAX_URLS = Number(flag('--max-urls') ?? 4);

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };
const NOT_OFFICE_LABELS = {
  'Legal / registered / correspondence address': 'Registered / mailing address on its page',
  'Street address; office unconfirmed': 'Address on its page (office not confirmed)',
  'Postal contact only': 'Postal address on its page',
  'Conflicting public addresses': 'Address on its page (listings conflict)',
  'Street without building number': 'Street only, no building number',
  'Historical address only': 'Historical address',
};

// ---------- reading the page for the address

const WORDS = { st: 'street', rd: 'road', ave: 'avenue', av: 'avenue', hwy: 'highway', pde: 'parade', ln: 'lane', cres: 'crescent', ct: 'court', pl: 'place', dr: 'drive', blvd: 'boulevard', tce: 'terrace', cl: 'close', sq: 'square', esp: 'esplanade' };
const decode = (s) => s.replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/gi, "'").replace(/&ndash;|&#8211;|&mdash;|&#8212;/gi, '-').replace(/&quot;/gi, '"').replace(/&#x2F;/gi, '/');
export function norm(text) {
  return decode(String(text ?? '')).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[a-z0-9]/g, (m) => m).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').map((w) => WORDS[w] ?? w).join(' ');
}
// The street part of an address, as words ("10 20 gwynne street"): what a page must show for the address to be there.
export const streetKey = (address) => { const s = addressParts(address)?.street; return s ? norm(s) : null; };
const strip = (html) => html.replace(/<(script|style|noscript)\b(?![^>]*ld\+json)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
export function pageStates(html, address) {
  const key = streetKey(address);
  if (!key) return null; // the address gives no street to look for
  const text = ` ${norm(strip(html))} `;
  const raw = ` ${norm(html)} `; // also anything inside a script (structured data)
  return text.includes(` ${key} `) || raw.includes(` ${key} `);
}

// ---------- matching a researched name to a directory record

function matcher(ds) {
  const byKey = new Map();
  const byDomain = new Map();
  for (const c of ds.companies) {
    for (const k of [nameKey(c.name), looseNameKey(c.name)]) if (k) (byKey.get(k) ?? byKey.set(k, new Set()).get(k)).add(c);
    const d = canonicalDomain(c.website)?.domain;
    if (d) (byDomain.get(d) ?? byDomain.set(d, new Set()).get(d)).add(c);
  }
  return (row) => {
    const hits = new Set([...(byKey.get(nameKey(row.Company)) ?? []), ...(byKey.get(looseNameKey(row.Company)) ?? [])]);
    if (hits.size === 1) return { company: [...hits][0] };
    const d = canonicalDomain(row['Company website'])?.domain;
    const viaSite = d ? byDomain.get(d) : null;
    if (viaSite?.size === 1 && (hits.size === 0 || [...hits].some((h) => viaSite.has(h)))) return { company: [...viaSite][0] };
    if (hits.size > 1) return { problem: `matches ${[...hits].map((h) => h.id).join(', ')}` };
    return { problem: 'not in the directory' };
  };
}

const urlsOf = (row) => [...new Set([row['Source URL'], row['Second source URL'], ...(row['More sources'] ?? '').split(/[\s;]+/)].map((u) => (u ?? '').trim()).filter((u) => /^https?:\/\//i.test(u)))];

// ---------- verify

async function verify() {
  const ds = parseRaw(await loadRaw(dir));
  const match = matcher(ds);
  const only = flag('--only');
  const limit = Number(flag('--limit') ?? Infinity);
  const rows = parseCsv(readFileSync(INPUT, 'utf8')).filter((r) => !only || r.Company === only).slice(0, limit);
  const fetcher = createFetcher({ userAgent: DEFAULT_USER_AGENT, minDelayMs: 1500, maxBytes: 3000000, timeoutMs: 20000 });
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      const row = rows[next]; next += 1;
      const m = match(row);
      const out = { company: row.Company, company_id: m.company?.id ?? null, problem: m.problem ?? null, category: row['Research result'], type: row['Address type'], address: row['Public address'], locality: row.Locality, state: row.State, postcode: row.Postcode, country: row.Country, checks: [], verdict: null, corroborated_by: null, notes: row.Notes };
      if (!row['Public address']) { out.verdict = 'no_address'; results.push(out); continue; }
      if (!streetKey(row['Public address'])) { out.verdict = 'no_street'; results.push(out); continue; }
      const own = registrableDomain(hostOf(row['Company website'] || m.company?.website || '') ?? '');
      for (const url of urlsOf(row).slice(0, MAX_URLS)) {
        const host = hostOf(url);
        const check = { url, host, own_site: !!own && registrableDomain(host ?? '') === own, outcome: null };
        if (/\.pdf(\?|#|$)/i.test(url)) check.outcome = 'unreadable: a PDF (the checker reads web pages)';
        else if (host && blockedReason(host)) check.outcome = `unreadable: ${blockedReason(host)}`;
        else {
          try {
            const res = await fetcher.get(url);
            if (res.status >= 400) check.outcome = `unreadable: HTTP ${res.status}`;
            else check.outcome = pageStates(res.text, row['Public address']) ? 'states the address' : 'read, address not on the page';
            check.final_url = res.finalUrl;
          } catch (e) { check.outcome = `unreadable: ${e instanceof FetchPolicyError ? e.code : String(e.message ?? e).slice(0, 80)}`; }
        }
        out.checks.push(check);
        if (check.outcome === 'states the address') { out.verdict = 'corroborated'; out.corroborated_by = check; break; }
      }
      if (!out.verdict) out.verdict = out.checks.some((c) => c.outcome === 'read, address not on the page') ? 'not_on_page' : 'unreadable';
      out.retrieved_at = new Date().toISOString();
      results.push(out);
      process.stderr.write(`${results.length}/${rows.length} ${out.company}: ${out.verdict}\n`);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  results.sort((a, b) => rows.findIndex((r) => r.Company === a.company) - rows.findIndex((r) => r.Company === b.company));
  writeFileSync(RESULTS, `${JSON.stringify({ researched_on: '2026-11-15', checked_at: new Date().toISOString(), results }, null, 1)}\n`);
  const tally = results.reduce((m, r) => { m[r.verdict] = (m[r.verdict] ?? 0) + 1; return m; }, {});
  console.log(JSON.stringify(tally));
}

// ---------- plan / apply

function run(work, { write, by, at }) {
  const R = JSON.parse(readFileSync(RESULTS, 'utf8'));
  const report = { evidence: [], other: [], held: [], skipped: [], unmatched: [], none: [] };
  const audit = [];
  work.company_locations ??= [];
  const changesOf = (c) => audit.find((a) => a.target.id === c.id) ?? (audit.push({ actor: { name: by ?? 'plan', role: 'cli' }, via: 'cli', action: 'enrichment.apply', target: { type: 'company', id: c.id }, summary: '', changes: [] }), audit.at(-1));
  for (const r of R.results) {
    if (r.problem) { report.unmatched.push(`${r.company}: ${r.problem}`); continue; }
    const c = work.companies.find((x) => x.id === r.company_id);
    if (!c) { report.unmatched.push(`${r.company}: not in the directory`); continue; }
    if (['no_address', 'no_street'].includes(r.verdict)) { report.none.push(`${c.name}: ${r.verdict === 'no_address' ? 'no public street address found by the research' : 'no street in the address'}`); continue; }
    if (r.verdict !== 'corroborated') { report.held.push(`${c.name}: "${r.address}" — ${r.verdict === 'not_on_page' ? 'the cited page(s) were read and do not show it' : 'none of the cited pages could be read by the checker'}`); continue; }
    const b = r.corroborated_by;
    const kind = b.own_site ? 'company_website' : 'directory_listing';
    const a = changesOf(c);
    if (r.category === 'Office / facility supported' && r.country === 'Australia') {
      const row = { field: 'address', value: r.address, confidence: b.own_site ? 'high' : 'medium', verified_at: r.retrieved_at, note: `A researched address (${r.type}); the page states it. Researched ${R.researched_on}.`, source: { kind, url: b.final_url ?? b.url, title: `${c.name}: ${b.host}`, publisher: b.host, retrieved_at: r.retrieved_at } };
      if (write) { if (!promoteEvidence(work, c.id, [row]).length) { report.skipped.push(`${c.name}: that evidence is already there`); continue; } }
      else if (work.evidence.some((e) => e.company_id === c.id && e.field === 'address' && sameAddress(e.value, r.address) && e.status === 'active')) { report.skipped.push(`${c.name}: that address is already evidence`); continue; }
      a.changes.push({ field: 'evidence.address', from: null, to: r.address });
      a.summary = `${c.name}: an address its ${b.own_site ? 'own website' : 'cited page'} states was added as evidence (${r.address})`;
      report.evidence.push(`${c.name}: ${r.address} [${kind}: ${b.host}]`);
    } else {
      const label = NOT_OFFICE_LABELS[r.category] ?? `Address on its page (${r.category})`;
      const locId = `${c.id}.addr.research`;
      if (work.company_locations.some((l) => l.company_id === c.id && l.kind === 'OTHER' && sameAddress(l.address ?? '', r.address))) { report.skipped.push(`${c.name}: that address is already a location of its own`); continue; }
      if (write) work.company_locations.push({ id: work.company_locations.some((l) => l.id === locId) ? `${locId}.${work.company_locations.length}` : locId, company_id: c.id, kind: 'OTHER', label: `${label}${r.type && !label.includes(r.type) ? ` (${r.type})` : ''}`.slice(0, 120), address: r.address, suburb: null, city: r.locality || c.city, state: r.state || c.state, country: r.country || 'Australia', postcode: r.postcode || null, latitude: null, longitude: null, location_precision: 'CITY', location_source: locationSourceFor(kind), location_source_url: b.final_url ?? b.url, location_verified_at: r.retrieved_at, location_confidence: 'low', created_at: at, updated_at: at });
      a.changes.push({ field: 'company_locations', from: null, to: `${label}: ${r.address}` });
      a.summary = `${c.name}: ${a.summary ? `${a.summary}; ` : ''}an address its page states (${r.category.toLowerCase()}) was kept as a location of its own; it is not a pin`;
      report.other.push(`${c.name}: ${r.address} [${label}]`);
    }
  }
  return { report, audit: audit.filter((a) => a.changes.length).map((a) => ({ ...a, summary: a.summary || 'Researched address list' })) };
}

if (step === 'verify') await verify();
else if (step === 'apply' || step === 'plan') {
  const by = flag('--by');
  if (step === 'apply') {
    if (typeof by !== 'string') throw new Error('--by "name" is required: every change is recorded with a name');
    let out;
    const { changed } = await transact(dir, async (work, { at }) => { out = run(work, { write: true, by, at }); return { audit: out.audit }; });
    console.log(JSON.stringify({ evidence_added: out.report.evidence.length, other_locations: out.report.other.length, held: out.report.held.length, unmatched: out.report.unmatched.length, none: out.report.none.length, skipped: out.report.skipped.length, wrote: changed }));
    for (const k of Object.keys(out.report)) console.log(`${k}:\n  ${out.report[k].join('\n  ') || '-'}`);
  } else {
    const ds = parseRaw(await loadRaw(dir));
    const { report } = run(structuredClone(ds), { write: false, at: new Date().toISOString() });
    console.log(JSON.stringify(Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.length]))));
    for (const k of Object.keys(report)) console.log(`${k}:\n  ${report[k].join('\n  ') || '-'}`);
    console.log('(nothing was written)');
  }
} else console.log('Steps: verify, plan, apply. See the top of this file.');
