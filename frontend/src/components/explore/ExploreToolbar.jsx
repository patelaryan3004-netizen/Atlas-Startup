import { useState } from 'react';
import SearchBar from '../SearchBar.jsx';
import { splitValues, joinValues } from '../MultiSelect.jsx';
import { usePopover } from '../../hooks/usePopover.js';
import { useMediaQuery, DESKTOP } from '../../hooks/useMediaQuery.js';
import { PinIcon, ChevronDown, SlidersIcon, MapIcon, ListIcon, CheckIcon } from './icons.jsx';

// The bar under the header: where (a country and a city, with a menu of the cities), a search box for that place, the sector and the filters,
// and the switch between the map and the list. A city chosen here is the filter `city` of the filter panel, so the map, the list, the counts
// and the search all narrow to it, and "Australia" alone is no city at all.

const SECTOR_FIND_FROM = 8; // a list longer than this gets a box to narrow it
const BADGE_LEFT_OUT = ['search', 'city', 'sector'];

// A word for what the visitor is looking at: the cities they chose, or the whole country.
export function placeLabel(cities) {
  if (cities.length === 0) return 'Australia';
  return cities.length === 1 ? cities[0] : `${cities.length} cities`;
}

// The `city` filter after a city is picked in the menu or on the map's dock: that city replaces the choice, the same city picked again leaves it,
// and "" is all of Australia.
export function nextCity(current, city) {
  const chosen = splitValues(current);
  return !city || (chosen.length === 1 && chosen[0] === city) ? '' : city;
}

function LocationMenu({ cities, selected, total, onSelect }) {
  const { open, setOpen, close, ref } = usePopover();
  const known = new Set(cities.map((c) => c.city));
  const extra = selected.filter((city) => !known.has(city));
  const options = [...extra.map((city) => ({ city, count: null })), ...cities];
  return (
    <div className="xt-loc" ref={ref}>
      <button type="button" className="xt-locbtn" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <PinIcon size={22} className="xt-pin" />
        <span className={selected.length ? 'xt-crumb' : 'xt-here'}>Australia</span>
        {selected.length > 0 && (
          <>
            <span className="xt-sep" aria-hidden="true">/</span>
            <strong className="xt-here">{placeLabel(selected)}</strong>
          </>
        )}
        <ChevronDown size={18} className="xt-chev" />
      </button>
      {open && (
        <div className="xt-pop xt-citypop" role="group" aria-label="Choose a city">
          <button type="button" className={selected.length === 0 ? 'xt-opt xt-opt-on' : 'xt-opt'} aria-pressed={selected.length === 0} onClick={() => { onSelect(''); close(); }}>
            <span>All of Australia</span>
            {Number.isFinite(total) && <span className="xt-optcount">{total}</span>}
            {selected.length === 0 && <CheckIcon size={16} className="xt-tick" />}
          </button>
          {options.map(({ city, count }) => {
            const on = selected.includes(city);
            return (
              <button key={city} type="button" className={on ? 'xt-opt xt-opt-on' : 'xt-opt'} aria-pressed={on} onClick={() => { onSelect(city); close(); }}>
                <span>{city}</span>
                {count != null && <span className="xt-optcount">{count}</span>}
                {on && <CheckIcon size={16} className="xt-tick" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SectorMenu({ sectors, value, onChange }) {
  const { open, setOpen, ref } = usePopover();
  const [find, setFind] = useState('');
  const chosen = splitValues(value);
  const known = new Set(sectors);
  const shown = [...chosen.filter((v) => !known.has(v)), ...sectors].filter((v) => v.toLowerCase().includes(find.trim().toLowerCase()));
  const toggle = (v) => onChange(joinValues(chosen.includes(v) ? chosen.filter((x) => x !== v) : [...chosen, v]));
  return (
    <div className="xt-menu" ref={ref}>
      <button type="button" className={chosen.length ? 'xt-btn xt-btn-on' : 'xt-btn'} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>Sector{chosen.length ? <span className="xt-badge">{chosen.length}</span> : null}</span>
        <ChevronDown size={18} className="xt-chev" />
      </button>
      {open && (
        <div className="xt-pop xt-sectorpop" role="group" aria-label="Sector">
          {sectors.length > SECTOR_FIND_FROM && (
            <input type="search" className="xt-find" aria-label="Find a sector" placeholder="Find a sector" value={find} onChange={(e) => setFind(e.target.value)} />
          )}
          <ul className="xt-checklist">
            {shown.map((v) => (
              <li key={v}>
                <label className="xt-check">
                  <input type="checkbox" checked={chosen.includes(v)} onChange={() => toggle(v)} />
                  <span>{v}</span>
                </label>
              </li>
            ))}
            {shown.length === 0 && <li className="xt-none">None match.</li>}
          </ul>
          {chosen.length > 0 && <button type="button" className="xt-clear" onClick={() => onChange('')}>Clear sectors</button>}
        </div>
      )}
    </div>
  );
}

export default function ExploreToolbar({
  filters, onFilterChange, onApplyFilters, meta, cities, total, filtersOpen, onToggleFilters, filtersRef, viewMode, onSetViewMode,
}) {
  const selectedCities = splitValues(filters.city);
  // The filters on, for the badge: not the search (it has its own box), nor the city (it is the breadcrumb) nor the sectors (they have their button).
  const activeCount = Object.entries(filters).filter(([key, value]) => value && !BADGE_LEFT_OUT.includes(key)).length;
  const chooseCity = (city) => onFilterChange({ city: nextCity(filters.city, city) });
  const where = placeLabel(selectedCities);
  const wide = useMediaQuery(DESKTOP, true);
  return (
    <div className="xt">
      <LocationMenu cities={cities} selected={selectedCities} total={total} onSelect={chooseCity} />
      <SearchBar filters={filters} onApplyFilters={onApplyFilters} placeholder={wide ? `Search in ${where}` : 'Search startups'} />
      <SectorMenu sectors={meta.sectors} value={filters.sector} onChange={(sector) => onFilterChange({ sector })} />
      <button
        ref={filtersRef}
        type="button"
        id="fToggle"
        className={filtersOpen || activeCount ? 'xt-btn xt-btn-on xt-filters' : 'xt-btn xt-filters'}
        aria-expanded={filtersOpen}
        aria-controls="filters"
        onClick={onToggleFilters}
      >
        <SlidersIcon size={20} />
        <span className="xt-btn-text">Filters{activeCount ? <span className="xt-badge">{activeCount}</span> : null}</span>
        <ChevronDown size={18} className="xt-chev" />
      </button>
      <div className="xt-view" role="group" aria-label="How the startups are shown">
        <button type="button" className={viewMode === 'map' ? 'xt-seg xt-seg-on' : 'xt-seg'} aria-pressed={viewMode === 'map'} onClick={() => onSetViewMode('map')}>
          <MapIcon size={20} /><span>Map</span>
        </button>
        <button type="button" className={viewMode === 'list' ? 'xt-seg xt-seg-on' : 'xt-seg'} aria-pressed={viewMode === 'list'} onClick={() => onSetViewMode('list')}>
          <ListIcon size={20} /><span>List</span>
        </button>
      </div>
    </div>
  );
}
