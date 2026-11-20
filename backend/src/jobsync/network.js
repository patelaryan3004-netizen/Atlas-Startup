// Job networks: a community's own job board (Innovation Bay) as a place to DISCOVER companies and vacancies, never as a place roles are copied from.
//
// Innovation Bay's board (jobs.innovationbay.com) is a Getro network, like the venture firms' portfolio boards (vc.js), and the same limits hold. What its public pages serve to any browser:
//   the board page          the newest 20 of ~9,000 jobs, worldwide and not filtered by place: a SAMPLE (vc.js treats every Getro board this way)
//   sitemap_companies.xml   the company pages the site itself lists for crawlers (its robots.txt names the sitemap): ~415 companies
//   a company page          the company's profile (name, website, places, size, industries, whether it has open jobs); its jobs are drawn by script from Getro's API
// What it does not serve: the list of jobs. That is Getro's API, which needs a key Getro issues to the board's owner (Innovation Bay) and whose robots.txt refuses everything else. So there is
// NO feed here to integrate with: the vacancies still come from each employer's own feed (adapters.js), and this module only finds employers and says which of them to look at.
//
// What a read of a network does, all of it outside the language models and the paid services:
//   1. the board page, checked to be Innovation Bay's (its own data names the network), its sample handed to vc.js applySample: a company we hold whose job links to a supported board is a
//      `review` row (confirm.js asks the EMPLOYER's own feed before it is read), an Australian company we do not hold is a lead;
//   2. the company list, a slice of it each run by rotation (every company once a week, nothing saved between runs), each profile read at the site's own pace (10 s: the delay its robots.txt
//      asks of the crawlers it names), then matched against the directory with the project's own resolver (website domain and name):
//        in the directory, hiring, no approved board   its own website is looked at for a job board at the next refresh (job_coverage.hiring_hint_at)
//        in the directory, on the network's list       a lead the owner had been shown for it is settled (in_directory)
//        not in the directory, Australian, eligible    a lead (needs_review); `jobsync leads --promote` hands it to the directory's own review queue (candidates.json)
//        a venture firm                                a lead of its own kind: unknown_investor, or investor_hiring for a firm we hold that is hiring but is not one of the firms checked
//        anywhere else                                 counted, nothing kept
// A role is shown once, whichever way it was found, because this module never stores a role: dedupe.js has nothing of Innovation Bay's to remove.
import { FetchPolicyError } from '../discovery/http.js';
import { buildIndex, identityOfLead, resolveLead, OUTCOMES } from '../discovery/resolve.js';
import { canonicalDomain } from '../models/identity.js';
import { slugify } from '../models/company.js';
import { readPlace } from './locations.js';
import { rotationBucket, blockOf, ROTATION_BLOCKS } from './discover.js';
import { classifyBoard, networkOf, sightingOf, VC_FIRMS } from './vc.js';

const HOUR = 3600000;
const DAY = 86400000;

// `delay_ms`: the pace between two requests to the site (its robots.txt asks 10 s of the crawlers it names; this fetcher is not one of them, and keeps to it anyway).
export const NETWORKS = [
  {
    id: 'innovation-bay', name: 'Innovation Bay', network: 'innovation-bay', label: 'Innovation Bay\'s job board',
    board: 'https://jobs.innovationbay.com/jobs', sitemap: 'https://jobs.innovationbay.com/sitemap_companies.xml', origin: 'https://jobs.innovationbay.com', delay_ms: 10000,
  },
];

// Profiles read per refresh: a week's rotation of ~415 companies is ~30 a run; the cap is what a slow site cannot stretch (45 reads at 10 s is under eight minutes).
export const NETWORK_READS_PER_RUN = 45;
// A company with more people than this is not an early-stage startup; the directory's own relevance check (discovery/relevance.js) judges the rest when it is queued.
const MAX_EMPLOYEES = 1000;
// Reasons the site is not to be asked again this run, whatever else is on the list.
const STOP_CODES = new Set(['robots_disallow', 'robots_unavailable', 'access_controlled', 'rate_limited']);

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const keyOf = (name) => String(name ?? '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
const nextData = (html) => { try { return JSON.parse(String(html).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)[1]); } catch (e) { return null; } };
const iso = (ms) => new Date(ms).toISOString();

// ---------- reading ----------

// The company pages a sitemap lists, once each: [{ slug, url, lastmod }].
export function parseCompanySitemap(xml, origin) {
  const out = new Map();
  for (const m of String(xml).matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = (m[1].match(/<loc>\s*([^<\s]+)\s*<\/loc>/) ?? [])[1];
    if (!loc || !loc.startsWith(`${origin}/companies/`)) continue;
    const slug = loc.slice(`${origin}/companies/`.length).replace(/\/+$/, '');
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug) || out.has(slug)) continue;
    out.set(slug, { slug, url: loc, lastmod: (m[1].match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/) ?? [])[1] ?? null });
  }
  return [...out.values()];
}

// What a company page says about the company. null for a page that is not a company profile.
export function profileOf(html, url) {
  const c = nextData(html)?.props?.pageProps?.company;
  if (!c || typeof c.name !== 'string' || !clean(c.name)) return null;
  const domain = clean(c.domain).toLowerCase().replace(/^www\./, '') || null;
  const site = clean(c.websiteUrl) || (domain ? `https://${domain}` : '');
  const employees = Number.isFinite(c.approxEmployees) ? c.approxEmployees : (Number.isFinite(c.headCount) ? c.headCount : null);
  const jobs = Number.isFinite(c.activeJobsCount) ? Math.max(0, c.activeJobsCount) : (c.hasActiveJobs ? 1 : 0);
  return {
    name: clean(c.name).slice(0, 120), slug: clean(c.slug) || null, source_url: url, website: /^https?:\/\/\S+$/.test(site) ? site : null, domain,
    description: clean(c.description).slice(0, 300), founded: clean(c.founded) || null, employees, org_type: clean(c.orgType).toLowerCase() || null, stage: clean(c.stage) || null,
    industries: (c.industryTags ?? []).filter((t) => typeof t === 'string').slice(0, 8), locations: (c.locations ?? []).map((l) => clean(l?.name)).filter(Boolean).slice(0, 5),
    active_jobs: jobs, hiring: Boolean(c.hasActiveJobs) || jobs > 0,
  };
}

export const isInvestorProfile = (p) => p.industries.some((t) => /venture capital|private equity/i.test(t));
export const isAustralianProfile = (p) => p.locations.some((l) => readPlace(l)?.au) || /\.au$/.test(p.domain ?? '');

// Could this be a startup the directory should consider? Not a verdict (the directory's own relevance check judges it from the company's own site): it keeps out what is plainly not one.
export function eligibility(p) {
  const why = [];
  if (!p.website) why.push('no website to check it against');
  if (isInvestorProfile(p)) why.push('a venture firm, not a startup');
  if (p.employees != null && p.employees > MAX_EMPLOYEES) why.push(`about ${p.employees} people`);
  if (/public|government/.test(p.org_type ?? '')) why.push(`organisation type "${p.org_type}"`);
  return { ok: why.length === 0, why };
}

// One network: its row for job_vc_boards.json, the sample the board served, and the profiles read in this run's slice of the company list. Never throws for a site that refuses or fails.
// `covered(entry)` true: the company page is not worth a read (the directory holds the company and its job board is read). `force`: every company, not this block's.
export async function readNetwork(net, { fetcher, now = Date.now, covered = () => false, limit = NETWORK_READS_PER_RUN, force = false, profiles: wantProfiles = true, shouldStop = () => false } = {}) {
  const at = iso(now());
  const row = { id: net.id, investor_id: null, name: net.name, board_url: net.board, platform: 'getro', access: 'unread', evidence_url: net.board, checked_at: at, own_vacancies: '', note: '', next_check_at: iso(now() + 11 * HOUR) };
  const stats = { listed: 0, in_slice: 0, skipped_covered: 0, read: 0, errors: 0, deferred: 0, stopped: null };
  const out = { row, sample: [], profiles: [], stats };
  const fail = (note) => { row.note = note; row.next_check_at = iso(now() + 12 * HOUR); return out; };

  let page;
  try { page = await fetcher.get(net.board); } catch (err) {
    if (!(err instanceof FetchPolicyError)) throw err;
    stats.stopped = STOP_CODES.has(err.code) ? err.code : null;
    return fail(`The board (${net.board}) was not read: ${err.code}.`);
  }
  const seen = classifyBoard(page.text, new URL(page.finalUrl).hostname);
  if (seen.platform !== 'getro' || networkOf(page.text) !== net.network) return fail(`The page at ${net.board} was not confirmed as ${net.name}'s board (its own data names network ${networkOf(page.text) ?? 'none'}), so it is not used.`);
  row.access = 'public_sample';
  out.sample = seen.jobs.map((j) => sightingOf(j, { id: net.id }, at)).filter(Boolean);
  const notes = [`A Getro network: its page serves the newest ${seen.jobs.length} of ${seen.total ?? 'many'} jobs, worldwide and not filtered by place, so it is a sample and never a source of roles.`,
    'The rest are in Getro\'s API, which needs a key that Getro issues to the board\'s owner, and whose robots.txt refuses every other client: no feed is used.'];

  if (!wantProfiles) { row.note = notes.join(' '); return out; }
  let list;
  try {
    const sitemap = await fetcher.get(net.sitemap, { accept: 'application/xml,text/xml', allow: ['application/xml', 'text/xml'] });
    list = parseCompanySitemap(sitemap.text, net.origin);
  } catch (err) {
    if (!(err instanceof FetchPolicyError)) throw err;
    stats.stopped = STOP_CODES.has(err.code) ? err.code : null;
    row.note = [...notes, `Its company list (${net.sitemap}) was not read: ${err.code}.`].join(' ');
    return out;
  }
  stats.listed = list.length;
  const block = blockOf(now()) % ROTATION_BLOCKS;
  const slice = force ? list : list.filter((e) => rotationBucket(e.slug) === block);
  stats.in_slice = slice.length;
  const todo = slice.filter((e) => { if (covered(e)) { stats.skipped_covered += 1; return false; } return true; });
  let consecutive = 0;
  for (const entry of todo) {
    if (stats.read + stats.errors >= limit || shouldStop() || stats.stopped) break;
    try {
      const p = profileOf((await fetcher.get(entry.url)).text, entry.url);
      stats.read += 1;
      consecutive = 0;
      if (p) out.profiles.push({ ...p, read_at: iso(now()) });
    } catch (err) {
      if (!(err instanceof FetchPolicyError)) throw err;
      stats.errors += 1;
      consecutive += 1;
      if (STOP_CODES.has(err.code)) stats.stopped = err.code;
      else if (consecutive >= 3) stats.stopped = 'repeated_errors';
    }
  }
  stats.deferred = Math.max(0, todo.length - stats.read - stats.errors);
  row.profiles_block = blockOf(now());
  notes.push(`Its company list names ${list.length} companies; ${stats.read} company page${stats.read === 1 ? '' : 's'} read in this refresh${stats.deferred ? ` (${stats.deferred} wait for the next)` : ''}, each company once a week.`);
  if (stats.stopped) notes.push(`Reading stopped early: ${stats.stopped}.`);
  row.note = notes.join(' ');
  return out;
}

// ---------- matching ----------

// The venture firms the directory holds, by website domain and by name.
function investorLookup(work) {
  const byDomain = new Map();
  const byName = new Map();
  for (const i of work.investors ?? []) {
    const d = canonicalDomain(i.website)?.domain;
    if (d) byDomain.set(d, i);
    for (const n of [i.name, ...(i.aliases ?? [])]) { const k = keyOf(n); if (k) byName.set(k, i); }
  }
  return (p) => (p.website && byDomain.get(canonicalDomain(p.website)?.domain)) || byName.get(keyOf(p.name)) || null;
}

// Which company pages are worth no read: the directory holds the company (its id, or its name, is the page's slug or name) and a board of it is already read.
export function coveredBy(work) {
  const approved = new Set((work.job_sources ?? []).filter((s) => s.status === 'approved').map((s) => s.company_id));
  const byKey = new Map();
  for (const c of work.companies ?? []) { for (const k of new Set([keyOf(c.name), keyOf(c.slug)])) if (k) byKey.set(k, byKey.has(k) ? null : c); }
  return (entry) => { const c = byKey.get(keyOf(entry.slug)); return Boolean(c && approved.has(c.id)); };
}

const profileFor = (p, at) => ({ website: p.website, domain: p.domain, description: p.description, locations: p.locations, employees: p.employees, founded: p.founded, stage: p.stage, org_type: p.org_type, industries: p.industries, active_jobs: p.active_jobs, source_url: p.source_url, read_at: p.read_at ?? at });

function upsertLead(work, p, net, { kind, id, investor_id = null, note, at }) {
  work.job_leads ??= [];
  let lead = work.job_leads.find((l) => l.id === id);
  let created = false;
  if (!lead) {
    lead = { id, kind, name: p.name, status: 'needs_review', seen_on: [], first_seen_at: at, last_seen_at: at, note };
    if (investor_id) lead.investor_id = investor_id;
    work.job_leads.push(lead);
    created = true;
  }
  lead.last_seen_at = at;
  lead.profile = profileFor(p, at);
  if (!lead.seen_on.some((x) => x.url === p.source_url)) lead.seen_on = [...lead.seen_on, { firm: net.id, url: p.source_url, title: `${p.name} | ${net.name} company list`, at }].slice(-5);
  return created;
}

// What the profiles read in this run say about the directory. Writes into `work`: leads, and the hint that a hiring company without a board is worth a look. Returns the counts.
export function applyProfiles(work, net, profiles, { at, now = Date.now }) {
  const stats = { read: profiles.length, in_directory: 0, hiring_without_board: 0, hints: 0, already_queued: 0, leads_new: 0, leads_seen: 0, investors_known: 0, investor_leads: 0, outside_australia: 0, ineligible: 0, settled: 0, same_name: 0, self: 0 };
  const index = buildIndex(work);
  const investorOf = investorLookup(work);
  const approved = new Set((work.job_sources ?? []).filter((s) => s.status === 'approved').map((s) => s.company_id));
  const checkedFirms = new Set(VC_FIRMS.map((f) => f.investor_id).filter(Boolean));
  const own = keyOf(net.name);
  for (const p of profiles) {
    if (keyOf(p.name) === own) { stats.self += 1; continue; } // the network lists itself
    const leadId = `lead-${slugify(p.name).slice(0, 60)}`;
    const r = resolveLead(identityOfLead({ name: p.name, website: p.website }), index);
    const exact = r.outcome === OUTCOMES.EXACT ? r.best : null;

    if (exact?.target.kind === 'company') {
      stats.in_directory += 1;
      const company = work.companies.find((c) => c.id === exact.target.id);
      for (const l of work.job_leads ?? []) if (l.id === leadId && ['needs_review', 'queued'].includes(l.status)) { l.status = 'in_directory'; l.resolved_to = company.id; l.last_seen_at = at; stats.settled += 1; }
      if (p.hiring && !approved.has(company.id)) {
        stats.hiring_without_board += 1;
        // A company the directory holds that the network says is hiring, with no job board of its own read yet: its website is looked at at the next refresh instead of at its turn in the week
        // (discover.js dueForDiscovery). Not again within a day of the last look.
        const cover = (work.job_coverage ?? []).find((x) => x.company_id === company.id);
        if (cover && (!cover.checked_at || now() - Date.parse(cover.checked_at) > DAY) && cover.hiring_hint_at !== at) { cover.hiring_hint_at = at; stats.hints += 1; }
      }
      continue;
    }
    if (exact?.target.kind === 'candidate') { stats.already_queued += 1; continue; }
    // The same name as a company or a pending candidate we hold, with another website on record (a rebrand, a second domain, a site we never recorded): in the 415 it is Goterra, Qwilr, Eftsure,
    // Presien and the like, all already ours, and a person would only be asked to confirm each. Counted, not queued. A looser resemblance ("a very similar name") is still a lead, naming what it resembles.
    if (!isInvestorProfile(p) && r.best?.signals.some((x) => ['name_exact', 'name_legal', 'name_alias', 'name_former'].includes(x.code))) { stats.same_name += 1; continue; }

    if (isInvestorProfile(p)) {
      const firm = investorOf(p);
      if (firm) {
        stats.investors_known += 1;
        if (p.hiring && !checkedFirms.has(firm.id)) {
          const note = `${net.name}'s company list says ${firm.name} has open roles. Its own careers page is not one of the venture firms the sync checks, so those roles are not on the board. Add the firm to VC_FIRMS (jobsync/vc.js) to have them read.`;
          if (upsertLead(work, p, net, { kind: 'investor_hiring', id: `lead-investor-hiring-${firm.id}`, investor_id: firm.id, note, at })) stats.investor_leads += 1;
        }
      } else if (isAustralianProfile(p)) {
        if (upsertLead(work, p, net, { kind: 'unknown_investor', id: leadId, note: `Named by ${net.label}: a venture firm with an Australian place that the investor directory does not hold. Approve it through the investor directory, or reject it.`, at })) stats.investor_leads += 1;
      } else stats.outside_australia += 1;
      continue;
    }
    if (!isAustralianProfile(p)) { stats.outside_australia += 1; continue; }
    const el = eligibility(p);
    if (!el.ok) { stats.ineligible += 1; continue; }
    const maybe = r.best ? ` It may be the same as ${r.best.target.name} (${r.best.outcome.toLowerCase().replace('_', ' ')}).` : '';
    const note = `Named by ${net.label} company list with an Australian place; the directory does not hold it.${maybe} Approve it to add it, or reject it.`;
    if (upsertLead(work, p, net, { kind: 'unknown_company', id: leadId, note, at })) stats.leads_new += 1; else stats.leads_seen += 1;
  }
  return stats;
}

// ---------- the directory's own review queue ----------

// The leads `jobsync leads --promote` hands to the directory's review queue: a startup the network names, Australian, eligible, with a website, that nobody has decided on yet.
export function queueable(work, { limit = Infinity, firm = null } = {}) {
  return (work.job_leads ?? []).filter((l) => l.kind === 'unknown_company' && l.status === 'needs_review' && l.profile?.website && (!firm || l.seen_on?.some((x) => x.firm === firm))).slice(0, limit);
}

// A lead as the discovery engine takes it (the same shape the portfolio importer gives it): the engine matches it against the directory and the queue again, reads the company's OWN website
// (robots.txt obeyed, three pages at most) and judges whether it is Australian and a startup.
export function engineLead(lead, net) {
  const p = lead.profile;
  return {
    key: lead.id, name: lead.name, website: p.website, url: p.source_url, title: `${lead.name} | ${net.name} company list`, publisher: net.name, observed_at: p.read_at, retrieved_at: p.read_at,
    city: null, state: null, founders: [], evidence: [], text: [p.description, ...(p.industries ?? [])].filter(Boolean).join('. '),
  };
}

// After the engine ran: each queued lead is marked with the candidate that now waits in the review queue (or settled, when the engine says the directory already holds the company).
export function markQueued(work, net, { at }) {
  const out = { queued: 0, in_directory: 0, rejected: 0, left: 0 };
  for (const lead of queueable(work, { firm: net.id })) {
    const cand = (work.candidates ?? []).find((c) => c.discoveries?.some((d) => d.source_id === net.id && d.key === lead.id));
    if (!cand) { out.left += 1; continue; }
    if (cand.status === 'matched' && cand.matches?.[0]?.kind === 'company') { lead.status = 'in_directory'; lead.resolved_to = cand.matches[0].id; out.in_directory += 1; }
    else if (cand.status === 'rejected') { lead.status = 'rejected'; lead.note = `${lead.note} The directory's own check rejected it (${cand.id}): see its history there.`; out.rejected += 1; }
    else { lead.status = 'queued'; lead.candidate_id = cand.id; lead.candidate_status = cand.status; out.queued += 1; }
    lead.last_seen_at = at;
  }
  return out;
}

