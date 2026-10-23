// Where the investor pages are in the address bar, so an investor or a person can be linked to, opened in a new tab and
// come back to with the back button:
//   /investors                       the directory
//   /investors/<slug>                the directory with one investor open beside the results (a full-screen drawer on a phone)
//   /investors/<slug>/profile        that investor's own full page
//   /investors/people/<slug>         the directory with one person who invests open beside the results (a full-screen drawer on a phone)
//   /investors/people/<slug>/profile that person's own full page
// ("people" is the one word an investor's own address cannot be.) The first version of these pages lived at
// ?view=investors[&investor=<slug>|&investorPerson=<slug>]: those addresses still open the same pages, and the address bar is
// then written in the new form. Anything else in the query (a filter the map was opened with) is left as it was.

const HOME = '/investors';
const PEOPLE = 'people';
const FULL = 'profile';
const LEGACY_KEYS = ['view', 'investor', 'investorPerson'];

const decode = (part) => { try { return decodeURIComponent(part); } catch (e) { return part; } };

// `where` is { pathname, search }, the shape of window.location.
export function readRoute({ pathname = window.location.pathname, search = window.location.search } = {}) {
  const [first, second, third, fourth] = pathname.split('/').filter(Boolean).map(decode);
  if (first === 'investors') {
    if (second === PEOPLE) return third ? { kind: third && fourth === FULL ? 'personProfile' : 'person', slug: third } : { kind: 'list' };
    if (second && third === FULL) return { kind: 'profile', slug: second };
    return second ? { kind: 'investor', slug: second } : { kind: 'list' };
  }
  const params = new URLSearchParams(search);
  if (params.get('view') !== 'investors') return null;
  if (params.get('investor')) return { kind: 'investor', slug: params.get('investor') };
  if (params.get('investorPerson')) return { kind: 'person', slug: params.get('investorPerson') };
  return { kind: 'list' };
}

const pathOf = (route) => {
  if (route.kind === 'investor') return `${HOME}/${encodeURIComponent(route.slug)}`;
  if (route.kind === 'profile') return `${HOME}/${encodeURIComponent(route.slug)}/${FULL}`;
  if (route.kind === 'person') return `${HOME}/${PEOPLE}/${encodeURIComponent(route.slug)}`;
  if (route.kind === 'personProfile') return `${HOME}/${PEOPLE}/${encodeURIComponent(route.slug)}/${FULL}`;
  return HOME;
};

// What is left of the query once the old investor keys are taken out.
function restOf(search) {
  const params = new URLSearchParams(search);
  for (const key of LEGACY_KEYS) params.delete(key);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

export function routeUrl(route, { search = window.location.search } = {}) {
  return `${pathOf(route)}${restOf(search)}`;
}

// A link to an investor or a person that is a real address.
export const investorHref = (slug) => routeUrl({ kind: 'investor', slug });
export const personHref = (slug) => routeUrl({ kind: 'person', slug });
export const profileHref = (slug) => routeUrl({ kind: 'profile', slug });
export const personProfileHref = (slug) => routeUrl({ kind: 'personProfile', slug });

function put(url, replace, state = null) {
  try {
    if (replace) window.history.replaceState(state, '', url);
    else window.history.pushState(state, '', url);
  } catch (e) { /* a locked-down browser: the page still moves */ }
}

// `state` is kept with the step in the history: the directory marks the step that opened an investor's panel, so closing the panel can go Back
// (and the next Back leaves the directory) instead of adding a step of its own.
export function writeRoute(route, { replace = false, state = null } = {}) {
  const url = routeUrl(route);
  if (url === `${window.location.pathname}${window.location.search}`) return; // already there: nothing to add
  put(url, replace, state);
}

// Leaves the investor pages: the map is at the root again, with whatever else the address said.
export function clearRoute() {
  put(`/${restOf(window.location.search)}`, true);
}
