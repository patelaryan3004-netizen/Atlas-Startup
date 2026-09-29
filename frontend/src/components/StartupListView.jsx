import { useEscapeClose } from '../hooks/useEscapeClose.js';

export default function StartupListView({
  startups, sectorColors, onClose, title, subtitle, isTracked, onToggleTracked,
}) {
  useEscapeClose(onClose);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" aria-label="Close" onClick={onClose}>✕</button>
        <h2>{title || `Startups in view (${startups.length})`}</h2>
        <p className="modal-sub">
          {subtitle || 'Matches your current filters. Dot color = sector (see map pins).'}
        </p>
        <ul className="unverified-list">
          {startups.map((s) => (
            <li key={s.name}>
              <span className="uv-name">
                {onToggleTracked && (
                  <button
                    className="track-star"
                    aria-label={isTracked?.(s.name) ? `Untrack ${s.name}` : `Track ${s.name}`}
                    onClick={() => onToggleTracked(s.name)}
                  >
                    {isTracked?.(s.name) ? '★' : '☆'}
                  </button>
                )}
                <span className="dot" style={{ background: sectorColors[s.sector] || '#444', display: 'inline-block', marginRight: 6 }} />
                {s.name}{!s.verified && <span className="badge-unverified" style={{ marginLeft: 6 }}>Unverified</span>}
              </span>
              <span className="uv-meta">{s.city} · {s.stage}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
