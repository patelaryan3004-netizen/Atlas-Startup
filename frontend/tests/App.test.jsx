import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../src/api.js', () => ({
  fetchStartups: vi.fn(),
  fetchMeta: vi.fn(),
  fetchNews: vi.fn(),
  submitStartup: vi.fn(),
  DIRECTORY_URL: '/directory',
}));

vi.mock('../src/components/MapView.jsx', () => ({
  default: ({ startups, sectorColors, onSelectStartup }) => (
    <div data-testid="map-view" data-count={startups.length} data-colors={Object.keys(sectorColors).join(',')}>
      <button onClick={() => onSelectStartup({ name: 'Canva', sector: 'AI' })}>trigger-select</button>
    </div>
  ),
}));

vi.mock('../src/components/StartupDetailPanel.jsx', () => ({
  default: ({ startup, onSuggestEdit, onClose }) => (
    <div data-testid="startup-detail-panel">
      <span>{startup.name}</span>
      <button onClick={() => onSuggestEdit(startup.name)}>trigger-suggest-edit</button>
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

import { fetchStartups, fetchMeta, fetchNews } from '../src/api.js';
import App from '../src/App.jsx';

const meta = {
  sectors: ['Fintech', 'AI'],
  cities: ['Sydney'],
  investors: ['Blackbird'],
  stages: ['Seed'],
};

const startup = (name, overrides = {}) => ({
  name, sector: 'AI', sectorFull: 'AI', city: 'Sydney', investors: ['Blackbird'], stage: 'Seed', hiring: true, verified: true, ...overrides,
});

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
    fetchStartups.mockResolvedValue({ total: 2, count: 2, results: [startup('Canva'), startup('Zeller')] });
    fetchNews.mockResolvedValue({ source: 'live', deals: [] });
  });

  it('loads metadata and startups on mount with empty filters', async () => {
    render(<App />);
    await waitFor(() => expect(fetchMeta).toHaveBeenCalledTimes(1));
    expect(fetchStartups).toHaveBeenCalledWith({ search: '', sector: '', city: '', investor: '', stage: '', hiring: '', taskGate: '' });
  });

  it('shows a subtle hiring-count hint on the Jobs nav link, reflecting the whole directory not just current filters', async () => {
    render(<App />);
    const jobsButton = await screen.findByRole('button', { name: /^Jobs/ });
    expect(jobsButton).toHaveTextContent('Jobs · 2 hiring now');
  });

  it('omits the hiring hint entirely when nobody is hiring, rather than showing "0 hiring now"', async () => {
    fetchStartups.mockResolvedValue({ total: 1, count: 1, results: [startup('Canva', { hiring: false })] });
    render(<App />);
    const jobsButton = await screen.findByRole('button', { name: /^Jobs/ });
    expect(jobsButton).toHaveTextContent('Jobs');
    expect(jobsButton.textContent).toBe('Jobs');
  });

  it('shows a pinned-count on the List tab, and switches the main canvas from map to list view', async () => {
    render(<App />);
    await screen.findByText('(2)', { selector: '.bc-pinned' });
    expect(screen.getByTestId('map-view')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'List (2)' }));
    expect(screen.queryByTestId('map-view')).not.toBeInTheDocument();
    expect(screen.getByText('Canva')).toBeInTheDocument();
    expect(screen.getByText('Zeller')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Map'));
    expect(screen.getByTestId('map-view')).toBeInTheDocument();
  });

  it('refetches startups when typing in the top-level search box', async () => {
    render(<App />);
    await waitFor(() =>
      expect(fetchStartups).toHaveBeenCalledWith({ search: '', sector: '', city: '', investor: '', stage: '', hiring: '', taskGate: '' })
    );

    await userEvent.type(screen.getByLabelText(/Search startups/), 'x');

    await waitFor(() =>
      expect(fetchStartups).toHaveBeenLastCalledWith({ search: 'x', sector: '', city: '', investor: '', stage: '', hiring: '', taskGate: '' })
    );
  });

  it('resets filters back to empty when Clear all is clicked', async () => {
    render(<App />);
    await waitFor(() =>
      expect(fetchStartups).toHaveBeenCalledWith({ search: '', sector: '', city: '', investor: '', stage: '', hiring: '', taskGate: '' })
    );

    await userEvent.type(screen.getByLabelText(/Search startups/), 'x');
    await waitFor(() => expect(fetchStartups).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'x' })));

    await openFilters();
    await userEvent.click(screen.getByText('Clear all'));
    await waitFor(() =>
      expect(fetchStartups).toHaveBeenLastCalledWith({ search: '', sector: '', city: '', investor: '', stage: '', hiring: '', taskGate: '' })
    );
  });

  it('falls back to an empty list if fetching startups fails', async () => {
    fetchStartups.mockRejectedValue(new Error('network error'));
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('map-view').dataset.count).toBe('0'));
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

  it('opens the unconfirmed-location list showing only unverified startups, via the More menu', async () => {
    fetchStartups.mockResolvedValue({
      total: 2, count: 2,
      results: [startup('Canva'), startup('Mystery Co', { verified: false })],
    });
    render(<App />);
    await waitFor(() => expect(fetchStartups).toHaveBeenCalled());

    await openMenu();
    expect(screen.getByText('Unconfirmed (1)')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Unconfirmed (1)'));
    expect(screen.getByText('Unconfirmed location (1)')).toBeInTheDocument();
    expect(screen.getByText('Mystery Co')).toBeInTheDocument();
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

  it('opens the startup detail panel when a marker is selected on the map', async () => {
    render(<App />);
    await userEvent.click(screen.getByText('trigger-select'));
    expect(screen.getByTestId('startup-detail-panel')).toBeInTheDocument();
    expect(screen.getByText('Canva')).toBeInTheDocument();

    await userEvent.click(screen.getByText('trigger-detail-close'));
    expect(screen.queryByTestId('startup-detail-panel')).not.toBeInTheDocument();
  });

  it('opens Suggest an edit for a specific company when triggered from the detail panel', async () => {
    render(<App />);
    await userEvent.click(screen.getByText('trigger-select'));
    await userEvent.click(screen.getByText('trigger-suggest-edit'));
    expect(screen.getByText('Suggest an edit')).toBeInTheDocument();
    expect(screen.getAllByText('Canva').length).toBeGreaterThan(0);
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

  it('applying a curated list replaces the active filters (not merging with whatever was set) and refetches', async () => {
    render(<App />);
    await userEvent.type(screen.getByLabelText(/Search startups/), 'x');
    await waitFor(() => expect(fetchStartups).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'x' })));

    const menu = await openMenu();
    await userEvent.click(menu.getByText('Lists'));
    await userEvent.click(screen.getByText('trigger-apply-list'));

    expect(screen.queryByTestId('curated-lists')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(fetchStartups).toHaveBeenLastCalledWith({
        search: '', sector: 'AI', city: 'Melbourne', investor: '', stage: '', hiring: '', taskGate: '',
      })
    );
  });

  it('seeds filters from the URL query string on load and fetches with them applied', async () => {
    window.history.pushState({}, '', '/?sector=Fintech&city=Sydney');
    render(<App />);
    await waitFor(() =>
      expect(fetchStartups).toHaveBeenCalledWith({
        search: '', sector: 'Fintech', city: 'Sydney', investor: '', stage: '', hiring: '', taskGate: '',
      })
    );
    window.history.pushState({}, '', '/');
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
