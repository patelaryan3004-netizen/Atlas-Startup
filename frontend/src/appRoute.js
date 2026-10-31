import { readRoute as readInvestorsRoute } from './components/investors/route.js';
import { showPeople } from './flags.js';

// The addresses of the app's pages, so every page can be linked to, opened in a new tab and come back to with the back button:
//   /                        the welcome page (the homepage): not the app, main.jsx shows it. An older link to / with filters or a view in its query still opens the app
//   /home                    Home: the community feed
//   /map                     the map: a large street map of every company (the filters in the query, as on Discover)
//   /discover                Discover, Startups: the list of startups (with ?view=map, the map), the filters in the query: /discover?sector=AI&city=Sydney
//   /discover/people         Discover, People: members who chose to be listed, and people named on public pages
//   /investors...            Discover, Investors (components/investors/route.js)
//   /startup/<slug>          one company, open over whichever view the filters describe
//   /jobs, /events           Opportunities: roles read from companies' own pages, and upcoming events
//   /me, /members/<id>       your profile, and a member's
//   /saved                   what you saved
//   /moderation              the moderators' page (not linked from anywhere)
//   /lists, /lists/<slug>    the curated lists, and one list opened as a list of companies
//   /people                  the people and firms worth following (switched off unless the site says otherwise)
//   /news                    the news feed
// The first versions kept the page in the query and put the map at /: /?sector=AI&city=Sydney, ?view=jobs and ?view=lists still open the same pages (a bare
// / is Home now).

const decode = (part) => { try { return decodeURIComponent(part); } catch (e) { return part; } };

// What at / means "the startups" and not Home: any of the filters, the view or what is shown.
const EXPLORE_KEYS = ['search', 'sector', 'city', 'investor', 'stage', 'hiring', 'taskGate', 'events', 'precision', 'state', 'remote', 'tech', 'team', 'cohort', 'fresh', 'view', 'show'];

export function readAppRoute({ pathname = window.location.pathname, search = window.location.search } = {}) {
  if (readInvestorsRoute({ pathname, search })) return { kind: 'investors' };
  const [first, second] = pathname.split('/').filter(Boolean).map(decode);
  if (first === 'startup' && second) return { kind: 'startup', slug: second };
  if (first === 'jobs' || first === 'opportunities') return { kind: 'jobs' };
  if (first === 'events') return { kind: 'events' };
  if (first === 'home') return { kind: 'home' };
  if (first === 'map') return { kind: 'map' };
  if (first === 'discover') return second === 'people' ? { kind: 'discoverPeople' } : { kind: 'explore' };
  if (first === 'me') return { kind: 'me' };
  if (first === 'saved') return { kind: 'saved' };
  if (first === 'moderation') return { kind: 'moderation' };
  if (first === 'members' && second) return { kind: 'member', slug: second };
  if (first === 'lists') return second ? { kind: 'list', slug: second } : { kind: 'lists' };
  if (first === 'news') return { kind: 'news' };
  if (first === 'people' && showPeople()) return { kind: 'people' }; // with the people switched off there is no such page: Discover opens instead
  if (!first) {
    const params = new URLSearchParams(search);
    const view = params.get('view');
    if (view === 'jobs') return { kind: 'jobs' };
    if (view === 'lists') return { kind: 'lists' };
    if (view === 'saved') return { kind: 'saved' };
    if (EXPLORE_KEYS.some((key) => params.get(key))) return { kind: 'explore' }; // an older link to the map, with its filters
    return { kind: 'home' };
  }
  return { kind: 'explore' };
}

// Whether the address is the welcome page: the root with none of the older query words that opened the app there (a filter, a view). main.jsx and the
// first-load script in index.html (which repeats these words) both ask.
export function opensWelcome({ pathname = window.location.pathname, search = window.location.search } = {}) {
  const path = pathname.replace(/\/$/, '');
  if (path !== '') return false;
  const params = new URLSearchParams(search);
  return !params.get('view') && !EXPLORE_KEYS.some((key) => params.get(key));
}

export function appPath(route) {
  switch (route.kind) {
    case 'startup': return `/startup/${encodeURIComponent(route.slug)}`;
    case 'home': return '/home';
    case 'map': return '/map';
    case 'discoverPeople': return '/discover/people';
    case 'jobs': return '/jobs';
    case 'events': return '/events';
    case 'me': return '/me';
    case 'saved': return '/saved';
    case 'moderation': return '/moderation';
    case 'member': return `/members/${encodeURIComponent(route.slug)}`;
    case 'lists': return '/lists';
    case 'list': return `/lists/${encodeURIComponent(route.slug)}`;
    case 'news': return '/news';
    case 'people': return '/people';
    default: return '/discover';
  }
}

// The query of the pages that show companies (the list, the map, one company over them): the filters that are on, the map when it is the view in use (the list
// is the start, so it needs no word), and what is shown when it is not both (show=startups or show=vcs). Nothing else: a page that is not one of those
// has no query.
export function exploreSearch(filters, viewMode, entity = 'all') {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  if (viewMode === 'map') params.set('view', 'map');
  if (entity === 'startups' || entity === 'vcs') params.set('show', entity);
  const query = params.toString();
  return query ? `?${query}` : '';
}

// The address a route is shown at. The pages that show companies carry the filters; a curated list carries none (the list is
// the filter); the others stand alone.
export function appUrl(route, { filters = {}, viewMode = 'list', entity = 'all' } = {}) {
  const path = appPath(route);
  if (route.kind === 'map') return `${path}${exploreSearch(filters, 'list', entity)}`; // the map page is the map: its address needs no view word
  return route.kind === 'explore' || route.kind === 'startup' ? `${path}${exploreSearch(filters, viewMode, entity)}` : path;
}
