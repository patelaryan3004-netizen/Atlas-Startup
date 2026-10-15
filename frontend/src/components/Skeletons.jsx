import { initialLayout } from '../listLayout.js';

// What stands in for a page of data while it arrives: the shape of what is coming, in the real card's own box (same border, radius,
// padding and gap), so nothing is blank and nothing moves when the cards replace it. They say "Loading" to a screen reader once, and
// draw nothing else for it. See "Loading placeholders" in styles.css.

const bar = (width, height = 14, className = '') => <span className={`skeleton-bar${className ? ` ${className}` : ''}`} style={{ width, height }} />;

export function CardSkeleton() {
  return (
    <div className="card entity-card skeleton-card" aria-hidden="true">
      <div className="entity-top">
        <span className="skeleton-dot" style={{ width: 40, height: 40 }} />
        {bar('55%', 18)}
      </div>
      <div className="skeleton-lines">
        {bar('100%')}
        {bar('78%')}
      </div>
      {bar('42%')}
    </div>
  );
}

// A grid of cards, in the same grid the real cards sit in (`className`: startup-grid on the list, landing-job-grid on the landing page).
export function CardGridSkeleton({ count = 6, className = 'startup-grid' }) {
  return (
    <div className={className} role="status" aria-busy="true">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: count }, (_, i) => <CardSkeleton key={i} />)}
    </div>
  );
}

// The list as a table: rows of the table's own height inside the table's own frame.
export function TableSkeleton({ rows = 10 }) {
  return (
    <div className="startup-table-wrap skeleton-table" role="status" aria-busy="true">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton-row" key={i} aria-hidden="true">
          <span className="skeleton-dot" style={{ width: 28, height: 28 }} />
          {bar('26%', 14, 'skeleton-row-name')}
          {bar('12%')}
          {bar('9%')}
        </div>
      ))}
    </div>
  );
}

// The list while it loads, in the layout the visitor will get.
export function ListSkeleton() {
  return initialLayout() === 'table' ? <TableSkeleton /> : <CardGridSkeleton count={9} />;
}

// The map while its file (Leaflet and the pins' code) arrives: the ground the map is drawn on, filling the screen the map will fill.
export function MapPlaceholder() {
  return (
    <div className="map-placeholder" role="status" aria-busy="true">
      <span className="sr-only">Loading the map…</span>
    </div>
  );
}
