import React from 'react';
import ReactDOM from 'react-dom/client';
import { lazyView, Lazy } from './lazyLoad.jsx';
import { HOME_PATH } from './paths.js';
import { opensOnMap } from './mapPrefetch.js';
import { loadSnapshot } from './snapshot.js';
import '@fontsource-variable/inter'; // the one typeface, served with the site (it was a stylesheet from Google that every page waited for)
import './styles.css';

// The page that is asked for is the only one fetched: the landing page does not carry the app, and the app does not carry the
// landing page. What the app itself shows is split the same way (App.jsx).
const loadApp = () => import('./App.jsx');
const loadLanding = () => import('./LandingPage.jsx');
const App = lazyView(loadApp);
const LandingPage = lazyView(loadLanding);

// The snapshot of the first views is already downloading (index.html) on the pages that draw from it: pick it up now, so it is read by the
// time the page first draws (snapshot.js, peek.js).
if (window.__auSnapshot) loadSnapshot();

const path = window.location.pathname.replace(/\/$/, '');
const isLanding = path === HOME_PATH;

// The map is what the app opens on, and it is the biggest piece (Leaflet and Supercluster): ask for it beside the app's own file instead
// of after it, but only when the address opens the map (mapPrefetch.js); an address for another page never downloads it.
if (!isLanding && opensOnMap(path, window.location.search)) import('./components/MapView.jsx').catch(() => {});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Lazy>{isLanding ? <LandingPage /> : <App />}</Lazy>
  </React.StrictMode>
);
