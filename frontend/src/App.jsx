import { useEffect, useMemo, useState } from 'react';
import { fetchStartups, fetchMeta, DIRECTORY_URL } from './api.js';
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

const EMPTY_FILTERS = { search: '', sector: '', city: '', investor: '', stage: '', hiring: '', taskGate: '' };
const EMPTY_META = { sectors: [], cities: [], investors: [], stages: [] };
const NEWS_VISIBLE_KEY = 'auStartupNewsVisible';

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

export default function App() {
  const [meta, setMeta] = useState(EMPTY_META);
  const [filters, setFilters] = useState(loadFiltersFromUrl);
  const [startups, setStartups] = useState([]);
  const [newsVisible, setNewsVisible] = useState(loadNewsVisible);
  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const [showUnverified, setShowUnverified] = useState(false);
  const [viewMode, setViewMode] = useState('map');
  const [showTracked, setShowTracked] = useState(false);
  const { tracked, toggleTracked, isTracked } = useTrackedStartups();
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
  const [allStartups, setAllStartups] = useState([]);

  useEffect(() => {
    fetchMeta().then(setMeta).catch(() => setMeta(EMPTY_META));
    // Unfiltered, fetched once - person profiles cross-reference a founder's
    // companies against the whole dataset, not just whatever the current
    // filters happen to be showing.
    fetchStartups({}).then(({ results }) => setAllStartups(results)).catch(() => setAllStartups([]));
  }, []);

  useEffect(() => {
    fetchStartups(filters)
      .then(({ results }) => {
        setStartups(results);
      })
      .catch(() => {
        setStartups([]);
      });
  }, [filters]);

  const sectorColors = useMemo(() => {
    const colors = {};
    [...meta.sectors].sort().forEach((sector, i) => {
      colors[sector] = PALETTE[i % PALETTE.length];
    });
    return colors;
  }, [meta.sectors]);

  const unverifiedCount = useMemo(() => startups.filter((s) => !s.verified).length, [startups]);
  const pinnedCount = startups.length - unverifiedCount;
  const trackedStartups = useMemo(() => startups.filter((s) => tracked.has(s.name)), [startups, tracked]);

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
          <button className="nav-link" onClick={() => setShowJobs(true)}>Jobs</button>
          <button className="nav-link" onClick={() => setShowCuratedLists(true)}>Lists</button>
          <button className="nav-link" onClick={toggleNews}>News</button>
        </nav>

        <div className="nav-right">
          <button className="hdrbtn hdrbtn-accent" onClick={() => setShowSubmitForm(true)}>Submit startup</button>
          <button className="hdrbtn hdrbtn-accent nav-cta-secondary" onClick={() => setShowWaitlist(true)}>Join waitlist</button>
          <HeaderMenu
            onExplore={goExplore}
            onShowJobs={() => setShowJobs(true)}
            onShowCuratedLists={() => setShowCuratedLists(true)}
            newsVisible={newsVisible}
            onToggleNews={toggleNews}
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
        startups={startups}
        meta={meta}
      />

      {viewMode === 'map' ? (
        <MapView
          startups={startups}
          sectorColors={sectorColors}
          onSelectStartup={setSelectedStartup}
          selectedName={selectedStartup?.name}
          trackedNames={tracked}
        />
      ) : (
        <ListView
          startups={startups}
          sectorColors={sectorColors}
          onSelectStartup={setSelectedStartup}
          selectedName={selectedStartup?.name}
          trackedNames={tracked}
        />
      )}

      <FilterPanel
        filters={filters}
        onChange={setFilters}
        onReset={() => setFilters(EMPTY_FILTERS)}
        meta={meta}
        resultCount={startups.length}
        startups={startups}
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
      {showUnverified && <UnverifiedList startups={startups} onClose={() => setShowUnverified(false)} />}
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
          onSelectPerson={setSelectedPersonName}
          onClose={() => setSelectedStartup(null)}
        />
      )}
      {selectedPersonName && (
        <PersonProfile
          person={getPersonProfile(selectedPersonName, allStartups)}
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
              ? `${trackedStartups.length} of ${tracked.size} tracked companies match what's currently loaded. Reset filters to see the rest.`
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
