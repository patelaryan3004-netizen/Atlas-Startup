import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/api.js', () => ({ fetchStartup: vi.fn(), fetchSuggestions: vi.fn(), fetchNews: vi.fn(), fetchInvestorsByName: vi.fn() }));

import { fetchStartup, fetchSuggestions, fetchNews } from '../../src/api.js';
import ActiveFilters, { activeChips, withoutChip } from '../../src/components/ActiveFilters.jsx';
import FilterPanel from '../../src/components/FilterPanel.jsx';
import QuickFilters from '../../src/components/QuickFilters.jsx';
import SearchBar from '../../src/components/SearchBar.jsx';
import StartupPanel from '../../src/components/explore/StartupPanel.jsx';
import StartupDetailPanel from '../../src/components/StartupDetailPanel.jsx';

const EMPTY = { search: '', sector: '', city: '', investor: '', stage: '', hiring: '', taskGate: '', events: '', precision: '', state: '', remote: '', tech: '', team: '', cohort: '', fresh: '' };
const COHORTS = [{ id: 'startmate-w26', label: 'Startmate · Winter 2026', accelerator: 'Startmate', cohort: 'Winter 2026', count: 15 }];
const PROGRAM = { id: 'startmate-w26', accelerator: 'Startmate', cohort: 'Winter 2026', label: 'Startmate · Winter 2026', aliases: ['W26'], source_url: 'https://www.startmate.com/portfolio-companies/acme', verified_at: '2026-10-21T04:43:27.000Z' };

describe('the cohort chip', () => {
  it('says the cohort in words, from the directory\'s list, and takes it off', async () => {
    const filters = { ...EMPTY, cohort: 'startmate-w26' };
    expect(activeChips(filters, COHORTS)).toEqual([{ key: 'cohort', value: 'startmate-w26', group: 'Accelerator', text: 'Startmate · Winter 2026' }]);
    expect(activeChips(filters)[0].text).toBe('startmate-w26'); // a cohort the list does not know is shown as it is
    expect(withoutChip(filters, { key: 'cohort', value: 'startmate-w26' }).cohort).toBe('');
    const onChange = vi.fn();
    render(<ActiveFilters filters={filters} cohorts={COHORTS} onChange={onChange} onClear={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove filter: Accelerator Startmate · Winter 2026' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY, cohort: '' });
  });
});

describe('the cohort filter', () => {
  const meta = { sectors: ['AI'], cities: ['Sydney'], investors: [], stages: ['Seed'] };
  const open = async () => userEvent.click(screen.getByText('☰ Filters'));
  const setup = (m = meta, filters = EMPTY) => {
    const onChange = vi.fn();
    render(<FilterPanel filters={filters} onChange={onChange} onReset={() => {}} meta={m} resultCount={3} summary={{ count: 3, topCities: [], notable: { total: 0, items: [] }, vouched: { total: 0, items: [] } }} />);
    return { onChange };
  };

  it('is not in the panel while no company is in a cohort', async () => {
    setup();
    await open();
    expect(screen.queryByLabelText('Cohort')).toBeNull();
    expect(screen.queryByText('Accelerator', { selector: '.fsection-label' })).toBeNull();
  });

  it('offers each cohort with how many companies are in it, and sets the filter', async () => {
    const { onChange } = setup({ ...meta, cohorts: COHORTS });
    await open();
    expect([...screen.getByLabelText('Cohort').querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Any', 'Startmate · Winter 2026 (15)']);
    await userEvent.selectOptions(screen.getByLabelText('Cohort'), 'startmate-w26');
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY, cohort: 'startmate-w26' });
  });

  it('shows it chosen, and counts it on the toggle', async () => {
    setup({ ...meta, cohorts: COHORTS }, { ...EMPTY, cohort: 'startmate-w26' });
    await userEvent.click(screen.getByText('☰ Filters (1)'));
    expect(screen.getByLabelText('Cohort')).toHaveValue('startmate-w26');
  });

  it('is a quick filter above the list too, which switches on and off', async () => {
    const onChange = vi.fn();
    const view = render(<QuickFilters filters={EMPTY} meta={{ sectors: [], stages: [], cities: [], cohorts: COHORTS }} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Startmate · Winter 2026' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY, cohort: 'startmate-w26' });
    view.rerender(<QuickFilters filters={{ ...EMPTY, cohort: 'startmate-w26' }} meta={{ cohorts: COHORTS }} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Startmate · Winter 2026' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Startmate · Winter 2026' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY, cohort: '' });
  });
});

describe('searching for a cohort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchSuggestions.mockResolvedValue({ companies: [], people: [], investors: [], industries: [], locations: [], cohorts: [{ id: 'startmate-w26', label: 'Startmate · Winter 2026', count: 15 }] });
  });

  it('suggests the cohort for "w26", with how many companies, and picking it sets the filter and clears the text', async () => {
    const onApplyFilters = vi.fn();
    render(<SearchBar filters={{ search: 'w26' }} onApplyFilters={onApplyFilters} />);
    fireEvent.focus(screen.getByPlaceholderText(/Search Australian startups/));
    expect(await screen.findByText('Accelerators')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Startmate · Winter 2026/ }));
    expect(onApplyFilters).toHaveBeenLastCalledWith({ search: '', cohort: 'startmate-w26' });
  });

  it('does not say there is nothing when the cohort is all that matches', async () => {
    render(<SearchBar filters={{ search: 'startmate' }} onApplyFilters={() => {}} />);
    fireEvent.focus(screen.getByPlaceholderText(/Search Australian startups/));
    await screen.findByText('Accelerators');
    expect(screen.queryByText(/No matches/)).toBeNull();
  });
});

describe('what a company says about its cohort', () => {
  it('shows the founders and the cohort, with the page that says so, in the map\'s panel', async () => {
    fetchStartup.mockResolvedValue({ slug: 'acme', name: 'Acme AI', sector: 'AI', blurb: 'Makes things.', website: 'https://acme.ai', founders: ['Ada Lovelace', 'Alan Turing'], programs: [PROGRAM], stage: 'Unknown', verified: true });
    render(<StartupPanel pin={{ slug: 'acme', name: 'Acme AI', city: 'Sydney', sector: 'AI', hiring: false, website: 'https://acme.ai' }} onToggleSaved={() => {}} onOpen={() => {}} onClose={() => {}} />);
    expect(await screen.findByText('Ada Lovelace, Alan Turing')).toBeInTheDocument();
    expect(screen.getByText('Founders')).toBeInTheDocument();
    const row = screen.getByText('Accelerator').closest('div');
    expect(within(row).getByText(/Startmate · Winter 2026/)).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Startmate page' })).toHaveAttribute('href', PROGRAM.source_url);
    expect(screen.queryByText('Stage')).toBeNull(); // "Unknown" is not shown
  });

  it('shows no accelerator row for a company that is in none', async () => {
    fetchStartup.mockResolvedValue({ slug: 'acme', name: 'Acme AI', blurb: 'Makes things.', website: 'https://acme.ai', stage: 'Seed', verified: true });
    render(<StartupPanel pin={{ slug: 'acme', name: 'Acme AI', city: 'Sydney', hiring: false, website: 'https://acme.ai' }} onToggleSaved={() => {}} onOpen={() => {}} onClose={() => {}} />);
    await screen.findByText('Seed');
    expect(screen.queryByText('Accelerator')).toBeNull();
    expect(screen.queryByText('Founders')).toBeNull();
  });

  it('shows the cohort in the company\'s page, with the page it comes from and the day it was read', async () => {
    fetchNews.mockResolvedValue({ deals: [] });
    render(
      <StartupDetailPanel
        startup={{ name: 'Acme AI', sector: 'AI', city: 'Sydney', stage: 'Unknown', hiring: false, verified: true, website: 'https://acme.ai', blurb: 'Makes things.', investors: [], founders: ['Ada Lovelace'], taskGate: { enabled: false }, programs: [PROGRAM], facts: { cohorts: { source_url: PROGRAM.source_url, verified_at: PROGRAM.verified_at } } }}
        isTracked={() => false} onToggleTracked={() => {}} onSuggestEdit={() => {}} onSelectPerson={() => {}} onClose={() => {}}
      />,
    );
    const cell = screen.getByText('Accelerator').closest('.sdp-meta-cell');
    expect(within(cell).getByText('Startmate · Winter 2026')).toBeInTheDocument();
    expect(within(cell).getByRole('link', { name: 'startmate.com' })).toHaveAttribute('href', PROGRAM.source_url);
    expect(cell.textContent).toMatch(/checked 21 Oct 2026/);
    await waitFor(() => expect(fetchNews).toHaveBeenCalled());
  });
});
