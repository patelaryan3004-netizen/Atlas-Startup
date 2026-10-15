import { useEffect, useRef } from 'react';
import { useStartupResults } from '../../hooks/useStartupResults.js';
import { EmptyState } from '../brand/parts.jsx';
import { StartupRow, VcRow } from './rows.jsx';
import { ChevronDown } from './icons.jsx';

// The phone's bottom sheet: what the map says about the places on it. Shut it is a bar with the count ("58 startups in Melbourne"); pulled up it
// is the list of those startups, a page at a time, and a startup picked from it opens as a card in the same sheet (`detail`, which the page
// gives it) while the map moves to it. A swipe on the bar, or a press, opens and shuts it. With the VCs on (`entity` all or vcs) the investors the
// map draws are listed too (`vcFirms`, one row each; picking one calls onPickVc with its first mark), and with only the VCs on the bar counts them
// and no startup is asked for. Each row has the bookmark, the same one the results column has.
const SWIPE_PX = 30;

// `open`: the list is showing. `where`: the place the count is for ("Melbourne", "Australia"). `detail`: a card to show instead of the list.
export default function ResultsSheet({
  filters, count, where, open, onOpenChange, selectedName, onPick, detail = null, entity = 'startups', vcFirms = [], onPickVc,
  isTracked, onToggleTracked, isSavedVc, onToggleVc,
}) {
  const startups = entity !== 'vcs';
  const [{ items, hasMore, status, moreFailed }, more] = useStartupResults(filters, open && !detail && startups);
  const swipe = useRef(null);
  const sentinel = useRef(null);

  useEffect(() => {
    if (!hasMore || moreFailed || typeof IntersectionObserver === 'undefined' || !sentinel.current) return undefined;
    const observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) more(); }, { rootMargin: '300px' });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [hasMore, moreFailed, items.length, more]);

  const mode = detail ? 'detail' : open ? 'open' : 'peek';
  const vcs = `${vcFirms.length} ${vcFirms.length === 1 ? 'VC' : 'VCs'}`;
  const label = entity === 'vcs' ? vcs : `${count} ${count === 1 ? 'startup' : 'startups'}${entity === 'all' && vcFirms.length ? ` · ${vcs}` : ''}`;
  const touch = {
    onTouchStart: (e) => { swipe.current = e.touches[0].clientY; },
    onTouchEnd: (e) => {
      if (swipe.current == null) return;
      const dy = e.changedTouches[0].clientY - swipe.current;
      swipe.current = null;
      if (dy < -SWIPE_PX) onOpenChange(true);
      else if (dy > SWIPE_PX) onOpenChange(false);
    },
  };

  return (
    <section className={`xs xs-${mode}`} aria-label="Startups on the map">
      {detail ? detail : (
        <>
          <button type="button" className="xs-grab" aria-expanded={open} aria-controls="xsBody" onClick={() => onOpenChange(!open)} {...touch}>
            <span className="xs-handle" aria-hidden="true" />
            <span className="xs-head">
              <strong>{label}</strong>
              <span> in {where}</span>
              <ChevronDown size={20} className="xs-chev" />
            </span>
          </button>
          {open && (
            <div id="xsBody" className="xs-body">
              {startups && status === 'loading' && <p className="xs-note" role="status">Loading startups…</p>}
              {startups && status === 'error' && <p className="xs-note">Could not load the startups right now.</p>}
              {startups && status === 'ready' && items.length === 0 && <EmptyState title="No startups match.">Change or clear a filter to see more of them.</EmptyState>}
              {startups && items.length > 0 && (
                <ul className="xs-list">
                  {items.map((s) => (
                    <StartupRow
                      key={s.slug || s.name}
                      startup={s}
                      selected={s.name === selectedName}
                      onPick={onPick}
                      saved={isTracked?.(s.name)}
                      onToggleSaved={onToggleTracked ? () => onToggleTracked(s.name) : undefined}
                    />
                  ))}
                </ul>
              )}
              {startups && hasMore && (
                <div className="xs-more" ref={sentinel}>
                  <button type="button" className="btn btn-secondary" onClick={more}>{moreFailed ? 'Could not load more: try again' : `Show more (${count - items.length} left)`}</button>
                </div>
              )}
              {entity !== 'startups' && (
                <>
                  {entity === 'all' && vcFirms.length > 0 && <h3 className="xs-sub">Venture capital firms</h3>}
                  {entity === 'vcs' && vcFirms.length === 0 && <EmptyState title="No venture capital firm matches.">None with a city on file fits these filters.</EmptyState>}
                  {vcFirms.length > 0 && (
                    <ul className="xs-list">
                      {vcFirms.map((firm) => (
                        <VcRow
                          key={firm.slug}
                          firm={firm}
                          selected={firm.name === selectedName}
                          onPick={onPickVc}
                          saved={isSavedVc?.(firm.slug)}
                          onToggleSaved={onToggleVc ? () => onToggleVc(firm.slug) : undefined}
                        />
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
