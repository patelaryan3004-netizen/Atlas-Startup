// Applies perth-address-decisions.json: what the company's own pages say about the addresses on the pasted Perth list, and nothing the pages do not say.
//
//   node scripts/citypack/perth-addresses.mjs plan
//   node scripts/citypack/perth-addresses.mjs apply --by "name"
//
//   postal          an address the company's own page calls postal (or gives as its legal entity's) stops being evidence of where it works (its active rows are superseded) and is kept
//                   as a location of its own: no coordinates, never a pin.
//   add_evidence    an operating address on a company's own page that the earlier read missed becomes address evidence (the page, the day it was read).
//   claims          a pasted claim no page supports is kept as a REJECTED evidence row from a "user supplied" source: it can never be active, so it can never become a pin.
// Safe to run again. No address is invented, completed or chosen by guesswork.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../discovery.js';
import { loadRaw, parseRaw } from '../../src/models/dataset.js';
import { transact } from '../../src/models/store.js';
import { ensureSource, promoteEvidence } from '../../src/discovery/publish.js';
import { makeEvidenceRow } from '../../src/models/evidence.js';
import { sameAddress } from '../../src/models/identity.js';
import { placeOfAddress } from '../../src/geo/metro.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(HERE, '..', '..', 'src', 'data');
const { positional: [step], flags } = parseArgs(process.argv.slice(2));
const D = JSON.parse(readFileSync(path.join(HERE, 'perth-address-decisions.json'), 'utf8'));
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };

function run(work, { write, by, at }) {
  const report = { postal: [], evidence: [], claims: [], skipped: [] };
  const audit = [];
  work.company_locations ??= [];
  const changesOf = (id) => audit.find((a) => a.target.id === id) ?? (audit.push({ actor: { name: by ?? 'plan', role: 'cli' }, via: 'cli', action: 'enrichment.apply', target: { type: 'company', id }, summary: '', changes: [] }), audit.at(-1));
  for (const p of D.postal) {
    const c = work.companies.find((x) => x.id === p.id);
    if (!c) { report.skipped.push(`${p.id}: not in the directory`); continue; }
    const rows = work.evidence.filter((e) => e.company_id === p.id && e.field === 'address' && e.status === 'active' && sameAddress(e.value, p.address));
    const locId = `${p.id}.addr.postal`;
    const have = work.company_locations.some((l) => l.id === locId);
    if (!rows.length && have) { report.skipped.push(`${c.name}: already done`); continue; }
    const place = placeOfAddress(p.address);
    const a = changesOf(p.id);
    for (const e of rows) { if (write) { e.status = 'superseded'; e.note = `${p.why} (Perth address list review, 2026-11-06)`; } a.changes.push({ field: `evidence.${e.id}`, from: 'active', to: 'superseded' }); }
    if (!have) {
      if (write) work.company_locations.push({ id: locId, company_id: p.id, kind: 'OTHER', label: p.label, address: p.address, suburb: null, city: place?.city ?? 'Perth', state: place?.state ?? 'WA', country: 'Australia', postcode: place?.postcode ?? null, latitude: null, longitude: null, location_precision: 'CITY', location_source: p.kind, location_source_url: p.url, location_verified_at: p.read_on, location_confidence: 'low', created_at: at, updated_at: at });
      a.changes.push({ field: 'company_locations', from: null, to: `${p.label}: ${p.address}` });
    }
    a.summary = `${c.name}: ${p.why}; it is kept as a location of its own and is not evidence of where the company works`;
    report.postal.push(`${c.name}: ${p.address} (${rows.length} evidence row(s) superseded)`);
  }
  for (const x of D.add_evidence) {
    const c = work.companies.find((y) => y.id === x.id);
    if (!c) { report.skipped.push(`${x.id}: not in the directory`); continue; }
    if (write) {
      const added = promoteEvidence(work, x.id, [{ field: 'address', value: x.value, confidence: x.confidence, verified_at: x.verified_at, note: x.note, source: { kind: x.kind, url: x.url, title: `${c.name}: ${hostOf(x.url)}`, publisher: hostOf(x.url), retrieved_at: x.verified_at, note: "The company's own page, read by the Perth address review." } }]);
      if (!added.length) { report.skipped.push(`${c.name}: that evidence is already there`); continue; }
    } else if (work.evidence.some((e) => e.company_id === x.id && e.field === 'address' && sameAddress(e.value, x.value))) { report.skipped.push(`${c.name}: that evidence is already there`); continue; }
    const a = changesOf(x.id);
    a.changes.push({ field: 'evidence.address', from: null, to: x.value });
    a.summary = `${c.name}: ${a.summary ? `${a.summary}; ` : ''}an operating address on its own page was added as evidence (${x.value})`;
    report.evidence.push(`${c.name}: ${x.value}`);
  }
  let sourceId = null;
  for (const x of D.claims_not_supported) {
    const c = work.companies.find((y) => y.id === x.id);
    if (!c) { report.skipped.push(`${x.id}: not in the directory`); continue; }
    if (work.evidence.some((e) => e.company_id === x.id && e.field === 'address' && e.status === 'rejected' && e.value === x.value)) { report.skipped.push(`${c.name}: claim "${x.value}" already logged`); continue; }
    if (write) {
      sourceId ??= ensureSource(work, { kind: 'user_supplied', url: null, title: 'Pasted list of Perth company addresses (written by an AI, not checked against any page when it was supplied)', publisher: 'owner (pasted)', retrieved_at: '2026-11-06T00:00:00.000Z', note: '' });
      work.evidence.push(makeEvidenceRow({ company_id: x.id, field: 'address', value: x.value, source_id: sourceId, confidence: 'low', verified_at: null, status: 'rejected', note: `${x.note} (Perth address list review, 2026-11-06)` }, new Set(work.evidence.map((e) => e.id))));
    }
    const a = changesOf(x.id);
    a.changes.push({ field: 'evidence.address', from: null, to: `rejected claim: ${x.value}` });
    a.summary = `${c.name}: ${a.summary ? `${a.summary}; ` : ''}a pasted address no page supports was logged as rejected evidence`;
    report.claims.push(`${c.name}: ${x.value}`);
  }
  return { report, audit: audit.filter((a) => a.changes.length).map((a) => ({ ...a, summary: a.summary || 'Perth address list review' })) };
}

const by = typeof flags.by === 'string' ? flags.by : null;
if (step === 'apply') {
  if (!by) throw new Error('--by "name" is required: every change is recorded with a name');
  let out;
  const { changed } = await transact(dir, async (work, { at }) => { out = run(work, { write: true, by, at }); return { audit: out.audit }; });
  console.log(JSON.stringify({ postal: out.report.postal.length, evidence_added: out.report.evidence.length, claims_logged: out.report.claims.length, skipped: out.report.skipped, wrote: changed }));
  for (const k of ['postal', 'evidence', 'claims']) console.log(`${k}:\n  ${out.report[k].join('\n  ') || '-'}`);
} else {
  const ds = parseRaw(await loadRaw(dir));
  const { report } = run(structuredClone(ds), { write: false, at: new Date().toISOString() });
  console.log(JSON.stringify({ postal: report.postal.length, evidence_to_add: report.evidence.length, claims_to_log: report.claims.length, skipped: report.skipped }));
  for (const k of ['postal', 'evidence', 'claims']) console.log(`${k}:\n  ${report[k].join('\n  ') || '-'}`);
  console.log('(nothing was written)');
}
