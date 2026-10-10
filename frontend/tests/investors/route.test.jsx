import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { readRoute, routeUrl, investorHref, personHref, writeRoute, clearRoute } from '../../src/components/investors/route.js';
import { chequeText, dateText, partialDateText, nameKey, safeUrl, amountText, domainOf, stageText, listText } from '../../src/components/investors/common.jsx';
import { usePageTitle } from '../../src/components/investors/usePageTitle.js';

afterEach(() => { window.history.pushState({}, '', '/'); });

const at = (pathname, search = '') => ({ pathname, search });

describe('where the investor pages are in the address', () => {
  it('reads the directory, an investor and a person from the address', () => {
    expect(readRoute(at('/investors'))).toEqual({ kind: 'list' });
    expect(readRoute(at('/investors/'))).toEqual({ kind: 'list' });
    expect(readRoute(at('/investors/blackbird'))).toEqual({ kind: 'investor', slug: 'blackbird' });
    expect(readRoute(at('/investors/main-sequence'))).toEqual({ kind: 'investor', slug: 'main-sequence' });
    expect(readRoute(at('/investors/people/sam'))).toEqual({ kind: 'person', slug: 'sam' });
  });

  it('reads nothing from any other address, and "people" is never an investor', () => {
    expect(readRoute(at('/'))).toBeNull();
    expect(readRoute(at('/welcome'))).toBeNull();
    expect(readRoute(at('/investor/blackbird'))).toBeNull();
    expect(readRoute(at('/', '?investor=blackbird'))).toBeNull();
    expect(readRoute(at('/', '?view=jobs&investor=blackbird'))).toBeNull();
    expect(readRoute(at('/investors/people'))).toEqual({ kind: 'list' });
  });

  it('reads what the address says even when the slug is written with escapes, and does not fail on a bad one', () => {
    expect(readRoute(at('/investors/a%20b'))).toEqual({ kind: 'investor', slug: 'a b' });
    expect(readRoute(at('/investors/%E0%A4%A'))).toEqual({ kind: 'investor', slug: '%E0%A4%A' });
  });

  it('still opens the first version\'s addresses, which kept the pages in the query', () => {
    expect(readRoute(at('/', '?view=investors'))).toEqual({ kind: 'list' });
    expect(readRoute(at('/', '?view=investors&investor=blackbird'))).toEqual({ kind: 'investor', slug: 'blackbird' });
    expect(readRoute(at('/', '?view=investors&investorPerson=sam'))).toEqual({ kind: 'person', slug: 'sam' });
  });

  it('writes an address that reads back as the same place, keeping what else the address says', () => {
    const search = '?city=Sydney&sector=AI';
    for (const route of [{ kind: 'list' }, { kind: 'investor', slug: 'blackbird' }, { kind: 'person', slug: 'sam' }]) {
      const url = routeUrl(route, { search });
      const [pathname, query = ''] = url.split('?');
      expect(readRoute(at(pathname, query ? `?${query}` : ''))).toEqual(route);
      expect(url).toContain('city=Sydney');
      expect(url).toContain('sector=AI');
    }
  });

  it('writes the addresses the pages are linked by, and takes the first version\'s keys out', () => {
    expect(routeUrl({ kind: 'list' }, { search: '' })).toBe('/investors');
    expect(routeUrl({ kind: 'investor', slug: 'blackbird' }, { search: '' })).toBe('/investors/blackbird');
    expect(routeUrl({ kind: 'person', slug: 'sam' }, { search: '' })).toBe('/investors/people/sam');
    expect(routeUrl({ kind: 'person', slug: 'sam' }, { search: '?view=investors&investor=blackbird&city=Sydney' })).toBe('/investors/people/sam?city=Sydney');
    expect(routeUrl({ kind: 'investor', slug: 'a b/c' }, { search: '' })).toBe('/investors/a%20b%2Fc');
  });

  it('gives links that are real addresses', () => {
    expect(investorHref('blackbird')).toBe('/investors/blackbird');
    expect(personHref('sam')).toBe('/investors/people/sam');
  });

  it('writes a new step in the history for a move, none for a replace, and none for where it already is', () => {
    const before = window.history.length;
    writeRoute({ kind: 'investor', slug: 'a' });
    writeRoute({ kind: 'investor', slug: 'b' });
    expect(window.history.length).toBe(before + 2);
    writeRoute({ kind: 'investor', slug: 'c' }, { replace: true });
    expect(window.history.length).toBe(before + 2);
    expect(window.location.pathname).toBe('/investors/c');
    writeRoute({ kind: 'investor', slug: 'c' });
    expect(window.history.length).toBe(before + 2);
  });

  it('writes an old address in the new form without a step of its own', () => {
    window.history.pushState({}, '', '/?city=Sydney&view=investors&investor=blackbird');
    const before = window.history.length;
    writeRoute({ kind: 'investor', slug: 'blackbird' }, { replace: true });
    expect(window.history.length).toBe(before);
    expect(window.location.pathname).toBe('/investors/blackbird');
    expect(window.location.search).toBe('?city=Sydney');
  });

  it('puts the map back at the root on leaving, and leaves the rest of the address', () => {
    window.history.pushState({}, '', '/investors/people/sam?city=Sydney');
    clearRoute();
    expect(window.location.pathname).toBe('/');
    expect(window.location.search).toBe('?city=Sydney');
    window.history.pushState({}, '', '/investors');
    clearRoute();
    expect(window.location.pathname + window.location.search).toBe('/');
    window.history.pushState({}, '', '/?city=Sydney&view=investors&investorPerson=sam');
    clearRoute();
    expect(window.location.pathname + window.location.search).toBe('/?city=Sydney');
  });
});

describe('the tab says which page it is', () => {
  const original = document.title;
  afterEach(() => { document.title = original; });

  function Page({ title, children }) {
    usePageTitle(title);
    return children ?? null;
  }

  it('shows a title while its page is there, and gives the tab back after', () => {
    document.title = 'AU Startup Map';
    const view = render(<Page title="Investors" />);
    expect(document.title).toBe('Investors');
    view.unmount();
    expect(document.title).toBe('AU Startup Map');
  });

  it('lets the newest page win, and hands the tab to the one under it as each goes', () => {
    document.title = 'AU Startup Map';
    const outer = render(<Page title="Directory" />);
    const inner = render(<Page title="Blackbird" />);
    expect(document.title).toBe('Blackbird');
    inner.unmount();
    expect(document.title).toBe('Directory');
    outer.unmount();
    expect(document.title).toBe('AU Startup Map');
  });

  it('follows a title that changes, and leaves the tab alone when there is none', () => {
    document.title = 'AU Startup Map';
    const view = render(<Page title={null} />);
    expect(document.title).toBe('AU Startup Map');
    view.rerender(<Page title="Loaded" />);
    expect(document.title).toBe('Loaded');
    view.rerender(<Page title={null} />);
    expect(document.title).toBe('AU Startup Map');
  });
});

describe('how an investor\'s stages and sectors are written', () => {
  it('writes stages that run on from one another as their two ends', () => {
    expect(stageText(['Pre-seed', 'Seed', 'Series A'])).toBe('Pre-seed → Series A');
    expect(stageText(['Seed', 'Series A'])).toBe('Seed → Series A');
    expect(stageText(['Series A', 'Pre-seed', 'Seed'])).toBe('Pre-seed → Series A'); // however they are stored
    expect(stageText(['Pre-seed', 'Seed', 'Series A', 'Series B', 'Series C+', 'Growth'])).toBe('Pre-seed → Growth');
  });

  it('does not say an investor backs a stage it did not state: stages with a gap are listed as stated', () => {
    expect(stageText(['Pre-seed', 'Series B'])).toBe('Pre-seed · Series B');
    expect(stageText(['Seed', 'Series B', 'Growth'])).toBe('Seed · Series B · Growth');
  });

  it('writes one stage as it is, a stage it does not know after the others, and nothing for none', () => {
    expect(stageText(['Seed'])).toBe('Seed');
    expect(stageText(['Seed', 'Series A', 'Series D'])).toBe('Seed · Series A · Series D');
    expect(stageText(['Series D'])).toBe('Series D');
    expect(stageText([])).toBe('');
    expect(stageText()).toBe('');
  });

  it('writes the first few sectors on one line and counts the rest', () => {
    expect(listText(['AI', 'SaaS', 'Fintech'])).toBe('AI · SaaS · Fintech');
    expect(listText(['AI', 'SaaS', 'Fintech', 'Health', 'Climate'])).toBe('AI · SaaS · Fintech · +2 more');
    expect(listText(['AI'])).toBe('AI');
    expect(listText([])).toBe('');
    expect(listText(['A', 'B', 'C', 'D'], 2)).toBe('A · B · +2 more');
  });
});

describe('how the investor pages write what they are told', () => {
  it('writes a date as far as it is known', () => {
    expect(partialDateText('2025')).toBe('2025');
    expect(partialDateText('2025-03')).toBe('Mar 2025');
    expect(partialDateText('2025-03-14')).toBe('14 Mar 2025');
    expect(partialDateText(null)).toBeNull();
    expect(partialDateText('nonsense')).toBeNull();
    expect(dateText('2026-10-08T12:00:00.000Z')).toBe('8 Oct 2026');
    expect(dateText('not a date')).toBeNull();
  });

  it('writes a cheque as a source states it, in its own currency, and nothing when none is stated', () => {
    expect(chequeText({ min: 250000, max: 1000000, currency: 'AUD' })).toBe('$250,000 to $1,000,000');
    expect(chequeText({ min: 250000, max: null, currency: 'AUD' })).toBe('from $250,000');
    expect(chequeText({ min: null, max: 1000000, currency: 'AUD' })).toBe('up to $1,000,000');
    expect(chequeText({ min: 1, max: 2, currency: 'NZD' })).toMatch(/^NZD\s1 to NZD\s2$/);
    expect(chequeText(null)).toBeNull();
    expect(chequeText({ min: null, max: null, currency: 'AUD' })).toBeNull();
    expect(amountText(null, 'AUD')).toBeNull();
    expect(amountText(2000000, 'AUD')).toBe('$2,000,000');
  });

  it('follows only http and https, and takes a domain only from a real address', () => {
    expect(safeUrl('https://a.example/x')).toBe('https://a.example/x');
    expect(safeUrl('http://a.example')).toBe('http://a.example/');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,hi')).toBeNull();
    expect(safeUrl('not a url')).toBeNull();
    expect(domainOf('https://www.blackbird.example/x')).toBe('blackbird.example');
    expect(domainOf('nope')).toBeNull();
  });

  it('matches names the way the server does: case, accents, "&" and punctuation do not matter', () => {
    expect(nameKey('Blackbird  Ventures')).toBe(nameKey('blackbird ventures'));
    expect(nameKey('Smith & Co.')).toBe(nameKey('Smith and Co'));
    expect(nameKey('Café Capital')).toBe(nameKey('Cafe Capital'));
    expect(nameKey('Skip')).not.toBe(nameKey('Skip Capital'));
    expect(nameKey(null)).toBe('');
  });
});
