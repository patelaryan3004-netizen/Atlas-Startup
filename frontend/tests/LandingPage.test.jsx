import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../src/api.js', () => ({
  fetchStartupPage: vi.fn(),
  fetchSummary: vi.fn(),
  fetchMarkers: vi.fn(),
  fetchCount: vi.fn(),
  fetchMeta: vi.fn(),
  DIRECTORY_URL: '/directory',
}));

vi.mock('../src/components/MapView.jsx', () => ({
  default: ({ markers }) => <div data-testid="map-view" data-count={markers.length} />,
}));

import { fetchStartupPage, fetchSummary, fetchMarkers, fetchCount, fetchMeta } from '../src/api.js';
import { curatedLists } from '../src/curatedLists.js';
import LandingPage from '../src/LandingPage.jsx';

const startup = (name, overrides = {}) => ({
  name, slug: name.toLowerCase(), sector: 'AI', city: 'Sydney', stage: 'Seed', hiring: true,
  website: 'https://example.com', taskGate: { enabled: false, type: null }, ...overrides,
});

describe('LandingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMeta.mockResolvedValue({ sectors: ['AI', 'Fintech'] });
    fetchSummary.mockResolvedValue({ count: 213, pinned: 200, unverified: 13, hiring: 2, taskGated: 1, cities: 2 });
    fetchStartupPage.mockResolvedValue({
      results: [startup('Canva', { taskGate: { enabled: true, type: 'Design task' } }), startup('Airwallex', { sector: 'Fintech', city: 'Melbourne' })],
    });
    fetchMarkers.mockResolvedValue({ items: [['canva', 'Canva', -33.9, 151.2, 'SaaS', 'Sydney', 1, 'canva.com'], ['airwallex', 'Airwallex', -37.8, 144.9, 'Fintech', 'Melbourne', 1, '']] });
    fetchCount.mockImplementation(async (filters) => ({ total: 213, count: filters.hiring === 'yes' ? 2 : 7 }));
  });

  it('shows real, live stats in the hero rather than hardcoded numbers, worked out by the server', async () => {
    const { container } = render(<LandingPage />);
    await screen.findByText(/VC-backed companies tracked/);

    const items = container.querySelectorAll('.landing-stats li');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent('213 VC-backed companies tracked');
    expect(items[1]).toHaveTextContent('2 hiring right now');
    expect(items[2]).toHaveTextContent('2 cities across Australia');
    expect(items[3]).toHaveTextContent('1 with a real work-sample task instead of a form');
    expect(fetchSummary).toHaveBeenCalledWith({});
  });

  it('does not ask for the whole list: it asks for four hiring companies, pins and counts', async () => {
    render(<LandingPage />);
    await screen.findByText(/VC-backed companies tracked/);
    expect(fetchStartupPage).toHaveBeenCalledWith({ hiring: 'yes' }, { limit: 4, sort: 'file' });
    expect(fetchMarkers).toHaveBeenCalledWith({});
  });

  it('draws the hero map from the pins the server sent', async () => {
    render(<LandingPage />);
    await waitFor(() => expect(screen.getByTestId('map-view')).toHaveAttribute('data-count', '2'));
  });

  it('both primary CTAs link to the real app, not a placeholder', async () => {
    render(<LandingPage />);
    await screen.findByText(/VC-backed companies tracked/);
    const ctas = screen.getAllByText('Explore the map');
    ctas.forEach((cta) => expect(cta.closest('a')).toHaveAttribute('href', '/'));
    expect(screen.getAllByText('Browse the list')[0].closest('a')).toHaveAttribute('href', '/directory');
  });

  it('shows the hiring companies the server sent as job cards, with a working task-gated tag', async () => {
    render(<LandingPage />);
    expect(await screen.findByText('Canva')).toBeInTheDocument();
    expect(screen.getByText('Airwallex')).toBeInTheDocument();
    expect(screen.getAllByText('Task-gated')).toHaveLength(1);
  });

  it('takes curated list counts from the server, counted with each list\'s own filters, not a hardcoded number', async () => {
    render(<LandingPage />);
    expect(await screen.findByText('Task-gated only')).toBeInTheDocument();
    expect(screen.getByText('Melbourne AI startups')).toBeInTheDocument();
    expect(screen.getByText('Startups Hiring Now')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Startups Hiring Now').closest('.landing-list-card')).toHaveTextContent('2 companies'));
    expect(screen.getByText('Melbourne AI startups').closest('.landing-list-card')).toHaveTextContent('7 companies');
    for (const list of curatedLists.filter((l) => l.type === 'filter')) expect(fetchCount).toHaveBeenCalledWith(list.filters);
  });

  it('deep-links into Jobs and Curated lists inside the real app', async () => {
    render(<LandingPage />);
    await screen.findByText(/VC-backed companies tracked/);
    expect(screen.getByText('See every open role →').closest('a')).toHaveAttribute('href', '/?view=jobs');
    expect(screen.getByText('Open curated lists →').closest('a')).toHaveAttribute('href', '/?view=lists');
  });

  it('flags business details as an unfilled draft rather than inventing them, in both Privacy and Terms', async () => {
    render(<LandingPage />);
    await screen.findByText(/VC-backed companies tracked/);
    expect(screen.getByText(/Placeholder: operator name, ABN/)).toBeInTheDocument();
    expect(screen.getByText(/Draft, for review before this site is public/)).toBeInTheDocument();
  });

  it('degrades gracefully to a non-live-number lede if the counts cannot be fetched', async () => {
    fetchSummary.mockRejectedValue(new Error('network error'));
    render(<LandingPage />);
    expect(await screen.findByText(/A living map of VC-backed Australian companies/)).toBeInTheDocument();
  });

  it('still shows the rest of the page when a count or the pins cannot be fetched', async () => {
    fetchMarkers.mockRejectedValue(new Error('down'));
    fetchCount.mockRejectedValue(new Error('down'));
    render(<LandingPage />);
    expect(await screen.findByText(/VC-backed companies tracked/)).toBeInTheDocument();
    expect(screen.getByTestId('map-view')).toHaveAttribute('data-count', '0');
  });
});
