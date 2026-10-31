// The addresses the brand goes to, in one place so a page cannot name them differently.
//   HOME_PATH  the homepage: the welcome page, what the site is and the way in. main.jsx shows it (and only it) at this address; /welcome, where it used to be,
//              is sent here (vercel.json, and main.jsx when the site runs without the host's redirects).
//   MAP_PATH   the map: the app's dedicated map page, a large street map with a logo for every company.
export const HOME_PATH = '/';
export const MAP_PATH = '/map';

// The old address of the welcome page: it is now the homepage.
export const OLD_WELCOME_PATH = '/welcome';

// The plain pages that are not the app (InfoPage.jsx): address -> page. Each is drawn as HTML at build (scripts/prerender.mjs) and hydrated.
export const INFO_PATHS = { '/about': 'about', '/methodology': 'methodology', '/contact': 'contact' };
