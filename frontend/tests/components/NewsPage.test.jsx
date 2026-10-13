import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/api.js', () => ({ fetchNews: vi.fn() }));

import { fetchNews } from '../../src/api.js';
import NewsPage from '../../src/components/NewsPage.jsx';

const deals = [
  { headline: 'Eight ANZ startups raised $67.4 million this week', meta: 'SmartCompany · 14 Aug', url: 'https://example.test/a' },
  { headline: 'Funding is getting harder', meta: 'Forbes Australia · 23 July', url: 'https://example.test/b' },
];

describe('NewsPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('lists each headline as a link to its publisher that opens in a new tab, with who published it and when', async () => {
    fetchNews.mockResolvedValue({ source: 'cache', deals });
    render(<NewsPage onClose={() => {}} />);
    const link = await screen.findByRole('link', { name: /Eight ANZ startups raised/ });
    expect(link).toHaveAttribute('href', 'https://example.test/a');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(link).toHaveTextContent('SmartCompany · 14 Aug');
    expect(within(screen.getByRole('list')).getAllByRole('link')).toHaveLength(2); // the headlines; the brand and Map links in the bar are not in the list
    expect(screen.getByRole('heading', { level: 1, name: 'Australian startup news' })).toBeInTheDocument();
  });

  it('says where the headlines came from: the feed, the last read of it, or the short list kept with the site', async () => {
    for (const [source, words] of [['live', /Fresh from the feed/], ['cache', /last read of the feed/], ['seeded', /live feed could not be read/]]) {
      fetchNews.mockResolvedValue({ source, deals });
      const view = render(<NewsPage onClose={() => {}} />);
      expect(await screen.findByText(words)).toBeInTheDocument();
      view.unmount();
    }
  });

  it('asks for a fresh read when "Get the latest" is pressed', async () => {
    fetchNews.mockResolvedValue({ source: 'cache', deals });
    render(<NewsPage onClose={() => {}} />);
    await screen.findByRole('link', { name: /Funding is getting harder/ });
    expect(fetchNews).toHaveBeenLastCalledWith(false);
    await userEvent.click(screen.getByRole('button', { name: 'Get the latest' }));
    await waitFor(() => expect(fetchNews).toHaveBeenLastCalledWith(true));
  });

  it('says so, and offers to try again, when the news cannot be had', async () => {
    fetchNews.mockRejectedValueOnce(new Error('down'));
    render(<NewsPage onClose={() => {}} />);
    expect(await screen.findByText('Could not load the news right now.')).toBeInTheDocument();
    fetchNews.mockResolvedValue({ source: 'live', deals });
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: /Eight ANZ startups raised/ })).toBeInTheDocument();
  });

  it('keeps the headlines it has when a refresh fails', async () => {
    fetchNews.mockResolvedValueOnce({ source: 'cache', deals });
    render(<NewsPage onClose={() => {}} />);
    await screen.findByRole('link', { name: /Eight ANZ startups raised/ });
    fetchNews.mockRejectedValueOnce(new Error('down'));
    await userEvent.click(screen.getByRole('button', { name: 'Get the latest' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Get the latest' })).not.toBeDisabled());
    expect(screen.getByRole('link', { name: /Eight ANZ startups raised/ })).toBeInTheDocument();
    expect(screen.queryByText('Could not load the news right now.')).not.toBeInTheDocument();
  });

  it('says there is nothing when the feed is empty, and leaves for the map on request', async () => {
    fetchNews.mockResolvedValue({ source: 'live', deals: [] });
    const onClose = vi.fn();
    render(<NewsPage onClose={onClose} />);
    expect(await screen.findByText('No headlines right now.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '← Back to map' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('names itself to the tab and to search engines', async () => {
    fetchNews.mockResolvedValue({ source: 'live', deals });
    const view = render(<NewsPage onClose={() => {}} />);
    await screen.findByRole('link', { name: /Eight ANZ/ });
    expect(document.title).toBe('Australian startup news · AU Startup Map');
    expect(document.querySelector('link[rel="canonical"]').getAttribute('href')).toBe(`${window.location.origin}/news`);
    view.unmount();
  });
});
