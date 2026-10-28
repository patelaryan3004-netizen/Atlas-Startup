import { describe, it, expect } from 'vitest';
import { readAppRoute, appPath, appUrl, exploreSearch } from '../src/appRoute.js';

const at = (pathname, search = '') => ({ pathname, search });

describe('the address of each page', () => {
  it('reads the page from the address', () => {
    expect(readAppRoute(at('/'))).toEqual({ kind: 'home' });
    expect(readAppRoute(at('/home'))).toEqual({ kind: 'home' });
    expect(readAppRoute(at('/discover'))).toEqual({ kind: 'explore' });
    expect(readAppRoute(at('/discover/startups'))).toEqual({ kind: 'explore' });
    expect(readAppRoute(at('/discover/people'))).toEqual({ kind: 'discoverPeople' });
    expect(readAppRoute(at('/startup/canva'))).toEqual({ kind: 'startup', slug: 'canva' });
    expect(readAppRoute(at('/jobs'))).toEqual({ kind: 'jobs' });
    expect(readAppRoute(at('/opportunities'))).toEqual({ kind: 'jobs' });
    expect(readAppRoute(at('/events'))).toEqual({ kind: 'events' });
    expect(readAppRoute(at('/me'))).toEqual({ kind: 'me' });
    expect(readAppRoute(at('/saved'))).toEqual({ kind: 'saved' });
    expect(readAppRoute(at('/moderation'))).toEqual({ kind: 'moderation' });
    expect(readAppRoute(at('/members/m_abc123'))).toEqual({ kind: 'member', slug: 'm_abc123' });
    expect(readAppRoute(at('/lists'))).toEqual({ kind: 'lists' });
    expect(readAppRoute(at('/lists/au-ai'))).toEqual({ kind: 'list', slug: 'au-ai' });
    expect(readAppRoute(at('/news'))).toEqual({ kind: 'news' });
    expect(readAppRoute(at('/people'))).toEqual({ kind: 'people' });
    expect(readAppRoute(at('/people', '?tab=operators&list=picks'))).toEqual({ kind: 'people' }); // the page reads its own tab, list and word
    expect(readAppRoute(at('/investors'))).toEqual({ kind: 'investors' });
    expect(readAppRoute(at('/investors/blackbird'))).toEqual({ kind: 'investors' });
  });

  it('ignores a trailing slash and reads an escaped slug', () => {
    expect(readAppRoute(at('/jobs/'))).toEqual({ kind: 'jobs' });
    expect(readAppRoute(at('/startup/a%20b'))).toEqual({ kind: 'startup', slug: 'a b' });
    expect(readAppRoute(at('/startup/%E0%A4%A'))).toEqual({ kind: 'startup', slug: '%E0%A4%A' });
  });

  it('opens Discover for an address that is not a page, and for /startup with no company', () => {
    expect(readAppRoute(at('/nonsense'))).toEqual({ kind: 'explore' });
    expect(readAppRoute(at('/startup'))).toEqual({ kind: 'explore' });
    expect(readAppRoute(at('/welcome'))).toEqual({ kind: 'explore' });
    expect(readAppRoute(at('/members'))).toEqual({ kind: 'explore' }); // a member needs an id
  });

  it('still reads the first versions\' addresses: the map was at / and the page was in ?view=', () => {
    expect(readAppRoute(at('/', '?view=jobs'))).toEqual({ kind: 'jobs' });
    expect(readAppRoute(at('/', '?view=lists'))).toEqual({ kind: 'lists' });
    expect(readAppRoute(at('/', '?view=saved'))).toEqual({ kind: 'saved' });
    expect(readAppRoute(at('/', '?view=investors&investor=blackbird'))).toEqual({ kind: 'investors' });
    expect(readAppRoute(at('/', '?view=list&sector=AI'))).toEqual({ kind: 'explore' });
    expect(readAppRoute(at('/', '?sector=AI&city=Sydney'))).toEqual({ kind: 'explore' }); // an old link to the map with its filters
    expect(readAppRoute(at('/', '?show=vcs'))).toEqual({ kind: 'explore' });
    expect(readAppRoute(at('/', '?view=submit'))).toEqual({ kind: 'explore' }); // the form opens over Discover
    expect(readAppRoute(at('/', '?utm_source=newsletter'))).toEqual({ kind: 'home' }); // a bare / with a tracking word is still Home
    expect(readAppRoute(at('/jobs', '?view=lists'))).toEqual({ kind: 'jobs' }); // the path wins
  });

  it('writes the path of each page', () => {
    expect(appPath({ kind: 'home' })).toBe('/home');
    expect(appPath({ kind: 'explore' })).toBe('/discover');
    expect(appPath({ kind: 'discoverPeople' })).toBe('/discover/people');
    expect(appPath({ kind: 'startup', slug: 'canva' })).toBe('/startup/canva');
    expect(appPath({ kind: 'startup', slug: 'a b/c' })).toBe('/startup/a%20b%2Fc');
    expect(appPath({ kind: 'jobs' })).toBe('/jobs');
    expect(appPath({ kind: 'events' })).toBe('/events');
    expect(appPath({ kind: 'me' })).toBe('/me');
    expect(appPath({ kind: 'saved' })).toBe('/saved');
    expect(appPath({ kind: 'member', slug: 'm_abc' })).toBe('/members/m_abc');
    expect(appPath({ kind: 'moderation' })).toBe('/moderation');
    expect(appPath({ kind: 'lists' })).toBe('/lists');
    expect(appPath({ kind: 'list', slug: 'au-ai' })).toBe('/lists/au-ai');
    expect(appPath({ kind: 'news' })).toBe('/news');
  });

  it('writes the filters that are on, and the map when it is the view in use, and nothing else', () => {
    expect(exploreSearch({ search: '', sector: '', city: '' }, 'list')).toBe('');
    expect(exploreSearch({ search: '', sector: 'AI', city: 'Sydney' }, 'list')).toBe('?sector=AI&city=Sydney');
    expect(exploreSearch({ sector: 'AI,Fintech' }, 'map')).toBe('?sector=AI%2CFintech&view=map');
    expect(exploreSearch({}, 'map')).toBe('?view=map');
    expect(exploreSearch({}, 'list', 'vcs')).toBe('?show=vcs');
  });

  it('puts the filters on the pages that show companies, and on no other', () => {
    const ui = { filters: { sector: 'AI' }, viewMode: 'map' };
    expect(appUrl({ kind: 'explore' }, ui)).toBe('/discover?sector=AI&view=map');
    expect(appUrl({ kind: 'startup', slug: 'canva' }, ui)).toBe('/startup/canva?sector=AI&view=map');
    expect(appUrl({ kind: 'jobs' }, ui)).toBe('/jobs');
    expect(appUrl({ kind: 'home' }, ui)).toBe('/home');
    expect(appUrl({ kind: 'list', slug: 'au-ai' }, ui)).toBe('/lists/au-ai');
    expect(appUrl({ kind: 'news' }, ui)).toBe('/news');
    expect(appUrl({ kind: 'explore' })).toBe('/discover'); // the list is where Discover starts: no word for it
  });

  it('writes an address that reads back as the same page', () => {
    const routes = [{ kind: 'home' }, { kind: 'explore' }, { kind: 'discoverPeople' }, { kind: 'startup', slug: 'canva' }, { kind: 'jobs' }, { kind: 'events' }, { kind: 'me' }, { kind: 'saved' }, { kind: 'member', slug: 'm_abc' }, { kind: 'moderation' }, { kind: 'lists' }, { kind: 'list', slug: 'au-ai' }, { kind: 'news' }];
    for (const route of routes) {
      const [pathname, query = ''] = appUrl(route, { filters: { sector: 'AI' } }).split('?');
      expect(readAppRoute(at(pathname, query ? `?${query}` : ''))).toEqual(route);
    }
  });
});
