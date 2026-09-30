import { useEffect, useMemo, useState } from 'react';
import { fetchStartups, fetchMeta, DIRECTORY_URL } from './api.js';
import MapView from './components/MapView.jsx';
import FilterPanel from './components/FilterPanel.jsx';
import HeaderMenu from './components/HeaderMenu.jsx';
import NewsTicker from './components/NewsTicker.jsx';
import SubmitStartupForm from './components/SubmitStartupForm.jsx';
import SuggestEditForm from './components/SuggestEditForm.jsx';
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
  const [total, setTotal] = useState(0);
  const [newsVisible, setNewsVisible] = useState(loadNewsVisible);
  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const [showUnverified, setShowUnverified] = useState(false);
  const [showStartupList, setShowStartupList] = useState(false);
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

  useEffect(() => {
    fetchMeta().then(setMeta).catch(() => setMeta(EMPTY_META));
  }, []);

  useEffect(() => {
    fetchStartups(filters)
      .then(({ results, total }) => {
        setStartups(results);
        setTotal(total);
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
  const hiringCount = useMemo(() => startups.filter((s) => s.hiring).length, [startups]);
  const trackedStartups = useMemo(() => startups.filter((s) => tracked.has(s.name)), [startups, tracked]);

  const toggleNews = () => {
    setNewsVisible((prev) => {
      const next = !prev;
      try { localStorage.setItem(NEWS_VISIBLE_KEY, next ? '1' : '0'); } catch (e) { /* ignore */ }
      return next;
    });
  };

  if (showJobs) {
    return <JobsView sectorColors={sectorColors} onClose={() => setShowJobs(false)} />;
  }

  return (
    <div id="app">
      <header>
        <h1>AU <span>Startup</span> Map <span className="beta-tag">BETA</span></h1>

        <div className="nav-search">
          <input
            type="text"
            placeholder="Search startups..."
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            aria-label="Search startups"
          />
        </div>

        <div className="header-actions">
          <button className="hdrbtn" onClick={() => setShowJobs(true)}>Jobs</button>
          <HeaderMenu
            newsVisible={newsVisible}
            onToggleNews={toggleNews}
            onShowCuratedLists={() => setShowCuratedLists(true)}
            onShowUnverified={() => setShowUnverified(true)}
            unverifiedCount={unverifiedCount}
            onShowTracked={() => setShowTracked(true)}
            trackedCount={tracked.size}
            onShowSubmitForm={() => setShowSubmitForm(true)}
            onShowWaitlist={() => setShowWaitlist(true)}
          />
        </div>
      </header>

      <MapView startups={startups} sectorColors={sectorColors} onSuggestEdit={setEditingCompany} />

      <FilterPanel
        filters={filters}
        onChange={setFilters}
        onReset={() => setFilters(EMPTY_FILTERS)}
        meta={meta}
        resultCount={startups.length}
        total={total}
        startups={startups}
      />

      <NewsTicker visible={newsVisible} onClose={toggleNews} />

      <BottomCapsule pinnedCount={pinnedCount} hiringCount={hiringCount} onShowList={() => setShowStartupList(true)} />

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
      {showFeedback && <FeedbackForm onClose={() => setShowFeedback(false)} />}
      {showWaitlist && <WaitlistForm onClose={() => setShowWaitlist(false)} />}
      {showStartupList && (
        <StartupListView
          startups={startups}
          sectorColors={sectorColors}
          onClose={() => setShowStartupList(false)}
          isTracked={isTracked}
          onToggleTracked={toggleTracked}
        />
      )}
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
          onApply={(listFilters) => setFilters({ ...EMPTY_FILTERS, ...listFilters })}
          onClose={() => setShowCuratedLists(false)}
        />
      )}
    </div>
  );
}
