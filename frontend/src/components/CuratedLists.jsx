import { useEffect, useState } from 'react';
import { fetchCounts } from '../api.js';
import { curatedLists } from '../curatedLists.js';
import { useEscapeClose } from '../hooks/useEscapeClose.js';
import { appUrl } from '../appRoute.js';

// The address of the list view with these filters: the same address the map shows once they are on, so what is shared is what is seen.
function buildShareUrl(filters) {
  return new URL(appUrl({ kind: 'explore' }, { filters, viewMode: 'list' }), window.location.origin).href;
}

export default function CuratedLists({ currentFilters, onApply, onClose }) {
  useEscapeClose(onClose);
  // How many companies each list picks, counted by the server with the same filters "View this list" applies,
  // so the badge and the list it opens cannot disagree (and no company is downloaded to count them). All the lists are
  // counted in one request, not one each; if it fails, every count is null, shown as "?".
  const [counts, setCounts] = useState({});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    const lists = curatedLists.filter((list) => list.type === 'filter');
    if (lists.length === 0) return undefined;
    fetchCounts(lists.map((list) => list.filters))
      .then(({ counts: found }) => found, () => null)
      .then((found) => { if (live) setCounts(Object.fromEntries(lists.map((list, i) => [list.id, found?.[i] ?? null]))); });
    return () => { live = false; };
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
      <div className="modal-panel curated-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" aria-label="Close" onClick={onClose}>✕</button>
        <h2>Curated lists</h2>
        <p className="modal-sub">Discover groups of Australian startups. Pick one to view the companies in it, or share your current view.</p>

        <button className="hdrbtn" onClick={handleShare}>
          {copied ? 'Copied!' : '🔗 Share current view'}
        </button>

        <div className="curated-list-grid">
          {curatedLists.map((list) => {
            if (list.type === 'people') {
              return (
                <details className="curated-card curated-card-people" key={list.id}>
                  <summary>
                    <span className="curated-card-category">{list.category}</span>
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

            const count = counts[list.id];
            return (
              <div className="curated-card" key={list.id}>
                <span className="curated-card-category">{list.category}</span>
                <h3>{list.name}</h3>
                <p className="curated-card-desc">{list.description}</p>
                <div className="curated-card-footer">
                  <span className="curated-card-count">{count === undefined ? '…' : count ?? '?'} companies</span>
                  <button className="taskbtn" onClick={() => onApply(list)}>
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
