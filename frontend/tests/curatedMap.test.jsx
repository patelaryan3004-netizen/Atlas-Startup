import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AtlasHead from '../src/components/explore/AtlasHead.jsx';
import FilterPanel from '../src/components/FilterPanel.jsx';
import { activeChips, withoutChip } from '../src/components/ActiveFilters.jsx';
import { markersUrl, startupPageUrl, summaryUrl } from '../src/apiUrls.js';
import { readAppRoute, exploreSearch, appUrl } from '../src/appRoute.js';

// The owner's curated list: the map shows only the companies it says (onMap), and can be narrowed to Early or Growth ones (maturity).
const FILTERS = { search: '', sector: '', city: '', investor: '', stage: '', hiring: '', taskGate: '', events: '', precision: '', state: '', remote: '', tech: '', team: '', cohort: '', fresh: '', maturity: '' };
const MATURITIES = [{ value: 'Early', count: 344 }, { value: 'Growth', count: 58 }, { value: 'Unverified', count: 24 }];

const head = (props = {}) => {
  const handlers = { onFilterChange: vi.fn(), onEntityChange: vi.fn(), onToggleFilters: vi.fn(), onList: vi.fn() };
  render(
    <AtlasHead filters={FILTERS} sectors={['Fintech']} stages={['Seed']} entity="all" filtersOpen={false} filterCount={0} listHref="/discover" count="426 organisations" maturities={MATURITIES} {...handlers} {...props} />,
  );
  return handlers;
};

describe('the map page\'s Early / Growth filter', () => {
  it('has a button for Early and one for Growth (not for Unverified), neither pressed to begin with', () => {
    head();
    const group = screen.getByRole('group', { name: 'Company maturity: early or growth' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Early', 'Growth']);
    for (const b of within(group).getAllByRole('button')) expect(b).toHaveAttribute('aria-pressed', 'false');
  });

  it('turns each on and off, and both together are "Early,Growth", through the one maturity filter', async () => {
    const { onFilterChange } = head();
    await userEvent.click(screen.getByRole('button', { name: 'Early' }));
    expect(onFilterChange).toHaveBeenLastCalledWith({ maturity: 'Early' });
    onFilterChange.mockClear();
    head({ filters: { ...FILTERS, maturity: 'Early' }, onFilterChange });
    const buttons = screen.getAllByRole('button', { name: 'Early' });
    expect(buttons[buttons.length - 1]).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getAllByRole('button', { name: 'Growth' }).pop());
    expect(onFilterChange).toHaveBeenLastCalledWith({ maturity: 'Early,Growth' });
    await userEvent.click(screen.getAllByRole('button', { name: 'Early' }).pop());
    expect(onFilterChange).toHaveBeenLastCalledWith({ maturity: '' });
  });

  it('is not drawn when the directory has no maturities (before the curated list is applied), or only ones the map does not filter by', () => {
    const { unmount } = render(<AtlasHead filters={FILTERS} sectors={[]} stages={[]} entity="all" filtersOpen={false} filterCount={0} listHref="/discover" count="1" onFilterChange={() => {}} onEntityChange={() => {}} onToggleFilters={() => {}} onList={() => {}} />);
    expect(screen.queryByRole('group', { name: /Company maturity/ })).not.toBeInTheDocument();
    unmount();
    head({ maturities: [{ value: 'Unverified', count: 24 }] });
    expect(screen.queryByRole('group', { name: /Company maturity/ })).not.toBeInTheDocument();
  });
});

describe('the filter panel\'s section for it', () => {
  const meta = { sectors: [], cities: [], investors: [], stages: ['Seed'], maturities: MATURITIES };
  const filters = { search: '', sector: '', city: '', investor: '', stage: '', hiring: '', maturity: '' };

  it('lists the maturities the map has as a menu of several, and sets the maturity filter (the funding Stage menu is a different one)', async () => {
    const onChange = vi.fn();
    render(<FilterPanel filters={filters} onChange={onChange} onReset={() => {}} meta={meta} resultCount={2} summary={{ count: 2, topCities: [], notable: { total: 0, items: [] }, vouched: { total: 0, items: [] } }} />);
    await userEvent.click(screen.getByText('☰ Filters'));
    expect(screen.getByText('Early or growth')).toBeInTheDocument();
    expect(screen.getByText('Startup stage')).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'Maturity' });
    await userEvent.click(group.querySelector('summary'));
    await userEvent.click(within(group).getByRole('checkbox', { name: /Growth/ }));
    expect(onChange).toHaveBeenLastCalledWith({ ...filters, maturity: 'Growth' });
  });

  it('has no such section when the directory has none', async () => {
    render(<FilterPanel filters={filters} onChange={() => {}} onReset={() => {}} meta={{ ...meta, maturities: [] }} resultCount={2} summary={{ count: 2, topCities: [], notable: { total: 0, items: [] }, vouched: { total: 0, items: [] } }} />);
    await userEvent.click(screen.getByText('☰ Filters'));
    expect(screen.queryByText('Early or growth')).not.toBeInTheDocument();
  });
});

describe('the chip for it, and the addresses', () => {
  it('is a chip per maturity chosen, each taking only its own off', () => {
    const filters = { ...FILTERS, maturity: 'Early,Growth' };
    const chips = activeChips(filters);
    expect(chips.filter((c) => c.key === 'maturity').map((c) => `${c.group}: ${c.text}`)).toEqual(['Maturity: Early', 'Maturity: Growth']);
    expect(withoutChip(filters, chips.find((c) => c.text === 'Early')).maturity).toBe('Growth');
  });

  it('does not ask the pins for onMap (they are only ever the companies the map shows), but asks the counts and the list', () => {
    expect(markersUrl({ city: 'Perth', onMap: 'yes' })).toBe('/api/startups/markers?city=Perth');
    expect(markersUrl({ onMap: 'yes' })).toBe('/api/startups/markers');
    expect(summaryUrl({ onMap: 'yes' })).toBe('/api/startups/summary?onMap=yes');
    expect(startupPageUrl({ onMap: 'yes' }, { limit: 48, offset: 0, sort: 'name' })).toContain('onMap=yes');
  });

  it('writes the maturity in an address, and never onMap, and an address with a maturity opens Discover', () => {
    expect(exploreSearch({ ...FILTERS, maturity: 'Early', onMap: 'yes', city: 'Perth' }, 'list')).toBe('?city=Perth&maturity=Early');
    expect(appUrl({ kind: 'map' }, { filters: { ...FILTERS, maturity: 'Growth', onMap: 'yes' } })).toBe('/map?maturity=Growth');
    expect(readAppRoute({ pathname: '/', search: '?maturity=Early' })).toEqual({ kind: 'explore' });
  });
});
