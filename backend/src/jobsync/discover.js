// Finding the job board of every company in the directory, from the company's OWN website.
//
// This is the same reader the hiring job has always used (enrichment/boards.js: the careers page, or a careers link on the homepage, that points at a Greenhouse, Lever, Workable,
// Ashby, Recruitee or SmartRecruiters board), run over the whole directory instead of the few companies the slower job happened to reach, and with its result written down for EVERY
// company, found or not:
//
//   board                 the company's own page links to a board the sync can read, and the board's feed answered with a whole list. Approved: a sources.json row and a job_sources row.
//   board_unreadable      its page links to a board we can read, but the feed would not answer (gone, refused, malformed). Review.
//   unsupported_provider  its page links to a hosted job board the sync does not read (SmartRecruiters: robots.txt forbids it; BambooHR, Teamtailor, Rippling ...). Review.
//   careers_page_only     it has a careers page but no link to any job board we recognise in what a plain page read shows (a board drawn by script is not visible to us). Review.
//   no_careers_found      no careers page or link found. Review.
//   unreadable            the website would not answer or refuses robots. Review (tried again later).
//   no_website            the record has no website. Nothing to read.
//
// Nothing here guesses: a board is approved only when the company's own page links to it; a token is never invented or tried; a board that is only named elsewhere (a venture firm's
// board, a suggestion) is a `review` row of job_sources.json until the company's own page confirms it.
import { readSite, pickPages } from '../discovery/enrich.js';
import { FetchPolicyError } from '../discovery/http.js';
import { links } from '../discovery/html.js';
import { PROVIDERS as STOCK, detectBoards } from '../enrichment/boards.js';
import { readSource, SyncError } from './adapters.js';
import { SUPPORTED, UNSUPPORTED_REASONS } from './providers.js';
import { REVIEW_OUTCOMES } from '../models/jobDiscovery.js';

// A company that has no job board we read is looked at again every WEEK, by rotation rather than by a stored clock: the 14 half-day blocks of a week each take the companies whose id falls in
// that block (rotationBucket), so every such company is looked at once a week, a company never looked at is looked at at once, and nothing about the schedule has to be saved between runs (a
// refresh that commits nothing loses no progress). A company with a board is not looked at again unless its board has failed three times in a row.
export const ROTATION_BLOCKS = 14;
export const BLOCK_MS = 12 * 3600000;
export const rotationBucket = (id) => { let h = 2166136261; for (const ch of String(id)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h % ROTATION_BLOCKS; };
export const blockOf = (ms) => Math.floor(ms / BLOCK_MS);

// Providers the sync reads that the stock careers-page reader (enrichment/boards.js) does not know: how their boards are recognised in a page. A token is only ever one a page names.
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,60}$/;
const NOT_A_TENANT = /^(?:www|app|api|help|support|docs|documentation|careers|career|blog|status|login|go|my|admin|static|cdn|marketing|resources|learn|info|partners|developers|developer|community|trust|security)$/i;
export const EXTRA_PROVIDERS = [
  { id: 'breezy', name: 'Breezy', detect: [/([a-z0-9-]+)\.breezy\.hr/g], page: (t) => `https://${t}.breezy.hr/` },
  { id: 'pinpoint', name: 'Pinpoint', detect: [/([a-z0-9-]+)\.pinpointhq\.com/g], page: (t) => `https://${t}.pinpointhq.com/` },
  { id: 'bamboohr', name: 'BambooHR', detect: [/([a-z0-9-]+)\.bamboohr\.com/g], page: (t) => `https://${t}.bamboohr.com/careers` },
  { id: 'teamtailor', name: 'Teamtailor', detect: [/([a-z0-9-]+)\.teamtailor\.com/g], page: (t) => `https://${t}.teamtailor.com/jobs` },
  { id: 'rippling', name: 'Rippling', detect: [/ats\.rippling\.com\/(?:embed\/)?(?:[a-z]{2}-[A-Za-z]{2}\/)?([A-Za-z0-9_-]+)/g], page: (t) => `https://ats.rippling.com/${t}/jobs` },
];
const ALL_PROVIDERS = [...STOCK, ...EXTRA_PROVIDERS];

// What a set of pages names, as { provider, token }: a page reached by a careers link is searched whole, any other page only in the links that look like careers links (the same rule as
// detectBoards). At most three boards.
export function detectExtra(pages) {
  const found = [];
  for (const page of pages) {
    const sources = page.careers === true ? [page.html] : links(page.html, page.finalUrl).filter((l) => CAREERS_TEXT.test(l.text) || CAREERS_PATH.test(pathOf(l.href))).map((l) => l.href);
    for (const provider of EXTRA_PROVIDERS) {
      for (const re of provider.detect) {
        for (const m of String(sources.join('\n')).matchAll(re)) {
          const token = m[1];
          if (!TOKEN.test(token) || NOT_A_TENANT.test(token) || ['jobs', 'job', 'embed', 'static', 'assets', '_next'].includes(token.toLowerCase())) continue;
          if (!found.some((f) => f.provider.id === provider.id && f.token.toLowerCase() === token.toLowerCase())) found.push({ provider, token });
        }
      }
    }
  }
  return found;
}

// Hosted job boards the sync does not read, recognised only so the coverage report can say which companies are waiting on which provider. Not feeds; never fetched.
const OTHER_BOARDS = [
  [/(^|\.)bamboohr\.com$/i, null], [/(^|\.)teamtailor\.com$/i, null], [/(^|\.)pinpointhq\.com$/i, null], [/(^|\.)personio\.(?:de|com)$/i, 'Personio'],
  [/(^|\.)rippling\.com$/i, null], [/(^|\.)breezy\.hr$/i, null], [/(^|\.)applytojob\.com$/i, 'JazzHR'], [/(^|\.)hirehive\.com$/i, 'HireHive'], [/(^|\.)comeet\.com$/i, 'Comeet'],
  [/(^|\.)jobvite\.com$/i, 'Jobvite'], [/(^|\.)icims\.com$/i, 'iCIMS'], [/(^|\.)myworkdayjobs\.com$/i, 'Workday'], [/(^|\.)successfactors\.(?:com|eu)$/i, 'SuccessFactors'],
  [/(^|\.)livehire\.com$/i, 'LiveHire'], [/(^|\.)jobadder\.com$/i, 'JobAdder'], [/(^|\.)elmotalent\.com\.au$/i, 'ELMO'], [/(^|\.)employmenthero\.com$/i, 'Employment Hero'],
  [/(^|\.)workable\.com$/i, null], // Workable boards are read (boards.js), and a workable.com link that is not a board is nothing
  [/(^|\.)notion\.site$/i, 'a Notion page'], [/(^|\.)zohorecruit\.(?:com|com\.au)$/i, 'Zoho Recruit'], [/(^|\.)recruiterbox\.com$/i, 'Recruiterbox'], [/(^|\.)hrmdirect\.com$/i, 'HRMDirect'],
  [/(^|\.)smartrecruiters\.com$/i, null], // read as a board by boards.js, said unsupported there
];
// Every hosted job-board host, read or not: a link to one is a board, never a careers page to follow.
export const OTHER_BOARDS_FOR_VC = new RegExp([...OTHER_BOARDS.map(([re]) => re.source), '(^|\\.)(?:greenhouse\\.io|lever\\.co|ashbyhq\\.com|workable\\.com|recruitee\\.com|smartrecruiters\\.com)$'].join('|'), 'i');
const CAREERS_PATH = /careers?|jobs|join|work-?with|vacanc|opportunit|hiring|openings/i;
const CAREERS_TEXT = /careers?|jobs?|join (?:us|our|the)|work (?:with|at|for) us|we.?re hiring|open (?:roles|positions)|vacanc/i;
const hostOf = (href) => { try { return new URL(href).hostname; } catch (e) { return ''; } };
const pathOf = (href) => { try { return new URL(href).pathname; } catch (e) { return ''; } };

// The page (of those read) that linked to this board, for the record of why it is trusted.
function evidencePage(pages, provider, token) {
  for (const page of pages) {
    for (const re of provider.detect) {
      for (const m of String(page.html).matchAll(re)) if (String(m[1]).toLowerCase() === token.toLowerCase()) return page.finalUrl;
    }
  }
  return pages[0]?.finalUrl ?? null;
}

// The pages that can name a board, read in a bounded way (6 at most, the fetcher's own pacing and robots.txt): the homepage; the careers links it carries (the company's own domain, its
// careers./jobs. subdomain, or one separate careers domain it links to by name, e.g. a 'See careers' link); the jobs page those link to; and one job page, because an apply button is
// often the only place a board is named. A page is marked careers: true when it was reached by a careers link: it is then searched whole for a board (enrichment/boards.js).
const DEEPER = /(?:^|\/)(?:jobs?|positions?|openings?|open-roles?|roles|vacanc\w*|opportunit\w*|current-\w+|join-us|work-with-us)(?:\/|$)/i;
const NOT_JOBS = /blog|verify|scam|fraud|privacy|terms|policy|news|press|events?|about|culture|benefits|diversity/i;
export async function readCareersSite(website, { fetcher, now }) {
  const site = await readSite(website, { fetcher, now, maxPages: 1 });
  if (site.pages.length === 0) return site;
  // The company's own hosts: the one on record, and the one the homepage actually answered from (a record that says .vc and a site that has moved to .health).
  const owns = [...new Set([site.domain?.host, hostOf(site.pages[0].finalUrl)].filter(Boolean).map((h) => h.replace(/^www\./, '')))];
  const same = (href) => { const h = hostOf(href).replace(/^www\./, ''); return owns.some((own) => h === own || h.endsWith(`.${own}`) || own.endsWith(`.${h}`)); };
  const seen = new Set(site.pages.map((p) => p.finalUrl.replace(/\/$/, '')));
  const read = async (url, careers) => {
    const key = url.replace(/\/$/, '');
    if (seen.has(key) || site.pages.length >= 6) return null;
    seen.add(key);
    try {
      const res = await fetcher.get(url);
      const page = { url: res.url, finalUrl: res.finalUrl, status: res.status, html: res.text, careers };
      site.pages.push(page);
      return page;
    } catch (err) {
      if (!(err instanceof FetchPolicyError)) throw err;
      site.errors.push({ url, code: err.code, message: err.message });
      return null;
    }
  };
  const isBoardHost = (h) => OTHER_BOARDS.some(([re]) => re.test(h)) || ALL_PROVIDERS.some((p) => p.detect.some((re) => new RegExp(re.source, 'i').test(`https://${h}/x`)));
  const careersLinks = (page) => links(page.html, page.finalUrl).filter((l) => !/\.(?:pdf|png|jpe?g|gif|svg|zip|docx?)$/i.test(l.href) && !isBoardHost(hostOf(l.href)) && (CAREERS_TEXT.test(l.text) || CAREERS_PATH.test(pathOf(l.href)) || /^(?:jobs|careers)\./i.test(hostOf(l.href))));
  const home = site.pages[0];
  let fromHome = careersLinks(home);
  // A homepage with no careers link of its own (a thin landing page): the pages it does link to (about, contact) often carry one.
  if (!fromHome.some((l) => same(l.href))) {
    for (const url of pickPages(home.html, home.finalUrl, 2, ['jobs', 'hiring_status'])) { const p = await read(url, false); if (p) fromHome = [...fromHome, ...careersLinks(p)]; }
  }
  const ownLinks = fromHome.filter((l) => same(l.href));
  const outside = fromHome.filter((l) => !same(l.href) && CAREERS_TEXT.test(l.text) && !/^(?:www\.)?(?:linkedin|facebook|twitter|x|instagram|youtube|seek|indeed|glassdoor)\./i.test(hostOf(l.href)));
  const first = [...ownLinks.slice(0, 2), ...outside.slice(0, 1)].map((l) => l.href);
  const careersPages = [];
  for (const url of first) { const p = await read(url, true); if (p) careersPages.push(p); }
  // The jobs page a careers page points at, when the careers page itself shows no board.
  for (const cp of careersPages.slice(0, 2)) {
    const deeper = links(cp.html, cp.finalUrl).filter((l) => same(l.href) && DEEPER.test(pathOf(l.href)) && !NOT_JOBS.test(pathOf(l.href)) && !isBoardHost(hostOf(l.href)));
    if (deeper[0]) await read(deeper[0].href, true);
    if (site.pages.length >= 5) break;
  }
  // One job page: the careers page lists its jobs on its own address, and the apply button on one of them names the board.
  for (const cp of careersPages.slice(0, 1)) {
    const base = pathOf(cp.finalUrl).replace(/\/$/, '');
    const child = links(cp.html, cp.finalUrl).find((l) => same(l.href) && base.length > 1 && pathOf(l.href).startsWith(`${base}/`) && pathOf(l.href).length > base.length + 3 && !NOT_JOBS.test(pathOf(l.href)) && !seen.has(l.href.replace(/\/$/, '')));
    if (child) await read(child.href, true);
  }
  site.retrieved_at = new Date(now()).toISOString();
  return site;
}

// The bare or www host of a vendor (bamboohr.com, www.teamtailor.com): its marketing site. A company's board is on a tenant host (acme.bamboohr.com) or a path under the vendor's board host.
const isVendorHome = (host) => { const h = host.replace(/^www\./, ''); return h.split('.').length <= (/\.(?:com|co|org|net)\.[a-z]{2}$/.test(h) ? 3 : 2); };

// Careers links and links to hosted boards we do not read, from the pages read.
function surveyLinks(pages, ownDomain) {
  const careers = [];
  const others = [];
  for (const page of pages) {
    for (const l of links(page.html, page.finalUrl)) {
      const host = hostOf(l.href);
      const hit = OTHER_BOARDS.find(([re]) => re.test(host));
      if (hit?.[1] && isVendorHome(host)) continue; // "Powered by BambooHR": the vendor's own site, not a company's board
      if (hit?.[1]) { others.push({ provider: hit[1].toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: hit[1], host, url: l.href.replace(/^http:/i, 'https:') }); continue; }
      if (CAREERS_TEXT.test(l.text) || CAREERS_PATH.test(pathOf(l.href))) {
        const own = host.replace(/^www\./, '').endsWith(ownDomain);
        if (own || /^(?:jobs|careers)\./.test(host)) careers.push(l.href);
      }
    }
  }
  return { careers: [...new Set(careers)], others: [...new Map(others.map((o) => [`${o.provider}`, o])).values()] };
}

// Looks at one company's own website. Returns the coverage row's content, plus `verified`: the boards that were read whole (with how many jobs they list), which the caller turns into
// sources. Never throws for a site that refuses or fails: that is an outcome.
export async function discoverCompany(company, { fetcher, now = Date.now, readOptions = {} } = {}) {
  const at = new Date(now()).toISOString();
  const row = { company_id: company.id, checked_at: at, outcome: 'no_website', review: false, careers_url: null, boards: [], source_ids: [], note: '', next_check_at: null };
  const done = (outcome, note) => {
    row.outcome = outcome; row.review = REVIEW_OUTCOMES.has(outcome); row.note = note;
    return row; // when it is looked at next is the rotation's business (dueForDiscovery), not a stored date
  };
  if (!company.website) return { ...done('no_website', 'The record has no website, so there is no careers page to read.'), verified: [] };

  const site = await readCareersSite(company.website, { fetcher, now });
  if (site.pages.length === 0) {
    const e = site.errors[0];
    return { ...done('unreadable', `The website could not be read (${e?.code ?? 'no answer'}${e?.message ? `: ${String(e.message).slice(0, 120)}` : ''}).`), verified: [] };
  }
  const ownDomain = (site.domain?.host ?? hostOf(company.website)).replace(/^www\./, '');
  const survey = surveyLinks(site.pages, ownDomain);
  row.careers_url = survey.careers.find((u) => u.startsWith('https://')) ?? null;

  const verified = [];
  for (const { provider, token } of [...detectBoards(site.pages), ...detectExtra(site.pages)].slice(0, 3)) {
    const supported = SUPPORTED.includes(provider.id);
    const entry = { provider: provider.id, token, host: hostOf(provider.page(token)), url: provider.page(token), supported };
    if (!supported) {
      entry.reason = UNSUPPORTED_REASONS[provider.id] ?? 'the sync has no reader for this provider';
      row.boards.push(entry);
      continue;
    }
    try {
      const read = await readSource({ provider: provider.id, token }, { fetcher, now: now(), companyWebsite: company.website, retries: 1, ...readOptions });
      Object.assign(entry, { listed: read.seen.size, evidence_url: evidencePage(site.pages, provider, token) });
      verified.push({ ...entry, read }); // the whole read: the board is not asked again in this refresh (discoverRun.js applies it)
    } catch (err) {
      if (!(err instanceof SyncError)) throw err;
      entry.error = err.code;
      entry.message = String(err.message).slice(0, 160);
    }
    row.boards.push(entry);
  }
  // One board per provider per company (the source id is <company>-<provider>-jobs): when a page links to two of the same provider, the one whose name is the company's is kept, else the first.
  {
    const key = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const fits = (v) => { const t = key(v.token); return t.length > 2 && (key(company.id).includes(t) || t.includes(key(company.id)) || key(company.name).includes(t) || t.includes(key(company.name))) ? 1 : 0; };
    const best = new Map();
    for (const v of verified) { const cur = best.get(v.provider); if (!cur || fits(v) > fits(cur)) best.set(v.provider, v); }
    for (let i = verified.length - 1; i >= 0; i -= 1) {
      if (best.get(verified[i].provider) === verified[i]) continue;
      const dropped = verified.splice(i, 1)[0];
      const entry = row.boards.find((b) => b.provider === dropped.provider && b.token === dropped.token);
      if (entry) entry.note = 'a second board of the same provider on the same page: only one is approved per provider';
    }
  }
  for (const o of survey.others) if (!row.boards.some((b) => b.provider === o.provider)) row.boards.push({ provider: o.provider, token: null, host: o.host, url: o.url, supported: false, reason: `${o.name} boards are not read by the sync` });

  if (verified.length) return { ...done('board', `The company's own page links to ${verified.map((v) => `${ALL_PROVIDERS.find((p) => p.id === v.provider)?.name ?? v.provider} (${v.listed} listed)`).join(', ')}.`), verified };
  const readable = row.boards.filter((b) => b.supported);
  if (readable.length) return { ...done('board_unreadable', `The company's page links to ${readable.map((b) => b.provider).join(', ')}, but the feed would not answer (${readable.map((b) => b.error).join(', ')}).`), verified: [] };
  if (row.boards.length) return { ...done('unsupported_provider', `Its job board is on ${[...new Set(row.boards.map((b) => b.provider))].join(', ')}, which the sync does not read${row.boards.some((b) => b.reason) ? `: ${row.boards.find((b) => b.reason).reason}` : ''}.`), verified: [] };
  if (row.careers_url) return { ...done('careers_page_only', `It has a careers page (${row.careers_url}) but nothing on the pages read links to a job board we recognise (a board drawn by script is not visible to a plain page read).`), verified: [] };
  return { ...done('no_careers_found', 'No careers page or job-board link was found on the homepage or the pages it links to.'), verified: [] };
}

// What goes into the data for one result: the coverage row, and for each verified board a sources.json row (the company's own page links to it: that is what approves it). The
// catalogue (job_sources.json) is rebuilt from sources.json by buildCatalogue, so this does not write it.
export function applyDiscovery(work, company, result, { at }) {
  const { verified, ...row } = result;
  work.sources ??= [];
  work.job_coverage ??= [];
  const ids = [];
  for (const v of verified) {
    const id = `${company.id}-${v.provider}-jobs`;
    ids.push(id);
    const name = ALL_PROVIDERS.find((p) => p.id === v.provider)?.name ?? v.provider;
    const note = `The company's ${name} job board, which its careers page links to, read through the board's public feed.`;
    const existing = work.sources.find((s) => s.id === id);
    if (existing) { existing.retrieved_at = at; existing.url = v.url; continue; }
    work.sources.push({ id, kind: 'company_website', url: v.url, title: `${name} job board`, publisher: hostOf(company.website).replace(/^www\./, '') || company.name, retrieved_at: at, note: `${note} Linked from ${v.evidence_url ?? 'its website'}.` });
  }
  let full = { ...row, source_ids: ids };
  // A company whose board was approved earlier stays covered by it when this reading of its website finds nothing (the site was down, or draws its page by script today): the board is
  // still read every refresh, and a board that stops answering is flagged by its own state, not by this.
  const approved = (work.job_sources ?? []).filter((s) => s.company_id === company.id && s.status === 'approved' && SUPPORTED.includes(s.provider)).map((s) => s.id);
  if (full.outcome !== 'board' && approved.length) {
    full = { ...full, outcome: 'board', review: false, source_ids: approved, note: `Covered by ${approved.join(', ')} (approved from the company's own page earlier). This reading of its website: ${full.note}` };
  }
  const at0 = work.job_coverage.findIndex((r) => r.company_id === company.id);
  if (at0 === -1) work.job_coverage.push(full); else work.job_coverage[at0] = full;
  return full;
}

// A company with an approved board is covered by it, whatever its website said the last time it was looked at. Run after a pass so the ledger never says "for review" about a company whose
// board is being read. Returns how many rows it changed.
export function reconcileCoverage(work, { at }) {
  let n = 0;
  const approved = new Map();
  for (const s of work.job_sources ?? []) if (s.status === 'approved' && SUPPORTED.includes(s.provider)) approved.set(s.company_id, [...(approved.get(s.company_id) ?? []), s.id]);
  work.job_coverage ??= [];
  for (const company of work.companies) {
    const ids = approved.get(company.id);
    if (!ids) continue;
    const row = work.job_coverage.find((r) => r.company_id === company.id);
    if (row?.outcome === 'board' && ids.every((id) => row.source_ids.includes(id))) continue;
    const note = row ? `Covered by ${ids.join(', ')} (approved from the company's own page). Last reading of its website: ${row.note}` : `Covered by ${ids.join(', ')} (approved from the company's own page).`;
    const next = { company_id: company.id, checked_at: row?.checked_at ?? at, outcome: 'board', review: false, careers_url: row?.careers_url ?? null, boards: row?.boards ?? [], source_ids: ids, note, next_check_at: null };
    if (row) Object.assign(row, next); else work.job_coverage.push(next);
    n += 1;
  }
  return n;
}

// Who is looked at in this refresh. `isInactive` is the catalogue's own rule (a closed company is not looked at).
//   - a company never looked at: at once;
//   - a company with an approved board: not again, unless that board has failed three times in a row (then its page is read again to see whether the link moved);
//   - a company a job network has said is hiring since it was last looked at (job_coverage.hiring_hint_at): at once;
//   - every other company: when this half-day block is the company's own (rotationBucket), so once a week, unless it was looked at in the last six hours (a second run in the same block asks nothing).
// `force` takes every eligible company. The never-looked-at come first, then the longest ago.
export function dueForDiscovery(ds, { now, limit, force = false, isInactive }) {
  const byCompany = new Map((ds.job_coverage ?? []).map((r) => [r.company_id, r]));
  const failing = new Set();
  const state = new Map((ds.job_sync_state ?? []).map((r) => [r.source_id, r]));
  const approved = new Map();
  for (const s of ds.job_sources ?? []) if (s.status === 'approved' && SUPPORTED.includes(s.provider)) approved.set(s.company_id, [...(approved.get(s.company_id) ?? []), s.id]);
  for (const [company, ids] of approved) if (ids.every((id) => (state.get(id)?.consecutive_failures ?? 0) >= 3)) failing.add(company);
  const block = blockOf(now);
  const eligible = ds.companies.filter((c) => !isInactive(c));
  const due = eligible.filter((c) => {
    if (force) return true;
    const r = byCompany.get(c.id);
    if (!r) return true; // never looked at: now
    if (approved.has(c.id) && !failing.has(c.id)) return false;
    // A job network said the company is hiring (network.js) after it was last looked at, and it has no board of its own read: look now, not at its turn in the week.
    if (r.hiring_hint_at && (!r.checked_at || Date.parse(r.hiring_hint_at) > Date.parse(r.checked_at))) return true;
    if (rotationBucket(c.id) !== block % ROTATION_BLOCKS) return false;
    return !r.checked_at || now - Date.parse(r.checked_at) > 6 * 3600000;
  });
  due.sort((a, b) => Number(Boolean(byCompany.get(a.id))) - Number(Boolean(byCompany.get(b.id))) || (Date.parse(byCompany.get(a.id)?.checked_at ?? 0) - Date.parse(byCompany.get(b.id)?.checked_at ?? 0)) || a.id.localeCompare(b.id));
  return { eligible: eligible.length, ineligible: ds.companies.length - eligible.length, due: due.length, planned: due.slice(0, limit) };
}
