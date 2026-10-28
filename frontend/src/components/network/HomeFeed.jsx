import { useCallback, useEffect, useRef, useState } from 'react';
import SiteHeader from '../brand/SiteHeader.jsx';
import { Segmented, EmptyState } from '../brand/parts.jsx';
import { fetchFeed } from '../../networkApi.js';
import { ensureStatus, useSession } from '../../session.js';
import { usePageMeta } from '../../hooks/usePageMeta.js';
import Composer from './Composer.jsx';
import PostCard from './PostCard.jsx';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'ideas', label: 'Ideas' },
  { id: 'building', label: 'Building' },
  { id: 'questions', label: 'Questions' },
];
const PAGE = 20;
const EMPTY_WORDS = {
  all: ['Nothing has been shared yet.', 'Be the first: share an idea, ask a question, or show what you are building.'],
  ideas: ['No ideas here yet.', 'Have one? Share it: a short idea is plenty.'],
  building: ['Nobody has shared what they are building yet.', 'Show something you are working on, ask for feedback, or share a small win.'],
  questions: ['No questions yet.', 'Ask the one you have been wondering about.'],
};

// Home: the community. One feed of short, text-first posts (ideas, questions, things people are building, requests for feedback, small wins), filtered four ways.
// Everything on it was written by a signed-in person and is kept on the server; where the server cannot keep things it says so and shows none.
export default function HomeFeed({ chrome = {} }) {
  const { member, open, reason: closedBecause } = useSession();
  const [filter, setFilter] = useState('all');
  const [posts, setPosts] = useState([]);
  const [next, setNext] = useState(null);
  const [status, setStatus] = useState('loading'); // loading, ready, error, closed
  const [error, setError] = useState('');
  const [more, setMore] = useState(false);
  const generation = useRef(0);

  usePageMeta({ title: 'Home · Still Early', description: 'Ideas, questions and things Australian founders and builders are working on.', path: '/home' });
  useEffect(() => { ensureStatus(); }, []);

  const load = useCallback(() => {
    if (open === false) { setStatus('closed'); return undefined; }
    if (open === null) return undefined;
    const ctrl = new AbortController();
    generation.current += 1;
    setStatus('loading');
    fetchFeed({ filter, limit: PAGE }, { signal: ctrl.signal })
      .then((res) => { if (!ctrl.signal.aborted) { setPosts(res.results); setNext(res.hasMore ? res.next : null); setStatus('ready'); } })
      .catch((err) => {
        if (ctrl.signal.aborted || err.name === 'AbortError') return;
        if (err.code === 'network_unavailable') setStatus('closed'); else { setError(err.message); setStatus('error'); }
      });
    return () => ctrl.abort();
    // The feed reads differently for someone signed in (their likes, their own hidden posts), so it is asked again when they sign in or out.
  }, [filter, open, member?.id]);

  useEffect(() => load(), [load]);

  const loadMore = async () => {
    setMore(true);
    try {
      const res = await fetchFeed({ filter, limit: PAGE, before: next });
      setPosts((p) => [...p, ...res.results]);
      setNext(res.hasMore ? res.next : null);
    } catch (err) { setError(err.message); } finally { setMore(false); }
  };

  const [kind, words] = [filter, EMPTY_WORDS[filter]];

  return (
    <div id="homeView" className="page-shell">
      <SiteHeader active="home" go={chrome.go} counts={chrome.counts} menu={chrome.menu} />
      <main className="home" id="main">
        <header className="home-head">
          <p className="kicker">Home</p>
          <h1 className="serif-h1">What are you <em>working on?</em></h1>
          <p className="lede">A small, text-first space for Australia&rsquo;s founders and builders: ideas, questions, and things people are making.</p>
        </header>

        {status === 'closed' ? (
          <EmptyState title="The community is not open yet.">
            {closedBecause || 'It needs a place to keep what people write, and this server does not have one yet.'} Startups, investors, jobs and events are all open under Discover and Opportunities.
          </EmptyState>
        ) : (
          <>
            <Composer onPosted={(post) => { if (filter === 'all' || ({ ideas: ['idea'], building: ['building', 'feedback', 'win'], questions: ['question'] }[filter] ?? []).includes(post.topic)) setPosts((p) => [post, ...p]); }} />

            <div className="home-filters">
              <Segmented label="Show" options={FILTERS} value={filter} onChange={setFilter} className="home-seg" />
            </div>

            {status === 'loading' && <p className="home-quiet" role="status">Loading the feed…</p>}
            {status === 'error' && (
              <div className="home-error" role="alert">
                <p>Could not load the feed. {error}</p>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => load()}>Try again</button>
              </div>
            )}
            {status === 'ready' && posts.length === 0 && <EmptyState title={words[0]}>{words[1]}</EmptyState>}
            {status === 'ready' && posts.length > 0 && (
              <ul className="home-feed" aria-label={`${FILTERS.find((f) => f.id === kind).label} posts`}>
                {posts.map((post) => (
                  <li key={post.id}><PostCard post={post} onRemoved={(id) => setPosts((p) => p.filter((x) => x.id !== id))} /></li>
                ))}
              </ul>
            )}
            {status === 'ready' && next && (
              <div className="home-more"><button type="button" className="btn btn-secondary" onClick={loadMore} disabled={more}>{more ? 'Loading…' : 'Show older posts'}</button></div>
            )}
          </>
        )}

        <p className="home-fine">Posts are public and written by members. Nobody here is vetted or endorsed by Still Early, and being a member does not promise an introduction or an interview.</p>
      </main>
    </div>
  );
}
