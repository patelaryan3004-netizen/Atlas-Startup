import React from 'react';
import { renderToString } from 'react-dom/server';
import { Lazy } from './lazyLoad.jsx';
import LandingPage from './LandingPage.jsx';
import InfoPage from './InfoPage.jsx';
import { MapShell, ListsShell, InvestorsShell } from './staticShells.jsx';
import { primeSnapshot } from './snapshot.js';
import { setPrerenderClock } from './clock.js';
import { PAGE_META } from './siteMeta.js';

// The pages that ship real HTML (scripts/prerender.mjs writes them at build; this file only draws them). Two kinds:
//   hydrate  the page is the same one the browser draws (/welcome, About, How we verify, Contact): its HTML is what the browser's first render
//            makes, so the browser hydrates it (main.jsx) instead of drawing it again;
//   shell    a page the app draws itself (the map, the curated lists, the investors): the HTML is a plain version of its content for search
//            engines, link previews and visitors with no scripts, and the app draws over it (a visitor with scripts never sees it).
// /people has none: with VITE_SHOW_PEOPLE off (as it is live) there is no such page, and its content is not in any file the build has.
export const ROUTES = [
  { path: '/', file: 'index.html', shell: 'map', json: 'WebSite' },
  { path: '/welcome', file: 'welcome/index.html', hydrate: 'landing', json: 'WebSite' },
  { path: '/lists', file: 'lists/index.html', shell: 'lists' },
  { path: '/investors', file: 'investors/index.html', shell: 'investors' },
  { path: '/methodology', file: 'methodology/index.html', hydrate: 'info', page: 'methodology' },
  { path: '/about', file: 'about/index.html', hydrate: 'info', page: 'about' },
  { path: '/contact', file: 'contact/index.html', hydrate: 'info', page: 'contact' },
].map((route) => ({ ...route, meta: PAGE_META[route.path] }));

// The same page for every address the app draws that has no HTML of its own (a company, the jobs board, the news): app.html.
export const GENERIC_SHELL = 'map';

// { html, attributes }: the markup that goes inside <div id="root"> and the attributes that go on it. `data` is { snapshot, prerenderData }.
export function renderRoute(route, data = {}) {
  const wrap = (page) => <React.StrictMode><Lazy>{page}</Lazy></React.StrictMode>;
  if (route.hydrate === 'landing') {
    const snapshot = primeSnapshot(data.snapshot);
    // The landing page reads its figures from the snapshot, so a build with none (too old to use) makes a page with none; main.jsx hydrates
    // only a page made from the snapshot it has itself, and draws the page afresh otherwise.
    setPrerenderClock(snapshot ? Date.parse(snapshot.generatedAt) : null);
    try {
      return { html: renderToString(wrap(<LandingPage />)), attributes: { 'data-prerender': 'landing', ...(snapshot ? { 'data-snapshot': snapshot.generatedAt } : {}) } };
    } finally {
      setPrerenderClock(null);
    }
  }
  if (route.hydrate === 'info') return { html: renderToString(wrap(<InfoPage page={route.page} />)), attributes: { 'data-prerender': 'info' } };
  const answers = data.prerenderData?.answers ?? {};
  const counts = Object.entries(answers).find(([key]) => key.startsWith('/api/startups/counts'))?.[1]?.counts;
  const investors = Object.entries(answers).find(([key]) => key.startsWith('/api/investors'))?.[1];
  const shell = { map: <MapShell />, lists: <ListsShell counts={counts} />, investors: <InvestorsShell investors={investors} /> }[route.shell ?? GENERIC_SHELL];
  return { html: renderToString(shell), attributes: { 'data-prerender': 'shell' } };
}
