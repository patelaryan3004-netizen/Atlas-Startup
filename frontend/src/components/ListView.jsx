import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { exportUrl } from '../api.js';
import { Segmented } from './brand/parts.jsx';
import GalleryCard from './gallery/GalleryCard.jsx';
import NewThisWeek from './NewThisWeek.jsx';
import QuickFilters from './QuickFilters.jsx';
import StartupTable from './StartupTable.jsx';
import { GridIcon, TableIcon } from './explore/icons.jsx';
import { GallerySkeleton, TableSkeleton } from './Skeletons.jsx';
import { LAYOUT_KEY, initialLayout } from '../listLayout.js';
import { useStartupPages } from '../hooks/useStartupPages.js';
import { rememberGallery, recallGallery, forgetGallery } from '../gallery.js';

// Only sorts backed by a real field on the startup record. The server sorts, because the browser only ever has
// one page of the list. "Recently added" and "Recently funded" would need a date field that doesn't exist in the
// dataset, so they're left out rather than faked with a stand-in. Team size and remote policy sort only once some
// company has one (they are facts a page has to give).
const SORTS = {
  pictures: 'Pictures first',
  name: 'Name',
  stage: 'Stage (earliest first)',
  verified: 'Recently verified',
  hiring: 'Hiring first',
  location: 'Location (A–Z)',
  industry: 'Industry (A–Z)',
};
// The gallery opens on the companies that have a cover picture (a gallery is its pictures); the table opens in name order, as it always did. A sort the visitor chose is theirs and stays.
const DEFAULT_SORT = { gallery: 'pictures', table: 'name' };
const FACT_SORTS = { team: 'Team size (largest first)', remote: 'Remote policy' };
const LAYOUTS = [
  { id: 'gallery', label: 'Grid', icon: <GridIcon size={16} /> },
  { id: 'table', label: 'Table', icon: <TableIcon size={16} /> },
];

// The startups for the current filters, as the gallery (the way in: a grid of pictures, three across on a wide screen) or as a table, a page at a time: the next page
// loads when the end of the list nears the screen (or when "Show more" is pressed), so the page holds the companies being looked at and not all of them. The gallery is
// the page itself, which scrolls (not a box inside it), and leaving it for the map or another page and coming back puts it where it was (gallery.js).
// scope: what the list is narrowed to when a group on the map was opened as a list ("City-level locations in Sydney"), with
// onClearScope to widen it again.
export default function ListView({ filters, onSelectStartup, selectedName, trackedNames, scope = '', onClearScope, chips = null, meta = null, onFiltersChange = null }) {
  const [layout, setLayout] = useState(initialLayout);
  const [sort, setSort] = useState(() => DEFAULT_SORT[layout]);
  const [back] = useState(() => recallGallery(filters, DEFAULT_SORT[layout])); // where the gallery was left, if it was left for the same startups
  useEffect(() => { forgetGallery(); }, []);
  const { state, loadMore, sentinel } = useStartupPages(filters, sort, { restore: back?.count ?? 0 });

  const { items, count, hasMore, status, moreFailed } = state;
  const sorts = { ...SORTS, ...(meta?.teamSizes?.length ? { team: FACT_SORTS.team } : {}), ...(meta?.remotePolicies?.length ? { remote: FACT_SORTS.remote } : {}) };
  const chooseLayout = (next) => {
    setLayout(next);
    if (sort === DEFAULT_SORT[layout]) setSort(DEFAULT_SORT[next]);
    try { localStorage.setItem(LAYOUT_KEY, next); } catch (e) { /* ignore */ }
  };

  // Where the visitor is in the list is kept as they scroll (not read as the page unmounts, when the page has already shrunk), and written when they leave it.
  const place = useRef({ scrollY: 0, count: 0 });
  place.current.count = items.length;
  useEffect(() => {
    const onScroll = () => { place.current.scrollY = window.scrollY; };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (place.current.count > 0) rememberGallery(filters, sort, place.current);
    };
  }, [filters, sort]);

  // Back where they were: once as many startups are drawn as were, the page is scrolled to where it was (only the first time, and never against the visitor's own scrolling).
  const restored = useRef(!back || back.scrollY <= 0);
  useLayoutEffect(() => {
    if (restored.current || status !== 'ready' || items.length < Math.min(back.count, count)) return;
    restored.current = true;
    window.scrollTo(0, back.scrollY);
  }, [back, status, items.length, count]);

  return (
    <div id="startupListView" className={`gl-list gl-list-${layout}`}>
      {chips && <div className="startup-list-chips">{chips}</div>}
      {meta && onFiltersChange && <QuickFilters filters={filters} meta={meta} onChange={onFiltersChange} switchesOnly />}
      <div className="startup-list-toolbar">
        <span className="startup-list-count" aria-live="polite">{status === 'ready' ? `${count.toLocaleString('en-AU')} ${count === 1 ? 'startup' : 'startups'}` : ''}</span>
        {scope && (
          <span className="startup-list-scope">
            {scope}
            {onClearScope && <button type="button" className="startup-list-scope-clear" onClick={onClearScope}>Show every location</button>}
          </span>
        )}
        <label className="startup-list-sort">
          Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {Object.entries(sorts).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </label>
        <Segmented className="startup-layout" label="How the list is laid out" options={LAYOUTS} value={layout} onChange={chooseLayout} />
        {status === 'ready' && count > 0 && (
          <a className="hdrbtn startup-export" href={exportUrl(filters, sort === 'pictures' ? 'name' : sort)} download="au-startup-map.csv" title={`Download the ${count} ${count === 1 ? 'startup' : 'startups'} in this list as a spreadsheet, with the page behind each fact`}>
            Export CSV
          </a>
        )}
      </div>

      {meta?.hasFresh && <NewThisWeek filters={filters} onSelectStartup={onSelectStartup} onShowAll={onFiltersChange ? () => onFiltersChange({ ...filters, fresh: 'week' }) : null} />}

      {status === 'loading' && (layout === 'table' ? <TableSkeleton /> : <GallerySkeleton count={9} />)}
      {status === 'error' && <p className="form-error startup-list-empty">Could not load the list right now.</p>}
      {status === 'ready' && items.length === 0 && <p className="modal-sub startup-list-empty">No startups match your filters.</p>}

      {items.length > 0 && layout === 'table' && (
        <StartupTable items={items} count={count} sort={sort} onSort={setSort} onSelectStartup={onSelectStartup} selectedName={selectedName} trackedNames={trackedNames} />
      )}

      {items.length > 0 && layout === 'gallery' && (
        <ul className="gl-grid" aria-label="Startups">
          {items.map((s) => (
            <GalleryCard key={s.slug || s.name} startup={s} onOpen={onSelectStartup} tracked={trackedNames?.has(s.name)} selected={s.name === selectedName} />
          ))}
        </ul>
      )}

      {hasMore && (
        <div className="startup-list-more" ref={sentinel}>
          <button type="button" className="gl-more-btn" onClick={loadMore}>
            {moreFailed ? 'Could not load more: try again' : `Show more (${(count - items.length).toLocaleString('en-AU')} left)`}
          </button>
        </div>
      )}
    </div>
  );
}
