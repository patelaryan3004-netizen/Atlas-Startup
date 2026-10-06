import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/api.js', () => ({ fetchSuggestions: vi.fn() }));

import { fetchSuggestions } from '../../src/api.js';
import SearchBar from '../../src/components/SearchBar.jsx';

const NONE = { companies: [], people: [], investors: [], industries: [], locations: [] };
const FOUND = {
  companies: [{ name: 'Canva', slug: 'canva', city: 'Sydney', sector: 'SaaS' }, { name: 'Airwallex', slug: 'airwallex', city: 'Melbourne', sector: 'Fintech' }],
  people: [{ name: 'Jack Zhang', company: 'Airwallex' }, { name: 'Melanie Perkins', company: 'Canva' }],
  investors: ['AirTree'], industries: ['Fintech'], locations: ['Sydney'],
};
const PLACEHOLDER = 'Search Australian startups, founders, investors...';

function setup(search = '') {
  const onApplyFilters = vi.fn();
  const view = render(<SearchBar filters={{ search }} onApplyFilters={onApplyFilters} />);
  // Real users must focus the field before a dropdown makes sense (a page loaded from a shared ?search= URL
  // shouldn't pop the dropdown open unprompted). Simulate that focus so setup() matches real interaction.
  fireEvent.focus(screen.getByPlaceholderText(PLACEHOLDER));
  return { onApplyFilters, container: view.container, rerender: (text) => view.rerender(<SearchBar filters={{ search: text }} onApplyFilters={onApplyFilters} />) };
}

describe('SearchBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchSuggestions.mockResolvedValue(FOUND);
  });

  it('shows the placeholder, no dropdown and no request when empty', () => {
    setup();
    expect(screen.getByPlaceholderText(PLACEHOLDER)).toBeInTheDocument();
    expect(screen.queryByText('Companies')).not.toBeInTheDocument();
    expect(fetchSuggestions).not.toHaveBeenCalled();
  });

  it('calls onApplyFilters with the typed text as search', async () => {
    const { onApplyFilters } = setup();
    await userEvent.type(screen.getByLabelText(/Search startups/), 'c');
    expect(onApplyFilters).toHaveBeenCalledWith({ search: 'c' });
  });

  it('asks the server for suggestions for the text, and shows them grouped: Companies, People, Investors, Industries, Locations', async () => {
    setup('a');
    expect(await screen.findByText('Companies')).toBeInTheDocument();
    expect(fetchSuggestions).toHaveBeenCalledWith('a', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByRole('button', { name: 'Canva' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Airwallex' })).toBeInTheDocument();
    expect(screen.getByText('People')).toBeInTheDocument();
    expect(screen.getByText('Jack Zhang')).toBeInTheDocument();
    expect(screen.getByText('Investors')).toBeInTheDocument();
    expect(screen.getByText('AirTree')).toBeInTheDocument();
    expect(screen.getByText('Industries')).toBeInTheDocument();
    expect(screen.getByText('Locations')).toBeInTheDocument();
  });

  it('waits for a pause in the typing, and asks once for the text it ended on', async () => {
    const { rerender } = setup('c');
    rerender('ca');
    rerender('can');
    await screen.findByText('Companies');
    expect(fetchSuggestions).toHaveBeenCalledTimes(1);
    expect(fetchSuggestions.mock.calls[0][0]).toBe('can');
  });

  it('cancels the request for text that has since changed, and never shows its answer', async () => {
    let resolveFirst;
    fetchSuggestions.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }));
    const { rerender } = setup('ca');
    await waitFor(() => expect(fetchSuggestions).toHaveBeenCalledTimes(1));
    const firstSignal = fetchSuggestions.mock.calls[0][1].signal;
    fetchSuggestions.mockResolvedValueOnce({ ...NONE, companies: [{ name: 'Canva', slug: 'canva' }] });
    rerender('can');
    expect(await screen.findByRole('button', { name: 'Canva' })).toBeInTheDocument();
    expect(firstSignal.aborted).toBe(true);
    await act(async () => { resolveFirst({ ...NONE, companies: [{ name: 'Stale Co', slug: 'stale' }] }); });
    expect(screen.queryByText('Stale Co')).not.toBeInTheDocument();
  });

  it('omits groups with no matches rather than showing an empty heading', async () => {
    fetchSuggestions.mockResolvedValue({ ...NONE, companies: [{ name: 'Canva', slug: 'canva' }] });
    setup('canva');
    expect(await screen.findByText('Companies')).toBeInTheDocument();
    expect(screen.queryByText('Investors')).not.toBeInTheDocument();
    expect(screen.queryByText('Locations')).not.toBeInTheDocument();
  });

  it('shows an honest empty state, not fabricated results, when nothing matches', async () => {
    fetchSuggestions.mockResolvedValue(NONE);
    const { container } = setup('zzznomatchzzz');
    await waitFor(() => expect(container.querySelector('.search-empty')).not.toBeNull());
    expect(container.querySelector('.search-empty')).toHaveTextContent('No matches for');
    expect(container.querySelector('.search-empty')).toHaveTextContent('zzznomatchzzz');
  });

  it('shows nothing, and does not break, when the suggestions cannot be fetched', async () => {
    fetchSuggestions.mockRejectedValue(new Error('down'));
    const { container } = setup('canva');
    await waitFor(() => expect(fetchSuggestions).toHaveBeenCalled());
    await act(async () => {});
    expect(container.querySelector('.search-empty')).toBeNull();
    expect(screen.queryByText('Companies')).not.toBeInTheDocument();
  });

  it('shows the founder\'s company as meta text next to their name', async () => {
    setup('melanie');
    const result = await screen.findByText('Melanie Perkins');
    expect(result.closest('button')).toHaveTextContent('Canva');
  });

  it('selecting a company result applies it as a search term', async () => {
    const { onApplyFilters } = setup('canva');
    await userEvent.click(await screen.findByRole('button', { name: 'Canva' }));
    expect(onApplyFilters).toHaveBeenLastCalledWith({ search: 'Canva' });
  });

  it('selecting a person result applies their name as a search term', async () => {
    const { onApplyFilters } = setup('melanie');
    await userEvent.click(await screen.findByText('Melanie Perkins'));
    expect(onApplyFilters).toHaveBeenLastCalledWith({ search: 'Melanie Perkins' });
  });

  it('selecting an investor result clears search and applies the exact investor filter', async () => {
    const { onApplyFilters } = setup('airtree');
    await userEvent.click(await screen.findByText('AirTree'));
    expect(onApplyFilters).toHaveBeenLastCalledWith({ search: '', investor: 'AirTree' });
  });

  it('selecting an industry result clears search and applies the exact sector filter', async () => {
    const { onApplyFilters } = setup('fintech');
    await userEvent.click(await screen.findByRole('button', { name: 'Fintech' }));
    expect(onApplyFilters).toHaveBeenLastCalledWith({ search: '', sector: 'Fintech' });
  });

  it('selecting a location result clears search and applies the exact city filter', async () => {
    const { onApplyFilters } = setup('sydney');
    await userEvent.click(await screen.findByRole('button', { name: 'Sydney' }));
    expect(onApplyFilters).toHaveBeenLastCalledWith({ search: '', city: 'Sydney' });
  });

  it('closes the dropdown on Escape', async () => {
    setup('canva');
    expect(await screen.findByText('Companies')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText('Companies')).not.toBeInTheDocument();
  });

  it('closes the dropdown when clicking outside it', async () => {
    const { container } = setup('canva');
    expect(await screen.findByText('Companies')).toBeInTheDocument();
    await userEvent.click(container.querySelector('.search-scrim'));
    expect(screen.queryByText('Companies')).not.toBeInTheDocument();
  });
});
