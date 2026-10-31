import CheckMenu from './CheckMenu.jsx';
import { LocationMenu, ENTITIES, nextCity } from './ExploreToolbar.jsx';
import { Segmented, VcBadge } from '../brand/parts.jsx';
import { splitValues } from '../MultiSelect.jsx';
import { SearchIcon, SlidersIcon, CloseIcon, ListIcon } from './icons.jsx';
import { linkProps } from '../brand/nav.js';

export const ENTITY_OPTIONS = ENTITIES.map(([id, label]) => ({ id, label, badge: id === 'vcs' ? <span aria-hidden="true"><VcBadge /></span> : null }));

// The words for how many there are: the companies that match, how many of them have no place on record (so are not on the map), and the investors when they are
// drawn too.
export function countText({ companies, unplaced = 0, vcs, entity }) {
  const part = (n, one, many) => `${n.toLocaleString('en-AU')} ${n === 1 ? one : many}`;
  if (entity === 'vcs') return Number.isFinite(vcs) ? part(vcs, 'investor', 'investors') : '';
  if (!Number.isFinite(companies)) return '';
  const text = `${part(companies, 'company', 'companies')}${unplaced > 0 ? ` (${unplaced.toLocaleString('en-AU')} not on the map)` : ''}`;
  return entity === 'all' && vcs > 0 ? `${text} and ${part(vcs, 'investor', 'investors')}` : text;
}

// The bar across the top of the map page. Compact, in one row on a wide screen and two on a phone: the city (top left; one of the ten cities, or all of Australia),
// the search, the sector and the funding stage, the other filters, what the map shows (All, Startups or VCs), and how many are on it. A city picked here is the
// `city` filter, so the map, the count and the list on Discover agree. Stages are only the ones on record: a company with no stage on record has none.
export default function MapToolbar({
  filters, onFilterChange, cities, sectors, stages, companies, unplaced, vcs, entity, onEntityChange, filtersOpen, onToggleFilters, filtersRef, listHref, onList,
}) {
  const selectedCities = splitValues(filters.city);
  const activeCount = Object.entries(filters).filter(([key, value]) => value && !['search', 'city', 'sector', 'stage'].includes(key)).length;
  const sectorOptions = (sectors ?? []).filter((s) => s && s !== 'Unknown').map((value) => ({ value }));
  const stageOptions = (stages ?? []).filter((s) => s && s !== 'Unknown').map((value) => ({ value }));
  const text = countText({ companies, unplaced, vcs, entity });
  return (
    <div className="mt" role="search" aria-label="Find companies on the map">
      <LocationMenu allLabel="All Australia" cities={cities} selected={selectedCities} onSelect={(city) => onFilterChange({ city: nextCity(filters.city, city) })} />
      <label className="mt-search">
        <SearchIcon size={20} className="mt-search-icon" />
        <input
          type="search"
          aria-label="Search companies on the map"
          placeholder="Search companies, sectors, founders"
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
        <CheckMenu label="Stage" options={stageOptions} value={filters.stage} onChange={(stage) => onFilterChange({ stage })} noun="stages" note="As the directory lists them: no stage is filled in from a guess, and a company with none on record is not in this list." />
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
          <span className="xt-btn-text"><span className="xt-btn-word">More</span>{activeCount ? <span className="xt-badge">{activeCount}</span> : null}</span>
        </button>
        <Segmented className="xt-entity mt-entity" label="What the map shows" options={ENTITY_OPTIONS} value={entity} onChange={onEntityChange} />
        <p className="mt-count" role="status" aria-live="polite">{text || 'Counting…'}</p>
        <a className="mt-list" aria-label="See these as a list" {...linkProps(listHref, onList)}><ListIcon size={18} /><span>List</span></a>
      </div>
    </div>
  );
}
