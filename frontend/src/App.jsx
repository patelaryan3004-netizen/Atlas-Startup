import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchMeta, fetchSummary, fetchMarkers, fetchStartup, fetchStartupsByName, fetchPerson, DIRECTORY_URL } from './api.js';
import MapView from './components/MapView.jsx';
import ListView from './components/ListView.jsx';
import FilterPanel from './components/FilterPanel.jsx';
import HeaderMenu from './components/HeaderMenu.jsx';
import SearchBar from './components/SearchBar.jsx';
import NewsTicker from './components/NewsTicker.jsx';
import MapKey from './components/MapKey.jsx';
import SubmitStartupForm from './components/SubmitStartupForm.jsx';
import SuggestEditForm from './components/SuggestEditForm.jsx';
import StartupDetailPanel from './components/StartupDetailPanel.jsx';
import PersonProfile from './components/PersonProfile.jsx';
import { getPersonProfile } from './people.js';
import { areaFilters, scopeText } from './mapPins.js';
import FeedbackForm from './components/FeedbackForm.jsx';
import AboutSources from './components/AboutSources.jsx';
import PrivacyPolicy from './components/PrivacyPolicy.jsx';
import UnverifiedList from './components/UnverifiedList.jsx';
import BottomCapsule from './components/BottomCapsule.jsx';
import StartupListView from './components/StartupListView.jsx';
import JobsView from './components/JobsView.jsx';
import InvestorsView from './components/investors/InvestorsView.jsx';
import { readRoute as readInvestorsRoute } from './components/investors/route.js';
import { readAppRoute, appUrl, appPath } from './appRoute.js';
import { usePageMeta } from './hooks/usePageMeta.js';
import { startupDescription, startupJsonLd } from './seo.js';
import { curatedLists } from './curatedLists.js';
import NewsPage from './components/NewsPage.jsx';
import ListBanner from './components/ListBanner.jsx';
import ActiveFilters, { activeChips } from './components/ActiveFilters.jsx';
import PageNotFound from './components/PageNotFound.jsx';
import CuratedLists from './components/CuratedLists.jsx';
import WaitlistForm from './components/WaitlistForm.jsx';
import { useTrackedStartups } from './hooks/useTrackedStartups.js';

// Desaturated relative to the single UI accent color, so sector dots read as
// data encoding on the dark map rather than competing with it.
const PALETTE = [
  '#5fb894', '#e08a5a', '#d4a24e', '#7a95b8', '#a878c4', '#6ac48a', '#d4726a', '#c4864e',
  '#a89468', '#6ab87a', '#d47aa0', '#7a94c4', '#c4507a', '#9a9a7a', '#c4966a', '#8686b8',
  '#8a8a8a', '#6ab8c4', '#c4785a', '#6aa898',
];

// precision (EXACT, SUBURB, CITY, STATE) is how well a company's place is known, and state its state: a group on the
// map ("Sydney, 42 startups with city-level locations") opens as a list by setting them.
const EMPTY_FILTERS = { search: '', sector: '', city: '', investor: '', stage: '', hiring: '', taskGate: '', precision: '', state: '' };
const EMPTY_META = { sectors: [], cities: [], investors: [], stages: [] };
const NEWS_VISIBLE_KEY = 'auStartupNewsVisible';
const SEARCH_DEBOUNCE_MS = 250;

function loadNewsVisible() {
  try {
    const raw = localStorage.getItem(NEWS_VISIBLE_KEY);
    return raw === null ? true : raw === '1';
  } catch (e) {
    return true;
  }
}

function loadFiltersFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = {};
    Object.keys(EMPTY_FILTERS).forEach((key) => {
      const value = params.get(key);
      if (value) fromUrl[key] = value;
    });
    return { ...EMPTY_FILTERS, ...fromUrl };
  } catch (e) {
    return EMPTY_FILTERS;
  }
}

// The curated list a /lists/<slug> address names (a list of companies, not one of the lists of people).
const filterList = (id) => curatedLists.find((list) => list.type === 'filter' && list.id === id) ?? null;
const sameFilters = (a, b) => Object.keys(EMPTY_FILTERS).every((key) => (a[key] || '') === (b[key] || ''));
const listFilters = (list) => ({ ...EMPTY_FILTERS, ...list.filters });

// The filters a page opens with: a curated list's own, or what the address says.
function initialFilters(route) {
  const list = route.kind === 'list' ? filterList(route.slug) : null;
  return list ? listFilters(list) : loadFiltersFromUrl();
}

function loadInitialView() {
  try {
    return new URLSearchParams(window.location.search).get('view');
  } catch (e) {
    return null;
  }
}

// The filters the data is fetched with. A dropdown applies at once; text being typed waits for a short pause, so
// a word is one request and not one request per letter.
function useAppliedFilters(filters) {
  const [applied, setApplied] = useState(filters);
  useEffect(() => {
    if (filters === applied) return undefined;
    const typing = filters.search !== applied.search;
    const timer = setTimeout(() => setApplied(filters), typing ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [filters, applied]);
  return applied;
}

const aborted = (err) => err?.name === 'AbortError';

// The page holds what is being looked at: the map's compact pins, one page of the list, counts, the one company
// that is open. Everything else is asked of the server when it is needed, so the page is as fast at five
// thousand companies as at two hundred.
export default function App() {
  // Where a link into the app lands: ?view=jobs, lists, list (the list of startups) or waitlist (the waitlist form); and the
  // investor pages by their own addresses: /investors, /investors/<slug> and /investors/people/<slug> (the first version's
  // ?view=investors addresses still work).
  const initialView = loadInitialView();
  // The page is in the address bar (appRoute.js): a link opens it, Back leaves it.
  const [route, setRoute] = useState(readAppRoute);
  const [meta, setMeta] = useState(EMPTY_META);
  const [filters, setFilters] = useState(() => initialFilters(route));
  const applied = useAppliedFilters(filters);
  const [summary, setSummary] = useState(null);
  const [stats, setStats] = useState(null);
  const [markers, setMarkers] = useState([]);
  const [areas, setAreas] = useState([]);
  const [newsVisible, setNewsVisible] = useState(loadNewsVisible);
  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const [showUnverified, setShowUnverified] = useState(false);
  const [viewMode, setViewMode] = useState(initialView === 'list' || route.kind === 'list' ? 'list' : 'map');
  const [showTracked, setShowTracked] = useState(false);
  const { tracked, toggleTracked, isTracked } = useTrackedStartups();
  const [trackedStartups, setTrackedStartups] = useState([]);
  const [showAbout, setShowAbout] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showWaitlist, setShowWaitlist] = useState(initialView === 'waitlist');
  const showJobs = route.kind === 'jobs';
  const showInvestors = route.kind === 'investors';
  const showCuratedLists = route.kind === 'lists';
  const [investorsStart, setInvestorsStart] = useState(() => readInvestorsRoute() ?? { kind: 'list' });
  // Opened from a link, the page is already in the history; opened from the map it is a step of its own, so Back returns to the map.
  const [investorsFromLink, setInvestorsFromLink] = useState(() => readInvestorsRoute() !== null);
  const [missing, setMissing] = useState(null); // a link to a company or a list the directory does not have
  const [editingCompany, setEditingCompany] = useState(null);
  const [selectedStartup, setSelectedStartup] = useState(null);
  const [selectedPersonName, setSelectedPersonName] = useState(null);
  const [personCompanies, setPersonCompanies] = useState([]);

  // A page that is opened from another is a step of its own in the history (marked, so closing it can go Back and land where the
  // visitor was); one opened from a link is not, and closing it puts the map at the root.
  const ui = useRef({});
  ui.current = { applied, viewMode, route };
  const goTo = useCallback((next, { replace = false } = {}) => {
    const url = appUrl(next, ui.current);
    try {
      if (replace) window.history.replaceState(window.history.state, '', url);
      else window.history.pushState({ app: 'step' }, '', url);
    } catch (e) { /* a locked-down browser: the page still moves */ }
    setRoute(next);
  }, []);
  const leave = useCallback(() => {
    setSelectedStartup(null);
    setMissing(null);
    setRoute({ kind: 'explore' });
    if (window.history.state?.app === 'step') { window.history.back(); return; }
    try { window.history.replaceState(null, '', appUrl({ kind: 'explore' }, ui.current)); } catch (e) { /* ignore */ }
  }, []);

  // Back and forward: the page and, on the pages that carry them, the filters come from the address again.
  useEffect(() => {
    const onPop = () => {
      const next = readAppRoute();
      setRoute((now) => (now.kind === next.kind && now.slug === next.slug ? now : next));
      if (next.kind !== 'startup') setSelectedStartup(null);
      setMissing(null);
      if (next.kind === 'explore' || next.kind === 'startup') {
        const from = loadFiltersFromUrl();
        setFilters((now) => (sameFilters(now, from) ? now : from));
        setViewMode(new URLSearchParams(window.location.search).get('view') === 'list' ? 'list' : 'map');
      } else if (next.kind === 'list') {
        const list = filterList(next.slug);
        if (list) { setFilters(listFilters(list)); setViewMode('list'); }
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // The address follows the filters and the view (so any view can be shared), and an old ?view= address is written as the page.
  useEffect(() => {
    try {
      if (route.kind === 'explore' || route.kind === 'startup') {
        const url = appUrl(route, { filters: applied, viewMode });
        if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, '', url);
      } else if (route.kind !== 'investors' && window.location.pathname !== appPath(route)) {
        window.history.replaceState(window.history.state, '', appPath(route));
      }
    } catch (e) { /* ignore */ }
  }, [route, applied, viewMode]);

  // A /startup/<slug> address (a link, or Forward) opens that company; one the directory does not have says so.
  useEffect(() => {
    if (route.kind !== 'startup' || selectedStartup?.slug === route.slug) return undefined;
    const ctrl = new AbortController();
    fetchStartup(route.slug, { signal: ctrl.signal })
      .then((full) => { if (!ctrl.signal.aborted) setSelectedStartup(full); })
      .catch((err) => { if (!ctrl.signal.aborted && err?.status === 404) setMissing({ kind: 'startup' }); });
    return () => ctrl.abort();
  }, [route, selectedStartup?.slug]);

  // A /lists/<slug> address is a list of companies, and it stays that list only while the filters are its own.
  const activeList = route.kind === 'list' ? filterList(route.slug) : null;
  useEffect(() => {
    if (route.kind !== 'list') return;
    if (!activeList) setMissing({ kind: 'list' });
    else if (!sameFilters(filters, listFilters(activeList))) goTo({ kind: 'explore' }, { replace: true });
  }, [route, activeList, filters, goTo]);

  useEffect(() => {
    fetchMeta().then(setMeta).catch(() => setMeta(EMPTY_META));
    // The whole directory's counts, once: the Jobs link says how many are hiring however the map is filtered.
    fetchSummary({}).then(setStats).catch(() => setStats(null));
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchSummary(applied, { signal: ctrl.signal })
      .then((found) => { if (!ctrl.signal.aborted) setSummary(found); })
      .catch((err) => { if (!ctrl.signal.aborted && !aborted(err)) setSummary(null); });
    return () => ctrl.abort();
  }, [applied]);

  // The map's pins, and the groups for companies known only to their city or state, only while the map is showing.
  useEffect(() => {
    if (viewMode !== 'map') return undefined;
    const ctrl = new AbortController();
    fetchMarkers(applied, { signal: ctrl.signal })
      .then(({ items, areas: groups }) => { if (!ctrl.signal.aborted) { setMarkers(items); setAreas(groups ?? []); } })
      .catch((err) => { if (!ctrl.signal.aborted && !aborted(err)) { setMarkers([]); setAreas([]); } });
    return () => ctrl.abort();
  }, [applied, viewMode]);

  // The companies a visitor tracks are looked up by name when the list is opened.
  useEffect(() => {
    if (!showTracked) return undefined;
    const names = [...tracked];
    if (!names.length) { setTrackedStartups([]); return undefined; }
    const ctrl = new AbortController();
    fetchStartupsByName(names, { signal: ctrl.signal })
      .then(({ results }) => { if (!ctrl.signal.aborted) setTrackedStartups(results); })
      .catch((err) => { if (!ctrl.signal.aborted && !aborted(err)) setTrackedStartups([]); });
    return () => ctrl.abort();
  }, [showTracked, tracked]);

  const sectorColors = useMemo(() => {
    const colors = {};
    [...meta.sectors].sort().forEach((sector, i) => {
      colors[sector] = PALETTE[i % PALETTE.length];
    });
    return colors;
  }, [meta.sectors]);

  // The filters that are on, as chips that take them off one at a time. A curated list's own filters are the list: no chips for them.
  const chipsShown = !activeList && activeChips(filters).length > 0;
  const chips = chipsShown ? <ActiveFilters filters={filters} onChange={setFilters} onClear={() => setFilters(EMPTY_FILTERS)} /> : null;

  const resultCount = summary?.count ?? 0;
  const unverifiedCount = summary?.unverified ?? 0;
  const pinnedCount = summary?.pinned ?? 0;
  // From the whole directory, so this reflects all of it - not whatever filters are active right now.
  const hiringCount = stats?.hiring ?? 0;

  // A company opens at once with what the map or list already knows, then fills in as the full record arrives.
  const openStartup = useCallback((startup) => {
    setSelectedStartup(startup?.slug ? { ...startup, partial: true } : startup);
    if (!startup?.slug) return;
    const now = ui.current.route;
    if (!(now.kind === 'startup' && now.slug === startup.slug)) goTo({ kind: 'startup', slug: startup.slug }, { replace: now.kind === 'startup' });
    fetchStartup(startup.slug)
      .then((full) => setSelectedStartup((current) => (current && current.slug === full.slug ? full : current)))
      .catch(() => {});
  }, [goTo]);

  // A person's profile opens at once; the companies they founded arrive a moment later (an answer to a person
  // who has since been replaced by another is dropped).
  const personTicket = useRef(0);
  const openPerson = useCallback((name) => {
    personTicket.current += 1;
    const ticket = personTicket.current;
    setSelectedPersonName(name);
    setPersonCompanies([]);
    fetchPerson(name)
      .then(({ companies }) => { if (ticket === personTicket.current) setPersonCompanies(companies); })
      .catch(() => {});
  }, []);

  // A group on the map (the companies known only to a city) opens as a list of exactly those companies, inside the
  // filters already chosen.
  const viewArea = useCallback((area) => {
    setFilters((current) => ({ ...current, ...areaFilters(area) }));
    setViewMode('list');
  }, []);

  const toggleNews = () => {
    setNewsVisible((prev) => {
      const next = !prev;
      try { localStorage.setItem(NEWS_VISIBLE_KEY, next ? '1' : '0'); } catch (e) { /* ignore */ }
      return next;
    });
  };

  const goExplore = () => { if (route.kind !== 'explore') leave(); };
  const showNews = () => goTo({ kind: 'news' });
  const showJobsPage = () => goTo({ kind: 'jobs' });
  const showLists = () => goTo({ kind: 'lists' });
  // A list is chosen: its filters apply, the list view shows them, and the address is the list's own.
  const openList = (list) => {
    setFilters(listFilters(list));
    setViewMode('list');
    goTo({ kind: 'list', slug: list.id }, { replace: route.kind === 'lists' });
  };

  // What a page says about itself to the tab and to search engines (hooks/usePageMeta.js).
  const loaded = selectedStartup && !selectedStartup.partial ? selectedStartup : null;
  const pageMeta = useMemo(() => {
    switch (route.kind) {
      case 'startup':
        return loaded && loaded.slug === route.slug
          ? { title: `${loaded.name} · Australian Startup Map`, description: startupDescription(loaded), path: appPath(route), jsonLd: startupJsonLd(loaded) }
          : { path: appPath(route) };
      case 'jobs': return { title: 'Australian startups hiring now · AU Startup Map', description: 'Companies hiring now, each with open roles checked against its own pages.', path: '/jobs' };
      case 'lists': return { title: 'Curated lists of Australian startups · AU Startup Map', description: 'Lists of Australian startups by industry, city and what they are doing now.', path: '/lists' };
      case 'list': return activeList ? { title: `${activeList.name} · AU Startup Map`, description: activeList.description, path: appPath(route) } : null;
      case 'explore': return { path: '/' };
      default: return null;
    }
  }, [route, loaded, activeList]);
  usePageMeta(pageMeta);

  // The investor directory, or one investor or person in it. A company's panel is closed first: it was a step along the way.
  const openInvestors = useCallback((route = { kind: 'list' }) => {
    setSelectedStartup(null);
    setInvestorsStart(route);
    setInvestorsFromLink(false);
    setRoute({ kind: 'investors' });
  }, []);

  if (showJobs) {
    return <JobsView sectorColors={sectorColors} onClose={leave} />;
  }

  if (route.kind === 'news') {
    return <NewsPage onClose={leave} />;
  }

  if (showInvestors) {
    return (
      <InvestorsView
        initialRoute={investorsStart}
        fromLink={investorsFromLink}
        onClose={() => setRoute({ kind: 'explore' })}
        onOpenCompany={(company) => openStartup(company)}
      />
    );
  }

  return (
    <div id="app" className={activeList ? 'has-list-banner' : undefined}>
      <header>
        <div className="nav-brand">
          <h1>AU <span>Startup</span> Map <span className="beta-tag">BETA</span></h1>
          <div className="nav-subtitle">Australia&rsquo;s startup ecosystem</div>
        </div>

        <nav className="nav-center">
          <button className="nav-link" onClick={goExplore}>Explore</button>
          <button className="nav-link" onClick={showJobsPage}>
            Jobs{hiringCount > 0 && <span className="nav-hiring-hint"> · {hiringCount} hiring now</span>}
          </button>
          <button className="nav-link" onClick={() => openInvestors()}>Investors</button>
          <button className="nav-link" onClick={showLists}>Lists</button>
          <button className="nav-link" onClick={showNews}>News</button>
        </nav>

        <div className="nav-right">
          <button className="hdrbtn hdrbtn-accent nav-cta" onClick={() => setShowSubmitForm(true)}>Submit startup</button>
          <button className="hdrbtn nav-cta nav-cta-secondary" onClick={() => setShowWaitlist(true)}>Join waitlist</button>
          <HeaderMenu
            onExplore={goExplore}
            onShowJobs={showJobsPage}
            hiringCount={hiringCount}
            onShowInvestors={() => openInvestors()}
            onShowCuratedLists={showLists}
            onShowNews={showNews}
            newsVisible={newsVisible}
            onToggleNews={toggleNews}
            onShowSubmitForm={() => setShowSubmitForm(true)}
            onShowWaitlist={() => setShowWaitlist(true)}
            onShowUnverified={() => setShowUnverified(true)}
            unverifiedCount={unverifiedCount}
            onShowTracked={() => setShowTracked(true)}
            trackedCount={tracked.size}
          />
        </div>
      </header>

      <SearchBar
        filters={filters}
        onApplyFilters={(partial) => setFilters({ ...filters, ...partial })}
      />

      {activeList && (
        <ListBanner
          list={activeList}
          count={summary?.count ?? null}
          url={new URL(appPath(route), window.location.origin).href}
          onAllLists={showLists}
        />
      )}

      {viewMode === 'map' ? (
        <MapView
          markers={markers}
          areas={areas}
          sectorColors={sectorColors}
          onSelectStartup={openStartup}
          onViewArea={viewArea}
          selectedName={selectedStartup?.name}
          trackedNames={tracked}
        />
      ) : (
        <ListView
          filters={applied}
          sectorColors={sectorColors}
          onSelectStartup={openStartup}
          selectedName={selectedStartup?.name}
          trackedNames={tracked}
          scope={scopeText(applied)}
          onClearScope={() => setFilters({ ...filters, precision: '', state: '', city: filters.precision ? '' : filters.city })}
          chips={chips}
        />
      )}
      {viewMode === 'map' && chips && <div className="chips-float">{chips}</div>}

      <FilterPanel
        filters={filters}
        onChange={setFilters}
        onReset={() => setFilters(EMPTY_FILTERS)}
        meta={meta}
        resultCount={resultCount}
        summary={summary}
      />

      {viewMode === 'map' && <MapKey sectorColors={sectorColors} />}

      <NewsTicker visible={newsVisible} onClose={toggleNews} />

      <BottomCapsule pinnedCount={pinnedCount} viewMode={viewMode} onSetViewMode={setViewMode} />

      <footer id="siteFooter">
        <button className="linkbtn" onClick={() => setShowAbout(true)}>About &amp; sources</button>
        <span className="tag-sep">·</span>
        <button className="linkbtn" onClick={() => setShowPrivacy(true)}>Privacy</button>
        <span className="tag-sep">·</span>
        <a className="linkbtn" href={DIRECTORY_URL}>Full list (no JS)</a>
        <span className="tag-sep">·</span>
        <button className="linkbtn" onClick={() => setShowFeedback(true)}>Feedback</button>
        <span className="tag-sep">·</span>
        <span className="footer-credit">Built by Aryan · Monash University</span>
      </footer>

      {showSubmitForm && <SubmitStartupForm onClose={() => setShowSubmitForm(false)} />}
      {showUnverified && <UnverifiedList filters={applied} onClose={() => setShowUnverified(false)} />}
      {showAbout && <AboutSources onClose={() => setShowAbout(false)} />}
      {showPrivacy && <PrivacyPolicy onClose={() => setShowPrivacy(false)} />}
      {editingCompany && <SuggestEditForm company={editingCompany} onClose={() => setEditingCompany(null)} />}
      {selectedStartup && (
        <StartupDetailPanel
          startup={selectedStartup}
          sectorColor={sectorColors[selectedStartup.sector] || '#444'}
          isTracked={isTracked}
          onToggleTracked={toggleTracked}
          onSuggestEdit={setEditingCompany}
          onSelectPerson={openPerson}
          onOpenInvestor={(slug) => openInvestors({ kind: 'investor', slug })}
          onClose={leave}
        />
      )}
      {selectedPersonName && (
        <PersonProfile
          person={getPersonProfile(selectedPersonName, personCompanies)}
          onClose={() => setSelectedPersonName(null)}
        />
      )}
      {showFeedback && <FeedbackForm onClose={() => setShowFeedback(false)} />}
      {showWaitlist && <WaitlistForm onClose={() => setShowWaitlist(false)} />}
      {showTracked && (
        <StartupListView
          startups={trackedStartups}
          sectorColors={sectorColors}
          onClose={() => setShowTracked(false)}
          isTracked={isTracked}
          onToggleTracked={toggleTracked}
          title={`Tracked startups (${tracked.size})`}
          subtitle={
            trackedStartups.length < tracked.size
              ? `${trackedStartups.length} of ${tracked.size} tracked companies are still in the directory.`
              : 'Companies you have starred, saved in this browser only.'
          }
        />
      )}
      {showCuratedLists && (
        <CuratedLists
          currentFilters={filters}
          onApply={openList}
          onClose={leave}
        />
      )}
      {missing?.kind === 'startup' && (
        <PageNotFound title="This company is not in the directory." onClose={leave}>
          The link may be mistyped, or the company may not have been added yet. You can add it with Submit startup.
        </PageNotFound>
      )}
      {missing?.kind === 'list' && (
        <PageNotFound title="This list does not exist." onClose={leave}>
          The link may be mistyped. The lists we have are under Lists.
        </PageNotFound>
      )}
    </div>
  );
}
