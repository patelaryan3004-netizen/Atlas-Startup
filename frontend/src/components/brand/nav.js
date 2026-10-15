import { MAP_PATH } from '../../paths.js';

// The places the site has, in the order the header names them. Each is a real link (so it opens in a new tab and a search engine can follow it);
// a page that is the app passes a handler for it and the link then moves inside the app without loading it again. Saved is what the visitor starred
// (kept in this browser), opened over whatever page the app is on, so its address asks the app to open it.
export const NAV = [
  { id: 'explore', label: 'Explore', href: MAP_PATH },
  { id: 'collections', label: 'Collections', href: '/lists' },
  { id: 'investors', label: 'Investors', href: '/investors' },
  { id: 'jobs', label: 'Jobs', href: '/jobs' },
  { id: 'saved', label: 'Saved', href: '/?view=saved' },
];
export const ADD_HREF = '/?view=submit';

// A plain click, not one that means "open it somewhere else" (a new tab, a new window, a download): only that is taken over by the app.
export const isPlainClick = (event) => !(event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
