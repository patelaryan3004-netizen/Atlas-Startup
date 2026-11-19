// Confirming a board through the employer. A venture firm's job board (vc.js) can show a job at a company we hold that links to a job board on a provider the sync reads. That alone
// proves nothing about whose board it is or whether the job is open, so it is a `review` row, never read. This step asks the EMPLOYER: it reads that board's own public feed, whole, and
// approves the board only when
//   1. the feed answers with a whole list (adapters.js: anything short of that is a failure, not an answer);
//   2. the employer's own feed lists the very job the venture board showed (same canonical address): the vacancy is confirmed through the employer, not through the aggregator;
//   3. the board is the company's: its name is the company's name (or the company's name is in it), or it is the label of the company's own website (a company that has moved to a new
//      name and domain: safetyculture.com now answers from mitti.com, and its board is "mitti").
// A board that fails any of these stays in review with the reason and the date, and is asked again in a week. Nothing is written about a job that is not in the employer's feed.
import { snapshot, transact } from '../models/store.js';
import { readSite } from '../discovery/enrich.js';
import { readSource, SyncError, PROVIDERS } from './adapters.js';
import { canonicalUrl } from './canonical.js';
import { applyRead } from './engine.js';
import { stateRow, noteSuccess } from './state.js';
import { buildCatalogue } from './sources.js';
import { keptReview } from './discoverRun.js';
import { reconcileCoverage } from './discover.js';
import { SUPPORTED } from './providers.js';

export const CONFIRM_RETRY_DAYS = 7;
const PROVIDERS_PAGE = (provider, token) => PROVIDERS[provider].page(token);
const DAY = 86400000;
const key = (s) => String(s ?? '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { return ''; } };
// "mitti.com" -> "mitti"; "acme.com.au" -> "acme".
const labelOf = (host) => { const p = host.split('.'); return /\.(?:com|co|org|net)\.[a-z]{2}$/.test(host) ? p.at(-3) ?? '' : p.at(-2) ?? ''; };

// Is this board's name the company's? `siteHost`: the host the company's own website answers from (looked up only when the names do not already agree).
export async function identity(company, token, { fetcher, now }) {
  const t = key(token);
  if (t.length < 3) return { ok: false, why: 'the board name is too short to say whose it is' };
  for (const k of [key(company.id), key(company.name)]) {
    if (k.length >= 3 && (k.includes(t) || t.includes(k))) return { ok: true, why: `the board's name "${token}" is the company's name` };
  }
  if (company.website) {
    const site = await readSite(company.website, { fetcher, now, maxPages: 1 });
    const host = hostOf(site.pages[0]?.finalUrl ?? '');
    if (host && key(labelOf(host)) === t) return { ok: true, why: `the board's name "${token}" is the name of the company's own website (${host})` };
  }
  return { ok: false, why: `the board's name "${token}" is not the company's name and not its website's` };
}

// One review row: { ok, note } and, when ok, the whole read to apply.
export async function confirmOne(row, company, { fetcher, now = Date.now }) {
  if (!SUPPORTED.includes(row.provider)) return { ok: false, note: `${row.provider} boards are not read by the sync.` };
  let read;
  try { read = await readSource({ provider: row.provider, token: row.token }, { fetcher, now: now(), companyWebsite: company.website ?? '', retries: 1 }); } catch (err) {
    if (!(err instanceof SyncError)) throw err;
    return { ok: false, note: `The employer's feed did not answer (${err.code}).` };
  }
  const wanted = new Map((row.sighted ?? []).map((s) => [canonicalUrl(s.url), s]));
  const hit = read.postings.find((p) => wanted.has(p.canonical_url));
  if (!hit) return { ok: false, note: `The employer's own feed (${read.seen.size} listed) does not list the job the venture board showed${row.sighted?.[0]?.title ? ` ("${row.sighted[0].title}")` : ''}: it may have closed.` };
  const who = await identity(company, row.token, { fetcher, now });
  if (!who.ok) return { ok: false, note: `The employer's feed lists the job, but ${who.why}.` };
  return { ok: true, read, hit, why: who.why, firm: wanted.get(hit.canonical_url)?.firm ?? null };
}

export async function confirmReviewBoards({ dir, fetcher, now = Date.now, lock = { now }, shouldStop = () => false }) {
  const stats = { due: 0, checked: 0, approved: [], kept: 0, errors: 0 };
  const { ds } = await snapshot(dir, lock);
  const due = (ds.job_sources ?? []).filter((r) => r.status === 'review' && (r.sighted ?? []).length && (!r.checked_at || now() - Date.parse(r.checked_at) > CONFIRM_RETRY_DAYS * DAY));
  stats.due = due.length;
  for (const row of due) {
    if (shouldStop()) break;
    const company = ds.companies.find((c) => c.id === row.company_id);
    if (!company) continue;
    let result;
    try { result = await confirmOne(row, company, { fetcher, now }); } catch (err) { stats.errors += 1; continue; }
    stats.checked += 1;
    await transact(dir, (work, { at }) => {
      const current = work.job_sources.find((r) => r.id === row.id);
      if (!current || current.status !== 'review') return {};
      if (!result.ok) { current.checked_at = at; current.note = `${at.slice(0, 10)}: ${result.note}`; return {}; }
      const id = `${row.company_id}-${row.provider}-jobs`;
      const firmName = (current.sighted?.find((s) => canonicalUrl(s.url) === result.hit.canonical_url)?.firm) ?? 'a venture firm';
      work.sources ??= [];
      if (!work.sources.some((s) => s.id === id)) {
        work.sources.push({ id, kind: 'aggregator', url: current.board_url, title: `${row.provider} job board (confirmed through the employer's feed)`, publisher: firmName, retrieved_at: at, note: `Named by ${firmName}'s job board; the employer's own ${row.provider} feed lists the same job ("${result.hit.title}").` });
      }
      work.job_sources = buildCatalogue(work, { review: keptReview(work), at });
      const approved = work.job_sources.find((r) => r.id === id);
      if (!approved) return {};
      approved.basis = `Confirmed through the employer on ${at.slice(0, 10)}: ${firmName}'s job board showed "${result.hit.title}", the company's own ${row.provider} feed lists that same job, and ${result.why}.`;
      work.job_sync_state ??= [];
      const s = applyRead(work.jobs, approved, result.read, { now: now() });
      noteSuccess(stateRow(work.job_sync_state, approved.id), { at, counts: s, runId: null, pages: result.read.pages, attempts: result.read.attempts });
      stats.approved.push({ id, company_id: row.company_id, roles_added: s.added });
      reconcileCoverage(work, { at }); // the company is now covered by this board in the ledger
      return {};
    }, lock);
    if (!result.ok) stats.kept += 1;
  }
  return stats;
}

// ---------- boards confirmed by reading the company's own careers page in a browser ----------
//
// Some careers pages draw their job list by script (a Workable or Rippling embed, a list built in the page), so a plain page read sees no board and discovery files the company under
// "careers page only". For the companies that matter most, a person (or an assistant with a browser) reads the page as a visitor sees it and records, in scripts/jobsync-confirmed.json, which
// board it names and how. This reads that file and approves a board only when the same two things hold as everywhere else: the board's feed answers whole, and the page's claim is
// confirmed by the employer's own feed:
//   evidence "link"  the careers page links to the board's own address (the token is in the link): the feed answering is the check;
//   evidence "jobs"  the careers page shows jobs but not the board's address: at least one of the jobs it shows (`shown`, their addresses) must be listed by the board's own feed.
export async function confirmFromFile({ dir, entries, fetcher, now = Date.now, lock = { now }, write = true }) {
  const results = [];
  const { ds } = await snapshot(dir, lock);
  for (const e of entries) {
    const company = ds.companies.find((c) => c.id === e.company_id);
    if (!company) { results.push({ ...e, ok: false, note: 'the company is not in the directory' }); continue; }
    if (!SUPPORTED.includes(e.provider)) { results.push({ ...e, ok: false, note: `${e.provider} boards are not read by the sync` }); continue; }
    const have = (ds.job_sources ?? []).find((r) => r.company_id === e.company_id && r.provider === e.provider && r.status === 'approved');
    if (have && String(have.token).toLowerCase() === String(e.token).toLowerCase()) { results.push({ ...e, ok: true, already: true, note: 'already approved' }); continue; }
    let read;
    try { read = await readSource({ provider: e.provider, token: e.token }, { fetcher, now: now(), companyWebsite: company.website ?? '', retries: 1 }); } catch (err) {
      if (!(err instanceof SyncError)) throw err;
      results.push({ ...e, ok: false, note: `the board's feed did not answer (${err.code})` });
      continue;
    }
    if (e.evidence === 'jobs') {
      const listed = new Set(read.postings.map((p) => p.canonical_url));
      const found = (e.shown ?? []).filter((u) => listed.has(canonicalUrl(u)));
      if (!found.length) { results.push({ ...e, ok: false, note: `the board's feed (${read.seen.size} listed) does not list any job the careers page shows` }); continue; }
    }
    results.push({ ...e, ok: true, listed: read.seen.size, read });
  }
  if (!write) return results.map(({ read, ...r }) => r);
  for (const r of results) {
    if (!r.ok || r.already) continue;
    await transact(dir, (work, { at }) => {
      const id = `${r.company_id}-${r.provider}-jobs`;
      const name = r.provider[0].toUpperCase() + r.provider.slice(1);
      work.sources ??= [];
      const company = work.companies.find((c) => c.id === r.company_id);
      const existing = work.sources.find((s) => s.id === id);
      const row = { id, kind: 'company_website', url: PROVIDERS_PAGE(r.provider, r.token), title: `${name} job board`, publisher: new URL(company.website).hostname.replace(/^www\./, ''), retrieved_at: at, note: `${r.how} Careers page: ${r.page}.` };
      if (existing) Object.assign(existing, row); else work.sources.push(row);
      work.job_sources = buildCatalogue(work, { review: keptReview(work), at });
      const approved = work.job_sources.find((x) => x.id === id);
      if (!approved) return {};
      approved.basis = `Confirmed from the company's own careers page, read in a browser (${r.evidence === 'jobs' ? 'its jobs are the ones this board lists' : 'it links to this board'}); see scripts/jobsync-confirmed.json.`;
      work.job_sync_state ??= [];
      const s = applyRead(work.jobs, approved, r.read, { now: now() });
      noteSuccess(stateRow(work.job_sync_state, approved.id), { at, counts: s, runId: null, pages: r.read.pages, attempts: r.read.attempts });
      r.roles_added = s.added;
      return {};
    }, lock);
  }
  await transact(dir, (work, { at }) => { reconcileCoverage(work, { at }); return {}; }, lock);
  return results.map(({ read, ...r }) => r);
}
