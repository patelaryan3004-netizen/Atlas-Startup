import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../src/api.js', () => ({
  fetchStartupPage: vi.fn(),
  fetchSummary: vi.fn(),
  fetchMarkers: vi.fn(),
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
  default: ({ markers, sectorColors, onSelectStartup }) => (
    <div data-testid="map-view" data-count={markers.length} data-colors={Object.keys(sectorColors).join(',')}>
      <button onClick={() => onSelectStartup({ slug: 'canva', name: 'Canva', sector: 'AI', hiring: true })}>trigger-select</button>
      <button onClick={() => onSelectStartup({ name: 'Bare Co', sector: 'AI' })}>trigger-select-bare</button>
    </div>
  ),
}));

vi.mock('../src/components/StartupDetailPanel.jsx', () => ({
  default: ({ startup, onSuggestEdit, onSelectPerson, onClose }) => (
    <div data-testid="startup-detail-panel" data-partial={String(Boolean(startup.partial))}>
      <span>{startup.name}</span>
      {startup.founders && <span data-testid="founders">{startup.founders.join(',')}</span>}
      <button onClick={() => onSuggestEdit(startup.name)}>trigger-suggest-edit</button>
      <button onClick={() => onSelectPerson('Melanie Perkins')}>trigger-person</button>
      <button onClick={onClose}>trigger-detail-close</button>
    </div>
  ),
}));

vi.mock('../src/components/JobsView.jsx', () => ({
  default: ({ onClose }) => (
    <div data-testid="jobs-view">
      <button onClick={onClose}>trigger-jobs-close</button>
    </div>
  ),
}));

vi.mock('../src/components/CuratedLists.jsx', () => ({
  default: ({ currentFilters, onApply, onClose }) => (
    <div data-testid="curated-lists" data-current={JSON.stringify(currentFilters)}>
      <button onClick={() => { onApply({ city: 'Melbourne', sector: 'AI' }); onClose(); }}>trigger-apply-list</button>
      <button onClick={onClose}>trigger-curated-close</button>
    </div>
  ),
}));

import {
  fetchStartupPage, fetchSummary, fetchMarkers, fetchStartup, fetchStartupsByName, fetchPerson, fetchSuggestions, fetchMeta, fetchNews,
} from '../src/api.js';
import App from '../src/App.jsx';

const meta = {
  sectors: ['Fintech', 'AI'],
  cities: ['Sydney'],
  investors: ['Blackbird'],
  stages: ['Seed'],
};

const EMPTY = { search: '', sector: '', city: '', investor: '', stage: '', hiring: '', taskGate: '' };
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
  await userEvent.click(screen.getByText(/^☰ Filters/));
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
    localStorage.clear();
    fetchMeta.mockResolvedValue(meta);
    fetchSummary.mockResolvedValue(summaryOf());
    fetchMarkers.mockResolvedValue({ total: 2, count: 2, pinned: 2, items: [pin('canva', 'Canva'), pin('zeller', 'Zeller')] });
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
      expect(fetchSummary).toHaveBeenCalledWith({});
      expect(fetchSummary).toHaveBeenCalledWith(EMPTY, expect.objectContaining({ signal: expect.any(AbortSignal) }));
      expect(fetchMarkers).toHaveBeenCalledWith(EMPTY, expect.objectContaining({ signal: expect.any(AbortSignal) }));
      expect(fetchStartupPage).not.toHaveBeenCalled(); // no list is fetched while the map is showing
    });

    it('draws the map from the pins and colours sectors from the filter options', async () => {
      render(<App />);
      await waitFor(() => expect(screen.getByTestId('map-view').dataset.count).toBe('2'));
      expect(screen.getByTestId('map-view').dataset.colors).toBe('AI,Fintech');
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
      await userEvent.selectOptions(screen.getByLabelText('Sector'), 'Fintech');
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

      await userEvent.click(screen.getByRole('button', { name: 'List (2)' }));
      await waitFor(() => expect(fetchStartupPage).toHaveBeenCalled());
      fetchMarkers.mockClear();
      await userEvent.type(screen.getByLabelText(/Search startups/), 'z');
      await waitFor(() => expect(fetchStartupPage).toHaveBeenLastCalledWith({ ...EMPTY, search: 'z' }, expect.objectContaining({ offset: 0 })));
      expect(fetchMarkers).not.toHaveBeenCalled();

      await userEvent.click(screen.getByText('Map'));
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
      await userEvent.click(menu.getByText('Lists'));
      await userEvent.click(screen.getByText('trigger-apply-list'));

      expect(screen.queryByTestId('curated-lists')).not.toBeInTheDocument();
      await waitFor(() => expect(fetchStartupPage).toHaveBeenLastCalledWith({ ...EMPTY, sector: 'AI', city: 'Melbourne' }, expect.objectContaining({ offset: 0 })));
      expect(screen.queryByTestId('map-view')).not.toBeInTheDocument();
    });

    it('falls back to an empty map and zero counts if the server cannot be reached', async () => {
      fetchMarkers.mockRejectedValue(new Error('network error'));
      fetchSummary.mockRejectedValue(new Error('network error'));
      render(<App />);
      await waitFor(() => expect(screen.getByTestId('map-view').dataset.count).toBe('0'));
      expect(screen.getByRole('button', { name: /^Jobs/ }).textContent).toBe('Jobs');
    });
  });

  describe('counts', () => {
    it('shows a subtle hiring-count hint on the Jobs nav link, reflecting the whole directory not just current filters', async () => {
      fetchSummary.mockImplementation(async (filters) => (Object.values(filters).some(Boolean) ? summaryOf({ count: 1, hiring: 1 }) : summaryOf({ hiring: 70 })));
      window.history.pushState({}, '', '/?city=Sydney');
      render(<App />);
      const jobsButton = await screen.findByRole('button', { name: /^Jobs · 70/ });
      expect(jobsButton).toHaveTextContent('Jobs · 70 hiring now');
      window.history.pushState({}, '', '/');
    });

    it('omits the hiring hint entirely when nobody is hiring, rather than showing "0 hiring now"', async () => {
      fetchSummary.mockResolvedValue(summaryOf({ hiring: 0 }));
      render(<App />);
      await waitFor(() => expect(fetchSummary).toHaveBeenCalledTimes(2));
      const jobsButton = screen.getByRole('button', { name: /^Jobs/ });
      expect(jobsButton.textContent).toBe('Jobs');
    });

    it('shows the pinned count on the List tab, and switches the main canvas from map to list view', async () => {
      render(<App />);
      await screen.findByText('(2)', { selector: '.bc-pinned' });
      expect(screen.getByTestId('map-view')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'List (2)' }));
      expect(screen.queryByTestId('map-view')).not.toBeInTheDocument();
      expect(await screen.findByText('Zeller')).toBeInTheDocument();
      expect(screen.getByText('Canva')).toBeInTheDocument();

      await userEvent.click(screen.getByText('Map'));
      expect(screen.getByTestId('map-view')).toBeInTheDocument();
    });

    it('gives the filter drawer the number of matches, and its Leaderboard tab the cities the server counted', async () => {
      fetchSummary.mockResolvedValue(summaryOf({ count: 41, topCities: [{ city: 'Sydney', count: 30 }, { city: 'Melbourne', count: 11 }] }));
      render(<App />);
      await waitFor(() => expect(fetchSummary).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.getByText('(2)', { selector: '.bc-pinned' })).toBeInTheDocument());
      await openFilters();
      expect(await screen.findByText('41 startups match your filters')).toBeInTheDocument();
      await userEvent.click(screen.getByText('Leaderboard'));
      const items = screen.getAllByRole('listitem');
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
      expect(screen.getByText('Canva')).toBeInTheDocument();
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
      expect(screen.getByText('Canva')).toBeInTheDocument();
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
      expect(screen.getByText('Suggest an edit')).toBeInTheDocument();
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
      await userEvent.click(menu.getByText(/Tracked \(2\)/));
      expect(await screen.findByText('Tracked startups (2)')).toBeInTheDocument();
      await waitFor(() => expect(screen.getByText('1 of 2 tracked companies are still in the directory.')).toBeInTheDocument());
      expect(fetchStartupsByName).toHaveBeenCalledWith(['Canva', 'Gone Co'], expect.anything());
    });

    it('says the tracked list is saved in this browser when every tracked company was found', async () => {
      localStorage.setItem('auStartupTracked', JSON.stringify(['Canva']));
      fetchStartupsByName.mockResolvedValue({ results: [card('Canva')] });
      render(<App />);
      const menu = await openMenu();
      await userEvent.click(menu.getByText(/Tracked \(1\)/));
      expect(await screen.findByText('Companies you have starred, saved in this browser only.')).toBeInTheDocument();
    });

    it('shows the news ticker by default and toggles it off/on via the More menu, persisting the choice', async () => {
      render(<App />);
      await waitFor(() => expect(document.getElementById('newsTicker')).toBeInTheDocument());

      let menu = await openMenu();
      await userEvent.click(menu.getByText('Hide news'));
      expect(document.getElementById('newsTicker')).not.toBeInTheDocument();
      expect(localStorage.getItem('auStartupNewsVisible')).toBe('0');

      menu = await openMenu();
      await userEvent.click(menu.getByText('News'));
      expect(document.getElementById('newsTicker')).toBeInTheDocument();
      expect(localStorage.getItem('auStartupNewsVisible')).toBe('1');
    });

    it('opens the submit-a-startup form from the top-level nav CTA', async () => {
      render(<App />);
      await userEvent.click(screen.getByText('Submit startup'));
      expect(screen.getByText('Know an AU startup that should be on the map?', { exact: false })).toBeInTheDocument();
    });

    it('shows a BETA tag next to the title, with the full sourcing disclosure one click away in About & sources', async () => {
      render(<App />);
      expect(screen.getByText('BETA')).toBeInTheDocument();
      await userEvent.click(screen.getByText('About & sources'));
      expect(screen.getByText(/public sources/)).toBeInTheDocument();
    });

    it('opens About & sources and Privacy from the footer, and links to the no-JS directory', async () => {
      render(<App />);
      const footer = document.getElementById('siteFooter');
      expect(footer).toBeInTheDocument();

      expect(screen.getByText('Full list (no JS)').closest('a')).toHaveAttribute('href', '/directory');

      await userEvent.click(screen.getByText('About & sources'));
      expect(screen.getByText(/independent, unofficial directory/)).toBeInTheDocument();
      await userEvent.click(screen.getByLabelText('Close'));

      await userEvent.click(screen.getByText('Privacy'));
      expect(screen.getByText(/No account, no tracking cookies/)).toBeInTheDocument();
    });

    it('opens the site-wide Feedback form from the footer', async () => {
      render(<App />);
      await userEvent.click(screen.getByText('Feedback'));
      expect(screen.getByLabelText('Type')).toBeInTheDocument();
    });

    it('opens the waitlist modal from the top-level nav CTA', async () => {
      render(<App />);
      await userEvent.click(screen.getByText('Join waitlist'));
      expect(screen.getByText('Get early access to task-gated startup applications.')).toBeInTheDocument();
    });

    it('credits the builder in the footer', async () => {
      render(<App />);
      expect(screen.getByText('Built by Aryan · Monash University')).toBeInTheDocument();
    });

    it('swaps to the Jobs view (no map) when Jobs is clicked, and back again on close', async () => {
      render(<App />);
      expect(screen.getByTestId('map-view')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /^Jobs/ }));
      expect(screen.queryByTestId('map-view')).not.toBeInTheDocument();
      expect(screen.getByTestId('jobs-view')).toBeInTheDocument();

      await userEvent.click(screen.getByText('trigger-jobs-close'));
      expect(screen.getByTestId('map-view')).toBeInTheDocument();
      expect(screen.queryByTestId('jobs-view')).not.toBeInTheDocument();
    });

    it('opens Curated lists via the More menu and closes it again', async () => {
      render(<App />);
      const menu = await openMenu();
      await userEvent.click(menu.getByText('Lists'));
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
  });
});
