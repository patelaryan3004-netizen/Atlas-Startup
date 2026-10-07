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

// Clearbit's logo, then Google's favicon, then nothing (the initial rendered underneath shows). Each failure moves
// one step on. A handler that only swapped `src` would be called again by every failure of the new address -
// React keeps its own error listener on an <img>, whatever `onerror` is set to - and for a visitor whose browser
// blocks both addresses (an ad blocker, no network) it never stopped: the panel redrew its logo thousands of
// times a second for as long as it was open.
function PanelLogo({ domain }) {
  const [step, setStep] = useState(0);
  if (step > 1) return null;
  const src = step === 0 ? `https://logo.clearbit.com/${domain}?size=96` : `https://www.google.com/s2/favicons?domain=${domain}&sz=96`;
  return <img className="pc-avatar-logo" src={src} alt="" onError={() => setStep((s) => s + 1)} />;
}

const APPROXIMATE_NOTE = {
  SUBURB: () => 'Approximate: the pin is at the suburb, not the office.',
  CITY: (s) => `No pin: shown as a group in ${s.city || 'its city'} on the map.`,
  STATE: () => 'No pin: shown as a group in its state on the map.',
  UNKNOWN: () => 'Not shown on the map.',
};

// Where the company is, and how well that is known, in the words the site uses everywhere: "Verified office",
// "Location: suburb-level", "Location: city-level". `s.location` comes from the server (or from the pin the panel was
// opened from); a record without it is described as it always was, by whether it has an address.
function LocationCell({ s, loading }) {
  const where = s.location;
  if (!where) {
    return (
      <>
        <div className="sdp-meta-value">{s.city}</div>
        {!loading && <div className="sdp-meta-note">{s.address ? '✓ Address on file' : '◐ City-level only'}</div>}
      </>
    );
  }
  const precision = where.precision;
  const mark = precision === 'EXACT' ? '✓' : precision === 'UNKNOWN' ? '○' : '◐';
  const note = APPROXIMATE_NOTE[precision]?.(s);
  return (
    <>
      <div className="sdp-meta-value">{where.place || s.city}</div>
      <div className={`sdp-meta-note sdp-loc sdp-loc-${precision.toLowerCase()}`}>{mark} {where.quality}</div>
      {note && <div className="sdp-meta-note">{note}</div>}
    </>
  );
}

// News items are free-text headlines with no company field to join on, so a
// startup's name appearing in the headline/meta text is the only honest
// signal of relevance - anything weaker would risk mismatches we can't verify.
function relatedNews(news, startupName) {
  const q = startupName.toLowerCase();
  return news.filter((d) => d.headline.toLowerCase().includes(q) || (d.meta || '').toLowerCase().includes(q));
}

export default function StartupDetailPanel({ startup: s, sectorColor, isTracked, onToggleTracked, onSuggestEdit, onSelectPerson, onClose }) {
  useEscapeClose(onClose);
  const [news, setNews] = useState([]);

  useEffect(() => {
    fetchNews().then(({ deals }) => setNews(deals || [])).catch(() => setNews([]));
  }, []);

  // The map and the list know a company's name, place and sector; the rest arrives a moment after it opens.
  const loading = Boolean(s.partial);
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
              {domain && <PanelLogo key={domain} domain={domain} />}
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
              <LocationCell s={s} loading={loading} />
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

          {loading && <p className="pc-desc sdp-loading" role="status">Loading details…</p>}

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
                      <button className="pc-founder-name pc-founder-name-btn" onClick={() => onSelectPerson(f)}>{f}</button>
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
