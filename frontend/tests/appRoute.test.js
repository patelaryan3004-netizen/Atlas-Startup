import { describe, it, expect } from 'vitest';
import { readAppRoute, appPath, appUrl, exploreSearch } from '../src/appRoute.js';

const at = (pathname, search = '') => ({ pathname, search });

describe('the address of each page', () => {
  it('reads the page from the address', () => {
    expect(readAppRoute(at('/'))).toEqual({ kind: 'explore' });
    expect(readAppRoute(at('/startup/canva'))).toEqual({ kind: 'startup', slug: 'canva' });
    expect(readAppRoute(at('/jobs'))).toEqual({ kind: 'jobs' });
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

  it('opens the map for an address that is not a page, and for /startup with no company', () => {
    expect(readAppRoute(at('/nonsense'))).toEqual({ kind: 'explore' });
    expect(readAppRoute(at('/startup'))).toEqual({ kind: 'explore' });
    expect(readAppRoute(at('/welcome'))).toEqual({ kind: 'explore' });
  });

  it('still reads the first versions\' ?view= addresses', () => {
    expect(readAppRoute(at('/', '?view=jobs'))).toEqual({ kind: 'jobs' });
    expect(readAppRoute(at('/', '?view=lists'))).toEqual({ kind: 'lists' });
    expect(readAppRoute(at('/', '?view=investors&investor=blackbird'))).toEqual({ kind: 'investors' });
    expect(readAppRoute(at('/', '?view=list&sector=AI'))).toEqual({ kind: 'explore' }); // the list view is a view of the map's page
    expect(readAppRoute(at('/jobs', '?view=lists'))).toEqual({ kind: 'jobs' }); // the path wins
  });

  it('writes the path of each page', () => {
    expect(appPath({ kind: 'explore' })).toBe('/');
    expect(appPath({ kind: 'startup', slug: 'canva' })).toBe('/startup/canva');
    expect(appPath({ kind: 'startup', slug: 'a b/c' })).toBe('/startup/a%20b%2Fc');
    expect(appPath({ kind: 'jobs' })).toBe('/jobs');
    expect(appPath({ kind: 'lists' })).toBe('/lists');
    expect(appPath({ kind: 'list', slug: 'au-ai' })).toBe('/lists/au-ai');
    expect(appPath({ kind: 'news' })).toBe('/news');
  });

  it('writes the filters that are on, and the list view, and nothing else', () => {
    expect(exploreSearch({ search: '', sector: '', city: '' }, 'map')).toBe('');
    expect(exploreSearch({ search: '', sector: 'AI', city: 'Sydney' }, 'map')).toBe('?sector=AI&city=Sydney');
    expect(exploreSearch({ sector: 'AI,Fintech' }, 'list')).toBe('?sector=AI%2CFintech&view=list');
    expect(exploreSearch({}, 'list')).toBe('?view=list');
  });

  it('puts the filters on the pages that show companies, and on no other', () => {
    const ui = { filters: { sector: 'AI' }, viewMode: 'list' };
    expect(appUrl({ kind: 'explore' }, ui)).toBe('/?sector=AI&view=list');
    expect(appUrl({ kind: 'startup', slug: 'canva' }, ui)).toBe('/startup/canva?sector=AI&view=list');
    expect(appUrl({ kind: 'jobs' }, ui)).toBe('/jobs');
    expect(appUrl({ kind: 'list', slug: 'au-ai' }, ui)).toBe('/lists/au-ai');
    expect(appUrl({ kind: 'news' }, ui)).toBe('/news');
    expect(appUrl({ kind: 'explore' })).toBe('/');
  });

  it('writes an address that reads back as the same page', () => {
    for (const route of [{ kind: 'explore' }, { kind: 'startup', slug: 'canva' }, { kind: 'jobs' }, { kind: 'lists' }, { kind: 'list', slug: 'au-ai' }, { kind: 'news' }]) {
      const [pathname, query = ''] = appUrl(route, { filters: { sector: 'AI' } }).split('?');
      expect(readAppRoute(at(pathname, query ? `?${query}` : ''))).toEqual(route);
    }
  });
});
