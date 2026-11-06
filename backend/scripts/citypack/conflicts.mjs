// Settles what can be settled among the companies whose own pages gave more than one address (or an address in another city), without choosing an address the pages do not support.
//
//   node scripts/citypack/conflicts.mjs plan  [--data dir]        DRY RUN: what each company's evidence says and what would change. Writes nothing.
//   node scripts/citypack/conflicts.mjs apply --by "name" [--data dir]
//
// The rules, in this order, for each company in conflict-cases.json (the target city is the one the record is listed under):
//   1. An address that is a placeholder ("Example Street"), two addresses run together by the page scanner, or not Australian is junk: superseded.
//   2. An address in another city is that company's office there, not where it works here: it becomes a location of its own (company_locations, no coordinates) and the
//      evidence row is superseded, so it can no longer stand between the company and its pin here.
//   3. Several rows for the same street address (spelling, a unit number, "La Trobe" and "Latrobe") are one address: the strongest page's row stays.
//   4. Where the same city has different addresses: the page that is meant to say where the company is (its contact page) outranks a page about something else (home, about,
//      team), and that outranks a legal page (privacy policy, terms: a registered or legal-entity address). Only a single strongest address wins. Two addresses on equally strong
//      pages are NOT resolved: the company stays at city level with both on record, for a person.
// An address is never invented, completed or chosen by guesswork. The pin itself still has to pass `locations geocode` and `promote`.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../discovery.js';
import { loadRaw, parseRaw } from '../../src/models/dataset.js';
import { transact } from '../../src/models/store.js';
import { metroOf, placeOfAddress } from '../../src/geo/metro.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.join(HERE, '..', '..');
const { positional: [step], flags } = parseArgs(process.argv.slice(2));
const dir = path.resolve(typeof flags.data === 'string' ? flags.data : path.join(BACKEND, 'src', 'data'));
const { cases, hold: HOLD = {}, location_fixes: FIXES, location_adds: ADDS = [] } = JSON.parse(readFileSync(path.join(HERE, 'conflict-cases.json'), 'utf8'));

const STREET = 'Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Terrace|Tce|Highway|Hwy|Way|Place|Pl|Court|Ct|Lane|Ln|Boulevard|Blvd|Parade|Pde|Crescent|Cres|Esplanade|Circuit|Cct|Close|Square|Sq';
// the street of an address, reduced to what stays the same when the spelling does not: "Level 5, 485 La Trobe Street" and "Level 5, 485 Latrobe St" are one
const keyOf = (value) => {
  const text = String(value).replace(/\b(?:Level|Lvl|Suite|Unit|Shop|Lot|Floor)\s*[\d/A-Za-z-]+[,\s]*/gi, ' ');
  const m = new RegExp(String.raw`(\d+)[A-Za-z]?(?:\s*[-–]\s*\d+[A-Za-z]?)?\s+([A-Za-z'’. -]+?)\s+(?:${STREET})\b`, 'i').exec(text);
  const state = placeOfAddress(value)?.state ?? '';
  return m ? `${m[1]}|${m[2].toLowerCase().replace(/[^a-z]/g, '').replace(/s$/, '')}|${state}` : `raw|${text.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
};
const strengthOf = (url, kind) => {
  const p = (() => { try { return new URL(url).pathname; } catch { return ''; } })();
  if (/privacy|terms|legal|polic|conditions|investor|disclaim|security|complian|agreement/i.test(p) || kind === 'company_document') return 0; // a legal page
  if (/contact|location|office|find-us|visit|get-in-touch|reach-us/i.test(p)) return 2;                                                        // meant to say where it is
  return 1;                                                                                                                                      // the home page, about, team
};
const STRENGTH_WORD = ['a legal page (privacy policy or terms: a registered or legal-entity address)', 'a page about something else (home, about, team)', 'its contact page'];
const junk = (v) => {
  if (/\bexample\b|lorem|\btbd\b|your street|123 fake/i.test(v)) return 'a placeholder, not an address';
  if ((String(v).match(/\b(?:VIC|NSW|QLD|SA|WA|TAS|NT|ACT)\b,?\s*\d{4}/g) ?? []).length > 1) return 'two addresses run together by the page scanner';
  if (/\b[A-Z]{2}\s+\d{5}\b/.test(v)) return 'not an Australian address';
  return null;
};
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };

async function plan(write) {
  const by = typeof flags.by === 'string' ? flags.by : null;
  if (write && !by) throw new Error('--by "name" is required: every change is recorded with a name');
  const report = { superseded: [], moved: [], settled: [], unresolved: [], fixed_locations: [], untouched: [] };
  const run = async (work, { at } = {}) => {
    const audit = [];
    work.company_locations ??= [];
    const sourceOf = new Map(work.sources.map((s) => [s.id, s]));
    for (const name of cases) {
      const c = work.companies.find((x) => x.name === name);
      if (!c) { report.unresolved.push(`${name}: not in the directory`); continue; }
      const city = metroOf(c) ?? c.city;
      const rows = work.evidence.filter((e) => e.company_id === c.id && e.field === 'address' && e.status === 'active').map((e) => {
        const s = sourceOf.get(e.source_id);
        return { e, url: s?.url ?? '', strength: strengthOf(s?.url ?? '', s?.kind), place: placeOfAddress(e.value) };
      });
      const changes = [];
      const drop = (row, why) => { if (write) { row.e.status = 'superseded'; row.e.note = `${why} (settled on review, 2026-11-05)`; } changes.push({ field: `evidence.${row.e.id}`, from: 'active', to: 'superseded' }); report.superseded.push(`${c.name}: ${row.e.value} (${why})`); };
      let left = rows.filter((r) => { const j = junk(r.e.value); if (j) { drop(r, j); return false; } return true; });
      // 2. another city
      left = left.filter((r) => {
        const sameState = !r.place?.state || !c.state || r.place.state === c.state;
        if (r.place && sameState && (r.place.city === city || r.place.city == null)) return true; // the same city, or a place in the same state that is none of the ten cities: it competes below
        const label = r.place?.city ? `${r.place.city} ${r.strength === 0 ? 'address' : 'office'}` : 'Address elsewhere';
        const id = `${c.id}.office.${(r.place?.city ?? r.place?.state ?? 'elsewhere').toLowerCase().replace(/ /g, '-')}`;
        const known = work.company_locations.some((l) => l.company_id === c.id && l.address && keyOf(l.address) === keyOf(r.e.value));
        if (!known && !work.company_locations.some((l) => l.id === id)) {
          if (write) work.company_locations.push({ id, company_id: c.id, kind: r.strength === 0 || !r.place?.city ? 'OTHER' : 'OFFICE', label, address: r.e.value, suburb: null, city: r.place?.city ?? null, state: r.place?.state ?? null, country: 'Australia', postcode: r.place?.postcode ?? null, latitude: null, longitude: null, location_precision: r.place?.city ? 'CITY' : 'STATE', location_source: r.strength === 0 ? 'company_document' : 'company_website', location_source_url: r.url || null, location_verified_at: r.e.verified_at ?? null, location_confidence: 'low', created_at: at, updated_at: at });
          changes.push({ field: 'company_locations', from: null, to: `${label}: ${r.e.value}` });
        }
        drop(r, `its address in ${r.place?.city ?? 'another place'}, kept as a location of its own, not where it works in ${city}`);
        report.moved.push(`${c.name}: ${r.e.value} -> ${label}`);
        return false;
      });
      // 3 + 4. the same city
      const groups = new Map();
      for (const r of left) (groups.get(keyOf(r.e.value)) ?? groups.set(keyOf(r.e.value), []).get(keyOf(r.e.value))).push(r);
      const held = HOLD[c.name];
      const pagesWord = (n) => `${n} page${n === 1 ? '' : 's'}`;
      if (groups.size === 0) { report.untouched.push(`${c.name}: no address in ${city} on record (stays at city level)`); }
      else {
        const ranked = [...groups.values()].map((g) => ({ g, max: Math.max(...g.map((r) => r.strength)), pages: new Set(g.map((r) => r.url.split('#')[0])).size }));
        // W beats O when: O is only on legal pages and W is on a page that says where the company is; or W is at least as strong AND has more pages that agree
        // two addresses on the SAME page are two sites of one company (a contact page that lists its offices), not a disagreement between pages: neither beats the other
        const urlsOf = (x) => new Set(x.g.map((r) => r.url.split("#")[0]));
        const sharePage = (w, o) => [...urlsOf(w)].some((u) => urlsOf(o).has(u));
        const beats = (w, o) => !sharePage(w, o) && ((o.max === 0 && w.max >= 1) || (w.max >= o.max && w.pages > o.pages) || (w.max === 0 && o.max === 0 && w.pages > o.pages));
        const winner = ranked.find((w) => ranked.every((o) => o === w || beats(w, o)));
        if (held) report.unresolved.push(`${c.name}: held for a person (${held})`);
        else if (winner) {
          const keep = [...winner.g].sort((a, b) => b.strength - a.strength)[0];
          for (const r of left) if (r !== keep) drop(r, keyOf(r.e.value) === keyOf(keep.e.value) ? 'the same address as the row kept, spelt differently or from another page' : `a different address on ${STRENGTH_WORD[r.strength]}, against the address on ${STRENGTH_WORD[keep.strength]} (${pagesWord(winner.pages)}) that is used`);
          report.settled.push(`${c.name}: ${keep.e.value} (${STRENGTH_WORD[keep.strength]}${hostOf(keep.url) ? `, ${hostOf(keep.url)}` : ''}; ${pagesWord(winner.pages)})${groups.size > 1 ? ' over ' + ranked.filter((x) => x !== winner).map((x) => '"' + x.g[0].e.value + '"').join(', ') : ''}`);
        } else {
          report.unresolved.push(`${c.name}: ${ranked.map((x) => `"${x.g[0].e.value}" (${STRENGTH_WORD[x.max]}, ${pagesWord(x.pages)})`).join(' vs ')}`);
        }
      }
      if (write && changes.length) { c.updated_at = at; audit.push({ actor: { name: by, role: 'cli' }, via: 'cli', action: 'enrichment.apply', target: { type: 'company', id: c.id }, summary: `${c.name}: its own pages gave more than one address; settled by rule (see conflicts.mjs): ${changes.length} change(s)`, changes }); }
    }
    // location rows that were labelled with the wrong city by the page's own layout (the label belongs to the neighbouring address): relabelled from the address itself
    for (const f of FIXES) {
      const l = work.company_locations.find((x) => x.id === f.id);
      if (!l) continue;
      if (f.delete) { if (write) work.company_locations.splice(work.company_locations.indexOf(l), 1); report.fixed_locations.push(`${f.id}: removed (${f.why})`); }
      else {
        if (write) {
          if (f.new_id && !work.company_locations.some((x) => x.id === f.new_id)) l.id = f.new_id;
          if (f.label) l.label = f.label;
          if (f.kind) l.kind = f.kind;
          if (f.address) l.address = f.address;
          if (f.city) { l.city = f.city; l.state = f.state; l.postcode = f.postcode ?? l.postcode; }
          if (f.suburb !== undefined) l.suburb = f.suburb;
          l.updated_at = at;
        }
        report.fixed_locations.push(`${f.id}: ${f.label ?? ''} ${f.address ?? ''} (${f.why})`);
      }
      if (write) audit.push({ actor: { name: by, role: 'cli' }, via: 'cli', action: 'enrichment.apply', target: { type: 'company', id: l.company_id }, summary: `A location row was corrected: ${f.why}`, changes: [{ field: 'company_locations', from: f.id, to: f.delete ? null : (f.new_id ?? f.id) }] });
    }
    for (const f of ADDS) {
      if (work.company_locations.some((l) => l.id === f.id)) continue;
      if (write) work.company_locations.push({ ...f.row, id: f.id, country: 'Australia', latitude: null, longitude: null, location_precision: 'CITY', location_confidence: 'low', created_at: at, updated_at: at });
      report.fixed_locations.push(`${f.id}: added (${f.why})`);
    }
    return { audit };
  };
  if (write) { const { changed } = await transact(dir, run); report.wrote = changed; }
  else { const ds = parseRaw(await loadRaw(dir)); await run(structuredClone(ds), { at: new Date().toISOString() }); }
  return report;
}

const report = await plan(step === 'apply');
for (const [k, v] of Object.entries(report)) console.log(`\n${k} (${Array.isArray(v) ? v.length : v}):${Array.isArray(v) ? '\n  ' + v.join('\n  ') : ''}`);
if (step !== 'apply') console.log('\n(nothing was written)');
