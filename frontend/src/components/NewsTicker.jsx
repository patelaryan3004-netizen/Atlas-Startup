import { useCallback, useEffect, useState } from 'react';
import { fetchNews } from '../api.js';

const STATUS_LABEL = { live: 'live', cache: 'cached', seeded: 'seeded' };

// The news on the map: a small pill ("News") until it is pressed, then a card with the headlines, a refresh and a way to hide it.
export default function NewsTicker({ visible, onClose }) {
  const [deals, setDeals] = useState([]);
  const [status, setStatus] = useState('live');
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback((force = false) => {
    if (force) setRefreshing(true);
    return fetchNews(force)
      .then(({ source, deals }) => {
        setDeals(deals);
        setStatus(STATUS_LABEL[source] || source);
      })
      .catch(() => setStatus('unavailable'))
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  if (!visible) return null;

  return (
    <div id="newsTicker" className={expanded ? 'nt-expanded' : 'nt-collapsed'}>
      {expanded ? (
        <>
          <div className="nt-head">
            <button className="nt-title" aria-expanded="true" aria-controls="newsTickerBody" onClick={() => setExpanded(false)}>
              AU Startup Deals <span className="nt-live">● {refreshing ? 'refreshing…' : status}</span>
            </button>
            <div className="nt-head-actions">
              <button className="nt-refresh" title="Get the latest news" onClick={() => load(true)} disabled={refreshing}>↻</button>
              <button className="nt-close" title="Hide news" onClick={onClose}>✕</button>
            </div>
          </div>
          <div id="newsTickerBody" className="nt-body">
            {deals.map((d) => (
              <a className="nt-item" href={d.url} target="_blank" rel="noopener noreferrer" key={d.url}>
                <span className="nt-headline">{d.headline}</span>
                <span className="nt-meta">{d.meta}</span>
              </a>
            ))}
          </div>
        </>
      ) : (
        <button className="nt-pill" aria-expanded="false" aria-controls="newsTickerBody" title={`AU Startup Deals · ${status}`} onClick={() => setExpanded(true)}>
          <span className={status === 'unavailable' ? 'nt-dot nt-dot-off' : 'nt-dot'} aria-hidden="true">●</span>
          News<span className="sr-only"> ({status})</span>
        </button>
      )}
    </div>
  );
}
