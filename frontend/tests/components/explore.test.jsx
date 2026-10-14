import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/api.js', () => ({ fetchStartup: vi.fn(), fetchStartupPage: vi.fn(), fetchSuggestions: vi.fn() }));

import { fetchStartup, fetchStartupPage, fetchSuggestions } from '../../src/api.js';
import ExploreHeader from '../../src/components/explore/ExploreHeader.jsx';
import ExploreToolbar, { placeLabel, nextCity } from '../../src/components/explore/ExploreToolbar.jsx';
import CityDock from '../../src/components/explore/CityDock.jsx';
import MapOverview from '../../src/components/explore/MapOverview.jsx';
import PreviewCard from '../../src/components/explore/PreviewCard.jsx';
import ResultsSheet from '../../src/components/explore/ResultsSheet.jsx';
import { Avatar } from '../../src/components/EntityCard.jsx';

const FILTERS = { search: '', sector: '', city: '', investor: '', stage: '', hiring: '', taskGate: '', events: '', precision: '', state: '', remote: '', tech: '', team: '', fresh: '' };

describe('the header', () => {
  const props = (over = {}) => ({ hiringCount: 25, trackedCount: 0, onExplore: vi.fn(), onShowJobs: vi.fn(), onShowInvestors: vi.fn(), onShowTracked: vi.fn(), onAdd: vi.fn(), menu: { directoryUrl: '/directory/' }, ...over });

  it('names the site, as a link to its home page, in the one heading of the page', () => {
    render(<ExploreHeader {...props()} />);
    expect(screen.getByRole('link', { name: 'Go to home' })).toHaveAttribute('href', '/welcome');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('AU Startup Map');
  });

  it('has four places, with Explore as the one it is on, and hands each press to the page', async () => {
    const p = props();
    render(<ExploreHeader {...p} />);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['Explore', 'Jobs', 'Investors', 'Saved']);
    expect(within(nav).getByRole('button', { name: 'Explore' })).toHaveAttribute('aria-current', 'page');
    await userEvent.click(within(nav).getByRole('button', { name: 'Jobs' }));
    await userEvent.click(within(nav).getByRole('button', { name: 'Investors' }));
    await userEvent.click(within(nav).getByRole('button', { name: 'Saved' }));
    await userEvent.click(within(nav).getByRole('button', { name: 'Explore' }));
    expect([p.onShowJobs, p.onShowInvestors, p.onShowTracked, p.onExplore].map((fn) => fn.mock.calls.length)).toEqual([1, 1, 1, 1]);
  });

  it('says how many are hiring on the Jobs link, and how many are saved beside Saved, only when there are some', () => {
    const { rerender } = render(<ExploreHeader {...props({ hiringCount: 25, trackedCount: 3 })} />);
    expect(screen.getByRole('button', { name: 'Jobs' })).toHaveAttribute('title', '25 hiring now');
    expect(screen.getByRole('button', { name: /^Saved/ })).toHaveTextContent('Saved3');
    rerender(<ExploreHeader {...props({ hiringCount: 0, trackedCount: 0 })} />);
    expect(screen.getByRole('button', { name: 'Jobs' })).not.toHaveAttribute('title');
    expect(screen.getByRole('button', { name: 'Saved' }).textContent).toBe('Saved');
  });

  it('has one action, Add startup, and the menu with everything else', async () => {
    const p = props();
    render(<ExploreHeader {...p} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add startup' }));
    expect(p.onAdd).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Menu' })).toBeInTheDocument();
  });
});

describe('the words for a place', () => {
  it('says Australia, a city, or how many cities', () => {
    expect(placeLabel([])).toBe('Australia');
    expect(placeLabel(['Melbourne'])).toBe('Melbourne');
    expect(placeLabel(['Melbourne', 'Sydney'])).toBe('2 cities');
  });

  it('replaces the city with the one picked, leaves it when the same one is picked again, and clears it for "all of Australia"', () => {
    expect(nextCity('', 'Sydney')).toBe('Sydney');
    expect(nextCity('Sydney', 'Melbourne')).toBe('Melbourne');
    expect(nextCity('Sydney', 'Sydney')).toBe('');
    expect(nextCity('Sydney', '')).toBe('');
    expect(nextCity('Sydney,Melbourne', 'Sydney')).toBe('Sydney'); // two were chosen in the panel: this one is what is left to look at
  });
});

describe('the toolbar', () => {
  const META = { sectors: ['AI', 'Fintech'], cities: [], investors: [], stages: [] };
  const CITIES = [{ city: 'Sydney', count: 30 }, { city: 'Melbourne', count: 11 }, { city: 'Hobart', count: null }];
  const setup = (over = {}) => {
    const props = { filters: FILTERS, onFilterChange: vi.fn(), onApplyFilters: vi.fn(), meta: META, cities: CITIES, total: 41, filtersOpen: false, onToggleFilters: vi.fn(), filtersRef: { current: null }, viewMode: 'map', onSetViewMode: vi.fn(), ...over };
    return { props, ...render(<ExploreToolbar {...props} />) };
  };
  beforeEach(() => { fetchSuggestions.mockResolvedValue({ companies: [], people: [], investors: [], industries: [], locations: [] }); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('says "Australia" with no city, and "Australia / Melbourne" on one, and asks the search to be for that place', () => {
    const { rerender, props } = setup();
    expect(screen.getByRole('button', { name: /^Australia/ })).toHaveTextContent('Australia');
    expect(screen.getByLabelText(/Search startups/)).toHaveAttribute('placeholder', 'Search in Australia');
    rerender(<ExploreToolbar {...props} filters={{ ...FILTERS, city: 'Melbourne' }} />);
    expect(screen.getByRole('button', { name: /^Australia/ })).toHaveTextContent('Australia/Melbourne');
    expect(screen.getByLabelText(/Search startups/)).toHaveAttribute('placeholder', 'Search in Melbourne');
  });

  it('has a short search box on a phone', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })));
    setup();
    expect(screen.getByLabelText(/Search startups/)).toHaveAttribute('placeholder', 'Search startups');
  });

  it('opens a menu of the cities with their counts, picks one, and closes with Escape and with a press outside', async () => {
    const { props } = setup();
    await userEvent.click(screen.getByRole('button', { name: /^Australia/ }));
    const menu = screen.getByRole('group', { name: 'Choose a city' });
    expect(within(menu).getAllByRole('button').map((b) => b.textContent)).toEqual(['All of Australia41', 'Sydney30', 'Melbourne11', 'Hobart']);
    await userEvent.click(within(menu).getByRole('button', { name: /^Melbourne/ }));
    expect(props.onFilterChange).toHaveBeenCalledWith({ city: 'Melbourne' });
    expect(screen.queryByRole('group', { name: 'Choose a city' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^Australia/ }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Choose a city' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Australia/ }));
    await userEvent.click(document.body);
    expect(screen.queryByRole('group', { name: 'Choose a city' })).not.toBeInTheDocument();
  });

  it('marks the city that is on, lists a city the directory does not count, and leaves it when it is picked again', async () => {
    const { props } = setup({ filters: { ...FILTERS, city: 'Perth' } });
    await userEvent.click(screen.getByRole('button', { name: /^Australia/ }));
    const menu = screen.getByRole('group', { name: 'Choose a city' });
    expect(within(menu).getByRole('button', { name: /^Perth/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(menu).getByRole('button', { name: /^All of Australia/ })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(within(menu).getByRole('button', { name: /^Perth/ }));
    expect(props.onFilterChange).toHaveBeenCalledWith({ city: '' });
  });

  it('picks sectors from its own menu, several at once, and counts them on its button', async () => {
    const { props, rerender } = setup();
    await userEvent.click(screen.getByRole('button', { name: /^Sector/ }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Sector' })).getByRole('checkbox', { name: 'AI' }));
    expect(props.onFilterChange).toHaveBeenCalledWith({ sector: 'AI' });
    rerender(<ExploreToolbar {...props} filters={{ ...FILTERS, sector: 'AI' }} />);
    await userEvent.click(within(screen.getByRole('group', { name: 'Sector' })).getByRole('checkbox', { name: 'Fintech' }));
    expect(props.onFilterChange).toHaveBeenLastCalledWith({ sector: 'AI,Fintech' });
    expect(screen.getByRole('button', { name: /^Sector/ })).toHaveTextContent('1');
    await userEvent.click(screen.getByRole('button', { name: 'Clear sectors' }));
    expect(props.onFilterChange).toHaveBeenLastCalledWith({ sector: '' });
  });

  it('gives a long list of sectors a box to narrow it, and a short one none', async () => {
    const many = Array.from({ length: 12 }, (_, i) => `Sector ${i}`);
    const { unmount } = setup({ meta: { ...META, sectors: many } });
    await userEvent.click(screen.getByRole('button', { name: /^Sector/ }));
    await userEvent.type(screen.getByLabelText('Find a sector'), '11');
    expect(within(screen.getByRole('group', { name: 'Sector' })).getAllByRole('checkbox').map((c) => c.closest('label').textContent)).toEqual(['Sector 11']);
    await userEvent.clear(screen.getByLabelText('Find a sector'));
    await userEvent.type(screen.getByLabelText('Find a sector'), 'zzz');
    expect(screen.getByText('None match.')).toBeInTheDocument();
    unmount();
    setup();
    await userEvent.click(screen.getByRole('button', { name: /^Sector/ }));
    expect(screen.queryByLabelText('Find a sector')).not.toBeInTheDocument();
  });

  it('has a Filters button that says whether the panel is open and counts the filters on, but not the search, the city or the sectors', async () => {
    const { props, rerender } = setup({ filters: { ...FILTERS, search: 'x', city: 'Sydney', sector: 'AI', stage: 'Seed', hiring: 'yes' } });
    const button = screen.getByRole('button', { name: /^Filters/ });
    expect(button).toHaveTextContent('2');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-controls', 'filters');
    await userEvent.click(button);
    expect(props.onToggleFilters).toHaveBeenCalledTimes(1);
    rerender(<ExploreToolbar {...props} filtersOpen />);
    expect(screen.getByRole('button', { name: /^Filters/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('has the Map | List switch, with the one that is showing pressed', async () => {
    const { props } = setup();
    expect(screen.getByRole('button', { name: 'Map' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(props.onSetViewMode).toHaveBeenCalledWith('list');
  });
});

describe('the city dock', () => {
  it('is nothing at all with no cities', () => {
    const { container } = render(<CityDock cities={[]} selected={[]} onSelect={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is a labelled group of the cities, each with its count, the one that is on pressed, and hands a press to the page', async () => {
    const onSelect = vi.fn();
    render(<CityDock cities={[{ city: 'Sydney', count: 30 }, { city: 'Melbourne', count: 1 }]} selected={['Melbourne']} onSelect={onSelect} />);
    const nav = screen.getByRole('navigation', { name: 'Explore cities' });
    expect(within(nav).getByText('Explore cities')).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'Sydney' })).toHaveAttribute('title', '30 startups');
    expect(within(nav).getByRole('button', { name: 'Melbourne' })).toHaveAttribute('title', '1 startup');
    expect(within(nav).getByRole('button', { name: 'Melbourne' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(nav).getByRole('button', { name: 'Sydney' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(within(nav).getByRole('button', { name: 'Sydney' }));
    expect(onSelect).toHaveBeenCalledWith('Sydney');
  });
});

describe('the little map of Australia', () => {
  it('is a button that shows all of Australia, with the country drawn in dots and nothing of any company on it', async () => {
    const onShowAll = vi.fn();
    const { container } = render(<MapOverview view={null} onShowAll={onShowAll} />);
    expect(container.querySelector('svg path.xo-land')).not.toBeNull();
    expect(container.querySelector('circle')).toBeNull(); // no view yet: no dot
    await userEvent.click(screen.getByRole('button', { name: 'Show all of Australia' }));
    expect(onShowAll).toHaveBeenCalledTimes(1);
  });

  it('puts a dot where the map is looking, and none when it is looking away from Australia', () => {
    const { container, rerender } = render(<MapOverview view={{ lat: -37.8, lng: 144.96, zoom: 12 }} onShowAll={() => {}} />);
    expect(container.querySelector('circle.xo-here')).not.toBeNull();
    const [x0, y0] = ['cx', 'cy'].map((a) => Number(container.querySelector('circle.xo-here').getAttribute(a)));
    rerender(<MapOverview view={{ lat: -33.87, lng: 151.2, zoom: 12 }} onShowAll={() => {}} />);
    const [x1, y1] = ['cx', 'cy'].map((a) => Number(container.querySelector('circle.xo-here').getAttribute(a)));
    expect(x1).toBeGreaterThan(x0); // Sydney is east of Melbourne
    expect(y1).toBeLessThan(y0); // and north of it
    rerender(<MapOverview view={{ lat: 51.5, lng: -0.12, zoom: 5 }} onShowAll={() => {}} />);
    expect(container.querySelector('circle')).toBeNull();
  });
});

describe('the company\'s card', () => {
  const PIN = { slug: 'acme', name: 'Acme AI', city: 'Melbourne', sector: 'AI', hiring: false, website: 'https://acme.ai', location: { quality: 'Location: suburb-level' } };
  const RECORD = { slug: 'acme', name: 'Acme AI', sector: 'AI', sectorFull: 'AI infrastructure', blurb: 'Makes things for people.', website: 'https://acme.ai', verified: true, last_verified_at: new Date().toISOString(), hiringState: 'checked', hiring_checked_at: '2026-10-05T03:59:04.292Z' };
  const setup = (over = {}) => {
    const props = { pin: PIN, saved: false, onToggleSaved: vi.fn(), onOpen: vi.fn(), onClose: vi.fn(), onReport: vi.fn(), ...over };
    return { props, ...render(<PreviewCard {...props} />) };
  };
  beforeEach(() => { fetchStartup.mockReset(); fetchStartup.mockResolvedValue(RECORD); });

  it('opens at once with what the pin knows: the name, where, the sector and how well the place is known', () => {
    fetchStartup.mockImplementation(() => new Promise(() => {}));
    setup();
    const card = screen.getByRole('region', { name: 'Acme AI' });
    expect(within(card).getByRole('heading', { name: 'Acme AI' })).toBeInTheDocument();
    expect(within(card).getByText('Melbourne')).toBeInTheDocument();
    expect(within(card).getByText('AI')).toBeInTheDocument();
    expect(within(card).getByText('Location: suburb-level')).toBeInTheDocument();
    expect(within(card).queryByText(/Roles unverified|Hiring/)).not.toBeInTheDocument(); // nothing is said of hiring for a company nobody has read
    expect(card.querySelector('.xp-blurb')).toBeNull();
  });

  it('fills in from the record: its one line, the sector in full, when it was checked, and what hiring says', async () => {
    setup();
    expect(await screen.findByText('Makes things for people.')).toBeInTheDocument();
    expect(fetchStartup).toHaveBeenCalledWith('acme', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByText('AI infrastructure')).toBeInTheDocument();
    expect(screen.getByText('Hiring (checked 5 Oct)')).toBeInTheDocument();
    expect(screen.getByText('Verified today')).toBeInTheDocument();
  });

  it('says a company is hiring now when the pin does, before the record arrives', () => {
    fetchStartup.mockImplementation(() => new Promise(() => {}));
    setup({ pin: { ...PIN, hiring: true } });
    expect(screen.getByText('● Hiring now')).toBeInTheDocument();
  });

  it('says a company is unverified when the record does', async () => {
    fetchStartup.mockResolvedValue({ ...RECORD, verified: false, hiringState: 'unverified' });
    setup();
    expect(await screen.findByText('Unverified')).toBeInTheDocument();
    expect(screen.getByText('Roles unverified')).toBeInTheDocument();
  });

  it('keeps what the pin knew when the record cannot be fetched', async () => {
    fetchStartup.mockRejectedValue(new Error('down'));
    setup();
    await waitFor(() => expect(fetchStartup).toHaveBeenCalled());
    expect(screen.getByRole('heading', { name: 'Acme AI' })).toBeInTheDocument();
    expect(screen.queryByText(/Roles unverified/)).not.toBeInTheDocument();
  });

  it('asks for another company\'s record, and drops the old one, when the pin changes', async () => {
    const { props, rerender } = setup();
    expect(await screen.findByText('Makes things for people.')).toBeInTheDocument();
    fetchStartup.mockResolvedValue({ slug: 'beta', name: 'Beta', blurb: 'Another one.' });
    rerender(<PreviewCard {...props} pin={{ ...PIN, slug: 'beta', name: 'Beta' }} />);
    expect(screen.queryByText('Makes things for people.')).not.toBeInTheDocument();
    expect(await screen.findByText('Another one.')).toBeInTheDocument();
  });

  it('has the two things to do with a company: open it, and save it (kept in this browser)', async () => {
    const { props, rerender } = setup();
    await userEvent.click(screen.getByRole('button', { name: /View company/ }));
    expect(props.onOpen).toHaveBeenCalledTimes(1);
    const save = screen.getByRole('button', { name: 'Save Acme AI' });
    expect(save).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(save);
    expect(props.onToggleSaved).toHaveBeenCalledTimes(1);
    rerender(<PreviewCard {...props} saved />);
    expect(screen.getByRole('button', { name: 'Remove Acme AI from saved' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('closes from its own button and with Escape', async () => {
    const { props } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Close this card' }));
    await userEvent.keyboard('{Escape}');
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it('offers "Report: role closed" only for a company that is hiring or was checked as hiring, and only when the page can take it', async () => {
    const { props } = setup();
    await screen.findByText('Hiring (checked 5 Oct)');
    await userEvent.click(screen.getByRole('button', { name: 'Report: role closed' }));
    expect(props.onReport).toHaveBeenCalledTimes(1);
  });

  it('has no report link without a page to take it, nor for a company with no roles listed', async () => {
    fetchStartup.mockResolvedValue({ ...RECORD, hiringState: 'none' });
    setup({ onReport: undefined });
    await screen.findByText(/No open roles listed/);
    expect(screen.queryByRole('button', { name: 'Report: role closed' })).not.toBeInTheDocument();
  });

  it('is the same card in the phone\'s sheet, with a smaller picture', () => {
    fetchStartup.mockImplementation(() => new Promise(() => {}));
    const { container } = setup({ variant: 'sheet' });
    expect(container.querySelector('.xp-card')).toHaveClass('xp-card-sheet');
    expect(container.querySelector('.xp-logo img').getAttribute('width')).toBe('64');
  });

  it('draws the picture at the size the card gives it, a sharper one for a big picture', () => {
    fetchStartup.mockImplementation(() => new Promise(() => {}));
    const { container } = setup();
    const img = container.querySelector('.xp-logo img');
    expect(img.getAttribute('width')).toBe('82');
    expect(img.getAttribute('src')).toMatch(/size=96$/);
    expect(img.getAttribute('src')).toContain('acme.ai');
  });

  it('writes the name as text, whatever the company is called', () => {
    fetchStartup.mockImplementation(() => new Promise(() => {}));
    const evil = '<img src=x onerror=alert(1)>';
    const { container } = setup({ pin: { ...PIN, name: evil } });
    expect(screen.getByRole('heading', { name: evil })).toBeInTheDocument();
    expect(container.querySelector('.xp-name img')).toBeNull();
  });
});

describe('the avatar', () => {
  it('is 40px with a 64px picture unless a card says otherwise, and a bigger picture is asked for a bigger box', () => {
    const { container, rerender } = render(<Avatar name="Acme" domain="acme.ai" />);
    expect(container.querySelector('img').getAttribute('width')).toBe('40');
    expect(container.querySelector('img').getAttribute('src')).toMatch(/size=64$/);
    rerender(<Avatar name="Acme" domain="acme.ai" size={82} className="xp-logo" />);
    expect(container.querySelector('img').getAttribute('src')).toMatch(/size=96$/);
    expect(container.querySelector('.entity-avatar')).toHaveClass('xp-logo');
  });
});

describe('the phone\'s sheet', () => {
  const page = (names, over = {}) => ({ results: names.map((name) => ({ slug: name.toLowerCase(), name, city: 'Sydney', sector: 'AI', hiringState: name === 'Acme' ? 'hiring' : 'unverified' })), count: names.length, hasMore: false, ...over });
  const props = (over = {}) => ({ filters: FILTERS, count: 2, where: 'Australia', open: false, onOpenChange: vi.fn(), selectedName: undefined, onPick: vi.fn(), ...over });
  beforeEach(() => { fetchStartupPage.mockReset(); fetchStartupPage.mockResolvedValue(page(['Acme', 'Beta'])); });

  it('is a bar with the count and the place when it is shut, and asks for no list', () => {
    const { container } = render(<ResultsSheet {...props({ count: 1 })} />);
    expect(screen.getByRole('button', { name: /1 startup in Australia/ })).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('.xs')).toHaveClass('xs-peek');
    expect(fetchStartupPage).not.toHaveBeenCalled();
  });

  it('asks the page to open and to shut from the bar, and from a swipe up and a swipe down', async () => {
    const p = props();
    render(<ResultsSheet {...p} />);
    const bar = screen.getByRole('button', { name: /startups in Australia/ });
    await userEvent.click(bar);
    expect(p.onOpenChange).toHaveBeenLastCalledWith(true);
    fireEvent.touchStart(bar, { touches: [{ clientY: 500 }] });
    fireEvent.touchEnd(bar, { changedTouches: [{ clientY: 420 }] });
    expect(p.onOpenChange).toHaveBeenLastCalledWith(true);
    fireEvent.touchStart(bar, { touches: [{ clientY: 400 }] });
    fireEvent.touchEnd(bar, { changedTouches: [{ clientY: 480 }] });
    expect(p.onOpenChange).toHaveBeenLastCalledWith(false);
    p.onOpenChange.mockClear();
    fireEvent.touchStart(bar, { touches: [{ clientY: 400 }] });
    fireEvent.touchEnd(bar, { changedTouches: [{ clientY: 410 }] }); // a small movement is a tap, not a swipe
    expect(p.onOpenChange).not.toHaveBeenCalled();
  });

  it('shows the startups when it is open: each with its place and sector, hiring now marked only where the record says it', async () => {
    const { container } = render(<ResultsSheet {...props({ open: true })} />);
    expect(container.querySelector('.xs')).toHaveClass('xs-open');
    expect(await screen.findByRole('button', { name: /^Acme/ })).toHaveTextContent('Sydney · AI');
    expect(screen.getAllByText('Hiring now')).toHaveLength(1);
    expect(within(screen.getByRole('button', { name: /^Acme/ })).getByText('Hiring now')).toBeInTheDocument();
    expect(fetchStartupPage).toHaveBeenCalledWith(FILTERS, expect.objectContaining({ offset: 0, sort: 'name' }));
  });

  it('hands the page the startup that is picked', async () => {
    const p = props({ open: true });
    render(<ResultsSheet {...p} />);
    await userEvent.click(await screen.findByRole('button', { name: /^Beta/ }));
    expect(p.onPick).toHaveBeenCalledWith(expect.objectContaining({ slug: 'beta', name: 'Beta' }));
  });

  it('says so while it loads, when none match, and when the server cannot be reached', async () => {
    fetchStartupPage.mockImplementation(() => new Promise(() => {}));
    const { unmount } = render(<ResultsSheet {...props({ open: true })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading startups');
    unmount();
    fetchStartupPage.mockResolvedValue(page([]));
    const second = render(<ResultsSheet {...props({ open: true, count: 0 })} />);
    expect(await screen.findByText('No startups match your filters.')).toBeInTheDocument();
    second.unmount();
    fetchStartupPage.mockRejectedValue(new Error('down'));
    render(<ResultsSheet {...props({ open: true })} />);
    expect(await screen.findByText('Could not load the startups right now.')).toBeInTheDocument();
  });

  it('shows the next page on "Show more", and says what is left', async () => {
    fetchStartupPage.mockResolvedValueOnce(page(['Acme'], { count: 3, hasMore: true }));
    fetchStartupPage.mockResolvedValueOnce(page(['Beta', 'Cora'], { count: 3, hasMore: false }));
    render(<ResultsSheet {...props({ open: true, count: 3 })} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Show more (2 left)' }));
    expect(await screen.findByRole('button', { name: /^Cora/ })).toBeInTheDocument();
    expect(fetchStartupPage).toHaveBeenLastCalledWith(FILTERS, expect.objectContaining({ offset: 1 }));
    expect(screen.queryByRole('button', { name: /Show more/ })).not.toBeInTheDocument();
  });

  it('marks the startup that is open, and starts the list again when the filters change', async () => {
    const { rerender } = render(<ResultsSheet {...props({ open: true, selectedName: 'Beta' })} />);
    expect(await screen.findByRole('button', { name: /^Beta/ })).toHaveClass('xs-row-on');
    fetchStartupPage.mockResolvedValue(page(['Zed']));
    rerender(<ResultsSheet {...props({ open: true, filters: { ...FILTERS, search: 'z' } })} />);
    expect(await screen.findByRole('button', { name: /^Zed/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Beta/ })).not.toBeInTheDocument();
  });

  it('shows a card in place of the list when it is given one, and asks for no list then', () => {
    const { container } = render(<ResultsSheet {...props({ open: true, detail: <section aria-label="A card">card</section> })} />);
    expect(container.querySelector('.xs')).toHaveClass('xs-detail');
    expect(screen.getByRole('region', { name: 'A card' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /startups in/ })).not.toBeInTheDocument();
    expect(fetchStartupPage).not.toHaveBeenCalled();
  });
});
