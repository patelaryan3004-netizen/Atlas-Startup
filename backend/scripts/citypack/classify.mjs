// Evidence for what kind of organisation a directory entry is, read from the company's OWN home page (robots.txt obeyed, one page each), and the decisions that follow from it.
//
//   node scripts/citypack/classify.mjs scan  [--only type] [--limit n]   reads each company's home page and writes classification-evidence.json (no data is changed)
//   node scripts/citypack/classify.mjs apply --by "name"                 applies classification-decisions.json: { "<company id>": { "type": "company|space|startup", "why": "...", "evidence": "..." } }
//
// What counts as evidence: the page says the company is listed on a stock exchange, or gives a founding year long ago together with a large headcount, or says it is a
// coworking space, an accelerator or an incubator. A name, a category on a directory, or a guess is not evidence. A type is changed only with a decision that quotes
// what the page says, and every change is in the audit trail with the type it replaced.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../discovery.js';
import { loadRaw, parseRaw } from '../../src/models/dataset.js';
import { transact } from '../../src/models/store.js';
import { createFetcher, DEFAULT_USER_AGENT } from '../../src/discovery/http.js';
import { stripTags } from '../../src/discovery/html.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.join(HERE, '..', '..');
const { positional: [step], flags } = parseArgs(process.argv.slice(2));
const dir = path.join(BACKEND, 'src', 'data');
const EVIDENCE = path.join(HERE, 'classification-evidence.json');
const DECISIONS = path.join(HERE, 'classification-decisions.json');

const LISTED = /\b(?:ASX\s*[:\-]?\s*[A-Z0-9]{2,4}|ASX[- ]listed|Australian Securities Exchange|listed on (?:the )?(?:ASX|Nasdaq|NASDAQ|NYSE|New York Stock Exchange|London Stock Exchange)|NASDAQ\s*[:\-]?\s*[A-Z]{2,5}|NYSE\s*[:\-]?\s*[A-Z]{1,5})\b/;
const FOUNDED = /\b(?:founded|established|since|est\.?)\s*(?:in\s*)?((?:19[5-9]\d|200\d|201\d))\b/i;
const HEADCOUNT = /\b([\d,]{3,6})\+?\s+(?:employees|staff|team members|people|professionals)\b/i;
const SPACE = /\b(co-?working|coworking space|shared office|accelerator programme|accelerator program|startup incubator|innovation hub|makerspace)\b/i;
const around = (text, m) => text.slice(Math.max(0, m.index - 70), m.index + m[0].length + 70).replace(/\s+/g, ' ').trim();

async function scan() {
  const ds = parseRaw(await loadRaw(dir));
  const only = typeof flags.only === 'string' ? flags.only : 'startup';
  const limit = Number(flags.limit) || Infinity;
  const list = ds.companies.filter((c) => (c.organisation_type ?? 'startup') === only && c.website).slice(0, limit);
  const prior = existsSync(EVIDENCE) ? JSON.parse(readFileSync(EVIDENCE, 'utf8')) : { read_on: null, companies: {} };
  const fetcher = createFetcher({ userAgent: process.env.DISCOVERY_USER_AGENT || DEFAULT_USER_AGENT, minDelayMs: 1500, timeoutMs: 12000 });
  // a read that failed on the network (a DNS blip, a timeout) is tried again; one that was answered, refused or blocked is not
  const again = (r) => r && ["dns_failed", "network_error", "timeout"].includes(r.error);
  const todo = list.filter((c) => !prior.companies[c.id] || again(prior.companies[c.id]));
  let next = 0; let done = 0;
  const worker = async () => {
    while (next < todo.length) {
      const c = todo[next++];
      const rec = { website: c.website, type: c.organisation_type ?? 'startup' };
      try {
        const page = await fetcher.get(c.website);
        const text = stripTags(page.text).replace(/\s+/g, ' ');
        rec.final = page.finalUrl;
        const listed = LISTED.exec(text); if (listed) rec.listed = around(text, listed);
        const founded = FOUNDED.exec(text); if (founded) rec.founded = { year: Number(founded[1]), quote: around(text, founded) };
        const head = HEADCOUNT.exec(text); if (head) rec.headcount = { n: Number(head[1].replace(/,/g, '')), quote: around(text, head) };
        const space = SPACE.exec(text); if (space) rec.space = around(text, space);
        rec.read = true;
      } catch (e) { rec.read = false; rec.error = String(e.code ?? e.name); }
      prior.companies[c.id] = rec;
      done += 1;
      if (done % 25 === 0) { prior.read_on = new Date().toISOString(); writeFileSync(EVIDENCE, `${JSON.stringify(prior, null, 1)}\n`); console.log(`${done}/${todo.length}`); }
    }
  };
  await Promise.all(Array.from({ length: 3 }, worker));
  prior.read_on = new Date().toISOString();
  writeFileSync(EVIDENCE, `${JSON.stringify(prior, null, 1)}\n`);
  const found = Object.values(prior.companies);
  console.log(JSON.stringify({ read: found.filter((r) => r.read).length, unreadable: found.filter((r) => r.read === false).length, listed: found.filter((r) => r.listed).length, founded_by_2005: found.filter((r) => r.founded && r.founded.year <= 2005).length, large: found.filter((r) => r.headcount && r.headcount.n >= 500).length, space_words: found.filter((r) => r.space).length }));
}

async function apply() {
  const by = typeof flags.by === 'string' ? flags.by : null;
  if (!by) throw new Error('--by "name" is required: every change is recorded with a name');
  const decisions = JSON.parse(readFileSync(DECISIONS, 'utf8')).decisions ?? {};
  const { changed } = await transact(dir, async (work, { at }) => {
    const audit = [];
    for (const [id, d] of Object.entries(decisions)) {
      const c = work.companies.find((x) => x.id === id);
      if (!c || !d.evidence) continue; // no evidence quoted: no change
      const from = c.organisation_type ?? 'startup';
      if (from === d.type) continue;
      c.organisation_type = d.type === 'startup' ? null : d.type;
      c.updated_at = at;
      audit.push({ actor: { name: by, role: 'cli' }, via: 'cli', action: 'enrichment.apply', target: { type: 'company', id }, summary: `${c.name}: typed as ${d.type}, not ${from}: ${d.why} (its own page: ${d.evidence})`, changes: [{ field: 'organisation_type', from, to: d.type }] });
    }
    console.log('retyped ' + audit.length + ' companies');
    return { audit };
  });
  console.log('wrote ' + (changed.join(', ') || 'nothing'));
}

if (step === 'scan') await scan();
else if (step === 'apply') await apply();
else console.log('usage: classify.mjs scan [--only startup|company|space] [--limit n] | apply --by "name"');
