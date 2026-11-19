import SearchBar from '../SearchBar.jsx';
import CheckMenu from '../explore/CheckMenu.jsx';
import { ENTITIES } from '../explore/ExploreToolbar.jsx';
import { SlidersIcon, ChevronDown } from '../explore/icons.jsx';
import { splitValues } from '../MultiSelect.jsx';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';

// The bar above the gallery: the search, the city, the industry and the stage, "More" for the rest of the filters (the slide-out panel, which is a sheet on a phone), and
// "Clear filters". None of it is a second set of filters: each control sets the same filter the map's panel and the address carry (`search`, `city`, `sector`,
// `stage`), so the gallery and the map are always looking at the same startups, and a change shows at once, with no page load. On a phone only the search and the one
// Filters button are drawn, and the button opens the sheet the filters already have.
// `filterCount` is the filters that are on besides the four here, for the badge on "More".
const TYPE_LABEL = { all: 'All types', startups: 'Startups', companies: 'Companies', vcs: 'Investors', spaces: 'Spaces' };
const NOT_COUNTED = ['search', 'city', 'sector', 'stage', 'onMap']; // (onMap has its own chip)

export default function GalleryToolbar({ filters, onFilterChange, cities, sectors, stages, entity, onEntityChange, filtersOpen, onToggleFilters, filtersRef, onClear }) {
  const cityOptions = cities.map(({ city, count }) => ({ value: city, count }));
  const sectorOptions = sectors.filter((s) => s && s.value && s.value !== 'Unknown'); // [{ value, count }]: the display sectors that have a company here (sectorOptions.js)
  const stageOptions = stages.filter((s) => s && s !== 'Unknown').map((value) => ({ value })); // the funding stages (the server leaves the others out)
  const others = Object.entries(filters).filter(([key, value]) => value && !NOT_COUNTED.includes(key)).length;
  const all = Object.entries(filters).filter(([, value]) => value).length + (entity !== 'all' ? 1 : 0);
  // On a phone the city, the industry and the stage are in the sheet this button opens, so it counts them; beside them (a wide screen) it counts only the rest.
  const narrow = useMediaQuery('(max-width: 899px)', false);
  const count = narrow ? (['city', 'sector', 'stage'].filter((key) => filters[key]).length + others + (entity !== 'all' ? 1 : 0)) : others;
  return (
    <div className="gl-bar" role="search" aria-label="Find startups">
      <div className="gl-find">
        <SearchBar filters={filters} onApplyFilters={onFilterChange} placeholder={narrow ? 'Search startups' : 'Search by name or keyword'} />
      </div>

      <div className="gl-selects">
        <CheckMenu label="City" allLabel="All cities" options={cityOptions} value={filters.city} onChange={(city) => onFilterChange({ city })} noun="cities" />
        <CheckMenu label="Sector" allLabel="All sectors" options={sectorOptions} value={filters.sector} onChange={(sector) => onFilterChange({ sector })} noun="sectors" />
        <CheckMenu label="Stage" allLabel="All stages" options={stageOptions} value={filters.stage} onChange={(stage) => onFilterChange({ stage })} noun="stages" note="Funding rounds, as the directory lists them: a stage is shown only where one is on file." />
        <label className="gl-type">
          <span className="sr-only">What kind of organisation</span>
          <select aria-label="What kind of organisation" value={entity} onChange={(event) => onEntityChange(event.target.value)}>
            {ENTITIES.map(([id]) => <option key={id} value={id}>{TYPE_LABEL[id]}</option>)}
          </select>
          <ChevronDown size={18} className="gl-type-chev" />
        </label>
      </div>

      <button
        ref={filtersRef}
        type="button"
        id="fToggle"
        className={filtersOpen || count ? 'xt-btn xt-btn-on gl-more' : 'xt-btn gl-more'}
        aria-expanded={filtersOpen}
        aria-controls="filters"
        onClick={onToggleFilters}
      >
        <SlidersIcon size={18} />
        <span className="xt-btn-text"><span className="xt-btn-word">Filters</span>{count ? <span className="xt-badge">{count}</span> : null}</span>
      </button>

      {all > 0 && <button type="button" className="gl-clear" onClick={onClear}>Clear filters</button>}
    </div>
  );
}
