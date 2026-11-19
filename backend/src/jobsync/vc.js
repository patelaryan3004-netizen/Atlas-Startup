// Venture firms' job boards: which ones exist, what platform they run, and what we may read from them.
//
// A firm's "portfolio jobs" board is an aggregator of its companies' jobs, usually hosted by a platform (Getro, Consider, Work at a Startup). What is publicly readable from them is
// much less than what a visitor sees by scrolling, and this module only ever uses what the page itself serves to any browser, through the same compliant fetcher (robots.txt, pacing,
// an honest user agent):
//
//   getro            the board's first page of jobs is in the page's own data (20 of hundreds): a SAMPLE. Further pages come from Getro's search API, which its robots.txt asks to arrange
//                    with them (api@getro.com) instead of being scraped, so they are not read.   access: public_sample
//   consider         (a16z, Sequoia, Lightspeed, Bessemer) the job list is drawn by script from the platform's API; the page serves none, or names only.   access: no_public_feed
//   workatastartup   (Y Combinator) the first page lists 20 of thousands, every apply link goes through YC's sign-in.   access: login_required
//
// So a venture board is used for three things, never as a place roles are copied from (a sample cannot say a role has closed, and the employer's own feed can):
//   1. the registry of firms: which have a board, on what platform, with what access (job_vc_boards.json), including the firms with no board at all;
//   2. a company the board names that the directory holds, whose job board link on a supported provider we do not yet have: a `review` row of job_sources.json, never polled until the
//      company's own page confirms it (the existing rule);
//   3. a company the board names that the directory does NOT hold, in an Australian place: a lead in job_leads.json, waiting for a person. The directory is never added to by the sync.
// The vacancies themselves come from the employers' own feeds (adapters.js); a role is shown once, whichever way it was found.
import { FetchPolicyError } from '../discovery/http.js';
import { links } from '../discovery/html.js';
import { slugify } from '../models/company.js';
import { detectBoards } from '../enrichment/boards.js';
import { boardOf } from './sources.js';
import { workPlaces } from './locations.js';
import { SUPPORTED } from './providers.js';
import { readCareersSite, detectExtra, OTHER_BOARDS_FOR_VC } from './discover.js';
import { readSource, SyncError } from './adapters.js';

const HOUR = 3600000;
const DAY = 86400000;

// The firms the owner named. `investor_id`: the firm's record in the directory (investors.json), when it has one. `site`: the firm's own website, where the check starts; the board is
// found from a link on that site, never guessed.
export const VC_FIRMS = [
  { id: 'blackbird', name: 'Blackbird', investor_id: 'blackbird', site: 'https://www.blackbird.vc/' },
  { id: 'airtree', name: 'AirTree Ventures', investor_id: 'airtree', site: 'https://www.airtree.vc/' },
  { id: 'square-peg', name: 'Square Peg', investor_id: 'square-peg', site: 'https://www.squarepeg.vc/' },
  { id: 'main-sequence', name: 'Main Sequence Ventures', investor_id: 'main-sequence', site: 'https://www.mseq.vc/' },
  { id: 'investible', name: 'Investible', investor_id: 'investible', site: 'https://www.investible.com/' },
  // `hint`: a board the firm's own site does not link to. Used only when no link is found, and only if the board's own data names the firm as its network (checked, not assumed).
  { id: 'startmate', name: 'Startmate', investor_id: 'startmate', site: 'https://www.startmate.com/', hint: 'https://startmate.getro.com/jobs', network: 'startmate' },
  { id: 'antler', name: 'Antler', investor_id: 'antler', site: 'https://www.antler.co/' },
  { id: 'oif', name: 'OIF Ventures', investor_id: 'oif', site: 'https://www.oifventures.com.au/' },
  { id: 'evp', name: 'EVP', investor_id: 'evp', site: 'https://www.evp.com.au/' },
  { id: 'y-combinator', name: 'Y Combinator', investor_id: 'y-combinator', site: 'https://www.ycombinator.com/' },
  { id: 'a16z', name: 'Andreessen Horowitz', investor_id: null, site: 'https://a16z.com/' },
  { id: 'sequoia', name: 'Sequoia Capital', investor_id: null, site: 'https://www.sequoiacap.com/' },
  { id: 'accel', name: 'Accel', investor_id: null, site: 'https://www.accel.com/' },
  { id: 'lightspeed', name: 'Lightspeed Venture Partners', investor_id: null, site: 'https://lsvp.com/' },
  { id: 'bessemer', name: 'Bessemer Venture Partners', investor_id: null, site: 'https://www.bvp.com/' },
];

const hostOf = (href) => { try { return new URL(href).hostname.toLowerCase(); } catch (e) { return ''; } };
const SOCIAL = /^(?:www\.)?(?:linkedin|facebook|twitter|x|instagram|youtube|tiktok|medium|substack)\./i;
const VENDOR_SITES = /^(?:www\.)?(?:getro\.com|consider\.com|product\.consider\.com|workatastartup\.com)$/i;
const BOARDISH_TEXT = /jobs?|careers?|open roles|portfolio (?:jobs|careers)|talent|vacanc/i;

// A board a page of the firm's site links to: the jobs/careers subdomain or a platform host, or a link whose words say it is the portfolio's jobs. Query strings (tracking) are dropped.
export function boardCandidates(pages, firmHost) {
  const out = [];
  for (const page of pages) {
    for (const l of links(page.html, page.finalUrl)) {
      const host = hostOf(l.href);
      if (!host || SOCIAL.test(host) || OTHER_BOARDS_FOR_VC.test(host)) continue;
      const own = host === firmHost || host.endsWith(`.${firmHost}`);
      if (VENDOR_SITES.test(host)) continue; // the platform's own marketing site ("Powered by Getro"), not a board
      const platform = /\.getro\.com$/.test(host) || /^(?:jobs|careers)\./.test(host);
      if (!platform && !(own && BOARDISH_TEXT.test(l.text) && /\/(?:jobs|careers)/i.test(new URL(l.href).pathname) && !/careers-at|team|about/i.test(new URL(l.href).pathname))) continue;
      const u = new URL(l.href); u.search = ''; u.hash = '';
      if (own && /\/(?:companies|talent-network|seeker)/.test(u.pathname)) continue;
      out.push({ url: u.href, text: l.text, from: page.finalUrl, rank: (/getro\.com$/.test(host) ? 1 : /^(?:jobs|careers)\./.test(host) ? 2 : 3) + (/^\/jobs/.test(u.pathname) ? 0 : 0.5) });
    }
  }
  return [...new Map(out.sort((a, b) => a.rank - b.rank).map((c) => [c.url, c])).values()];
}

// What a board page says about itself: the platform, and for Getro the first page of jobs it serves.
export function classifyBoard(html, host) {
  const next = String(html).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (next) {
    try {
      const state = JSON.parse(next[1])?.props?.pageProps?.initialState;
      if (state?.jobs && Array.isArray(state.jobs.found)) return { platform: 'getro', jobs: state.jobs.found, total: Number.isFinite(state.jobs.total) ? state.jobs.total : null };
    } catch (e) { /* not Getro's data */ }
  }
  if (/(^|\.)getro\.com$/.test(host) || /cdn\.getro\.com/.test(html)) return { platform: 'getro', jobs: [], total: null };
  if (/consider\.com/i.test(html) || /Powered by Consider/i.test(html)) return { platform: 'consider', jobs: [], total: null };
  if (/(^|\.)(?:ycombinator|workatastartup)\.com$/.test(host)) return { platform: 'workatastartup', jobs: [], total: null };
  return { platform: 'unknown', jobs: [], total: null };
}

// One Getro job as the sighting the rest works with.
function sightingOf(j, firm, at) {
  const org = typeof j?.organization?.name === 'string' ? j.organization.name.trim() : '';
  if (!org || typeof j.title !== 'string' || !/^https:\/\//.test(j.url ?? '')) return null;
  return { firm: firm.id, org, title: j.title.trim().slice(0, 160), url: j.url, locations: (j.locations ?? []).filter((l) => typeof l === 'string'), work_mode: j.workMode ?? null, at };
}

// One firm: its row for job_vc_boards.json, and the sample it served. Never throws for a site that refuses or fails.
// Is this board the firm's own? Its name is the firm's name, or the label of the firm's own website: a firm's careers page may also show its portfolio's boards, and those are not the firm's.
const norm = (s) => String(s ?? '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
export function ownsBoard(firm, token, firmHost) {
  const t = norm(token);
  if (t.length < 3) return false;
  const label = norm(String(firmHost ?? '').replace(/^www\./, '').split('.').slice(-/\.(?:com|co|org|net)\.[a-z]{2}$/.test(firmHost ?? '') ? 3 : 2)[0]);
  return [norm(firm.id), norm(firm.name), label].some((k) => k.length >= 3 && (k.includes(t) || t.includes(k)));
}

// One firm, and the boards of its own vacancies that its own page links to and whose feeds answered whole (`own`: [{ provider, token, read, evidence_url }]).
export async function checkFirm(firm, opts = {}) {
  const own = [];
  const res = await inspectFirm(firm, opts, own);
  return { ...res, own };
}

async function inspectFirm(firm, { fetcher, now = Date.now } = {}, ownBoards = []) {
  const at = new Date(now()).toISOString();
  const row = { id: firm.id, investor_id: firm.investor_id, name: firm.name, board_url: null, platform: 'unknown', access: 'unread', evidence_url: null, checked_at: at, own_vacancies: '', note: '', next_check_at: new Date(now() + 7 * DAY).toISOString() };
  const fail = (note) => ({ row: { ...row, note, next_check_at: new Date(now() + 12 * HOUR).toISOString() }, sample: [] });
  const site = await readCareersSite(firm.site, { fetcher, now });
  if (site.pages.length === 0) return fail(`The firm's website could not be read (${site.errors[0]?.code ?? 'no answer'}).`);
  const firmHost = hostOf(site.pages[0].finalUrl).replace(/^www\./, '');

  // The firm's own vacancies: a supported board its own pages link to, or the provider it uses that we do not read.
  // Only the firm's own pages count: a portfolio board page (Getro, Consider) names its COMPANIES' boards, not the firm's.
  const ownPages = site.pages.filter((p) => classifyBoard(p.html, hostOf(p.finalUrl)).platform === 'unknown' && !/^(?:jobs|careers)\./.test(hostOf(p.finalUrl)));
  const named = [...detectBoards(ownPages), ...detectExtra(ownPages)];
  const own = named.filter((b) => ownsBoard(firm, b.token, firmHost));
  const others = [];
  for (const p of ownPages) for (const l of links(p.html, p.finalUrl)) if (OTHER_BOARDS_FOR_VC.test(hostOf(l.href)) && !/linkedin|facebook|twitter/.test(hostOf(l.href)) && !named.some((b) => hostOf(b.provider.page(b.token)) === hostOf(l.href))) others.push(hostOf(l.href));
  const notes = [];
  for (const b of own) {
    if (!SUPPORTED.includes(b.provider.id)) { notes.push(`its own ${b.provider.name} board (${b.token}) is not read by the sync`); continue; }
    try {
      const read = await readSource({ provider: b.provider.id, token: b.token }, { fetcher, now: now(), companyWebsite: firm.site, retries: 1 });
      ownBoards.push({ provider: b.provider.id, token: b.token, read, evidence_url: ownPages.find((p) => String(p.html).includes(b.token))?.finalUrl ?? site.pages[0].finalUrl });
      notes.push(`its own ${b.provider.name} board (${b.token}) lists ${read.seen.size} role${read.seen.size === 1 ? '' : 's'}: read as ${firm.name}'s own vacancies`);
    } catch (err) {
      if (!(err instanceof SyncError)) throw err;
      notes.push(`its own ${b.provider.name} board (${b.token}) could not be read (${err.code})`);
    }
  }
  const skippedPortfolio = named.length - own.length;
  row.own_vacancies = notes.length ? `Its own careers page links to ${notes.join('; ')}.${skippedPortfolio ? ` (${skippedPortfolio} other board${skippedPortfolio === 1 ? '' : 's'} on its pages belong to portfolio companies, not the firm.)` : ''}`
    : others.length ? `Its own vacancies are on ${[...new Set(others)].join(', ')}, which the sync does not read.` : 'No vacancy list was found on the firm\'s own pages (a page that lists roles only as text has no feed).';

  const candidates = boardCandidates(site.pages, firmHost);
  let hinted = false;
  if (candidates.length === 0 && firm.hint) { candidates.push({ url: firm.hint, from: firm.site, rank: 9 }); hinted = true; }
  if (candidates.length === 0) return { row: { ...row, access: 'no_board', platform: 'none', note: 'No portfolio job board is linked from the firm\'s own site.' }, sample: [] };
  const pick = candidates[0];
  row.board_url = pick.url;
  row.evidence_url = pick.from;
  let page;
  try { page = await fetcher.get(pick.url); } catch (err) {
    if (!(err instanceof FetchPolicyError)) throw err;
    return { row: { ...row, access: err.code === 'access_controlled' ? 'login_required' : 'unread', note: `The board (${pick.url}) was not read: ${err.code}.`, next_check_at: new Date(now() + 12 * HOUR).toISOString() }, sample: [] };
  }
  let seen = classifyBoard(page.text, hostOf(page.finalUrl));
  // A platform host linked at its root: the list of jobs is at the board's own /jobs page.
  const atRoot = new URL(page.finalUrl).pathname === '/' || /^\/(?:companies|talent-network)\b/.test(new URL(page.finalUrl).pathname);
  if ((seen.platform !== 'getro' || seen.jobs.length === 0) && atRoot && /\.getro\.com$|^jobs\./.test(hostOf(page.finalUrl))) {
    try {
      const jobsPage = await fetcher.get(new URL('/jobs', page.finalUrl).href);
      const again = classifyBoard(jobsPage.text, hostOf(jobsPage.finalUrl));
      if (again.platform !== 'unknown') { page = jobsPage; seen = again; row.board_url = jobsPage.finalUrl; }
    } catch (err) { if (!(err instanceof FetchPolicyError)) throw err; }
  }
  if (hinted) {
    const net = (() => { try { return JSON.parse(String(page.text).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)[1]).props.pageProps.network?.slug; } catch (e) { return null; } })();
    if (seen.platform !== 'getro' || net !== firm.network) return { row: { ...row, board_url: null, evidence_url: null, platform: 'none', access: 'no_board', note: `A board at ${firm.hint} was not confirmed as ${firm.name}'s (its own data names network ${net ?? 'none'}), so it is not used.` }, sample: [] };
    row.note = `Not linked from ${firm.name}'s own site; the board's own data names "${firm.network}" as its network. `;
  }
  row.platform = seen.platform;
  if (seen.platform === 'getro' && seen.jobs.length) {
    const sample = seen.jobs.map((j) => sightingOf(j, firm, at)).filter(Boolean);
    row.access = 'public_sample';
    row.note = `${row.note}A Getro board: its page serves the newest ${seen.jobs.length} of ${seen.total ?? 'many'} jobs, worldwide and not filtered by place. The rest need Getro's search API, which its robots.txt asks to arrange with Getro, so it is not read. Used to name companies, never as a source of roles.`;
    row.next_check_at = new Date(now() + 11 * HOUR).toISOString();
    return { row, sample };
  }
  if (seen.platform === 'getro') return { row: { ...row, access: 'public_sample', note: `${row.note}A Getro board whose page lists no jobs at present${seen.total === 0 ? ' (the board says 0)' : ''}.`, next_check_at: new Date(now() + 11 * HOUR).toISOString() }, sample: [] };
  if (seen.platform === 'workatastartup') return { row: { ...row, access: 'login_required', note: 'Y Combinator\'s Work at a Startup: the page lists the newest 20 of thousands of jobs worldwide, and every apply link goes through a YC sign-in, which is not used. Not read.' }, sample: [] };
  if (seen.platform === 'consider') return { row: { ...row, access: 'no_public_feed', note: 'A Consider board: its job list is drawn by script from the platform\'s API and the page serves no list we may use (at most a list of titles with no company, place or link). Not read.' }, sample: [] };
  return { row: { ...row, access: 'no_public_feed', note: `The board is on ${hostOf(page.finalUrl)}; its page serves no job list in a form the sync can read.` }, sample: [] };
}

const keyOf = (name) => String(name ?? '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');

// What a firm's sample says about the directory. Writes into `work` (the dataset): leads for unknown Australian companies, `review` rows for boards of known companies. Returns counts.
export function applySample(work, firm, sample, { at, keptReview }) {
  const stats = { sighted: sample.length, known: 0, review_boards: 0, leads: 0, ignored: 0 };
  const byKey = new Map();
  for (const c of work.companies) { const k = keyOf(c.name); byKey.set(k, byKey.has(k) ? null : c); } // a name two companies share matches neither
  const reviews = [...keptReview];
  work.job_leads ??= [];
  for (const s of sample) {
    const company = byKey.get(keyOf(s.org));
    const where = workPlaces(s.locations, { workplaceType: s.work_mode });
    if (company) {
      stats.known += 1;
      const board = boardOf(s.url);
      if (board && SUPPORTED.includes(board.provider)) {
        const same = (r) => r.company_id === company.id && r.provider === board.provider && String(r.token).toLowerCase() === board.token.toLowerCase();
        if (!work.job_sources.some((r) => same(r) && r.status === 'approved')) {
          const sighting = { firm: firm.id, url: s.url, title: s.title };
          const queued = reviews.find(same);
          if (queued) {
            if (!(queued.sighted ?? []).some((x) => x.url === s.url)) queued.sighted = [...(queued.sighted ?? []), sighting].slice(-5);
          } else {
            reviews.push({ company_id: company.id, provider: board.provider, token: board.token, reason: `Named by ${firm.name}'s job board (${s.title} links to ${board.provider} board "${board.token}"). Not yet confirmed from ${company.name}'s own careers page or through its own feed, so it is not read.`, sighted: [sighting] });
            stats.review_boards += 1;
          }
        }
      }
      continue;
    }
    if (!where.au && !where.remoteAu) { stats.ignored += 1; continue; }
    const id = `lead-${slugify(s.org).slice(0, 60)}`;
    let lead = work.job_leads.find((l) => l.id === id);
    if (!lead) {
      lead = { id, kind: 'unknown_company', name: s.org, status: 'needs_review', seen_on: [], first_seen_at: at, last_seen_at: at, note: 'Named by a venture firm\'s job board with an Australian place; the directory does not hold it. Approve it to add it, or reject it.' };
      work.job_leads.push(lead);
      stats.leads += 1;
    }
    lead.last_seen_at = at;
    if (!lead.seen_on.some((x) => x.url === s.url)) lead.seen_on = [...lead.seen_on, { firm: firm.id, url: s.url, title: s.title, at }].slice(-5);
  }
  return { stats, reviews };
}
