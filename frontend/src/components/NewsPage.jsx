import { useCallback, useEffect, useState } from 'react';
import { fetchNews } from '../api.js';
import { usePageMeta } from '../hooks/usePageMeta.js';
import SiteHeader from './brand/SiteHeader.jsx';
import '../investors.css';

const SOURCE_WORDS = {
  live: 'Fresh from the feed',
  cache: 'From the last read of the feed (kept for six hours)',
  seeded: 'From a short list kept with the site: the live feed could not be read',
};

// The news the ticker shows, as a page of its own at /news: recent funding rounds, acquisitions and ecosystem headlines. Each one
// links to the publisher's own page, and says who published it and when. Nothing here is written by this site.
export default function NewsPage({ chrome = {} }) {
  const [state, setState] = useState({ status: 'loading', deals: [], source: null });
  const [refreshing, setRefreshing] = useState(false);
  usePageMeta({
    title: 'Australian startup news · Still Early',
    description: 'Recent funding rounds, acquisitions and ecosystem news about Australian startups, each linked to the publisher.',
    path: '/news',
  });

  const load = useCallback((force = false) => {
    if (force) setRefreshing(true);
    return fetchNews(force)
      .then(({ source, deals }) => setState({ status: 'ready', deals: deals ?? [], source }))
      .catch(() => setState((s) => ({ ...s, status: s.deals.length ? 'ready' : 'error' })))
      .finally(() => setRefreshing(false));
  }, []);
  useEffect(() => { load(false); }, [load]);

  return (
    <div id="investorsView" className="news-page">
      <SiteHeader go={chrome.go} counts={chrome.counts} menu={chrome.menu} />
      <main className="inv-main" id="news-main">
        <section className="inv-intro" aria-labelledby="news-title">
          <h1 id="news-title">Australian startup news</h1>
          <p className="inv-lead">Recent funding rounds, acquisitions and ecosystem news, each linked to the page that published it.</p>
        </section>

        <div className="news-bar">
          <p className="inv-count" role="status">
            {state.status === 'ready' && (SOURCE_WORDS[state.source] ?? state.source)}
            {state.status === 'loading' && 'Loading…'}
          </p>
          <button type="button" className="hdrbtn" onClick={() => load(true)} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Get the latest'}</button>
        </div>

        {state.status === 'error' && (
          <div className="inv-error" role="alert">
            <p>Could not load the news right now.</p>
            <button type="button" className="hdrbtn" onClick={() => load(true)}>Try again</button>
          </div>
        )}
        {state.status === 'ready' && state.deals.length === 0 && <p className="inv-none">No headlines right now.</p>}
        <ul className="news-list">
          {state.deals.map((d) => (
            <li key={d.url} className="news-item">
              <a className="news-link" href={d.url} target="_blank" rel="noopener noreferrer">
                <span className="news-headline">{d.headline}</span>
                <span className="news-meta">{d.meta}<span className="sr-only"> (opens in a new tab)</span></span>
              </a>
            </li>
          ))}
        </ul>
        <p className="inv-method">Headlines come from a public news feed and from a short list kept with the site: they are links to other people&rsquo;s writing, not claims this site makes.</p>
      </main>
    </div>
  );
}
