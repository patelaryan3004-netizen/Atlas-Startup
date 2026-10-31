import CheckMenu from './CheckMenu.jsx';
import { Segmented, VcBadge } from '../brand/parts.jsx';
import { splitValues } from '../MultiSelect.jsx';
import { usePopover } from '../../hooks/usePopover.js';
import { PinIcon, ChevronDown, SlidersIcon, MapIcon, ListIcon, CheckIcon } from './icons.jsx';

// The bar across the top of the workspace: where (a city, with a menu of the cities), what is shown (All, Startups or VCs), the filters, and the switch
// between the map and the list. A city chosen here is the filter `city` of the filter panel, so the map, the list, the counts and the search all narrow to
// it, and "Australia" alone is no city at all. What is shown is not a filter of the directory: it says which layers of the map (and which list) are on.
// The search is not here: it is the box beside the heading (ExploreHero), and the sector and the rest of the filters are in the Filters panel. With only
// VCs on, the Sector and Stage menus join the bar, because the panel's filters are about startups.
export const ENTITIES = [['all', 'All'], ['startups', 'Startups'], ['vcs', 'VCs']];

const BADGE_LEFT_OUT = ['search', 'city'];

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

export function LocationMenu({ cities, selected, total, onSelect, allLabel = 'All of Australia' }) {
  const { open, setOpen, close, ref } = usePopover();
  const known = new Set(cities.map((c) => c.city));
  const extra = selected.filter((city) => !known.has(city));
  const options = [...extra.map((city) => ({ city, count: null })), ...cities];
  return (
    <div className="xt-loc" ref={ref}>
      <button type="button" className="xt-locbtn" aria-haspopup="true" aria-expanded={open} aria-label={`City: ${placeLabel(selected)}`} onClick={() => setOpen((v) => !v)}>
        <PinIcon size={20} className="xt-pin" />
        <strong className="xt-here">{placeLabel(selected)}</strong>
        <ChevronDown size={18} className="xt-chev" />
      </button>
      {open && (
        <div className="xt-pop xt-citypop" role="group" aria-label="Choose a city">
          <button type="button" className={selected.length === 0 ? 'xt-opt xt-opt-on' : 'xt-opt'} aria-pressed={selected.length === 0} onClick={() => { onSelect(''); close(); }}>
            <span>{allLabel}</span>
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

const SHOW_OPTIONS = ENTITIES.map(([id, label]) => ({ id, label, badge: id === 'vcs' ? <span aria-hidden="true"><VcBadge /></span> : null }));
const VIEW_OPTIONS = [
  { id: 'map', label: 'Map', icon: <MapIcon size={20} /> },
  { id: 'list', label: 'List', icon: <ListIcon size={20} /> },
];

export default function ExploreToolbar({
  filters, onFilterChange, cities, total, filtersOpen, onToggleFilters, filtersRef, viewMode, onSetViewMode,
  entity = 'all', onEntityChange, vcOptions = { sectors: [], stages: [] },
}) {
  const selectedCities = splitValues(filters.city);
  // The filters on, for the badge: not the search (it has its own box), nor the city (it has its menu). With only VCs on, the sector and the stage have menus.
  const leftOut = entity === 'vcs' ? [...BADGE_LEFT_OUT, 'sector', 'stage'] : BADGE_LEFT_OUT;
  const activeCount = Object.entries(filters).filter(([key, value]) => value && !leftOut.includes(key)).length;
  const chooseCity = (city) => onFilterChange({ city: nextCity(filters.city, city) });
  return (
    <div className="xt">
      <LocationMenu cities={cities} selected={selectedCities} total={total} onSelect={chooseCity} />
      {onEntityChange && <Segmented className="xt-entity" label="What the map shows" options={SHOW_OPTIONS} value={entity} onChange={onEntityChange} />}
      <span className="xt-divider" aria-hidden="true" />
      {entity === 'vcs' && (
        <div className="xt-vcmenus">
          <CheckMenu label="Sector" options={vcOptions.sectors} value={filters.sector} onChange={(sector) => onFilterChange({ sector })} noun="sectors" />
          <CheckMenu label="Stage" options={vcOptions.stages} value={filters.stage} onChange={(stage) => onFilterChange({ stage })} noun="stages" />
        </div>
      )}
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
        <span className="xt-btn-text"><span className="xt-btn-word">Filters</span>{activeCount ? <span className="xt-badge">{activeCount}</span> : null}</span>
      </button>
      <Segmented className="xt-view" label="How the startups are shown" options={VIEW_OPTIONS} value={viewMode} onChange={onSetViewMode} />
    </div>
  );
}
