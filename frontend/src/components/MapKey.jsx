import { useState } from 'react';
import { useEscapeClose } from '../hooks/useEscapeClose.js';
import { CLUSTER_MEDIUM, CLUSTER_LARGE } from '../mapPins.js';

// One mark and what it means. The marks are drawn with the map's own classes (shrunk in styles.css), so the key shows what the
// map draws and cannot fall behind it.
function Row({ mark, children }) {
  return (
    <div className="mk-row">
      <span className="mk-mark" aria-hidden="true">{mark}</span>
      <p className="mk-text">{children}</p>
    </div>
  );
}

function Pin({ extra = '', children }) {
  return (
    <span className={`custom-pin-badge ${extra}`.trim()} style={{ borderColor: 'var(--muted)' }}>
      <span className="pin-fallback" style={{ background: 'var(--muted)' }}>A</span>
      {children}
    </span>
  );
}

// The sectors, grouped by the colour the map gives them: the map has far fewer colours than the directory has sectors (the sector
// is free text), so several share one, and a pin's colour is decoded by finding it here and reading the sectors beside it.
function coloursOf(sectorColors) {
  const byColour = new Map();
  for (const [sector, colour] of Object.entries(sectorColors).sort(([a], [b]) => a.localeCompare(b))) {
    if (!byColour.has(colour)) byColour.set(colour, []);
    byColour.get(colour).push(sector);
  }
  return [...byColour];
}

function KeyPanel({ sectorColors, onClose }) {
  useEscapeClose(onClose);
  const colours = coloursOf(sectorColors);
  const sectorCount = Object.keys(sectorColors).length;

  return (
    <section id="mapKey" aria-label="Map key">
      <div className="mk-head">
        <h2 className="mk-title">Map key</h2>
        <button type="button" className="mk-close" aria-label="Close the map key" onClick={onClose}>&#10005;</button>
      </div>

      <div className="mk-group">
        <h3 className="mk-label">A company</h3>
        <Row mark={<Pin />}>A company. The edge of its pin takes the colour of its sector.</Row>
        <Row mark={<Pin extra="pin-approx" />}>A dashed edge: placed at the suburb, not the office.</Row>
        <Row mark={<Pin><span className="pin-hiring-dot" /></Pin>}>A green dot: hiring now (an open role was checked).</Row>
        <Row mark={<Pin><span className="pin-tracked-star">&#9733;</span></Pin>}>A gold star: a company you track (kept in this browser).</Row>
      </div>

      {colours.length > 0 && (
        <details className="mk-group mk-colours">
          <summary>Colour of each sector</summary>
          {colours.length < sectorCount && <p className="mk-note-inline">There are more sectors than colours, so some share one.</p>}
          <ul className="mk-sectors">
            {colours.map(([colour, names]) => (
              <li key={colour}>
                <i className="mk-sector-dot" aria-hidden="true" style={{ background: colour }} />
                <span>{names.join(', ')}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mk-group">
        <h3 className="mk-label">Places</h3>
        <Row mark={<span className="marker-cluster-inner cluster-medium">12</span>}>
          A numbered circle: companies close together. Click to zoom in.
        </Row>
        <p className="mk-sizes">
          <span><i className="mk-dot cluster-small" aria-hidden="true" />under {CLUSTER_MEDIUM}</span>
          <span><i className="mk-dot cluster-medium" aria-hidden="true" />{CLUSTER_MEDIUM} to {CLUSTER_LARGE - 1}</span>
          <span><i className="mk-dot cluster-large" aria-hidden="true" />{CLUSTER_LARGE} or more</span>
        </p>
        <Row mark={<span className="mk-ring" />}>A dashed ring: companies known only to a city or a state, so no pin. Click its label to open them.</Row>
      </div>

      <p className="mk-note">Names appear under the pins as you zoom in, where there is room for them.</p>
    </section>
  );
}

// The key to the map's marks, behind a button so it is out of the way until it is wanted. It is for the map: the list has no marks.
export default function MapKey({ sectorColors = {} }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        id="mapKeyToggle"
        className="hdrbtn"
        title="What the marks on the map mean"
        aria-expanded={open}
        aria-controls="mapKey"
        onClick={() => setOpen((v) => !v)}
      >
        Key
      </button>
      {open && <KeyPanel sectorColors={sectorColors} onClose={() => setOpen(false)} />}
    </>
  );
}
