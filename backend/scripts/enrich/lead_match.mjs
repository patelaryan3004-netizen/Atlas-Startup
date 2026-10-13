// Which names on a lead list are already in the directory?  node backend/scripts/enrich/lead_match.mjs [leads.txt] [--json out.json]
//
// A lead list is only names (one per line, or comma-separated): where the names came from is not used for anything but the name. Each lead
// is compared with every company in startups.json the way the discovery pipeline does it (models/identity.js): the name with its legal
// tail dropped ("Acme Pty Ltd" = "ACME"), punctuation and ".ai" folded ("Leonardo.Ai" = "Leonardo AI"), aliases and former names that the
// legacy data keeps inside parentheses, and a looser key that also drops "Group", "Labs", "Technologies". A match is
//   exact      the same name key (or an alias's)
//   loose      the same loose key ("DataMesh Group" ~ "DataMesh")
//   similar    a close spelling (similarity 0.82 or more): a person must say whether it is the same company
// Nothing is written to the directory.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nameKey, looseNameKey, parseNameVariants, similarity } from '../../src/models/identity.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, '..', '..', 'src', 'data');

export function readLeads(text) {
  return [...new Set(text.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean))];
}

export function namesOf(company) {
  const { primary, aliases, formerNames } = parseNameVariants(company.name);
  return [primary, ...aliases, ...formerNames, ...(company.aliases ?? [])].filter(Boolean);
}

export function match(lead, companies) {
  const key = nameKey(lead);
  const loose = looseNameKey(lead);
  let best = null;
  for (const company of companies) {
    for (const name of namesOf(company)) {
      let kind = null;
      let score = 0;
      if (nameKey(name) === key) { kind = 'exact'; score = 1; }
      else if (looseNameKey(name) === loose) { kind = 'loose'; score = 0.95; }
      else {
        const s = similarity(key, nameKey(name));
        if (s >= 0.82) { kind = 'similar'; score = s; }
      }
      if (kind && (!best || score > best.score)) best = { kind, score: +score.toFixed(2), id: company.id, name: company.name, matchedOn: name, website: company.website ?? null };
    }
  }
  return best;
}

export function compare(leads, companies) {
  return leads.map((lead) => ({ lead, found: match(lead, companies) }));
}

function main() {
  const args = process.argv.slice(2);
  const jsonAt = args.indexOf('--json');
  const jsonOut = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : null;
  const leads = readLeads(readFileSync(args[0] ?? path.join(HERE, 'leads.txt'), 'utf8'));
  const raw = JSON.parse(readFileSync(path.join(DATA, 'startups.json'), 'utf8'));
  const companies = Array.isArray(raw) ? raw : raw.startups;
  const rows = compare(leads, companies);
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`${companies.length} companies in the directory, ${leads.length} leads\n`);
  console.log(`${pad('lead', 24)} ${pad('in my data', 11)} ${pad('matched name', 34)} how`);
  for (const { lead, found } of rows) {
    console.log(`${pad(lead, 24)} ${pad(found ? (found.kind === 'similar' ? 'CHECK' : 'yes') : 'no', 11)} ${pad(found ? found.name : '', 34)} ${found ? `${found.kind} ${found.score}` : 'MISSING'}`);
  }
  const missing = rows.filter((r) => !r.found).length;
  const check = rows.filter((r) => r.found?.kind === 'similar').length;
  console.log(`\n${rows.length - missing - check} already in the data, ${check} to check by eye, ${missing} missing`);
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify({ companies: companies.length, rows }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
