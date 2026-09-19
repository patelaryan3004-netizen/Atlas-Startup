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

function setup(overrides = {}) {
  const onChange = vi.fn();
  const onReset = vi.fn();
  render(
    <FilterPanel
      filters={emptyFilters}
      onChange={onChange}
      onReset={onReset}
      meta={meta}
      resultCount={2}
      total={4}
      {...overrides}
    />
  );
  return { onChange, onReset };
}

async function open() {
  await userEvent.click(screen.getByText('Filter startups'));
}

describe('FilterPanel', () => {
  it('starts collapsed, with no filter fields in the document', () => {
    setup();
    expect(screen.getByText('Filter startups')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Company name...')).not.toBeInTheDocument();
  });

  it('shows an active-filter count badge on the toggle when filters are set', () => {
    setup({ filters: { ...emptyFilters, sector: 'AI', hiring: 'yes' } });
    expect(screen.getByText('Filter startups (2)')).toBeInTheDocument();
  });

  it('expands to reveal all meta options in their selects', async () => {
    setup();
    await open();
    expect(screen.getByRole('option', { name: 'AI' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Sydney' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Blackbird' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Series A' })).toBeInTheDocument();
  });

  it('collapses again when the toggle is clicked a second time', async () => {
    setup();
    await open();
    expect(screen.getByPlaceholderText('Company name...')).toBeInTheDocument();
    await userEvent.click(screen.getByText('← Hide filters'));
    expect(screen.queryByPlaceholderText('Company name...')).not.toBeInTheDocument();
  });

  it('shows the result count out of total once expanded', async () => {
    setup({ resultCount: 3, total: 60 });
    await open();
    expect(screen.getByText('3 of 60 shown')).toBeInTheDocument();
  });

  it('calls onChange with the updated search value when typing', async () => {
    const { onChange } = setup();
    await open();
    await userEvent.type(screen.getByPlaceholderText('Company name...'), 'C');
    expect(onChange).toHaveBeenCalledWith({ ...emptyFilters, search: 'C' });
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
    await userEvent.click(screen.getByText('Reset filters'));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
