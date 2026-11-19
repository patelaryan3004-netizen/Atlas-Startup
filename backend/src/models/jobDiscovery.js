// The job sync's four ledgers, beside job_sources.json and job_sync_state.json (jobSync.js). None is served by a public route as a collection; the hiring desk reads the totals.
//
//   job_coverage.json   one row per company in the directory: has its own site been looked at for a job board, and what was found. This is both the proof that EVERY eligible
//                       company was considered and the review queue for the ones that could not be read: no board link found, a board on a provider the sync does not read,
//                       a site that would not answer. A person (or a new reader) works from the rows with review: true.
//                       { company_id, checked_at, outcome, review, careers_url, boards[{ provider, token, host, url, supported, source_id }], source_ids[], note, next_check_at }
//   job_vc_boards.json  one row per venture firm whose job board was checked: where it is, what platform it runs, and what we may read from it (a firm that runs a board we cannot
//                       read says so, with the reason). { id, investor_id, name, board_url, platform, access, evidence_url, checked_at, own_vacancies, note, next_check_at }
//   job_leads.json     companies the venture firms' boards named that the directory does not hold. A lead is never read as a source and never shown: it waits here for a person to
//                       approve it, and the directory is never added to by the sync. (A job board named for a company we DO hold is a 'review' row of job_sources.json instead.)
//                       { id, kind: unknown_company, name, status, seen_on[{ firm, url, title, at }], first_seen_at, last_seen_at, note }
//   job_health.json     one row per refresh: the sync's own account of itself (boards read, failed, roles open, new, closed, duplicates), newest last, trimmed to the last 120 rows.
import { ISO_RE, isStr } from './company.js';
import { SOURCE_PROVIDERS } from './jobSync.js';

export const COVERAGE_OUTCOMES = ['board', 'unsupported_provider', 'careers_page_only', 'no_careers_found', 'unreadable', 'board_unreadable', 'no_website'];
// Outcomes that need a person, or a reader that does not exist yet.
export const REVIEW_OUTCOMES = new Set(['unsupported_provider', 'careers_page_only', 'no_careers_found', 'unreadable', 'board_unreadable']);
export const VC_PLATFORMS = ['getro', 'consider', 'workatastartup', 'greenhouse', 'lever', 'ashby', 'rippling', 'own_site', 'none', 'unknown'];
export const VC_ACCESS = ['public_sample', 'no_public_feed', 'login_required', 'no_board', 'unread'];
export const LEAD_KINDS = ['unknown_company'];
export const LEAD_STATUSES = ['needs_review', 'approved', 'rejected'];
export const HEALTH_KEEP = 120;

const when = (v) => v == null || ISO_RE.test(v);
const isUrl = (v) => v == null || /^https:\/\/\S+$/.test(v);

export function validateJobCoverage(ds) {
  const errors = [];
  const companies = new Set((ds.companies ?? []).map((c) => c.id));
  const sourceIds = new Set((ds.job_sources ?? []).map((s) => s.id));
  const seen = new Set();
  for (const r of ds.job_coverage ?? []) {
    const at = `job coverage "${r.company_id}"`;
    if (!companies.has(r.company_id)) errors.push(`${at}: unknown company_id`);
    if (seen.has(r.company_id)) errors.push(`${at}: duplicate row`);
    seen.add(r.company_id);
    if (!COVERAGE_OUTCOMES.includes(r.outcome)) errors.push(`${at}: invalid outcome "${r.outcome}"`);
    if (!when(r.checked_at) || !when(r.next_check_at)) errors.push(`${at}: checked_at and next_check_at must be ISO-8601 UTC or null`);
    if (!isUrl(r.careers_url)) errors.push(`${at}: careers_url must be https or null`);
    if (typeof r.review !== 'boolean') errors.push(`${at}: review must be true or false`);
    for (const b of r.boards ?? []) {
      if (!SOURCE_PROVIDERS.includes(b.provider) && !isStr(b.provider)) errors.push(`${at}: a board needs a provider`);
      if (!isUrl(b.url)) errors.push(`${at}: a board's url must be https`);
    }
    for (const id of r.source_ids ?? []) if (!sourceIds.has(id)) errors.push(`${at}: unknown job source "${id}"`);
  }
  return errors;
}

export function validateJobVcBoards(ds) {
  const errors = [];
  const investors = new Set((ds.investors ?? []).map((i) => i.id));
  const seen = new Set();
  for (const r of ds.job_vc_boards ?? []) {
    const at = `vc board "${r.id}"`;
    if (!isStr(r.id)) { errors.push('job_vc_boards: a row needs an id'); continue; }
    if (seen.has(r.id)) errors.push(`${at}: duplicate id`);
    seen.add(r.id);
    if (r.investor_id != null && !investors.has(r.investor_id)) errors.push(`${at}: unknown investor_id "${r.investor_id}"`);
    if (!VC_PLATFORMS.includes(r.platform)) errors.push(`${at}: invalid platform "${r.platform}"`);
    if (!VC_ACCESS.includes(r.access)) errors.push(`${at}: invalid access "${r.access}"`);
    if (!isUrl(r.board_url) || !isUrl(r.evidence_url)) errors.push(`${at}: board_url and evidence_url must be https or null`);
    if (!when(r.checked_at) || !when(r.next_check_at)) errors.push(`${at}: checked_at and next_check_at must be ISO-8601 UTC or null`);
    if (!isStr(r.note)) errors.push(`${at}: note says what was found and what may be read`);
  }
  return errors;
}

export function validateJobLeads(ds) {
  const errors = [];
  const companies = new Set((ds.companies ?? []).map((c) => c.id));
  const seen = new Set();
  for (const r of ds.job_leads ?? []) {
    const at = `job lead "${r.id}"`;
    if (!isStr(r.id)) { errors.push('job_leads: a row needs an id'); continue; }
    if (seen.has(r.id)) errors.push(`${at}: duplicate id`);
    seen.add(r.id);
    if (!LEAD_KINDS.includes(r.kind)) errors.push(`${at}: invalid kind "${r.kind}"`);
    if (!LEAD_STATUSES.includes(r.status)) errors.push(`${at}: invalid status "${r.status}"`);
    if (r.kind === 'unknown_company' && companies.has(r.company_id)) errors.push(`${at}: a company in the directory is not an unknown company`);
    if (!when(r.first_seen_at) || !when(r.last_seen_at)) errors.push(`${at}: first_seen_at and last_seen_at must be ISO-8601 UTC or null`);
  }
  return errors;
}

export function validateJobHealth(ds) {
  const errors = [];
  const seen = new Set();
  for (const r of ds.job_health ?? []) {
    const at = `job health "${r.id}"`;
    if (!isStr(r.id)) { errors.push('job_health: a row needs an id'); continue; }
    if (seen.has(r.id)) errors.push(`${at}: duplicate id`);
    seen.add(r.id);
    if (!when(r.at) || !r.at) errors.push(`${at}: at must be ISO-8601 UTC`);
    for (const k of ['companies_with_sources', 'boards_ok', 'boards_failed', 'open_roles', 'new_roles', 'closed_roles', 'duplicates_removed']) {
      if (!Number.isInteger(r[k]) || r[k] < 0) errors.push(`${at}: ${k} must be a whole number`);
    }
  }
  return errors;
}
