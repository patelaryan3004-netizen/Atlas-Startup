import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchMeta, fetchSummary, fetchMarkers, fetchStartup, fetchStartupsByName, fetchPerson, DIRECTORY_URL } from './api.js';
import MapView from './components/MapView.jsx';
import ListView from './components/ListView.jsx';
import FilterPanel from './components/FilterPanel.jsx';
import HeaderMenu from './components/HeaderMenu.jsx';
import SearchBar from './components/SearchBar.jsx';
import NewsTicker from './components/NewsTicker.jsx';
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
  const [meta, setMeta] = useState(EMPTY_META);
  const [filters, setFilters] = useState(loadFiltersFromUrl);
  const applied = useAppliedFilters(filters);
  const [summary, setSummary] = useState(null);
  const [stats, setStats] = useState(null);
  const [markers, setMarkers] = useState([]);
  const [areas, setAreas] = useState([]);
  const [newsVisible, setNewsVisible] = useState(loadNewsVisible);
  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const [showUnverified, setShowUnverified] = useState(false);
  const [viewMode, setViewMode] = useState('map');
  const [showTracked, setShowTracked] = useState(false);
  const { tracked, toggleTracked, isTracked } = useTrackedStartups();
  const [trackedStartups, setTrackedStartups] = useState([]);
  const [showAbout, setShowAbout] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showWaitlist, setShowWaitlist] = useState(false);
  const initialView = loadInitialView();
  const [showJobs, setShowJobs] = useState(initialView === 'jobs');
  const [showCuratedLists, setShowCuratedLists] = useState(initialView === 'lists');
  const [editingCompany, setEditingCompany] = useState(null);
  const [selectedStartup, setSelectedStartup] = useState(null);
  const [selectedPersonName, setSelectedPersonName] = useState(null);
  const [personCompanies, setPersonCompanies] = useState([]);

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

  const resultCount = summary?.count ?? 0;
  const unverifiedCount = summary?.unverified ?? 0;
  const pinnedCount = summary?.pinned ?? 0;
  // From the whole directory, so this reflects all of it - not whatever filters are active right now.
  const hiringCount = stats?.hiring ?? 0;

  // A company opens at once with what the map or list already knows, then fills in as the full record arrives.
  const openStartup = useCallback((startup) => {
    setSelectedStartup(startup?.slug ? { ...startup, partial: true } : startup);
    if (!startup?.slug) return;
    fetchStartup(startup.slug)
      .then((full) => setSelectedStartup((current) => (current && current.slug === full.slug ? full : current)))
      .catch(() => {});
  }, []);

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

  const goExplore = () => setShowJobs(false);

  if (showJobs) {
    return <JobsView sectorColors={sectorColors} onClose={() => setShowJobs(false)} />;
  }

  return (
    <div id="app">
      <header>
        <div className="nav-brand">
          <h1>AU <span>Startup</span> Map <span className="beta-tag">BETA</span></h1>
          <div className="nav-subtitle">Australia&rsquo;s startup ecosystem</div>
        </div>

        <nav className="nav-center">
          <button className="nav-link" onClick={goExplore}>Explore</button>
          <button className="nav-link" onClick={() => setShowJobs(true)}>
            Jobs{hiringCount > 0 && <span className="nav-hiring-hint"> · {hiringCount} hiring now</span>}
          </button>
          <button className="nav-link" onClick={() => setShowCuratedLists(true)}>Lists</button>
          <button className="nav-link" onClick={toggleNews}>News</button>
        </nav>

        <div className="nav-right">
          <button className="hdrbtn hdrbtn-accent nav-cta" onClick={() => setShowSubmitForm(true)}>Submit startup</button>
          <button className="hdrbtn nav-cta nav-cta-secondary" onClick={() => setShowWaitlist(true)}>Join waitlist</button>
          <HeaderMenu
            onExplore={goExplore}
            onShowJobs={() => setShowJobs(true)}
            hiringCount={hiringCount}
            onShowCuratedLists={() => setShowCuratedLists(true)}
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
        />
      )}

      <FilterPanel
        filters={filters}
        onChange={setFilters}
        onReset={() => setFilters(EMPTY_FILTERS)}
        meta={meta}
        resultCount={resultCount}
        summary={summary}
      />

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
          onClose={() => setSelectedStartup(null)}
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
          onApply={(listFilters) => {
            setFilters({ ...EMPTY_FILTERS, ...listFilters });
            setViewMode('list');
          }}
          onClose={() => setShowCuratedLists(false)}
        />
      )}
    </div>
  );
}
