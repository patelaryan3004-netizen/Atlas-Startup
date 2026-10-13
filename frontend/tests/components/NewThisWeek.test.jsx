import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/api.js', () => ({ fetchStartupPage: vi.fn() }));

import { fetchStartupPage } from '../../src/api.js';
import NewThisWeek from '../../src/components/NewThisWeek.jsx';

const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
const dayAgo = (days) => ago(days).slice(0, 10);
const company = (name, over = {}) => ({ name, slug: name.toLowerCase(), website: `https://${name.toLowerCase()}.example`, ...over });
const FILTERS = { sector: 'AI', fresh: '' };

describe('the "New this week" strip', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('asks for the companies that are new this week among the ones the filters pick, a few of them, and lists each with what is new', async () => {
    fetchStartupPage.mockResolvedValue({ count: 2, results: [company('Acme', { last_funding_date: dayAgo(3) }), company('Bolt', { last_role_seen_at: ago(1) })] });
    render(<NewThisWeek filters={FILTERS} onSelectStartup={() => {}} />);
    expect(await screen.findByRole('heading', { name: 'New this week' })).toBeInTheDocument();
    expect(fetchStartupPage).toHaveBeenCalledWith({ sector: 'AI', fresh: 'week' }, expect.objectContaining({ limit: 8, offset: 0, sort: 'name' }));
    const items = screen.getAllByRole('button').map((b) => b.textContent);
    expect(items[0]).toMatch(/^AAcmeRaised \d{1,2} \w{3}$/);
    expect(items[1]).toMatch(/^BBoltNew role \d{1,2} \w{3}$/);
  });

  it('opens a company from the strip', async () => {
    const acme = company('Acme', { last_funding_date: dayAgo(3) });
    fetchStartupPage.mockResolvedValue({ count: 1, results: [acme] });
    const onSelectStartup = vi.fn();
    render(<NewThisWeek filters={FILTERS} onSelectStartup={onSelectStartup} />);
    await userEvent.click(await screen.findByRole('button', { name: /Acme/ }));
    expect(onSelectStartup).toHaveBeenCalledWith(acme);
  });

  it('is not there when no company is new: nothing is drawn, not even the heading', async () => {
    fetchStartupPage.mockResolvedValue({ count: 0, results: [] });
    const { container } = render(<NewThisWeek filters={FILTERS} onSelectStartup={() => {}} />);
    await waitFor(() => expect(fetchStartupPage).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('leaves out a company with no date of its own, whatever the server sent, and is not there when none has one', async () => {
    fetchStartupPage.mockResolvedValue({ count: 2, results: [company('Plain'), company('Old', { last_funding_date: dayAgo(30) })] });
    const { container } = render(<NewThisWeek filters={FILTERS} onSelectStartup={() => {}} />);
    await waitFor(() => expect(fetchStartupPage).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('is not there when the request fails', async () => {
    fetchStartupPage.mockRejectedValue(new Error('down'));
    const { container } = render(<NewThisWeek filters={FILTERS} onSelectStartup={() => {}} />);
    await waitFor(() => expect(fetchStartupPage).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('offers to list all of them when there are more than the strip holds', async () => {
    fetchStartupPage.mockResolvedValue({ count: 19, results: [company('Acme', { last_funding_date: dayAgo(2) })] });
    const onShowAll = vi.fn();
    render(<NewThisWeek filters={FILTERS} onSelectStartup={() => {}} onShowAll={onShowAll} />);
    await userEvent.click(await screen.findByRole('button', { name: 'See all 19' }));
    expect(onShowAll).toHaveBeenCalledTimes(1);
  });

  it('does not offer "See all" when the strip holds them all', async () => {
    fetchStartupPage.mockResolvedValue({ count: 1, results: [company('Acme', { last_funding_date: dayAgo(2) })] });
    render(<NewThisWeek filters={FILTERS} onSelectStartup={() => {}} onShowAll={() => {}} />);
    await screen.findByRole('heading', { name: 'New this week' });
    expect(screen.queryByRole('button', { name: /See all/ })).toBeNull();
  });

  it('asks for nothing while the list is already narrowed to the companies that are new', async () => {
    const { container } = render(<NewThisWeek filters={{ ...FILTERS, fresh: 'week' }} onSelectStartup={() => {}} />);
    await Promise.resolve();
    expect(fetchStartupPage).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });
});
