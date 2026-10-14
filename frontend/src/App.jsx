import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchMeta, fetchSummary, fetchMarkers, fetchInstitutionPins, fetchStartup, fetchStartupsByName, fetchPerson, DIRECTORY_URL } from './api.js';
import FilterPanel from './components/FilterPanel.jsx';
import { splitValues } from './components/MultiSelect.jsx';
import MapKey from './components/MapKey.jsx';
import MapLayers from './components/MapLayers.jsx';
import ExploreHeader from './components/explore/ExploreHeader.jsx';
import ExploreToolbar, { nextCity, placeLabel } from './components/explore/ExploreToolbar.jsx';
import PreviewCard from './components/explore/PreviewCard.jsx';
import CityDock from './components/explore/CityDock.jsx';
import MapOverview from './components/explore/MapOverview.jsx';
import ResultsSheet from './components/explore/ResultsSheet.jsx';
import { getPersonProfile } from './people.js';
import { areaFilters, pinPayload, scopeText } from './mapPins.js';
import { readRoute as readInvestorsRoute } from './components/investors/route.js';
import { readAppRoute, appUrl, appPath } from './appRoute.js';
import { usePageMeta } from './hooks/usePageMeta.js';
import { startupDescription, startupJsonLd } from './seo.js';
import { curatedLists } from './curatedLists.js';
import { showPeople } from './flags.js';
import { hiringLabel, roleClosedMessage } from './freshness.js';
import { PALETTE, FALLBACK_COLOR } from './sectorPalette.js';
import ListBanner from './components/ListBanner.jsx';
import ActiveFilters, { activeChips } from './components/ActiveFilters.jsx';
import PageNotFound from './components/PageNotFound.jsx';
import { useTrackedStartups } from './hooks/useTrackedStartups.js';
import { useMediaQuery, DESKTOP } from './hooks/useMediaQuery.js';
import { lazyView, Lazy } from './lazyLoad.jsx';
import { ListSkeleton, MapPlaceholder } from './components/Skeletons.jsx';
import { peek } from './peek.js';
import './explore.css';

// Fetched when first wanted, not with the page: the pages (the map and its library, the list, the jobs board, the investors, the
// news, the people), the news ticker (once the page has settled), the company's panel and every dialog. What stays here is what every
// visit draws at once: the header, search, filters, the map's key and the footer.
const MapView = lazyView(() => import('./components/MapView.jsx'));
const NewsTicker = lazyView(() => import('./components/NewsTicker.jsx'));
const ListView = lazyView(() => import('./components/ListView.jsx'));
const JobsView = lazyView(() => import('./components/JobsView.jsx'));
const InvestorsView = lazyView(() => import('./components/investors/InvestorsView.jsx'));
const NewsPage = lazyView(() => import('./components/NewsPage.jsx'));
const PeopleView = lazyView(() => import('./components/people/PeopleView.jsx'));
const StartupDetailPanel = lazyView(() => import('./components/StartupDetailPanel.jsx'));
const PersonProfile = lazyView(() => import('./components/PersonProfile.jsx'));
const SubmitStartupForm = lazyView(() => import('./components/SubmitStartupForm.jsx'));
const SuggestEditForm = lazyView(() => import('./components/SuggestEditForm.jsx'));
const FeedbackForm = lazyView(() => import('./components/FeedbackForm.jsx'));
const WaitlistForm = lazyView(() => import('./components/WaitlistForm.jsx'));
const AboutSources = lazyView(() => import('./components/AboutSources.jsx'));
const PrivacyPolicy = lazyView(() => import('./components/PrivacyPolicy.jsx'));
const UnverifiedList = lazyView(() => import('./components/UnverifiedList.jsx'));
const StartupListView = lazyView(() => import('./components/StartupListView.jsx'));
const CuratedLists = lazyView(() => import('./components/CuratedLists.jsx'));

// What shows while a page's file arrives: the page's own words, over the dark background the page already has.
const loading = (what) => <div className="view-loading" role="status">Loading {what}…</div>;

// True once the browser has nothing better to do (a moment after the page is up), so a part the first view does not need is asked for
// then and not alongside the page's own files. A browser without requestIdleCallback waits a short fixed time.
function useWhenIdle() {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(() => setIdle(true), { timeout: 2500 });
      return () => window.cancelIdleCallback?.(id);
    }
    const timer = setTimeout(() => setIdle(true), 1200);
    return () => clearTimeout(timer);
  }, []);
  return idle;
}


// precision (EXACT, SUBURB, CITY, STATE) is how well a company's place is known, and state its state: a group on the
// map ("Sydney, 42 startups with city-level locations") opens as a list by setting them.
// remote (a remote policy), tech (tools it builds with, several), team (a bucket of team size) and fresh ("week": new this week) filter by the
// optional facts a page may give a company.
const EMPTY_FILTERS = { search: '', sector: '', city: '', investor: '', stage: '', hiring: '', taskGate: '', events: '', precision: '', state: '', remote: '', tech: '', team: '', fresh: '' };
const EMPTY_META = { sectors: [], cities: [], investors: [], stages: [], remotePolicies: [], techStack: [], teamSizes: [], hasFresh: false };
const NEWS_VISIBLE_KEY = 'auStartupNewsVisible';
const SEARCH_DEBOUNCE_MS = 250;
const DOCK_CITIES = 4; // the cities on the map's dock
const SHEET_INSET = 340; // the height of a card in the phone's sheet: a pin picked on the map is brought clear of it

function loadNewsVisible() {
  try {
    const raw = localStorage.getItem(NEWS_VISIBLE_KEY);
    return raw === null ? true : raw === '1';
  } catch (e) {
    return true;
  }
}

// The map's two layers and its basemap are kept in this browser, so a visitor who switched one off finds it as they left it. A browser that
// will not say (a private window) gets the defaults: both layers on, the dark map.
const LAYERS_KEY = 'auStartupMapLayers';
const BASEMAP_KEY = 'auStartupBasemap';
function loadLayers() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYERS_KEY) ?? 'null');
    return { companies: saved?.companies !== false, institutions: saved?.institutions !== false };
  } catch (e) {
    return { companies: true, institutions: true };
  }
}
function loadBasemap() {
  try {
    return localStorage.getItem(BASEMAP_KEY) === 'light' ? 'light' : 'dark';
  } catch (e) {
    return 'dark';
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
  // Where a link into the app lands: ?view=jobs, lists, list (the list of startups), waitlist (the waitlist form) or submit (the form to
  // submit a startup); and the
  // investor pages by their own addresses: /investors, /investors/<slug> and /investors/people/<slug> (the first version's
  // ?view=investors addresses still work).
  const initialView = loadInitialView();
  const peopleOn = showPeople(); // VITE_SHOW_PEOPLE: without it the People page, its links and the firms on the map do not exist (flags.js)
  // The page is in the address bar (appRoute.js): a link opens it, Back leaves it.
  const [route, setRoute] = useState(readAppRoute);
  const [filters, setFilters] = useState(() => initialFilters(route));
  const applied = useAppliedFilters(filters);
  // What the snapshot already holds is what the first paint has (peek.js): the filters' options, the counts and, on the map, the pins. An
  // address with filters asks something the snapshot does not hold, so those start empty and the API answers, as before.
  const startsOnMap = !(initialView === 'list' || route.kind === 'list');
  const [first] = useState(() => ({ meta: peek.meta(), stats: peek.summary({}), summary: peek.summary(applied), pins: startsOnMap ? peek.markers(applied) : null }));
  const [meta, setMeta] = useState(first.meta ?? EMPTY_META);
  const [summary, setSummary] = useState(first.summary);
  const [stats, setStats] = useState(first.stats);
  const [markers, setMarkers] = useState(first.pins?.items ?? []);
  const [areas, setAreas] = useState(first.pins?.areas ?? []);
  const [newsVisible, setNewsVisible] = useState(loadNewsVisible);
  const [layers, setLayers] = useState(loadLayers);
  const [basemap, setBasemap] = useState(loadBasemap);
  const [institutionPins, setInstitutionPins] = useState([]);
  const desktop = useMediaQuery(DESKTOP, true); // a card on the map (wide) or a sheet that slides up from the bottom (a phone)
  const [filtersOpen, setFiltersOpen] = useState(false); // the slide-out panel on the left, opened by the Filters button: the map's own cards move aside while it is open
  const filtersButton = useRef(null);
  const [preview, setPreview] = useState(null); // the company picked on the map: its card (a pin's company, as pinPayload makes it)
  const [focus, setFocus] = useState(null); // a place for the map to bring into view (MapView's focus)
  const focusTicket = useRef(0);
  const [mapView, setMapView] = useState(null); // where the map is looking, for the little map of Australia
  const [sheetOpen, setSheetOpen] = useState(false); // the phone's sheet: its list is showing
  const [showSubmitForm, setShowSubmitForm] = useState(initialView === 'submit');
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
  const [editingMessage, setEditingMessage] = useState('');
  const [selectedStartup, setSelectedStartup] = useState(null);
  const [selectedPersonName, setSelectedPersonName] = useState(null);
  const [personCompanies, setPersonCompanies] = useState([]);
  const newsReady = useWhenIdle();

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

  // The first views draw from the snapshot file when it holds the answer (api.js, snapshot.js), and the API's answer then replaces it. An API
  // that cannot be reached leaves what the snapshot gave; with no snapshot either, these stay as they start (empty options, no counts).
  useEffect(() => {
    fetchMeta({ onSnapshot: setMeta }).then(setMeta).catch(() => {});
    // The whole directory's counts, once: the Jobs link says how many are hiring however the map is filtered.
    fetchSummary({}, { onSnapshot: setStats }).then(setStats).catch(() => {});
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    let shown = false;
    fetchSummary(applied, { signal: ctrl.signal, onSnapshot: (found) => { shown = true; setSummary(found); } })
      .then((found) => { if (!ctrl.signal.aborted) setSummary(found); })
      .catch((err) => { if (!ctrl.signal.aborted && !aborted(err) && !shown) setSummary(null); });
    return () => ctrl.abort();
  }, [applied]);

  // The map's pins, and the groups for companies known only to their city or state, only while the map is showing.
  useEffect(() => {
    if (viewMode !== 'map') return undefined;
    const ctrl = new AbortController();
    let shown = false;
    const draw = ({ items, areas: groups }) => { if (!ctrl.signal.aborted) { setMarkers(items); setAreas(groups ?? []); } };
    fetchMarkers(applied, { signal: ctrl.signal, onSnapshot: (found) => { shown = true; draw(found); } })
      .then(draw)
      .catch((err) => { if (!ctrl.signal.aborted && !aborted(err) && !shown) { setMarkers([]); setAreas([]); } });
    return () => ctrl.abort();
  }, [applied, viewMode]);

  // The firms' offices, once, for the map (they do not depend on the filters): none until the owner's file of firms is in place.
  // With the people switched off the firms are not asked for at all.
  useEffect(() => {
    if (!peopleOn || viewMode !== 'map' || institutionPins.length) return undefined;
    const ctrl = new AbortController();
    fetchInstitutionPins({ signal: ctrl.signal })
      .then(({ items }) => { if (!ctrl.signal.aborted) setInstitutionPins(items ?? []); })
      .catch(() => { /* no firms on the map: the map is as it was */ });
    return () => ctrl.abort();
  }, [peopleOn, viewMode, institutionPins.length]);

  const toggleLayer = (name) => setLayers((was) => {
    const next = { ...was, [name]: !was[name] };
    try { localStorage.setItem(LAYERS_KEY, JSON.stringify(next)); } catch (e) { /* ignore */ }
    return next;
  });
  const chooseBasemap = (name) => {
    setBasemap(name);
    try { localStorage.setItem(BASEMAP_KEY, name); } catch (e) { /* ignore */ }
  };

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
  // The city is not a chip: the toolbar's breadcrumb and the city dock already say it (and take it off).
  const chipFilters = { ...filters, city: '' };
  const chipsShown = !activeList && activeChips(chipFilters).length > 0;
  const chips = chipsShown ? <ActiveFilters filters={chipFilters} onChange={(next) => setFilters({ ...next, city: filters.city })} onClear={() => setFilters({ ...EMPTY_FILTERS, city: filters.city })} /> : null;

  const resultCount = summary?.count ?? 0;
  const unverifiedCount = summary?.unverified ?? 0;
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
  const openPeople = () => goTo({ kind: 'people' });
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

  // A page the app already has for someone on the People page (an investor, or a person who invests), opened in the app.
  const openInternal = useCallback((href) => {
    const page = readInvestorsRoute({ pathname: href, search: '' });
    if (page) openInvestors(page);
  }, [openInvestors]);

  // ---------- the map's chrome (components/explore) ----------

  // The cities for the toolbar's menu and the map's dock, each with how many startups it has, the busiest first. The counts are the whole
  // directory's (stats.topCities); a city the directory lists without a count is still in the menu, after those that have one. A company whose
  // city is not known is not a city.
  const cityOptions = useMemo(() => {
    const counts = new Map((stats?.topCities ?? []).map(({ city, count }) => [city, count]));
    const known = (city) => city && String(city).trim() && String(city).trim().toLowerCase() !== 'unknown';
    const names = new Set([...(meta.cities ?? []), ...counts.keys()].filter(known));
    return [...names]
      .map((city) => ({ city, count: counts.get(city) ?? null }))
      .sort((a, b) => (b.count ?? -1) - (a.count ?? -1) || a.city.localeCompare(b.city));
  }, [meta.cities, stats]);
  const dockCities = useMemo(() => cityOptions.filter(({ count }) => count != null).slice(0, DOCK_CITIES), [cityOptions]);

  const applyFilters = useCallback((partial) => setFilters((now) => ({ ...now, ...partial })), []);
  const pickCity = useCallback((city) => setFilters((now) => ({ ...now, city: nextCity(now.city, city) })), []);
  const showAustralia = useCallback(() => {
    setFilters((now) => ({ ...now, city: '' }));
    focusTicket.current += 1;
    setFocus({ key: focusTicket.current, home: true });
  }, []);

  // A company is picked on the map: its card opens (on a phone, in the sheet, and the map brings its pin clear of the sheet). Any change to what is
  // being looked at puts the card away: it was for a company of the last view.
  const selectPin = useCallback((pin) => {
    setPreview(pin);
    if (!desktop && Number.isFinite(pin.lat) && Number.isFinite(pin.lng)) {
      focusTicket.current += 1;
      setFocus({ key: focusTicket.current, lat: pin.lat, lng: pin.lng, inset: SHEET_INSET });
    }
  }, [desktop]);
  const clearPin = useCallback(() => setPreview(null), []);
  useEffect(() => { setPreview(null); }, [applied, viewMode]);

  // A company picked from the sheet's list: the pin it has on the map when it has one (the map then goes to it), else just what the list knows.
  const pickFromSheet = (startup) => {
    const tuple = markers.find((m) => m[0] === startup.slug);
    selectPin(tuple ? pinPayload(tuple) : {
      slug: startup.slug, name: startup.name, city: startup.city, sector: startup.sector, verified: true, website: startup.website || '',
      hiring: hiringLabel(startup).state === 'hiring',
    });
  };
  const openFromPreview = () => { const pin = preview; setPreview(null); openStartup(pin); };
  const reportRoleClosed = (name) => { setEditingMessage(roleClosedMessage(name)); setEditingCompany(name); };
  const previewCard = (variant) => (
    <PreviewCard
      key={preview.slug}
      pin={preview}
      variant={variant}
      saved={tracked.has(preview.name)}
      onToggleSaved={() => toggleTracked(preview.name)}
      onOpen={openFromPreview}
      onClose={clearPin}
      onReport={() => reportRoleClosed(preview.name)}
    />
  );
  const sheetMode = preview ? 'detail' : sheetOpen ? 'open' : 'peek';

  if (showJobs) {
    return <Lazy fallback={loading('jobs')}><JobsView onClose={leave} /></Lazy>;
  }

  if (route.kind === 'news') {
    return <Lazy fallback={loading('news')}><NewsPage onClose={leave} /></Lazy>;
  }

  if (route.kind === 'people' && peopleOn) {
    return <Lazy fallback={loading('people')}><PeopleView onClose={leave} onOpenCompany={(company) => openStartup(company)} onOpenInternal={openInternal} /></Lazy>;
  }

  if (showInvestors) {
    return (
      <Lazy fallback={loading('investors')}>
        <InvestorsView
          initialRoute={investorsStart}
          fromLink={investorsFromLink}
          onClose={() => setRoute({ kind: 'explore' })}
          onOpenCompany={(company) => openStartup(company)}
        />
      </Lazy>
    );
  }

  return (
    <div id="app" className={['xp', activeList && 'has-list-banner', filtersOpen && 'panel-open'].filter(Boolean).join(' ')}>
      <ExploreHeader
        hiringCount={hiringCount}
        trackedCount={tracked.size}
        onExplore={goExplore}
        onShowJobs={showJobsPage}
        onShowInvestors={() => openInvestors()}
        onShowTracked={() => setShowTracked(true)}
        onAdd={() => setShowSubmitForm(true)}
        menu={{
          onExplore: goExplore,
          onShowJobs: showJobsPage,
          hiringCount,
          onShowInvestors: () => openInvestors(),
          onShowPeople: peopleOn ? openPeople : undefined,
          onShowCuratedLists: showLists,
          onShowNews: showNews,
          newsVisible,
          onToggleNews: toggleNews,
          onShowWaitlist: () => setShowWaitlist(true),
          onShowUnverified: () => setShowUnverified(true),
          unverifiedCount,
          onShowTracked: () => setShowTracked(true),
          trackedCount: tracked.size,
          onShowAbout: () => setShowAbout(true),
          onShowPrivacy: () => setShowPrivacy(true),
          onShowFeedback: () => setShowFeedback(true),
          directoryUrl: DIRECTORY_URL,
        }}
      />

      <ExploreToolbar
        filters={filters}
        onFilterChange={applyFilters}
        onApplyFilters={applyFilters}
        meta={meta}
        cities={cityOptions}
        total={stats?.count}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen((open) => !open)}
        filtersRef={filtersButton}
        viewMode={viewMode}
        onSetViewMode={setViewMode}
      />

      {activeList && (
        <ListBanner
          list={activeList}
          count={summary?.count ?? null}
          url={new URL(appPath(route), window.location.origin).href}
          onAllLists={showLists}
        />
      )}

      <main className="xm" data-view={viewMode} data-sheet={sheetMode} data-card={desktop && viewMode === 'map' && preview ? '' : undefined}>
        <Lazy fallback={viewMode === 'map' ? <MapPlaceholder basemap={basemap} /> : <ListSkeleton />}>
          {viewMode === 'map' ? (
            <MapView
              markers={markers}
              areas={areas}
              onSelectStartup={openStartup}
              onSelectPin={selectPin}
              onClearPin={clearPin}
              onViewArea={viewArea}
              selectedName={preview?.name ?? selectedStartup?.name}
              trackedNames={tracked}
              institutionPins={institutionPins}
              showCompanies={layers.companies}
              showInstitutions={layers.institutions}
              basemap={basemap}
              scope={applied.city}
              focus={focus}
              onViewChange={setMapView}
              onOpenInternal={openInternal}
              onReportRoleClosed={reportRoleClosed}
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
              meta={meta}
              onFiltersChange={setFilters}
            />
          )}
        </Lazy>

        {viewMode === 'map' && <h2 className="xm-title">Discover what&rsquo;s around you</h2>}
        {viewMode === 'map' && chips && <div className="chips-float">{chips}</div>}

        {viewMode === 'map' && <CityDock cities={dockCities} selected={splitValues(filters.city)} onSelect={pickCity} />}
        {viewMode === 'map' && desktop && <MapOverview view={mapView} onShowAll={showAustralia} />}

        {viewMode === 'map' && desktop && preview && (
          <div className="xm-preview">{previewCard('card')}</div>
        )}
        {viewMode === 'map' && !desktop && (
          <ResultsSheet
            filters={applied}
            count={resultCount}
            where={placeLabel(splitValues(filters.city))}
            open={sheetOpen}
            onOpenChange={setSheetOpen}
            selectedName={preview?.name}
            onPick={pickFromSheet}
            detail={preview ? previewCard('sheet') : null}
          />
        )}

        <FilterPanel
          filters={filters}
          onChange={setFilters}
          onReset={() => setFilters(EMPTY_FILTERS)}
          meta={meta}
          resultCount={resultCount}
          summary={summary}
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          toggleRef={filtersButton}
          mapTools={viewMode === 'map' ? (
            <>
              <MapLayers
                showCompanies={layers.companies}
                onToggleCompanies={() => toggleLayer('companies')}
                institutionCount={institutionPins.length}
                showInstitutions={layers.institutions}
                onToggleInstitutions={() => toggleLayer('institutions')}
                basemap={basemap}
                onBasemap={chooseBasemap}
              />
              <MapKey showInstitutions={institutionPins.length > 0} />
            </>
          ) : null}
        />

        {newsReady && <Lazy><NewsTicker visible={newsVisible} onClose={toggleNews} /></Lazy>}
      </main>

      {showSubmitForm && <Lazy><SubmitStartupForm onClose={() => setShowSubmitForm(false)} /></Lazy>}
      {showUnverified && <Lazy><UnverifiedList filters={applied} onClose={() => setShowUnverified(false)} /></Lazy>}
      {showAbout && <Lazy><AboutSources onClose={() => setShowAbout(false)} /></Lazy>}
      {showPrivacy && <Lazy><PrivacyPolicy onClose={() => setShowPrivacy(false)} /></Lazy>}
      {editingCompany && <Lazy><SuggestEditForm company={editingCompany} initialMessage={editingMessage} onClose={() => { setEditingCompany(null); setEditingMessage(''); }} /></Lazy>}
      {selectedStartup && (
        <Lazy>
          <StartupDetailPanel
            startup={selectedStartup}
            sectorColor={sectorColors[selectedStartup.sector] || FALLBACK_COLOR}
            isTracked={isTracked}
            onToggleTracked={toggleTracked}
            onSuggestEdit={(name, message = '') => { setEditingMessage(message); setEditingCompany(name); }}
            onSelectPerson={openPerson}
            onOpenInvestor={(slug) => openInvestors({ kind: 'investor', slug })}
            onClose={leave}
          />
        </Lazy>
      )}
      {selectedPersonName && (
        <Lazy>
          <PersonProfile
            person={getPersonProfile(selectedPersonName, personCompanies)}
            onClose={() => setSelectedPersonName(null)}
          />
        </Lazy>
      )}
      {showFeedback && <Lazy><FeedbackForm onClose={() => setShowFeedback(false)} /></Lazy>}
      {showWaitlist && <Lazy><WaitlistForm onClose={() => setShowWaitlist(false)} /></Lazy>}
      {showTracked && (
        <Lazy>
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
        </Lazy>
      )}
      {showCuratedLists && (
        <Lazy>
          <CuratedLists
            currentFilters={filters}
            onApply={openList}
            onClose={leave}
          />
        </Lazy>
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
