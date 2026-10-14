import { GRID_PATH, VIEW, project } from '../landing/australia.js';

// Australia in dots with a mint dot where the map is looking, in the corner of the map. It is the same drawing as the landing page's (no
// company is on it: it only says where the map is), and it is a button: pressing it shows all of Australia again.
const INSIDE = { south: -45, north: -9, west: 112, east: 155 };
const isInside = (view) => view && view.lat >= INSIDE.south && view.lat <= INSIDE.north && view.lng >= INSIDE.west && view.lng <= INSIDE.east;

export default function MapOverview({ view, onShowAll }) {
  const here = isInside(view) ? project(view.lat, view.lng) : null;
  return (
    <button type="button" className="xo" onClick={onShowAll} aria-label="Show all of Australia" title="Show all of Australia">
      <svg viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} aria-hidden="true" focusable="false">
        <path d={GRID_PATH} className="xo-land" />
        {here && (
          <>
            <circle cx={here.x} cy={here.y} r="30" className="xo-halo" />
            <circle cx={here.x} cy={here.y} r="14" className="xo-here" />
          </>
        )}
      </svg>
    </button>
  );
}
