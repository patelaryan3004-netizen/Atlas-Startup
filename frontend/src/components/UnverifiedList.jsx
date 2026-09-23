export default function UnverifiedList({ startups, onClose }) {
  const unverified = startups.filter((s) => !s.verified);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" aria-label="Close" onClick={onClose}>✕</button>
        <h2>Unconfirmed location ({unverified.length})</h2>
        <p className="modal-sub">
          No pin on the map yet — city or address not confirmed. Listed here instead of guessed.
        </p>
        <ul className="unverified-list">
          {unverified.map((s) => (
            <li key={s.name}>
              <span className="uv-name">{s.name}</span>
              <span className="uv-meta">{s.sectorFull || s.sector} · {s.stage}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
