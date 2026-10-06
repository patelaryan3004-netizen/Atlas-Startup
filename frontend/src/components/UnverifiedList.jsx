import { useEffect, useState } from 'react';
import { fetchStartupPage } from '../api.js';
import { useEscapeClose } from '../hooks/useEscapeClose.js';

const SHOWN = 200;
// A default that is the same object every render: a fresh {} each time would make the effect below run again
// after every render, for ever.
const NO_FILTERS = {};

// The companies in the current results whose location is not confirmed (so they have no pin): asked of the
// server, which counts them all and sends the first two hundred.
export default function UnverifiedList({ filters = NO_FILTERS, onClose }) {
  useEscapeClose(onClose);
  const [state, setState] = useState({ items: [], count: 0, status: 'loading' });

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ items: [], count: 0, status: 'loading' });
    fetchStartupPage({ ...filters, verified: 'no' }, { limit: SHOWN, sort: 'name', signal: ctrl.signal })
      .then((page) => { if (!ctrl.signal.aborted) setState({ items: page.results, count: page.count, status: 'ready' }); })
      .catch((err) => { if (!ctrl.signal.aborted && err.name !== 'AbortError') setState({ items: [], count: 0, status: 'error' }); });
    return () => ctrl.abort();
  }, [filters]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" aria-label="Close" onClick={onClose}>✕</button>
        <h2>Unconfirmed location{state.status === 'ready' ? ` (${state.count})` : ''}</h2>
        <p className="modal-sub">
          No pin on the map yet — city or address not confirmed. Listed here instead of guessed.
        </p>
        {state.status === 'loading' && <p className="modal-sub">Loading…</p>}
        {state.status === 'error' && <p className="form-error">Could not load this list right now.</p>}
        <ul className="unverified-list">
          {state.items.map((s) => (
            <li key={s.slug || s.name}>
              <span className="uv-name">{s.name}</span>
              <span className="uv-meta">{s.sectorFull || s.sector} · {s.stage}</span>
            </li>
          ))}
        </ul>
        {state.count > state.items.length && <p className="modal-sub">Showing the first {state.items.length} of {state.count}.</p>}
      </div>
    </div>
  );
}
