import { useEffect, useRef } from 'react';
import CheckMenu from './CheckMenu.jsx';
import { ENTITIES } from './ExploreToolbar.jsx';
import { SearchIcon, CloseIcon, SlidersIcon, ListIcon, ChevronDown } from './icons.jsx';
import { linkProps } from '../brand/nav.js';

// The head of the map page's directory panel (the "Startup atlas" panel): a kicker, the heading, one line of what it is for, the search, the two selects (what
// kind of organisation, which sector), the stage and the rest of the filters, and how many there are. Everything in it is the page's existing filters: the type
// is the layer the map shows (All, Startups, Companies, Investors, Spaces), the sector, the stage and the search are the same filters the toolbar had, and "More" opens
// the filter panel. Nothing here is a second set of filters.

// The mark beside the kicker: a small sunburst.
function Sunburst() {
  return (
    <svg className="at-sun" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1" />
    </svg>
  );
}

const TYPE_LABEL = { all: 'All types', startups: 'Startups', companies: 'Companies', vcs: 'Investors', spaces: 'Spaces' };

export default function AtlasHead({
  filters, onFilterChange, sectors = [], stages = [], entity, onEntityChange, filtersOpen, onToggleFilters, filtersRef, filterCount = 0, listHref, onList,
  count, pinned, children,
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
  const sectorOptions = sectors.filter((s) => s && s !== 'Unknown').map((value) => ({ value }));
  const stageOptions = stages.filter((s) => s && s !== 'Unknown').map((value) => ({ value }));
  return (
    <div className="at-head">
      <p className="at-kicker"><Sunburst /><span>Still Early field guide</span></p>
      <h1 className="at-title">Startup <em>atlas</em>.</h1>
      <p className="at-lede">Discover who&rsquo;s building around you.</p>

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
          <span className="at-sr">What kind of organisation</span>
          <select aria-label="What kind of organisation" value={entity} onChange={(event) => onEntityChange(event.target.value)}>
            {ENTITIES.map(([id]) => <option key={id} value={id}>{TYPE_LABEL[id]}</option>)}
          </select>
          <ChevronDown size={18} className="at-select-chev" />
        </label>
        <CheckMenu label="Sector" allLabel="All sectors" options={sectorOptions} value={filters.sector} onChange={(sector) => onFilterChange({ sector })} noun="sectors" />
      </div>

      <div className="at-tools">
        <CheckMenu label="Stage" allLabel="All stages" options={stageOptions} value={filters.stage} onChange={(stage) => onFilterChange({ stage })} noun="stages" note="As the directory lists them: no stage is filled in from a guess, and a company with none on record is not in this list." />
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
          <span className="xt-btn-text"><span className="xt-btn-word">More</span>{filterCount ? <span className="xt-badge">{filterCount}</span> : null}</span>
        </button>
        <a className="at-list" aria-label="See these as a list" {...linkProps(listHref, onList)}><ListIcon size={18} /><span>List</span></a>
      </div>

      <p className="at-count" role="status" aria-live="polite">
        <span className="at-count-main">{count}</span>
        {pinned ? <span className="at-count-sub">{pinned}</span> : null}
      </p>
      {children}
    </div>
  );
}
