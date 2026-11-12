import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AtlasHead from '../../src/components/explore/AtlasHead.jsx';
import AtlasOverlay from '../../src/components/explore/AtlasOverlay.jsx';
import AllAustralia from '../../src/components/explore/AllAustralia.jsx';
import CheckMenu from '../../src/components/explore/CheckMenu.jsx';

const FILTERS = { search: '', sector: '', city: '', investor: '', stage: '', hiring: '', taskGate: '', events: '', precision: '', state: '', remote: '', tech: '', team: '', cohort: '', fresh: '' };

const head = (props = {}) => {
  const handlers = { onFilterChange: vi.fn(), onEntityChange: vi.fn(), onToggleFilters: vi.fn(), onList: vi.fn() };
  render(
    <AtlasHead
      filters={FILTERS}
      sectors={['Fintech', 'SaaS', 'Unknown']}
      stages={['Seed', 'Series A']}
      entity="all"
      filtersOpen={false}
      filterCount={0}
      listHref="/discover?view=list"
      count="933 organisations"
      pinned="492 with a pin on the map"
      {...handlers}
      {...props}
    />,
  );
  return handlers;
};

describe('the map page\'s directory head (the "Startup atlas" panel)', () => {
  it('has the heading, the line under it, the search, the selects and the count', () => {
    head();
    expect(screen.getByRole('heading', { level: 1, name: /Startup\s*atlas/ })).toBeInTheDocument();
    expect(screen.getByText(/Discover who.s building around you/)).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search organisations on the map' })).toHaveAttribute('placeholder', 'Name, sector or suburb');
    expect(screen.getByRole('combobox', { name: 'What kind of organisation' })).toHaveValue('all');
    expect(screen.getByRole('button', { name: 'All sectors' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All stages' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('933 organisations');
    expect(screen.getByRole('status')).toHaveTextContent('492 with a pin on the map');
  });

  it('does not say the directory is a preview: the note under the rows says what the pins are (ResultsColumn)', () => {
    head();
    expect(screen.queryByText(/preview directory/i)).not.toBeInTheDocument();
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

  it('is the layer the map shows that the type select picks, among all of them', async () => {
    const { onEntityChange } = head();
    const select = screen.getByRole('combobox', { name: 'What kind of organisation' });
    expect([...select.options].map((o) => o.textContent)).toEqual(['All types', 'Startups', 'Companies', 'Investors', 'Spaces']);
    await userEvent.selectOptions(select, 'vcs');
    expect(onEntityChange).toHaveBeenCalledWith('vcs');
  });

  it('picks sectors as the page\'s check menu does, and the button says what is picked', async () => {
    const { onFilterChange } = head();
    await userEvent.click(screen.getByRole('button', { name: 'All sectors' }));
    expect(screen.queryByRole('checkbox', { name: 'Unknown' })).not.toBeInTheDocument(); // (a sector that is not known is not offered)
    await userEvent.click(screen.getByRole('checkbox', { name: 'SaaS' }));
    expect(onFilterChange).toHaveBeenCalledWith({ sector: 'SaaS' });
  });

  it('says the sector that is picked', () => {
    head({ filters: { ...FILTERS, sector: 'SaaS' } });
    expect(screen.getByRole('button', { name: 'SaaS' })).toBeInTheDocument();
  });

  it('says how many sectors when there are several', () => {
    head({ filters: { ...FILTERS, sector: 'SaaS,Fintech' } });
    expect(screen.getByRole('button', { name: '2 sectors' })).toBeInTheDocument();
  });

  it('opens the filters with More, says how many are on, and has the list as a link', async () => {
    const { onToggleFilters } = head({ filterCount: 2 });
    const more = screen.getByRole('button', { name: /More/ });
    expect(more).toHaveTextContent('2');
    await userEvent.click(more);
    expect(onToggleFilters).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'See these as a list' })).toHaveAttribute('href', '/discover?view=list');
  });

  it('takes the search when "/" is pressed outside a field, and leaves it alone inside one', () => {
    head();
    fireEvent.keyDown(document.body, { key: '/' });
    expect(screen.getByRole('searchbox')).toHaveFocus();
    const select = screen.getByRole('combobox');
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

  it('opens the cities from its heading and picks one as the city filter', async () => {
    const onFilterChange = vi.fn();
    render(<AtlasOverlay filters={FILTERS} onFilterChange={onFilterChange} cities={cities} national pinned={492} />);
    await userEvent.click(screen.getByRole('button', { name: /City: Australia/ }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Choose a city' })).getByRole('button', { name: /Perth/ }));
    expect(onFilterChange).toHaveBeenCalledWith({ city: 'Perth' });
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
