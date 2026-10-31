// Whether an address opens the map, so main.jsx asks for the map's file (Leaflet and the pins' code, the biggest piece) beside the app's own.
// The map is one way to look at startups: an address that asks for it (?view=map, on Discover or on a company's panel) opens it, and so does the map page
// (/map), which is nothing else. Home,
// the list of startups, the jobs and events, the investors, the news, the people, a list of companies and every plain page are pages without a map: an address
// for one of them never downloads it, and it is fetched if the visitor goes there. The welcome page (/) is not the app and has none of this.
const MAP_PAGES = /^\/(discover|startup)(\/|$)/;

export function opensOnMap(pathname, search = '') {
  const path = pathname.replace(/\/$/, '') || '/';
  const asksForMap = new URLSearchParams(search).get('view') === 'map';
  if (path === '/map') return true;
  if (path === '/') return asksForMap;
  return MAP_PAGES.test(path) && asksForMap;
}
