import { useEffect, useState } from 'react';
import { fetchStartupPage, fetchCounts, fetchInvestors } from '../../api.js';
import { fetchEvents, fetchJobs } from '../../networkApi.js';
import { COLLECTIONS } from './collections.js';

// One request, as a piece of state: { status: 'idle' | 'loading' | 'ready' | 'error', data, error }. It asks again when `deps` change, stops when the page goes, and asks nothing while `enabled`
// is false (the members' side being closed, or no one signed in, is "idle", not a failure).
export function useResource(load, deps, enabled = true) {
  const [state, setState] = useState({ status: enabled ? 'loading' : 'idle', data: null, error: '' });
  useEffect(() => {
    if (!enabled) { setState({ status: 'idle', data: null, error: '' }); return undefined; }
    const ctrl = new AbortController();
    setState((s) => ({ ...s, status: 'loading' }));
    Promise.resolve(load(ctrl.signal)).then(
      (data) => { if (!ctrl.signal.aborted) setState({ status: 'ready', data, error: '' }); },
      (err) => { if (!ctrl.signal.aborted && err?.name !== 'AbortError') setState({ status: 'error', data: null, error: err?.message ?? 'Something went wrong.' }); },
    );
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled]);
  return state;
}

// What the Community page reads, all of it already public or the member's own:
//   from the directory   verified companies (pictures first), what is new this week, who is hiring, published investor firms, the counts behind each collection
//   from the hiring desk the newest roles; from the events list the upcoming events
// The members' side (projects, members, posts, matches) has its own panels, which ask for themselves and only when it is open. Nothing is invented: an empty answer stays empty and the page says so.
export function useCommunityData({ wantRoles = false } = {}) {
  const products = useResource((signal) => fetchStartupPage({}, { limit: 12, sort: 'pictures', view: 'full', signal }), []);
  const fresh = useResource((signal) => fetchStartupPage({ fresh: 'week' }, { limit: 6, sort: 'name', signal }), []);
  const investors = useResource((signal) => fetchInvestors({ kind: 'firm', scope: 'au' }, { limit: 6, signal }), []);
  // The hiring desk's roles (read from each employer's own job page): the roles block and the hiring companies are both made from them, so they cannot disagree.
  // It is the whole board (up to six pages of a hundred), so a count of a company's roles is its real count; and it is asked for only when the page leads with roles or hiring.
  const roles = useResource(allRoles, [], wantRoles);
  const events = useResource((signal) => fetchEvents({ limit: 6 }, { signal }), []);
  const counts = useResource(async (signal) => {
    const startups = COLLECTIONS.filter((c) => c.kind === 'startups');
    const [byFilter, firms] = await Promise.all([
      fetchCounts(startups.map((c) => c.filters), { signal }),
      fetchInvestors(COLLECTIONS.find((c) => c.kind === 'investors').filters, { limit: 3, signal }),
    ]);
    return Object.fromEntries([...startups.map((c, i) => [c.id, byFilter.counts[i]]), ['early-investors', firms.count ?? firms.total]]);
  }, []);
  return { products, fresh, investors, roles, events, counts };
}

// Every role the hiring desk lists in Australia, a page of a hundred at a time.
export async function allRoles(signal) {
  const first = await fetchJobs({ limit: 100, where: 'au' }, { signal });
  const total = first.count ?? first.total ?? first.results.length;
  const pages = [];
  for (let offset = 100; offset < Math.min(total, 600); offset += 100) pages.push(fetchJobs({ limit: 100, offset, where: 'au' }, { signal }));
  const rest = await Promise.all(pages);
  return { results: [...first.results, ...rest.flatMap((p) => p.results)], total };
}

// Founders named on the public page of a company (the same names the company's own page shows), with the company, for the companies already fetched. Nobody is made up and none is a member.
export function foundersOf(companies, limit = 6) {
  const rows = [];
  for (const c of companies ?? []) for (const name of c.founders ?? []) if (rows.length < limit && name) rows.push({ name, company: c.name, slug: c.slug, website: c.website ?? null });
  return rows;
}
