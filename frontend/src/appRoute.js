import { readRoute as readInvestorsRoute } from './components/investors/route.js';

// The addresses of the app's pages, so every page can be linked to, opened in a new tab and come back to with the back button:
//   /                        the map (or, with ?view=list, the list), with the filters in the query: /?sector=AI&city=Sydney
//   /startup/<slug>          one company, open over whichever view the filters describe
//   /jobs                    the companies hiring
//   /lists, /lists/<slug>    the curated lists, and one list opened as a list of companies
//   /news                    the news feed
//   /investors...            the investor pages (components/investors/route.js)
// The first versions kept the page in the query: ?view=jobs and ?view=lists still open the same pages.

const decode = (part) => { try { return decodeURIComponent(part); } catch (e) { return part; } };

export function readAppRoute({ pathname = window.location.pathname, search = window.location.search } = {}) {
  if (readInvestorsRoute({ pathname, search })) return { kind: 'investors' };
  const [first, second] = pathname.split('/').filter(Boolean).map(decode);
  if (first === 'startup' && second) return { kind: 'startup', slug: second };
  if (first === 'jobs') return { kind: 'jobs' };
  if (first === 'lists') return second ? { kind: 'list', slug: second } : { kind: 'lists' };
  if (first === 'news') return { kind: 'news' };
  if (!first) {
    const view = new URLSearchParams(search).get('view');
    if (view === 'jobs') return { kind: 'jobs' };
    if (view === 'lists') return { kind: 'lists' };
  }
  return { kind: 'explore' };
}

export function appPath(route) {
  switch (route.kind) {
    case 'startup': return `/startup/${encodeURIComponent(route.slug)}`;
    case 'jobs': return '/jobs';
    case 'lists': return '/lists';
    case 'list': return `/lists/${encodeURIComponent(route.slug)}`;
    case 'news': return '/news';
    default: return '/';
  }
}

// The query of the pages that show companies (the map, the list, one company over them): the filters that are on, and the list
// view when it is the one in use. Nothing else: a page that is not one of those has no query.
export function exploreSearch(filters, viewMode) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  if (viewMode === 'list') params.set('view', 'list');
  const query = params.toString();
  return query ? `?${query}` : '';
}

// The address a route is shown at. The pages that show companies carry the filters; a curated list carries none (the list is
// the filter); the others stand alone.
export function appUrl(route, { filters = {}, viewMode = 'map' } = {}) {
  const path = appPath(route);
  return route.kind === 'explore' || route.kind === 'startup' ? `${path}${exploreSearch(filters, viewMode)}` : path;
}
