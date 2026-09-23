import { useEffect, useMemo, useState } from 'react';
import { fetchStartups, fetchMeta, DIRECTORY_URL } from './api.js';
import MapView from './components/MapView.jsx';
import FilterPanel from './components/FilterPanel.jsx';
import Leaderboard from './components/Leaderboard.jsx';
import NotableStartups from './components/NotableStartups.jsx';
import NewsTicker from './components/NewsTicker.jsx';
import SubmitStartupForm from './components/SubmitStartupForm.jsx';
import SuggestEditForm from './components/SuggestEditForm.jsx';
import FeedbackForm from './components/FeedbackForm.jsx';
import AboutSources from './components/AboutSources.jsx';
import PrivacyPolicy from './components/PrivacyPolicy.jsx';
import UnverifiedList from './components/UnverifiedList.jsx';
import BottomCapsule from './components/BottomCapsule.jsx';
import StartupListView from './components/StartupListView.jsx';

const PALETTE = [
  '#1f5f4f', '#c05a2e', '#b8862a', '#5a6f8c', '#7a3b8a', '#3a8a5a', '#a03a3a', '#8a4a1f',
  '#6a5a3a', '#2f7a3a', '#a0466a', '#3a5a8a', '#8a1f3a', '#5a5a3a', '#7a5a2f', '#4a4a6a',
  '#2a2a2a', '#3a7a8a', '#6a3a2a', '#3a6a5a',
];

const EMPTY_FILTERS = { search: '', sector: '', city: '', investor: '', stage: '', hiring: '' };
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

export default function App() {
  const [meta, setMeta] = useState(EMPTY_META);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [startups, setStartups] = useState([]);
  const [total, setTotal] = useState(0);
  const [newsVisible, setNewsVisible] = useState(loadNewsVisible);
  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const [showUnverified, setShowUnverified] = useState(false);
  const [showStartupList, setShowStartupList] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
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

  const toggleNews = () => {
    setNewsVisible((prev) => {
      const next = !prev;
      try { localStorage.setItem(NEWS_VISIBLE_KEY, next ? '1' : '0'); } catch (e) { /* ignore */ }
      return next;
    });
  };

  return (
    <div id="app">
      <header>
        <div>
          <h1>AU <span>Startup</span> Map <span className="beta-tag">BETA</span></h1>
          <div className="tag">
            VC-backed companies<span className="tag-sep">·</span>live hiring status<span className="tag-sep">·</span>task-gated applications<span className="tag-sep">·</span>public sources + submissions
          </div>
        </div>
        <div className="header-actions">
          <button className="hdrbtn" onClick={toggleNews}>{newsVisible ? 'Hide news' : 'Show news'}</button>
          <button className="hdrbtn" onClick={() => setShowUnverified(true)}>Unconfirmed ({unverifiedCount})</button>
          <button className="hdrbtn hdrbtn-accent" onClick={() => setShowSubmitForm(true)}>Submit a startup</button>
          <div className="tag" id="totalCount">{total} companies tracked</div>
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
      />

      <NewsTicker visible={newsVisible} onClose={toggleNews} />

      <Leaderboard startups={startups} />

      <NotableStartups startups={startups} />

      <BottomCapsule pinnedCount={pinnedCount} onShowList={() => setShowStartupList(true)} />

      <footer id="siteFooter">
        <button className="linkbtn" onClick={() => setShowAbout(true)}>About &amp; sources</button>
        <span className="tag-sep">·</span>
        <button className="linkbtn" onClick={() => setShowPrivacy(true)}>Privacy</button>
        <span className="tag-sep">·</span>
        <a className="linkbtn" href={DIRECTORY_URL}>Full list (no JS)</a>
        <span className="tag-sep">·</span>
        <button className="linkbtn" onClick={() => setShowFeedback(true)}>Feedback</button>
      </footer>

      {showSubmitForm && <SubmitStartupForm onClose={() => setShowSubmitForm(false)} />}
      {showUnverified && <UnverifiedList startups={startups} onClose={() => setShowUnverified(false)} />}
      {showAbout && <AboutSources onClose={() => setShowAbout(false)} />}
      {showPrivacy && <PrivacyPolicy onClose={() => setShowPrivacy(false)} />}
      {editingCompany && <SuggestEditForm company={editingCompany} onClose={() => setEditingCompany(null)} />}
      {showFeedback && <FeedbackForm onClose={() => setShowFeedback(false)} />}
      {showStartupList && (
        <StartupListView startups={startups} sectorColors={sectorColors} onClose={() => setShowStartupList(false)} />
      )}
    </div>
  );
}
