// Puts the readings in companies_enriched.json (enrich_companies.py, Pass 1 and 1b) into the dataset, through the code the enrichment
// worker uses (applyCompanyEnrichment): evidence rows, the job boards as sources, open jobs, and the rule that a value the record
// already holds is never overwritten. Then the owner's decisions of 2026-10-13, each with an audit entry that says old and new:
//
//   1. Superstat and Forward: their roles were read from a page's plain text by hand on 5 Oct. The evidence stays, but as medium
//      confidence (a check, not a confirmation), so they show "Hiring (checked 5 Oct)" and are not counted as hiring now until the
//      owner re-checks them by hand.
//   2. Shippit and Spriggy: their job boards list no open roles, and the owner accepted hiring:false (was a flag no page backed).
//   3. The websites that no longer resolve are marked website_status "unavailable". The address is kept.
//
//   node backend/scripts/enrich/apply_enriched.js [--data <dir>] [--apply] [--file <companies_enriched.json>]
//
// Without --apply it works on a COPY of the data folder and says what it would have done; the real files are untouched.
import dns from 'node:dns/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transact } from '../../src/models/store.js';
import { applyCompanyEnrichment } from '../../src/enrichment/apply.js';
import { setField } from '../../src/enrichment/fill.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ACTOR = { name: 'enrich_companies.py', role: 'cli' };
const OWNER_DAY = '2026-10-13';
const PROVIDER_NAMES = {
  greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', workable: 'Workable', recruitee: 'Recruitee', smartrecruiters: 'SmartRecruiters',
  bamboohr: 'BambooHR', breezy: 'Breezy', teamtailor: 'Teamtailor',
};
const HELD_BY_HAND = ['superstat', 'forward'];
const ACCEPTED_NOT_HIRING = ['shippit', 'spriggy'];
const RESOLVED = ['roles_found_board', 'roles_found_structured', 'board_empty'];

const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; } };
const when = (n) => `${n} open role${n === 1 ? '' : 's'}`;

// One company's reading, as the "analysis" applyCompanyEnrichment takes: the pages read, the claims and the postings, each with its source.
export function analysisFor(r, generatedAt) {
  const boards = (r.pass1.boards ?? []).filter((b) => b.feed_ok);
  const hiring = r.fields.hiring;
  // When this company was read: the run's time, or the follow-up's, which is later. (An empty board leaves an older, more confident
  // "hiring" in the merged field, so the run's time is the floor.)
  const retrieved = [generatedAt, hiring.last_verified_at ?? ''].sort().at(-1);
  // The merged open_jobs is this reading's only when this reading is what it holds (an older, more confident list can outrank it).
  const jobsAreFresh = r.fields.open_jobs.value && (r.fields.open_jobs.last_verified_at ?? '') >= generatedAt;
  const rows = jobsAreFresh ? r.fields.open_jobs.value : [];
  const sourceFor = (board) => ({
    kind: 'company_website', url: board.page_url, title: `${PROVIDER_NAMES[board.provider] ?? board.provider} job board`, publisher: hostOf(r.website), retrieved_at: retrieved,
    slug: `${board.provider}-jobs`, note: `The company's ${PROVIDER_NAMES[board.provider] ?? board.provider} job board, which its careers page links to, read through the board's public feed.`,
  });
  const out = { pages: [], evidence: [], jobs: [], errors: [], warnings: [], retrieved_at: retrieved, mismatch: false, blocked: false, status: { signals: [] } };

  if (r.pass1.result === 'roles_found_board') {
    const withRoles = boards.filter((b) => b.role_count > 0);
    for (const b of boards) out.pages.push({ url: b.page_url, status: 200 });
    for (const b of withRoles) {
      const note = `${when(b.role_count)} on the company's ${PROVIDER_NAMES[b.provider] ?? b.provider} job board, which its careers page links to${withRoles.length === 1 && rows[0] ? `, such as "${rows[0].title}"` : ''}.`;
      out.evidence.push({ field: 'hiring_status', value: 'hiring', confidence: 'high', verified_at: retrieved, source: sourceFor(b), note });
    }
    for (const j of rows) out.jobs.push({ ...j, apply_url: j.apply_url ?? withRoles[0].page_url, source: sourceFor(withRoles[0]) });
  } else if (r.pass1.result === 'roles_found_structured') {
    const url = hiring.source_url;
    const source = { kind: 'company_website', url, title: 'Careers page', publisher: hostOf(url), retrieved_at: retrieved, slug: 'careers', note: 'Job posting on the company site.' };
    out.pages.push({ url, status: 200 });
    out.evidence.push({ field: 'hiring_status', value: 'hiring', confidence: 'high', verified_at: retrieved, source,
      note: `${when(r.pass1.role_count)} in the page's structured data${rows[0] ? `, such as "${rows[0].title}"` : ''}.` });
    for (const j of rows) out.jobs.push({ ...j, apply_url: j.apply_url ?? url, source });
  } else if (r.pass1.result === 'board_empty') {
    for (const b of boards) {
      out.pages.push({ url: b.page_url, status: 200 });
      out.evidence.push({ field: 'hiring_status', value: 'not_hiring', confidence: 'medium', verified_at: retrieved, source: sourceFor(b),
        note: `The company's ${PROVIDER_NAMES[b.provider] ?? b.provider} job board, which its careers page links to, listed no open roles when it was read.` });
    }
  }
  return out;
}

// resolveHost(hostname): rejects when the name does not resolve (injectable, so a test needs no network and no waiting).
export async function applyEnriched({ dir, file, now = Date.now, resolveHost = (host) => dns.lookup(host), retryMs = 1500 }) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const report = { applied: [], not_hiring_accepted: [], held: [], websites_unavailable: [], skipped: [], resolves_now: [] };
  // A site is marked unavailable only if its domain still does not resolve now, three tries in a row: a lookup that failed once during
  // the run (it happens) must never mark a live site.
  const unreachable = data.companies.filter((x) => x.pass1.result === 'site_unreachable' && x.pass1.refusal === 'dns_failed');
  const dead = new Set();
  for (const r of unreachable) {
    let resolves = false;
    for (let attempt = 0; attempt < 3 && !resolves; attempt += 1) {
      try { await resolveHost(new URL(r.website).hostname); resolves = true; } catch { await new Promise((resolve) => { setTimeout(resolve, retryMs); }); }
    }
    if (resolves) report.resolves_now.push(r.id); else dead.add(r.id);
  }

  await transact(dir, (work, { at }) => {
    const audit = [];
    const byId = new Map(work.companies.map((c) => [c.id, c]));

    for (const r of data.companies.filter((x) => RESOLVED.includes(x.pass1.result))) {
      if (!byId.has(r.id)) { report.skipped.push(`${r.id}: not in the dataset`); continue; }
      const s = applyCompanyEnrichment(work, { companyId: r.id, analysis: analysisFor(r, data.generated_at), at, mode: 'fill' });
      report.applied.push({ id: r.id, result: r.pass1.result, evidence: s.evidence_added + s.evidence_refreshed, jobs: s.jobs, filled: s.applied.map((a) => a.field) });
      audit.push({
        actor: ACTOR, via: 'cli', action: 'enrichment.apply', target: { type: 'company', id: r.id }, changes: s.changes,
        summary: `Pass 1 reading of ${hostOf(r.website)} (${r.pass1.result}): ${s.evidence_added} evidence added, ${s.evidence_refreshed} re-checked, jobs +${s.jobs.added}/~${s.jobs.updated}/-${s.jobs.closed}`,
      });
    }

    // 2. the owner accepted hiring:false for these: the record changes, and the audit says from what to what
    for (const id of ACCEPTED_NOT_HIRING) {
      const company = byId.get(id);
      if (!company || company.hiring_status === 'not_hiring') continue;
      const changes = setField(company, 'hiring_status', 'not_hiring');
      company.updated_at = at;
      report.not_hiring_accepted.push({ id, changes });
      audit.push({ actor: ACTOR, via: 'cli', action: 'company.hiring_decision', target: { type: 'company', id }, changes,
        reason: `Owner decision ${OWNER_DAY}: the company's job board lists no open roles; the "hiring" flag no page backed is replaced by not_hiring.`,
        summary: `${company.name}: hiring true -> false, accepted by the owner after its job board was read empty` });
    }

    // 1. held out of "hiring now" until the owner re-checks by hand: the reading stays, as a check and not a confirmation
    for (const id of HELD_BY_HAND) {
      for (const e of work.evidence.filter((x) => x.company_id === id && x.field === 'hiring_status' && x.value === 'hiring' && x.status === 'active' && x.confidence === 'high')) {
        const note = `${e.note ?? ''} Read from the page's text by hand on ${(e.verified_at ?? '').slice(0, 10)}, not from a job board or structured postings: a check, not a confirmation. Held out of "hiring now" until the owner re-checks it by hand (${OWNER_DAY}).`.trim();
        audit.push({ actor: ACTOR, via: 'cli', action: 'evidence.hold', target: { type: 'company', id }, changes: [{ field: `evidence ${e.id} confidence`, from: e.confidence, to: 'medium' }],
          reason: `Owner decision ${OWNER_DAY}: shown as "Hiring (checked ${(e.verified_at ?? '').slice(0, 10)})" and not counted as hiring now until re-checked by hand.`,
          summary: `${byId.get(id)?.name ?? id}: hiring evidence high -> medium` });
        Object.assign(e, { confidence: 'medium', note });
        report.held.push({ id, evidence: e.id });
      }
    }

    // 3. websites that no longer resolve are said so, not linked. The address stays.
    for (const r of unreachable.filter((x) => dead.has(x.id))) {
      const company = byId.get(r.id);
      if (!company || company.website_status === 'unavailable') continue;
      company.website_status = 'unavailable';
      company.updated_at = at;
      report.websites_unavailable.push({ id: r.id, website: company.website });
      audit.push({ actor: ACTOR, via: 'cli', action: 'company.website_status', target: { type: 'company', id: r.id }, changes: [{ field: 'website_status', from: null, to: 'unavailable' }],
        reason: `The domain did not resolve on three tries in a row (${data.generated_at.slice(0, 10)}). The address is kept for a person to re-check.`,
        summary: `${company.name}: website marked unavailable (${hostOf(company.website)} does not resolve)` });
    }
    return { audit };
  }, { now });
  return report;
}

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    flags[key] = argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[++i];
  }
  return flags;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flags = parseArgs(process.argv.slice(2));
  const realDir = path.resolve(typeof flags.data === 'string' ? flags.data : path.join(HERE, '..', '..', 'src', 'data'));
  const file = path.resolve(typeof flags.file === 'string' ? flags.file : path.join(HERE, 'companies_enriched.json'));
  let dir = realDir;
  if (!flags.apply) {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-enriched-'));
    for (const name of fs.readdirSync(realDir)) fs.copyFileSync(path.join(realDir, name), path.join(dir, name));
    console.log(`Dry run on a copy (${dir}); pass --apply to write ${realDir}`);
  }
  const report = await applyEnriched({ dir, file });
  console.log(JSON.stringify({
    companies_read_and_applied: report.applied.length, evidence_and_jobs: report.applied.map((a) => `${a.id}: ${a.result}, ${a.evidence} evidence, jobs ${JSON.stringify(a.jobs)}${a.filled.length ? `, filled ${a.filled}` : ''}`),
    hiring_false_accepted: report.not_hiring_accepted.map((x) => x.id), held_by_hand: report.held, websites_unavailable: report.websites_unavailable.map((x) => `${x.id} (${x.website})`),
    failed_dns_in_the_run_but_resolve_now: report.resolves_now, skipped: report.skipped,
  }, null, 2));
  if (!flags.apply) console.log(`\nNothing was written to ${realDir}. Dry-run copy: ${dir}`);
}
