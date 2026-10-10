// The investor directory's command line. See docs/investors.md.
//
//   npm run investors -- status  [--json]                       how many investors are in each status, and what to look at
//   npm run investors -- review  [--issue code] [--limit n]     the review queue, worst first
//   npm run investors -- fetch   [--only id,id] [--discover] [--refresh]    read the pages the research file names (and, with
//                                --discover, the about / portfolio / team pages the home page links to) into the cache. Polite:
//                                robots.txt obeyed, paced, never LinkedIn (src/discovery/http.js).
//   npm run investors -- digest  <id> [--chars n]               what the cached pages of one investor say, for writing the research file
//   npm run investors -- import  [--only id,id] [--no-approve] [--apply]    apply the research file: each claim only if its words are on its page
//   npm run investors -- portfolio [--only id,id] [--apply]     match the investors' cached portfolio pages to the directory's companies
//   npm run investors -- link    [--apply]                      record the investments that evidence and funding rounds the directory already holds state
//   npm run investors -- publish <id>... | --all-verified --by <name> [--apply]     publish verified records (a person's act)
//
// import, portfolio, link and publish show what they would do and write nothing unless given --apply. Add --data <dir> to work on a
// copy of the data files, --cache <dir> for the page cache (default backend/.investor-cache, not committed) and --research <file>
// for another research file. Exit code: 0 ok, 1 on a usage or data error.
import os from 'node:os';
import path from 'node:path';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { snapshot, transact } from '../src/models/store.js';
import { reviewInvestors, INVESTOR_ISSUES } from '../src/models/investorReview.js';
import { publishInvestor, addInvestment } from '../src/models/investorActions.js';
import { createFetcher, DEFAULT_USER_AGENT, FetchPolicyError } from '../src/discovery/http.js';
import { pageFacts, suggestPages, applyResearchEntry, matchPortfolio } from '../src/investors/research.js';
import { diffChanges } from '../src/models/auditTrail.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = path.join(HERE, '..', 'src', 'data');
const DEFAULT_CACHE_DIR = path.join(HERE, '..', '.investor-cache');
const DEFAULT_RESEARCH = path.join(HERE, 'investors', 'research.json');

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    const value = next === undefined || next.startsWith('--') ? true : (i += 1, next);
    flags[key] = key in flags ? [].concat(flags[key], value) : value;
  }
  return { positional, flags };
}

const text = (flags, name) => (typeof flags[name] === 'string' ? flags[name] : undefined);
const whole = (flags, name, min = 1) => {
  if (flags[name] === undefined) return undefined;
  const n = Number(flags[name]);
  if (!Number.isFinite(n) || n < min) throw new Error(`--${name} must be a number (at least ${min})`);
  return n;
};
const pad = (n, w = 4) => String(n).padStart(w);
const entry = (by, action, target, summary, extra = {}) => ({ actor: { name: by, role: 'cli' }, via: 'cli', action, target, summary, ...extra });

// ---------- the research file and the page cache ----------

// A claim may be written as an object or as [field, value, page, quote]: the file is long, and the short form is easier to read.
function claimOf(c) {
  if (Array.isArray(c)) { const [field, value, page, quote] = c; return { field, value, page, quote }; }
  return c;
}

export async function readResearch(file) {
  const parsed = JSON.parse(await readFile(file, 'utf8'));
  if (!Array.isArray(parsed.investors)) throw new Error(`${file}: expected { investors: [...] }`);
  for (const e of parsed.investors) {
    if (!e.id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(e.id)) throw new Error(`${file}: investor needs a lowercase id, got ${JSON.stringify(e.id)}`);
    e.claims = (e.claims ?? []).map(claimOf);
    e.pages ??= {};
  }
  return parsed;
}

const cachePath = (cacheDir, id, key) => path.join(cacheDir, id, `${key}.json`);
async function readCached(cacheDir, id, key) {
  try { return JSON.parse(await readFile(cachePath(cacheDir, id, key), 'utf8')); } catch (err) { if (err.code === 'ENOENT') return null; throw err; }
}
async function writeCached(cacheDir, id, key, value) {
  await mkdir(path.join(cacheDir, id), { recursive: true });
  await writeFile(cachePath(cacheDir, id, key), `${JSON.stringify(value)}\n`, 'utf8');
}

// The pages of one entry as the importer wants them: key -> { url, text, title, kind }.
async function pagesOf(cacheDir, e) {
  const out = {};
  for (const [key, spec] of Object.entries(e.pages)) {
    const url = typeof spec === 'string' ? spec : spec.url;
    const cached = await readCached(cacheDir, e.id, key);
    if (cached?.text) out[key] = { url: cached.finalUrl ?? url, text: [cached.title, cached.description, cached.text].filter(Boolean).join(' '), title: cached.title, kind: typeof spec === 'object' ? spec.kind : undefined };
  }
  return out;
}

// What a page says about the things a reader looks for, as sentences, so a digest can be read quickly.
const TOPICS = /\b(?:pre-?seed|seed|series\s+[a-d]|early[- ]stage|growth|cheque|check size|invest(?:s|ing|ed|ment)?|fund(?:s|ed|ing)?|portfolio|founders?|sector|software|health|climate|deep ?tech|fintech|offices?|based in|headquarter|sydney|melbourne|brisbane|perth|adelaide|canberra|hobart|apply|pitch)\b/i;
function sentencesAbout(textOfPage, limit = 14) {
  const out = [];
  for (const raw of textOfPage.split(/(?<=[.!?])\s+/)) {
    const s = raw.trim();
    if (s.length < 40 || s.length > 320 || !TOPICS.test(s) || out.includes(s)) continue;
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

async function pool(items, size, fn) {
  const results = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next; next += 1; results[i] = await fn(items[i], i); }
  });
  await Promise.all(workers);
  return results;
}

// deps lets a test supply a data directory, an output sink, a clock, a fetcher and a cache folder.
export async function main(argv, deps = {}) {
  const { dataDir = DEFAULT_DATA_DIR, out = (s) => console.log(s), now = Date.now } = deps;
  const { positional: [command, ...args], flags } = parseArgs(argv);
  const dir = text(flags, 'data') ? path.resolve(text(flags, 'data')) : dataDir;
  const cacheDir = text(flags, 'cache') ? path.resolve(text(flags, 'cache')) : (deps.cacheDir ?? DEFAULT_CACHE_DIR);
  const researchFile = text(flags, 'research') ? path.resolve(text(flags, 'research')) : (deps.researchFile ?? DEFAULT_RESEARCH);
  const at = new Date(now()).toISOString();
  const by = text(flags, 'by') ?? 'investors';
  const apply = Boolean(flags.apply);
  const only = text(flags, 'only') ? new Set(text(flags, 'only').split(',').map((s) => s.trim()).filter(Boolean)) : null;

  if (!command || command === 'help') { out('Commands: status, review, fetch, digest, import, portfolio, link, publish. See scripts/investors.js and docs/investors.md.'); return 0; }

  switch (command) {
    case 'status': {
      const { ds } = await snapshot(dir, { now });
      const r = reviewInvestors(ds, { asOf: at });
      if (flags.json) { out(JSON.stringify({ byStatus: r.byStatus, counts: r.counts, relationships: { links: r.relationships.links, sourced: r.relationships.sourced, unsourced: r.relationships.unsourced }, team: { records: r.team.records, stale: r.team.stale } }, null, 2)); return 0; }
      const s = r.byStatus;
      out([`Investors at ${r.asOf.slice(0, 10)}: ${r.total} organisations, ${r.people} people, ${r.funds} funds, ${r.investments} investments`, '',
        `  Published:        ${pad(s.published)}   (public)`, `  Inactive:         ${pad(s.inactive)}   (public, labelled: stopped investing)`, `  Verified:         ${pad(s.verified)}   (checked against sources, waiting for a person to publish)`,
        `  Needs review:     ${pad(s.needs_review)}`, `  Candidates:       ${pad(s.candidate)}   (not yet checked)`, `  Rejected:         ${pad(s.rejected)}`, '',
        `Portfolio links the directory holds: ${r.relationships.links}, of which ${r.relationships.sourced} have a page that states them and ${r.relationships.unsourced} do not`,
        `Team: ${r.team.records} role(s), ${r.team.stale} not checked for a year`, `Possible duplicate firms: ${r.duplicates.firms.length}, people: ${r.duplicates.people.length}`, `Sources disagree on: ${r.conflicts.count} field(s)`, '',
        `Review queue: ${r.rows.length} organisation(s)`, ...Object.entries(INVESTOR_ISSUES).filter(([code]) => r.counts[code]).map(([code, spec]) => `  ${pad(r.counts[code])}  ${spec.label} (${spec.severity}) [${code}]`)].join('\n'));
      return 0;
    }

    case 'review': {
      const { ds } = await snapshot(dir, { now });
      const r = reviewInvestors(ds, { asOf: at });
      const code = text(flags, 'issue');
      if (code && !INVESTOR_ISSUES[code]) throw new Error(`unknown issue "${code}": the issues are ${Object.keys(INVESTOR_ISSUES).join(', ')}`);
      const rows = code ? r.rows.filter((x) => x.issues.some((i) => i.code === code)) : r.rows;
      out(flags.json ? JSON.stringify(rows, null, 2) : (rows.length ? rows.slice(0, whole(flags, 'limit') ?? 40).map((x) => `${x.name.padEnd(30)} ${x.status.padEnd(13)} ${x.issues.map((i) => i.code).join(', ')}`).join('\n') : 'Nothing to review.'));
      return 0;
    }

    case 'fetch': {
      const research = await readResearch(researchFile);
      const targets = research.investors.filter((e) => !only || only.has(e.id));
      const fetcher = deps.fetcher ?? createFetcher({ userAgent: DEFAULT_USER_AGENT, minDelayMs: Number(deps.minDelayMs ?? 2500) });
      const summary = await pool(targets, whole(flags, 'concurrency') ?? 4, async (e) => {
        const line = [];
        const read = async (key, url) => {
          if (!flags.refresh && (await readCached(cacheDir, e.id, key))?.text) { line.push(`${key}: cached`); return await readCached(cacheDir, e.id, key); }
          try {
            const r = await fetcher.get(url);
            const facts = pageFacts(r.text, r.finalUrl);
            const row = { url, finalUrl: r.finalUrl, status: r.status, fetched_at: new Date(now()).toISOString(), ...facts };
            await writeCached(cacheDir, e.id, key, row);
            line.push(`${key}: ok (${facts.text.length} chars)`);
            return row;
          } catch (err) {
            if (!(err instanceof FetchPolicyError)) throw err;
            await writeCached(cacheDir, e.id, key, { url, error: err.code, message: err.message, fetched_at: new Date(now()).toISOString() });
            line.push(`${key}: ${err.code} (${err.message})`);
            return null;
          }
        };
        for (const [key, spec] of Object.entries(e.pages)) await read(key, typeof spec === 'string' ? spec : spec.url);
        if (flags.discover) {
          const home = await readCached(cacheDir, e.id, 'home');
          if (home?.text) {
            const found = suggestPages(home);
            await writeCached(cacheDir, e.id, '_discover', { found });
            for (const f of found) if (!e.pages[f.kind]) { e.pages[f.kind] = f.url; await read(f.kind, f.url); }
          }
        }
        out(`${e.id.padEnd(26)} ${line.join(' | ')}`);
        return { id: e.id, line };
      });
      out(`Read ${summary.length} investor(s) into ${cacheDir}`);
      return 0;
    }

    case 'digest': {
      const id = args[0];
      if (!id) throw new Error('say which investor: digest <id>');
      const research = await readResearch(researchFile);
      const e = research.investors.find((x) => x.id === id) ?? { id, pages: {} };
      const keys = new Set([...Object.keys(e.pages)]);
      try {
        for (const f of await readdir(path.join(cacheDir, id))) if (f.endsWith('.json') && !f.startsWith('_')) keys.add(f.slice(0, -5));
      } catch { /* nothing cached yet */ }
      const chars = whole(flags, 'chars') ?? 350;
      const shown = new Set();
      for (const key of keys) {
        const page = await readCached(cacheDir, id, key);
        if (!page) { out(`## ${key}: not cached`); continue; }
        if (page.error) { out(`## ${key}: ${page.url}\n   REFUSED ${page.error}: ${page.message}`); continue; }
        out(`## ${key}: ${page.finalUrl ?? page.url}\n   title: ${page.title}\n   description: ${page.description ?? ''}\n   text (${page.text.length} chars): ${page.text.slice(0, chars)}`);
        const about = sentencesAbout(page.text, 40).filter((s) => !shown.has(s)).slice(0, whole(flags, 'sentences') ?? 12);
        for (const s of about) shown.add(s);
        if (about.length) out(`   sentences:\n${about.map((s) => `     - ${s}`).join('\n')}`);
        if (key === 'home' || flags.links) {
          const hrefs = (page.links ?? []).filter((l) => /apply|pitch|submit|funding|jobs|careers|portfolio|companies|team|people|about|contact|startups/i.test(`${l.href} ${l.text}`)).slice(0, 14);
          if (hrefs.length) out(`   links: ${hrefs.map((l) => `${l.text || '(no text)'} -> ${l.href}`).join(' | ')}`);
        }
      }      return 0;
    }

    case 'import': {
      const research = await readResearch(researchFile);
      const targets = research.investors.filter((e) => !only || only.has(e.id));
      const loaded = new Map();
      for (const e of targets) loaded.set(e.id, await pagesOf(cacheDir, e));
      const { result } = await transact(dir, (work, ctx) => {
        const target = apply ? work : structuredClone(work);
        const reports = [];
        const audit = [];
        for (const e of targets) {
          const before = structuredClone((target.investors ?? []).find((o) => o.id === e.id) ?? null);
          const report = applyResearchEntry(target, e, loaded.get(e.id), { at: ctx.at, by, approve: !flags['no-approve'] });
          reports.push(report);
          const org = (target.investors ?? []).find((o) => o.id === e.id);
          if (apply && (report.applied || report.created || report.merged.length || report.approved)) {
            audit.push(entry(by, 'investor.import', { type: 'investor', id: e.id }, `Applied ${report.applied} claim(s) from the research file to ${org.name}${report.merged.length ? `; merged ${report.merged.join(', ')}` : ''}${report.approved ? '; verified' : ''}${report.refused.length ? `; refused ${report.refused.length}` : ''}`,
              { changes: diffChanges(before, org, Object.keys(org).filter((k) => !['updated_at', 'created_at'].includes(k))) }));
          }
        }
        return { result: reports, audit };
      }, { now });
      let applied = 0; let refused = 0; let approved = 0;
      for (const r of result) {
        applied += r.applied; refused += r.refused.length; approved += r.approved ? 1 : 0;
        if (r.refused.length || flags.verbose) out(`${r.id}: ${r.applied} applied${r.merged.length ? `, merged ${r.merged.join(',')}` : ''}${r.approved ? ', verified' : ''}\n${r.refused.map((x) => `    refused ${x.field}=${JSON.stringify(x.value)}: ${x.why}`).join('\n')}`);
      }
      out(`${apply ? 'Applied' : 'Would apply'} ${applied} claim(s) across ${result.length} investor(s); ${approved} ${apply ? 'verified' : 'would be verified'}; ${refused} refused${apply ? '' : ' (nothing written: add --apply)'}`);
      return 0;
    }

    case 'portfolio': {
      const research = await readResearch(researchFile);
      const targets = research.investors.filter((e) => (!only || only.has(e.id)) && (e.portfolio_pages ?? []).length);
      const { result } = await transact(dir, async (work, ctx) => {
        const target = apply ? work : structuredClone(work);
        const reports = [];
        const audit = [];
        for (const e of targets) {
          const org = (target.investors ?? []).find((o) => o.id === e.id);
          if (!org) { reports.push({ id: e.id, error: 'not in the directory yet: run import first' }); continue; }
          const have = new Set((target.investments ?? []).filter((i) => i.investor_organisation_id === org.id).map((i) => i.company_id));
          const added = [];
          for (const key of e.portfolio_pages) {
            const page = await readCached(cacheDir, e.id, key);
            if (!page?.text) { reports.push({ id: e.id, error: `the page "${key}" was not read` }); continue; }
            for (const m of matchPortfolio(page, target.companies, { ownHost: new URL(org.website ?? page.url).hostname.replace(/^www\./, '') })) {
              if (have.has(m.company.id)) continue;
              have.add(m.company.id);
              const note = m.how === 'link' ? `The portfolio page links to ${m.page_host}${m.quote && m.quote !== m.company.name ? ` (link text "${m.quote}")` : ''}.` : `The portfolio page lists "${m.quote}".`;
              addInvestment(target, { investor_id: org.id, company_id: m.company.id, source: { url: page.finalUrl ?? page.url, kind: 'investor_website', title: page.title ?? null, quote: note } }, { at: ctx.at, by });
              added.push(m.company.name);
            }
          }
          reports.push({ id: e.id, added });
          if (apply && added.length) audit.push(entry(by, 'investment.add', { type: 'investor', id: org.id }, `Recorded ${added.length} investment(s) of ${org.name} from its portfolio page: ${added.slice(0, 6).join(', ')}${added.length > 6 ? ', ...' : ''}`));
        }
        return { result: reports, audit };
      }, { now });
      let total = 0;
      for (const r of result) { if (r.error) out(`${r.id}: ${r.error}`); else { total += r.added.length; out(`${r.id}: ${r.added.length} compan${r.added.length === 1 ? 'y' : 'ies'}${r.added.length ? ` (${r.added.slice(0, 8).join(', ')}${r.added.length > 8 ? ', ...' : ''})` : ''}`); } }
      out(`${apply ? 'Recorded' : 'Would record'} ${total} investment(s)${apply ? '' : ' (nothing written: add --apply)'}`);
      return 0;
    }

    case 'link': {
      const { result } = await transact(dir, (work, ctx) => {
        const target = apply ? work : structuredClone(work);
        const orgs = target.investors ?? [];
        const find = (name) => orgs.find((o) => [o.name, ...o.aliases].some((n) => n.toLowerCase() === String(name).toLowerCase()));
        const sources = new Map((target.sources ?? []).map((s) => [s.id, s]));
        const have = (orgId, companyId, round) => (target.investments ?? []).some((i) => i.investor_organisation_id === orgId && i.company_id === companyId && String(i.round ?? '').toLowerCase() === String(round ?? '').toLowerCase());
        const added = [];
        const skipped = [];
        // The investments funding rounds state: each investor of a round, with its page, and lead where the round says so.
        for (const r of target.funding_rounds ?? []) {
          const page = (r.source_ids ?? []).map((id) => sources.get(id)).find((s) => s?.retrieved_at);
          for (const investorId of r.investor_ids ?? []) {
            const org = orgs.find((o) => o.id === investorId);
            if (!org || have(org.id, r.company_id, r.round)) continue;
            if (!page) { skipped.push(`${investorId} in ${r.company_id}: no retrieved source`); continue; }
            addInvestment(target, {
              investor_id: org.id, company_id: r.company_id, round: r.round, investment_date: r.announced_on, amount: r.amount, currency: r.currency,
              lead_status: (r.lead_investor_ids ?? []).includes(investorId) ? 'lead' : 'participant', source_id: page.id, note: `${page.title ?? page.url}: records this round.`,
            }, { at: ctx.at, by });
            added.push(`${org.name} -> ${r.company_id} (${r.round})`);
          }
        }
        // The company evidence that names an investor: verified when a primary page, unverified otherwise (a person confirms it).
        for (const ev of target.evidence ?? []) {
          if (ev.field !== 'investors' || ev.status !== 'active' || ev.confidence === 'low') continue;
          const org = find(ev.value);
          const s = sources.get(ev.source_id);
          if (!org || !s?.url || have(org.id, ev.company_id, null)) continue;
          addInvestment(target, {
            investor_id: org.id, company_id: ev.company_id, source_id: s.id, note: ev.note ?? `${s.title ?? s.url} names ${org.name} as an investor.`,
            verification_status: ev.confidence === 'high' && s.retrieved_at ? 'verified' : 'unverified',
          }, { at: ctx.at, by });
          added.push(`${org.name} -> ${ev.company_id} (${ev.confidence === 'high' && s.retrieved_at ? 'verified' : 'unverified'})`);
        }
        return { result: { added, skipped }, audit: apply && added.length ? [entry(by, 'investor.link', { type: 'system', id: 'investments' }, `Recorded ${added.length} investment(s) that evidence and funding rounds already state`)] : [] };
      }, { now });
      for (const line of result.added) out(`  ${line}`);
      for (const line of result.skipped) out(`  skipped ${line}`);
      out(`${apply ? 'Recorded' : 'Would record'} ${result.added.length} investment(s)${apply ? '' : ' (nothing written: add --apply)'}`);
      return 0;
    }

    case 'publish': {
      if (!text(flags, 'by')) throw new Error('publishing is a person\'s act: say who with --by <name>');
      const { ds } = await snapshot(dir, { now });
      const ids = flags['all-verified'] ? ds.investors.filter((o) => o.verification_status === 'verified').map((o) => o.id) : args;
      if (!ids.length) throw new Error('say what to publish: ids, or --all-verified');
      const { result } = await transact(dir, (work, ctx) => {
        const target = apply ? work : structuredClone(work);
        const done = [];
        const failed = [];
        const audit = [];
        for (const id of ids) {
          try {
            const org = publishInvestor(target, id, { at: ctx.at });
            done.push(org.name);
            if (apply) audit.push(entry(by, 'investor.publish', { type: 'investor', id }, `Published ${org.name}`, { changes: [{ field: 'verification_status', from: 'verified', to: org.verification_status }] }));
          } catch (err) { failed.push(`${id}: ${err.message}`); }
        }
        return { result: { done, failed }, audit };
      }, { now });
      for (const f of result.failed) out(`  could not publish ${f}`);
      out(`${apply ? 'Published' : 'Would publish'} ${result.done.length}: ${result.done.slice(0, 12).join(', ')}${result.done.length > 12 ? ', ...' : ''}${apply ? '' : ' (nothing written: add --apply)'}`);
      return 0;
    }

    default: throw new Error(`unknown command "${command}"`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not allowed here: carry on */ }
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => { console.error(`error: ${err.message}`); process.exitCode = 1; });
}
