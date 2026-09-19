import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../src/api.js', () => ({
  fetchStartups: vi.fn(),
  fetchMeta: vi.fn(),
  fetchNews: vi.fn(),
  submitStartup: vi.fn(),
}));

vi.mock('../src/components/MapView.jsx', () => ({
  default: ({ startups, sectorColors, onSuggestEdit }) => (
    <div data-testid="map-view" data-count={startups.length} data-colors={Object.keys(sectorColors).join(',')}>
      <button onClick={() => onSuggestEdit('Canva')}>trigger-suggest-edit</button>
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
  await userEvent.click(screen.getByText('Filter startups'));
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    fetchMeta.mockResolvedValue(meta);
    fetchStartups.mockResolvedValue({ total: 2, count: 2, results: [startup('Canva'), startup('Zeller')] });
    fetchNews.mockResolvedValue({ source: 'live', deals: [] });
  });

  it('loads metadata and startups on mount and shows the total count', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText('2 companies tracked')).toBeInTheDocument());
    expect(fetchMeta).toHaveBeenCalledTimes(1);
    expect(fetchStartups).toHaveBeenCalledWith({ search: '', sector: '', city: '', investor: '', stage: '', hiring: '' });
  });

  it('shows a pinned-count bottom capsule that opens the full startup list', async () => {
    render(<App />);
    await screen.findByText('2', { selector: '.bottom-capsule strong' });
    expect(screen.getByText('startups pinned on map')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Show list ↑'));
    expect(screen.getByText('Startups in view (2)')).toBeInTheDocument();
    expect(screen.getByText('Canva')).toBeInTheDocument();
    expect(screen.getByText('Zeller')).toBeInTheDocument();
  });

  it('refetches startups with updated filters when the search box changes', async () => {
    render(<App />);
    await waitFor(() => expect(fetchStartups).toHaveBeenCalledTimes(1));
    await openFilters();

    await userEvent.type(screen.getByPlaceholderText('Company name...'), 'x');

    await waitFor(() =>
      expect(fetchStartups).toHaveBeenLastCalledWith({ search: 'x', sector: '', city: '', investor: '', stage: '', hiring: '' })
    );
  });

  it('resets filters back to empty when Reset filters is clicked', async () => {
    render(<App />);
    await waitFor(() => expect(fetchStartups).toHaveBeenCalledTimes(1));
    await openFilters();

    await userEvent.type(screen.getByPlaceholderText('Company name...'), 'x');
    await waitFor(() => expect(fetchStartups).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'x' })));

    await userEvent.click(screen.getByText('Reset filters'));
    await waitFor(() =>
      expect(fetchStartups).toHaveBeenLastCalledWith({ search: '', sector: '', city: '', investor: '', stage: '', hiring: '' })
    );
  });

  it('falls back to an empty list if fetching startups fails', async () => {
    fetchStartups.mockRejectedValue(new Error('network error'));
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('map-view').dataset.count).toBe('0'));
  });

  it('shows the news ticker by default and toggles it off/on, persisting the choice', async () => {
    render(<App />);
    await screen.findByText('Hide news');
    expect(document.getElementById('newsTicker')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Hide news'));
    expect(screen.getByText('Show news')).toBeInTheDocument();
    expect(document.getElementById('newsTicker')).not.toBeInTheDocument();
    expect(localStorage.getItem('auStartupNewsVisible')).toBe('0');

    await userEvent.click(screen.getByText('Show news'));
    expect(screen.getByText('Hide news')).toBeInTheDocument();
    expect(localStorage.getItem('auStartupNewsVisible')).toBe('1');
  });

  it('opens the unconfirmed-location list showing only unverified startups', async () => {
    fetchStartups.mockResolvedValue({
      total: 2, count: 2,
      results: [startup('Canva'), startup('Mystery Co', { verified: false })],
    });
    render(<App />);
    await screen.findByText('Unconfirmed (1)');

    await userEvent.click(screen.getByText('Unconfirmed (1)'));
    expect(screen.getByText('Unconfirmed location (1)')).toBeInTheDocument();
    expect(screen.getByText('Mystery Co')).toBeInTheDocument();
  });

  it('opens the submit-a-startup form', async () => {
    render(<App />);
    await userEvent.click(screen.getByText('Submit a startup'));
    expect(screen.getByText('Know an AU startup that should be on the map?', { exact: false })).toBeInTheDocument();
  });

  it('shows a BETA tag next to the title and a sourcing-disclosure line', async () => {
    render(<App />);
    expect(screen.getByText('BETA')).toBeInTheDocument();
    expect(screen.getByText(/public sources \+ submissions/)).toBeInTheDocument();
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

  it('opens Suggest an edit for a specific company when triggered from the map', async () => {
    render(<App />);
    await userEvent.click(screen.getByText('trigger-suggest-edit'));
    expect(screen.getByText('Suggest an edit')).toBeInTheDocument();
    expect(screen.getByText('Canva')).toBeInTheDocument();
  });

  it('opens the site-wide Feedback form from the footer', async () => {
    render(<App />);
    await userEvent.click(screen.getByText('Feedback'));
    expect(screen.getByLabelText('Type')).toBeInTheDocument();
  });
});
