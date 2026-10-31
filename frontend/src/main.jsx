import React from 'react';
import ReactDOM from 'react-dom/client';
import { lazyView, Lazy } from './lazyLoad.jsx';
import { OLD_WELCOME_PATH, INFO_PATHS } from './paths.js';
import { opensWelcome } from './appRoute.js';
import { opensOnMap } from './mapPrefetch.js';
import { loadSnapshot } from './snapshot.js';
import '@fontsource-variable/inter'; // the sans, served with the site (it was a stylesheet from Google that every page waited for)
import '@fontsource/instrument-serif/latin-400.css'; // the serif of the big headings, regular and italic (the italic word in "Find your people.")
import '@fontsource/instrument-serif/latin-400-italic.css';
import './styles.css';
import './brand.css'; // the shared components (the header, the buttons, the switches, the rows), after the tokens they read
import './network.css'; // the community's pages and the header's account menu and phone bar, after the parts they are made of

// The page that is asked for is the only one fetched: the landing page does not carry the app, the plain pages (About, How we verify,
// Contact) carry neither, and the app does not carry them. What the app itself shows is split the same way (App.jsx).
const loadApp = () => import('./App.jsx');
const loadLanding = () => import('./LandingPage.jsx');
const loadInfo = () => import('./InfoPage.jsx');
const App = lazyView(loadApp);
const LandingPage = lazyView(loadLanding);
const InfoPage = lazyView(loadInfo);

// The snapshot of the first views is already downloading (index.html) on the pages that draw from it: pick it up now, so it is read by the
// time the page first draws (snapshot.js, peek.js).
if (window.__auSnapshot) loadSnapshot();

// The welcome page is the homepage now. Its old address is sent to it by the host (a permanent redirect, vercel.json); this does the same where the site runs
// without the host's rules, keeping the query and the anchor.
if (window.location.pathname.replace(/\/$/, '') === OLD_WELCOME_PATH) {
  try { window.history.replaceState(null, '', `/${window.location.search}${window.location.hash}`); } catch (e) { /* the page still opens */ }
}
const path = window.location.pathname.replace(/\/$/, '');
const isLanding = opensWelcome();
const infoPage = INFO_PATHS[path];

// The map is what the app opens on, and it is the biggest piece (Leaflet and Supercluster): ask for it beside the app's own file instead
// of after it, but only when the address opens the map (mapPrefetch.js); an address for another page never downloads it.
if (!isLanding && !infoPage && opensOnMap(path, window.location.search)) import('./components/MapView.jsx').catch(() => {});

const root = document.getElementById('root');
const tree = (
  <React.StrictMode>
    <Lazy>{isLanding ? <LandingPage /> : infoPage ? <InfoPage page={infoPage} /> : <App />}</Lazy>
  </React.StrictMode>
);

// A page the build drew as HTML (scripts/prerender.mjs) is hydrated, so the text that was already on screen is kept and made live. That needs
// the first render to come out exactly as the HTML did: the plain pages and the welcome page have nothing that differs (the welcome page reads nothing from
// the server on load). A page of the app (or any other) is drawn over the plain version the HTML carries for search engines, which a visitor with scripts never sees.
//
// Hydrating takes the main thread for a good while, and the page's scripts arrive before the browser has painted the HTML: left to itself the
// browser would not paint until it was done. So hydration waits for the first paint of the HTML (a frame, or a short wait if the tab is in
// the background and draws no frames).
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const afterFirstPaint = () => Promise.race([new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))), sleep(300)]);

async function start() {
  if (root.dataset.prerender === 'info') { await afterFirstPaint(); ReactDOM.hydrateRoot(root, tree); return; }
  // The HTML at the root is the welcome page: it is hydrated for the welcome page, and drawn over for an older link to / that opens the app.
  if (root.dataset.prerender === 'landing' && isLanding) { loadLanding(); await afterFirstPaint(); ReactDOM.hydrateRoot(root, tree); return; }
  ReactDOM.createRoot(root).render(tree);
}
start();
