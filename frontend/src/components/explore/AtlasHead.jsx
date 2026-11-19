import { useEffect, useRef } from 'react';
import CheckMenu from './CheckMenu.jsx';
import { ENTITIES, placeLabel } from './ExploreToolbar.jsx';
import { SearchIcon, CloseIcon, SlidersIcon, GridIcon, ChevronDown } from './icons.jsx';
import { linkProps } from '../brand/nav.js';
import { splitValues } from '../MultiSelect.jsx';

// The head of the map page's directory panel: the heading and ONE row of controls (a row that wraps on a narrow panel): the search, the city, the sector, the type of organisation and
// "View list". The stage and the rest of the filters are one press away under "More filters". Everything in it is the page's existing filters: the city is the `city`
// filter, the sector the display sector (the twelve the map and Discover share), the type the layer the map shows (All, Startups, Companies, Investors, Spaces), "View list" is Discover's
// list of exactly this map. Nothing here is a second set of filters.

const TYPE_LABEL = { all: 'All types', startups: 'Startups', companies: 'Companies', vcs: 'Investors', spaces: 'Spaces' };

export default function AtlasHead({
  filters, onFilterChange, sectors = [], cities = [], entity, onEntityChange, filtersOpen, onToggleFilters, filtersRef, filterCount = 0, listHref, onList,
  count, children,
}) {
  const search = useRef(null);
  // "/" jumps to the search, as the box says, unless the visitor is already typing somewhere.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) return;
      event.preventDefault();
      search.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const chosenCities = splitValues(filters.city);
  // One city is a city of the menu; several (an address can name them) is read as they are, so the select says so and does not pretend to be one of the ten.
  const cityValue = chosenCities.length > 1 || (chosenCities.length === 1 && !cities.some((c) => c.city === chosenCities[0])) ? filters.city : chosenCities[0] ?? '';
  const sectorOptions = sectors.filter((s) => s && s.value && s.value !== 'Unknown');
  return (
    <div className="at-head">
      <h1 className="at-title">Startup <em>atlas</em>.</h1>

      <label className="at-search">
        <SearchIcon size={20} className="at-search-icon" />
        <input
          ref={search}
          type="search"
          aria-label="Search organisations on the map"
          placeholder="Name, sector or suburb"
          value={filters.search}
          onChange={(event) => onFilterChange({ search: event.target.value })}
          autoComplete="off"
        />
        {filters.search
          ? <button type="button" className="field-clear" aria-label="Clear the search" onClick={() => { onFilterChange({ search: '' }); search.current?.focus(); }}><CloseIcon size={16} /></button>
          : <kbd className="at-kbd" aria-hidden="true">/</kbd>}
      </label>

      <div className="at-selects">
        <label className="at-select">
          <span className="at-sr">City</span>
          <select aria-label="City" value={cityValue} onChange={(event) => onFilterChange({ city: event.target.value })}>
            <option value="">All Australia</option>
            {cityValue && !cities.some((c) => c.city === cityValue) && <option value={cityValue}>{placeLabel(chosenCities)}</option>}
            {cities.map(({ city }) => <option key={city} value={city}>{city}</option>)}
          </select>
          <ChevronDown size={18} className="at-select-chev" />
        </label>
        <CheckMenu label="Sector" allLabel="All sectors" options={sectorOptions} value={filters.sector} onChange={(sector) => onFilterChange({ sector })} noun="sectors" />
        <label className="at-select">
          <span className="at-sr">What kind of organisation</span>
          <select aria-label="What kind of organisation" value={entity} onChange={(event) => onEntityChange(event.target.value)}>
            {ENTITIES.map(([id]) => <option key={id} value={id}>{TYPE_LABEL[id]}</option>)}
          </select>
          <ChevronDown size={18} className="at-select-chev" />
        </label>
        <a className="at-list" {...linkProps(listHref, onList)}><GridIcon size={18} /><span>View list</span></a>
      </div>

      <div className="at-tools">
        <button
          ref={filtersRef}
          type="button"
          id="fToggle"
          className={filtersOpen || filterCount ? 'xt-btn xt-btn-on xt-filters' : 'xt-btn xt-filters'}
          aria-expanded={filtersOpen}
          aria-controls="filters"
          onClick={onToggleFilters}
        >
          <SlidersIcon size={18} />
          <span className="xt-btn-text"><span className="xt-btn-word">More filters</span>{filterCount ? <span className="xt-badge">{filterCount}</span> : null}</span>
        </button>
        <p className="at-count" role="status" aria-live="polite">{count}</p>
      </div>
      {children}
    </div>
  );
}
