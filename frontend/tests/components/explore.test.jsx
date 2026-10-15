import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/api.js', () => ({ fetchStartup: vi.fn(), fetchStartupPage: vi.fn(), fetchSuggestions: vi.fn(), fetchInvestor: vi.fn() }));

import { fetchStartup, fetchStartupPage, fetchSuggestions, fetchInvestor } from '../../src/api.js';
import ExploreHeader from '../../src/components/explore/ExploreHeader.jsx';
import ExploreToolbar, { placeLabel, nextCity } from '../../src/components/explore/ExploreToolbar.jsx';
import AllAustralia from '../../src/components/explore/AllAustralia.jsx';
import VcList from '../../src/components/explore/VcList.jsx';
import StartupPanel from '../../src/components/explore/StartupPanel.jsx';
import VcPanel from '../../src/components/explore/VcPanel.jsx';
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
    expect(screen.getByLabelText(/Search startups/)).toHaveAttribute('placeholder', 'Search startups or investors');
    rerender(<ExploreToolbar {...props} filters={{ ...FILTERS, city: 'Melbourne' }} />);
    expect(screen.getByRole('button', { name: /^Australia/ })).toHaveTextContent('Australia/Melbourne');
    expect(screen.getByLabelText(/Search startups/)).toHaveAttribute('placeholder', 'Search startups or investors in Melbourne');
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

describe('the toolbar: what is shown', () => {
  const META = { sectors: ['AI', 'Fintech'], cities: [], investors: [], stages: [] };
  const VC_OPTIONS = { sectors: [{ value: 'Technology', count: 9 }, { value: 'Deep tech', count: 2 }], stages: [{ value: 'Seed', count: 8 }, { value: 'Series A', count: 6 }] };
  const setup = (over = {}) => {
    const props = {
      filters: FILTERS, onFilterChange: vi.fn(), onApplyFilters: vi.fn(), meta: META, cities: [], total: 41, filtersOpen: false, onToggleFilters: vi.fn(), filtersRef: { current: null },
      viewMode: 'map', onSetViewMode: vi.fn(), entity: 'all', onEntityChange: vi.fn(), vcOptions: VC_OPTIONS, ...over,
    };
    return { props, ...render(<ExploreToolbar {...props} />) };
  };
  beforeEach(() => { fetchSuggestions.mockResolvedValue({ companies: [], people: [], investors: [], industries: [], locations: [] }); });

  it('has All, Startups and VCs, with the one that is on pressed, and hands a press to the page', async () => {
    const { props } = setup({ entity: 'startups' });
    const group = screen.getByRole('group', { name: 'What the map shows' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['All', 'Startups', 'VCs']);
    expect(within(group).getByRole('button', { name: 'Startups' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(within(group).getByRole('button', { name: 'VCs' }));
    expect(props.onEntityChange).toHaveBeenCalledWith('vcs');
  });

  it('asks for what it is searching: startups or investors, startups, or investors', () => {
    const { rerender, props } = setup();
    expect(screen.getByLabelText(/Search startups/)).toHaveAttribute('placeholder', 'Search startups or investors');
    rerender(<ExploreToolbar {...props} entity="startups" />);
    expect(screen.getByLabelText(/Search startups/)).toHaveAttribute('placeholder', 'Search startups');
    rerender(<ExploreToolbar {...props} entity="vcs" filters={{ ...FILTERS, city: 'Sydney' }} />);
    expect(screen.getByLabelText(/Search/)).toHaveAttribute('placeholder', 'Search investors in Sydney');
  });

  it('offers the startups\' sectors for the startups, and the investors\' own sectors and stages when only the VCs are on', async () => {
    const { props, rerender } = setup();
    await userEvent.click(screen.getByRole('button', { name: /^Sector/ }));
    expect(within(screen.getByRole('group', { name: 'Sector' })).getAllByRole('checkbox').map((c) => c.closest('label').textContent)).toEqual(['AI', 'Fintech']);
    expect(screen.queryByRole('button', { name: /^Stage/ })).not.toBeInTheDocument();
    rerender(<ExploreToolbar {...props} entity="vcs" />);
    await userEvent.click(screen.getByRole('button', { name: /^Sector/ }));
    expect(within(screen.getByRole('group', { name: 'Sector' })).getAllByRole('checkbox').map((c) => c.closest('label').textContent)).toEqual(['Technology9', 'Deep tech2']);
    await userEvent.click(screen.getByRole('button', { name: /^Stage/ }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Stage' })).getByRole('checkbox', { name: /Series A/ }));
    expect(props.onFilterChange).toHaveBeenLastCalledWith({ stage: 'Series A' });
  });

  it('does not count the stage on the Filters button while the VCs have a menu of their own for it', () => {
    setup({ entity: 'vcs', filters: { ...FILTERS, stage: 'Seed' } });
    expect(screen.getByRole('button', { name: /^Filters/ }).textContent).toBe('Filters');
  });
});

describe('the way back to all of Australia', () => {
  it('is a button on the map, and hands its press to the page', async () => {
    const onClick = vi.fn();
    render(<AllAustralia onClick={onClick} />);
    await userEvent.click(screen.getByRole('button', { name: 'All Australia' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('the list of VCs', () => {
  const pin = (slug, city, name = slug.toUpperCase()) => ({ id: `${slug}@${city}`, slug, name, domain: `${slug}.vc`, city, stages: ['Seed', 'Series A'], sectors: ['Software', 'Health', 'AI', 'Fintech'] });

  it('is one card for each firm in name order, with its places, its stages and the first of its sectors, and opens the firm\'s page', async () => {
    const onOpen = vi.fn();
    const { container } = render(<VcList pins={[pin('b', 'Sydney', 'Beta'), pin('a', 'Sydney', 'Alpha'), pin('b', 'Melbourne', 'Beta')]} where="Australia" onOpen={onOpen} onOpenDirectory={() => {}} />);
    expect(screen.getByRole('heading', { name: '2 venture capital firms in Australia' })).toBeInTheDocument();
    const cards = [...container.querySelectorAll('li.vl-card')];
    expect(cards.map((c) => within(c).getByRole('button').textContent)).toEqual(['Alpha', 'Beta']);
    expect(cards[1]).toHaveTextContent('Sydney, Melbourne');
    expect(cards[1]).toHaveTextContent('Seed · Series A');
    expect(cards[1]).toHaveTextContent('Software · Health · AI');
    expect(cards[1]).not.toHaveTextContent('Fintech');
    await userEvent.click(within(cards[1]).getByRole('button', { name: 'Beta' }));
    expect(onOpen).toHaveBeenCalledWith('b');
  });

  it('says how many more investors match and have no city that can be placed, and offers the directory', async () => {
    const onOpenDirectory = vi.fn();
    render(<VcList pins={[pin('a', 'Sydney')]} unplaced={6} where="Sydney" onOpen={() => {}} onOpenDirectory={onOpenDirectory} />);
    expect(screen.getByText(/6 more investors match but have no city we can place/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'See every investor in the directory' }));
    expect(onOpenDirectory).toHaveBeenCalledTimes(1);
  });

  it('says there is none, and nothing of what is not placed, when no firm matches', () => {
    render(<VcList pins={[]} where="Hobart" onOpen={() => {}} onOpenDirectory={() => {}} />);
    expect(screen.getByRole('heading', { name: '0 venture capital firms in Hobart' })).toBeInTheDocument();
    expect(screen.getByText(/No venture capital firm with a city on file matches/)).toBeInTheDocument();
    expect(screen.queryByText(/have no city we can place/)).not.toBeInTheDocument();
  });
});

describe('the company\'s panel', () => {
  const PIN = { slug: 'acme', name: 'Acme AI', city: 'Melbourne', sector: 'AI', hiring: false, website: 'https://acme.ai', location: { quality: 'Location: suburb-level' } };
  const RECORD = { slug: 'acme', name: 'Acme AI', sector: 'AI', sectorFull: 'AI infrastructure', blurb: 'Makes things for people.', website: 'https://acme.ai', verified: true, last_verified_at: new Date().toISOString(), hiringState: 'checked', hiring_checked_at: '2026-10-05T03:59:04.292Z' };
  const setup = (over = {}) => {
    const props = { pin: PIN, saved: false, onToggleSaved: vi.fn(), onOpen: vi.fn(), onClose: vi.fn(), onReport: vi.fn(), ...over };
    return { props, ...render(<StartupPanel {...props} />) };
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
    rerender(<StartupPanel {...props} pin={{ ...PIN, slug: 'beta', name: 'Beta' }} />);
    expect(screen.queryByText('Makes things for people.')).not.toBeInTheDocument();
    expect(await screen.findByText('Another one.')).toBeInTheDocument();
  });

  it('has the two things to do with a company: open it, and save it (kept in this browser)', async () => {
    const { props, rerender } = setup();
    await screen.findByText('Makes things for people.'); // the record has arrived: what the main button is depends on it
    await userEvent.click(screen.getByRole('button', { name: /View company/ }));
    expect(props.onOpen).toHaveBeenCalledTimes(1);
    const save = screen.getByRole('button', { name: 'Save Acme AI' });
    expect(save).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(save);
    expect(props.onToggleSaved).toHaveBeenCalledTimes(1);
    rerender(<StartupPanel {...props} saved />);
    expect(screen.getByRole('button', { name: 'Remove Acme AI from saved' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('closes from its own button and with Escape', async () => {
    const { props } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Close this panel' }));
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
    expect(img.getAttribute('width')).toBe('72');
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

describe('the company\'s panel: its tabs, its jobs and its way in', () => {
  const PIN = { slug: 'acme', name: 'Acme AI', city: 'Melbourne', sector: 'AI', hiring: true, website: 'https://acme.ai', location: { place: '1 Example St, Melbourne', quality: 'Office address on file' } };
  const RECORD = {
    slug: 'acme', name: 'Acme AI', sector: 'AI', blurb: 'Makes things for people.', website: 'https://acme.ai', verified: true, last_verified_at: new Date().toISOString(), hiringState: 'hiring',
    open_roles: 3, hiring_source: { url: 'https://boards.acme.ai/jobs', checked_at: '2026-10-05T03:59:04.292Z' }, stage: 'Seed',
  };
  const setup = (over = {}) => {
    const props = { pin: PIN, saved: false, onToggleSaved: vi.fn(), onOpen: vi.fn(), onClose: vi.fn(), onReport: vi.fn(), ...over };
    return { props, ...render(<StartupPanel {...props} />) };
  };
  beforeEach(() => { fetchStartup.mockReset(); fetchStartup.mockResolvedValue(RECORD); });

  it('says what it is with tags (a startup, its sector), its one line, where it is and how well that is known', async () => {
    setup();
    const panel = screen.getByRole('region', { name: 'Acme AI' });
    expect(within(panel).getByText('Startup')).toBeInTheDocument();
    expect(within(panel).getByText('AI')).toBeInTheDocument();
    expect(within(panel).getByText('1 Example St, Melbourne')).toBeInTheDocument();
    expect(within(panel).getByText('Office address on file')).toBeInTheDocument();
    expect(await within(panel).findByText('Makes things for people.')).toBeInTheDocument();
  });

  it('opens on its overview: the website as a link that opens in a new tab, and the stage', async () => {
    setup();
    const link = screen.getByRole('link', { name: /acme\.ai/ });
    expect(link).toHaveAttribute('href', 'https://acme.ai');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(await screen.findByText('Seed')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });

  it('has a Jobs tab with what a page says of its open roles, how many, and the way to them', async () => {
    setup();
    await userEvent.click(screen.getByRole('tab', { name: /^Jobs/ }));
    const jobs = screen.getByRole('tabpanel');
    expect(await within(jobs).findByText(/3 open roles/)).toBeInTheDocument();
    expect(within(jobs).getByRole('link', { name: 'boards.acme.ai' })).toHaveAttribute('href', 'https://boards.acme.ai/jobs');
    expect(within(jobs).getByRole('link', { name: /View open roles/ })).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('tab', { name: /^Jobs/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('makes viewing the open roles its main action when the company is hiring, and keeps View company beside Save', async () => {
    const { props } = setup();
    await screen.findByText('Makes things for people.');
    const roles = screen.getAllByRole('link', { name: /View open roles/ });
    expect(roles[roles.length - 1]).toHaveAttribute('href', 'https://boards.acme.ai/jobs');
    await userEvent.click(screen.getByRole('button', { name: 'View company' }));
    expect(props.onOpen).toHaveBeenCalledTimes(1);
  });

  it('makes View company its main action, and sends nobody to a job page, when the company is not hiring', async () => {
    fetchStartup.mockResolvedValue({ ...RECORD, hiringState: 'none', hiring_source: undefined });
    setup({ pin: { ...PIN, hiring: false } });
    await screen.findByText(/No open roles listed/);
    expect(screen.queryByRole('link', { name: /View open roles|Apply now/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /View company/ })).toHaveLength(1);
  });

  it('says on the Jobs tab that nothing has been read, rather than that nobody is hiring, for a company nobody has read', async () => {
    fetchStartup.mockResolvedValue({ ...RECORD, hiringState: 'unverified', hiring_source: undefined });
    setup({ pin: { ...PIN, hiring: false } });
    await userEvent.click(screen.getByRole('tab', { name: /^Jobs/ }));
    expect(await screen.findByText(/No open roles have been read for this company/)).toBeInTheDocument();
  });
});

describe('the VC\'s panel', () => {
  const PIN = { kind: 'vc', slug: 'oif', id: 'oif@Sydney', name: 'OIF Ventures', city: 'Sydney', website: 'https://oif.vc', location: { precision: 'CITY', place: 'Sydney, NSW', quality: 'City-level: its headquarters city, no address on file' } };
  const RECORD = {
    slug: 'oif', name: 'OIF Ventures', type_label: 'Venture Capital', website: 'https://oif.vc', description: 'Backs software founders.', sectors: ['Software', 'Health'], stages: ['Seed', 'Series A'],
    other_offices: ['Melbourne', 'Brisbane'], verified_at: new Date().toISOString(),
    portfolio: [
      { company: { slug: 'acme', name: 'Acme', city: 'Sydney', sector: 'SaaS', website: 'https://acme.ai' }, round: 'Seed' },
      { company: { slug: 'acme', name: 'Acme', city: 'Sydney', sector: 'SaaS', website: 'https://acme.ai' }, round: 'Series A' },
      { company: { slug: 'beta', name: 'Beta', city: 'Melbourne', sector: 'AI', website: '' } },
    ],
  };
  const setup = (over = {}) => {
    const props = { pin: PIN, saved: false, onToggleSaved: vi.fn(), onClose: vi.fn(), onOpenProfile: vi.fn(), onOpenCompany: vi.fn(), ...over };
    return { props, ...render(<VcPanel {...props} />) };
  };
  beforeEach(() => { fetchInvestor.mockReset(); fetchInvestor.mockResolvedValue(RECORD); });

  it('opens at once with what the mark knows: the name, VC, and the city said as a city with no address behind it', () => {
    fetchInvestor.mockImplementation(() => new Promise(() => {}));
    setup();
    const panel = screen.getByRole('region', { name: 'OIF Ventures' });
    expect(within(panel).getByRole('heading', { name: 'OIF Ventures' })).toBeInTheDocument();
    expect(within(panel).getByText('VC')).toBeInTheDocument();
    expect(within(panel).getByText('Sydney, NSW')).toBeInTheDocument();
    expect(within(panel).getByText('City-level: its headquarters city, no address on file')).toBeInTheDocument();
  });

  it('fills in its investment focus, its stages and its other offices from the record', async () => {
    setup();
    expect(await screen.findByText('Software · Health')).toBeInTheDocument();
    expect(screen.getByText('Seed · Series A')).toBeInTheDocument();
    expect(screen.getByText('Melbourne · Brisbane')).toBeInTheDocument();
    expect(screen.getByText('Venture Capital')).toBeInTheDocument();
    expect(screen.getByText('Backs software founders.')).toBeInTheDocument();
    expect(fetchInvestor).toHaveBeenCalledWith('oif', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('lists the street addresses its pages give, each under its city, and shows none when the record gives none', async () => {
    fetchInvestor.mockResolvedValue({
      ...RECORD,
      office_addresses: [
        { city: 'Melbourne', address: '15 Dover St, Cremorne VIC 3121', located: true },
        { city: 'Sydney', address: 'Level 1, 111 Albion Street, Surry Hills NSW 2010', located: false },
      ],
    });
    const { unmount } = setup();
    const term = await screen.findByText('Addresses', { selector: 'dt' });
    const list = term.parentElement.querySelector('ul.xp-addresses');
    expect([...list.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['Melbourne 15 Dover St, Cremorne VIC 3121', 'Sydney Level 1, 111 Albion Street, Surry Hills NSW 2010']);
    unmount();
    fetchInvestor.mockResolvedValue({ ...RECORD, office_addresses: [] });
    setup();
    await screen.findByText('Melbourne · Brisbane');
    expect(screen.queryByText('Addresses', { selector: 'dt' })).toBeNull();
  });

  it('shows the address a mark stands at in its place line, in the words of its page, with the exact-address wording', () => {
    fetchInvestor.mockImplementation(() => new Promise(() => {}));
    setup({ pin: { ...PIN, id: 'oif@Melbourne#1', city: 'Melbourne', location: { precision: 'EXACT', place: '15 Dover St, Cremorne VIC 3121', quality: 'Office address from its own website' } } });
    const panel = screen.getByRole('region', { name: 'OIF Ventures' });
    expect(within(panel).getByText('15 Dover St, Cremorne VIC 3121')).toBeInTheDocument();
    expect(within(panel).getByText('Office address from its own website')).toBeInTheDocument();
    expect(within(panel).queryByText(/no address on file/)).toBeNull();
  });

  it('lists the companies a page says it backed, each once, and opens one from its name', async () => {
    const { props } = setup();
    expect(await screen.findByRole('heading', { name: 'Portfolio (2)' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Beta/ }));
    expect(props.onOpenCompany).toHaveBeenCalledWith(expect.objectContaining({ slug: 'beta', name: 'Beta' }));
    expect(screen.getAllByRole('button', { name: /^Acme/ })).toHaveLength(1);
  });

  it('says so when no company is linked to it, and when the record cannot be fetched', async () => {
    fetchInvestor.mockResolvedValue({ ...RECORD, portfolio: [] });
    const { unmount } = setup();
    expect(await screen.findByText(/No company in the directory is linked to this investor by a page yet/)).toBeInTheDocument();
    unmount();
    fetchInvestor.mockRejectedValue(new Error('down'));
    setup();
    expect(await screen.findByText(/Could not load the rest of this investor/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'OIF Ventures' })).toBeInTheDocument();
  });

  it('says "Not stated" for a focus no source gives, never a guess', async () => {
    fetchInvestor.mockResolvedValue({ ...RECORD, sectors: [], stages: [], other_offices: [] });
    setup();
    expect(await screen.findByText('Not stated')).toBeInTheDocument();
  });

  it('opens the investor\'s own page, saves the investor, and closes from its button and with Escape', async () => {
    const { props } = setup();
    await userEvent.click(screen.getByRole('button', { name: /View investor profile/ }));
    expect(props.onOpenProfile).toHaveBeenCalledWith('oif');
    await userEvent.click(screen.getByRole('button', { name: 'Save OIF Ventures' }));
    expect(props.onToggleSaved).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Close this panel' }));
    await userEvent.keyboard('{Escape}');
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it('links its website out in a new tab, and writes its name as text', () => {
    fetchInvestor.mockImplementation(() => new Promise(() => {}));
    const evil = '<img src=x onerror=alert(1)>';
    const { container } = setup({ pin: { ...PIN, name: evil } });
    expect(screen.getByRole('link', { name: /oif\.vc/ })).toHaveAttribute('target', '_blank');
    expect(container.querySelector('.xp-name img')).toBeNull();
    expect(screen.getByRole('heading', { name: evil })).toBeInTheDocument();
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

  describe('with the VCs on', () => {
    const FIRMS = [
      { slug: 'oif', name: 'OIF Ventures', domain: 'oif.vc', places: ['Sydney', 'Melbourne'], stages: [], sectors: [], pin: { id: 'oif@Sydney', slug: 'oif', name: 'OIF Ventures', lat: -33.87, lng: 151.21, city: 'Sydney', place: 'Sydney, NSW' } },
    ];

    it('counts the startups and the VCs in the bar, and lists the investors after the startups when it is open', async () => {
      const p = props({ open: true, entity: 'all', vcFirms: FIRMS, onPickVc: vi.fn() });
      render(<ResultsSheet {...p} />);
      expect(screen.getByRole('button', { name: /2 startups · 1 VC in Australia/ })).toBeInTheDocument();
      expect(await screen.findByRole('heading', { name: 'Venture capital firms' })).toBeInTheDocument();
      const row = screen.getByRole('button', { name: /^OIF Ventures/ });
      expect(row).toHaveTextContent('Sydney, Melbourne');
      expect(row).toHaveTextContent('VC');
      await userEvent.click(row);
      expect(p.onPickVc).toHaveBeenCalledWith(FIRMS[0].pin);
    });

    it('counts only the VCs, lists only them, and asks for no startups, when only the VCs are on', async () => {
      render(<ResultsSheet {...props({ open: true, entity: 'vcs', vcFirms: FIRMS, onPickVc: vi.fn() })} />);
      expect(screen.getByRole('button', { name: /1 VC in Australia/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^OIF Ventures/ })).toBeInTheDocument();
      expect(fetchStartupPage).not.toHaveBeenCalled();
      expect(screen.queryByRole('heading', { name: 'Venture capital firms' })).not.toBeInTheDocument();
    });

    it('says so when no VC matches, with only the VCs on', () => {
      render(<ResultsSheet {...props({ open: true, entity: 'vcs', vcFirms: [] })} />);
      expect(screen.getByText(/No venture capital firm with a city on file matches/)).toBeInTheDocument();
    });

    it('shows the startups alone when only the startups are on, whatever firms it is given', async () => {
      render(<ResultsSheet {...props({ open: true, entity: 'startups', vcFirms: FIRMS })} />);
      expect(await screen.findByRole('button', { name: /^Acme/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^OIF Ventures/ })).not.toBeInTheDocument();
    });
  });
});
