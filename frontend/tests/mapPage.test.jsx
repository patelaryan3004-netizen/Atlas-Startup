import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../src/api.js', () => ({ fetchStartup: vi.fn() }));

import { fetchStartup } from '../src/api.js';
import { MAP_CITIES, cityView } from '../src/cityViews.js';
import { readAppRoute, appPath, appUrl, opensWelcome } from '../src/appRoute.js';
import { opensOnMap } from '../src/mapPrefetch.js';
import MapToolbar, { countText } from '../src/components/explore/MapToolbar.jsx';
import SourceNote, { sourceLines } from '../src/components/explore/SourceNote.jsx';
import PreviewCard from '../src/components/explore/PreviewCard.jsx';
import { EMPTY_FILTERS } from '../src/components/FilterPanel.jsx';

const at = (pathname, search = '') => ({ pathname, search });

describe('the cities of the map page', () => {
  it('are the ten the map lists, in order, each with a view the map goes to; anything else has none', () => {
    expect(MAP_CITIES).toEqual(['Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Canberra', 'Gold Coast', 'Newcastle', 'Hobart', 'Darwin']);
    for (const city of MAP_CITIES) {
      const view = cityView(city);
      expect(view, city).toMatchObject({ lat: expect.any(Number), lng: expect.any(Number), zoom: expect.any(Number) });
      expect(view.lat).toBeLessThan(-10); // all of them are south of the equator, in Australia
      expect(view.lng).toBeGreaterThan(110);
    }
    expect(cityView('Hobart')).toMatchObject({ lat: -42.8821, lng: 147.3272 });
    expect(cityView('Sydney,Melbourne')).toBeNull(); // two cities are fitted to their pins
    expect(cityView('Geelong')).toBeNull();
    expect(cityView('')).toBeNull();
    expect(cityView('constructor')).toBeNull();
  });
});

describe('the addresses: the welcome page at the root, the map page at /map', () => {
  it('reads /map as the map page, and writes it back without a view word, carrying the filters', () => {
    expect(readAppRoute(at('/map'))).toEqual({ kind: 'map' });
    expect(readAppRoute(at('/map/'))).toEqual({ kind: 'map' });
    expect(appPath({ kind: 'map' })).toBe('/map');
    expect(appUrl({ kind: 'map' }, { filters: { ...EMPTY_FILTERS, city: 'Hobart', sector: 'AI' }, viewMode: 'map' })).toBe('/map?city=Hobart&sector=AI');
  });

  it('opens the welcome page at the root, and the app for an older link to the root that carries a filter or a view', () => {
    expect(opensWelcome(at('/'))).toBe(true);
    expect(opensWelcome(at('', ''))).toBe(true);
    expect(opensWelcome(at('/', '?utm_source=newsletter'))).toBe(true); // a tracking word is not a filter
    expect(opensWelcome(at('/', '?sector=AI'))).toBe(false);
    expect(opensWelcome(at('/', '?city=Sydney'))).toBe(false);
    expect(opensWelcome(at('/', '?view=jobs'))).toBe(false);
    expect(opensWelcome(at('/map'))).toBe(false);
    expect(opensWelcome(at('/home'))).toBe(false);
  });

  it('downloads the map code for /map, and for nothing else that is not a map', () => {
    expect(opensOnMap('/map')).toBe(true);
    expect(opensOnMap('/map/', '?city=Perth')).toBe(true);
    expect(opensOnMap('/discover')).toBe(false);
    expect(opensOnMap('/discover', '?view=map')).toBe(true);
    expect(opensOnMap('/')).toBe(false);
    expect(opensOnMap('/home')).toBe(false);
  });
});

describe('how many are on the map', () => {
  it('says the companies, and the investors when they are drawn too, singular and plural', () => {
    expect(countText({ companies: 266, vcs: 0, entity: 'all' })).toBe('266 companies');
    expect(countText({ companies: 17, vcs: 1, entity: 'all' })).toBe('17 companies and 1 investor');
    expect(countText({ companies: 1, vcs: 8, entity: 'all' })).toBe('1 company and 8 investors');
    expect(countText({ companies: 0, vcs: 0, entity: 'startups' })).toBe('0 companies');
    expect(countText({ companies: 70, vcs: 8, entity: 'startups' })).toBe('70 companies'); // only the companies are on
    expect(countText({ companies: 70, vcs: 8, entity: 'vcs' })).toBe('8 investors');
    expect(countText({ companies: undefined, vcs: 0, entity: 'all' })).toBe(''); // not known yet: the bar says it is counting
    expect(countText({ companies: 1234, vcs: 0, entity: 'all' })).toBe('1,234 companies');
    // one count: no second figure for the ones with no street pin (they are companies of the city, in the list; the map does not make a number of what it does not draw)
    expect(countText({ companies: 300, unplaced: 45, vcs: 0, entity: 'all' })).toBe('300 companies');
    expect(countText({ companies: 17, unplaced: 2, vcs: 1, entity: 'all' })).toBe('17 companies and 1 investor');
    expect(countText({ companies: 5, vcs: 0, entity: 'startups' })).toBe('5 companies');
  });
});

describe('the bar over the map', () => {
  const cities = MAP_CITIES.map((city, i) => ({ city, count: i === 0 ? 121 : null }));
  const props = (over = {}) => ({
    filters: { ...EMPTY_FILTERS }, onFilterChange: vi.fn(), cities, sectors: [{ value: 'AI & Data', count: 5 }, { value: 'Fintech', count: 12 }],
    companies: 266, vcs: 0, entity: 'all', onEntityChange: vi.fn(), filtersOpen: false, onToggleFilters: vi.fn(), filtersRef: { current: null }, listHref: '/discover', onList: vi.fn(), ...over,
  });

  it('has the city first, with All Australia and the ten cities, and a city picked is the city filter', async () => {
    const p = props();
    render(<MapToolbar {...p} />);
    const bar = screen.getByRole('search', { name: 'Find companies on the map' });
    const button = within(bar).getByRole('button', { name: 'City: Australia' });
    expect(bar.firstElementChild).toContainElement(button); // top left
    await userEvent.click(button);
    const group = screen.getByRole('group', { name: 'Choose a city' });
    expect(within(group).getAllByRole('button').map((b) => b.querySelector('span').textContent)).toEqual(['All Australia', ...MAP_CITIES]);
    await userEvent.click(within(group).getByRole('button', { name: /Darwin/ }));
    expect(p.onFilterChange).toHaveBeenCalledWith({ city: 'Darwin' });
  });

  it('picking the city that is already picked goes back to all of Australia', async () => {
    const p = props({ filters: { ...EMPTY_FILTERS, city: 'Perth' } });
    render(<MapToolbar {...p} />);
    await userEvent.click(screen.getByRole('button', { name: 'City: Perth' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Choose a city' })).getByRole('button', { name: /Perth/ }));
    expect(p.onFilterChange).toHaveBeenCalledWith({ city: '' });
  });

  it('searches as the visitor types, and clears the search', async () => {
    const p = props({ filters: { ...EMPTY_FILTERS, search: 'wa' } });
    render(<MapToolbar {...p} />);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search companies on the map' }), 'x');
    expect(p.onFilterChange).toHaveBeenLastCalledWith({ search: 'wax' });
    await userEvent.click(screen.getByRole('button', { name: 'Clear the search' }));
    expect(p.onFilterChange).toHaveBeenLastCalledWith({ search: '' });
  });

  it('offers the sectors it is given (the display sectors that have a result), each with how many, and has no stage menu: the stage is under More filters', async () => {
    const p = props();
    render(<MapToolbar {...p} />);
    expect(screen.queryByRole('button', { name: /^Stage/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sector' }));
    expect(within(screen.getByRole('group', { name: 'Sector' })).getAllByRole('checkbox').map((c) => c.parentElement.textContent)).toEqual(['AI & Data5', 'Fintech12']);
    await userEvent.click(within(screen.getByRole('group', { name: 'Sector' })).getByRole('checkbox', { name: /Fintech/ }));
    expect(p.onFilterChange).toHaveBeenCalledWith({ sector: 'Fintech' });
  });

  it('says how many are on the map where a screen reader will hear it change, and links to the same companies as a list: "View list"', () => {
    render(<MapToolbar {...props({ companies: 17, vcs: 1 })} />);
    expect(screen.getByRole('status')).toHaveTextContent('17 companies and 1 investor');
    expect(screen.getByRole('link', { name: 'View list' })).toHaveAttribute('href', '/discover');
  });

  it('counts the stage and the other filters on "More filters"', () => {
    render(<MapToolbar {...props({ filters: { ...EMPTY_FILTERS, stage: 'Seed', hiring: 'yes', sector: 'Fintech', city: 'Perth', search: 'x' } })} />);
    expect(screen.getByRole('button', { name: 'More filters' })).toHaveTextContent('2'); // the stage and hiring: not the city, the sector or the search, which have controls of their own
  });

  it('says it is counting until the count arrives, and picks the type of organisation from one select', async () => {
    const p = props({ companies: undefined });
    render(<MapToolbar {...p} />);
    expect(screen.getByRole('status')).toHaveTextContent('Counting…');
    const select = screen.getByRole('combobox', { name: 'What kind of organisation' });
    expect([...select.options].map((o) => o.textContent)).toEqual(['All types', 'Startups', 'Companies', 'Investors', 'Spaces']);
    await userEvent.selectOptions(select, 'startups');
    expect(p.onEntityChange).toHaveBeenCalledWith('startups');
  });
});

describe('where a company\'s facts came from', () => {
  const record = {
    sources: [
      { url: 'https://www.blackbird.vc/portfolio/x', publisher: 'Blackbird', kind: 'investor_website', checked_at: '2026-10-30T12:00:00Z' },
      { url: 'https://x.example/about', publisher: 'X Pty Ltd', kind: 'company_website', checked_at: '2026-10-21T01:00:00Z' },
      { url: 'https://www.startmate.com/portfolio-companies/x', publisher: 'Startmate', kind: 'accelerator_profile', checked_at: '2026-10-20T01:00:00Z' },
      { url: 'https://news.example/story', publisher: 'A paper', kind: 'press', checked_at: '2026-10-01T01:00:00Z' },
    ],
  };

  it('puts the company\'s own site first, then the pages that list it, and no more than the limit', () => {
    const lines = sourceLines(record, 3);
    expect(lines.map((l) => l.url)).toEqual(['https://x.example/about', 'https://www.blackbird.vc/portfolio/x', 'https://www.startmate.com/portfolio-companies/x']);
    expect(lines[0].label).toBe('its own site (x.example)');
    expect(lines[1].label).toBe('Blackbird');
    expect(lines[1].read).toMatch(/2026/);
  });

  it('says a line once when two pages of the same site were read on the same day', () => {
    const twice = { sources: [
      { url: 'https://x.example/contact', kind: 'company_website', checked_at: '2026-11-02T01:00:00Z' },
      { url: 'https://x.example/privacy', kind: 'company_website', checked_at: '2026-11-02T05:00:00Z' },
      { url: 'https://x.example/about', kind: 'company_website', checked_at: '2026-11-05T01:00:00Z' },
    ] };
    expect(sourceLines(twice, 3).map((l) => l.url)).toEqual(['https://x.example/contact', 'https://x.example/about']);
  });

  it('says nothing when the record has no source, and never makes one up', () => {
    expect(sourceLines({}, 3)).toEqual([]);
    expect(sourceLines({ sources: [{ kind: 'press' }] }, 3)).toEqual([]);
    const { container } = render(<SourceNote record={{}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('links each source in a new tab with the day it was read', () => {
    render(<SourceNote record={record} limit={2} />);
    expect(screen.getByText(/Sources:/)).toBeInTheDocument();
    const own = screen.getByRole('link', { name: 'its own site (x.example)' });
    expect(own).toHaveAttribute('href', 'https://x.example/about');
    expect(own).toHaveAttribute('rel', 'noopener noreferrer');
    expect(own).toHaveAttribute('target', '_blank');
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });
});

describe('the card beside a mark', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  const pin = { slug: 'canva', name: 'Canva', city: 'Sydney', suburb: 'Surry Hills', sector: 'Design', website: 'https://canva.com', hiring: false, location: { place: 'Sydney', quality: 'City-level: approximate' } };

  it('opens with what the mark knows, then adds one sentence as the record arrives: never the website or the sources', async () => {
    let arrive;
    fetchStartup.mockReturnValue(new Promise((resolve) => { arrive = resolve; }));
    render(<PreviewCard pin={pin} onOpen={() => {}} onClose={() => {}} />);
    expect(screen.getByText('Canva')).toBeInTheDocument();
    expect(screen.getByText('Design · Surry Hills, Sydney')).toBeInTheDocument(); // the sector the source gave, where the pin has no display sector, and where it is
    expect(screen.queryByText('City-level: approximate')).not.toBeInTheDocument(); // how well the place is known is on the company's page
    expect(screen.queryByText(/Source/)).not.toBeInTheDocument();
    arrive({ slug: 'canva', name: 'Canva', blurb: 'Online design and publishing', sector: 'Design', sectorFull: 'Design software', website: 'https://www.canva.com', website_status: null, sources: [{ url: 'https://www.canva.com/about', kind: 'company_website', checked_at: '2026-10-21T01:00:00Z' }] });
    expect(await screen.findByText('Online design and publishing')).toBeInTheDocument();
    expect(screen.queryByText('Design software')).not.toBeInTheDocument(); // the sector is the one name, not the long text
    expect(screen.queryByRole('link')).not.toBeInTheDocument(); // no official website, no source: they are on the company's own page
    expect(screen.queryByText(/its own site|canva\.com/)).not.toBeInTheDocument();
  });

  it('keeps what the mark knew when the record cannot be had, and links nothing', async () => {
    fetchStartup.mockRejectedValue(new Error('offline'));
    const { unmount } = render(<PreviewCard pin={pin} onOpen={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(fetchStartup).toHaveBeenCalled());
    expect(screen.getByText('Canva')).toBeInTheDocument();
    expect(screen.queryByText(/Source/)).not.toBeInTheDocument();
    unmount();
    fetchStartup.mockResolvedValue({ slug: 'canva', name: 'Canva', blurb: 'x', website: 'https://gone.example', website_status: 'unavailable', sources: [] });
    render(<PreviewCard pin={pin} onOpen={() => {}} onClose={() => {}} />);
    await screen.findByText('x');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('does not ask for a record for an investor', () => {
    render(<PreviewCard pin={{ kind: 'vc', slug: 'blackbird', name: 'Blackbird', website: 'https://blackbird.vc' }} onOpen={() => {}} onClose={() => {}} />);
    expect(fetchStartup).not.toHaveBeenCalled();
  });
});
