import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AtlasHead from '../../src/components/explore/AtlasHead.jsx';
import AtlasOverlay from '../../src/components/explore/AtlasOverlay.jsx';
import AllAustralia from '../../src/components/explore/AllAustralia.jsx';
import CheckMenu from '../../src/components/explore/CheckMenu.jsx';

const FILTERS = { search: '', sector: '', city: '', investor: '', stage: '', hiring: '', taskGate: '', events: '', precision: '', state: '', remote: '', tech: '', team: '', cohort: '', fresh: '', maturity: '', onMap: '' };
const SECTORS = [{ value: 'Fintech', count: 12 }, { value: 'Software & DevTools', count: 26 }];
const CITIES = [{ city: 'Sydney', count: 347 }, { city: 'Melbourne', count: 176 }, { city: 'Perth', count: 67 }];

const head = (props = {}) => {
  const handlers = { onFilterChange: vi.fn(), onEntityChange: vi.fn(), onToggleFilters: vi.fn(), onList: vi.fn() };
  render(
    <AtlasHead
      filters={FILTERS}
      sectors={SECTORS}
      cities={CITIES}
      entity="all"
      filtersOpen={false}
      filterCount={0}
      listHref="/discover?view=list&onMap=yes"
      count="933 organisations"
      {...handlers}
      {...props}
    />,
  );
  return handlers;
};

describe('the map page\'s directory head (the "Startup atlas" panel)', () => {
  it('is the heading and one row of controls: the search, the city, the sector, the type and "View list", with the count and "More filters"', () => {
    head();
    expect(screen.getByRole('heading', { level: 1, name: /Startup\s*atlas/ })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search organisations on the map' })).toHaveAttribute('placeholder', 'Name, sector or suburb');
    expect(screen.getByRole('combobox', { name: 'City' })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'All sectors' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'What kind of organisation' })).toHaveValue('all');
    expect(screen.getByRole('link', { name: 'View list' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /More filters/ })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('933 organisations');
  });

  it('has no stage menu, no Early / Growth buttons, no kicker, no line under the heading and no note: the stage and the rest are under "More filters"', () => {
    head();
    expect(screen.queryByRole('button', { name: /stage/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /maturity/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Still Early field guide|Discover who.s building around you/)).not.toBeInTheDocument();
    expect(screen.queryByText(/with a pin on the map|Pins mark published/)).not.toBeInTheDocument();
  });

  it('writes the search as it is typed, and clears it', async () => {
    const { onFilterChange } = head();
    await userEvent.type(screen.getByRole('searchbox'), 'ab');
    expect(onFilterChange).toHaveBeenNthCalledWith(1, { search: 'a' });
    expect(onFilterChange).toHaveBeenCalledTimes(2); // (the page holds the value: each key is one change)
  });

  it('has a clear button once there is something typed', async () => {
    const { onFilterChange } = head({ filters: { ...FILTERS, search: 'pay' } });
    await userEvent.click(screen.getByRole('button', { name: 'Clear the search' }));
    expect(onFilterChange).toHaveBeenCalledWith({ search: '' });
  });

  it('picks the city as the city filter, from the cities the map lists, and all of Australia', async () => {
    const { onFilterChange } = head();
    const select = screen.getByRole('combobox', { name: 'City' });
    expect([...select.options].map((o) => o.textContent)).toEqual(['All Australia', 'Sydney', 'Melbourne', 'Perth']); // (no counts)
    await userEvent.selectOptions(select, 'Melbourne');
    expect(onFilterChange).toHaveBeenCalledWith({ city: 'Melbourne' });
    await userEvent.selectOptions(select, '');
    expect(onFilterChange).toHaveBeenLastCalledWith({ city: '' });
  });

  it('says the city that is picked, and says so for a link that names several rather than pretending to be one of the ten', () => {
    const { unmount } = render(<AtlasHead filters={{ ...FILTERS, city: 'Perth' }} sectors={SECTORS} cities={CITIES} entity="all" onFilterChange={() => {}} onEntityChange={() => {}} onToggleFilters={() => {}} listHref="/x" onList={() => {}} count="" />);
    expect(screen.getByRole('combobox', { name: 'City' })).toHaveValue('Perth');
    unmount();
    render(<AtlasHead filters={{ ...FILTERS, city: 'Perth,Sydney' }} sectors={SECTORS} cities={CITIES} entity="all" onFilterChange={() => {}} onEntityChange={() => {}} onToggleFilters={() => {}} listHref="/x" onList={() => {}} count="" />);
    expect(screen.getByRole('combobox', { name: 'City' })).toHaveValue('Perth,Sydney');
    expect(within(screen.getByRole('combobox', { name: 'City' })).getByRole('option', { name: '2 cities' })).toBeInTheDocument();
  });

  it('is the layer the map shows that the type select picks, among all of them', async () => {
    const { onEntityChange } = head();
    const select = screen.getByRole('combobox', { name: 'What kind of organisation' });
    expect([...select.options].map((o) => o.textContent)).toEqual(['All types', 'Startups', 'Companies', 'Investors', 'Spaces']);
    await userEvent.selectOptions(select, 'vcs');
    expect(onEntityChange).toHaveBeenCalledWith('vcs');
  });

  it('offers the sectors it is given, each with how many, and picks them as the page\'s check menu does', async () => {
    const { onFilterChange } = head();
    await userEvent.click(screen.getByRole('button', { name: 'All sectors' }));
    expect(screen.getAllByRole('checkbox').map((box) => box.closest('label').textContent)).toEqual(['Fintech12', 'Software & DevTools26']); // only those with a result
    await userEvent.click(screen.getByRole('checkbox', { name: /Software & DevTools/ }));
    expect(onFilterChange).toHaveBeenCalledWith({ sector: 'Software & DevTools' });
  });

  it('says the sector that is picked, and keeps one the menu no longer offers (an older link\'s label, or a sector with no result here) in the list to be taken off', async () => {
    head({ filters: { ...FILTERS, sector: 'HealthTech' } });
    expect(screen.getByRole('button', { name: 'HealthTech' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'HealthTech' }));
    expect(screen.getByRole('checkbox', { name: /HealthTech/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Clear sectors' })).toBeInTheDocument();
  });

  it('says how many sectors when there are several', () => {
    head({ filters: { ...FILTERS, sector: 'Fintech,Software & DevTools' } });
    expect(screen.getByRole('button', { name: '2 sectors' })).toBeInTheDocument();
  });

  it('opens the filters with "More filters" and says how many are on', async () => {
    const { onToggleFilters } = head({ filterCount: 2 });
    const more = screen.getByRole('button', { name: /More filters/ });
    expect(more).toHaveTextContent('2');
    await userEvent.click(more);
    expect(onToggleFilters).toHaveBeenCalledTimes(1);
  });

  it('has "View list" as a link to Discover\'s list of what the map shows: a plain click goes by the page, the link is real for the rest', async () => {
    const { onList } = head();
    const link = screen.getByRole('link', { name: 'View list' });
    expect(link).toHaveAttribute('href', '/discover?view=list&onMap=yes');
    await userEvent.click(link);
    expect(onList).toHaveBeenCalledTimes(1);
  });

  it('takes the search when "/" is pressed outside a field, and leaves it alone inside one', () => {
    head();
    fireEvent.keyDown(document.body, { key: '/' });
    expect(screen.getByRole('searchbox')).toHaveFocus();
    const select = screen.getByRole('combobox', { name: 'What kind of organisation' });
    select.focus();
    fireEvent.keyDown(select, { key: '/' });
    expect(select).toHaveFocus();
  });
});

describe('the check menu as a select', () => {
  it('reads as the one picked, "3 sectors" for several, and its own label when it has no "all" word', () => {
    const { rerender } = render(<CheckMenu label="Sector" options={[{ value: 'A' }, { value: 'B' }]} value="" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Sector' })).toBeInTheDocument();
    rerender(<CheckMenu label="Sector" allLabel="All sectors" options={[{ value: 'A' }, { value: 'B' }]} value="" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'All sectors' })).toBeInTheDocument();
    rerender(<CheckMenu label="Sector" noun="sectors" allLabel="All sectors" options={[{ value: 'A' }, { value: 'B' }]} value="A,B" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: '2 sectors' })).toBeInTheDocument();
  });
});

describe('what is written over the map', () => {
  const cities = [{ city: 'Sydney', count: 347 }, { city: 'Perth', count: 67 }];

  it('says Australia and "National overview" while no city is picked', () => {
    render(<AtlasOverlay filters={FILTERS} onFilterChange={() => {}} cities={cities} national pinned={492} />);
    expect(screen.getByText('The Australian edition')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /City: Australia/ })).toHaveTextContent('Australia');
    expect(screen.getByText('National overview')).toBeInTheDocument();
  });

  it('says the city and how many of its organisations have a pin once one is picked', () => {
    render(<AtlasOverlay filters={{ ...FILTERS, city: 'Perth' }} onFilterChange={() => {}} cities={cities} national={false} pinned={32} />);
    expect(screen.getByRole('button', { name: /City: Perth/ })).toHaveTextContent('Perth');
    expect(screen.getByText('32 organisations with a pin on the map')).toBeInTheDocument();
    expect(screen.queryByText('National overview')).not.toBeInTheDocument();
  });

  it('says "1 organisation", and nothing under a city when it is not told how many (the investors only)', () => {
    const { rerender } = render(<AtlasOverlay filters={{ ...FILTERS, city: 'Perth' }} onFilterChange={() => {}} cities={cities} national={false} pinned={1} />);
    expect(screen.getByText('1 organisation with a pin on the map')).toBeInTheDocument();
    rerender(<AtlasOverlay filters={{ ...FILTERS, city: 'Perth' }} onFilterChange={() => {}} cities={cities} national={false} pinned={undefined} />);
    expect(document.querySelector('.at-over-line').textContent).toBe('');
  });

  it('is a card of the night over the street map and bare over the sea of the national view', () => {
    const { container, rerender } = render(<AtlasOverlay filters={FILTERS} onFilterChange={() => {}} cities={cities} national pinned={492} />);
    expect(container.querySelector('.at-over')).not.toHaveClass('at-over-card');
    rerender(<AtlasOverlay filters={{ ...FILTERS, city: 'Perth' }} onFilterChange={() => {}} cities={cities} national={false} pinned={32} />);
    expect(container.querySelector('.at-over')).toHaveClass('at-over-card');
  });

  it('opens the cities from its heading and picks one as the city filter', async () => {
    const onFilterChange = vi.fn();
    render(<AtlasOverlay filters={FILTERS} onFilterChange={onFilterChange} cities={cities} national pinned={492} />);
    await userEvent.click(screen.getByRole('button', { name: /City: Australia/ }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Choose a city' })).getByRole('button', { name: /Perth/ }));
    expect(onFilterChange).toHaveBeenCalledWith({ city: 'Perth' });
  });

  it('picks the city that is already picked to go back to all of Australia, and has the compass in the other corner', async () => {
    const onFilterChange = vi.fn();
    const { container } = render(<AtlasOverlay filters={{ ...FILTERS, city: 'Perth' }} onFilterChange={onFilterChange} cities={cities} national={false} pinned={32} />);
    await userEvent.click(screen.getByRole('button', { name: /City: Perth/ }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Choose a city' })).getByRole('button', { name: /Perth/ }));
    expect(onFilterChange).toHaveBeenCalledWith({ city: '' });
    expect(container.querySelector('.at-compass')).not.toBeNull();
  });
});

describe('the way back to all of Australia', () => {
  it('is the arrow and the words on the map page, and the page\'s other map keeps its own', async () => {
    const onClick = vi.fn();
    const { container, rerender } = render(<AllAustralia onClick={onClick} atlas />);
    expect(screen.getByRole('button', { name: 'All Australia' })).toHaveClass('xr-atlas');
    await userEvent.click(screen.getByRole('button', { name: 'All Australia' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<AllAustralia onClick={onClick} />);
    expect(container.querySelector('.xr-atlas')).toBeNull();
  });
});
