import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchStartupPage, exportUrl } from '../api.js';
import ConceptPreview from './ConceptPreview.jsx';
import EntityCard, { Avatar } from './EntityCard.jsx';
import HiringBadge from './HiringBadge.jsx';
import QuickFilters from './QuickFilters.jsx';
import NewThisWeek from './NewThisWeek.jsx';
import StartupTable from './StartupTable.jsx';
import IndexRow, { cardId } from './IndexRow.jsx';
import { nextEvent, eventDay } from '../freshness.js';
import VerifiedNote, { UnverifiedBadge } from './VerifiedNote.jsx';
import { CardGridSkeleton, TableSkeleton } from './Skeletons.jsx';
import { LAYOUT_KEY, initialLayout } from '../listLayout.js';
import { LIST_PAGE as PAGE } from '../snapshotRequests.js';
import { peek } from '../peek.js';

const LOADING = { items: [], count: 0, hasMore: false, status: 'loading', moreFailed: false };
const readyFrom = (page) => ({ items: page.results, count: page.count, hasMore: page.hasMore, status: 'ready', moreFailed: false });
const firstPage = (filters, sort) => peek.startupPage(filters, { limit: PAGE, offset: 0, sort });

// Only sorts backed by a real field on the startup record. The server sorts, because the browser only ever has
// one page of the list. "Recently added" and "Recently funded" would need a date field that doesn't exist in the
// dataset, so they're left out rather than faked with a stand-in. Team size and remote policy sort only once some
// company has one (they are facts a page has to give).
const SORTS = {
  name: 'Name',
  stage: 'Stage (earliest first)',
  verified: 'Recently verified',
  hiring: 'Hiring first',
  location: 'Location (A–Z)',
  industry: 'Industry (A–Z)',
};
const FACT_SORTS = { team: 'Team size (largest first)', remote: 'Remote policy' };


// The list for the current filters, a page at a time: the next page loads when the end of the list nears the
// screen (or when "Show more" is pressed), so the page holds the companies being looked at and not all of them.
// scope: what the list is narrowed to when a group on the map was opened as a list ("City-level locations in Sydney"), with
// onClearScope to widen it again.
export default function ListView({ filters, sectorColors, onSelectStartup, selectedName, trackedNames, scope = '', onClearScope, chips = null, meta = null, onFiltersChange = null }) {
  const [sort, setSort] = useState('name');
  const [layout, setLayout] = useState(initialLayout);
  // The first page of the unfiltered list is in the snapshot file (snapshot.js): when it has arrived it is what the list first draws, so there is
  // no placeholder and nothing moves when the server's answer comes (and an unreachable server leaves the list as the snapshot drew it).
  const [state, setState] = useState(() => { const known = firstPage(filters, 'name'); return known ? readyFrom(known) : LOADING; });
  const latest = useRef(state);
  latest.current = state;
  const generation = useRef(0);
  const busy = useRef(false);
  const sentinel = useRef(null);

  useEffect(() => {
    const ctrl = new AbortController();
    generation.current += 1;
    busy.current = false;
    const known = firstPage(filters, sort);
    setState((now) => (known ? (now.status === 'ready' && now.items === known.results ? now : readyFrom(known)) : LOADING));
    let shown = Boolean(known);
    const draw = (page) => { if (!ctrl.signal.aborted) setState((now) => (now.status === 'ready' && now.items === page.results ? now : readyFrom(page))); };
    fetchStartupPage(filters, { limit: PAGE, offset: 0, sort, signal: ctrl.signal, onSnapshot: (page) => { shown = true; draw(page); } })
      .then(draw)
      .catch((err) => { if (!ctrl.signal.aborted && err.name !== 'AbortError' && !shown) setState({ items: [], count: 0, hasMore: false, status: 'error', moreFailed: false }); });
    return () => ctrl.abort();
  }, [filters, sort]);

  const loadMore = useCallback(async () => {
    const now = latest.current;
    if (busy.current || !now.hasMore) return;
    busy.current = true;
    const mine = generation.current;
    try {
      const page = await fetchStartupPage(filters, { limit: PAGE, offset: now.items.length, sort });
      if (mine === generation.current) setState((s) => ({ ...s, items: [...s.items, ...page.results], count: page.count, hasMore: page.hasMore, moreFailed: false }));
    } catch (e) {
      if (mine === generation.current) setState((s) => ({ ...s, moreFailed: true }));
    } finally {
      if (mine === generation.current) busy.current = false;
    }
  }, [filters, sort]);

  useEffect(() => {
    if (!state.hasMore || state.moreFailed || typeof IntersectionObserver === 'undefined' || !sentinel.current) return undefined;
    const observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) loadMore(); }, { rootMargin: '600px' });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [state.hasMore, state.moreFailed, state.items.length, loadMore]);

  const { items, count, hasMore, status, moreFailed } = state;
  const sorts = { ...SORTS, ...(meta?.teamSizes?.length ? { team: FACT_SORTS.team } : {}), ...(meta?.remotePolicies?.length ? { remote: FACT_SORTS.remote } : {}) };
  const chooseLayout = (next) => {
    setLayout(next);
    try { localStorage.setItem(LAYOUT_KEY, next); } catch (e) { /* ignore */ }
  };

  return (
    <div id="startupListView">
      {chips && <div className="startup-list-chips">{chips}</div>}
      <div className="startup-list-toolbar">
        <span className="startup-list-count" aria-live="polite">{status === 'ready' ? `${count} ${count === 1 ? 'startup' : 'startups'}` : ''}</span>
        {meta && onFiltersChange && <QuickFilters filters={filters} meta={meta} onChange={onFiltersChange} />}
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
        <div className="startup-layout" role="group" aria-label="How the list is laid out">
          <button type="button" className="startup-layout-btn" aria-pressed={layout === 'table'} onClick={() => chooseLayout('table')}>Table</button>
          <button type="button" className="startup-layout-btn" aria-pressed={layout === 'cards'} onClick={() => chooseLayout('cards')}>Cards</button>
        </div>
        {status === 'ready' && count > 0 && (
          <a className="hdrbtn startup-export" href={exportUrl(filters, sort)} download="au-startup-map.csv" title={`Download the ${count} ${count === 1 ? 'startup' : 'startups'} in this list as a spreadsheet, with the page behind each fact`}>
            Export CSV
          </a>
        )}
      </div>

      {meta?.hasFresh && <NewThisWeek filters={filters} onSelectStartup={onSelectStartup} onShowAll={onFiltersChange ? () => onFiltersChange({ ...filters, fresh: 'week' }) : null} />}

      {status === 'loading' && (layout === 'table' ? <TableSkeleton /> : <CardGridSkeleton count={9} />)}
      {status === 'error' && <p className="form-error startup-list-empty">Could not load the list right now.</p>}
      {status === 'ready' && items.length === 0 && <p className="modal-sub startup-list-empty">No startups match your filters.</p>}

      {items.length > 0 && layout === 'cards' && <IndexRow items={items.map((s) => ({ id: cardId('company', s.slug || s.name), name: s.name }))} what="the companies listed" />}

      {items.length > 0 && layout === 'table' && (
        <StartupTable items={items} count={count} sort={sort} onSort={setSort} onSelectStartup={onSelectStartup} selectedName={selectedName} trackedNames={trackedNames} />
      )}

      {items.length > 0 && layout === 'cards' && (
        <div className="startup-grid">
          {items.map((s) => {
            const event = nextEvent(s.events);
            return (
            <EntityCard
              as="button"
              key={s.slug || s.name}
              id={cardId('company', s.slug || s.name)}
              className={s.name === selectedName ? 'startup-card startup-card-selected' : 'startup-card'}
              onClick={() => onSelectStartup(s)}
              avatar={<Avatar name={s.name} website={s.website} />}
              name={<>{s.name}{trackedNames?.has(s.name) && <span className="startup-card-tracked" title="Tracked">★</span>}</>}
              aside={event && <span className="event-badge" title={event.title}>{eventDay(event)}</span>}
              blurb={s.blurb}
              meta={[s.sectorFull || s.sector, s.stage, s.city]}
            >
              <div className="startup-card-tags">
                <HiringBadge company={s} />
                <ConceptPreview company={s} />
                <UnverifiedBadge company={s} />
              </div>
              <VerifiedNote at={s.last_verified_at} />
            </EntityCard>
            );
          })}
        </div>
      )}

      {hasMore && (
        <div className="startup-list-more" ref={sentinel}>
          <button className="hdrbtn" onClick={loadMore}>
            {moreFailed ? 'Could not load more: try again' : `Show more (${count - items.length} left)`}
          </button>
        </div>
      )}
    </div>
  );
}
