import { LocationMenu, nextCity } from './ExploreToolbar.jsx';
import { splitValues } from '../MultiSelect.jsx';

// What is written over the map on the map page: the edition's kicker, the place the map is looking at as a heading that opens the cities ("Australia", or the city
// that was picked), and one line under it that says what the picture is. The compass sits in the opposite corner. All of it is a label on the map, not a control
// beyond the city menu.
export default function AtlasOverlay({ filters, onFilterChange, cities, national, pinned }) {
  const selected = splitValues(filters.city);
  const line = national
    ? 'National overview'
    : Number.isFinite(pinned) ? `${pinned.toLocaleString('en-AU')} ${pinned === 1 ? 'organisation' : 'organisations'} with a pin on the map` : '';
  return (
    <>
      <div className={national ? 'at-over' : 'at-over at-over-card'}>
        <p className="at-over-kicker">The Australian edition</p>
        <LocationMenu allLabel="All Australia" cities={cities} selected={selected} onSelect={(city) => onFilterChange({ city: nextCity(filters.city, city) })} />
        <p className="at-over-line">{line}</p>
      </div>
      <svg className="at-compass" viewBox="0 0 52 52" width="46" height="46" aria-hidden="true" focusable="false">
        <circle cx="26" cy="26" r="25" className="at-compass-disc" />
        <text x="26" y="14" textAnchor="middle" className="at-compass-n">N</text>
        <path d="M26 17 31 30 26 27.5 21 30Z" className="at-compass-needle" />
        <path d="M26 27.5 31 30 26 42 21 30Z" className="at-compass-tail" />
      </svg>
    </>
  );
}
