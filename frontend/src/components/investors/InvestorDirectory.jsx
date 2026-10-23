import { useEffect, useRef, useState } from 'react';
import { fetchInvestors, fetchInvestorMeta } from '../../api.js';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import { usePopover } from '../../hooks/usePopover.js';
import InvestorCard from './InvestorCard.jsx';
import InvestorList from './InvestorList.jsx';
import InvestorLists from './InvestorLists.jsx';
import InvestorPanel from './InvestorPanel.jsx';
import PersonPanel from './PersonPanel.jsx';
import FilterSheet from './FilterSheet.jsx';
import Tabs from './Tabs.jsx';
import CheckMenu from '../explore/CheckMenu.jsx';
import { Segmented } from '../brand/parts.jsx';
import { SearchIcon, SlidersIcon, GridIcon, ListIcon } from '../explore/icons.jsx';
import { cardId } from '../IndexRow.jsx';
import { LEAD_WORDS, entryKey, plural } from './common.jsx';

const PAGE = 24;
const SEARCH_DEBOUNCE_MS = 250;
const EMPTY = { search: '', type: '', stage: '', sector: '', location: '', lead: '', active: '', cheque: '', role: '' };

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
  for (const key of ['search', 'type', 'stage', 'sector', 'location', 'lead', 'active', 'role']) if (f[key]) out[key] = f[key];
  const band = CHEQUE_BANDS.find((b) => b.key === f.cheque);
  if (band) {
    out.chequeMin = String(band.min);
    if (band.max != null) out.chequeMax = String(band.max);
  }
  return out;
}

// The orders the server can give the same investors in. The first is the one a visit starts in. Every one is by a name or a number a page states:
// none is a ranking of how good an investor is.
const SORTS = [
  ['name', 'Name A–Z'],
  ['name_desc', 'Name Z–A'],
  ['portfolio', 'Most connected'],
  ['location', 'Location A–Z'],
];

// The two ways to look at the same investors: a compact list (the one a visit starts in) and cards.
const VIEWS = [
  { id: 'list', label: 'List', Icon: ListIcon },
  { id: 'cards', label: 'Cards', Icon: GridIcon },
];

// Where the investors are based: Australia (the start) or global, which is everyone, in Australia and elsewhere. It is in the address (?scope=global).
const SCOPES = [{ id: 'au', label: 'Australia' }, { id: 'global', label: 'Global' }];
// Everyone, only the people, or only the firms: offered once the directory has people as well as firms.
const KINDS = [{ id: 'all', label: 'Everyone' }, { id: 'person', label: 'People' }, { id: 'firm', label: 'Firms' }];

const NARROW = '(max-width: 639px)';
const SEARCH_HINT = 'Search by name, firm or investment interest';
const SEARCH_HINT_NARROW = 'Search investors…';

const withCount = (label, count) => (count == null ? label : `${label} (${count})`);
const readScope = () => { try { return new URLSearchParams(window.location.search).get('scope') === 'global' ? 'global' : 'au'; } catch (e) { return 'au'; } };
// The scope is kept in the address without adding a step to the history (and without disturbing the marker an open panel leaves there).
function writeScope(scope) {
  try {
    const url = new URL(window.location.href);
    if (scope === 'global') url.searchParams.set('scope', 'global'); else url.searchParams.delete('scope');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch (e) { /* a locked-down browser: the page still works */ }
}

function Field({ label, value, onChange, all, options }) {
  if (!options.length) return null;
  return (
    <label className="inv-field">
      <span className="inv-field-label">{label}</span>
      <select className="inv-select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{all}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{withCount(o.label ?? o.value, o.count)}</option>)}
      </select>
    </label>
  );
}

// The filters beyond the four everyone uses: the kind of role a person has, whether an investor leads or follows, whether it is still investing, and a cheque
// size. Each is offered only when some investor has a value for it, and a filter that is on says so on the button.
function MoreFilters({ meta, filters, set, active, onClear }) {
  const { open, setOpen, ref } = usePopover();
  const hasRole = (meta.roles?.length ?? 0) > 0;
  const hasLead = meta.lead.length > 0;
  const hasActive = meta.active.length > 0;
  if (!hasRole && !hasLead && !hasActive && !meta.cheque) return null;
  const on = ['role', 'lead', 'active', 'cheque'].filter((key) => filters[key]).length;
  return (
    <div className="xt-menu" ref={ref}>
      <button type="button" className={on ? 'xt-btn xt-btn-on' : 'xt-btn'} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <SlidersIcon size={20} />
        <span>More filters{on ? <>{' '}<span className="xt-badge">{on}</span></> : null}</span>
      </button>
      {open && (
        <div className="xt-pop inv-more-pop" role="group" aria-label="More filters">
          {hasRole && <Field label="Role" all="Any role" value={filters.role} onChange={set('role')} options={meta.roles} />}
          <Field label="Leads or follows" all="Lead or follow" value={filters.lead} onChange={set('lead')} options={meta.lead.map((o) => ({ ...o, label: LEAD_WORDS[o.value] ?? o.value }))} />
          <Field label="Investing" all="Active or not" value={filters.active} onChange={set('active')} options={meta.active.map((o) => ({ ...o, label: o.value === 'inactive' ? 'No longer investing' : 'Investing now' }))} />
          {meta.cheque && (
            <>
              <Field label="Cheque size" all="Any cheque size" value={filters.cheque} onChange={set('cheque')} options={CHEQUE_BANDS.map((b) => ({ value: b.key, label: b.label }))} />
              <p className="inv-note">
                Cheque size matches only investors that state a range in Australian dollars ({plural(meta.cheque.count, 'investor')} {meta.cheque.count === 1 ? 'does' : 'do'}). Others are unknown, not out of range.
              </p>
            </>
          )}
          {hasLead && <p className="inv-note">Leading, following and cheque size describe a firm, so a person is not listed when one of them is on.</p>}
          {active && <button type="button" className="xt-clear" onClick={onClear}>Clear all filters</button>}
        </div>
      )}
    </div>
  );
}

// The published investors, a page at a time: people and the firms they work at. The order is the alphabet unless the visitor picks another, and a filter
// narrows the list, it never reorders it. Every option shown is one some published investor has. The list and the cards are two drawings of the same answer:
// the search, the filters, the scope, the sort, the tab and the count are one state, so switching between them changes nothing else. An investor that is
// picked opens beside the results (`selected`, from the address), in a panel that is a drawer on a phone.
export default function InvestorDirectory({
  selected = null, panelMode = 'side', tab, onTab, saved, isSaved, onToggleSaved, onOpen, onClosePanel, onOpenFull, onOpenPersonFull, onOpenInvestor, onOpenCompany, onClose,
}) {
  const [meta, setMeta] = useState(null);
  const [metaFailed, setMetaFailed] = useState(false);
  const [filters, setFilters] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [scope, setScope] = useState(readScope);
  const [kind, setKind] = useState('all');
  const [sort, setSort] = useState(SORTS[0][0]);
  const [view, setView] = useState(VIEWS[0].id);
  const [page, setPage] = useState({ items: [], count: 0, hasMore: false });
  const [status, setStatus] = useState('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [sheet, setSheet] = useState(false);
  const narrow = useMediaQuery(NARROW, false);
  const generation = useRef(0);
  const sheetButton = useRef(null);

  // The options of the filters, for the scope and the kind that are on: every option offered finds something.
  useEffect(() => {
    const ctrl = new AbortController();
    fetchInvestorMeta({ kind: 'all', scope: scope === 'au' ? 'au' : undefined, signal: ctrl.signal })
      .then((m) => { if (!ctrl.signal.aborted) { setMeta(m); setMetaFailed(false); } })
      .catch((err) => { if (!ctrl.signal.aborted && err.name !== 'AbortError') setMetaFailed(true); });
    return () => ctrl.abort();
  }, [scope, attempt]);

  useEffect(() => { writeScope(scope); }, [scope]);

  // A dropdown applies at once; text being typed waits for a short pause, so a word is one request.
  useEffect(() => {
    if (filters === applied) return undefined;
    const typing = filters.search !== applied.search;
    const timer = setTimeout(() => setApplied(filters), typing ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [filters, applied]);

  // What is asked: the filters, the kind and the scope; on the Saved tab the investors saved (by their keys; none saved is nothing to ask), wherever they are.
  const savedKey = tab === 'saved' ? saved.join(',') : '';
  const nothingSaved = tab === 'saved' && saved.length === 0;
  const asked = () => ({ ...toQueryFilters(applied), kind, ...(tab === 'saved' ? { slug: savedKey } : scope === 'au' ? { scope: 'au' } : {}) });

  useEffect(() => {
    generation.current += 1;
    setMoreError('');
    if (nothingSaved) {
      setPage({ items: [], count: 0, hasMore: false });
      setStatus('ready');
      return undefined;
    }
    const ctrl = new AbortController();
    setStatus('loading');
    fetchInvestors(asked(), { limit: PAGE, offset: 0, sort, signal: ctrl.signal })
      .then((found) => {
        if (ctrl.signal.aborted) return;
        setPage({ items: found.results, count: found.count, hasMore: found.hasMore });
        setStatus('ready');
      })
      .catch((err) => { if (!ctrl.signal.aborted && err.name !== 'AbortError') setStatus('error'); });
    return () => ctrl.abort();
  }, [applied, sort, attempt, tab, savedKey, scope, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const showMore = async () => {
    const mine = generation.current;
    setLoadingMore(true);
    setMoreError('');
    try {
      const found = await fetchInvestors(asked(), { limit: PAGE, offset: page.items.length, sort });
      if (mine === generation.current) setPage((p) => ({ items: [...p.items, ...found.results], count: found.count, hasMore: found.hasMore }));
    } catch (e) {
      if (mine === generation.current) setMoreError('Could not load more investors right now.');
    } finally {
      setLoadingMore(false);
    }
  };

  // An investor opened from a link is brought into view among the results, so the highlighted one is not off screen.
  useEffect(() => {
    if (!selected) return;
    document.getElementById(cardId('investor', selected))?.scrollIntoView?.({ block: 'nearest' });
  }, [selected, page.items.length]);

  // When the panel that was open goes and takes focus with it, focus goes back to the row that opened it, so a keyboard visitor carries on from where they were
  // (focus that is somewhere else, in the search box for one, is left alone).
  const lastSelected = useRef(null);
  useEffect(() => {
    const was = lastSelected.current;
    lastSelected.current = selected;
    if (selected || !was) return;
    const focused = document.activeElement;
    if (focused && focused !== document.body) return;
    document.getElementById(cardId('investor', was))?.querySelector('.inv-item-link, .inv-card-link')?.focus({ preventScroll: true });
  }, [selected]);

  const set = (key) => (value) => setFilters((f) => ({ ...f, [key]: value }));
  const clear = () => setFilters(EMPTY);
  const active = Object.values(filters).some(Boolean);
  const people = meta?.kinds?.person ?? 0;
  const total = tab === 'saved' ? saved.length : meta?.total ?? null;
  const directoryEmpty = meta ? (meta.kinds ? meta.kinds.firm + meta.kinds.person : meta.total) === 0 : false;
  const empty = tab === 'all' && directoryEmpty;
  const firstLoad = status === 'loading' && page.items.length === 0;
  const shown = page.items.length;
  const noun = tab === 'saved' ? 'saved investor' : 'investor';
  const where = tab === 'saved' ? '' : scope === 'au' ? ' in Australia' : ' worldwide';
  const countText = status !== 'ready' ? (firstLoad ? '' : 'Updating…')
    : active && total != null && page.count !== total ? `${page.count} of ${plural(total, noun)}${where}`
      : `${plural(tab === 'saved' ? saved.length : page.count, noun)}${where}`;
  const filtersOn = Object.entries(filters).filter(([k, v]) => v && k !== 'search').length;

  const props = { onOpen, onOpenFirm: onOpenInvestor, selected, isSaved, onToggleSaved };
  const results = view === 'cards'
    ? <ul className="inv-grid">{page.items.map((i) => <InvestorCard key={entryKey(i)} investor={i} {...props} selected={entryKey(i) === selected} saved={isSaved(entryKey(i))} />)}</ul>
    : <InvestorList entries={page.items} {...props} />;

  const selectedCard = selected ? page.items.find((i) => entryKey(i) === selected) : null;
  const personOpen = selected?.startsWith('people/');
  const filterGroups = meta ? [
    { id: 'location', label: 'Location', options: meta.locations, value: filters.location, onChange: set('location') },
    { id: 'type', label: 'Investor type', options: meta.types, value: filters.type, onChange: set('type') },
    { id: 'sector', label: 'Sector', options: meta.sectors, value: filters.sector, onChange: set('sector') },
    { id: 'stage', label: 'Stage', options: meta.stages, value: filters.stage, onChange: set('stage') },
    ...((meta.roles?.length ?? 0) > 0 ? [{ id: 'role', label: 'Role', options: meta.roles, value: filters.role, onChange: set('role') }] : []),
  ] : [];

  return (
    <>
      <section className="inv-hero inv-intro" aria-labelledby="inv-title">
        <div>
          <h1 id="inv-title" tabIndex={-1}>Find your next <em>backer.</em></h1>
          <p className="inv-lead">Explore investors, understand their focus, and build your shortlist.</p>
        </div>
        <p className="inv-total" role="status">{countText}</p>
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
            <div className="field field-lg inv-search">
              <SearchIcon size={20} />
              <input
                type="search"
                aria-label="Search investors by name, firm or investment interest"
                placeholder={narrow ? SEARCH_HINT_NARROW : SEARCH_HINT}
                value={filters.search}
                onChange={(e) => set('search')(e.target.value)}
              />
            </div>
            <Segmented className="inv-scope" label="Where investors are based" options={SCOPES} value={scope} onChange={setScope} />
          </div>

          {meta && (
            <div className="inv-filters" role="group" aria-label="Filters">
              {narrow ? (
                <>
                  <button ref={sheetButton} type="button" className={filtersOn ? 'xt-btn xt-btn-on' : 'xt-btn'} aria-haspopup="dialog" aria-expanded={sheet} onClick={() => setSheet(true)}>
                    <SlidersIcon size={20} />
                    <span>Filters{filtersOn ? <>{' '}<span className="xt-badge">{filtersOn}</span></> : null}</span>
                  </button>
                  {people > 0 && <Segmented className="inv-kind" label="Who is listed" options={KINDS} value={kind} onChange={setKind} />}
                </>
              ) : (
                <>
                  <CheckMenu label="Location" noun="locations" options={meta.locations} value={filters.location} onChange={set('location')} />
                  <CheckMenu label="Type" noun="investor types" options={meta.types} value={filters.type} onChange={set('type')} />
                  <CheckMenu label="Sector" noun="sectors" options={meta.sectors} value={filters.sector} onChange={set('sector')} />
                  <CheckMenu label="Stage" noun="stages" options={meta.stages} value={filters.stage} onChange={set('stage')} />
                  <MoreFilters meta={meta} filters={filters} set={set} active={active} onClear={clear} />
                  {people > 0 && <Segmented className="inv-kind" label="Who is listed" options={KINDS} value={kind} onChange={setKind} />}
                </>
              )}
              {active && <button type="button" className="inv-clear" onClick={clear}>Clear filters</button>}
            </div>
          )}

          {tab === 'all' && <InvestorLists meta={meta} filters={filters} onPick={(key, value) => set(key)(value)} />}

          <div className="inv-bar">
            <Tabs
              prefix="invdir"
              tabs={[['all', 'All investors'], ['saved', 'Saved', saved.length]]}
              value={tab}
              onChange={onTab}
              label="Which investors"
            />
            <div className="inv-bar-end">
              <label className="inv-sort">
                <span className="inv-sort-label" aria-hidden="true">Sort:</span>
                <select className="inv-select" aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value)}>
                  {SORTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </label>
              <Segmented className="inv-views" label="View" options={VIEWS.map(({ id, label, Icon }) => ({ id, label, icon: <Icon size={18} /> }))} value={view} onChange={setView} />
            </div>
          </div>

          <div className={selected ? 'inv-split inv-split-open' : 'inv-split'}>
            <div className="inv-results" id="invdir-panel" role="tabpanel" aria-labelledby={`invdir-tab-${tab}`}>
              {firstLoad && <p className="inv-loading">Loading…</p>}
              {(status === 'error' || metaFailed) && status !== 'ready' && (
                <div className="inv-error" role="alert">
                  <p>Could not load investors right now.</p>
                  <button type="button" className="hdrbtn" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
                </div>
              )}
              {nothingSaved && (
                <div className="inv-none">
                  <p>You have not saved any investors yet. Press the bookmark on an investor to keep it here. Saved investors are kept in this browser only.</p>
                  <button type="button" className="linkbtn" onClick={() => onTab('all')}>See all investors</button>
                </div>
              )}
              {!nothingSaved && status === 'ready' && shown === 0 && (
                <div className="inv-none">
                  <p>
                    No investors match those filters{tab === 'all' && scope === 'au' ? ' in Australia' : ''}.
                    {tab === 'all' && scope === 'au' && meta?.scopes && meta.scopes.global > meta.scopes.au ? ' Global also lists investors based elsewhere.' : ''}
                  </p>
                  <div className="inv-none-actions">
                    {active && <button type="button" className="linkbtn" onClick={clear}>Clear filters</button>}
                    {tab === 'all' && scope === 'au' && meta?.scopes && meta.scopes.global > meta.scopes.au && <button type="button" className="linkbtn" onClick={() => setScope('global')}>Look worldwide</button>}
                  </div>
                </div>
              )}

              {shown > 0 && results}

              {moreError && <p className="form-error" role="alert">{moreError}</p>}
              {shown > 0 && (
                <div className="inv-foot">
                  <p className="inv-showing">Showing {shown} of {page.count} {page.count === 1 ? noun : `${noun}s`}</p>
                  {page.hasMore && status !== 'error' && (
                    <button type="button" className="hdrbtn inv-showmore" onClick={showMore} disabled={loadingMore}>
                      {loadingMore ? 'Loading…' : `Show more (${page.count - shown} left)`}
                    </button>
                  )}
                </div>
              )}
            </div>

            {selected && (personOpen ? (
              <PersonPanel
                slug={selected.slice('people/'.length)}
                card={selectedCard}
                mode={panelMode}
                saved={isSaved(selected)}
                onToggleSaved={onToggleSaved}
                onClose={onClosePanel}
                onOpenFull={onOpenPersonFull}
                onOpenInvestor={onOpenInvestor}
                onOpenCompany={onOpenCompany}
              />
            ) : (
              <InvestorPanel
                slug={selected}
                card={selectedCard}
                mode={panelMode}
                saved={isSaved(selected)}
                onToggleSaved={onToggleSaved}
                onClose={onClosePanel}
                onOpenFull={onOpenFull}
                onOpenInvestor={onOpenInvestor}
                onOpenPerson={(slug) => onOpen(`people/${slug}`)}
                onOpenCompany={onOpenCompany}
              />
            ))}
          </div>
        </>
      )}

      {sheet && meta && (
        <FilterSheet groups={filterGroups} count={status === 'ready' ? page.count : null} active={active} onClear={clear} onClose={() => setSheet(false)}>
          {(meta.cheque || meta.lead.length > 0 || meta.active.length > 0) && (
            <div className="inv-sheet-group">
              <Field label="Leads or follows" all="Lead or follow" value={filters.lead} onChange={set('lead')} options={meta.lead.map((o) => ({ ...o, label: LEAD_WORDS[o.value] ?? o.value }))} />
              <Field label="Investing" all="Active or not" value={filters.active} onChange={set('active')} options={meta.active.map((o) => ({ ...o, label: o.value === 'inactive' ? 'No longer investing' : 'Investing now' }))} />
              {meta.cheque && <Field label="Cheque size" all="Any cheque size" value={filters.cheque} onChange={set('cheque')} options={CHEQUE_BANDS.map((b) => ({ value: b.key, label: b.label }))} />}
            </div>
          )}
        </FilterSheet>
      )}

      <p className="inv-method">
        Every investor here was checked against pages it publishes itself or that name them, and a person published it. A blank means no public page says it:
        nothing is guessed. The list is in alphabetical order unless you sort it, and no order is a ranking. Australia lists investors based in Australia; Global lists
        everyone, and an investor based elsewhere is not said to back Australian startups unless a page says so. Open an investor to see the pages behind it, or to suggest a correction.
      </p>
    </>
  );
}
