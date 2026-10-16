import React from 'react';
import { renderToString } from 'react-dom/server';
import { Lazy } from './lazyLoad.jsx';
import LandingPage from './LandingPage.jsx';
import InfoPage from './InfoPage.jsx';
import { MapShell, ListsShell, InvestorsShell } from './staticShells.jsx';
import { PAGE_META } from './siteMeta.js';

// The pages that ship real HTML (scripts/prerender.mjs writes them at build; this file only draws them). Two kinds:
//   hydrate  the page is the same one the browser draws (/welcome, About, How we verify, Contact): its HTML is what the browser's first render
//            makes, so the browser hydrates it (main.jsx) instead of drawing it again;
//   shell    a page the app draws itself (the map, the curated lists, the investors): the HTML is a plain version of its content for search
//            engines, link previews and visitors with no scripts, and the app draws over it (a visitor with scripts never sees it).
// /people has none: with VITE_SHOW_PEOPLE off (as it is live) there is no such page, and its content is not in any file the build has.
export const ROUTES = [
  { path: '/', file: 'index.html', shell: 'map', json: 'WebSite' },
  { path: '/welcome', file: 'welcome/index.html', hydrate: 'landing', json: 'WebSite', preload: [['/img/hero-night.webp', '(min-width: 701px)'], ['/img/hero-night-sm.webp', '(max-width: 700px)']], fonts: ['instrument-serif-latin-400-normal', 'instrument-serif-latin-400-italic'] },
  { path: '/lists', file: 'lists/index.html', shell: 'lists' },
  { path: '/investors', file: 'investors/index.html', shell: 'investors' },
  { path: '/methodology', file: 'methodology/index.html', hydrate: 'info', page: 'methodology' },
  { path: '/about', file: 'about/index.html', hydrate: 'info', page: 'about' },
  { path: '/contact', file: 'contact/index.html', hydrate: 'info', page: 'contact' },
].map((route) => ({ ...route, meta: PAGE_META[route.path] }));

// The same page for every address the app draws that has no HTML of its own (a company, the jobs board, the news): app.html.
export const GENERIC_SHELL = 'map';

// { html, attributes }: the markup that goes inside <div id="root"> and the attributes that go on it. `data` is { prerenderData }.
export function renderRoute(route, data = {}) {
  const wrap = (page) => <React.StrictMode><Lazy>{page}</Lazy></React.StrictMode>;
  // The welcome page reads nothing from the server on load, so the HTML is the same whatever the data: the browser hydrates it as it is (main.jsx).
  if (route.hydrate === 'landing') return { html: renderToString(wrap(<LandingPage />)), attributes: { 'data-prerender': 'landing' } };
  if (route.hydrate === 'info') return { html: renderToString(wrap(<InfoPage page={route.page} />)), attributes: { 'data-prerender': 'info' } };
  const answers = data.prerenderData?.answers ?? {};
  const counts = Object.entries(answers).find(([key]) => key.startsWith('/api/startups/counts'))?.[1]?.counts;
  const investors = Object.entries(answers).find(([key]) => key.startsWith('/api/investors'))?.[1];
  const shell = { map: <MapShell />, lists: <ListsShell counts={counts} />, investors: <InvestorsShell investors={investors} /> }[route.shell ?? GENERIC_SHELL];
  return { html: renderToString(shell), attributes: { 'data-prerender': 'shell' } };
}
