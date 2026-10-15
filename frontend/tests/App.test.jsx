import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../src/api.js', () => ({
  fetchStartupPage: vi.fn(),
  exportUrl: vi.fn(() => '/api/startups/export.csv'),
  fetchSummary: vi.fn(),
  fetchMarkers: vi.fn(),
  fetchInstitutionPins: vi.fn(),
  fetchInvestorPins: vi.fn(),
  fetchInvestorMeta: vi.fn(),
  fetchInvestor: vi.fn(),
  fetchInvestors: vi.fn(),
  fetchStartup: vi.fn(),
  fetchStartupsByName: vi.fn(),
  fetchPerson: vi.fn(),
  fetchSuggestions: vi.fn(),
  fetchMeta: vi.fn(),
  fetchNews: vi.fn(),
  submitStartup: vi.fn(),
  DIRECTORY_URL: '/directory',
}));

vi.mock('../src/components/MapView.jsx', () => ({
  default: ({ markers, areas = [], onSelectStartup, onSelectPin, onClearPin, onViewArea, institutionPins = [], showCompanies, showInstitutions, showVcs, vcPins = [], scope, focus, selectedName, onViewChange, onOpenInternal, onReportRoleClosed, previewAt, previewCard }) => (
    <div
      data-testid="map-view"
      data-count={markers.length}
      data-vcs={vcPins.length}
      data-show-vcs={String(showVcs)}
      data-areas={areas.map((a) => `${a.label}:${a.count}`).join(',')}
      data-scope={scope}
      data-focus={focus ? JSON.stringify(focus) : ''}
      data-selected={selectedName ?? ''}
      data-institutions={institutionPins.length}
      data-show-companies={String(showCompanies)}
      data-show-institutions={String(showInstitutions)}
      data-preview-at={previewAt ? JSON.stringify(previewAt) : ''}
    >
      <button onClick={() => onOpenInternal('/investors/blackbird')}>trigger-open-firm</button>
      <button onClick={() => onReportRoleClosed('Canva')}>trigger-report-role-closed</button>
      <button onClick={() => onSelectStartup({ slug: 'canva', name: 'Canva', sector: 'AI', hiring: true })}>trigger-select</button>
      <button onClick={() => onSelectStartup({ name: 'Bare Co', sector: 'AI' })}>trigger-select-bare</button>
      <button onClick={() => onSelectPin({ slug: 'canva', name: 'Canva', city: 'Sydney', sector: 'AI', lat: -33.8, lng: 151.2, hiring: true, website: 'https://canva.com', location: { quality: 'Verified office' } })}>trigger-pin</button>
      <button onClick={() => onSelectPin({ slug: 'zeller', name: 'Zeller', city: 'Melbourne', sector: 'Fintech', lat: -37.8, lng: 144.9, hiring: false, website: 'https://zeller.com', location: { quality: 'City-level' } })}>trigger-pin-quiet</button>
      <button onClick={() => onSelectPin({ kind: 'vc', slug: 'oif', id: 'oif@Sydney', name: 'OIF Ventures', city: 'Sydney', lat: -33.87, lng: 151.21, website: 'https://oif.vc', location: { precision: 'CITY', place: 'Sydney, NSW', quality: 'City-level: its headquarters city, no address on file' } })}>trigger-vc-pin</button>
      <button onClick={() => onClearPin()}>trigger-clear-pin</button>
      <button onClick={() => onViewChange({ lat: -33.8, lng: 151.2, zoom: 9 })}>trigger-move</button>
      <button onClick={() => onViewArea({ kind: 'CITY', label: 'Sydney', city: 'Sydney', state: 'NSW', count: 3 })}>trigger-view-area</button>
      <button onClick={() => onViewArea({ kind: 'STATE', label: 'Victoria', city: null, state: 'VIC', count: 2 })}>trigger-view-state</button>
      {previewAt && previewCard && <div data-testid="preview-slot">{previewCard}</div>}
    </div>
  ),
}));

vi.mock('../src/components/StartupDetailPanel.jsx', () => ({
  default: ({ startup, onSuggestEdit, onSelectPerson, onOpenInvestor, onClose }) => (
    <div data-testid="startup-detail-panel" data-partial={String(Boolean(startup.partial))}>
      <span>{startup.name}</span>
      {startup.founders && <span data-testid="founders">{startup.founders.join(',')}</span>}
      <button onClick={() => onSuggestEdit(startup.name)}>trigger-suggest-edit</button>
      <button onClick={() => onSelectPerson('Melanie Perkins')}>trigger-person</button>
      <button onClick={() => onOpenInvestor('blackbird')}>trigger-open-investor</button>
      <button onClick={onClose}>trigger-detail-close</button>
    </div>
  ),
}));

vi.mock('../src/components/JobsView.jsx', () => ({
  default: ({ chrome }) => (
    <div data-testid="jobs-view" data-hiring={chrome?.counts?.jobs}>
      <button onClick={() => chrome.go.explore()}>trigger-jobs-close</button>
    </div>
  ),
}));

vi.mock('../src/components/investors/InvestorsView.jsx', () => ({
  default: ({ initialRoute, fromLink, onClose, onOpenCompany, chrome }) => (
    <div data-testid="investors-view" data-route={JSON.stringify(initialRoute)} data-from-link={String(Boolean(fromLink))} data-hiring={chrome?.counts?.jobs}>
      <button onClick={onClose}>trigger-investors-close</button>
      <button onClick={() => chrome.go.jobs()}>trigger-investors-jobs</button>
      <button onClick={() => chrome.menu.onShowAbout()}>trigger-investors-about</button>
      <button onClick={() => chrome.menu.onShowPrivacy()}>trigger-investors-privacy</button>
      <button onClick={() => chrome.menu.onShowFeedback()}>trigger-investors-feedback</button>
      <button onClick={() => chrome.menu.onShowWaitlist()}>trigger-investors-waitlist</button>
      <button onClick={() => chrome.go.saved()}>trigger-investors-tracked</button>
      <button onClick={() => chrome.go.collections()}>trigger-investors-lists</button>
      <button onClick={() => onOpenCompany({ slug: 'canva', name: 'Canva', sector: 'AI' })}>trigger-investors-company</button>
    </div>
  ),
}));

vi.mock('../src/components/people/PeopleView.jsx', () => ({
  default: ({ chrome, onOpenCompany, onOpenInternal }) => (
    <div data-testid="people-view">
      <button onClick={() => chrome.go.explore()}>trigger-people-close</button>
      <button onClick={() => onOpenCompany({ slug: 'canva', name: 'Canva', sector: 'AI' })}>trigger-people-company</button>
      <button onClick={() => onOpenInternal('/investors/blackbird')}>trigger-people-investor</button>
    </div>
  ),
}));

vi.mock('../src/components/CuratedLists.jsx', () => ({
  default: ({ currentFilters, onApply, chrome }) => (
    <div data-testid="curated-lists" data-current={JSON.stringify(currentFilters)}>
      <button onClick={() => onApply({ id: 'au-fintech', name: 'Australian Fintech Startups', description: 'Fintech.', filters: { sector: 'Fintech' } })}>trigger-apply-list</button>
      <button onClick={() => chrome.go.explore()}>trigger-curated-close</button>
    </div>
  ),
}));

import {
  fetchStartupPage, fetchSummary, fetchMarkers, fetchInstitutionPins, fetchInvestorPins, fetchInvestorMeta, fetchInvestor, fetchInvestors, fetchStartup, fetchStartupsByName, fetchPerson, fetchSuggestions, fetchMeta, fetchNews,
} from '../src/api.js';
import App from '../src/App.jsx';

const meta = {
  sectors: ['Fintech', 'AI'],
  cities: ['Sydney'],
  investors: ['Blackbird'],
  stages: ['Seed'],
};

const EMPTY = { search: '', sector: '', city: '', investor: '', stage: '', hiring: '', taskGate: '', events: '', precision: '', state: '', remote: '', tech: '', team: '', fresh: '' };
const card = (name, overrides = {}) => ({
  name, slug: name.toLowerCase().replace(/\s+/g, '-'), sector: 'AI', sectorFull: 'AI', city: 'Sydney', stage: 'Seed', hiring: true, verified: true, ...overrides,
});
const pin = (slug, name) => [slug, name, -33.8, 151.2, 'AI', 'Sydney', 1, ''];
const summaryOf = (overrides = {}) => ({
  count: 2, pinned: 2, unverified: 0, hiring: 2, taskGated: 0, cities: 1,
  topCities: [], notable: { total: 0, items: [] }, vouched: { total: 0, items: [] }, ...overrides,
});
const page = (results) => ({ total: 2, count: results.length, results, offset: 0, limit: 48, hasMore: false });

async function openFilters() {
  await userEvent.click(screen.getByRole('button', { name: /^Filters/ }));
}

// The layers, the basemap and the key are in the filter panel's Map tab.
async function openMapTab() {
  await openFilters();
  await userEvent.click(screen.getByRole('tab', { name: 'Map' }));
}

// A phone: the query for a wide screen does not match, so the company's card is in the bottom sheet.
const phone = () => vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })));

// A value of a filter of several (Sector, City): open the box and tick it.
async function tick(label, name) {
  const group = screen.getByRole('group', { name: label });
  await userEvent.click(group.querySelector('summary'));
  await userEvent.click(within(group).getByRole('checkbox', { name }));
}

async function openMenu() {
  await userEvent.click(screen.getByLabelText('Menu'));
  // The mobile menu repeats some nav-center labels (Lists, News) verbatim for
  // small screens; jsdom doesn't apply the CSS that hides one or the other by
  // viewport, so scope queries to the open panel to disambiguate.
  return within(document.querySelector('.hdr-menu-panel'));
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/'); // the app writes its page and filters in the address: each test starts at the root
    localStorage.clear();
    fetchMeta.mockResolvedValue(meta);
    fetchSummary.mockResolvedValue(summaryOf());
    fetchMarkers.mockResolvedValue({ total: 2, count: 2, pinned: 2, items: [pin('canva', 'Canva'), pin('zeller', 'Zeller')] });
    fetchInstitutionPins.mockResolvedValue({ count: 0, items: [] });
    fetchInvestorPins.mockResolvedValue({ total: 0, count: 0, pinned: 0, unplaced: 0, items: [] });
    fetchInvestorMeta.mockResolvedValue({ sectors: [], stages: [] });
    fetchInvestors.mockResolvedValue({ results: [] });
    fetchStartupPage.mockResolvedValue(page([card('Canva'), card('Zeller')]));
    fetchStartup.mockImplementation(async (slug) => ({ slug, name: 'Canva', sector: 'AI', founders: ['Melanie Perkins'], investors: ['Blackbird'] }));
    fetchStartupsByName.mockResolvedValue({ results: [] });
    fetchPerson.mockResolvedValue({ name: 'Melanie Perkins', companies: [] });
    fetchSuggestions.mockResolvedValue({ companies: [], people: [], investors: [], industries: [], locations: [] });
    fetchNews.mockResolvedValue({ source: 'live', deals: [] });
  });

  describe('what it asks the server for', () => {
    it('loads the filter options, the whole directory\'s counts, this view\'s counts and the map\'s pins on mount, and never the whole list', async () => {
      render(<App />);
      await waitFor(() => expect(fetchMeta).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(fetchMarkers).toHaveBeenCalled());
      expect(fetchSummary).toHaveBeenCalledWith({}, expect.objectContaining({ onSnapshot: expect.any(Function) }));
      expect(fetchSummary).toHaveBeenCalledWith(EMPTY, expect.objectContaining({ signal: expect.any(AbortSignal) }));
      expect(fetchMarkers).toHaveBeenCalledWith(EMPTY, expect.objectContaining({ signal: expect.any(AbortSignal) }));
      await waitFor(() => expect(fetchStartupPage).toHaveBeenCalled());
      for (const [, options] of fetchStartupPage.mock.calls) expect(options).toMatchObject({ offset: 0, limit: expect.any(Number) }); // one page for the results beside the map, never the whole list
    });

    it('draws the map from the pins, and tells it which city it is on', async () => {
      render(<App />);
      await waitFor(() => expect(screen.getByTestId('map-view').dataset.count).toBe('2'));
      expect(screen.getByTestId('map-view').dataset.scope).toBe('');
    });

    it('asks for fresh counts and pins once typing in the search box pauses, not for every letter', async () => {
      render(<App />);
      await waitFor(() => expect(fetchMarkers).toHaveBeenCalledWith(EMPTY, expect.anything()));
      fetchMarkers.mockClear();

      await userEvent.type(screen.getByLabelText(/Search startups/), 'abc');
      await waitFor(() => expect(fetchMarkers).toHaveBeenLastCalledWith({ ...EMPTY, search: 'abc' }, expect.anything()));
      expect(fetchMarkers.mock.calls.map(([f]) => f.search)).not.toContain('a');
      expect(fetchMarkers.mock.calls.map(([f]) => f.search)).not.toContain('ab');
    });

    it('applies a dropdown filter at once', async () => {
      render(<App />);
      await waitFor(() => expect(fetchMarkers).toHaveBeenCalled());
      await openFilters();
      await tick('Sector', 'Fintech');
      await waitFor(() => expect(fetchMarkers).toHaveBeenLastCalledWith({ ...EMPTY, sector: 'Fintech' }, expect.anything()));
      expect(fetchSummary).toHaveBeenLastCalledWith({ ...EMPTY, sector: 'Fintech' }, expect.anything());
    });

    it('resets filters back to empty when Clear all is clicked', async () => {
      render(<App />);
      await waitFor(() => expect(fetchMarkers).toHaveBeenCalled());

      await userEvent.type(screen.getByLabelText(/Search startups/), 'x');
      await waitFor(() => expect(fetchMarkers).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'x' }), expect.anything()));

      await openFilters();
      await userEvent.click(screen.getByText('Clear all'));
      await waitFor(() => expect(fetchMarkers).toHaveBeenLastCalledWith(EMPTY, expect.anything()));
    });

    it('asks for pins only while the map is showing, and for the list only while the list is', async () => {
      render(<App />);
      await waitFor(() => expect(fetchMarkers).toHaveBeenCalledTimes(1));

      await userEvent.click(screen.getByRole('button', { name: 'List' }));
      await waitFor(() => expect(fetchStartupPage).toHaveBeenCalled());
      fetchMarkers.mockClear();
      await userEvent.type(screen.getByLabelText(/Search startups/), 'z');
      await waitFor(() => expect(fetchStartupPage).toHaveBeenLastCalledWith({ ...EMPTY, search: 'z' }, expect.objectContaining({ offset: 0 })));
      expect(fetchMarkers).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole('button', { name: 'Map' }));
      await waitFor(() => expect(fetchMarkers).toHaveBeenCalledWith({ ...EMPTY, search: 'z' }, expect.anything()));
    });

    it('seeds filters from the URL query string on load and fetches with them applied', async () => {
      window.history.pushState({}, '', '/?sector=Fintech&city=Sydney');
      render(<App />);
      await waitFor(() => expect(fetchMarkers).toHaveBeenCalledWith({ ...EMPTY, sector: 'Fintech', city: 'Sydney' }, expect.anything()));
      window.history.pushState({}, '', '/');
    });

    it('applying a curated list replaces the active filters (not merging with whatever was set) and shows it as a list', async () => {
      render(<App />);
      await userEvent.type(screen.getByLabelText(/Search startups/), 'x');
      await waitFor(() => expect(fetchMarkers).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'x' }), expect.anything()));

      const menu = await openMenu();
      await userEvent.click(menu.getByText('Collections'));
      await userEvent.click(screen.getByText('trigger-apply-list'));

      expect(screen.queryByTestId('curated-lists')).not.toBeInTheDocument();
      await waitFor(() => expect(fetchStartupPage).toHaveBeenLastCalledWith({ ...EMPTY, sector: 'Fintech' }, expect.objectContaining({ offset: 0 })));
      expect(screen.queryByTestId('map-view')).not.toBeInTheDocument();
      expect(window.location.pathname).toBe('/lists/au-fintech'); // the list has an address of its own
    });

    it('falls back to an empty map and zero counts if the server cannot be reached', async () => {
      fetchMarkers.mockRejectedValue(new Error('network error'));
      fetchSummary.mockRejectedValue(new Error('network error'));
      render(<App />);
      await waitFor(() => expect(screen.getByTestId('map-view').dataset.count).toBe('0'));
      expect(screen.getByRole('link', { name: /^Jobs/ }).textContent).toBe('Jobs');
    });
  });

  describe('companies known only to a city or a state', () => {
    const groups = [{ kind: 'CITY', label: 'Sydney', city: 'Sydney', state: 'NSW', lat: -33.87, lng: 151.21, count: 3, sample: [] }];

    it('hands the map the groups the server sent with the pins, and none when the server sends none', async () => {
      fetchMarkers.mockResolvedValue({ total: 2, count: 2, pinned: 2, items: [pin('canva', 'Canva')], areas: groups, unplaced: 0 });
      render(<App />);
      await waitFor(() => expect(screen.getByTestId('map-view').dataset.areas).toBe('Sydney:3'));
      cleanup();
      fetchMarkers.mockResolvedValue({ total: 2, count: 2, pinned: 2, items: [pin('canva', 'Canva')] }); // a server from before groups
      render(<App />);
      await waitFor(() => expect(screen.getByTestId('map-view').dataset.count).toBe('1'));
      expect(screen.getByTestId('map-view').dataset.areas).toBe('');
    });

    it('opens a group as a list of exactly those companies, and says what the list is narrowed to', async () => {
      render(<App />);
      await waitFor(() => expect(fetchMarkers).toHaveBeenCalled());
      await userEvent.click(screen.getByText('trigger-view-area'));
      await waitFor(() => expect(fetchStartupPage).toHaveBeenLastCalledWith({ ...EMPTY, city: 'Sydney', precision: 'CITY' }, expect.objectContaining({ offset: 0 })));
      expect(screen.queryByTestId('map-view')).not.toBeInTheDocument();
      expect(await screen.findByText('City-level locations in Sydney')).toBeInTheDocument();
    });

    it('opens a state group the same way, by the state', async () => {
      render(<App />);
      await waitFor(() => expect(fetchMarkers).toHaveBeenCalled());
      await userEvent.click(screen.getByText('trigger-view-state'));
      await waitFor(() => expect(fetchStartupPage).toHaveBeenLastCalledWith({ ...EMPTY, state: 'VIC', precision: 'STATE' }, expect.objectContaining({ offset: 0 })));
      expect(await screen.findByText('State-level locations in VIC')).toBeInTheDocument();
    });

    it('keeps the filters already chosen when a group is opened, and widens the list again with "Show every location"', async () => {
      render(<App />);
      await waitFor(() => expect(fetchMarkers).toHaveBeenCalled());
      await openFilters();
      await tick('Sector', 'Fintech');
      await userEvent.click(screen.getByText('Apply filters'));
      await userEvent.click(screen.getByText('trigger-view-area'));
      await waitFor(() => expect(fetchStartupPage).toHaveBeenLastCalledWith({ ...EMPTY, sector: 'Fintech', city: 'Sydney', precision: 'CITY' }, expect.objectContaining({ offset: 0 })));
      await userEvent.click(await screen.findByText('Show every location'));
      await waitFor(() => expect(fetchStartupPage).toHaveBeenLastCalledWith({ ...EMPTY, sector: 'Fintech' }, expect.objectContaining({ offset: 0 })));
      expect(screen.queryByText('Show every location')).not.toBeInTheDocument();
    });

    it('takes the kind of location and the state from the address bar, so a list of one group can be shared', async () => {
      window.history.pushState({}, '', '/?precision=CITY&city=Sydney');
      render(<App />);
      await waitFor(() => expect(fetchMarkers).toHaveBeenCalledWith({ ...EMPTY, city: 'Sydney', precision: 'CITY' }, expect.anything()));
      window.history.pushState({}, '', '/');
    });
  });

  describe('counts', () => {
    it('says how many are hiring on the Jobs link, from the whole directory and not just the current filters', async () => {
      fetchSummary.mockImplementation(async (filters) => (Object.values(filters).some(Boolean) ? summaryOf({ count: 1, hiring: 1 }) : summaryOf({ hiring: 70 })));
      window.history.pushState({}, '', '/?city=Sydney');
      render(<App />);
      const jobsButton = await screen.findByRole('link', { name: 'Jobs' });
      await waitFor(() => expect(jobsButton).toHaveAttribute('title', '70 hiring now'));
      const menu = await openMenu();
      expect(menu.getByText('Jobs', { exact: false })).toHaveTextContent('Jobs · 70 hiring now');
      window.history.pushState({}, '', '/');
    });

    it('omits the hiring hint entirely when nobody is hiring, rather than showing "0 hiring now"', async () => {
      fetchSummary.mockResolvedValue(summaryOf({ hiring: 0 }));
      render(<App />);
      await waitFor(() => expect(fetchSummary).toHaveBeenCalledTimes(2));
      expect(screen.getByRole('link', { name: 'Jobs' })).not.toHaveAttribute('title');
      const menu = await openMenu();
      expect(menu.getByText('Jobs').textContent).toBe('Jobs');
    });

    it('switches the main canvas from the map to the list and back with the Map | List switch', async () => {
      render(<App />);
      expect(await screen.findByTestId('map-view')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Map' })).toHaveAttribute('aria-pressed', 'true');

      await userEvent.click(screen.getByRole('button', { name: 'List' }));
      expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.queryByTestId('map-view')).not.toBeInTheDocument();
      expect(await screen.findByRole('heading', { name: 'Zeller' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Canva' })).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Map' }));
      expect(screen.getByTestId('map-view')).toBeInTheDocument();
    });

    it('offers the map\'s key in the filter panel\'s Map tab over the map, and no Map tab over the list', async () => {
      render(<App />);
      await openMapTab();
      expect(screen.getByRole('region', { name: 'Map key' })).toBeInTheDocument();
      expect(screen.queryByRole('group', { name: 'Map layers' })).not.toBeInTheDocument(); // no firms' offices to switch

      await userEvent.click(screen.getByRole('button', { name: 'List' }));
      expect(screen.queryByRole('tab', { name: 'Map' })).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Map key' })).not.toBeInTheDocument();
    });

    describe('the map\'s layers and basemap', () => {
      const FIRM = { id: 'blackbird#0', institution: 'blackbird', name: 'Blackbird', lat: -33.87, lng: 151.21, city: 'Sydney', state: 'NSW', place: null, office: 'Sydney', website: 'https://www.blackbird.vc', href: '/investors/blackbird' };
      const map = () => screen.getByTestId('map-view');

      it('has no Companies switch (the toolbar says which of the startups and the VCs are drawn), and no layers at all while there are no offices of firms to draw', async () => {
        render(<App />);
        await openMapTab();
        expect(screen.queryByRole('group', { name: 'Map layers' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Companies' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Institutions/ })).not.toBeInTheDocument();
        expect(map()).toHaveAttribute('data-institutions', '0');
      });

      it('asks for the firms\' offices once, hands them to the map, and offers an Institutions switch with how many there are', async () => {
        fetchInstitutionPins.mockResolvedValue({ count: 1, items: [FIRM] });
        render(<App />);
        await openMapTab();
        const group = screen.getByRole('group', { name: 'Map layers' });
        const firms = await within(group).findByRole('button', { name: /Institutions/ });
        expect(firms).toHaveTextContent('1');
        expect(map()).toHaveAttribute('data-institutions', '1');
        expect(fetchInstitutionPins).toHaveBeenCalledTimes(1);
      });

      it('switches the firms\' layer off and on, tells the map, and remembers it in this browser', async () => {
        fetchInstitutionPins.mockResolvedValue({ count: 1, items: [FIRM] });
        const first = render(<App />);
        await openMapTab();
        const group = screen.getByRole('group', { name: 'Map layers' });
        await within(group).findByRole('button', { name: /Institutions/ });
        expect(map()).toHaveAttribute('data-show-institutions', 'true');
        await userEvent.click(within(group).getByRole('button', { name: /Institutions/ }));
        expect(map()).toHaveAttribute('data-show-institutions', 'false');
        expect(JSON.parse(localStorage.getItem('auStartupMapLayers'))).toEqual({ institutions: false });
        first.unmount();
        cleanup();
        render(<App />);
        await screen.findByTestId('map-view');
        expect(screen.getByTestId('map-view')).toHaveAttribute('data-show-institutions', 'false');
      });

      it('has one map background: no basemap to choose, none kept in this browser', async () => {
        render(<App />);
        await openMapTab();
        expect(screen.queryByRole('button', { name: /dark map|light map/i })).not.toBeInTheDocument();
        expect(map()).not.toHaveAttribute('data-basemap');
        expect(localStorage.getItem('auStartupBasemap')).toBeNull();
      });

      it('opens a firm\'s own page in the app from its card on the map', async () => {
        render(<App />);
        await screen.findByTestId('map-view');
        await userEvent.click(screen.getByRole('button', { name: 'trigger-open-firm' }));
        expect(await screen.findByTestId('investors-view')).toBeInTheDocument();
      });

      it('has neither the layers nor the basemap over the list', async () => {
        render(<App />);
        await openMapTab();
        await userEvent.click(screen.getByRole('button', { name: 'List' }));
        expect(screen.queryByRole('group', { name: 'Map layers' })).not.toBeInTheDocument();
      });

      it('carries on with no firms when they cannot be fetched', async () => {
        fetchInstitutionPins.mockRejectedValue(new Error('down'));
        render(<App />);
        await screen.findByTestId('map-view');
        expect(map()).toHaveAttribute('data-institutions', '0');
      });
    });

    describe('the panel on the left', () => {
      afterEach(() => { vi.unstubAllGlobals(); });

      it('is shut when the page opens, whatever the screen, with the map clear', async () => {
        const { container } = render(<App />);
        await waitFor(() => expect(fetchMarkers).toHaveBeenCalled());
        expect(screen.queryByRole('complementary', { name: 'Filters and cities' })).not.toBeInTheDocument();
        expect(container.querySelector('#app')).not.toHaveClass('panel-open');
        expect(screen.getByRole('button', { name: /^Filters/ })).toHaveAttribute('aria-expanded', 'false');
      });

      it('opens from the Filters button, and the page moves the map\'s own cards aside for it', async () => {
        const { container } = render(<App />);
        await waitFor(() => expect(fetchMarkers).toHaveBeenCalled());
        await openFilters();
        expect(await screen.findByRole('complementary', { name: 'Filters and cities' })).toBeInTheDocument();
        expect(container.querySelector('#app')).toHaveClass('panel-open');
        expect(screen.getByRole('button', { name: /^Filters/ })).toHaveAttribute('aria-expanded', 'true');
        await userEvent.click(screen.getByLabelText('Close'));
        expect(container.querySelector('#app')).not.toHaveClass('panel-open');
      });

      it('gives focus back to the Filters button when it is closed with Escape, and is a sheet from the bottom on a phone', async () => {
        phone();
        render(<App />);
        await waitFor(() => expect(fetchMarkers).toHaveBeenCalled());
        await openFilters();
        expect(await screen.findByRole('complementary', { name: 'Filters and cities' })).toBeInTheDocument();
        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('complementary', { name: 'Filters and cities' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Filters/ })).toHaveFocus();
      });
    });

    it('gives the filter panel the number of matches, and its Cities tab the cities the server counted', async () => {
      fetchSummary.mockResolvedValue(summaryOf({ count: 41, topCities: [{ city: 'Sydney', count: 30 }, { city: 'Melbourne', count: 11 }] }));
      render(<App />);
      await waitFor(() => expect(fetchSummary).toHaveBeenCalledTimes(2));
      await openFilters();
      expect(await screen.findByText('41 startups match your filters')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('tab', { name: 'Cities' }));
      const items = within(document.getElementById('leaderboardList')).getAllByRole('listitem');
      expect(items[0]).toHaveTextContent('Sydney');
      expect(items[0]).toHaveTextContent('30');
    });
  });

  describe('opening things', () => {
    it('opens the unconfirmed-location list showing the unverified startups the server finds, via the More menu', async () => {
      fetchSummary.mockResolvedValue(summaryOf({ unverified: 1 }));
      fetchStartupPage.mockImplementation(async (filters) => (filters.verified === 'no' ? { ...page([card('Mystery Co', { verified: false })]), count: 1 } : page([card('Canva')])));
      render(<App />);
      await waitFor(() => expect(fetchMarkers).toHaveBeenCalled());

      await openMenu();
      expect(await screen.findByText('Unconfirmed (1)')).toBeInTheDocument();
      await userEvent.click(screen.getByText('Unconfirmed (1)'));
      expect(await screen.findByText('Unconfirmed location (1)')).toBeInTheDocument();
      expect(screen.getByText('Mystery Co')).toBeInTheDocument();
    });

    it('opens the startup detail panel at once when a pin is selected, then fills it in with the full record', async () => {
      let release;
      fetchStartup.mockImplementationOnce(() => new Promise((r) => { release = r; }));
      render(<App />);
      await userEvent.click(screen.getByText('trigger-select'));
      expect(screen.getByTestId('startup-detail-panel')).toHaveAttribute('data-partial', 'true');
      expect(within(screen.getByTestId('startup-detail-panel')).getByText('Canva')).toBeInTheDocument();
      expect(screen.queryByTestId('founders')).not.toBeInTheDocument();
      expect(fetchStartup).toHaveBeenCalledWith('canva');

      release({ slug: 'canva', name: 'Canva', sector: 'AI', founders: ['Melanie Perkins'] });
      await waitFor(() => expect(screen.getByTestId('startup-detail-panel')).toHaveAttribute('data-partial', 'false'));
      expect(screen.getByTestId('founders')).toHaveTextContent('Melanie Perkins');

      await userEvent.click(screen.getByText('trigger-detail-close'));
      expect(screen.queryByTestId('startup-detail-panel')).not.toBeInTheDocument();
    });

    it('keeps what it has when the full record cannot be fetched, and drops it if another company was opened meanwhile', async () => {
      fetchStartup.mockRejectedValueOnce(new Error('down'));
      render(<App />);
      await userEvent.click(screen.getByText('trigger-select'));
      await waitFor(() => expect(fetchStartup).toHaveBeenCalled());
      expect(within(screen.getByTestId('startup-detail-panel')).getByText('Canva')).toBeInTheDocument();
      expect(screen.getByTestId('startup-detail-panel')).toHaveAttribute('data-partial', 'true');

      let release;
      fetchStartup.mockImplementationOnce(() => new Promise((r) => { release = r; }));
      await userEvent.click(screen.getByText('trigger-select'));
      await userEvent.click(screen.getByText('trigger-detail-close'));
      release({ slug: 'canva', name: 'Canva', sector: 'AI', founders: ['Late'] });
      await waitFor(() => expect(screen.queryByTestId('startup-detail-panel')).not.toBeInTheDocument());
    });

    it('opens a company that has no slug without asking the server for it', async () => {
      render(<App />);
      await userEvent.click(screen.getByText('trigger-select-bare'));
      expect(screen.getByTestId('startup-detail-panel')).toHaveAttribute('data-partial', 'false');
      expect(fetchStartup).not.toHaveBeenCalled();
    });

    it('opens Suggest an edit for a specific company when triggered from the detail panel', async () => {
      render(<App />);
      await userEvent.click(screen.getByText('trigger-select'));
      await userEvent.click(screen.getByText('trigger-suggest-edit'));
      expect(await screen.findByText('Suggest an edit')).toBeInTheDocument();
      expect(screen.getAllByText('Canva').length).toBeGreaterThan(0);
    });

    it('opens a founder\'s profile at once, and adds the companies they founded when the server answers', async () => {
      let release;
      fetchPerson.mockImplementationOnce(() => new Promise((r) => { release = r; }));
      render(<App />);
      await userEvent.click(screen.getByText('trigger-select'));
      await userEvent.click(screen.getByText('trigger-person'));
      const profile = await screen.findByRole('heading', { name: 'Melanie Perkins' });
      expect(profile).toBeInTheDocument();
      expect(fetchPerson).toHaveBeenCalledWith('Melanie Perkins');
      const panel = document.querySelector('.person-profile-panel');
      expect(within(panel).queryByText('Founder at')).not.toBeInTheDocument();

      release({ name: 'Melanie Perkins', companies: [{ name: 'Canva', founders: ['Melanie Perkins'], investors: [], website: 'https://canva.com' }] });
      expect(await within(panel).findByText('Founder at')).toBeInTheDocument();
      expect(within(panel).getByRole('link', { name: 'Canva' })).toHaveAttribute('href', 'https://canva.com');
    });

    it('lists the companies a visitor tracks by asking the server for them by name, and says how many it could find', async () => {
      localStorage.setItem('auStartupTracked', JSON.stringify(['Canva', 'Gone Co']));
      fetchStartupsByName.mockResolvedValue({ results: [card('Canva')] });
      render(<App />);
      const menu = await openMenu();
      await userEvent.click(menu.getByText(/Saved \(2\)/));
      expect(await screen.findByText('Saved (2)')).toBeInTheDocument();
      await waitFor(() => expect(screen.getByText('1 of 2 saved companies are still in the directory. What you save stays in this browser.')).toBeInTheDocument());
      expect(fetchStartupsByName).toHaveBeenCalledWith(['Canva', 'Gone Co'], expect.anything());
    });

    it('says what is saved stays in this browser when every saved company was found', async () => {
      localStorage.setItem('auStartupTracked', JSON.stringify(['Canva']));
      fetchStartupsByName.mockResolvedValue({ results: [card('Canva')] });
      render(<App />);
      const menu = await openMenu();
      await userEvent.click(menu.getByText(/Saved \(1\)/));
      expect(await screen.findByText('Saved (1)')).toBeInTheDocument();
      expect(screen.getByText('The companies and investors you saved. They stay in this browser.')).toBeInTheDocument();
    });

    it('shows the news ticker by default and toggles it off/on via the More menu, persisting the choice', async () => {
      render(<App />);
      // The ticker is not part of the first view: it is fetched, and mounted, once the page has settled (App.jsx, useWhenIdle).
      await waitFor(() => expect(document.getElementById('newsTicker')).toBeInTheDocument(), { timeout: 4000 });

      let menu = await openMenu();
      await userEvent.click(menu.getByText('Hide news ticker'));
      expect(document.getElementById('newsTicker')).not.toBeInTheDocument();
      expect(localStorage.getItem('auStartupNewsVisible')).toBe('0');

      menu = await openMenu();
      await userEvent.click(menu.getByText('Show news ticker'));
      expect(document.getElementById('newsTicker')).toBeInTheDocument();
      expect(localStorage.getItem('auStartupNewsVisible')).toBe('1');
    });

    it('opens the submit-a-startup form from the header\'s one action', async () => {
      render(<App />);
      await userEvent.click(screen.getByRole('button', { name: 'Add company' }));
      expect(await screen.findByText('Know an AU startup that should be on the map?', { exact: false })).toBeInTheDocument();
    });

    it('says in the menu that this is a beta, with the full sourcing disclosure one click away in About & sources', async () => {
      render(<App />);
      const menu = await openMenu();
      expect(menu.getByText(/A beta, independent project/)).toBeInTheDocument();
      await userEvent.click(menu.getByText('About & sources'));
      expect(await screen.findByText(/public sources/)).toBeInTheDocument();
    });

    it('opens About & sources and Privacy from the menu, and links to the no-JS directory', async () => {
      render(<App />);
      let menu = await openMenu();
      expect(menu.getByText('Full list (no JS)').closest('a')).toHaveAttribute('href', '/directory');

      await userEvent.click(menu.getByText('About & sources'));
      expect(await screen.findByText(/independent, unofficial directory/)).toBeInTheDocument();
      await userEvent.click(screen.getByLabelText('Close'));

      menu = await openMenu();
      await userEvent.click(menu.getByText('Privacy'));
      expect(await screen.findByText(/No account, no tracking cookies/)).toBeInTheDocument();
    });

    it('opens the site-wide Feedback form from the menu', async () => {
      render(<App />);
      const menu = await openMenu();
      await userEvent.click(menu.getByText('Feedback'));
      expect(await screen.findByLabelText('Type')).toBeInTheDocument();
    });

    it('opens the waitlist modal from the menu', async () => {
      render(<App />);
      const menu = await openMenu();
      await userEvent.click(menu.getByText('Join waitlist'));
      expect(await screen.findByText('Get early access to task-gated startup applications.')).toBeInTheDocument();
    });

    it('shows the waitlist and submit forms as dialogs that give focus back to the button that opened them when they close', async () => {
      render(<App />);
      const menu = await openMenu();
      await userEvent.click(menu.getByText('Join waitlist'));
      expect(await screen.findByRole('dialog', { name: 'Join the waitlist' })).toBeInTheDocument();
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Menu')).toHaveFocus(); // the item that opened it was in the menu, which is gone: the menu's own button is what is left

      const submit = screen.getByRole('button', { name: 'Add company' });
      await userEvent.click(submit);
      expect(await screen.findByRole('dialog', { name: 'Submit a startup' })).toBeInTheDocument();
      await userEvent.click(screen.getByLabelText('Close'));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(submit).toHaveFocus();
    });

    it('opens the edit form, with the sentence about a closed role started, from the "Report: role closed" link on a pin\'s card', async () => {
      render(<App />);
      await userEvent.click(await screen.findByText('trigger-report-role-closed'));
      expect(await screen.findByText('Suggest an edit')).toBeInTheDocument();
      expect(screen.getByLabelText(/What.s wrong/)).toHaveValue('Role closed: Canva is no longer hiring. ');
    });

    it('credits the builder in the menu', async () => {
      render(<App />);
      const menu = await openMenu();
      expect(menu.getByText(/Built by Aryan · Monash University/)).toBeInTheDocument();
    });

    it('swaps to the Jobs view (no map) when Jobs is clicked, and back again on close', async () => {
      render(<App />);
      expect(screen.getByTestId('map-view')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('link', { name: /^Jobs/ }));
      expect(screen.queryByTestId('map-view')).not.toBeInTheDocument();
      expect(screen.getByTestId('jobs-view')).toBeInTheDocument();

      await userEvent.click(screen.getByText('trigger-jobs-close'));
      expect(screen.getByTestId('map-view')).toBeInTheDocument();
      expect(screen.queryByTestId('jobs-view')).not.toBeInTheDocument();
    });

    it('swaps to the investor directory (no map) when Investors is clicked, and back to the map on close', async () => {
      render(<App />);
      await userEvent.click(screen.getByRole('link', { name: 'Investors' }));
      expect(screen.queryByTestId('map-view')).not.toBeInTheDocument();
      expect(screen.getByTestId('investors-view').dataset.route).toBe(JSON.stringify({ kind: 'list' }));

      await userEvent.click(screen.getByText('trigger-investors-close'));
      expect(screen.getByTestId('map-view')).toBeInTheDocument();
      expect(screen.queryByTestId('investors-view')).not.toBeInTheDocument();
    });

    it('offers Investors in the menu too, for a phone', async () => {
      render(<App />);
      const menu = await openMenu();
      await userEvent.click(menu.getByText('Investors'));
      expect(screen.getByTestId('investors-view')).toBeInTheDocument();
    });

    it('opens the directory, or one investor or person, when linked by their own addresses', async () => {
      for (const [address, route] of [['/investors', { kind: 'list' }], ['/investors/blackbird', { kind: 'investor', slug: 'blackbird' }], ['/investors/people/sam', { kind: 'person', slug: 'sam' }]]) {
        window.history.pushState({}, '', address);
        const view = render(<App />);
        expect(screen.getByTestId('investors-view').dataset.route).toBe(JSON.stringify(route));
        expect(screen.getByTestId('investors-view').dataset.fromLink).toBe('true'); // it is in the history already
        expect(screen.queryByTestId('map-view')).not.toBeInTheDocument();
        view.unmount();
      }
      window.history.pushState({}, '', '/');
    });

    it('opened from the nav the pages are not "from a link": the address gets a step of its own', async () => {
      render(<App />);
      await userEvent.click(screen.getByRole('link', { name: 'Investors' }));
      expect(screen.getByTestId('investors-view').dataset.fromLink).toBe('false');
    });

    it('opens the directory, or one investor or person, when linked the way the first version did, with ?view=investors', async () => {
      window.history.pushState({}, '', '/?view=investors');
      const first = render(<App />);
      expect(screen.getByTestId('investors-view').dataset.route).toBe(JSON.stringify({ kind: 'list' }));
      expect(screen.queryByTestId('map-view')).not.toBeInTheDocument();
      first.unmount();

      window.history.pushState({}, '', '/?view=investors&investor=blackbird');
      const second = render(<App />);
      expect(screen.getByTestId('investors-view').dataset.route).toBe(JSON.stringify({ kind: 'investor', slug: 'blackbird' }));
      second.unmount();

      window.history.pushState({}, '', '/?view=investors&investorPerson=sam');
      render(<App />);
      expect(screen.getByTestId('investors-view').dataset.route).toBe(JSON.stringify({ kind: 'person', slug: 'sam' }));
      window.history.pushState({}, '', '/');
    });

    describe('the investors\' page has the app\'s header', () => {
      it('is given how many are hiring, and the Jobs link goes to the jobs page', async () => {
        fetchSummary.mockResolvedValue(summaryOf({ hiring: 70 }));
        render(<App />);
        await userEvent.click(screen.getByRole('link', { name: 'Investors' }));
        await waitFor(() => expect(screen.getByTestId('investors-view').dataset.hiring).toBe('70'));
        await userEvent.click(screen.getByText('trigger-investors-jobs'));
        expect(screen.getByTestId('jobs-view')).toBeInTheDocument();
        expect(screen.queryByTestId('investors-view')).not.toBeInTheDocument();
      });

      it('opens the dialogs its menu asks for over the page, which stays where it is: About, Privacy, Feedback and the waitlist', async () => {
        render(<App />);
        await userEvent.click(screen.getByRole('link', { name: 'Investors' }));
        await userEvent.click(screen.getByText('trigger-investors-about'));
        expect(await screen.findByText(/independent, unofficial directory/)).toBeInTheDocument();
        expect(screen.getByTestId('investors-view')).toBeInTheDocument();
        await userEvent.click(screen.getByLabelText('Close'));
        await userEvent.click(screen.getByText('trigger-investors-privacy'));
        expect(await screen.findByText(/No account, no tracking cookies/)).toBeInTheDocument();
        await userEvent.click(screen.getByLabelText('Close'));
        await userEvent.click(screen.getByText('trigger-investors-feedback'));
        expect(await screen.findByLabelText('Type')).toBeInTheDocument();
        await userEvent.click(screen.getByLabelText('Close'));
        await userEvent.click(screen.getByText('trigger-investors-waitlist'));
        expect(await screen.findByRole('dialog', { name: 'Join the waitlist' })).toBeInTheDocument();
        expect(screen.getByTestId('investors-view')).toBeInTheDocument();
      });

      it('opens the companies a visitor saved, over the page, when the menu asks for them', async () => {
        localStorage.setItem('auStartupTracked', JSON.stringify(['Canva']));
        fetchStartupsByName.mockResolvedValue({ results: [card('Canva')] });
        render(<App />);
        await userEvent.click(screen.getByRole('link', { name: 'Investors' }));
        await userEvent.click(screen.getByText('trigger-investors-tracked'));
        expect(await screen.findByText('Saved (1)')).toBeInTheDocument();
        expect(screen.getByTestId('investors-view')).toBeInTheDocument();
      });

      it('leaves the investors for another page of the app from its menu: the lists', async () => {
        render(<App />);
        await userEvent.click(screen.getByRole('link', { name: 'Investors' }));
        await userEvent.click(screen.getByText('trigger-investors-lists'));
        expect(await screen.findByTestId('curated-lists')).toBeInTheDocument();
        expect(screen.queryByTestId('investors-view')).not.toBeInTheDocument();
      });
    });

    it('opens an investor from a company\'s panel, and the panel is closed behind it', async () => {
      render(<App />);
      await userEvent.click(await screen.findByText('trigger-select'));
      expect(screen.getByTestId('startup-detail-panel')).toBeInTheDocument();
      await userEvent.click(screen.getByText('trigger-open-investor'));
      expect(screen.getByTestId('investors-view').dataset.route).toBe(JSON.stringify({ kind: 'investor', slug: 'blackbird' }));
      expect(screen.queryByTestId('startup-detail-panel')).not.toBeInTheDocument();

      await userEvent.click(screen.getByText('trigger-investors-close'));
      expect(screen.getByTestId('map-view')).toBeInTheDocument();
      expect(screen.queryByTestId('startup-detail-panel')).not.toBeInTheDocument();
    });

    it('opens a company an investor backed over the map, and leaves the directory', async () => {
      render(<App />);
      await userEvent.click(screen.getByRole('link', { name: 'Investors' }));
      await userEvent.click(screen.getByText('trigger-investors-company'));
      expect(screen.queryByTestId('investors-view')).not.toBeInTheDocument();
      expect(screen.getByTestId('map-view')).toBeInTheDocument();
      expect(await screen.findByTestId('startup-detail-panel')).toHaveTextContent('Canva');
      await waitFor(() => expect(fetchStartup).toHaveBeenCalledWith('canva'));
    });

    it('opens Curated lists via the More menu and closes it again', async () => {
      render(<App />);
      const menu = await openMenu();
      await userEvent.click(menu.getByText('Collections'));
      expect(screen.getByTestId('curated-lists')).toBeInTheDocument();

      await userEvent.click(screen.getByText('trigger-curated-close'));
      expect(screen.queryByTestId('curated-lists')).not.toBeInTheDocument();
    });

    it('opens Jobs directly when linked with ?view=jobs', async () => {
      window.history.pushState({}, '', '/?view=jobs');
      render(<App />);
      expect(screen.getByTestId('jobs-view')).toBeInTheDocument();
      expect(screen.queryByTestId('map-view')).not.toBeInTheDocument();
      window.history.pushState({}, '', '/');
    });

    it('opens Curated lists directly when linked with ?view=lists', async () => {
      window.history.pushState({}, '', '/?view=lists');
      render(<App />);
      expect(screen.getByTestId('curated-lists')).toBeInTheDocument();
      window.history.pushState({}, '', '/');
    });

    it('opens the list of startups, not the map, when linked with ?view=list, and filters it as the link says', async () => {
      window.history.pushState({}, '', '/?view=list&search=Canva');
      render(<App />);
      await waitFor(() => expect(fetchStartupPage).toHaveBeenCalledWith({ ...EMPTY, search: 'Canva' }, expect.objectContaining({ offset: 0 })));
      expect(screen.queryByTestId('map-view')).not.toBeInTheDocument();
      expect(fetchMarkers).not.toHaveBeenCalled(); // the pins are asked for only while the map is showing
      window.history.pushState({}, '', '/');
    });

    it('opens the waitlist form directly when linked with ?view=waitlist, over the map', async () => {
      window.history.pushState({}, '', '/?view=waitlist');
      render(<App />);
      expect(screen.getByText('Get early access to task-gated startup applications.')).toBeInTheDocument();
      expect(screen.getByTestId('map-view')).toBeInTheDocument();
      window.history.pushState({}, '', '/');
    });

    it('opens the map, and no form, for a view it does not know', async () => {
      window.history.pushState({}, '', '/?view=nonsense');
      render(<App />);
      expect(screen.getByTestId('map-view')).toBeInTheDocument();
      expect(screen.queryByText('Get early access to task-gated startup applications.')).not.toBeInTheDocument();
      window.history.pushState({}, '', '/');
    });
  });

  describe('every page has an address', () => {
    const at = () => `${window.location.pathname}${window.location.search}`;
    const company = { slug: 'canva', name: 'Canva', sector: 'AI', blurb: 'Design for everyone', founders: ['Melanie Perkins'], city: 'Sydney', state: 'NSW', website: 'https://canva.com' };

    it('writes the filters and the view into the address, so any view can be shared', async () => {
      render(<App />);
      await openFilters();
      await tick('Sector', 'AI');
      await waitFor(() => expect(at()).toBe('/?sector=AI'));
      await userEvent.click(screen.getByRole('button', { name: 'List' }));
      await waitFor(() => expect(at()).toBe('/?sector=AI&view=list'));
      await userEvent.click(screen.getByRole('button', { name: 'Map' }));
      await waitFor(() => expect(at()).toBe('/?sector=AI'));
    });

    it('opens a company at /startup/<slug> over the map, and Back closes it', async () => {
      render(<App />);
      await userEvent.click(await screen.findByText('trigger-select'));
      expect(await screen.findByTestId('startup-detail-panel')).toBeInTheDocument();
      expect(at()).toBe('/startup/canva');

      await userEvent.click(screen.getByText('trigger-detail-close'));
      expect(screen.queryByTestId('startup-detail-panel')).not.toBeInTheDocument();
      await waitFor(() => expect(at()).toBe('/'));
    });

    it('keeps the filters in the address while a company is open, and closing returns to them', async () => {
      window.history.pushState({}, '', '/?sector=AI');
      render(<App />);
      await userEvent.click(await screen.findByText('trigger-select'));
      expect(at()).toBe('/startup/canva?sector=AI');
      await userEvent.click(screen.getByText('trigger-detail-close'));
      await waitFor(() => expect(at()).toBe('/?sector=AI'));
    });

    it('opens the company a link names, filled in from the server, and says so when there is none', async () => {
      fetchStartup.mockImplementation(async (slug) => { if (slug === 'nobody') throw Object.assign(new Error('missing'), { status: 404 }); return { ...company, slug }; });
      window.history.pushState({}, '', '/startup/canva');
      const first = render(<App />);
      expect(await screen.findByTestId('startup-detail-panel')).toHaveTextContent('Canva');
      first.unmount();

      window.history.pushState({}, '', '/startup/nobody');
      render(<App />);
      expect(await screen.findByText('This company is not in the directory.')).toBeInTheDocument();
      expect(screen.queryByTestId('startup-detail-panel')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Back to the map' }));
      expect(screen.queryByText('This company is not in the directory.')).not.toBeInTheDocument();
      expect(window.location.pathname).toBe('/');
    });

    it('opens Jobs at /jobs, Lists at /lists and the news at /news, and leaves each for the map', async () => {
      render(<App />);
      await userEvent.click(screen.getByRole('link', { name: /^Jobs/ }));
      expect(screen.getByTestId('jobs-view')).toBeInTheDocument();
      expect(window.location.pathname).toBe('/jobs');
      await userEvent.click(screen.getByText('trigger-jobs-close'));
      await waitFor(() => expect(screen.getByTestId('map-view')).toBeInTheDocument());
      await waitFor(() => expect(window.location.pathname).toBe('/'));

      await userEvent.click((await openMenu()).getByText('Collections'));
      expect(screen.getByTestId('curated-lists')).toBeInTheDocument();
      expect(window.location.pathname).toBe('/lists');
      await userEvent.click(screen.getByText('trigger-curated-close'));
      await waitFor(() => expect(screen.queryByTestId('curated-lists')).not.toBeInTheDocument());

      await userEvent.click((await openMenu()).getByText('News'));
      expect(await screen.findByRole('heading', { level: 1, name: 'Australian startup news' })).toBeInTheDocument();
      expect(window.location.pathname).toBe('/news');
      expect(screen.queryByTestId('map-view')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('link', { name: 'Explore' })); // the header's own way back to the map
      await waitFor(() => expect(screen.getByTestId('map-view')).toBeInTheDocument());
    });

    it('has the brand as a link to the home page on the map page, and Explore, the map, as the page it is on', async () => {
      render(<App />);
      const home = screen.getByRole('link', { name: 'Go to home' });
      expect(home).toHaveAttribute('href', '/welcome');
      expect(home).toHaveTextContent('AU Startup Map');
      expect(screen.getByRole('link', { name: 'Explore' })).toHaveAttribute('aria-current', 'page');
      expect(screen.getByRole('heading', { level: 1, name: 'Find your people.' })).toBeInTheDocument();
    });

    it('has them on the page over the map too, and its Explore link goes back to the map', async () => {
      render(<App />);
      await userEvent.click((await openMenu()).getByText('News'));
      await screen.findByRole('heading', { level: 1, name: 'Australian startup news' });
      expect(screen.getByRole('link', { name: 'Go to home' })).toHaveAttribute('href', '/welcome');
      await userEvent.click(screen.getByRole('link', { name: 'Explore' }));
      await waitFor(() => expect(screen.getByTestId('map-view')).toBeInTheDocument());
      await waitFor(() => expect(window.location.pathname).toBe('/'));
    });

    it('opens People at /people from the menu, and leaves it for the map', async () => {
      render(<App />);
      await userEvent.click((await openMenu()).getByText('People'));
      expect(await screen.findByTestId('people-view')).toBeInTheDocument();
      expect(window.location.pathname).toBe('/people');
      expect(screen.queryByTestId('map-view')).not.toBeInTheDocument();
      await userEvent.click(screen.getByText('trigger-people-close'));
      await waitFor(() => expect(screen.getByTestId('map-view')).toBeInTheDocument());
      await waitFor(() => expect(window.location.pathname).toBe('/'));
    });

    it('opens the people page a link names, with the query it carries left for the page to read', async () => {
      window.history.pushState({}, '', '/people?tab=operators&list=picks');
      render(<App />);
      expect(await screen.findByTestId('people-view')).toBeInTheDocument();
      expect(`${window.location.pathname}${window.location.search}`).toBe('/people?tab=operators&list=picks');
    });

    it('opens a company from the people page as the company page, and an investor in the investor pages', async () => {
      window.history.pushState({}, '', '/people');
      render(<App />);
      await userEvent.click(await screen.findByText('trigger-people-company'));
      expect(await screen.findByTestId('startup-detail-panel')).toBeInTheDocument();
      expect(window.location.pathname).toBe('/startup/canva');
      expect(screen.queryByTestId('people-view')).not.toBeInTheDocument();
    });

    it('opens an investor page from the people page in the investor pages', async () => {
      window.history.pushState({}, '', '/people');
      render(<App />);
      await userEvent.click(await screen.findByText('trigger-people-investor'));
      const view = await screen.findByTestId('investors-view');
      expect(JSON.parse(view.getAttribute('data-route'))).toEqual({ kind: 'investor', slug: 'blackbird' });
      expect(screen.queryByTestId('people-view')).not.toBeInTheDocument();
    });

    describe('with the people switched off (VITE_SHOW_PEOPLE not set: how the live site is until the people have been told)', () => {
      beforeEach(() => { vi.stubEnv('VITE_SHOW_PEOPLE', ''); });

      it('has no People in the header or in the menu, and the other links are as they were', async () => {
        render(<App />);
        await waitFor(() => expect(fetchMarkers).toHaveBeenCalled());
        expect(screen.queryByRole('link', { name: 'People' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'People' })).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
        expect(screen.getByRole('button', { name: 'Hide news ticker' })).toBeInTheDocument(); // the menu is open
        expect(screen.queryByRole('button', { name: 'People' })).not.toBeInTheDocument();
        for (const name of ['Explore', 'Investors', 'Collections', 'News']) expect(screen.getAllByRole('button', { name }).length).toBeGreaterThan(0);
      });

      it('has no /people page: the address opens the map, and the address is put right', async () => {
        window.history.pushState({}, '', '/people?tab=operators');
        render(<App />);
        expect(await screen.findByTestId('map-view')).toBeInTheDocument();
        expect(screen.queryByTestId('people-view')).not.toBeInTheDocument();
        await waitFor(() => expect(window.location.pathname).toBe('/'));
      });

      it('does not ask for the firms\' offices for the map, at all', async () => {
        render(<App />);
        await waitFor(() => expect(fetchMarkers).toHaveBeenCalled());
        await screen.findByTestId('map-view');
        expect(fetchInstitutionPins).not.toHaveBeenCalled();
        expect(screen.getByTestId('map-view')).toHaveAttribute('data-institutions', '0');
      });

      it('asks for the firms\' offices once it is on', async () => {
        vi.stubEnv('VITE_SHOW_PEOPLE', '1');
        render(<App />);
        await waitFor(() => expect(fetchInstitutionPins).toHaveBeenCalled());
      });
    });

    it('opens the page a link names: /jobs, /lists and /news, and the first versions\' ?view=jobs and ?view=lists', async () => {
      for (const [address, check] of [
        ['/jobs', () => screen.getByTestId('jobs-view')],
        ['/lists', () => screen.getByTestId('curated-lists')],
        ['/news', () => screen.getByRole('heading', { level: 1, name: 'Australian startup news' })],
        ['/?view=jobs', () => screen.getByTestId('jobs-view')],
        ['/?view=lists', () => screen.getByTestId('curated-lists')],
      ]) {
        window.history.pushState({}, '', address);
        const view = render(<App />);
        expect(check()).toBeInTheDocument();
        view.unmount();
      }
      window.history.pushState({}, '', '/?view=jobs');
      render(<App />);
      await waitFor(() => expect(window.location.pathname).toBe('/jobs')); // an old address is written as the page
      expect(window.location.search).toBe('');
    });

    it('opens a curated list at /lists/<slug> as a list of its companies, with a banner that says what it is', async () => {
      window.history.pushState({}, '', '/lists/au-fintech');
      render(<App />);
      expect(await screen.findByRole('region', { name: 'List: Australian Fintech Startups' })).toBeInTheDocument();
      await waitFor(() => expect(fetchStartupPage).toHaveBeenLastCalledWith({ ...EMPTY, sector: 'Fintech' }, expect.objectContaining({ offset: 0 })));
      expect(screen.queryByTestId('map-view')).not.toBeInTheDocument();
      expect(window.location.pathname).toBe('/lists/au-fintech'); // the address stays the list's own
      expect(window.location.search).toBe('');
    });

    it('leaves the list\'s address, and drops its banner, once a filter is changed: it is no longer that list', async () => {
      window.history.pushState({}, '', '/lists/au-fintech');
      render(<App />);
      await screen.findByRole('region', { name: 'List: Australian Fintech Startups' });
      await openFilters();
      await tick('City', 'Sydney');
      await waitFor(() => expect(screen.queryByRole('region', { name: /^List:/ })).not.toBeInTheDocument());
      await waitFor(() => expect(at()).toBe('/?sector=Fintech&city=Sydney&view=list'));
    });

    it('says so when a link names a list there is not', async () => {
      window.history.pushState({}, '', '/lists/no-such-list');
      render(<App />);
      expect(await screen.findByText('This list does not exist.')).toBeInTheDocument();
    });

    it('chooses a list from Lists: its address is the list\'s own, and Back goes to the map', async () => {
      render(<App />);
      await userEvent.click((await openMenu()).getByText('Collections'));
      await userEvent.click(screen.getByText('trigger-apply-list'));
      expect(await screen.findByRole('region', { name: 'List: Australian Fintech Startups' })).toBeInTheDocument();
      expect(window.location.pathname).toBe('/lists/au-fintech');
      window.history.back();
      await waitFor(() => expect(screen.getByTestId('map-view')).toBeInTheDocument());
      expect(window.location.pathname).toBe('/');
    });

    it('goes back and forward between pages: the page and the filters come from the address again', async () => {
      render(<App />);
      await userEvent.click(screen.getByRole('link', { name: /^Jobs/ }));
      expect(screen.getByTestId('jobs-view')).toBeInTheDocument();
      window.history.back();
      await waitFor(() => expect(screen.getByTestId('map-view')).toBeInTheDocument());
      window.history.forward();
      await waitFor(() => expect(screen.getByTestId('jobs-view')).toBeInTheDocument());
    });

    it('tells the tab and search engines what a company page is: title, description, address and structured data', async () => {
      fetchStartup.mockImplementation(async (slug) => ({ ...company, slug }));
      render(<App />);
      await userEvent.click(await screen.findByText('trigger-select'));
      await waitFor(() => expect(document.title).toBe('Canva · Australian Startup Map'));
      expect(document.querySelector('meta[name="description"]').getAttribute('content')).toBe('Design for everyone');
      expect(document.querySelector('link[rel="canonical"]').getAttribute('href')).toBe(`${window.location.origin}/startup/canva`);
      const ld = JSON.parse(document.querySelector('script[data-page-jsonld]').textContent);
      expect(ld).toMatchObject({ '@type': 'Organization', name: 'Canva', url: 'https://canva.com', founder: [{ '@type': 'Person', name: 'Melanie Perkins' }] });
      await userEvent.click(screen.getByText('trigger-detail-close'));
      await waitFor(() => expect(document.querySelector('script[data-page-jsonld]')).toBeNull());
    });
  });

  describe('the map\'s page: the city, the sector, the company\'s card and the phone\'s sheet', () => {
    afterEach(() => { vi.unstubAllGlobals(); });
    const CITIES = summaryOf({ count: 41, topCities: [{ city: 'Sydney', count: 30 }, { city: 'Melbourne', count: 11 }] });
    const withCities = () => { fetchSummary.mockResolvedValue(CITIES); fetchMeta.mockResolvedValue({ ...meta, cities: ['Melbourne', 'Sydney', 'Unknown'] }); };
    const where = () => screen.getByRole('button', { name: /^City: Australia/ });
    const pickCity = async (city) => {
      await userEvent.click(where());
      await userEvent.click(within(screen.getByRole('group', { name: 'Choose a city' })).getByRole('button', { name: new RegExp(`^${city}`) }));
    };

    it('narrows everything to a city picked from the toolbar\'s menu, the map included, and says so in the results heading', async () => {
      withCities();
      render(<App />);
      await waitFor(() => expect(fetchSummary).toHaveBeenCalledTimes(2));
      expect(screen.getByRole('heading', { name: 'Explore Australia' })).toBeInTheDocument();
      await pickCity('Melbourne');
      await waitFor(() => expect(fetchMarkers).toHaveBeenLastCalledWith({ ...EMPTY, city: 'Melbourne' }, expect.anything()));
      await waitFor(() => expect(screen.getByTestId('map-view').dataset.scope).toBe('Melbourne'));
      expect(screen.getByRole('button', { name: 'City: Melbourne' })).toHaveTextContent('Melbourne'); // the city button in the toolbar
      expect(screen.getByRole('heading', { name: 'Explore Melbourne' })).toBeInTheDocument();
      expect(window.location.search).toBe('?city=Melbourne');
    });

    it('has no dock of cities on the map: the cities are in the toolbar\'s menu', async () => {
      withCities();
      render(<App />);
      await waitFor(() => expect(fetchSummary).toHaveBeenCalledTimes(2));
      expect(screen.queryByRole('navigation', { name: 'Explore cities' })).not.toBeInTheDocument();
    });

    it('has a menu of every city, with how many each has, and "All of Australia" to leave one', async () => {
      withCities();
      render(<App />);
      await waitFor(() => expect(fetchSummary).toHaveBeenCalledTimes(2));
      await userEvent.click(where());
      const menu = screen.getByRole('group', { name: 'Choose a city' });
      expect(within(menu).getAllByRole('button').map((b) => b.textContent)).toEqual(['All of Australia41', 'Sydney30', 'Melbourne11']); // no "Unknown"
      await userEvent.click(within(menu).getByRole('button', { name: /^Sydney/ }));
      await waitFor(() => expect(fetchMarkers).toHaveBeenLastCalledWith({ ...EMPTY, city: 'Sydney' }, expect.anything()));
      expect(screen.queryByRole('group', { name: 'Choose a city' })).not.toBeInTheDocument(); // it closes

      await userEvent.click(screen.getByRole('button', { name: 'City: Sydney' }));
      await userEvent.click(within(screen.getByRole('group', { name: 'Choose a city' })).getByRole('button', { name: /^All of Australia/ }));
      await waitFor(() => expect(fetchMarkers).toHaveBeenLastCalledWith(EMPTY, expect.anything()));
    });

    it('filters by sector from the Filters panel, counts it on the Filters button, and takes it off with its chip', async () => {
      render(<App />);
      await waitFor(() => expect(fetchMarkers).toHaveBeenCalled());
      expect(screen.queryByRole('button', { name: /^Sector/ })).not.toBeInTheDocument(); // the toolbar has no sector menu while startups are shown: the panel has it
      await openFilters();
      await tick('Sector', 'Fintech');
      await waitFor(() => expect(fetchMarkers).toHaveBeenLastCalledWith({ ...EMPTY, sector: 'Fintech' }, expect.anything()));
      expect(screen.getByRole('button', { name: /^Filters/ })).toHaveTextContent('1');
      await userEvent.click(screen.getByRole('button', { name: 'Remove filter: Sector Fintech' }));
      await waitFor(() => expect(fetchMarkers).toHaveBeenLastCalledWith(EMPTY, expect.anything()));
    });

    it('counts any other filter on the Filters button', async () => {
      window.history.pushState({}, '', '/?stage=Seed&hiring=yes');
      render(<App />);
      await waitFor(() => expect(fetchMarkers).toHaveBeenCalled());
      expect(screen.getByRole('button', { name: /^Filters/ })).toHaveTextContent('2');
    });

    describe('a company picked on the map', () => {
      const cardOf = async () => screen.findByRole('region', { name: 'Canva' });

      it('opens its preview beside its mark at once with what the pin knows, and lights its row in the results', async () => {
        const { container } = render(<App />);
        await userEvent.click(await screen.findByText('trigger-pin'));
        const card = await cardOf();
        expect(screen.getByTestId('preview-slot')).toContainElement(card); // MapView draws it beside the mark
        expect(JSON.parse(screen.getByTestId('map-view').dataset.previewAt)).toEqual({ lat: -33.8, lng: 151.2 });
        expect(within(card).getByText('Canva')).toBeInTheDocument();
        expect(within(card).getByText('AI')).toBeInTheDocument();
        expect(within(card).getByText('Sydney')).toBeInTheDocument();
        expect(within(card).getByText('Verified office')).toBeInTheDocument(); // how well its place is known, from the pin
        expect(within(card).getByText('Hiring')).toBeInTheDocument(); // the pin says so
        expect(screen.getByTestId('map-view').dataset.selected).toBe('Canva'); // its mark is drawn as the open one
        await waitFor(() => expect(container.querySelector('.xc-list [aria-current="true"]')).toHaveTextContent('Canva')); // and its row beside the map
        expect(fetchStartup).not.toHaveBeenCalled(); // a preview is the pin: the record is asked for when the company is opened
        expect(screen.queryByTestId('startup-detail-panel')).not.toBeInTheDocument(); // a pin opens a preview, not the company
      });

      it('opens the company from the preview, and puts the preview away', async () => {
        render(<App />);
        await userEvent.click(await screen.findByText('trigger-pin'));
        await userEvent.click(within(await cardOf()).getByRole('button', { name: /Explore company/ }));
        expect(await screen.findByTestId('startup-detail-panel')).toHaveTextContent('Canva');
        expect(screen.queryByRole('region', { name: 'Canva' })).not.toBeInTheDocument();
        expect(window.location.pathname).toBe('/startup/canva');
      });

      it('saves the company in this browser from the preview, and shows that it is saved there and in its row', async () => {
        render(<App />);
        await userEvent.click(await screen.findByText('trigger-pin'));
        const save = within(await cardOf()).getByRole('button', { name: 'Save Canva' });
        expect(save).toHaveAttribute('aria-pressed', 'false');
        await userEvent.click(save);
        const card = screen.getByRole('region', { name: 'Canva' });
        expect(within(card).getByRole('button', { name: 'Remove Canva from saved' })).toHaveAttribute('aria-pressed', 'true');
        expect(JSON.parse(localStorage.getItem('auStartupTracked'))).toEqual(['Canva']);
        await waitFor(() => expect(screen.getAllByRole('button', { name: 'Remove Canva from saved' })).toHaveLength(2)); // its row beside the map says so too
        await userEvent.click(within(card).getByRole('button', { name: 'Remove Canva from saved' }));
        expect(JSON.parse(localStorage.getItem('auStartupTracked'))).toEqual([]);
      });

      it('puts the preview away from its own button, with Escape, with a press on the bare map, and when what is shown changes', async () => {
        render(<App />);
        await userEvent.click(await screen.findByText('trigger-pin'));
        await userEvent.click(within(await cardOf()).getByRole('button', { name: 'Close the preview' }));
        expect(screen.queryByRole('region', { name: 'Canva' })).not.toBeInTheDocument();

        await userEvent.click(screen.getByText('trigger-pin'));
        await cardOf();
        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('region', { name: 'Canva' })).not.toBeInTheDocument();

        await userEvent.click(screen.getByText('trigger-pin'));
        await cardOf();
        await userEvent.click(screen.getByText('trigger-clear-pin'));
        expect(screen.queryByRole('region', { name: 'Canva' })).not.toBeInTheDocument();

        await userEvent.click(screen.getByText('trigger-pin'));
        await cardOf();
        await userEvent.type(screen.getByLabelText(/Search startups/), 'z');
        await waitFor(() => expect(screen.queryByRole('region', { name: 'Canva' })).not.toBeInTheDocument());
      });

      it('picks a company from its row in the results: the preview opens beside its mark, and the map is sent to it', async () => {
        render(<App />);
        await userEvent.click(await screen.findByRole('button', { name: /^Zeller/ }));
        expect(await screen.findByRole('region', { name: 'Zeller' })).toBeInTheDocument();
        expect(screen.getByTestId('map-view').dataset.selected).toBe('Zeller');
        expect(JSON.parse(screen.getByTestId('map-view').dataset.focus)).toMatchObject({ lat: -33.8, lng: 151.2 });
      });

      it('has no preview over the list', async () => {
        render(<App />);
        await userEvent.click(await screen.findByText('trigger-pin'));
        await cardOf();
        await userEvent.click(screen.getByRole('button', { name: 'List' }));
        expect(screen.queryByRole('region', { name: 'Canva' })).not.toBeInTheDocument();
      });

      it('offers "Report: role closed" for a company the pin says is hiring, which opens the edit form with the sentence started, and not for one that is not', async () => {
        render(<App />);
        await userEvent.click(await screen.findByText('trigger-pin-quiet'));
        const quiet = await screen.findByRole('region', { name: 'Zeller' });
        expect(within(quiet).queryByRole('button', { name: 'Report: role closed' })).not.toBeInTheDocument();
        await userEvent.click(screen.getByText('trigger-clear-pin'));
        await userEvent.click(screen.getByText('trigger-pin'));
        await userEvent.click(within(await cardOf()).getByRole('button', { name: 'Report: role closed' }));
        expect(await screen.findByLabelText(/What.s wrong/)).toHaveValue('Role closed: Canva is no longer hiring. ');
      });

      it('does not say a company is not hiring when nobody has read its page: a Hiring label only when the pin says so, and nothing for the rest', async () => {
        render(<App />);
        await userEvent.click(await screen.findByText('trigger-pin'));
        expect(within(await cardOf()).getByText('Hiring')).toBeInTheDocument(); // the pin said it is hiring
        await userEvent.click(screen.getByText('trigger-clear-pin'));
        await userEvent.click(screen.getByText('trigger-pin-quiet'));
        const quiet = await screen.findByRole('region', { name: 'Zeller' });
        expect(within(quiet).queryByText(/hiring|Roles unverified|No open roles/i)).not.toBeInTheDocument();
        expect(fetchStartup).not.toHaveBeenCalled();
      });
    });

    describe('the page scrolls to the workspace when part of it is below the screen', () => {
      let scroll;
      beforeEach(() => { scroll = vi.fn(); Element.prototype.scrollIntoView = scroll; });
      afterEach(() => { delete Element.prototype.scrollIntoView; vi.restoreAllMocks(); });
      const belowTheFold = () => vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: 400, bottom: window.innerHeight + 600, left: 0, right: 0, width: 0, height: 0 });
      const toWorkspace = () => expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: expect.any(String) });

      it('does it for a row picked in the results, so the mark and its preview are in sight, and not when the workspace is all in view', async () => {
        render(<App />);
        await userEvent.click(await screen.findByRole('button', { name: /^Zeller/ }));
        expect(scroll).not.toHaveBeenCalledWith({ block: 'start', behavior: expect.any(String) }); // nothing is below the screen

        belowTheFold();
        await userEvent.click(screen.getByRole('button', { name: /^Canva/ }));
        toWorkspace();
      });

      it('does it on a phone when the sheet is pulled up, and when a mark is picked', async () => {
        phone();
        belowTheFold();
        render(<App />);
        const sheet = await screen.findByRole('region', { name: 'Startups on the map' });
        await userEvent.click(within(sheet).getByRole('button', { name: /startups/ }));
        toWorkspace();
        scroll.mockClear();
        await userEvent.click(screen.getByText('trigger-pin'));
        toWorkspace();
      });
    });

    describe('the way back to all of Australia', () => {
      const back = () => screen.queryByRole('button', { name: 'All Australia' });

      it('is not there on all of Australia, and is there once a city is chosen: it clears the city and sends the map home', async () => {
        withCities();
        window.history.pushState({}, '', '/?city=Sydney');
        render(<App />);
        await screen.findByTestId('map-view');
        await userEvent.click(back());
        await waitFor(() => expect(fetchMarkers).toHaveBeenLastCalledWith(EMPTY, expect.anything()));
        expect(JSON.parse(screen.getByTestId('map-view').dataset.focus)).toMatchObject({ home: true });
        expect(back()).toBeNull();
        window.history.pushState({}, '', '/');
      });

      it('is also there when the map has been zoomed in, with no city, and not over the list', async () => {
        render(<App />);
        await screen.findByTestId('map-view');
        expect(back()).toBeNull();
        await userEvent.click(screen.getByText('trigger-move')); // the map says it is at zoom 9
        expect(back()).not.toBeNull();
        await userEvent.click(screen.getByRole('button', { name: 'List' }));
        expect(back()).toBeNull();
      });

      it('is on a phone too', async () => {
        phone();
        window.history.pushState({}, '', '/?city=Sydney');
        render(<App />);
        await screen.findByTestId('map-view');
        expect(back()).not.toBeNull();
        window.history.pushState({}, '', '/');
      });
    });

    describe('on a phone', () => {
      beforeEach(() => { phone(); });
      const sheet = () => screen.getByRole('region', { name: 'Startups on the map' });

      it('has the count in a bar at the foot of the map, shut, and no card beside the map', async () => {
        const { container } = render(<App />);
        await waitFor(() => expect(within(sheet()).getByText('2 startups')).toBeInTheDocument());
        expect(within(sheet()).getByText(/in Australia/)).toBeInTheDocument();
        expect(container.querySelector('.xs')).toHaveClass('xs-peek');
        expect(fetchStartupPage).not.toHaveBeenCalled(); // the list is asked for only once the sheet is pulled up
      });

      it('names the city in the bar once one is picked', async () => {
        withCities();
        render(<App />);
        await waitFor(() => expect(fetchSummary).toHaveBeenCalledTimes(2));
        await pickCity('Sydney');
        await waitFor(() => expect(within(sheet()).getByText(/in Sydney/)).toBeInTheDocument());
      });

      it('pulls up to a list of the startups, a page at a time, and shuts again', async () => {
        const { container } = render(<App />);
        await userEvent.click(within(sheet()).getByRole('button', { name: /startups/ }));
        expect(container.querySelector('.xs')).toHaveClass('xs-open');
        await waitFor(() => expect(within(sheet()).getAllByRole('button', { name: /^(Canva|Zeller)/ })).toHaveLength(2));
        expect(fetchStartupPage).toHaveBeenCalledWith(EMPTY, expect.objectContaining({ offset: 0 }));
        await userEvent.click(within(sheet()).getByRole('button', { name: /startups/, expanded: true }));
        expect(container.querySelector('.xs')).toHaveClass('xs-peek');
      });

      it('opens a startup picked from the list as a card in the same sheet, and the map is sent to its pin, clear of the sheet', async () => {
        const { container } = render(<App />);
        await userEvent.click(within(sheet()).getByRole('button', { name: /startups/ }));
        await userEvent.click(await within(sheet()).findByRole('button', { name: /^Canva/ }));
        const card = await within(sheet()).findByRole('region', { name: 'Canva' });
        expect(container.querySelector('.xs')).toHaveClass('xs-detail');
        expect(card).toHaveClass('xp-card-sheet');
        expect(JSON.parse(screen.getByTestId('map-view').dataset.focus)).toMatchObject({ lat: -33.8, lng: 151.2, inset: 445 });

        await userEvent.click(within(card).getByRole('button', { name: 'Close this panel' }));
        expect(container.querySelector('.xs')).not.toHaveClass('xs-detail');
      });

      it('opens the card in the sheet when a pin is pressed on the map, and the map is sent clear of it', async () => {
        render(<App />);
        await userEvent.click(await screen.findByText('trigger-pin'));
        expect(await within(sheet()).findByRole('region', { name: 'Canva' })).toBeInTheDocument();
        expect(JSON.parse(screen.getByTestId('map-view').dataset.focus)).toMatchObject({ lat: -33.8, lng: 151.2, inset: 445 });
      });

      it('keeps the toolbar to the city, the Map | List switch, the search and the filters, with the sectors inside the filters', async () => {
        render(<App />);
        await waitFor(() => expect(fetchMarkers).toHaveBeenCalled());
        expect(screen.getByLabelText(/Search startups/)).toHaveAttribute('placeholder', 'Search startups or investors');
        await openFilters();
        expect(screen.getByRole('complementary', { name: 'Filters and cities' })).toBeInTheDocument();
        expect(screen.getByRole('group', { name: 'Sector' })).toBeInTheDocument(); // in the panel
      });
    });
  });

  describe('the VCs on the map', () => {
    afterEach(() => { vi.unstubAllGlobals(); });
    const VC_ITEM = { id: 'oif@Sydney', slug: 'oif', name: 'OIF Ventures', type: 'venture_capital', type_label: 'Venture Capital', domain: 'oif.vc', logo: null, lat: -33.87, lng: 151.21, city: 'Sydney', state: 'NSW', place: 'Sydney, NSW', role: 'headquarters', precision: 'CITY', stages: ['Seed'], sectors: ['Software'], portfolio_count: 1 };
    const withVcs = (items = [VC_ITEM], over = {}) => fetchInvestorPins.mockResolvedValue({ total: 19, count: 19, pinned: items.length, unplaced: 6, items, ...over });
    const shown = () => screen.getByRole('group', { name: 'What the map shows' });
    const map = () => screen.getByTestId('map-view');
    const VC_FILTERS = { search: '', sector: '', stage: '', city: '' };

    it('draws the startups and the VCs together, as it opens, and asks only for what narrows the investors: the search, sector, stage and city', async () => {
      withVcs();
      render(<App />);
      await waitFor(() => expect(map()).toHaveAttribute('data-vcs', '1'));
      expect(fetchInvestorPins).toHaveBeenCalledWith(VC_FILTERS, expect.objectContaining({ signal: expect.any(AbortSignal) }));
      expect(map()).toHaveAttribute('data-show-vcs', 'true');
      expect(map()).toHaveAttribute('data-show-companies', 'true');
      expect(within(shown()).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
      expect(window.location.search).toBe(''); // both is no parameter
    });

    it('passes the search, sector, stage and city to the investors, and not the filters that are about startups', async () => {
      withVcs();
      window.history.pushState({}, '', '/?search=fin&sector=AI&stage=Seed&city=Sydney&show=vcs&remote=remote');
      render(<App />);
      await waitFor(() => expect(fetchInvestorPins).toHaveBeenCalledWith({ search: 'fin', sector: 'AI', stage: 'Seed', city: 'Sydney' }, expect.anything()));
    });

    it('shows only the startups from Startups, asks for no investors, and writes it in the address', async () => {
      withVcs();
      render(<App />);
      await waitFor(() => expect(map()).toHaveAttribute('data-vcs', '1'));
      await userEvent.click(within(shown()).getByRole('button', { name: 'Startups' }));
      await waitFor(() => expect(map()).toHaveAttribute('data-vcs', '0'));
      expect(map()).toHaveAttribute('data-show-vcs', 'false');
      expect(map()).toHaveAttribute('data-show-companies', 'true');
      await waitFor(() => expect(window.location.search).toBe('?show=startups'));
      fetchInvestorPins.mockClear();
      await userEvent.type(screen.getByLabelText(/Search startups/), 'z');
      await waitFor(() => expect(fetchMarkers).toHaveBeenLastCalledWith({ ...EMPTY, search: 'z' }, expect.anything()));
      expect(fetchInvestorPins).not.toHaveBeenCalled();
    });

    it('shows only the VCs from VCs: no startup is drawn, the menus offer what investors state, and the address says so', async () => {
      withVcs();
      fetchInvestorMeta.mockResolvedValue({ sectors: [{ value: 'Technology', count: 9 }], stages: [{ value: 'Seed', count: 8 }] });
      render(<App />);
      await userEvent.click(within(shown()).getByRole('button', { name: 'VCs' }));
      await waitFor(() => expect(map()).toHaveAttribute('data-show-companies', 'false'));
      expect(map()).toHaveAttribute('data-show-vcs', 'true');
      await waitFor(() => expect(window.location.search).toBe('?show=vcs'));
      await waitFor(() => expect(fetchInvestorMeta).toHaveBeenCalledTimes(1));
      await userEvent.click(screen.getByRole('button', { name: /^Sector/ }));
      expect(within(screen.getByRole('group', { name: 'Sector' })).getByRole('checkbox', { name: /Technology/ })).toBeInTheDocument();
      expect(within(screen.getByRole('group', { name: 'Sector' })).queryByRole('checkbox', { name: 'Fintech' })).not.toBeInTheDocument(); // not a startup's sector
      await userEvent.click(screen.getByRole('button', { name: /^Stage/ }));
      await userEvent.click(within(screen.getByRole('group', { name: 'Stage' })).getByRole('checkbox', { name: /Seed/ }));
      await waitFor(() => expect(fetchInvestorPins).toHaveBeenLastCalledWith({ ...VC_FILTERS, stage: 'Seed' }, expect.anything()));
      expect(screen.getByLabelText(/Search/)).toHaveAttribute('placeholder', 'Search investors');
    });

    it('opens as the address says: ?show=vcs shows the VCs, ?show=startups the startups, and anything else both', async () => {
      withVcs();
      window.history.pushState({}, '', '/?show=vcs');
      const first = render(<App />);
      await screen.findByTestId('map-view');
      expect(within(shown()).getByRole('button', { name: 'VCs' })).toHaveAttribute('aria-pressed', 'true');
      first.unmount();
      cleanup();
      window.history.pushState({}, '', '/?show=startups');
      fetchInvestorPins.mockClear();
      const second = render(<App />);
      await screen.findByTestId('map-view');
      expect(within(shown()).getByRole('button', { name: 'Startups' })).toHaveAttribute('aria-pressed', 'true');
      expect(fetchInvestorPins).not.toHaveBeenCalled();
      second.unmount();
      cleanup();
      window.history.pushState({}, '', '/?show=rubbish');
      render(<App />);
      await screen.findByTestId('map-view');
      expect(within(shown()).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('leaves the VCs off while a filter that is about startups alone is on, when both are shown, and keeps them when only they are', async () => {
      withVcs();
      window.history.pushState({}, '', '/?hiring=yes');
      render(<App />);
      await screen.findByTestId('map-view');
      expect(map()).toHaveAttribute('data-show-vcs', 'false');
      expect(fetchInvestorPins).not.toHaveBeenCalled();
      await userEvent.click(within(shown()).getByRole('button', { name: 'VCs' }));
      await waitFor(() => expect(map()).toHaveAttribute('data-show-vcs', 'true'));
      await waitFor(() => expect(fetchInvestorPins).toHaveBeenCalled());
    });

    it('says on the map when no VC matches, with only the VCs on, and how many more have no city; and says nothing over the startups', async () => {
      withVcs([], { count: 5, pinned: 0, unplaced: 5 });
      window.history.pushState({}, '', '/?show=vcs');
      const first = render(<App />);
      expect(await screen.findByText('No venture capital firm with a city on file matches. 5 more match but have no city we can place.')).toBeInTheDocument();
      first.unmount();
      cleanup();
      window.history.pushState({}, '', '/');
      render(<App />);
      await waitFor(() => expect(fetchInvestorPins).toHaveBeenCalled());
      expect(screen.queryByText(/No venture capital firm with a city on file matches/)).not.toBeInTheDocument();
    });

    it('carries on with no investors when they cannot be fetched', async () => {
      fetchInvestorPins.mockRejectedValue(new Error('down'));
      render(<App />);
      await waitFor(() => expect(fetchInvestorPins).toHaveBeenCalled());
      expect(map()).toHaveAttribute('data-vcs', '0');
      expect(map()).toHaveAttribute('data-count', '2');
    });

    describe('a VC picked on the map', () => {
      const VC_PIN = 'trigger-vc-pin';
      const INVESTOR = {
        slug: 'oif', name: 'OIF Ventures', type_label: 'Venture Capital', website: 'https://oif.vc', description: 'Backs software founders.', sectors: ['Software'], stages: ['Seed'], other_offices: [],
        verified_at: new Date().toISOString(), portfolio: [{ company: { slug: 'canva', name: 'Canva', city: 'Sydney', sector: 'AI', website: 'https://canva.com' } }, { company: { slug: 'zzz', name: 'Zzz', city: 'Perth', sector: 'AI', website: '' } }],
      };
      beforeEach(() => { fetchInvestor.mockResolvedValue(INVESTOR); });

      it('opens its preview beside its mark, as an investor, with its place and how well that place is known, and the map is not sent clear of a side panel', async () => {
        const { container } = render(<App />);
        await userEvent.click(await screen.findByText(VC_PIN));
        const card = await screen.findByRole('region', { name: 'OIF Ventures' });
        expect(screen.getByTestId('preview-slot')).toContainElement(card);
        expect(within(card).getByText('Venture capital')).toBeInTheDocument();
        expect(within(card).getByText('VC')).toBeInTheDocument(); // the badge
        expect(within(card).getByText('Sydney, NSW')).toBeInTheDocument();
        expect(within(card).getByText('City-level: its headquarters city, no address on file')).toBeInTheDocument();
        expect(fetchStartup).not.toHaveBeenCalled(); // an investor is not a company
        expect(map().dataset.selected).toBe('OIF Ventures'); // its mark is drawn as the open one
        expect(container.querySelector('.xc-list [aria-current="true"]')).toHaveTextContent('OIF Ventures'); // and its row beside the map
        const focus = JSON.parse(map().dataset.focus);
        expect(focus).toMatchObject({ lat: -33.87, lng: 151.21 });
        expect(focus.insetRight).toBeUndefined();
        expect(focus.inset).toBeUndefined();
      });

      it('saves the investor in this browser, in the same list as the investors\' page', async () => {
        render(<App />);
        await userEvent.click(await screen.findByText(VC_PIN));
        const panel = await screen.findByRole('region', { name: 'OIF Ventures' });
        await userEvent.click(within(panel).getByRole('button', { name: 'Save OIF Ventures' }));
        expect(JSON.parse(localStorage.getItem('auStartupSavedInvestors'))).toEqual(['oif']);
        expect(within(panel).getByRole('button', { name: 'Remove OIF Ventures from saved' })).toHaveAttribute('aria-pressed', 'true');
        await userEvent.click(within(panel).getByRole('button', { name: 'Remove OIF Ventures from saved' }));
        expect(JSON.parse(localStorage.getItem('auStartupSavedInvestors'))).toEqual([]);
      });

      it('opens the investor\'s own page in the app from "View investor profile"', async () => {
        render(<App />);
        await userEvent.click(await screen.findByText(VC_PIN));
        await userEvent.click(await screen.findByRole('button', { name: /View investor profile/ }));
        const view = await screen.findByTestId('investors-view');
        expect(JSON.parse(view.dataset.route)).toEqual({ kind: 'investor', slug: 'oif' });
      });

      it('goes to the pin of a portfolio company when it has one (the map moves to it and its panel opens), and opens its page when it has none', async () => {
        phone(); // the portfolio is in the panel of the phone's sheet; on a wide screen the preview has the one way on, the investor's profile
        render(<App />);
        await userEvent.click(await screen.findByText(VC_PIN));
        const sheet = screen.getByRole('region', { name: 'Startups on the map' });
        const panel = await within(sheet).findByRole('region', { name: 'OIF Ventures' });
        expect(await within(panel).findByText('Backs software founders.')).toBeInTheDocument();
        expect(within(panel).getByText('Software')).toBeInTheDocument();
        expect(within(panel).getByRole('heading', { name: 'Portfolio (2)' })).toBeInTheDocument();
        expect(fetchInvestor).toHaveBeenCalledWith('oif', expect.anything());
        await userEvent.click(await within(panel).findByRole('button', { name: /^Canva/ }));
        expect(await within(sheet).findByRole('region', { name: 'Canva' })).toBeInTheDocument(); // Canva has a pin: its panel replaces the investor's
        expect(screen.queryByRole('region', { name: 'OIF Ventures' })).not.toBeInTheDocument();
        expect(map().dataset.selected).toBe('Canva');

        await userEvent.click(screen.getByText(VC_PIN));
        await userEvent.click(await within(await screen.findByRole('region', { name: 'OIF Ventures' })).findByRole('button', { name: /^Zzz/ }));
        expect(await screen.findByTestId('startup-detail-panel')).toBeInTheDocument(); // no pin: its page, asked for by its address
        expect(fetchStartup).toHaveBeenCalledWith('zzz');
        expect(window.location.pathname).toBe('/startup/zzz');
      });

      it('is put away by its button, by Escape, by a press on the bare map, and when what is shown changes', async () => {
        render(<App />);
        await userEvent.click(await screen.findByText(VC_PIN));
        await userEvent.click(within(await screen.findByRole('region', { name: 'OIF Ventures' })).getByRole('button', { name: 'Close the preview' }));
        expect(screen.queryByRole('region', { name: 'OIF Ventures' })).not.toBeInTheDocument();
        await userEvent.click(screen.getByText(VC_PIN));
        await screen.findByRole('region', { name: 'OIF Ventures' });
        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('region', { name: 'OIF Ventures' })).not.toBeInTheDocument();
        await userEvent.click(screen.getByText(VC_PIN));
        await screen.findByRole('region', { name: 'OIF Ventures' });
        await userEvent.click(screen.getByText('trigger-clear-pin'));
        expect(screen.queryByRole('region', { name: 'OIF Ventures' })).not.toBeInTheDocument();
        await userEvent.click(screen.getByText(VC_PIN));
        await screen.findByRole('region', { name: 'OIF Ventures' });
        await userEvent.click(within(shown()).getByRole('button', { name: 'Startups' }));
        await waitFor(() => expect(screen.queryByRole('region', { name: 'OIF Ventures' })).not.toBeInTheDocument());
      });

      it('keeps the search, the filters and the city while it opens and shuts, and when the view changes', async () => {
        window.history.pushState({}, '', '/?sector=AI&city=Sydney');
        render(<App />);
        await userEvent.click(await screen.findByText(VC_PIN));
        await screen.findByRole('region', { name: 'OIF Ventures' });
        await userEvent.click(screen.getByRole('button', { name: 'Close the preview' }));
        expect(window.location.search).toBe('?sector=AI&city=Sydney');
        await userEvent.click(screen.getByRole('button', { name: 'List' }));
        await userEvent.click(screen.getByRole('button', { name: 'Map' }));
        expect(window.location.search).toBe('?sector=AI&city=Sydney');
        expect(screen.getByRole('button', { name: 'City: Sydney' })).toBeInTheDocument();
      });

      it('is the same panel in the phone\'s sheet, and the map is sent clear of the sheet, not of a side panel', async () => {
        vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })));
        render(<App />);
        await userEvent.click(await screen.findByText(VC_PIN));
        const sheet = screen.getByRole('region', { name: 'Startups on the map' });
        const panel = await within(sheet).findByRole('region', { name: 'OIF Ventures' });
        expect(panel).toHaveClass('xp-card-sheet');
        expect(JSON.parse(map().dataset.focus)).toMatchObject({ lat: -33.87, lng: 151.21, inset: 445 }); // 58% of the screen (jsdom's is 768px tall), the most a sheet takes
        expect(JSON.parse(map().dataset.focus).insetRight).toBeUndefined();
      });
    });

    describe('as a list', () => {
      it('lists the VCs, one card each, instead of the startups, when only the VCs are on, and opens an investor\'s page', async () => {
        withVcs([VC_ITEM, { ...VC_ITEM, id: 'oif@Melbourne', city: 'Melbourne', lat: -37.8, lng: 144.9 }]);
        window.history.pushState({}, '', '/?show=vcs&view=list');
        render(<App />);
        expect(await screen.findByRole('heading', { name: '1 venture capital firm in Australia' })).toBeInTheDocument();
        expect(fetchStartupPage).not.toHaveBeenCalled(); // no list of startups is asked for
        expect(screen.getByText(/6 more investors match but have no city we can place/)).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'OIF Ventures' }));
        expect(JSON.parse((await screen.findByTestId('investors-view')).dataset.route)).toEqual({ kind: 'investor', slug: 'oif' });
      });

      it('lists the startups, as it always did, with All or Startups on', async () => {
        withVcs();
        window.history.pushState({}, '', '/?view=list');
        render(<App />);
        await waitFor(() => expect(fetchStartupPage).toHaveBeenCalled());
        expect(screen.queryByRole('heading', { name: /venture capital firm/ })).not.toBeInTheDocument();
      });
    });

    describe('on a phone', () => {
      beforeEach(() => { phone(); });
      const sheet = () => screen.getByRole('region', { name: 'Startups on the map' });

      it('counts the startups and the VCs in the sheet\'s bar, and lists the firms after the startups', async () => {
        withVcs([VC_ITEM, { ...VC_ITEM, id: 'oif@Melbourne', city: 'Melbourne', lat: -37.8, lng: 144.9 }]);
        render(<App />);
        await waitFor(() => expect(within(sheet()).getByText(/2 startups · 1 VC/)).toBeInTheDocument());
        await userEvent.click(within(sheet()).getByRole('button', { name: /startups/ }));
        const firm = await within(sheet()).findByRole('button', { name: /^OIF Ventures/ });
        expect(firm).toHaveTextContent('Sydney, Melbourne');
        await userEvent.click(firm);
        expect(await within(sheet()).findByRole('region', { name: 'OIF Ventures' })).toBeInTheDocument();
        expect(JSON.parse(map().dataset.focus)).toMatchObject({ lat: -33.87, inset: 445 });
      });

      it('has the entity switch on a row of its own, and the VC menus under it, with only the VCs on', async () => {
        fetchInvestorMeta.mockResolvedValue({ sectors: [{ value: 'Technology', count: 9 }], stages: [{ value: 'Seed', count: 8 }] });
        window.history.pushState({}, '', '/?show=vcs');
        const { container } = render(<App />);
        await waitFor(() => expect(container.querySelector('.xt-vcmenus .xt-btn')).not.toBeNull());
        expect(container.querySelector('.xt-entity')).not.toBeNull();
        expect(screen.getByLabelText(/Search/)).toHaveAttribute('placeholder', 'Search investors');
      });
    });
  });

  describe('the filters that are on', () => {
    const chipsOver = () => screen.queryByRole('list', { name: 'Filters that are on' });

    it('shows each as a chip over the map, none while no filter is on, and takes a filter off with its chip', async () => {
      window.history.pushState({}, '', '/?sector=AI,Fintech&city=Sydney');
      render(<App />);
      expect(await screen.findByRole('list', { name: 'Filters that are on' })).toBeInTheDocument();
      // the city is not a chip: the breadcrumb in the toolbar says it, and takes it off
      expect(screen.getAllByRole('button', { name: /^Remove filter/ }).map((b) => b.getAttribute('aria-label'))).toEqual([
        'Remove filter: Sector AI', 'Remove filter: Sector Fintech',
      ]);
      await userEvent.click(screen.getByRole('button', { name: 'Remove filter: Sector Fintech' }));
      await waitFor(() => expect(fetchMarkers).toHaveBeenLastCalledWith({ ...EMPTY, sector: 'AI', city: 'Sydney' }, expect.anything()));
      await waitFor(() => expect(window.location.search).toBe('?sector=AI&city=Sydney'));
      await userEvent.click(screen.getByRole('button', { name: 'Remove filter: Sector AI' }));
      await waitFor(() => expect(chipsOver()).not.toBeInTheDocument());
      await waitFor(() => expect(window.location.search).toBe('?city=Sydney'));
    });

    it('clears them all at once from Clear all, and leaves the city the visitor is on', async () => {
      window.history.pushState({}, '', '/?sector=AI&stage=Seed&city=Sydney');
      render(<App />);
      await userEvent.click(await screen.findByRole('button', { name: 'Clear all' }));
      await waitFor(() => expect(chipsOver()).not.toBeInTheDocument());
      await waitFor(() => expect(fetchMarkers).toHaveBeenLastCalledWith({ ...EMPTY, city: 'Sydney' }, expect.anything()));
    });

    it('shows them over the list too, in its own row', async () => {
      window.history.pushState({}, '', '/?stage=Seed&view=list');
      render(<App />);
      const chips = await screen.findByRole('list', { name: 'Filters that are on' });
      expect(chips.closest('.startup-list-chips')).not.toBeNull();
      expect(screen.queryByTestId('map-view')).not.toBeInTheDocument();
    });

    it('shows none over a curated list: its filters are the list', async () => {
      window.history.pushState({}, '', '/lists/au-fintech');
      render(<App />);
      await screen.findByRole('region', { name: 'List: Australian Fintech Startups' });
      expect(chipsOver()).not.toBeInTheDocument();
    });

    it('filters by several sectors at once from the drawer, and says so in the address', async () => {
      render(<App />);
      await openFilters();
      await tick('Sector', 'Fintech');
      await userEvent.click(within(screen.getByRole('group', { name: 'Sector' })).getByRole('checkbox', { name: 'AI' }));
      await waitFor(() => expect(fetchMarkers).toHaveBeenLastCalledWith({ ...EMPTY, sector: 'Fintech,AI' }, expect.anything()));
      await waitFor(() => expect(window.location.search).toBe('?sector=Fintech%2CAI'));
    });
  });
});
