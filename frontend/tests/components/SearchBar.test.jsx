import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SearchBar from '../../src/components/SearchBar.jsx';

const meta = {
  sectors: ['AI', 'Fintech'],
  cities: ['Melbourne', 'Sydney'],
  investors: ['AirTree', 'Blackbird'],
  stages: ['Seed'],
};

const startups = [
  { name: 'Canva', founders: ['Melanie Perkins', 'Cliff Obrecht'] },
  { name: 'Airwallex', founders: ['Jack Zhang'] },
];

function setup(search = '') {
  const onApplyFilters = vi.fn();
  const result = render(
    <SearchBar
      filters={{ search }}
      onApplyFilters={onApplyFilters}
      startups={startups}
      meta={meta}
    />
  );
  // Real users must focus the field before a dropdown makes sense (e.g. a
  // page loaded from a shared ?search= URL shouldn't pop the dropdown open
  // unprompted). Simulate that focus so setup() matches real interaction.
  fireEvent.focus(screen.getByPlaceholderText('Search Australian startups, founders, investors...'));
  return { onApplyFilters, container: result.container };
}

describe('SearchBar', () => {
  it('shows the placeholder and no dropdown when empty', () => {
    setup();
    expect(screen.getByPlaceholderText('Search Australian startups, founders, investors...')).toBeInTheDocument();
    expect(screen.queryByText('Companies')).not.toBeInTheDocument();
  });

  it('calls onApplyFilters with the typed text as search', async () => {
    const { onApplyFilters } = setup();
    await userEvent.type(screen.getByLabelText(/Search startups/), 'c');
    expect(onApplyFilters).toHaveBeenCalledWith({ search: 'c' });
  });

  it('groups matches by Companies, People, Investors, Industries, Locations', () => {
    setup('a');
    expect(screen.getByText('Companies')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Canva' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Airwallex' })).toBeInTheDocument();

    expect(screen.getByText('People')).toBeInTheDocument();
    expect(screen.getByText('Jack Zhang')).toBeInTheDocument();

    expect(screen.getByText('Investors')).toBeInTheDocument();
    expect(screen.getByText('AirTree')).toBeInTheDocument();
  });

  it('omits groups with no matches rather than showing an empty heading', () => {
    setup('canva');
    expect(screen.getByText('Companies')).toBeInTheDocument();
    expect(screen.queryByText('Investors')).not.toBeInTheDocument();
    expect(screen.queryByText('Locations')).not.toBeInTheDocument();
  });

  it('shows an honest empty state, not fabricated results, when nothing matches', () => {
    const { container } = setup('zzznomatchzzz');
    const emptyState = container.querySelector('.search-empty');
    expect(emptyState).toHaveTextContent('No matches for');
    expect(emptyState).toHaveTextContent('zzznomatchzzz');
  });

  it('shows the founder\'s company as meta text next to their name', () => {
    setup('melanie');
    const result = screen.getByText('Melanie Perkins');
    expect(result.closest('button')).toHaveTextContent('Canva');
  });

  it('selecting a company result applies it as a search term', async () => {
    const { onApplyFilters } = setup('canva');
    await userEvent.click(screen.getByText('Canva'));
    expect(onApplyFilters).toHaveBeenLastCalledWith({ search: 'Canva' });
  });

  it('selecting a person result applies their name as a search term', async () => {
    const { onApplyFilters } = setup('melanie');
    await userEvent.click(screen.getByText('Melanie Perkins'));
    expect(onApplyFilters).toHaveBeenLastCalledWith({ search: 'Melanie Perkins' });
  });

  it('selecting an investor result clears search and applies the exact investor filter', async () => {
    const { onApplyFilters } = setup('airtree');
    await userEvent.click(screen.getByText('AirTree'));
    expect(onApplyFilters).toHaveBeenLastCalledWith({ search: '', investor: 'AirTree' });
  });

  it('selecting an industry result clears search and applies the exact sector filter', async () => {
    const { onApplyFilters } = setup('fintech');
    await userEvent.click(screen.getByText('Fintech'));
    expect(onApplyFilters).toHaveBeenLastCalledWith({ search: '', sector: 'Fintech' });
  });

  it('selecting a location result clears search and applies the exact city filter', async () => {
    const { onApplyFilters } = setup('sydney');
    await userEvent.click(screen.getByText('Sydney'));
    expect(onApplyFilters).toHaveBeenLastCalledWith({ search: '', city: 'Sydney' });
  });

  it('closes the dropdown on Escape', async () => {
    setup('canva');
    expect(screen.getByText('Companies')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText('Companies')).not.toBeInTheDocument();
  });

  it('closes the dropdown when clicking outside it', async () => {
    const { container } = setup('canva');
    expect(screen.getByText('Companies')).toBeInTheDocument();
    await userEvent.click(container.querySelector('.search-scrim'));
    expect(screen.queryByText('Companies')).not.toBeInTheDocument();
  });
});
