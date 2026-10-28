import { useEffect, useRef, useState } from 'react';
import SiteHeader from '../brand/SiteHeader.jsx';
import SectionTabs from '../brand/SectionTabs.jsx';
import { Segmented, EmptyState } from '../brand/parts.jsx';
import { DISCOVER_TABS } from '../brand/nav.js';
import { fetchInvestors } from '../../api.js';
import { fetchMembers } from '../../networkApi.js';
import { ensureStatus, useSession } from '../../session.js';
import { useSavedKind } from '../../savedStore.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';
import { linkProps } from '../brand/nav.js';
import { BookmarkIcon, SearchIcon } from '../explore/icons.jsx';
import MemberAvatar from './MemberAvatar.jsx';
import { OPEN_TO_LABELS } from './MemberProfile.jsx';

const SOURCES = [{ id: 'members', label: 'Members' }, { id: 'directory', label: 'Directory' }];
const PAGE = 20;

function MemberCard({ m, saved, onToggle }) {
  return (
    <li className="dp-card">
      <a className="dp-main" {...linkProps(`/members/${m.id}`)}>
        <MemberAvatar name={m.name} size="lg" />
        <span className="dp-text">
          <span className="dp-name">{m.name}</span>
          <span className="dp-sub">{[m.role, m.city].filter(Boolean).join(' · ') || 'Member'}</span>
          {m.intro && <span className="dp-intro">{m.intro}</span>}
          {m.open_to.length > 0 && <span className="dp-open">Open to {m.open_to.map((o) => (OPEN_TO_LABELS[o] ?? o).toLowerCase()).join(', ')}</span>}
        </span>
      </a>
      <button type="button" className="bm" aria-pressed={saved} aria-label={saved ? `Remove ${m.name} from saved` : `Save ${m.name}`} onClick={() => onToggle(m.id)}>
        <BookmarkIcon size={22} fill={saved ? 'currentColor' : 'none'} />
      </button>
    </li>
  );
}

// Discover → People. Two kinds of person, kept apart on purpose:
//   Members      people who joined Still Early and chose to be listed. They wrote their own profile.
//   Directory    people named on public pages (an investor's team page, say), listed as records. They have not joined, and a listing is not an endorsement,
//                a partnership or a way to be introduced.
export default function DiscoverPeople({ chrome = {} }) {
  const { open } = useSession();
  const saves = useSavedKind('member');
  const [source, setSource] = useState('members');
  const [search, setSearch] = useState('');
  const [typed, setTyped] = useState('');
  const [city, setCity] = useState('');
  const [openTo, setOpenTo] = useState('');
  const [data, setData] = useState({ results: [], cities: [], total: 0, hasMore: false });
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const offset = useRef(0);

  usePageMeta({ title: 'People · Discover · Still Early', description: 'Members of the Still Early community who chose to be listed, and people named on public pages.', path: '/discover/people' });
  useEffect(() => { ensureStatus(); }, []);
  useEffect(() => { const t = setTimeout(() => setSearch(typed), 250); return () => clearTimeout(t); }, [typed]);

  useEffect(() => {
    if (source !== 'members') return undefined;
    if (open === false) { setStatus('closed'); return undefined; }
    if (open === null) return undefined;
    const ctrl = new AbortController();
    setStatus('loading');
    offset.current = 0;
    fetchMembers({ search, city, open_to: openTo, limit: PAGE, offset: 0 }, { signal: ctrl.signal })
      .then((res) => { if (!ctrl.signal.aborted) { setData(res); setStatus('ready'); } })
      .catch((err) => { if (!ctrl.signal.aborted && err.name !== 'AbortError') { if (err.code === 'network_unavailable') setStatus('closed'); else { setError(err.message); setStatus('error'); } } });
    return () => ctrl.abort();
  }, [source, search, city, openTo, open]);

  const more = async () => {
    offset.current += PAGE;
    const res = await fetchMembers({ search, city, open_to: openTo, limit: PAGE, offset: offset.current });
    setData((d) => ({ ...res, results: [...d.results, ...res.results] }));
  };

  return (
    <div id="peopleDiscoverView" className="page-shell">
      <SiteHeader active="discover" go={chrome.go} counts={chrome.counts} menu={chrome.menu} />
      <main className="disc" id="main">
        <SectionTabs label="Discover" tabs={DISCOVER_TABS} active="people" go={chrome.tabs} />
        <header className="disc-head">
          <h1 className="serif-h1">People <em>to meet.</em></h1>
          <p className="lede">Members of the community who chose to be listed, and people named on public pages.</p>
        </header>

        <div className="disc-tools">
          <Segmented label="Whose profiles" options={SOURCES} value={source} onChange={setSource} />
        </div>

        {source === 'members' ? (
          <>
            <p className="disc-note">Members joined Still Early and wrote their own profiles. Nobody has checked them, and being listed is not an endorsement.</p>
            {status !== 'closed' && (
              <div className="disc-filters">
                <label className="field"><SearchIcon size={20} /><input type="search" aria-label="Search members" placeholder="Search by name, role, city or project" value={typed} onChange={(e) => setTyped(e.target.value)} /></label>
                <select className="select" aria-label="City" value={city} onChange={(e) => setCity(e.target.value)}>
                  <option value="">Any city</option>
                  {data.cities.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select className="select" aria-label="Open to" value={openTo} onChange={(e) => setOpenTo(e.target.value)}>
                  <option value="">Open to anything</option>
                  {Object.entries(OPEN_TO_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </div>
            )}
            {status === 'closed' && <EmptyState title="The community is not open yet.">Members appear here once it opens. Startups and investors are open now, in the other tabs.</EmptyState>}
            {status === 'loading' && <p className="home-quiet" role="status">Loading members…</p>}
            {status === 'error' && <div className="home-error" role="alert"><p>Could not load members. {error}</p></div>}
            {status === 'ready' && (
              <>
                <p className="disc-count" role="status">{data.total === 1 ? '1 member' : `${data.total} members`}{search || city || openTo ? ' match' : ' listed'}</p>
                {data.results.length === 0 ? (
                  <EmptyState title={search || city || openTo ? 'No members match.' : 'No one has listed their profile yet.'}>
                    {search || city || openTo ? 'Try a different word, or clear the filters.' : 'Join, write a short profile, and choose to be listed: you could be the first.'}
                  </EmptyState>
                ) : (
                  <ul className="dp-grid">{data.results.map((m) => <MemberCard key={m.id} m={m} saved={saves.has(m.id)} onToggle={saves.toggle} />)}</ul>
                )}
                {data.hasMore && <div className="home-more"><button type="button" className="btn btn-secondary" onClick={more}>Show more</button></div>}
              </>
            )}
          </>
        ) : (
          <DirectoryPeople />
        )}
      </main>
    </div>
  );
}

// People the investor directory lists from public pages: only those that have been checked and published. They are records, not members.
function DirectoryPeople() {
  const [state, setState] = useState({ status: 'loading', results: [], total: 0 });
  useEffect(() => {
    const ctrl = new AbortController();
    fetchInvestors({ kind: 'person', scope: 'au' }, { limit: 24, signal: ctrl.signal })
      .then((res) => { if (!ctrl.signal.aborted) setState({ status: 'ready', results: res.results, total: res.count }); })
      .catch((err) => { if (!ctrl.signal.aborted && err.name !== 'AbortError') setState({ status: 'error', results: [], total: 0 }); });
    return () => ctrl.abort();
  }, []);
  return (
    <>
      <p className="disc-note">Directory listings are people named on public pages, such as an investor&rsquo;s team page. They have not joined Still Early, and a listing is not an endorsement, a partnership or a way to be introduced.</p>
      {state.status === 'loading' && <p className="home-quiet" role="status">Loading the directory…</p>}
      {state.status === 'error' && <div className="home-error" role="alert"><p>Could not load the directory.</p></div>}
      {state.status === 'ready' && state.results.length === 0 && (
        <EmptyState title="No one is listed here yet.">A person appears once their details have been checked against a page they or their firm publish, and a person has published them. Investors are listed, as firms, under Investors.</EmptyState>
      )}
      {state.status === 'ready' && state.results.length > 0 && (
        <ul className="dp-grid">
          {state.results.map((p) => (
            <li key={p.key} className="dp-card">
              <a className="dp-main" {...linkProps(`/investors/people/${p.slug}`)}>
                <MemberAvatar name={p.name} size="lg" />
                <span className="dp-text">
                  <span className="dp-name">{p.name}</span>
                  <span className="dp-sub">{[p.title, p.organisation?.name].filter(Boolean).join(' at ')}</span>
                  <span className="dp-open">Directory listing</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
