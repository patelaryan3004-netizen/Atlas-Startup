import { useEffect, useMemo, useRef } from 'react';
import { useStartupResults } from '../../hooks/useStartupResults.js';
import { EmptyState, CompanyRow } from '../brand/parts.jsx';
import { StartupRow, VcRow, startupSub, vcSub } from './rows.jsx';
import { isPlainClick } from '../brand/nav.js';
import { ArrowRight, ArrowUpRight } from './icons.jsx';

// The results beside the map on a wide screen: what the map is showing, one row per company or investor, the one that is open lit, and the way to
// the rest (the list) and to the collections. It asks for the same startups the phone's sheet does (useStartupResults) and is given the investors the map
// draws, so the column, the map and the list are one set of results. Picking a row is picking its mark on the map; picking a mark on the map lights
// its row, and brings it into view when the column has to scroll to it.
const SHOWN = 24; // rows in the column; the rest are one press away in the list
const VC_EVERY = 3; // with both on, an investor after every third startup, so the investors are seen and not left behind the alphabet

const hostOf = (website) => { try { return new URL(website).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };

// The coral shapes in the corner of the collections card: three flat planes, no gradient, the same drawing at any width.
function Shapes() {
  return (
    <svg className="cc-shape" viewBox="0 0 120 80" preserveAspectRatio="xMaxYMax meet" aria-hidden="true" focusable="false">
      <path d="M120 0v80H40z" style={{ fill: 'var(--coral)' }} opacity=".9" />
      <path d="M120 24v56H72z" style={{ fill: 'var(--coral)' }} />
      <path d="M86 80h34V52z" style={{ fill: 'var(--coral)' }} opacity=".5" />
    </svg>
  );
}

export default function ResultsColumn({
  where, entity, filters, selected, onPick, onPickVc, vcFirms = [], isTracked, onToggleTracked, isSavedVc, onToggleVc,
  chips = null, onViewAll, onShowCollections, onClearFilters,
}) {
  const startupsOn = entity !== 'vcs';
  const [{ items, count, status }, ] = useStartupResults(filters, startupsOn);
  const list = useRef(null);
  const selectedName = selected?.name;

  const rows = useMemo(() => {
    const starts = startupsOn ? items.map((startup) => ({ kind: 'startup', key: `s:${startup.slug || startup.name}`, startup })) : [];
    const firms = entity === 'startups' ? [] : vcFirms.map((firm) => ({ kind: 'vc', key: `v:${firm.slug}`, firm }));
    let merged;
    if (entity === 'all') {
      merged = [];
      let v = 0;
      starts.forEach((row, i) => {
        merged.push(row);
        if ((i + 1) % VC_EVERY === 0 && v < firms.length) { merged.push(firms[v]); v += 1; }
      });
      merged.push(...firms.slice(v));
    } else {
      merged = [...starts, ...firms];
    }
    return merged;
  }, [items, vcFirms, entity, startupsOn]);

  const shown = rows.slice(0, SHOWN);
  // The open mark is always among the rows: when its company is not in the first page (the map found it, the list has not got to it), it is put on top.
  const isOpen = (row) => (row.kind === 'vc' ? row.firm.name === selectedName : row.startup.name === selectedName);
  const openInRows = shown.some(isOpen);
  const total = (startupsOn ? count : 0) + (entity === 'startups' ? 0 : vcFirms.length);
  const loading = startupsOn && status === 'loading' && rows.length === 0;
  const nothing = !loading && rows.length === 0 && status !== 'error';

  // A mark picked on the map lights its row; the column scrolls to it only if it is out of sight.
  useEffect(() => {
    const row = list.current?.querySelector('[aria-current="true"]');
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedName, shown.length]);

  const subtitle = entity === 'vcs' ? 'Venture capital firms.' : entity === 'startups' ? 'Startups.' : 'Companies and investors.';

  return (
    <section className="xc" aria-label={`Results in ${where}`}>
      <div className="xc-head">
        <h2 className="serif-h2">Explore {where}</h2>
        <p className="xc-sub">{subtitle}</p>
        {chips && <div className="xc-chips">{chips}</div>}
      </div>

      <div className="xc-body">
        {loading && <p className="xc-note" role="status">Loading…</p>}
        {startupsOn && status === 'error' && rows.length === 0 && <p className="xc-note">Could not load the startups right now.</p>}
        {nothing && (
          <EmptyState title="Nothing matches.">
            {entity === 'vcs' ? 'No venture capital firm with a city on file fits these filters.' : 'No startup fits these filters. Change a filter, or clear them all.'}
            {onClearFilters && <button type="button" className="btn btn-secondary btn-sm" onClick={onClearFilters}>Clear filters</button>}
          </EmptyState>
        )}

        {(shown.length > 0 || (selected && !openInRows)) && (
          <ul className="xc-list" ref={list}>
            {selected && !openInRows && (
              <CompanyRow
                name={selected.name}
                website={selected.kind === 'vc' ? null : selected.website}
                domain={selected.kind === 'vc' ? hostOf(selected.website) || null : null}
                sub={selected.kind === 'vc' ? vcSub({ places: [selected.city] }) : startupSub({ sector: selected.sector, city: selected.city })}
                vc={selected.kind === 'vc'}
                selected
                onSelect={() => {}}
                saved={selected.kind === 'vc' ? isSavedVc?.(selected.slug) : isTracked?.(selected.name)}
                onToggleSaved={selected.kind === 'vc' ? (onToggleVc ? () => onToggleVc(selected.slug) : undefined) : (onToggleTracked ? () => onToggleTracked(selected.name) : undefined)}
              />
            )}
            {shown.map((row) => (row.kind === 'vc' ? (
              <VcRow
                key={row.key}
                firm={row.firm}
                selected={isOpen(row)}
                onPick={onPickVc}
                saved={isSavedVc?.(row.firm.slug)}
                onToggleSaved={onToggleVc ? () => onToggleVc(row.firm.slug) : undefined}
              />
            ) : (
              <StartupRow
                key={row.key}
                startup={row.startup}
                selected={isOpen(row)}
                onPick={onPick}
                saved={isTracked?.(row.startup.name)}
                onToggleSaved={onToggleTracked ? () => onToggleTracked(row.startup.name) : undefined}
              />
            )))}
          </ul>
        )}

        {rows.length > 0 && (
          <button type="button" className="xc-all" onClick={onViewAll}>
            {total > 0 ? `View all ${total} results` : 'View all results'} <ArrowRight size={18} />
          </button>
        )}

        <a className="collections-card" href="/lists" onClick={onShowCollections ? (event) => { if (isPlainClick(event)) { event.preventDefault(); onShowCollections(); } } : undefined}>
          <span className="cc-label">Collections</span>
          <span className="cc-title">Good company starts here.</span>
          <ArrowUpRight size={24} className="cc-arrow" />
          <Shapes />
        </a>
      </div>
    </section>
  );
}
