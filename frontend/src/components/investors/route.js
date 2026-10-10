// Where the investor pages are in the address bar, so an investor or a person can be linked to, opened in a new tab and
// come back to with the back button:
//   /investors                       the directory
//   /investors/<slug>                one investor
//   /investors/people/<slug>         one person who invests
// ("people" is the one word an investor's own address cannot be.) The first version of these pages lived at
// ?view=investors[&investor=<slug>|&investorPerson=<slug>]: those addresses still open the same pages, and the address bar is
// then written in the new form. Anything else in the query (a filter the map was opened with) is left as it was.

const HOME = '/investors';
const PEOPLE = 'people';
const LEGACY_KEYS = ['view', 'investor', 'investorPerson'];

const decode = (part) => { try { return decodeURIComponent(part); } catch (e) { return part; } };

// `where` is { pathname, search }, the shape of window.location.
export function readRoute({ pathname = window.location.pathname, search = window.location.search } = {}) {
  const [first, second, third] = pathname.split('/').filter(Boolean).map(decode);
  if (first === 'investors') {
    if (second === PEOPLE) return third ? { kind: 'person', slug: third } : { kind: 'list' };
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
  if (route.kind === 'person') return `${HOME}/${PEOPLE}/${encodeURIComponent(route.slug)}`;
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

function put(url, replace) {
  try {
    if (replace) window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
  } catch (e) { /* a locked-down browser: the page still moves */ }
}

export function writeRoute(route, { replace = false } = {}) {
  const url = routeUrl(route);
  if (url === `${window.location.pathname}${window.location.search}`) return; // already there: nothing to add
  put(url, replace);
}

// Leaves the investor pages: the map is at the root again, with whatever else the address said.
export function clearRoute() {
  put(`/${restOf(window.location.search)}`, true);
}
