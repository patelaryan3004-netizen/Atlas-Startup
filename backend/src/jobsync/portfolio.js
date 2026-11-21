// Official portfolio pages as company discovery sources (the venture firms' and accelerators' own pages that name the companies they backed: Blackbird, AirTree, Square Peg, OneVentures,
// Investible, Startmate, Folklore, Giant Leap, Cicada). The pages and how each lists its companies are in discovery/portfolioSources.js, which the portfolio importer (scripts/portfolio) uses too.
//
// Like Innovation Bay's company list (network.js) this FINDS companies and never stores a role. The vacancies still come from each employer's own feed. A refresh reads each portfolio page
// once a week (a stateless rotation: the page's own half-day block, so nothing is saved between runs), takes the companies on it that nothing in the repository has seen, and for those:
//   in the directory (exact: website and name)   nothing to do: the discover step looks at its own website for a job board
//   already a pending candidate                  nothing to do: it is in the review queue
//   the same name as a company we hold           counted, not queued
//   anything else with a usable website          the company's OWN website is read by the directory's engine (discovery/pipeline.js, robots.txt obeyed, three pages) on a scratch copy that
//                                                writes nothing, because a portfolio page does not say where a company is. The engine's verdict is kept on the lead: explicit evidence that it
//                                                is not Australian, or not a startup, means no lead; otherwise a lead (unknown_company, needs_review) that `jobsync leads --promote` queues
// "Seen" is read from what the repository already holds: the saved scans (scripts/portfolio/scans, the importer's record), the pending candidates' discoveries and the leads' sightings. A page
// that is down, refuses, or whose layout changed (it names nothing) changes nothing: the next week reads it again.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FetchPolicyError } from '../discovery/http.js';
import { createEngine } from '../discovery/pipeline.js';
import { SOURCES, usableWebsite } from '../discovery/portfolioSources.js';
import { buildIndex, identityOfLead, resolveLead, OUTCOMES } from '../discovery/resolve.js';
import { canonicalDomain } from '../models/identity.js';
import { slugify } from '../models/company.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SCAN_DIR = path.join(HERE, '..', '..', 'scripts', 'portfolio', 'scans');

// New entries whose own profile page is read per refresh (a portfolio that doubled overnight is worked off over a few weeks, not in one burst).
export const PORTFOLIO_READS_PER_RUN = 30;
const STOP_CODES = new Set(['robots_disallow', 'robots_unavailable', 'access_controlled', 'rate_limited']);
const STRONG_NAME = ['name_exact', 'name_legal', 'name_alias', 'name_former'];

// What the engine records for a lead from a portfolio page (importer's SOURCE_KIND): a venture firm's own page, or an accelerator's.
export const evidenceKindOf = (source) => (source.kind === 'accelerator_portfolio' ? 'accelerator_profile' : 'investor_website');

// An address compared without its tracking, its fragment, its case or a trailing slash.
export function normUrl(u) {
  try { const x = new URL(u); x.hash = ''; x.search = ''; return `${x.hostname.replace(/^www\./, '').toLowerCase()}${x.pathname.replace(/\/+$/, '').toLowerCase()}`; } catch (e) { return String(u ?? '').toLowerCase(); }
}
const keyOf = (item) => (item.profile_url ? normUrl(item.profile_url) : `${String(item.name ?? '').toLowerCase()}|${normUrl(item.website)}`);

// The importer's saved read of a page: the keys of the companies it named.
export function savedScanKeys(source, dir = SCAN_DIR) {
  const file = path.join(dir, `${source.id}.json`);
  if (!existsSync(file)) return new Set();
  try { return new Set(JSON.parse(readFileSync(file, 'utf8')).leads.map((l) => (l.profile_url ? normUrl(l.profile_url) : `${String(l.name ?? '').toLowerCase()}|${normUrl(l.website)}`))); } catch (e) { return new Set(); }
}

// Everything in the data that has already seen a company page of a portfolio: pending candidates' and leads' sightings (by address).
export function seenUrls(work) {
  const out = new Set();
  for (const c of work.candidates ?? []) for (const d of c.discoveries ?? []) if (d.url) out.add(normUrl(d.url));
  for (const l of work.job_leads ?? []) for (const s of l.seen_on ?? []) if (s.url) out.add(normUrl(s.url));
  return out;
}

// Each page has a row in job_vc_boards.json (platform portfolio_page, which the public board leaves out): when it was last read and when it is due. A page never read is due now (the first refresh
// reads all nine); one read is due again a week later; one that was down, or whose new companies were not all looked at yet, tomorrow's refresh or the next. So a second refresh in the same hour asks nothing.
export const portfolioRowId = (source) => `portfolio-${source.id}`;
export const portfolioDue = (row, now) => !row || !row.next_check_at || Date.parse(row.next_check_at) <= now;
const HOUR = 3600000;
export function portfolioRow(source, res, { at, now, leads = 0 }) {
  const access = res.status === 'ok' ? 'public_list' : res.status === 'layout_changed' ? 'no_public_feed' : 'unread';
  const wait = res.status === 'ok' ? (res.deferred > 0 ? 12 * HOUR : 7 * 24 * HOUR) : res.status === 'layout_changed' ? 24 * HOUR : 12 * HOUR;
  const note = res.status === 'ok'
    ? `${source.publisher}'s official portfolio page names ${res.listed} companies; ${res.new} not seen before, ${res.read} looked at in this read${res.deferred ? ` (${res.deferred} wait for the next)` : ''}, ${leads} new lead${leads === 1 ? '' : 's'}. Read once a week; it names companies only, never roles.`
    : res.status === 'layout_changed' ? `The portfolio page (${source.listUrl}) names no company any more: its layout may have changed. Nothing was concluded from it; it is asked again tomorrow.`
      : `The portfolio page (${source.listUrl}) was not read: ${res.error ?? 'no answer'}. It is asked again at the next refresh.`;
  return { id: portfolioRowId(source), investor_id: null, name: `${source.publisher} portfolio`, board_url: source.listUrl, platform: 'portfolio_page', access, evidence_url: source.listUrl, checked_at: at, own_vacancies: '', note, next_check_at: new Date(now + wait).toISOString() };
}

// One portfolio page: its listing, and the profile (or card) of each company on it that nothing has seen. Never throws for a site that refuses or fails.
//   known(key) true: this company was seen before (a saved scan, a candidate, a lead)
export async function readPortfolio(source, { fetcher, now = Date.now, known = () => false, limit = PORTFOLIO_READS_PER_RUN, shouldStop = () => false } = {}) {
  const at = new Date(now()).toISOString();
  const out = { source_id: source.id, status: 'ok', listed: 0, new: 0, read: 0, errors: 0, deferred: 0, stopped: null, entries: [], read_at: at };
  let list;
  try { list = await fetcher.get(source.listUrl); } catch (err) {
    if (!(err instanceof FetchPolicyError)) throw err;
    return { ...out, status: 'unread', stopped: STOP_CODES.has(err.code) ? err.code : null, error: err.code };
  }
  const seen = new Set();
  const items = source.parseList(list.text, list.finalUrl).filter((i) => { const k = keyOf(i); if (seen.has(k)) return false; seen.add(k); return true; });
  out.listed = items.length;
  // A page that names no company is a layout we no longer read (or an error page), not an empty portfolio: nothing is concluded from it.
  if (!items.length) return { ...out, status: 'layout_changed' };
  const fresh = items.filter((i) => !known(keyOf(i)));
  out.new = fresh.length;
  let consecutive = 0;
  for (const item of fresh) {
    if (out.read + out.errors >= limit || shouldStop() || out.stopped) break;
    if (source.mode === 'direct') {
      out.entries.push({ key: keyOf(item), name: item.name, website: item.website, description: item.description ?? null, profile_url: null, list_url: list.finalUrl });
      out.read += 1;
      continue;
    }
    try {
      const page = await fetcher.get(item.profile_url);
      const facts = source.parseProfile(page.text, page.finalUrl);
      out.read += 1; consecutive = 0;
      const name = facts.name || item.list_text;
      if (name) out.entries.push({ key: keyOf(item), name, website: facts.website, description: facts.description ?? null, profile_url: page.finalUrl, list_url: list.finalUrl });
    } catch (err) {
      if (!(err instanceof FetchPolicyError)) throw err;
      out.errors += 1; consecutive += 1;
      if (STOP_CODES.has(err.code)) out.stopped = err.code; else if (consecutive >= 3) out.stopped = 'repeated_errors';
    }
  }
  out.deferred = Math.max(0, fresh.length - out.read - out.errors);
  return out;
}

// What one entry is to the directory, by the project's own resolver: no usable website, a company we hold (exact), a pending candidate (exact), the same name as one of those, or new.
function classify(e, index) {
  if (!usableWebsite(e.website)) return { kind: 'no_site' };
  const r = resolveLead(identityOfLead({ name: e.name, website: e.website }), index);
  const exact = r.outcome === OUTCOMES.EXACT ? r.best : null;
  if (exact?.target.kind === 'company') return { kind: 'company', exact };
  if (exact?.target.kind === 'candidate') return { kind: 'candidate' };
  if (r.best?.signals.some((x) => STRONG_NAME.includes(x.code))) return { kind: 'same_name' };
  return { kind: 'new' };
}

// The entries whose own website is worth reading: new to the directory and the queue, and not already judged on an earlier read.
export function toJudge(work, entries) {
  const index = buildIndex(work);
  return entries.filter((e) => classify(e, index).kind === 'new' && !(work.job_leads ?? []).some((l) => l.id === `lead-${slugify(e.name).slice(0, 60)}` && l.profile?.origin === 'portfolio' && l.profile.australian));
}

// The directory's own engine over the entries, on a scratch copy of what it matches against (the real data is not touched, and nothing is queued): it matches each company with the directory and the
// pending candidates again, reads the company's own website, and judges Australian and startup. Returns key -> { status, resolution, australian, startup, match }.
export async function judgeEntries(work, source, entries, { fetcher, now = Date.now }) {
  const scratch = { companies: work.companies, investors: work.investors ?? [], people: work.people ?? [], candidates: [...(work.candidates ?? [])], identifiers: [...(work.identifiers ?? [])], evidence: [], sources: [] };
  const at = new Date(now()).toISOString();
  const leads = entries.map((e) => ({ key: e.key, name: e.name, website: e.website, url: e.profile_url ?? e.list_url, title: `${e.name} | ${source.publisher} portfolio`, publisher: source.publisher, observed_at: at, retrieved_at: at, city: null, state: null, founders: [], evidence: [], text: e.description ?? '' }));
  const engine = createEngine({ work: scratch, fetcher, now, options: { enrich: true } });
  await engine.run([{ id: source.id, kind: evidenceKindOf(source), region: 'AU', license: { basis: 'permitted_page' }, licenseBasis: 'permitted_page', discover: async () => leads }]);
  const out = new Map();
  for (const c of scratch.candidates) {
    const d = (c.discoveries ?? []).find((x) => x.source_id === source.id && entries.some((e) => e.key === x.key));
    if (d) out.set(d.key, { status: c.status, resolution: c.resolution, australian: c.australian?.verdict ?? null, startup: c.startup?.verdict ?? null, match: c.matches?.[0]?.name ?? null });
  }
  return out;
}

// A portfolio lead whose own website said nothing about where the company is ('unknown') is judged again a month after it was last read, a few a refresh: a site changes, and a lead that is never
// looked at again would stay out of the queue for good. Returns entries shaped like readPortfolio's, keyed by the lead.
const MONTH = 28 * 24 * 3600000;
export function recheckEntries(work, { now = Date.now(), limit = 10 } = {}) {
  return (work.job_leads ?? [])
    .filter((l) => l.kind === 'unknown_company' && l.status === 'needs_review' && l.profile?.origin === 'portfolio' && l.profile.australian === 'unknown' && l.profile.website && now - Date.parse(l.profile.read_at ?? 0) > MONTH)
    .sort((a, b) => Date.parse(a.profile.read_at ?? 0) - Date.parse(b.profile.read_at ?? 0)).slice(0, limit)
    .map((l) => ({ key: `recheck:${l.id}`, lead_id: l.id, name: l.name, website: l.profile.website, description: l.profile.description, profile_url: l.profile.source_url, list_url: l.profile.source_url }));
}
export function applyRecheck(work, entries, verdicts, { at }) {
  const stats = { rechecked: 0, now_australian: 0, rejected: 0 };
  for (const e of entries) {
    const lead = (work.job_leads ?? []).find((l) => l.id === e.lead_id);
    const v = verdicts?.get(e.key);
    if (!lead || !v) continue;
    stats.rechecked += 1;
    lead.profile.read_at = at;
    if (v.status === 'rejected') { lead.status = 'rejected'; lead.note = `${lead.note} Read again on ${at.slice(0, 10)}: the directory's own check found evidence it is not Australian or not a startup.`; stats.rejected += 1; continue; }
    if (v.status === 'matched') { const c = (work.companies ?? []).find((x) => x.name === v.match); if (c) { lead.status = 'in_directory'; lead.resolved_to = c.id; } continue; }
    lead.profile.australian = v.australian; lead.profile.startup = v.startup;
    if (['yes', 'likely'].includes(v.australian)) stats.now_australian += 1;
  }
  return stats;
}

// What the entries say about the directory. Writes into `work`: leads only. Returns the counts.
// `verdicts` (judgeEntries): what the engine made of each company's own website. Without them every company that is not ours is a lead, unjudged.
export function applyPortfolio(work, source, entries, { at, verdicts = null }) {
  const stats = { entries: entries.length, in_directory: 0, already_queued: 0, same_name: 0, no_site: 0, leads_new: 0, leads_seen: 0, settled: 0, rejected_by_check: 0 };
  const index = buildIndex(work);
  work.job_leads ??= [];
  for (const e of entries) {
    const leadId = `lead-${slugify(e.name).slice(0, 60)}`;
    const c = classify(e, index);
    if (c.kind === 'no_site') { stats.no_site += 1; continue; }
    if (c.kind === 'company') {
      stats.in_directory += 1;
      for (const l of work.job_leads) if (l.id === leadId && ['needs_review', 'queued'].includes(l.status)) { l.status = 'in_directory'; l.resolved_to = c.exact.target.id; l.last_seen_at = at; stats.settled += 1; }
      continue;
    }
    if (c.kind === 'candidate') { stats.already_queued += 1; continue; }
    if (c.kind === 'same_name') { stats.same_name += 1; continue; }
    const v = verdicts?.get(e.key) ?? null;
    // The engine read its own site and found explicit evidence that it is not Australian or not a startup (it moved the candidate to rejected), or that it is a company we hold after all.
    if (v?.status === 'rejected') { stats.rejected_by_check += 1; continue; }
    if (v?.status === 'matched') { stats.in_directory += 1; continue; }
    const url = e.profile_url ?? e.list_url;
    let lead = work.job_leads.find((l) => l.id === leadId);
    if (!lead) {
      lead = { id: leadId, kind: 'unknown_company', name: e.name, status: 'needs_review', seen_on: [], first_seen_at: at, last_seen_at: at,
        note: `Named by ${source.publisher}'s official portfolio page; the directory does not hold it. The page does not say where it is: whether it is Australian and a startup is judged from its own website when it is queued (jobsync leads --promote).` };
      work.job_leads.push(lead);
      stats.leads_new += 1;
    } else stats.leads_seen += 1;
    lead.last_seen_at = at;
    if (!lead.seen_on.some((x) => normUrl(x.url) === normUrl(url))) lead.seen_on = [...lead.seen_on, { firm: source.id, url, title: `${e.name} | ${source.publisher} portfolio`, at }].slice(-5);
    // The page's own facts, kept when the lead has none yet (a company a network profile already described keeps that description).
    lead.profile ??= { website: e.website, domain: canonicalDomain(e.website)?.domain ?? null, description: String(e.description ?? '').slice(0, 300), locations: [], employees: null, founded: null, stage: null, org_type: null, industries: [], active_jobs: null, source_url: url, read_at: at, origin: 'portfolio' };
    if (v && lead.profile.origin === 'portfolio') { lead.profile.australian = v.australian; lead.profile.startup = v.startup; if (v.match) lead.profile.resembles = v.match; }
  }
  return stats;
}

export { SOURCES };
