import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchStartupPage } from '../api.js';

const PAGE = 48;

function domainOf(website) {
  if (!website) return null;
  try {
    return new URL(website).hostname.replace(/^www\./, '');
  } catch (e) {
    return null;
  }
}

function CardLogo({ website, name }) {
  const domain = domainOf(website);
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  const [failed, setFailed] = useState(false);
  const [triedFallback, setTriedFallback] = useState(false);

  if (!domain || failed) {
    return <span className="startup-card-logo-fallback">{initial}</span>;
  }
  const src = triedFallback
    ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
    : `https://logo.clearbit.com/${domain}?size=64`;
  return (
    <img
      className="startup-card-logo"
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => (triedFallback ? setFailed(true) : setTriedFallback(true))}
    />
  );
}

// Only sorts backed by a real field on the startup record. The server sorts, because the browser only ever has
// one page of the list. "Recently added" and "Recently funded" would need a date field that doesn't exist in the
// dataset, so they're left out rather than faked with a stand-in.
const SORTS = {
  name: 'Name (A–Z)',
  hiring: 'Hiring now',
  location: 'Location (A–Z)',
  industry: 'Industry (A–Z)',
};

// The list for the current filters, a page at a time: the next page loads when the end of the list nears the
// screen (or when "Show more" is pressed), so the page holds the companies being looked at and not all of them.
export default function ListView({ filters, sectorColors, onSelectStartup, selectedName, trackedNames }) {
  const [sort, setSort] = useState('name');
  const [state, setState] = useState({ items: [], count: 0, hasMore: false, status: 'loading', moreFailed: false });
  const latest = useRef(state);
  latest.current = state;
  const generation = useRef(0);
  const busy = useRef(false);
  const sentinel = useRef(null);

  useEffect(() => {
    const ctrl = new AbortController();
    generation.current += 1;
    busy.current = false;
    setState({ items: [], count: 0, hasMore: false, status: 'loading', moreFailed: false });
    fetchStartupPage(filters, { limit: PAGE, offset: 0, sort, signal: ctrl.signal })
      .then((page) => { if (!ctrl.signal.aborted) setState({ items: page.results, count: page.count, hasMore: page.hasMore, status: 'ready', moreFailed: false }); })
      .catch((err) => { if (!ctrl.signal.aborted && err.name !== 'AbortError') setState({ items: [], count: 0, hasMore: false, status: 'error', moreFailed: false }); });
    return () => ctrl.abort();
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

  const { items, count, hasMore, status, moreFailed } = state;

  return (
    <div id="startupListView">
      <div className="startup-list-toolbar">
        <span className="startup-list-count">{status === 'ready' ? `${count} ${count === 1 ? 'startup' : 'startups'}` : ''}</span>
        <label className="startup-list-sort">
          Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {Object.entries(SORTS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </label>
      </div>

      {status === 'loading' && <p className="modal-sub startup-list-empty">Loading…</p>}
      {status === 'error' && <p className="form-error startup-list-empty">Could not load the list right now.</p>}
      {status === 'ready' && items.length === 0 && <p className="modal-sub startup-list-empty">No startups match your filters.</p>}

      {items.length > 0 && (
        <div className="startup-grid">
          {items.map((s) => (
            <button
              key={s.slug || s.name}
              className={s.name === selectedName ? 'startup-card startup-card-selected' : 'startup-card'}
              onClick={() => onSelectStartup(s)}
            >
              <div className="startup-card-top">
                <CardLogo website={s.website} name={s.name} />
                <div className="startup-card-heading">
                  <h3>
                    {s.name}
                    {trackedNames?.has(s.name) && <span className="startup-card-tracked" title="Tracked">★</span>}
                  </h3>
                  <div className="startup-card-meta">{s.sectorFull || s.sector} · {s.city} · {s.stage}</div>
                </div>
              </div>

              {s.blurb && <p className="pc-desc startup-card-desc">{s.blurb}</p>}

              <div className="startup-card-tags">
                {s.hiring ? (
                  <span className="hiring-badge">● Hiring now</span>
                ) : (
                  <span className="hiring-badge hiring-badge-off">Not hiring</span>
                )}
                {s.taskGate?.enabled && <span className="taskgate-badge">TASK-GATE</span>}
                {!s.verified && <span className="badge-unverified">Unverified</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      {hasMore && (
        <div className="startup-list-more" ref={sentinel}>
          <button className="hdrbtn" onClick={loadMore}>
            {moreFailed ? 'Could not load more: try again' : `Show more (${count - items.length} left)`}
          </button>
        </div>
      )}
    </div>
  );
}
