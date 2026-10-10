import { useEffect, useRef, useState } from 'react';
import { fetchInvestors, fetchInvestorMeta } from '../../api.js';
import InvestorCard from './InvestorCard.jsx';
import InvestorTable from './InvestorTable.jsx';
import { LEAD_WORDS, plural } from './common.jsx';

const PAGE = 24;
const SEARCH_DEBOUNCE_MS = 250;
const EMPTY = { search: '', type: '', stage: '', sector: '', location: '', lead: '', active: '', cheque: '' };

// Cheque sizes to filter by. Only an investor that states a range in Australian dollars is matched: one that does not is
// unknown, never "in range".
const CHEQUE_BANDS = [
  { key: 'xs', label: 'Up to $100,000', min: 0, max: 100000 },
  { key: 's', label: '$100,000 to $500,000', min: 100000, max: 500000 },
  { key: 'm', label: '$500,000 to $2 million', min: 500000, max: 2000000 },
  { key: 'l', label: '$2 million and over', min: 2000000 },
];

// What the server is asked: empty filters are left out, and a cheque band becomes the range it covers.
export function toQueryFilters(f) {
  const out = {};
  for (const key of ['search', 'type', 'stage', 'sector', 'location', 'lead', 'active']) if (f[key]) out[key] = f[key];
  const band = CHEQUE_BANDS.find((b) => b.key === f.cheque);
  if (band) {
    out.chequeMin = String(band.min);
    if (band.max != null) out.chequeMax = String(band.max);
  }
  return out;
}

// The ways to look at the same investors. Cards are the first, and the one a visit starts in; another is added here.
const VIEWS = [
  { id: 'cards', label: 'Cards', render: (items, onOpen) => <ul className="inv-grid">{items.map((i) => <InvestorCard key={i.slug} investor={i} onOpen={onOpen} />)}</ul> },
  { id: 'table', label: 'Table', render: (items, onOpen) => <InvestorTable investors={items} onOpen={onOpen} /> },
];

// The search box is as wide as the screen, and the whole of what it searches does not fit a phone: there it names the first three.
const NARROW = '(max-width: 639px)';
const SEARCH_HINT = 'Search investors, people, sectors or portfolio companies...';
const SEARCH_HINT_NARROW = 'Search investors, people, sectors...';
function useNarrow() {
  const [narrow, setNarrow] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia(NARROW).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(NARROW);
    const change = () => setNarrow(query.matches);
    change();
    query.addEventListener?.('change', change);
    return () => query.removeEventListener?.('change', change);
  }, []);
  return narrow;
}

const withCount = (label, count) => (count == null ? label : `${label} (${count})`);

function Select({ label, value, onChange, all, options }) {
  if (!options.length) return null;
  return (
    <select className="inv-select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{all}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{withCount(o.label ?? o.value, o.count)}</option>)}
    </select>
  );
}

// The published investors, a page at a time, in alphabetical order. There is no ranking: the order is the alphabet, and a
// filter narrows the list, it never reorders it. Every option shown is one some published investor has.
export default function InvestorDirectory({ onOpen, onClose }) {
  const [meta, setMeta] = useState(null);
  const [metaFailed, setMetaFailed] = useState(false);
  const [filters, setFilters] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [page, setPage] = useState({ items: [], count: 0, hasMore: false });
  const [status, setStatus] = useState('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState(VIEWS[0].id);
  const narrow = useNarrow();
  const [more, setMore] = useState(false); // the filters beyond the four everyone uses
  const [filtersOpen, setFiltersOpen] = useState(false); // on a phone, the filters are folded away until asked for
  const generation = useRef(0);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchInvestorMeta({ signal: ctrl.signal })
      .then((m) => { if (!ctrl.signal.aborted) setMeta(m); })
      .catch((err) => { if (!ctrl.signal.aborted && err.name !== 'AbortError') setMetaFailed(true); });
    return () => ctrl.abort();
  }, []);

  // A dropdown applies at once; text being typed waits for a short pause, so a word is one request.
  useEffect(() => {
    if (filters === applied) return undefined;
    const typing = filters.search !== applied.search;
    const timer = setTimeout(() => setApplied(filters), typing ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [filters, applied]);

  useEffect(() => {
    const ctrl = new AbortController();
    generation.current += 1;
    setStatus('loading');
    setMoreError('');
    fetchInvestors(toQueryFilters(applied), { limit: PAGE, offset: 0, signal: ctrl.signal })
      .then((found) => {
        if (ctrl.signal.aborted) return;
        setPage({ items: found.results, count: found.count, hasMore: found.hasMore });
        setStatus('ready');
      })
      .catch((err) => { if (!ctrl.signal.aborted && err.name !== 'AbortError') setStatus('error'); });
    return () => ctrl.abort();
  }, [applied, attempt]);

  const showMore = async () => {
    const mine = generation.current;
    setLoadingMore(true);
    setMoreError('');
    try {
      const found = await fetchInvestors(toQueryFilters(applied), { limit: PAGE, offset: page.items.length });
      if (mine === generation.current) setPage((p) => ({ items: [...p.items, ...found.results], count: found.count, hasMore: found.hasMore }));
    } catch (e) {
      if (mine === generation.current) setMoreError('Could not load more investors right now.');
    } finally {
      setLoadingMore(false);
    }
  };

  const set = (key) => (value) => setFilters((f) => ({ ...f, [key]: value }));
  const active = Object.values(filters).some(Boolean);
  const filterCount = Object.entries(filters).filter(([key, value]) => key !== 'search' && value).length;
  // A filter that is on is never hidden: "More filters" opens by itself when one of its filters has been chosen.
  const hasExtras = Boolean(meta && (meta.lead.length || meta.active.length || meta.cheque));
  const extraOn = Boolean(filters.lead || filters.active || filters.cheque);
  const showExtras = hasExtras && (more || extraOn);
  const current = VIEWS.find((v) => v.id === view) ?? VIEWS[0];
  const total = meta?.total ?? null;
  const empty = total === 0;
  const firstLoad = status === 'loading' && page.items.length === 0;

  return (
    <>
      <section className="inv-intro" aria-labelledby="inv-title">
        <h1 id="inv-title" tabIndex={-1}>Australian Startup Investors</h1>
        <p className="inv-lead">Discover the funds, angels and institutions backing Australian startups.</p>
      </section>

      {empty ? (
        <section className="inv-empty" aria-live="polite">
          <h2>The directory is being built.</h2>
          <p>
            An investor is listed here once its record has been checked against pages it publishes itself and a person has published it.
            None has been published yet, and none is listed on a guess.
          </p>
          <button type="button" className="hdrbtn" onClick={onClose}>Back to the map</button>
        </section>
      ) : (
        <>
          <div className="inv-tools" role="search">
            <div className="inv-search">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
                <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="1.75" />
                <path d="m21 21-4.3-4.3" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                aria-label="Search investors by name, person, sector, stage, location or portfolio company"
                placeholder={narrow ? SEARCH_HINT_NARROW : SEARCH_HINT}
                value={filters.search}
                onChange={(e) => set('search')(e.target.value)}
              />
            </div>
            {meta && (
              <>
                <button
                  type="button"
                  className="hdrbtn inv-filters-toggle"
                  aria-expanded={filtersOpen}
                  aria-controls="inv-filters"
                  onClick={() => setFiltersOpen((v) => !v)}
                >
                  Filters{filterCount ? ` (${filterCount})` : ''}
                </button>
                <div id="inv-filters" className={`inv-filters${filtersOpen ? ' inv-filters-open' : ''}`} role="group" aria-label="Filters">
                  <Select label="Stage" all="All stages" value={filters.stage} onChange={set('stage')} options={meta.stages} />
                  <Select label="Sector" all="All sectors" value={filters.sector} onChange={set('sector')} options={meta.sectors} />
                  <Select label="Location" all="All locations" value={filters.location} onChange={set('location')} options={meta.locations} />
                  <Select label="Investor type" all="All investor types" value={filters.type} onChange={set('type')} options={meta.types} />
                  {hasExtras && !extraOn && (
                    <button type="button" className="linkbtn inv-more-toggle" aria-expanded={showExtras} onClick={() => setMore((v) => !v)}>
                      {showExtras ? 'Fewer filters' : 'More filters'}
                    </button>
                  )}
                  {active && <button type="button" className="linkbtn" onClick={() => setFilters(EMPTY)}>Clear filters</button>}
                  {showExtras && (
                    <div className="inv-filters-more">
                      <Select label="Leads or follows" all="Lead or follow" value={filters.lead} onChange={set('lead')} options={meta.lead.map((o) => ({ ...o, label: LEAD_WORDS[o.value] ?? o.value }))} />
                      <Select label="Investing" all="Active or not" value={filters.active} onChange={set('active')} options={meta.active.map((o) => ({ ...o, label: o.value === 'inactive' ? 'No longer investing' : 'Investing now' }))} />
                      {meta.cheque && (
                        <Select label="Cheque size" all="Any cheque size" value={filters.cheque} onChange={set('cheque')} options={CHEQUE_BANDS.map((b) => ({ value: b.key, label: b.label }))} />
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
            {showExtras && meta?.cheque && (
              <p className="inv-note">
                Cheque size matches only investors that state a range in Australian dollars ({plural(meta.cheque.count, 'investor')} {meta.cheque.count === 1 ? 'does' : 'do'}). Others are unknown, not out of range.
              </p>
            )}
          </div>

          <div className="inv-listbar">
            <p className="inv-count" role="status">
              {status === 'ready' && (active ? `${plural(page.count, 'investor')} match` : plural(page.count, 'investor'))}
              {status === 'loading' && !firstLoad && 'Updating…'}
            </p>
            <div className="inv-views" role="group" aria-label="View">
              {VIEWS.map((v) => (
                <button key={v.id} type="button" className="inv-view-btn" aria-pressed={v.id === current.id} onClick={() => setView(v.id)}>{v.label}</button>
              ))}
            </div>
          </div>

          {firstLoad && <p className="inv-loading">Loading…</p>}
          {(status === 'error' || metaFailed) && status !== 'ready' && (
            <div className="inv-error" role="alert">
              <p>Could not load investors right now.</p>
              <button type="button" className="hdrbtn" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
            </div>
          )}
          {status === 'ready' && page.items.length === 0 && (
            <div className="inv-none">
              <p>No investors match those filters.</p>
              {active && <button type="button" className="linkbtn" onClick={() => setFilters(EMPTY)}>Clear filters</button>}
            </div>
          )}

          {page.items.length > 0 && current.render(page.items, onOpen)}

          {moreError && <p className="form-error" role="alert">{moreError}</p>}
          {page.hasMore && status !== 'error' && (
            <div className="inv-more">
              <button type="button" className="hdrbtn" onClick={showMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : `Show more (${page.count - page.items.length} left)`}
              </button>
            </div>
          )}
        </>
      )}

      <p className="inv-method">
        Every investor here was checked against pages it publishes itself, and a person published it. A blank means no public page says it:
        nothing is guessed. The list is in alphabetical order and is not a ranking. Open an investor to see the pages behind it, or to suggest a correction.
      </p>
    </>
  );
}
