import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SiteHeader from '../brand/SiteHeader.jsx';
import SectionTabs from '../brand/SectionTabs.jsx';
import { OPPORTUNITY_TABS } from '../brand/nav.js';
import { CityCards, RoleRow, RoleDetail, CompanyIndex, Coverage, Credits } from '../jobs/parts.jsx';
import { fetchJobs } from '../../networkApi.js';
import { useSavedKind } from '../../savedStore.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';
import { lazyView, Lazy } from '../../lazyLoad.jsx';
import { BookmarkIcon, SearchIcon, SlidersIcon, ChevronDown, CloseIcon } from '../explore/icons.jsx';
import {
  EMPTY, SORTS, PLACE_CARDS, OTHER_PLACES, OTHER_AU, REMOTE_AU, placeLabel, readFilters, writeFilters, isStart, activeSecondary, filterRoles, placeCounts, companyIndex, sortRoles, filterOptions,
  sectorLabel, TYPE_LABELS, LEVEL_LABELS, ARRANGEMENT_LABELS, feedStamp, loadSnapshot, loadLive, normaliseRole,
} from '../../jobsBoard.js';
import '../../jobs.css';

const SuggestDialog = lazyView(() => import('./SuggestDialog.jsx'));
const PAGE = 30;
const DAY = 86400000;

// The hiring desk. Roles read from employers' own public job boards, by place; apply on the employer's own site.
//
// The page is given the whole board once (backend/src/network/board.js) and does the rest in the browser, so a tap on Melbourne answers at once and every number on the page (the cards, the
// list, the company index, the filters) is counted from the same list. It draws the saved copy of the board that comes with the site first, then the server's answer replaces it; if the
// server cannot be reached the saved copy stays, and the page says it is a saved copy and from when.
export default function JobsBoard({ chrome = {} }) {
  const saved = useSavedKind('job');
  const [filters, setFilters] = useState(() => readFilters(window.location.search));
  const [typed, setTyped] = useState(filters.search);
  const [board, setBoard] = useState(null);
  const [source, setSource] = useState('loading'); // loading, snapshot, live, offline (the saved copy, the server could not be reached), none
  const [openId, setOpenId] = useState(() => new URLSearchParams(window.location.search).get('role') ?? '');
  const [suggesting, setSuggesting] = useState(false);
  const [panel, setPanel] = useState(false);
  const [dialog, setDialog] = useState(null); // 'coverage' | 'credits'
  const [shown, setShown] = useState(PAGE);
  const [extras, setExtras] = useState([]); // saved roles that are in neither of the board's lists (an older save), looked up by id
  const search = useRef(null);
  const now = Date.now();

  usePageMeta({ title: 'The hiring desk · Opportunities · Still Early', description: 'Find your next team in Australia. Roles read from employers’ own job boards, by city, with the date each was last confirmed. Apply directly with the people hiring.', path: '/jobs' });

  // The saved copy first, then the server's answer.
  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    let live = 'pending'; // pending, ok or failed: the two answers can arrive in either order
    loadSnapshot().then((b) => { if (alive && b && live !== 'ok') { setBoard(b); setSource(live === 'failed' ? 'offline' : 'snapshot'); } });
    loadLive({ signal: ctrl.signal }).then((b) => {
      if (!alive) return;
      if (b) { live = 'ok'; setBoard(b); setSource('live'); } else { live = 'failed'; setSource((s) => (s === 'snapshot' ? 'offline' : s === 'loading' ? 'none' : s)); }
    }).catch(() => {});
    return () => { alive = false; ctrl.abort(); };
  }, []);

  useEffect(() => { const t = setTimeout(() => setFilters((f) => (f.search === typed ? f : { ...f, search: typed })), 200); return () => clearTimeout(t); }, [typed]);
  useEffect(() => { setShown(PAGE); }, [filters]);

  // The address follows the filters (and the open role), so any view of the board is a link.
  useEffect(() => {
    try {
      const q = writeFilters(filters);
      const url = `/jobs${q}${openId ? `${q ? '&' : '?'}role=${encodeURIComponent(openId)}` : ''}`;
      if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, '', url);
    } catch (e) { /* ignore */ }
  }, [filters, openId]);

  // "/" jumps to the search, unless the visitor is already typing.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      event.preventDefault();
      search.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const roles = useMemo(() => (board?.roles ?? []).map(normaliseRole), [board]);
  const lapsed = useMemo(() => (board?.lapsed ?? []).map(normaliseRole), [board]);

  // A saved role the board does not hold at all (saved long ago, from the old board): looked up by its id, so a bookmark finds it with its true status.
  const savedIds = saved.items;
  useEffect(() => {
    if (!board) return undefined;
    const known = new Set([...roles, ...lapsed].map((r) => r.id));
    const missing = savedIds.filter((id) => !known.has(id));
    if (!missing.length) { setExtras([]); return undefined; }
    const ctrl = new AbortController();
    fetchJobs({ ids: missing.join(','), limit: 60 }, { signal: ctrl.signal }).then((res) => setExtras((res.results ?? []).map(normaliseRole)), () => {});
    return () => ctrl.abort();
  }, [board, roles, lapsed, savedIds]);

  const savedRoles = useMemo(() => {
    const byId = new Map([...extras, ...lapsed, ...roles].map((r) => [r.id, r]));
    return savedIds.map((id) => byId.get(id)).filter(Boolean);
  }, [savedIds, roles, lapsed, extras]);

  const counts = useMemo(() => placeCounts(roles, filters), [roles, filters]);
  const matched = useMemo(() => sortRoles(filterRoles(roles, filters), filters.sort), [roles, filters]);
  const firms = useMemo(() => companyIndex(roles, { ...filters, place: filters.place }), [roles, filters]);
  const options = useMemo(() => filterOptions(roles, filters), [roles, filters]);
  const list = filters.saved ? savedRoles : matched;
  const set = (key) => (value) => setFilters((f) => ({ ...f, [key]: value, saved: false }));
  const open = openId ? [...roles, ...lapsed, ...extras].find((r) => r.id === openId) ?? null : null;

  const placeOptions = useMemo(() => [
    ['', `All Australia (${counts.national})`], ...PLACE_CARDS.map((p) => [p.id, `${p.label} (${counts[p.id] ?? 0})`]),
    ...OTHER_PLACES.filter((c) => (counts[c] ?? 0) > 0 || filters.place === c).map((c) => [c, `${c} (${counts[c] ?? 0})`]), [OTHER_AU, `Elsewhere in Australia (${counts[OTHER_AU] ?? 0})`],
  ], [counts, filters.place]);

  const stamp = board ? feedStamp(board, now, source === 'live' ? 'live' : 'snapshot') : null;
  const secondary = activeSecondary(filters);
  const reset = () => { setFilters(EMPTY); setTyped(''); setPanel(false); };
  const apply = useCallback((role) => setOpenId(role.id), []);

  const emptyWords = (() => {
    if (filters.saved) return { title: 'Nothing saved yet.', body: 'Press the bookmark on a role to keep it here, on this device. A saved role stays, with its true status, if the employer takes it down.' };
    if (!roles.length) return { title: 'No open roles are listed right now.', body: 'Roles appear here after a check of an employer’s own job board lists them.' };
    if (filters.place === REMOTE_AU && !secondary && !filters.search && !filters.company) return { title: 'No role is open to remote work from Australia right now.', body: 'A role is listed here only when its employer says someone in Australia can do it remotely. Try a city, or all of Australia.' };
    if (filters.place && !secondary && !filters.search && !filters.company) return { title: `No open roles in ${placeLabel(filters.place)} right now.`, body: 'Try another place, or all of Australia. New roles appear after the next successful check of the employers’ boards.' };
    return { title: 'No roles match.', body: 'Try fewer filters, another place or a different search.' };
  })();

  return (
    <div id="jobsDesk" className="page-shell jd">
      <SiteHeader active="opportunities" go={chrome.go} counts={chrome.counts} menu={chrome.menu} onAdd={() => setSuggesting(true)} addLabel="Suggest a role" />
      <main className="jd-main" id="main">
        <SectionTabs label="Opportunities" tabs={OPPORTUNITY_TABS} active="jobs" go={chrome.tabs} />

        <header className="jd-hero">
          <div>
            <p className="jd-kicker"><span className="jd-kicker-rule" aria-hidden="true" />Still Early field guide</p>
            <h1 className="jd-title">The hiring <em>desk.</em></h1>
            <p className="jd-lede">Find your next team in Australia. Apply directly with the people hiring.</p>
          </div>
          {stamp && (
            <p className={`jd-stamp is-${stamp.tone}`} role="status">
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 1l1.5 9.2L23 12l-9.5 1.6L12 23l-1.6-9.4L1 12l9.4-1.8z" /></svg>
              <span>{stamp.text}</span>
            </p>
          )}
        </header>

        <CityCards counts={counts} active={filters.place} onPick={set('place')} />

        <div className="jd-work">
          <section className="jd-results" id="roles" aria-labelledby="jd-roles-h">
            <div className="jd-list-top">
              <h2 id="jd-roles-h" className="jd-h2">{filters.saved ? 'Saved roles' : filters.place ? `Open roles in ${placeLabel(filters.place)}` : 'Open roles'} <span className="jd-n" aria-label={`${list.length} roles`}>{list.length}</span></h2>
              <button type="button" className={`jd-saved${filters.saved ? ' is-on' : ''}`} aria-pressed={filters.saved} onClick={() => setFilters((f) => ({ ...f, saved: !f.saved }))}>
                <BookmarkIcon size={18} fill={filters.saved ? 'currentColor' : 'none'} /> Saved{savedIds.length ? <span className="jd-saved-n">{savedIds.length}</span> : null}
              </button>
            </div>

            <div className="jd-bar">
              <label className="jd-search">
                <SearchIcon size={20} />
                <input ref={search} type="search" aria-label="Search roles or companies" placeholder="Role, company or keyword" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
                {typed ? <button type="button" className="field-clear" aria-label="Clear the search" onClick={() => { setTyped(''); search.current?.focus(); }}><CloseIcon size={16} /></button> : <kbd className="jd-kbd" aria-hidden="true">/</kbd>}
              </label>
              <label className="jd-select">
                <span className="sr-only">Where the role is worked</span>
                <select value={filters.place} onChange={(e) => set('place')(e.target.value)}>{placeOptions.map(([v, l]) => <option key={v || 'all'} value={v}>{l}</option>)}</select>
                <ChevronDown size={18} className="jd-select-chev" />
              </label>
              <button type="button" className={`jd-filter${panel || secondary ? ' is-on' : ''}`} aria-expanded={panel} aria-controls="jd-extras" onClick={() => setPanel((v) => !v)}>
                <SlidersIcon size={18} /> Filters{secondary ? <span className="jd-badge">{secondary}</span> : null}
              </button>
            </div>

            {panel && (
              <div className="jd-extras" id="jd-extras">
                <label>Sector<select value={filters.sector} onChange={(e) => set('sector')(e.target.value)}><option value="">All sectors</option>{options.sectors.map((o) => <option key={o.value} value={o.value}>{sectorLabel(o.value)} ({o.count})</option>)}{filters.sector && !options.sectors.some((o) => o.value === filters.sector) && <option value={filters.sector}>{sectorLabel(filters.sector)} (0)</option>}</select></label>
                <label>Stage<select value={filters.stage} onChange={(e) => set('stage')(e.target.value)}><option value="">Any stage</option>{options.stages.map((o) => <option key={o.value} value={o.value}>{o.value} ({o.count})</option>)}</select></label>
                <label>Level in the title<select value={filters.level} onChange={(e) => set('level')(e.target.value)}><option value="">Any level</option>{options.levels.map((o) => <option key={o.value} value={o.value}>{LEVEL_LABELS[o.value]} ({o.count})</option>)}</select></label>
                <label>Employment<select value={filters.type} onChange={(e) => set('type')(e.target.value)}><option value="">Any type</option>{options.types.map((o) => <option key={o.value} value={o.value}>{TYPE_LABELS[o.value]} ({o.count})</option>)}</select></label>
                <label>Working arrangement<select value={filters.arrangement} onChange={(e) => set('arrangement')(e.target.value)}><option value="">Any</option>{options.arrangements.map((o) => <option key={o.value} value={o.value}>{ARRANGEMENT_LABELS[o.value]} ({o.count})</option>)}</select></label>
              </div>
            )}

            {(filters.sector || filters.stage || filters.type || filters.level || filters.arrangement || filters.company || filters.search) && (
              <ul className="jd-chips" aria-label="Active filters">
                {filters.sector && <li><button type="button" onClick={() => set('sector')('')}>{sectorLabel(filters.sector)} <CloseIcon size={14} /><span className="sr-only"> remove</span></button></li>}
                {filters.stage && <li><button type="button" onClick={() => set('stage')('')}>{filters.stage} <CloseIcon size={14} /><span className="sr-only"> remove</span></button></li>}
                {filters.level && <li><button type="button" onClick={() => set('level')('')}>{LEVEL_LABELS[filters.level]} <CloseIcon size={14} /><span className="sr-only"> remove</span></button></li>}
                {filters.type && <li><button type="button" onClick={() => set('type')('')}>{TYPE_LABELS[filters.type]} <CloseIcon size={14} /><span className="sr-only"> remove</span></button></li>}
                {filters.arrangement && <li><button type="button" onClick={() => set('arrangement')('')}>{ARRANGEMENT_LABELS[filters.arrangement]} <CloseIcon size={14} /><span className="sr-only"> remove</span></button></li>}
                {filters.company && <li><button type="button" onClick={() => set('company')('')}>{firms.find((c) => c.key === filters.company)?.name ?? roles.find((r) => (r.company.slug ?? r.company.name) === filters.company)?.company.name ?? 'One company'} <CloseIcon size={14} /><span className="sr-only"> remove</span></button></li>}
                <li><button type="button" className="jd-clear" onClick={reset}>Clear all</button></li>
              </ul>
            )}

            <div className="jd-cols">
              <span>Role &amp; company</span>
              {!filters.saved && (
                <label className="jd-sort"><span className="sr-only">Sort roles</span>
                  <select value={filters.sort} onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value }))}>{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                </label>
              )}
            </div>

            {source === 'loading' && <p className="jd-quiet" role="status">Reading the employer boards&hellip;</p>}
            {source === 'none' && !board && <div className="jd-note" role="alert"><p>The board could not be loaded. Check your connection and try again.</p></div>}
            {source === 'offline' && <p className="jd-quiet" role="status">The live board is not available right now, so this is the saved copy from {new Date(board.generated_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}. Each role still links to its employer.</p>}

            {board && (list.length === 0 ? (
              <div className="jd-empty">
                <h3>{emptyWords.title}</h3>
                <p>{emptyWords.body} Know of a real one? <button type="button" className="jd-link" onClick={() => setSuggesting(true)}>Suggest a role</button>.</p>
                {!filters.saved && !isStart(filters) && <button type="button" className="btn btn-secondary btn-sm" onClick={reset}>Clear filters</button>}
              </div>
            ) : (
              <>
                <ul className="jd-list">
                  {list.slice(0, filters.saved ? undefined : shown).map((role) => (
                    <RoleRow key={role.id} role={role} now={now} saved={saved.has(role.id)} onToggle={saved.toggle} onOpen={apply} selected={openId === role.id} />
                  ))}
                </ul>
                {!filters.saved && list.length > shown && <div className="jd-more"><button type="button" className="jd-loadmore" onClick={() => setShown((n) => n + PAGE)}>Show more roles <span aria-hidden="true">↓</span></button></div>}
              </>
            ))}
          </section>

          <CompanyIndex companies={firms} active={filters.company} onPick={set('company')} onCoverage={() => setDialog('coverage')} />
        </div>

        <p className="jd-fine-print">
          Roles come from employers&rsquo; own public job boards and are shown with the date we last confirmed them listed. We do not rank, sell placement or take a fee: you apply on the employer&rsquo;s site.
          Membership does not make anyone vetted and does not promise an interview.
        </p>
      </main>

      <footer className="jd-foot"><span>still early<span className="jd-dot">.</span></span><small>Australian hiring desk</small><button type="button" className="jd-link" onClick={() => setDialog('credits')}>Photography</button></footer>

      {open && <RoleDetail role={open} now={now} saved={saved.has(open.id)} onToggle={saved.toggle} onClose={() => setOpenId('')} />}
      {dialog === 'coverage' && <Coverage sync={board?.sync} onClose={() => setDialog(null)} />}
      {dialog === 'credits' && <Credits onClose={() => setDialog(null)} />}
      {suggesting && <Lazy><SuggestDialog kind="job" onClose={() => setSuggesting(false)} /></Lazy>}
    </div>
  );
}
