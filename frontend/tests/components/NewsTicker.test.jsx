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

const pill = () => screen.getByRole('button', { name: /^News/ });
async function expand() {
  await userEvent.click(pill());
}
async function collapse() {
  await userEvent.click(screen.getByText(/AU Startup Deals/));
}

describe('NewsTicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is only a small pill until pressed: no card, no headline, no refresh or hide', async () => {
    fetchNews.mockResolvedValue({ source: 'live', deals: [deal] });
    render(<NewsTicker visible={true} onClose={() => {}} />);

    await screen.findByText(/live/);
    expect(pill()).toHaveTextContent('News');
    expect(pill()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(deal.headline)).not.toBeInTheDocument();
    expect(screen.queryByText(/AU Startup Deals/)).not.toBeInTheDocument();
    expect(screen.queryByTitle('Hide news')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Get the latest news')).not.toBeInTheDocument();
  });

  it('expands to show the headline and meta for every deal, labeling the status as live', async () => {
    fetchNews.mockResolvedValue({ source: 'live', deals: [deal] });
    render(<NewsTicker visible={true} onClose={() => {}} />);
    await screen.findByText(/live/);

    await expand();
    expect(screen.getByText(/AU Startup Deals/)).toBeInTheDocument();
    expect(screen.getByText(/● live/)).toBeInTheDocument();
    expect(screen.getByText(deal.headline)).toBeInTheDocument();
    expect(screen.getByText(deal.meta)).toBeInTheDocument();
    expect(screen.getByText(deal.headline).closest('a')).toHaveAttribute('href', deal.url);
    expect(screen.getByRole('button', { name: /AU Startup Deals/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('says the status to a screen reader on the pill, and in a tooltip', async () => {
    fetchNews.mockResolvedValue({ source: 'cache', deals: [deal] });
    render(<NewsTicker visible={true} onClose={() => {}} />);
    expect(await screen.findByText(/cached/)).toBeInTheDocument();
    expect(pill()).toHaveAttribute('title', 'AU Startup Deals · cached');
  });

  it('labels the status as seeded when the backend had to fall back', async () => {
    fetchNews.mockResolvedValue({ source: 'seeded', deals: [deal] });
    render(<NewsTicker visible={true} onClose={() => {}} />);
    expect(await screen.findByText(/seeded/)).toBeInTheDocument();
  });

  it('shows "unavailable" if the fetch fails, with a muted dot', async () => {
    fetchNews.mockRejectedValue(new Error('network down'));
    const { container } = render(<NewsTicker visible={true} onClose={() => {}} />);
    expect(await screen.findByText(/unavailable/)).toBeInTheDocument();
    expect(container.querySelector('.nt-dot')).toHaveClass('nt-dot-off');
  });

  it('renders nothing when visible is false', () => {
    fetchNews.mockResolvedValue({ source: 'live', deals: [deal] });
    const { container } = render(<NewsTicker visible={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('calls onClose when the hide button is clicked', async () => {
    fetchNews.mockResolvedValue({ source: 'live', deals: [deal] });
    const onClose = vi.fn();
    render(<NewsTicker visible={true} onClose={onClose} />);
    await screen.findByText(/live/);

    await expand();
    await userEvent.click(screen.getByTitle('Hide news'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('collapses again to the pill when the title is clicked a second time', async () => {
    fetchNews.mockResolvedValue({ source: 'live', deals: [deal] });
    render(<NewsTicker visible={true} onClose={() => {}} />);
    await screen.findByText(/live/);

    await expand();
    expect(screen.getByText(deal.headline)).toBeInTheDocument();

    await collapse();
    expect(screen.queryByText(deal.headline)).not.toBeInTheDocument();
    expect(pill()).toBeInTheDocument();
  });

  it('refresh button forces a live re-fetch and shows the new deals', async () => {
    const secondDeal = { headline: 'Fresh headline', meta: 'Melbourne · Series A', url: 'https://example.com/fresh' };
    fetchNews.mockResolvedValueOnce({ source: 'cache', deals: [deal] });
    render(<NewsTicker visible={true} onClose={() => {}} />);
    await screen.findByText(/cached/);

    await expand();
    fetchNews.mockResolvedValueOnce({ source: 'live', deals: [secondDeal] });
    await userEvent.click(screen.getByTitle('Get the latest news'));
    expect(await screen.findByText('Fresh headline')).toBeInTheDocument();
    expect(screen.getByText(/● live/)).toBeInTheDocument();
    expect(fetchNews).toHaveBeenLastCalledWith(true);
  });
});
