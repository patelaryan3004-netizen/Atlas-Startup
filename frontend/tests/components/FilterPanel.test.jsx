import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FilterPanel from '../../src/components/FilterPanel.jsx';

const meta = {
  sectors: ['AI', 'Fintech'],
  cities: ['Melbourne', 'Sydney'],
  investors: ['AirTree', 'Blackbird'],
  stages: ['Seed', 'Series A'],
};

const emptyFilters = { search: '', sector: '', city: '', investor: '', stage: '', hiring: '' };

// What the server says about the current results (see fetchSummary): the panel's tabs read this, not the companies.
function summaryOf(overrides = {}) {
  return {
    count: 3, pinned: 3, unverified: 0, hiring: 0,
    topCities: [{ city: 'Sydney', count: 2 }, { city: 'Melbourne', count: 1 }],
    notable: { total: 0, items: [] },
    vouched: { total: 0, items: [] },
    ...overrides,
  };
}

function setup(overrides = {}) {
  const onChange = vi.fn();
  const onReset = vi.fn();
  const result = render(
    <FilterPanel
      filters={emptyFilters}
      onChange={onChange}
      onReset={onReset}
      meta={meta}
      resultCount={2}
      summary={summaryOf()}
      {...overrides}
    />
  );
  return { onChange, onReset, container: result.container };
}

async function open() {
  await userEvent.click(screen.getByText('☰ Filters'));
}

describe('FilterPanel', () => {
  it('starts collapsed, with no drawer in the document', () => {
    setup();
    expect(screen.getByText('☰ Filters')).toBeInTheDocument();
    expect(screen.queryByLabelText('Sector')).not.toBeInTheDocument();
  });

  it('shows an active-filter count badge on the toggle when filters are set', () => {
    setup({ filters: { ...emptyFilters, sector: 'AI', hiring: 'yes' } });
    expect(screen.getByText('☰ Filters (2)')).toBeInTheDocument();
  });

  it('opens on the Filters tab by default, revealing all meta options in their selects', async () => {
    setup();
    await open();
    expect(screen.getByRole('option', { name: 'AI' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Sydney' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Blackbird' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Series A' })).toBeInTheDocument();
  });

  it('lets a visitor pick a state and how exactly the place is known, and says what each kind means for the map', async () => {
    const { onChange } = setup();
    await open();
    await userEvent.selectOptions(screen.getByLabelText('State'), 'VIC');
    expect(onChange).toHaveBeenLastCalledWith({ ...emptyFilters, state: 'VIC' });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(expect.arrayContaining(['Exact office', 'Suburb only (approximate)', 'City only (no pin)', 'State only (no pin)']));
    await userEvent.selectOptions(screen.getByLabelText('How exactly the place is known'), 'CITY');
    expect(onChange).toHaveBeenLastCalledWith({ ...emptyFilters, precision: 'CITY' });
  });

  it('shows the state and the kind of location it is filtered by, counts them as filters, and copes with filters from before they existed', async () => {
    setup({ filters: { ...emptyFilters, state: 'NSW', precision: 'SUBURB' } });
    expect(screen.getByText('☰ Filters (2)')).toBeInTheDocument();
    await userEvent.click(screen.getByText(/^☰ Filters/));
    expect(screen.getByLabelText('State')).toHaveValue('NSW');
    expect(screen.getByLabelText('How exactly the place is known')).toHaveValue('SUBURB');
  });

  it('has no search field - search lives in the top-level nav, not this drawer', async () => {
    setup();
    await open();
    expect(screen.queryByPlaceholderText('Company name...')).not.toBeInTheDocument();
  });

  it('switches to the Leaderboard tab and shows city counts, without touching filter fields', async () => {
    setup();
    await open();
    await userEvent.click(screen.getByText('Leaderboard'));

    expect(screen.queryByLabelText('Sector')).not.toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Sydney');
    expect(items[0]).toHaveTextContent('2');
  });

  it('still opens before the first counts have arrived, with empty tabs rather than an error', async () => {
    setup({ summary: null });
    await open();
    await userEvent.click(screen.getByText('Leaderboard'));
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    await userEvent.click(screen.getByText('Vouched'));
    expect(screen.getByText('No vouches yet.')).toBeInTheDocument();
  });

  it('switches to the Notable tab and shows founded-year list', async () => {
    setup({
      summary: summaryOf({ notable: { total: 2, items: [{ name: 'Old Co', foundedYear: 2004 }, { name: 'New Co', foundedYear: 2020 }] } }),
    });
    await open();
    await userEvent.click(screen.getByText('Notable'));

    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Old Co');
    expect(items[0]).toHaveTextContent('2004');
  });

  it('switches to the Vouched tab and shows an honest empty state when no startup has a vouch', async () => {
    setup();
    await open();
    await userEvent.click(screen.getByText('Vouched'));
    expect(screen.getByText('No vouches yet.')).toBeInTheDocument();
  });

  it('switches to the Vouched tab and shows real vouch counts once data exists', async () => {
    setup({
      summary: summaryOf({ vouched: { total: 1, items: [{ name: 'Vouched Co', vouches: 2 }] } }),
    });
    await open();
    await userEvent.click(screen.getByText('Vouched'));

    expect(screen.queryByText('No vouches yet.')).not.toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Vouched Co');
    expect(items[0]).toHaveTextContent('2');
  });

  it('closes when the toggle is clicked a second time', async () => {
    setup();
    await open();
    expect(screen.getByLabelText('Sector')).toBeInTheDocument();
    await userEvent.click(screen.getByText('☰ Filters'));
    expect(screen.queryByLabelText('Sector')).not.toBeInTheDocument();
  });

  it('closes via the X button', async () => {
    setup();
    await open();
    await userEvent.click(screen.getByLabelText('Close'));
    expect(screen.queryByLabelText('Sector')).not.toBeInTheDocument();
  });

  it('closes via Escape', async () => {
    setup();
    await open();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByLabelText('Sector')).not.toBeInTheDocument();
  });

  it('closes when clicking outside the panel, but not when clicking inside it', async () => {
    const { container } = setup();
    await open();
    await userEvent.click(container.querySelector('.fdrawer-panel'));
    expect(screen.getByLabelText('Sector')).toBeInTheDocument();

    await userEvent.click(container.querySelector('.fdrawer-overlay'));
    expect(screen.queryByLabelText('Sector')).not.toBeInTheDocument();
  });

  it('shows the number of matching startups once expanded', async () => {
    setup({ resultCount: 3 });
    await open();
    expect(screen.getByText('3 startups match your filters')).toBeInTheDocument();
  });

  it('uses singular phrasing for exactly one match', async () => {
    setup({ resultCount: 1 });
    await open();
    expect(screen.getByText('1 startup matches your filters')).toBeInTheDocument();
  });

  it('calls onChange with the updated sector when selecting one', async () => {
    const { onChange } = setup();
    await open();
    await userEvent.selectOptions(screen.getByLabelText('Sector'), 'Fintech');
    expect(onChange).toHaveBeenCalledWith({ ...emptyFilters, sector: 'Fintech' });
  });

  it('calls onReset when the reset button is clicked', async () => {
    const { onReset } = setup();
    await open();
    await userEvent.click(screen.getByText('Clear all'));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('closes the drawer when Apply filters is clicked, without changing filters', async () => {
    const { onChange } = setup();
    await open();
    await userEvent.click(screen.getByText('Apply filters'));
    expect(screen.queryByLabelText('Sector')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
