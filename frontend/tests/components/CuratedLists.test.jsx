import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/api.js', () => ({ fetchCounts: vi.fn() }));

import { fetchCounts } from '../../src/api.js';
import { curatedLists } from '../../src/curatedLists.js';
import CuratedLists from '../../src/components/CuratedLists.jsx';

// The server counts a list with the filters the list applies; this answers by what was asked, not by list.
const countFor = (filters) => (filters.hiring === 'yes' ? 70 : filters.taskGate === 'yes' ? 20 : filters.city === 'Melbourne' && filters.sector === 'AI' ? 4 : 11);

describe('CuratedLists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchCounts.mockImplementation(async (sets) => ({ total: 216, counts: sets.map(countFor) }));
  });

  it('shows a category label and a company count the server worked out on a real filter-type list', async () => {
    render(<CuratedLists currentFilters={{}} onApply={() => {}} onClose={() => {}} />);

    expect(await screen.findByText('Startups Hiring Now')).toBeInTheDocument();
    const card = screen.getByText('Startups Hiring Now').closest('.curated-card');
    await waitFor(() => expect(card).toHaveTextContent('70 companies'));
    expect(card).toHaveTextContent('Status');
  });

  it('counts every list in ONE request, with the very filters "View this list" applies, so the badge and the list cannot disagree', async () => {
    render(<CuratedLists currentFilters={{}} onApply={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(fetchCounts).toHaveBeenCalledTimes(1));
    expect(fetchCounts.mock.calls[0][0]).toEqual(curatedLists.filter((l) => l.type === 'filter').map((l) => l.filters)); // in the lists' order
    await screen.findByText('Startups Hiring Now');
    expect(fetchCounts).toHaveBeenCalledTimes(1); // and not again, and not once per list
  });

  it('does not download any company to count them: only counts are asked for', async () => {
    render(<CuratedLists currentFilters={{}} onApply={() => {}} onClose={() => {}} />);
    await screen.findByText('Startups Hiring Now');
    expect(fetchCounts.mock.calls.every(([sets]) => Array.isArray(sets) && sets.every((filters) => typeof filters === 'object'))).toBe(true);
  });

  it('shows "…" until the counts arrive, and then each list\'s own count', async () => {
    let release;
    fetchCounts.mockImplementation((sets) => new Promise((resolve) => { release = () => resolve({ total: 216, counts: sets.map(countFor) }); }));
    render(<CuratedLists currentFilters={{}} onApply={() => {}} onClose={() => {}} />);
    const hiring = (await screen.findByText('Startups Hiring Now')).closest('.curated-card');
    const ai = screen.getByText('Australian AI Startups').closest('.curated-card');
    expect(hiring).toHaveTextContent('… companies');
    expect(ai).toHaveTextContent('… companies');
    release();
    await waitFor(() => expect(hiring).toHaveTextContent('70 companies'));
    expect(ai).toHaveTextContent('11 companies');
  });

  it('shows six lists to begin with, and "Show all" adds the rest (and then goes)', async () => {
    const { container } = render(<CuratedLists currentFilters={{}} onApply={() => {}} onClose={() => {}} />);
    await screen.findByText('Startups Hiring Now');
    expect(container.querySelectorAll('.curated-card')).toHaveLength(6);
    expect(screen.queryByText('Sydney Startups')).not.toBeInTheDocument();
    const more = screen.getByRole('button', { name: `Show all ${curatedLists.length} lists` });
    await userEvent.click(more);
    expect(container.querySelectorAll('.curated-card')).toHaveLength(curatedLists.length);
    expect(screen.getByText('Sydney Startups')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument();
    // the counts for the later lists were asked for with the first six, in the one request
    expect(fetchCounts).toHaveBeenCalledTimes(1);
  });

  it('shows "?" for every list when the counts cannot be had, and the lists still open', async () => {
    fetchCounts.mockRejectedValue(new Error('down'));
    const onApply = vi.fn();
    render(<CuratedLists currentFilters={{}} onApply={onApply} onClose={() => {}} />);
    const hiring = (await screen.findByText('Startups Hiring Now')).closest('.curated-card');
    await waitFor(() => expect(hiring).toHaveTextContent('? companies'));
    expect(screen.getByText('Australian AI Startups').closest('.curated-card')).toHaveTextContent('? companies');
    await userEvent.click(within(hiring).getByText('View this list'));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('shows "?" for a list the server sent no count for', async () => {
    fetchCounts.mockResolvedValue({ total: 216, counts: [5] });
    render(<CuratedLists currentFilters={{}} onApply={() => {}} onClose={() => {}} />);
    const hiring = (await screen.findByText('Startups Hiring Now')).closest('.curated-card');
    await waitFor(() => expect(hiring).toHaveTextContent('5 companies'));
    expect(screen.getByText('Australian AI Startups').closest('.curated-card')).toHaveTextContent('? companies');
  });

  it('hands over the list when "View this list" is clicked: the page opens it at its own address and closes this', async () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(<CuratedLists currentFilters={{}} onApply={onApply} onClose={onClose} />);
    await screen.findByText('Startups Hiring Now');

    const card = screen.getByText('Startups Hiring Now').closest('.curated-card');
    await userEvent.click(within(card).getByText('View this list'));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0]).toMatchObject({ id: 'currently-hiring', filters: { hiring: 'yes' } });
    expect(onClose).not.toHaveBeenCalled(); // the page moves on to the list: it does not also step back
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
