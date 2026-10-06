// Open roles from the job board a company's own careers page points at.
//
// Most startups do not publish job postings as structured data on their own site: they use a hosted applicant
// tracking system (Greenhouse, Lever, Ashby, Workable, Recruitee, SmartRecruiters) and link to it. Each of those
// publishes the list of open roles as a public feed, which is what powers the "open positions" embeds on company
// sites, so reading it is what the feed is for.
//
//   - A board counts only if the company's own site points at it: a link on its careers page, or a careers link
//     on its homepage. A link on some other page (a partner, an investor's job board) is not the company's.
//   - It is read through the same compliant fetcher as everything else: robots.txt, pacing, no access control
//     bypassed, an honest user agent. A feed that refuses is skipped, not worked around.
//   - What comes back is the title, place, kind of job, date and apply link, and nothing about the applicants.
import { links } from '../discovery/html.js';

const MAX_BOARDS = 2;
const MAX_JOBS = 30;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,60}$/;
const NOT_A_TOKEN = new Set(['embed', 'v1', 'jobs', 'api', 'js', 'job_board', 'careers', 'www', 'en', 'static', 'assets', 'widget']);
const CAREERS_PATH = /careers?|jobs|join|work-?with|vacanc|opportunit|hiring|openings/i;
const CAREERS_TEXT = /careers?|jobs?|join (?:us|our|the)|work (?:with|at|for) us|we.?re hiring|open (?:roles|positions)|vacanc/i;

const day = (v) => {
  if (v == null) return null;
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
const text = (v, max = 120) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const isRemote = (...s) => (s.some((x) => /\bremote\b/i.test(String(x ?? ''))) ? true : null);
const url = (v) => (typeof v === 'string' && /^https?:\/\//i.test(v) ? v : null);

// Each provider: how its board is recognised in a page, where its feed and its public page are, and how a
// posting in the feed becomes a job row.
export const PROVIDERS = [
  {
    id: 'greenhouse', name: 'Greenhouse',
    detect: [/boards\.greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=)?([A-Za-z0-9_-]+)/g, /job-boards\.greenhouse\.io\/([A-Za-z0-9_-]+)/g],
    page: (t) => `https://boards.greenhouse.io/${t}`, feed: (t) => `https://boards-api.greenhouse.io/v1/boards/${t}/jobs`,
    parse: (j) => (j.jobs ?? []).map((x) => ({ title: text(x.title), location: text(x.location?.name), employment_type: null, remote: isRemote(x.location?.name), posted_at: null, apply_url: url(x.absolute_url) })),
  },
  {
    id: 'lever', name: 'Lever',
    detect: [/jobs\.lever\.co\/([A-Za-z0-9_-]+)/g],
    page: (t) => `https://jobs.lever.co/${t}`, feed: (t) => `https://api.lever.co/v0/postings/${t}?mode=json`,
    parse: (j) => (Array.isArray(j) ? j : []).map((x) => ({ title: text(x.text), location: text(x.categories?.location), employment_type: text(x.categories?.commitment), remote: isRemote(x.workplaceType, x.categories?.location), posted_at: day(x.createdAt), apply_url: url(x.hostedUrl) ?? url(x.applyUrl) })),
  },
  {
    id: 'ashby', name: 'Ashby',
    detect: [/jobs\.ashbyhq\.com\/([A-Za-z0-9_.-]+)/g],
    page: (t) => `https://jobs.ashbyhq.com/${t}`, feed: (t) => `https://api.ashbyhq.com/posting-api/job-board/${t}`,
    parse: (j) => (j.jobs ?? []).filter((x) => x.isListed !== false).map((x) => ({ title: text(x.title), location: text(x.location), employment_type: text(x.employmentType), remote: x.isRemote === true ? true : isRemote(x.location), posted_at: day(x.publishedAt), apply_url: url(x.jobUrl) ?? url(x.applyUrl) })),
  },
  {
    id: 'workable', name: 'Workable',
    detect: [/apply\.workable\.com\/([A-Za-z0-9_-]+)/g],
    page: (t) => `https://apply.workable.com/${t}/`, feed: (t) => `https://apply.workable.com/api/v1/widget/accounts/${t}`,
    parse: (j) => (j.jobs ?? []).map((x) => ({ title: text(x.title), location: text([x.city, x.state, x.country].filter(Boolean).join(', ')), employment_type: text(x.employment_type), remote: x.telecommuting === true ? true : null, posted_at: day(x.published_on ?? x.created_at), apply_url: url(x.url) ?? url(x.shortlink) })),
  },
  {
    id: 'recruitee', name: 'Recruitee',
    detect: [/([a-z0-9-]+)\.recruitee\.com/g],
    page: (t) => `https://${t}.recruitee.com/`, feed: (t) => `https://${t}.recruitee.com/api/offers/`,
    parse: (j) => (j.offers ?? []).filter((x) => x.status == null || x.status === 'published').map((x) => ({ title: text(x.title), location: text(x.location), employment_type: text(x.employment_type_code), remote: x.remote === true ? true : null, posted_at: day(x.published_at), apply_url: url(x.careers_url) })),
  },
  {
    id: 'smartrecruiters', name: 'SmartRecruiters',
    detect: [/(?:careers|jobs)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/g],
    page: (t) => `https://jobs.smartrecruiters.com/${t}`, feed: (t) => `https://api.smartrecruiters.com/v1/companies/${t}/postings`,
    parse: (j, t) => (j.content ?? []).map((x) => ({ title: text(x.name), location: text([x.location?.city, x.location?.region, x.location?.country].filter(Boolean).join(', ')), employment_type: text(x.typeOfEmployment?.label), remote: x.location?.remote === true ? true : null, posted_at: day(x.releasedDate), apply_url: x.id ? `https://jobs.smartrecruiters.com/${t}/${x.id}` : null })),
  },
];

const OTHER_HOSTS = new Set(['www', 'api', 'app', 'careers', 'jobs', 'apply', 'blog', 'help', 'support', 'status', 'docs', 'static', 'cdn']);

// The boards a set of read pages points at: [{ provider, token }], at most MAX_BOARDS. `pages` are as readSite
// returns them. A careers page is searched whole (its embeds and scripts name the board); any other page only
// for a careers link.
export function detectBoards(pages) {
  const found = [];
  const add = (provider, token) => {
    if (!TOKEN.test(token) || NOT_A_TOKEN.has(token.toLowerCase()) || (provider.id === 'recruitee' && OTHER_HOSTS.has(token.toLowerCase()))) return;
    if (!found.some((f) => f.provider.id === provider.id && f.token.toLowerCase() === token.toLowerCase())) found.push({ provider, token });
  };
  for (const page of pages) {
    let careersPage = false;
    try { careersPage = CAREERS_PATH.test(new URL(page.finalUrl).pathname); } catch { /* an unparseable URL is not a careers page */ }
    const sources = careersPage
      ? [page.html]
      : links(page.html, page.finalUrl).filter((l) => CAREERS_TEXT.test(l.text) || CAREERS_PATH.test(safePath(l.href))).map((l) => l.href);
    for (const source of sources) {
      for (const provider of PROVIDERS) for (const re of provider.detect) for (const m of String(source).matchAll(re)) add(provider, m[1]);
    }
  }
  return found.slice(0, MAX_BOARDS);
}
const safePath = (href) => { try { return new URL(href).pathname; } catch { return ''; } };

// Reads one board's feed. Returns { provider, token, page_url, retrieved_at, jobs } or { error }.
export async function fetchBoard({ provider, token }, { fetcher, now = Date.now }) {
  const feed = provider.feed(token);
  try {
    const res = await fetcher.get(feed, { accept: 'application/json', allow: ['application/json'] });
    const json = JSON.parse(res.text);
    const jobs = provider.parse(json, token).filter((j) => j.title).slice(0, MAX_JOBS);
    return { provider: provider.id, name: provider.name, token, page_url: provider.page(token), retrieved_at: new Date(now()).toISOString(), jobs };
  } catch (err) {
    return { error: { url: feed, code: err.code ?? (err instanceof SyntaxError ? 'bad_feed' : 'error'), message: err.message } };
  }
}

// What the company's own pages point at, read. Mutates nothing: returns { boards, errors }.
export async function readBoards(site, { fetcher, now = Date.now }) {
  const boards = [];
  const errors = [];
  for (const target of detectBoards(site.pages)) {
    const out = await fetchBoard(target, { fetcher, now });
    if (out.error) errors.push(out.error); else boards.push(out);
  }
  return { boards, errors };
}
