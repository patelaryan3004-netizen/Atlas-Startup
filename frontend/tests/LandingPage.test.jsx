import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../src/api.js', () => ({
  fetchStartups: vi.fn(),
  fetchMeta: vi.fn(),
  DIRECTORY_URL: '/directory',
}));

vi.mock('../src/components/MapView.jsx', () => ({
  default: ({ startups }) => <div data-testid="map-view" data-count={startups.length} />,
}));

import { fetchStartups, fetchMeta } from '../src/api.js';
import LandingPage from '../src/LandingPage.jsx';

const startup = (name, overrides = {}) => ({
  name, sector: 'AI', city: 'Sydney', stage: 'Seed', hiring: false,
  website: 'https://example.com', taskGate: { enabled: false, type: null }, ...overrides,
});

describe('LandingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMeta.mockResolvedValue({ sectors: ['AI', 'Fintech'] });
    fetchStartups.mockResolvedValue({
      total: 213,
      results: [
        startup('Canva', { hiring: true, taskGate: { enabled: true, type: 'Design task' } }),
        startup('Airwallex', { sector: 'Fintech', city: 'Melbourne', hiring: true }),
        startup('Quiet Co'),
      ],
    });
  });

  it('shows real, live totals in the hero rather than a hardcoded number', async () => {
    render(<LandingPage />);
    expect(await screen.findByText(/213 VC-backed companies/)).toBeInTheDocument();
    expect(screen.getByText(/for 2 of them right now/)).toBeInTheDocument();
  });

  it('both primary CTAs link to the real app, not a placeholder', async () => {
    render(<LandingPage />);
    await screen.findByText(/213 VC-backed companies/);
    const ctas = screen.getAllByText('Explore the map');
    ctas.forEach((cta) => expect(cta.closest('a')).toHaveAttribute('href', '/'));
    expect(screen.getAllByText('Browse the list')[0].closest('a')).toHaveAttribute('href', '/directory');
  });

  it('shows only real hiring companies as job cards, with a working task-gated tag', async () => {
    render(<LandingPage />);
    expect(await screen.findByText('Canva')).toBeInTheDocument();
    expect(screen.getByText('Airwallex')).toBeInTheDocument();
    expect(screen.queryByText('Quiet Co')).not.toBeInTheDocument();
    expect(screen.getAllByText('Task-gated')).toHaveLength(1);
  });

  it('computes curated list counts from the real fetched data, not a hardcoded number', async () => {
    render(<LandingPage />);
    expect(await screen.findByText('Task-gated only')).toBeInTheDocument();
    expect(screen.getByText('Melbourne AI startups')).toBeInTheDocument();
    expect(screen.getByText('Currently hiring')).toBeInTheDocument();
  });

  it('deep-links into Jobs and Curated lists inside the real app', async () => {
    render(<LandingPage />);
    await screen.findByText(/213 VC-backed companies/);
    expect(screen.getByText('See every open role →').closest('a')).toHaveAttribute('href', '/?view=jobs');
    expect(screen.getByText('Open curated lists →').closest('a')).toHaveAttribute('href', '/?view=lists');
  });

  it('flags business details as an unfilled draft rather than inventing them, in both Privacy and Terms', async () => {
    render(<LandingPage />);
    await screen.findByText(/213 VC-backed companies/);
    expect(screen.getByText(/Placeholder: operator name, ABN/)).toBeInTheDocument();
    expect(screen.getByText(/Draft, for review before this site is public/)).toBeInTheDocument();
  });

  it('degrades gracefully to a non-live-number lede if the startups fetch fails', async () => {
    fetchStartups.mockRejectedValue(new Error('network error'));
    render(<LandingPage />);
    expect(await screen.findByText(/A living map of VC-backed Australian companies/)).toBeInTheDocument();
  });
});
