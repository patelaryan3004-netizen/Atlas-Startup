// The two addresses the brand goes to, in one place so a page cannot name them differently.
//   HOME_PATH  the landing page: what the site is, and the way in. main.jsx shows it (and only it) at this address.
//   MAP_PATH   the map: the app, which opens on the map.
export const HOME_PATH = '/welcome';
export const MAP_PATH = '/';

// The plain pages that are not the app (InfoPage.jsx): address -> page. Each is drawn as HTML at build (scripts/prerender.mjs) and hydrated.
export const INFO_PATHS = { '/about': 'about', '/methodology': 'methodology', '/contact': 'contact' };
