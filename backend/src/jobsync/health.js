// The sync's account of itself: one row per refresh in job_health.json, so "is it working?" has an answer that is not a log line.
//
//   companies_with_sources   directory companies with at least one approved board the sync reads
//   boards_ok / boards_failed   boards read whole in this refresh / boards that could not be read (their roles were left as they were)
//   open_roles               roles on the hiring desk now (open, worked in Australia, confirmed within two weeks): the same number the page shows
//   new_roles / closed_roles   roles first seen in this refresh / roles that stopped being listed in it (hidden or archived; never deleted)
//   duplicates_removed       roles hidden in this refresh because another board lists the same role (dedupe.js)
// Beside these, what a person needs to see at a glance: how much of the directory has been looked at, what is waiting for review, and which boards need attention.
import { buildBoard } from '../network/board.js';
import { employerMap } from './employers.js';
import { SUPPORTED } from './providers.js';
import { needsAttention } from './state.js';
import { HEALTH_KEEP } from '../models/jobDiscovery.js';

export function buildHealthRow(ds, { at, boards = {}, totals = {}, dedupe = {}, discovery = null, vc = null, stoppedFor = null, trigger = 'cli', slot = null }) {
  const approved = (ds.job_sources ?? []).filter((s) => s.status === 'approved');
  const polled = approved.filter((s) => SUPPORTED.includes(s.provider));
  const state = new Map((ds.job_sync_state ?? []).map((r) => [r.source_id, r]));
  const employers = employerMap(ds);
  const cards = new Map([...employers].map(([id, e]) => [id, { name: e.name, slug: e.slug, city: e.city, sector: e.sector, stage: e.stage, website: e.website, kind: e.kind, logo: e.logo, investors: e.investors }]));
  const board = buildBoard({ jobs: ds.jobs, cardOf: (id) => cards.get(id) ?? null, sync: { sources: ds.job_sources ?? [], state: ds.job_sync_state ?? [] }, names: new Map([...employers].map(([id, e]) => [id, { name: e.name, slug: e.slug }])), now: Date.parse(at) });
  const coverage = ds.job_coverage ?? [];
  const lastSuccess = polled.map((s) => state.get(s.id)?.last_success_at).filter(Boolean).sort().at(-1) ?? null;
  return {
    id: `health-${at.replace(/\D/g, '')}`, at, trigger, slot,
    companies_with_sources: new Set(polled.map((s) => s.company_id)).size,
    boards_approved: approved.length, boards_polled: polled.length, boards_unsupported: approved.length - polled.length,
    boards_ok: boards.ok ?? 0, boards_failed: boards.failed ?? 0, boards_held_empty: boards.held ?? 0,
    boards_needing_attention: polled.filter((s) => needsAttention(state.get(s.id))).map((s) => s.id),
    open_roles: board.totals.roles, open_roles_companies: board.totals.companies,
    new_roles: totals.added ?? 0, closed_roles: (totals.hidden ?? 0) + (totals.archived ?? 0), roles_listed_again: totals.reopened ?? 0,
    duplicates_removed: dedupe.removed ?? 0, duplicates_hidden: dedupe.hidden ?? 0,
    companies_eligible: discovery?.eligible ?? null,
    companies_looked_at: coverage.length, companies_with_board: coverage.filter((r) => r.outcome === 'board').length, companies_for_review: coverage.filter((r) => r.review).length,
    vc_boards_checked: vc?.checked ?? 0, vc_boards_readable: (ds.job_vc_boards ?? []).filter((r) => r.access === 'public_sample').length,
    leads_waiting: (ds.job_leads ?? []).filter((l) => l.status === 'needs_review' && l.kind !== 'investor_hiring').length,
    stopped_for: stoppedFor, last_success_at: lastSuccess,
  };
}

// Newest last, trimmed.
export function pushHealth(work, row) {
  work.job_health ??= [];
  work.job_health.push(row);
  if (work.job_health.length > HEALTH_KEEP) work.job_health.splice(0, work.job_health.length - HEALTH_KEEP);
}
