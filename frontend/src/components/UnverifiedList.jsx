import { useEffect, useRef, useState } from 'react';
import { fetchStartupPage } from '../api.js';
import { useEscapeClose } from '../hooks/useEscapeClose.js';

const PAGE = 20;
// A default that is the same object every render: a fresh {} each time would make the effect below run again
// after every render, for ever.
const NO_FILTERS = {};

// The companies in the current results whose location is not confirmed (so they have no pin): asked of the
// server a page at a time (it counts them all), with "Show more" for the next.
export default function UnverifiedList({ filters = NO_FILTERS, onClose }) {
  useEscapeClose(onClose);
  const [state, setState] = useState({ items: [], count: 0, hasMore: false, status: 'loading', moreFailed: false });
  const [loadingMore, setLoadingMore] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    const ctrl = new AbortController();
    generation.current += 1;
    setState({ items: [], count: 0, hasMore: false, status: 'loading', moreFailed: false });
    fetchStartupPage({ ...filters, verified: 'no' }, { limit: PAGE, offset: 0, sort: 'name', signal: ctrl.signal })
      .then((page) => { if (!ctrl.signal.aborted) setState({ items: page.results, count: page.count, hasMore: page.hasMore, status: 'ready', moreFailed: false }); })
      .catch((err) => { if (!ctrl.signal.aborted && err.name !== 'AbortError') setState({ items: [], count: 0, hasMore: false, status: 'error', moreFailed: false }); });
    return () => ctrl.abort();
  }, [filters]);

  const showMore = async () => {
    const mine = generation.current;
    setLoadingMore(true);
    try {
      const page = await fetchStartupPage({ ...filters, verified: 'no' }, { limit: PAGE, offset: state.items.length, sort: 'name' });
      if (mine === generation.current) setState((s) => ({ ...s, items: [...s.items, ...page.results], count: page.count, hasMore: page.hasMore, moreFailed: false }));
    } catch {
      if (mine === generation.current) setState((s) => ({ ...s, moreFailed: true }));
    } finally {
      setLoadingMore(false);
    }
  };

  const { items, count, hasMore, status, moreFailed } = state;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" aria-label="Close" onClick={onClose}>✕</button>
        <h2>Unconfirmed location{status === 'ready' ? ` (${count})` : ''}</h2>
        <p className="modal-sub">
          No pin on the map yet — city or address not confirmed. Listed here instead of guessed.
        </p>
        {status === 'loading' && <p className="modal-sub">Loading…</p>}
        {status === 'error' && <p className="form-error">Could not load this list right now.</p>}
        <ul className="unverified-list">
          {items.map((s) => (
            <li key={s.slug || s.name}>
              <span className="uv-name">{s.name}</span>
              <span className="uv-meta">{s.sectorFull || s.sector} · {s.stage}</span>
            </li>
          ))}
        </ul>
        {hasMore && (
          <div className="jobs-more">
            <button className="hdrbtn" onClick={showMore} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : moreFailed ? 'Could not load more: try again' : `Show more (${count - items.length} left)`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
