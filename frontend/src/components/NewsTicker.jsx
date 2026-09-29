import { useCallback, useEffect, useState } from 'react';
import { fetchNews } from '../api.js';

const STATUS_LABEL = { live: 'live', cache: 'cached', seeded: 'seeded' };

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
      <div className="nt-head">
        <button className="nt-title" onClick={() => setExpanded((v) => !v)}>
          AU Startup Deals <span className="nt-live">● {refreshing ? 'refreshing…' : status}</span>
        </button>
        <div className="nt-head-actions">
          <button className="nt-refresh" title="Get the latest news" onClick={() => load(true)} disabled={refreshing}>↻</button>
          <button className="nt-close" title="Hide news" onClick={onClose}>✕</button>
        </div>
      </div>
      {!expanded && deals[0] && (
        <button className="nt-preview" onClick={() => setExpanded(true)}>{deals[0].headline}</button>
      )}
      {expanded && (
        <div className="nt-body">
          {deals.map((d) => (
            <a className="nt-item" href={d.url} target="_blank" rel="noopener noreferrer" key={d.url}>
              <span className="nt-headline">{d.headline}</span>
              <span className="nt-meta">{d.meta}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
