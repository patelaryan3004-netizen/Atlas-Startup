import React from 'react';
import ReactDOM from 'react-dom/client';
import { lazyView, Lazy } from './lazyLoad.jsx';
import { HOME_PATH } from './paths.js';
import './styles.css';

// The page that is asked for is the only one fetched: the landing page does not carry the app, and the app does not carry the
// landing page. What the app itself shows is split the same way (App.jsx).
const loadApp = () => import('./App.jsx');
const loadLanding = () => import('./LandingPage.jsx');
const App = lazyView(loadApp);
const LandingPage = lazyView(loadLanding);

const path = window.location.pathname.replace(/\/$/, '');
const isLanding = path === HOME_PATH;

// The map is what the app opens on, and it is the biggest piece (Leaflet): ask for it beside the app's own file instead of after it,
// unless the address opens another page.
const OTHER_PAGES = /^\/(jobs|investors|news|lists)(\/|$)/;
if (!isLanding && !OTHER_PAGES.test(path)) import('./components/MapView.jsx').catch(() => {});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Lazy>{isLanding ? <LandingPage /> : <App />}</Lazy>
  </React.StrictMode>
);
