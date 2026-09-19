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

describe('NewsTicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders deals from a live fetch and labels the status as live', async () => {
    fetchNews.mockResolvedValue({ source: 'live', deals: [deal] });
    render(<NewsTicker visible={true} onClose={() => {}} />);

    expect(await screen.findByText(deal.headline)).toBeInTheDocument();
    expect(screen.getByText(/live/)).toBeInTheDocument();
  });

  it('labels the status as cached when the backend served from cache', async () => {
    fetchNews.mockResolvedValue({ source: 'cache', deals: [deal] });
    render(<NewsTicker visible={true} onClose={() => {}} />);

    await screen.findByText(deal.headline);
    expect(screen.getByText(/cached/)).toBeInTheDocument();
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
    await screen.findByText(deal.headline);

    await userEvent.click(screen.getByTitle('Hide news'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('labels the status as seeded when the backend had to fall back', async () => {
    fetchNews.mockResolvedValue({ source: 'seeded', deals: [deal] });
    render(<NewsTicker visible={true} onClose={() => {}} />);
    await screen.findByText(deal.headline);
    expect(screen.getByText(/seeded/)).toBeInTheDocument();
  });

  it('refresh button forces a live re-fetch and shows the new deals', async () => {
    const secondDeal = { headline: 'Fresh headline', meta: 'Melbourne · Series A', url: 'https://example.com/fresh' };
    fetchNews.mockResolvedValueOnce({ source: 'cache', deals: [deal] });
    render(<NewsTicker visible={true} onClose={() => {}} />);
    await screen.findByText(deal.headline);

    fetchNews.mockResolvedValueOnce({ source: 'live', deals: [secondDeal] });
    await userEvent.click(screen.getByTitle('Get the latest news'));

    expect(await screen.findByText('Fresh headline')).toBeInTheDocument();
    expect(fetchNews).toHaveBeenLastCalledWith(true);
    expect(screen.getByText(/live/)).toBeInTheDocument();
  });
});
