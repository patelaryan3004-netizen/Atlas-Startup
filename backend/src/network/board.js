// The hiring desk's one answer: every open role a visitor can work in Australia, the roles a bookmark may still point at, and an honest account of how current it all is. Pure: rows in, the
// payload out. The page filters, searches and counts this in the browser, so a tap on "Melbourne" answers at once, and the same payload is what the site's snapshot holds.
import { curatedJobs, jobFacets, inPlace, REMOTE_AU, LIFECYCLE_STATES } from './jobs.js';
import { SUPPORTED } from '../jobsync/providers.js';
import { CITIES } from '../jobsync/locations.js';

const PAGE_LIMIT = 600; // a board of a few hundred roles is one small answer; a bigger one would be paged
const LAPSED_LIMIT = 400;

const latest = (values) => values.filter(Boolean).sort().at(-1) ?? null;
const earliest = (values) => values.filter(Boolean).sort()[0] ?? null;

// How current the board is, from the sync's own records and nothing else: when a board was last read whole, which are failing, which the sync cannot read, which are waiting for a person.
export function syncSummary({ sources = [], state = [], names = new Map(), roleCounts = new Map() } = {}) {
  const byId = new Map(state.map((r) => [r.source_id, r]));
  const approved = sources.filter((s) => s.status === 'approved');
  const polled = approved.filter((s) => SUPPORTED.includes(s.provider));
  const row = (s) => {
    const st = byId.get(s.id) ?? null;
    return {
      company: names.get(s.company_id)?.name ?? s.company_id, slug: names.get(s.company_id)?.slug ?? null, provider: s.provider,
      last_success_at: st?.last_success_at ?? null, last_attempt_at: st?.last_attempt_at ?? null, failing: (st?.consecutive_failures ?? 0) > 0, error: st?.last_error?.code ?? null,
      roles: roleCounts.get(s.id) ?? 0,
    };
  };
  return {
    last_success_at: latest(polled.map((s) => byId.get(s.id)?.last_success_at)),
    oldest_success_at: polled.length && polled.every((s) => byId.get(s.id)?.last_success_at) ? earliest(polled.map((s) => byId.get(s.id).last_success_at)) : null,
    last_attempt_at: latest(polled.map((s) => byId.get(s.id)?.last_attempt_at)),
    boards: { approved: approved.length, polled: polled.length, never_read: polled.filter((s) => !byId.get(s.id)?.last_success_at).length, failing: polled.filter((s) => (byId.get(s.id)?.consecutive_failures ?? 0) > 0).length },
    covered: polled.map(row).sort((a, b) => a.company.localeCompare(b.company)),
    unsupported: approved.filter((s) => !SUPPORTED.includes(s.provider)).map((s) => ({ company: names.get(s.company_id)?.name ?? s.company_id, provider: s.provider })),
    review: sources.filter((s) => s.status === 'review').map((s) => ({ company: names.get(s.company_id)?.name ?? s.company_id, provider: s.provider, why: s.basis })),
    // What this does NOT say: the sync polls about once an hour when it is running, and a role appears after the next successful check, not at once.
    interval_minutes: 60,
  };
}

// `jobs` are the stored rows; `cardOf(companyId)` the company's directory card; `extra` approved suggestions; `sync` { sources, state }; `names` company id -> { name, slug }.
export function buildBoard({ jobs, cardOf, extra = [], sync = { sources: [], state: [] }, names = new Map(), now = Date.now() }) {
  const stateOf = new Map((sync.state ?? []).map((r) => [r.source_id, r]));
  const healthOf = (j) => stateOf.get(j.source_id) ?? null;
  const all = curatedJobs({ jobs, cardOf, extra, now, lifecycles: LIFECYCLE_STATES, includeStale: true, healthOf });
  const board = all.filter((j) => j.lifecycle === 'open' && j.confirmation !== 'stale' && j.region === 'au').slice(0, PAGE_LIMIT);
  const onBoard = new Set(board.map((j) => j.id));
  // Roles a bookmark may still point at: anything held that is not on the board, with the status it truly has.
  const lapsed = all.filter((j) => !onBoard.has(j.id)).slice(0, LAPSED_LIMIT).map((j) => ({
    id: j.id, title: j.title, company: { name: j.company.name, slug: j.company.slug, website: j.company.website }, location: j.location, apply_url: j.apply_url,
    lifecycle: j.lifecycle, confirmation: j.confirmation, last_confirmed_at: j.last_confirmed_at, posted_at: j.posted_at, region: j.region,
  }));
  const roleCounts = new Map();
  for (const j of jobs) if (j.status === 'open' && onBoard.has(j.id)) roleCounts.set(j.source_id, (roleCounts.get(j.source_id) ?? 0) + 1);
  const facets = jobFacets(board);
  return {
    schema: 1,
    generated_at: new Date(now).toISOString(),
    roles: board,
    lapsed,
    totals: {
      roles: board.length, companies: new Set(board.map((j) => j.company.slug ?? j.company.name)).size,
      places: Object.fromEntries(CITIES.map((c) => [c, board.filter((j) => inPlace(j, c)).length]).filter(([, n]) => n > 0)),
      remote_au: board.filter((j) => inPlace(j, REMOTE_AU)).length,
      stale_hidden: all.filter((j) => j.lifecycle === 'open' && j.confirmation === 'stale').length,
    },
    facets,
    sync: syncSummary({ sources: sync.sources, state: sync.state, names, roleCounts }),
  };
}
