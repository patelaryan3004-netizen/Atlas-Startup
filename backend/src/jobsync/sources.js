// The catalogue of boards the sync reads: job_sources.json. A board is approved only when the company's own careers page links to it (the reader that finds boards, enrichment/boards.js,
// counts nothing else), which is what a sources.json row named like "acme-greenhouse-jobs" records. This file turns those rows into the list the sync works from, and keeps the boards
// someone only NAMED (the pilot handoff's, a suggestion) in a review queue: never polled, never guessed, until the employer's own page confirms them.
import { PROVIDERS, SUPPORTED } from './adapters.js';
import { SOURCE_PROVIDERS } from '../models/jobSync.js';

// "https://boards.greenhouse.io/karbon", "https://jobs.lever.co/Zeller", "https://apply.workable.com/asseti/": the provider and the board's name.
export function boardOf(url) {
  let u;
  try { u = new URL(url); } catch (e) { return null; }
  const first = u.pathname.split('/').filter(Boolean)[0];
  const host = u.hostname.toLowerCase();
  if (/(^|\.)greenhouse\.io$/.test(host) && first) return { provider: 'greenhouse', token: first };
  if (/(^|\.)lever\.co$/.test(host) && first) return { provider: 'lever', token: first };
  if (host === 'apply.workable.com' && first) return { provider: 'workable', token: first };
  if (host === 'jobs.ashbyhq.com' && first) return { provider: 'ashby', token: first };
  if (/\.recruitee\.com$/.test(host)) return { provider: 'recruitee', token: host.split('.')[0] };
  if (/smartrecruiters\.com$/.test(host) && first) return { provider: 'smartrecruiters', token: first };
  return null;
}

const SOURCE_ID = new RegExp(`^(.+)-(${SOURCE_PROVIDERS.join('|')})-jobs$`);

// The catalogue as it is today, from the dataset: every sources.json row that is a board the company's own page links to, for a company in the directory, plus `review` rows
// for boards that were named but not confirmed. Rows already in the catalogue keep what a person set (a pause, a note).
export function buildCatalogue(ds, { review = [], at = new Date().toISOString() } = {}) {
  const companies = new Map(ds.companies.map((c) => [c.id, c]));
  const kept = new Map((ds.job_sources ?? []).map((r) => [r.id, r]));
  const rows = [];
  for (const s of ds.sources ?? []) {
    const m = SOURCE_ID.exec(s.id);
    if (!m || !companies.has(m[1])) continue;
    const board = boardOf(s.url);
    if (!board || board.provider !== m[2]) continue;
    const prior = kept.get(s.id);
    rows.push({
      id: s.id, company_id: m[1], provider: board.provider, token: board.token, board_url: s.url, status: prior?.status ?? 'approved',
      basis: prior?.basis ?? `The company's own careers page links to this board (sources.json "${s.id}", read ${String(s.retrieved_at ?? '').slice(0, 10) || 'earlier'}).`,
      note: prior?.note ?? '', added_at: prior?.added_at ?? at,
    });
  }
  for (const r of review) {
    const company = companies.get(r.company_id);
    if (!company) continue;
    const id = `${r.company_id}-${r.provider}-review`;
    if (rows.some((x) => x.company_id === r.company_id && x.provider === r.provider && x.token.toLowerCase() === r.token.toLowerCase())) continue; // already an approved board
    const prior = kept.get(id);
    rows.push({
      id, company_id: r.company_id, provider: r.provider, token: r.token, board_url: PROVIDERS[r.provider]?.page(r.token) ?? `https://${r.provider}.example/${r.token}`.replace('.example', '.com'),
      status: prior?.status === 'approved' ? 'approved' : 'review', basis: r.reason, note: prior?.note ?? '', added_at: prior?.added_at ?? at,
    });
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

// What the sync can and cannot do about a catalogue: for the status view and the report.
export function coverage(ds) {
  const rows = ds.job_sources ?? [];
  const approved = rows.filter((r) => r.status === 'approved');
  const supported = approved.filter((r) => SUPPORTED.includes(r.provider));
  return {
    sources: rows.length, approved: approved.length, polled: supported.length,
    unsupported: approved.filter((r) => !SUPPORTED.includes(r.provider)).map((r) => ({ id: r.id, company_id: r.company_id, provider: r.provider })),
    review: rows.filter((r) => r.status === 'review').map((r) => ({ id: r.id, company_id: r.company_id, provider: r.provider, token: r.token, why: r.basis })),
    paused: rows.filter((r) => r.status === 'paused').map((r) => r.id),
    companies_in_directory: ds.companies.length, companies_polled: new Set(supported.map((r) => r.company_id)).size,
  };
}
