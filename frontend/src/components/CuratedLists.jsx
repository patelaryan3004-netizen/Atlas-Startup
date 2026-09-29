import { useEffect, useState } from 'react';
import { fetchStartups } from '../api.js';
import { curatedLists } from '../curatedLists.js';
import { useEscapeClose } from '../hooks/useEscapeClose.js';

function buildShareUrl(filters) {
  const url = new URL(window.location.href);
  url.search = '';
  Object.entries(filters).forEach(([k, v]) => {
    if (v) url.searchParams.set(k, v);
  });
  return url.toString();
}

export default function CuratedLists({ currentFilters, onApply, onClose }) {
  useEscapeClose(onClose);
  const [allStartups, setAllStartups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchStartups({})
      .then(({ results }) => setAllStartups(results))
      .catch(() => setAllStartups([]))
      .finally(() => setLoading(false));
  }, []);

  const handleShare = async () => {
    const url = buildShareUrl(currentFilters);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      /* clipboard unavailable, silently ignore */
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" aria-label="Close" onClick={onClose}>✕</button>
        <h2>Curated lists</h2>
        <p className="modal-sub">Preset views into the map. Pick one to apply its filters, or share your current view.</p>

        <button className="hdrbtn" onClick={handleShare}>
          {copied ? 'Copied!' : '🔗 Share current view'}
        </button>

        <div className="curated-list-grid">
          {curatedLists.map((list) => {
            if (list.type === 'people') {
              return (
                <details className="curated-card curated-card-people" key={list.id}>
                  <summary>
                    <h3>{list.name}</h3>
                    <p className="curated-card-desc">{list.description}</p>
                    <span className="curated-card-count">
                      {list.people.length ? `${list.people.length} people` : 'No one listed yet'}
                    </span>
                  </summary>
                  {list.people.length > 0 && (
                    <ul className="people-list">
                      {list.people.map((p) => (
                        <li className="people-item" key={p.name}>
                          <div className="people-item-head">
                            <span className="people-item-name">{p.name}</span>
                            {p.link && (
                              <a href={p.link} target="_blank" rel="noopener noreferrer" title={`Open link for ${p.name}`}>↗</a>
                            )}
                          </div>
                          <div className="people-item-meta">{p.role}{p.company ? ` · ${p.company}` : ''}</div>
                          {p.why && <p className="people-item-why">{p.why}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              );
            }

            const count = loading ? null : allStartups.filter(list.match).length;
            return (
              <div className="curated-card" key={list.id}>
                <h3>{list.name}</h3>
                <p className="curated-card-desc">{list.description}</p>
                <div className="curated-card-footer">
                  <span className="curated-card-count">{loading ? '…' : count} companies</span>
                  <button
                    className="taskbtn"
                    onClick={() => {
                      onApply(list.filters);
                      onClose();
                    }}
                  >
                    View this list
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
