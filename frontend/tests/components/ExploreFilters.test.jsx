import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MultiSelect, { splitValues, joinValues } from '../../src/components/MultiSelect.jsx';
import ActiveFilters, { activeChips, withoutChip } from '../../src/components/ActiveFilters.jsx';

const EMPTY = { search: '', sector: '', city: '', investor: '', stage: '', hiring: '', taskGate: '', precision: '', state: '' };
const SECTORS = ['AI', 'Fintech', 'Health', 'Climate'];
const MANY = Array.from({ length: 30 }, (_, i) => `Sector ${String(i).padStart(2, '0')}`);

function Box(props) {
  return <MultiSelect id="fSector" label="Sector" noun="sectors" all="All sectors" options={SECTORS} value="" onChange={() => {}} {...props} />;
}

describe('MultiSelect', () => {
  it('says what is chosen on one line: all, the one or two names, or how many', () => {
    const view = render(<Box value="" />);
    expect(screen.getByText('All sectors', { selector: 'summary' })).toBeInTheDocument();
    view.rerender(<Box value="AI" />);
    expect(screen.getByText('AI', { selector: 'summary' })).toBeInTheDocument();
    view.rerender(<Box value="AI,Fintech" />);
    expect(screen.getByText('AI, Fintech', { selector: 'summary' })).toBeInTheDocument();
    view.rerender(<Box value="AI,Fintech,Health" />);
    expect(screen.getByText('3 sectors', { selector: 'summary' })).toBeInTheDocument();
  });

  it('is a group named by its label, with a box to tick for each option, the chosen ones ticked', () => {
    render(<Box value="Fintech" />);
    const group = screen.getByRole('group', { name: 'Sector' });
    expect(within(group).getAllByRole('checkbox').map((c) => [c.closest('label').textContent, c.checked])).toEqual([['AI', false], ['Fintech', true], ['Health', false], ['Climate', false]]);
  });

  it('adds a value to the choice, and takes one out, as a comma-joined list the server understands', async () => {
    const onChange = vi.fn();
    const view = render(<Box value="" onChange={onChange} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'AI' }));
    expect(onChange).toHaveBeenLastCalledWith('AI');
    view.rerender(<Box value="AI" onChange={onChange} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Health' }));
    expect(onChange).toHaveBeenLastCalledWith('AI,Health');
    view.rerender(<Box value="AI,Health" onChange={onChange} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'AI' }));
    expect(onChange).toHaveBeenLastCalledWith('Health');
  });

  it('clears everything it chose with one button, which is there only while something is chosen', async () => {
    const onChange = vi.fn();
    const view = render(<Box value="" onChange={onChange} />);
    expect(screen.queryByRole('button', { name: 'Clear sectors' })).not.toBeInTheDocument();
    view.rerender(<Box value="AI,Fintech" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Clear sectors' }));
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('has a box to narrow a long list, and none for a short one', async () => {
    const short = render(<Box />);
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    short.unmount();
    render(<Box options={MANY} />);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Find in sectors' }), '07');
    expect(screen.getAllByRole('checkbox').map((c) => c.closest('label').textContent)).toEqual(['Sector 07']);
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Find in sectors' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Find in sectors' }), 'nothing like it');
    expect(screen.getByText('None match.')).toBeInTheDocument();
  });

  it('keeps a chosen value the list does not have (an old link) on the list, so it can be unticked', async () => {
    const onChange = vi.fn();
    render(<Box value="Old Sector" onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: 'Old Sector' });
    expect(box).toBeChecked();
    await userEvent.click(box);
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('writes an option as text, never as markup', () => {
    render(<Box options={['<img src=x onerror=alert(1)>']} />);
    const group = screen.getByRole('group', { name: 'Sector' });
    expect(group.querySelector('img')).toBeNull();
    expect(within(group).getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  });

  it('splits and joins the values the way the server takes them', () => {
    expect(splitValues('')).toEqual([]);
    expect(splitValues(undefined)).toEqual([]);
    expect(splitValues('AI,Fintech')).toEqual(['AI', 'Fintech']);
    expect(splitValues('AI,,Fintech,')).toEqual(['AI', 'Fintech']);
    expect(joinValues(['AI', 'Fintech'])).toBe('AI,Fintech');
    expect(joinValues([])).toBe('');
  });
});

describe('the filters that are on, as chips', () => {
  it('has a chip for each value of each filter that is on, and none for a filter that is off', () => {
    expect(activeChips(EMPTY)).toEqual([]);
    const chips = activeChips({ ...EMPTY, sector: 'AI,Fintech', city: 'Sydney', state: 'nsw', precision: 'EXACT,SUBURB', stage: 'Seed', investor: 'Blackbird', hiring: 'yes', search: '  canva ' });
    expect(chips.map((c) => `${c.group}: ${c.text}`)).toEqual([
      'Sector: AI', 'Sector: Fintech', 'City: Sydney', 'State: NSW', 'Place: Exact office', 'Place: Suburb only', 'Stage: Seed', 'Investor: Blackbird', 'Hiring: Hiring now', 'Search: “canva”',
    ]);
  });

  it('says "Not verified as hiring" for the no side of hiring, the words the filter drawer uses', () => {
    expect(activeChips({ ...EMPTY, hiring: 'no' })[0].text).toBe('Not verified as hiring');
  });

  it('never shows the concept filter taskGate as a chip', () => {
    expect(activeChips({ ...EMPTY, taskGate: 'yes' })).toEqual([]);
  });

  it('takes off one value of a filter of several, and the whole of a single filter', () => {
    const on = { ...EMPTY, sector: 'AI,Fintech,Health', stage: 'Seed', precision: 'EXACT,CITY' };
    expect(withoutChip(on, { key: 'sector', value: 'Fintech' }).sector).toBe('AI,Health');
    expect(withoutChip(on, { key: 'sector', value: 'AI' }).sector).toBe('Fintech,Health');
    expect(withoutChip(withoutChip({ ...EMPTY, sector: 'AI' }, { key: 'sector', value: 'AI' }), { key: 'sector', value: 'AI' }).sector).toBe('');
    expect(withoutChip(on, { key: 'stage', value: 'Seed' }).stage).toBe('');
    expect(withoutChip(on, { key: 'precision', value: 'city' }).precision).toBe('EXACT'); // codes match in either case
    expect(withoutChip(on, { key: 'sector', value: 'AI' }).stage).toBe('Seed'); // nothing else changes
  });

  it('renders nothing when no filter is on, and a removable chip for each when some are', async () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    const none = render(<ActiveFilters filters={EMPTY} onChange={onChange} onClear={onClear} />);
    expect(none.container).toBeEmptyDOMElement();
    none.unmount();

    render(<ActiveFilters filters={{ ...EMPTY, sector: 'AI,Fintech', city: 'Sydney' }} onChange={onChange} onClear={onClear} />);
    const list = screen.getByRole('list', { name: 'Filters that are on' });
    expect(within(list).getAllByRole('button')).toHaveLength(4); // three chips and Clear all
    await userEvent.click(screen.getByRole('button', { name: 'Remove filter: Sector Fintech' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY, sector: 'AI', city: 'Sydney' });
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('has no Clear all for a single chip: the chip does it', () => {
    render(<ActiveFilters filters={{ ...EMPTY, stage: 'Seed' }} onChange={() => {}} onClear={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument();
  });
});
