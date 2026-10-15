import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchStartupPage } from '../../api.js';
import { peek } from '../../peek.js';
import { LIST_PAGE } from '../../snapshotRequests.js';
import { hiringLabel, present } from '../../freshness.js';
import { Avatar } from '../EntityCard.jsx';
import { ChevronDown } from './icons.jsx';

// The phone's bottom sheet: what the map says about the places on it. Shut it is a bar with the count ("58 startups in Melbourne"); pulled up it
// is the list of those startups, a page at a time, and a startup picked from it opens as a card in the same sheet (`detail`, which the page
// gives it) while the map moves to it. A swipe on the bar, or a press, opens and shuts it. With the VCs on (`entity` all or vcs) the investors the
// map draws are listed too (`vcFirms`, one row each; picking one calls onPickVc with its first mark), and with only the VCs on the bar counts them
// and no startup is asked for.
const LOADING = { items: [], count: 0, hasMore: false, status: 'loading', moreFailed: false };
const readyFrom = (page) => ({ items: page.results, count: page.count, hasMore: page.hasMore, status: 'ready', moreFailed: false });
const firstPage = (filters) => peek.startupPage(filters, { limit: LIST_PAGE, offset: 0, sort: 'name' });
const SWIPE_PX = 30;

// The startups of the current filters, a page at a time: asked for only while the sheet is open, so a closed sheet costs nothing.
function useResults(filters, active) {
  const [state, setState] = useState(() => { const known = firstPage(filters); return known ? readyFrom(known) : LOADING; });
  const latest = useRef(state);
  latest.current = state;
  const generation = useRef(0);
  const busy = useRef(false);

  useEffect(() => {
    if (!active) return undefined;
    const ctrl = new AbortController();
    generation.current += 1;
    busy.current = false;
    const known = firstPage(filters);
    setState((now) => (known ? (now.status === 'ready' && now.items === known.results ? now : readyFrom(known)) : LOADING));
    let shown = Boolean(known);
    const draw = (page) => { if (!ctrl.signal.aborted) setState((now) => (now.status === 'ready' && now.items === page.results ? now : readyFrom(page))); };
    fetchStartupPage(filters, { limit: LIST_PAGE, offset: 0, sort: 'name', signal: ctrl.signal, onSnapshot: (page) => { shown = true; draw(page); } })
      .then(draw)
      .catch((err) => { if (!ctrl.signal.aborted && err.name !== 'AbortError' && !shown) setState({ items: [], count: 0, hasMore: false, status: 'error', moreFailed: false }); });
    return () => ctrl.abort();
  }, [filters, active]);

  const more = useCallback(async () => {
    const now = latest.current;
    if (busy.current || !now.hasMore) return;
    busy.current = true;
    const mine = generation.current;
    try {
      const page = await fetchStartupPage(filters, { limit: LIST_PAGE, offset: now.items.length, sort: 'name' });
      if (mine === generation.current) setState((s) => ({ ...s, items: [...s.items, ...page.results], count: page.count, hasMore: page.hasMore, moreFailed: false }));
    } catch (e) {
      if (mine === generation.current) setState((s) => ({ ...s, moreFailed: true }));
    } finally {
      if (mine === generation.current) busy.current = false;
    }
  }, [filters]);

  return [state, more];
}

function VcRow({ firm, selected, onPick }) {
  return (
    <li>
      <button type="button" className={selected ? 'xs-row xs-row-on' : 'xs-row'} onClick={() => onPick(firm.pin)}>
        <Avatar name={firm.name} domain={firm.domain} />
        <span className="xs-rowtext">
          <b>{firm.name}</b>
          <span>{[...new Set(firm.places)].join(', ')}</span>
        </span>
        <span className="xs-vc">VC</span>
      </button>
    </li>
  );
}

function Row({ startup, selected, onPick }) {
  const hiring = hiringLabel(startup).state === 'hiring';
  const where = present(startup.city, startup.sectorFull || startup.sector).join(' · ');
  return (
    <li>
      <button type="button" className={selected ? 'xs-row xs-row-on' : 'xs-row'} onClick={() => onPick(startup)}>
        <Avatar name={startup.name} website={startup.website} />
        <span className="xs-rowtext">
          <b>{startup.name}</b>
          {where && <span>{where}</span>}
        </span>
        {hiring && <span className="xs-hiring">Hiring now</span>}
      </button>
    </li>
  );
}

// `open`: the list is showing. `where`: the place the count is for ("Melbourne", "Australia"). `detail`: a card to show instead of the list.
export default function ResultsSheet({ filters, count, where, open, onOpenChange, selectedName, onPick, detail = null, entity = 'startups', vcFirms = [], onPickVc }) {
  const startups = entity !== 'vcs';
  const [{ items, hasMore, status, moreFailed }, more] = useResults(filters, open && !detail && startups);
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
              {startups && status === 'ready' && items.length === 0 && <p className="xs-note">No startups match your filters.</p>}
              {startups && items.length > 0 && (
                <ul className="xs-list">
                  {items.map((s) => <Row key={s.slug || s.name} startup={s} selected={s.name === selectedName} onPick={onPick} />)}
                </ul>
              )}
              {startups && hasMore && (
                <div className="xs-more" ref={sentinel}>
                  <button type="button" className="xs-morebtn" onClick={more}>{moreFailed ? 'Could not load more: try again' : `Show more (${count - items.length} left)`}</button>
                </div>
              )}
              {entity !== 'startups' && (
                <>
                  {entity === 'all' && vcFirms.length > 0 && <h3 className="xs-sub">Venture capital firms</h3>}
                  {entity === 'vcs' && vcFirms.length === 0 && <p className="xs-note">No venture capital firm with a city on file matches.</p>}
                  {vcFirms.length > 0 && (
                    <ul className="xs-list">
                      {vcFirms.map((firm) => <VcRow key={firm.slug} firm={firm} selected={firm.name === selectedName} onPick={onPickVc} />)}
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
