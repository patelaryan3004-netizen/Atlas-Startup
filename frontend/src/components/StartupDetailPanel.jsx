import { useEffect, useState } from 'react';
import { fetchNews } from '../api.js';
import { useEscapeClose } from '../hooks/useEscapeClose.js';

function domainOf(website) {
  if (!website) return null;
  try {
    return new URL(website).hostname.replace(/^www\./, '');
  } catch (e) {
    return null;
  }
}

function initialsOf(name) {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (name || '?').slice(0, 2).toUpperCase();
}

// News items are free-text headlines with no company field to join on, so a
// startup's name appearing in the headline/meta text is the only honest
// signal of relevance - anything weaker would risk mismatches we can't verify.
function relatedNews(news, startupName) {
  const q = startupName.toLowerCase();
  return news.filter((d) => d.headline.toLowerCase().includes(q) || (d.meta || '').toLowerCase().includes(q));
}

export default function StartupDetailPanel({ startup: s, sectorColor, isTracked, onToggleTracked, onSuggestEdit, onClose }) {
  useEscapeClose(onClose);
  const [news, setNews] = useState([]);

  useEffect(() => {
    fetchNews().then(({ deals }) => setNews(deals || [])).catch(() => setNews([]));
  }, []);

  const domain = domainOf(s.website);
  const initial = (s.name || '?').trim().charAt(0).toUpperCase();
  const tracked = isTracked(s.name);
  const matchingNews = relatedNews(news, s.name);
  const investorCount = s.investors?.length || 0;

  return (
    <div className="sdp-overlay" onClick={onClose}>
      <div className="sdp-panel" onClick={(e) => e.stopPropagation()}>
        <div className="pc-hero" style={{ background: sectorColor }}>
          <button className="modal-close sdp-close" aria-label="Close" onClick={onClose}>✕</button>
          <div className="pc-hero-top">
            <div className="pc-avatar">
              <span className="pc-avatar-fallback">{initial}</span>
              {domain && (
                <img
                  className="pc-avatar-logo"
                  src={`https://logo.clearbit.com/${domain}?size=96`}
                  alt=""
                  onError={(e) => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=96`;
                  }}
                />
              )}
            </div>
            <div className="pc-hero-text">
              <h4>{s.name}</h4>
              {!s.verified && <span className="badge-unverified">Unverified</span>}
            </div>
          </div>
          <button
            className={tracked ? 'sdp-track sdp-track-active' : 'sdp-track'}
            onClick={() => onToggleTracked(s.name)}
          >
            {tracked ? '★ Tracked' : '☆ Track'}
          </button>
        </div>

        <div className="pc-body">
          <div className="sdp-meta-grid">
            <div className="sdp-meta-cell">
              <div className="pc-section-label">Industry</div>
              <div className="sdp-meta-value">{s.sectorFull || s.sector}</div>
            </div>
            <div className="sdp-meta-cell">
              <div className="pc-section-label">Location</div>
              <div className="sdp-meta-value">{s.city}</div>
              <div className="sdp-meta-note">{s.address ? '✓ Address on file' : '◐ City-level only'}</div>
            </div>
            <div className="sdp-meta-cell">
              <div className="pc-section-label">Stage</div>
              <div className="sdp-meta-value">{s.stage}</div>
            </div>
            <div className="sdp-meta-cell">
              <div className="pc-section-label">Hiring</div>
              <div className="sdp-meta-value">{s.hiring ? 'Hiring now' : 'Not currently hiring'}</div>
            </div>
          </div>

          {s.blurb && (
            <div className="sdp-section">
              <div className="pc-section-label">About</div>
              <p className="pc-desc">{s.blurb}</p>
            </div>
          )}

          {s.founders?.length > 0 && (
            <div className="sdp-section">
              <div className="pc-section-label">Founders</div>
              <div className="pc-founders">
                {s.founders.map((f) => {
                  const search = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${f} ${s.name}`)}`;
                  return (
                    <div className="pc-founder" key={f}>
                      <span className="pc-founder-avatar">{initialsOf(f)}</span>
                      <span className="pc-founder-name">{f}</span>
                      <a className="pc-founder-li" href={search} target="_blank" rel="noopener" title={`Search LinkedIn for ${f}`}>in</a>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(investorCount > 0 || s.stage) && (
            <div className="sdp-section">
              <div className="pc-section-label">Funding</div>
              <p className="pc-desc sdp-funding-line">
                {s.stage}{investorCount > 0 ? ` · backed by ${investorCount} investor${investorCount === 1 ? '' : 's'}` : ''}
              </p>
            </div>
          )}

          {investorCount > 0 && (
            <div className="sdp-section">
              <div className="pc-section-label">Investors</div>
              <div className="pc-investors">
                {s.investors.map((i) => (
                  <div className="pc-inv" key={i}>
                    <span className="pc-inv-avatar">{initialsOf(i)}</span>
                    <span className="pc-inv-name">{i}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="sdp-section">
            <div className="pc-section-label">Hiring</div>
            <div className="pc-badges-row">
              {s.hiring ? (
                <>
                  <span className="hiring-badge">● Hiring now</span>
                  <button className="taskbtn sdp-apply-btn">{s.taskGate?.enabled ? 'Start task → Apply' : 'Apply now'}</button>
                </>
              ) : (
                <span className="hiring-badge hiring-badge-off">Not hiring right now</span>
              )}
            </div>
          </div>

          {matchingNews.length > 0 && (
            <div className="sdp-section">
              <div className="pc-section-label">News</div>
              <div className="sdp-news-list">
                {matchingNews.map((d) => (
                  <a className="sdp-news-item" href={d.url} target="_blank" rel="noopener noreferrer" key={d.url}>
                    {d.headline}
                  </a>
                ))}
              </div>
            </div>
          )}

          {s.vouches?.length > 0 && (
            <details className="pc-vouches sdp-section">
              <summary className="vouch-badge">Vouched by {s.vouches.length}</summary>
              <div className="vouch-list">
                {s.vouches.map((v, i) => (
                  <div className="vouch-item" key={i}>
                    <span className="vouch-item-name">{v.name}</span>
                    {v.role && <span className="vouch-item-role"> · {v.role}</span>}
                    {v.note && <p className="vouch-item-note">{v.note}</p>}
                  </div>
                ))}
              </div>
            </details>
          )}

          {s.website && (
            <a className="pc-link sdp-website-link" href={s.website} target="_blank" rel="noopener noreferrer">
              {s.website.replace(/^https?:\/\//, '')} ↗
            </a>
          )}
          <button className="pc-suggest-edit" onClick={() => onSuggestEdit(s.name)}>✎ Suggest an edit</button>
        </div>
      </div>
    </div>
  );
}
