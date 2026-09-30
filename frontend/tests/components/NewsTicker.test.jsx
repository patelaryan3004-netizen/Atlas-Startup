import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/api.js', () => ({
  fetchNews: vi.fn(),
}));

import { fetchNews } from '../../src/api.js';
import NewsTicker from '../../src/components/NewsTicker.jsx';

const deal = {
  headline: 'Some startup raises $10M',
  meta: 'Sydney · Seed',
  url: 'https://example.com/deal',
};

async function expand() {
  await userEvent.click(screen.getByText(/AU Startup Deals/));
}

describe('NewsTicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stays a collapsed one-line status bar until expanded, with no headline shown yet', async () => {
    fetchNews.mockResolvedValue({ source: 'live', deals: [deal] });
    render(<NewsTicker visible={true} onClose={() => {}} />);

    await screen.findByText(/live/);
    expect(screen.queryByText(deal.headline)).not.toBeInTheDocument();
  });

  it('expands to show the headline and meta for every deal, labeling the status as live', async () => {
    fetchNews.mockResolvedValue({ source: 'live', deals: [deal] });
    render(<NewsTicker visible={true} onClose={() => {}} />);
    await screen.findByText(/live/);

    await expand();
    expect(screen.getByText(deal.headline)).toBeInTheDocument();
    expect(screen.getByText(deal.meta)).toBeInTheDocument();
  });

  it('labels the status as cached when the backend served from cache', async () => {
    fetchNews.mockResolvedValue({ source: 'cache', deals: [deal] });
    render(<NewsTicker visible={true} onClose={() => {}} />);
    expect(await screen.findByText(/cached/)).toBeInTheDocument();
  });

  it('labels the status as seeded when the backend had to fall back', async () => {
    fetchNews.mockResolvedValue({ source: 'seeded', deals: [deal] });
    render(<NewsTicker visible={true} onClose={() => {}} />);
    expect(await screen.findByText(/seeded/)).toBeInTheDocument();
  });

  it('shows "unavailable" if the fetch fails', async () => {
    fetchNews.mockRejectedValue(new Error('network down'));
    render(<NewsTicker visible={true} onClose={() => {}} />);
    expect(await screen.findByText(/unavailable/)).toBeInTheDocument();
  });

  it('renders nothing when visible is false', () => {
    fetchNews.mockResolvedValue({ source: 'live', deals: [deal] });
    const { container } = render(<NewsTicker visible={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('calls onClose when the close button is clicked', async () => {
    fetchNews.mockResolvedValue({ source: 'live', deals: [deal] });
    const onClose = vi.fn();
    render(<NewsTicker visible={true} onClose={onClose} />);
    await screen.findByText(/live/);

    await userEvent.click(screen.getByTitle('Hide news'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('collapses again when the title is clicked a second time', async () => {
    fetchNews.mockResolvedValue({ source: 'live', deals: [deal] });
    render(<NewsTicker visible={true} onClose={() => {}} />);
    await screen.findByText(/live/);

    await expand();
    expect(screen.getByText(deal.headline)).toBeInTheDocument();

    await expand();
    expect(screen.queryByText(deal.headline)).not.toBeInTheDocument();
  });

  it('refresh button forces a live re-fetch and shows the new deals once expanded', async () => {
    const secondDeal = { headline: 'Fresh headline', meta: 'Melbourne · Series A', url: 'https://example.com/fresh' };
    fetchNews.mockResolvedValueOnce({ source: 'cache', deals: [deal] });
    render(<NewsTicker visible={true} onClose={() => {}} />);
    await screen.findByText(/cached/);

    fetchNews.mockResolvedValueOnce({ source: 'live', deals: [secondDeal] });
    await userEvent.click(screen.getByTitle('Get the latest news'));
    await screen.findByText(/live/);

    await expand();
    expect(screen.getByText('Fresh headline')).toBeInTheDocument();
    expect(fetchNews).toHaveBeenLastCalledWith(true);
  });
});
