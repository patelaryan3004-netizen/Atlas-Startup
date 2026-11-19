// What the office search found for each company the curated list says to pin: docs/curated-map-address-search.csv.
//   node scripts/addresses/offices-report.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCatalog } from '../../src/catalog/catalog.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const read = JSON.parse(readFileSync(path.join(HERE, 'office-candidates-2026-11-17.json'), 'utf8')).results;
const claims = JSON.parse(readFileSync(path.join(HERE, 'office-claims-2026-11-17.json'), 'utf8')).claims;
const catalog = createCatalog({ file: path.join(ROOT, 'src', 'data', 'startups.json'), reloadMs: 0 });
await catalog.refresh();
const snap = await catalog.snapshot();
const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;

// the two whose pages state an address but are held for a person (the pages disagree, or the state is not the record's)
const HELD = {
  Smileyscope: 'Its pages give two different addresses: 488 Victoria Street, North Melbourne (its structured data) and 333 Exhibition Street, Melbourne (its terms, as its registered business address). Not recorded: a person decides.',
  Zetifi: 'Its contact page gives 1/1 Riedell Street, Wagga Wagga NSW 2650, and the record says Melbourne, Victoria. Not recorded: a person decides whether the record or the page is right.',
};
const rows = read.map((r) => {
  const i = snap.records.findIndex((c) => c.id === r.id);
  const c = snap.records[i];
  const claim = claims.find((x) => x.id === r.id);
  const pinned = Boolean(snap.markers[i]);
  let outcome; let detail;
  if (pinned) { outcome = 'Pinned at its office'; detail = `${c.address}: its own page states it (${claim?.page ?? 'its website'}); the point is the state's official address point for that building`; }
  else if (claim?.kind === 'correspondence') { outcome = 'Address found, only as where to write: not pinned'; detail = `${claim.address} (${claim.page}); kept as a location of its own, never a pin`; }
  else if (claim?.kind === 'office' && !c.verified) { outcome = 'Office found; the record is not verified, so not pinned'; detail = `${claim.address} (${claim.page}); kept as evidence for when the record is verified`; }
  else if (claim?.kind === 'office') { outcome = 'Office found; no official point for it, so not pinned'; detail = `${claim.address} (${claim.page}); it is on airport land and the state's address data has no point for it`; }
  else if (HELD[r.company]) { outcome = 'Held for a person'; detail = HELD[r.company]; }
  else if (!r.website) { outcome = 'No website on file'; detail = 'Nothing was read; an address needs a page of its own or a document it published'; }
  else if (!r.pages.some((p) => p.status === 200)) { outcome = 'Its site could not be read'; detail = r.note || r.pages.map((p) => p.status).slice(0, 2).join(', ') || 'no page could be read'; }
  else { outcome = 'No street address on its pages'; detail = `${r.pages.filter((p) => p.status === 200).length} pages read (home, contact, about, legal); none states a street address`; }
  return [r.company, r.city, r.website ?? '', c.verified ? 'verified' : 'not verified', outcome, detail];
});
rows.sort((a, b) => a[4].localeCompare(b[4]) || a[0].localeCompare(b[0]));
writeFileSync(path.join(ROOT, '..', 'docs', 'curated-map-address-search.csv'), `${[['Company', 'City', 'Website', 'Record', 'Outcome', 'Detail'].map(q).join(','), ...rows.map((r) => r.map(q).join(','))].join('\n')}\n`);
const tally = {};
for (const r of rows) tally[r[4]] = (tally[r[4]] ?? 0) + 1;
console.log(JSON.stringify(tally, null, 1));
