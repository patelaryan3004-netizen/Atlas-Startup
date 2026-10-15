import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchStartupPage } from '../api.js';
import { peek } from '../peek.js';
import { LIST_PAGE } from '../snapshotRequests.js';

// The startups of the current filters, a page at a time, for the lists beside the map (the results column on a wide screen, the bottom sheet on a
// phone). They are asked for only while `active`, so a list that is not showing costs nothing; the first page is what the snapshot holds when it
// has arrived, so the list is there at once, and the server's answer then replaces it. Returns [state, more]: state is
// { items, count, hasMore, status ('loading' | 'ready' | 'error'), moreFailed } and more() asks for the next page.
const LOADING = { items: [], count: 0, hasMore: false, status: 'loading', moreFailed: false };
const readyFrom = (page) => ({ items: page.results, count: page.count, hasMore: page.hasMore, status: 'ready', moreFailed: false });
const firstPage = (filters) => peek.startupPage(filters, { limit: LIST_PAGE, offset: 0, sort: 'name' });

export function useStartupResults(filters, active) {
  const [state, setState] = useState(() => { const known = firstPage(filters); return known ? readyFrom(known) : LOADING; });
  const latest = useRef(state);
  latest.current = state;
  const generation = useRef(0);
  const busy = useRef(false);

  useEffect(() => {
    if (!active) return undefined;
    const ctrl = new AbortController();
    generation.current += 1;
    busy.current = false;
    const known = firstPage(filters);
    setState((now) => (known ? (now.status === 'ready' && now.items === known.results ? now : readyFrom(known)) : LOADING));
    let shown = Boolean(known);
    const draw = (page) => { if (!ctrl.signal.aborted) setState((now) => (now.status === 'ready' && now.items === page.results ? now : readyFrom(page))); };
    fetchStartupPage(filters, { limit: LIST_PAGE, offset: 0, sort: 'name', signal: ctrl.signal, onSnapshot: (page) => { shown = true; draw(page); } })
      .then(draw)
      .catch((err) => { if (!ctrl.signal.aborted && err.name !== 'AbortError' && !shown) setState({ items: [], count: 0, hasMore: false, status: 'error', moreFailed: false }); });
    return () => ctrl.abort();
  }, [filters, active]);

  const more = useCallback(async () => {
    const now = latest.current;
    if (busy.current || !now.hasMore) return;
    busy.current = true;
    const mine = generation.current;
    try {
      const page = await fetchStartupPage(filters, { limit: LIST_PAGE, offset: now.items.length, sort: 'name' });
      if (mine === generation.current) setState((s) => ({ ...s, items: [...s.items, ...page.results], count: page.count, hasMore: page.hasMore, moreFailed: false }));
    } catch (e) {
      if (mine === generation.current) setState((s) => ({ ...s, moreFailed: true }));
    } finally {
      if (mine === generation.current) busy.current = false;
    }
  }, [filters]);

  return [state, more];
}
