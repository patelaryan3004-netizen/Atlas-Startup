// Whether an address opens the map, so main.jsx asks for the map's file (Leaflet and the pins' code, the biggest piece) beside the app's own.
// The jobs board, the investors, the news, the people, a list of companies and ?view=list (the list of startups) are pages without a map: an
// address for one of them never downloads it, and it is fetched if the visitor goes there. Any other address (the map itself, a company's
// panel over the map, a form over the map) opens the map. The landing page (/welcome) is not the app and has none of this.
const OTHER_PAGES = /^\/(jobs|investors|news|lists|people|about|methodology|contact)(\/|$)/;
const OTHER_VIEWS = new Set(['list', 'jobs', 'lists', 'investors']);

export function opensOnMap(pathname, search = '') {
  const path = pathname.replace(/\/$/, '');
  if (OTHER_PAGES.test(path)) return false;
  const view = new URLSearchParams(search).get('view');
  return !OTHER_VIEWS.has(view);
}
