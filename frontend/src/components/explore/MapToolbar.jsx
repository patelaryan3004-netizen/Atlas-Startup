import CheckMenu from './CheckMenu.jsx';
import { LocationMenu, ENTITIES, nextCity } from './ExploreToolbar.jsx';
import { splitValues } from '../MultiSelect.jsx';
import { SearchIcon, SlidersIcon, CloseIcon, GridIcon, ChevronDown } from './icons.jsx';
import { linkProps } from '../brand/nav.js';

const TYPE_LABEL = { all: 'All types', startups: 'Startups', companies: 'Companies', vcs: 'Investors', spaces: 'Spaces' };

// The words for how many there are: the companies that match, and the investors when they are drawn too.
export function countText({ companies, vcs, entity }) {
  const part = (n, one, many) => `${n.toLocaleString('en-AU')} ${n === 1 ? one : many}`;
  if (entity === 'vcs') return Number.isFinite(vcs) ? part(vcs, 'investor', 'investors') : '';
  if (!Number.isFinite(companies)) return '';
  const text = part(companies, 'company', 'companies');
  return entity === 'all' && vcs > 0 ? `${text} and ${part(vcs, 'investor', 'investors')}` : text;
}

// The bar across the top of the map page on a phone: the same controls as the directory panel's row on a wide screen, in two lines. The city (one of the ten cities, or all of
// Australia) and the search; then the sector, the type of organisation, "More filters" (the stage and the rest) and "View list". A city picked here is the `city` filter, so the
// map, the count and the list on Discover agree.
export default function MapToolbar({
  filters, onFilterChange, cities, sectors, companies, vcs, entity, onEntityChange, filtersOpen, onToggleFilters, filtersRef, listHref, onList,
}) {
  const selectedCities = splitValues(filters.city);
  const activeCount = Object.entries(filters).filter(([key, value]) => value && !['search', 'city', 'sector', 'onMap'].includes(key)).length;
  const sectorOptions = (sectors ?? []).filter((s) => s && s.value && s.value !== 'Unknown');
  const text = countText({ companies, vcs, entity });
  return (
    <div className="mt" role="search" aria-label="Find companies on the map">
      <LocationMenu allLabel="All Australia" cities={cities} selected={selectedCities} onSelect={(city) => onFilterChange({ city: nextCity(filters.city, city) })} />
      <label className="mt-search">
        <SearchIcon size={20} className="mt-search-icon" />
        <input
          type="search"
          aria-label="Search companies on the map"
          placeholder="Search by name, sector or suburb"
          value={filters.search}
          onChange={(event) => onFilterChange({ search: event.target.value })}
          autoComplete="off"
        />
        {filters.search && (
          <button type="button" className="field-clear" aria-label="Clear the search" onClick={() => onFilterChange({ search: '' })}><CloseIcon size={16} /></button>
        )}
      </label>
      <div className="mt-row2">
        <CheckMenu label="Sector" options={sectorOptions} value={filters.sector} onChange={(sector) => onFilterChange({ sector })} noun="sectors" />
        <label className="mt-type">
          <span className="sr-only">What kind of organisation</span>
          <select aria-label="What kind of organisation" value={entity} onChange={(event) => onEntityChange(event.target.value)}>
            {ENTITIES.map(([id]) => <option key={id} value={id}>{TYPE_LABEL[id]}</option>)}
          </select>
          <ChevronDown size={18} className="mt-type-chev" />
        </label>
        <button
          ref={filtersRef}
          type="button"
          id="fToggle"
          className={filtersOpen || activeCount ? 'xt-btn xt-btn-on xt-filters' : 'xt-btn xt-filters'}
          aria-label="More filters"
          aria-expanded={filtersOpen}
          aria-controls="filters"
          onClick={onToggleFilters}
        >
          <SlidersIcon size={20} />
          <span className="xt-btn-text"><span className="xt-btn-word">More filters</span>{activeCount ? <span className="xt-badge">{activeCount}</span> : null}</span>
        </button>
        <a className="mt-list" {...linkProps(listHref, onList)}><GridIcon size={18} /><span>View list</span></a>
        <p className="mt-count" role="status" aria-live="polite">{text || 'Counting…'}</p>
      </div>
    </div>
  );
}
