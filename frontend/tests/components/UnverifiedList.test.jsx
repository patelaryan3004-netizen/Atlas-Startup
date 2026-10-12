import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/api.js', () => ({ fetchStartupPage: vi.fn() }));

import { fetchStartupPage } from '../../src/api.js';
import UnverifiedList from '../../src/components/UnverifiedList.jsx';

function s(name, overrides = {}) {
  return { name, slug: name.toLowerCase(), sector: 'AI', sectorFull: 'AI', stage: 'Seed', verified: false, ...overrides };
}

describe('UnverifiedList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchStartupPage.mockResolvedValue({ total: 300, count: 2, results: [s('A'), s('C')] });
  });

  it('asks the server for the unconfirmed ones among the current filters, by name, and lists what it sends with the count', async () => {
    render(<UnverifiedList filters={{ city: 'Sydney', search: '' }} onClose={() => {}} />);
    expect(await screen.findByText('A')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
    expect(screen.getByText('Unconfirmed location (2)')).toBeInTheDocument();
    expect(fetchStartupPage).toHaveBeenCalledWith({ city: 'Sydney', search: '', verified: 'no' }, expect.objectContaining({ limit: 20, offset: 0, sort: 'name' }));
  });

  it('asks once when no filters are given, and does not go on asking after every render', async () => {
    render(<UnverifiedList onClose={() => {}} />);
    await screen.findByText('A');
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchStartupPage).toHaveBeenCalledTimes(1);
  });

  it('says it is loading, and says so when it could not load', async () => {
    fetchStartupPage.mockRejectedValue(new Error('down'));
    render(<UnverifiedList onClose={() => {}} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(await screen.findByText('Could not load this list right now.')).toBeInTheDocument();
  });

  it('offers "Show more" with how many are left when there are more than it lists, and adds the next page after the ones shown', async () => {
    fetchStartupPage.mockResolvedValueOnce({ total: 900, count: 450, results: [s('A'), s('B')], hasMore: true, nextOffset: 2 });
    render(<UnverifiedList filters={{ city: 'Sydney' }} onClose={() => {}} />);
    const more = await screen.findByRole('button', { name: 'Show more (448 left)' });
    fetchStartupPage.mockResolvedValueOnce({ total: 900, count: 450, results: [s('C'), s('D')], hasMore: false, nextOffset: null });
    await userEvent.click(more);
    expect(await screen.findByText('D')).toBeInTheDocument();
    expect(fetchStartupPage).toHaveBeenLastCalledWith({ city: 'Sydney', verified: 'no' }, expect.objectContaining({ limit: 20, offset: 2, sort: 'name' }));
    expect(screen.getAllByRole('listitem').map((li) => li.querySelector('.uv-name').textContent)).toEqual(['A', 'B', 'C', 'D']);
    expect(screen.queryByRole('button', { name: /Show more/ })).not.toBeInTheDocument();
  });

  it('keeps what it has and says so when the next page cannot load', async () => {
    fetchStartupPage.mockResolvedValueOnce({ total: 900, count: 450, results: [s('A')], hasMore: true, nextOffset: 1 });
    render(<UnverifiedList onClose={() => {}} />);
    fetchStartupPage.mockRejectedValueOnce(new Error('down'));
    await userEvent.click(await screen.findByRole('button', { name: /Show more/ }));
    expect(await screen.findByRole('button', { name: 'Could not load more: try again' })).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    render(<UnverifiedList onClose={onClose} />);
    await screen.findByText('A');
    await userEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
