import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/api.js', () => ({ fetchCount: vi.fn() }));

import { fetchCount } from '../../src/api.js';
import { curatedLists } from '../../src/curatedLists.js';
import CuratedLists from '../../src/components/CuratedLists.jsx';

// The server counts a list with the filters the list applies; this answers by what was asked, not by list.
const countFor = (filters) => (filters.hiring === 'yes' ? 70 : filters.taskGate === 'yes' ? 20 : filters.city === 'Melbourne' && filters.sector === 'AI' ? 4 : 11);

describe('CuratedLists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchCount.mockImplementation(async (filters) => ({ total: 216, count: countFor(filters) }));
  });

  it('shows a category label and a company count the server worked out on a real filter-type list', async () => {
    render(<CuratedLists currentFilters={{}} onApply={() => {}} onClose={() => {}} />);

    expect(await screen.findByText('Startups Hiring Now')).toBeInTheDocument();
    const card = screen.getByText('Startups Hiring Now').closest('.curated-card');
    await waitFor(() => expect(card).toHaveTextContent('70 companies'));
    expect(card).toHaveTextContent('Status');
  });

  it('counts each list with the very filters "View this list" applies, so the badge and the list cannot disagree', async () => {
    render(<CuratedLists currentFilters={{}} onApply={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(fetchCount).toHaveBeenCalledTimes(curatedLists.filter((l) => l.type === 'filter').length));
    for (const list of curatedLists.filter((l) => l.type === 'filter')) expect(fetchCount).toHaveBeenCalledWith(list.filters);
  });

  it('does not download any company to count them: only counts are asked for', async () => {
    render(<CuratedLists currentFilters={{}} onApply={() => {}} onClose={() => {}} />);
    await screen.findByText('Startups Hiring Now');
    expect(fetchCount.mock.calls.every(([filters]) => typeof filters === 'object')).toBe(true);
  });

  it('shows "…" until a count arrives, each count as it arrives, and "?" for a list whose count could not be had', async () => {
    let release;
    fetchCount.mockImplementation((filters) => {
      if (filters.hiring === 'yes') return new Promise((resolve) => { release = () => resolve({ count: 70 }); });
      if (filters.city === 'Sydney,Sydney (Chippendale)') return Promise.reject(new Error('down'));
      return Promise.resolve({ count: countFor(filters) });
    });
    render(<CuratedLists currentFilters={{}} onApply={() => {}} onClose={() => {}} />);
    const hiring = (await screen.findByText('Startups Hiring Now')).closest('.curated-card');
    const gated = screen.getByText('Sydney Startups').closest('.curated-card');
    const melbourne = screen.getByText('Melbourne AI startups').closest('.curated-card');
    await waitFor(() => expect(melbourne).toHaveTextContent('4 companies')); // the others are not held up by the slow one
    expect(hiring).toHaveTextContent('… companies');
    expect(gated).toHaveTextContent('? companies');
    release();
    await waitFor(() => expect(hiring).toHaveTextContent('70 companies'));
  });

  it('applies the list filters and closes when "View this list" is clicked', async () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(<CuratedLists currentFilters={{}} onApply={onApply} onClose={onClose} />);
    await screen.findByText('Startups Hiring Now');

    const card = screen.getByText('Startups Hiring Now').closest('.curated-card');
    await userEvent.click(within(card).getByText('View this list'));

    expect(onApply).toHaveBeenCalledWith({ hiring: 'yes' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('never uses ranking language like "best" or "top" - discovery only, no unsupported quality claims', async () => {
    render(<CuratedLists currentFilters={{}} onApply={() => {}} onClose={() => {}} />);
    await screen.findByText('Startups Hiring Now');
    expect(screen.queryByText(/\bbest\b/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\btop\b/i)).not.toBeInTheDocument();
  });

  it('copies a shareable URL of the current filters when Share current view is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CuratedLists currentFilters={{ sector: 'AI' }} onApply={() => {}} onClose={() => {}} />);

    await userEvent.click(screen.getByText('🔗 Share current view'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('sector=AI'));
    expect(await screen.findByText('Copied!')).toBeInTheDocument();
  });
});
