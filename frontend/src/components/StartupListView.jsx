export default function StartupListView({ startups, sectorColors, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" aria-label="Close" onClick={onClose}>✕</button>
        <h2>Startups in view ({startups.length})</h2>
        <p className="modal-sub">Matches your current filters. Dot color = sector (see map pins).</p>
        <ul className="unverified-list">
          {startups.map((s) => (
            <li key={s.name}>
              <span className="uv-name">
                <span className="dot" style={{ background: sectorColors[s.sector] || '#444', display: 'inline-block', marginRight: 6 }} />
                {s.name}{!s.verified && <span className="taskgate-badge taskgate-locked" style={{ marginLeft: 6 }}>NO PIN</span>}
              </span>
              <span className="uv-meta">{s.city} · {s.stage}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
