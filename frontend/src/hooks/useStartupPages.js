import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchStartupPage } from '../api.js';
import { peek } from '../peek.js';
import { LIST_PAGE as PAGE } from '../snapshotRequests.js';

// The startups of the current filters, in the order asked for, a page at a time: the list (ListView) and the gallery draw from this one. The first page of
// the unfiltered list is in the snapshot file (snapshot.js): when it has arrived it is what is drawn first, so there is no placeholder and nothing moves
// when the server's answer comes (and an unreachable server leaves the list as the snapshot drew it). The next page loads when the end of the list nears the
// screen (the `sentinel` element) or when `loadMore` is called, so the page holds the companies being looked at and not all of them.
//
// `restore` is how many companies the visitor had loaded when they left (the gallery, with a company opened or the map between): the first request then asks
// for that many at once (200 at most: the most the server gives), so they come back to the place they were at. It is used once, for the filters it was kept for.
const LOADING = { items: [], count: 0, hasMore: false, status: 'loading', moreFailed: false };
const readyFrom = (page) => ({ items: page.results, count: page.count, hasMore: page.hasMore, status: 'ready', moreFailed: false });
const MOST = 200;

export function useStartupPages(filters, sort, { restore = 0 } = {}) {
  const asked = (n) => Math.min(Math.max(n, PAGE), MOST);
  const firstPage = (f, s, want) => (want > PAGE ? null : peek.startupPage(f, { limit: PAGE, offset: 0, sort: s }));
  const [state, setState] = useState(() => { const known = firstPage(filters, sort, restore); return known ? readyFrom(known) : LOADING; });
  const latest = useRef(state);
  latest.current = state;
  const generation = useRef(0);
  const busy = useRef(false);
  const sentinel = useRef(null);
  const origin = useRef({ filters, sort }); // the restore is for the filters and the sort the list opened with, and for nothing it is changed to

  useEffect(() => {
    const ctrl = new AbortController();
    generation.current += 1;
    busy.current = false;
    const want = filters === origin.current.filters && sort === origin.current.sort ? restore : 0;
    const known = firstPage(filters, sort, want);
    setState((now) => (known ? (now.status === 'ready' && now.items === known.results ? now : readyFrom(known)) : LOADING));
    let shown = Boolean(known);
    const draw = (page) => { if (!ctrl.signal.aborted) setState((now) => (now.status === 'ready' && now.items === page.results ? now : readyFrom(page))); };
    fetchStartupPage(filters, { limit: asked(want), offset: 0, sort, signal: ctrl.signal, onSnapshot: want > PAGE ? undefined : (page) => { shown = true; draw(page); } })
      .then(draw)
      .catch((err) => { if (!ctrl.signal.aborted && err.name !== 'AbortError' && !shown) setState({ items: [], count: 0, hasMore: false, status: 'error', moreFailed: false }); });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, sort]);

  const loadMore = useCallback(async () => {
    const now = latest.current;
    if (busy.current || !now.hasMore) return;
    busy.current = true;
    const mine = generation.current;
    try {
      const page = await fetchStartupPage(filters, { limit: PAGE, offset: now.items.length, sort });
      if (mine === generation.current) setState((s) => ({ ...s, items: [...s.items, ...page.results], count: page.count, hasMore: page.hasMore, moreFailed: false }));
    } catch (e) {
      if (mine === generation.current) setState((s) => ({ ...s, moreFailed: true }));
    } finally {
      if (mine === generation.current) busy.current = false;
    }
  }, [filters, sort]);

  useEffect(() => {
    if (!state.hasMore || state.moreFailed || typeof IntersectionObserver === 'undefined' || !sentinel.current) return undefined;
    const observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) loadMore(); }, { rootMargin: '600px' });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [state.hasMore, state.moreFailed, state.items.length, loadMore]);

  return { state, loadMore, sentinel };
}
