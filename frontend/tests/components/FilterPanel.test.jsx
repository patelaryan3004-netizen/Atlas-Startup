import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
  return { onChange, onReset, container: result.container, unmount: result.unmount };
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

  it('opens on the Filters tab by default, offering every option of the filters from the meta', async () => {
    setup();
    await open();
    expect(screen.getByRole('checkbox', { name: 'AI' })).toBeInTheDocument(); // sector and city take several values: boxes to tick
    expect(screen.getByRole('checkbox', { name: 'Sydney' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Blackbird' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Series A' })).toBeInTheDocument();
  });

  describe('the filters for the facts a page gives a company', () => {
    const facts = { remotePolicies: ['remote-global', 'remote-au'], techStack: ['Go', 'TypeScript'], teamSizes: [{ code: 'lt10', label: 'Under 10' }, { code: '100plus', label: '100+' }] };

    it('has none of them while no company has the fact: nothing to filter by', async () => {
      setup();
      await open();
      for (const label of ['Where people work', 'People']) expect(screen.queryByLabelText(label)).toBeNull();
      expect(screen.queryByRole('group', { name: 'Built with' })).toBeNull();
      for (const heading of ['Remote policy', 'Tech stack', 'Team size']) expect(screen.queryByText(heading, { selector: '.fsection-label' })).toBeNull();
    });

    it('has a remote policy, a tech stack and a team size filter, each from what the data has, once some company has one', async () => {
      const { onChange } = setup({ meta: { ...meta, ...facts } });
      await open();
      expect([...screen.getByLabelText('Where people work').querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Any', 'Remote, worldwide', 'Remote in Australia']);
      expect([...screen.getByLabelText('People').querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Any', 'Under 10', '100+']);
      await userEvent.selectOptions(screen.getByLabelText('Where people work'), 'remote-au');
      expect(onChange).toHaveBeenLastCalledWith({ ...emptyFilters, remote: 'remote-au' });
      await userEvent.selectOptions(screen.getByLabelText('People'), '100plus');
      expect(onChange).toHaveBeenLastCalledWith({ ...emptyFilters, team: '100plus' });
      const group = screen.getByRole('group', { name: 'Built with' });
      await userEvent.click(group.querySelector('summary'));
      await userEvent.click(within(group).getByRole('checkbox', { name: 'Go' }));
      expect(onChange).toHaveBeenLastCalledWith({ ...emptyFilters, tech: 'Go' });
    });

    it('shows what is chosen, and counts it on the toggle', async () => {
      setup({ meta: { ...meta, ...facts }, filters: { ...emptyFilters, remote: 'remote-global', tech: 'Go,TypeScript', team: 'lt10' } });
      expect(screen.getByText('☰ Filters (3)')).toBeInTheDocument();
      await userEvent.click(screen.getByText('☰ Filters (3)'));
      expect(screen.getByLabelText('Where people work')).toHaveValue('remote-global');
      expect(screen.getByLabelText('People')).toHaveValue('lt10');
      expect(screen.getByText('Go, TypeScript', { selector: 'summary' })).toBeInTheDocument();
    });

    it('offers "Seed to Series A" among the stages, at the top, and shows it chosen', async () => {
      const { onChange } = setup();
      await open();
      expect([...screen.getByLabelText('Stage').querySelectorAll('option')].map((o) => o.textContent).slice(0, 3)).toEqual(['All stages', 'Seed to Series A', 'Seed']);
      await userEvent.selectOptions(screen.getByLabelText('Stage'), 'Seed to Series A');
      expect(onChange).toHaveBeenLastCalledWith({ ...emptyFilters, stage: 'Seed,Early,Series A' });
    });
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

  it('switches to the Cities tab and shows city counts, without touching filter fields', async () => {
    setup();
    await open();
    await userEvent.click(screen.getByRole('tab', { name: 'Cities' }));

    expect(screen.queryByLabelText('Sector')).not.toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Sydney');
    expect(items[0]).toHaveTextContent('2');
  });

  it('does not list companies whose city is not known as a city called "Unknown"', async () => {
    setup({ summary: summaryOf({ topCities: [{ city: 'Sydney', count: 5 }, { city: 'Unknown', count: 3 }, { city: '', count: 1 }, { city: 'Melbourne', count: 2 }] }) });
    await open();
    await userEvent.click(screen.getByRole('tab', { name: 'Cities' }));
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Sydney5', 'Melbourne2']);
  });

  it('still opens before the first counts have arrived, with empty tabs rather than an error', async () => {
    setup({ summary: null });
    await open();
    await userEvent.click(screen.getByRole('tab', { name: 'Cities' }));
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByText('No cities to count yet.')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Vouched'));
    expect(screen.getByText('No vouches yet.')).toBeInTheDocument();
  });

  it('is a labelled panel with tabs, Filters then Cities first, and says which one is shown', async () => {
    setup();
    await open();
    expect(screen.getByRole('complementary', { name: 'Filters and cities' })).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Filters', 'Cities', 'Notable', 'Vouched']);
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false']);
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'panelTab-filters');
    await userEvent.click(tabs[1]);
    expect(screen.getAllByRole('tab').map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false', 'false']);
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'panelTab-cities');
  });

  it('says on the toggle whether the panel is open, and what it controls', async () => {
    setup();
    const toggle = screen.getByRole('button', { name: /Filters/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'filters');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('filters')).not.toBeNull();
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

  it('moves focus into the panel when a press opens it, and gives it back to the toggle when it closes', async () => {
    setup();
    await open();
    expect(screen.getByRole('tab', { name: 'Filters' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: /Filters/ })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: /Filters/ }));
    await userEvent.click(screen.getByLabelText('Close'));
    expect(screen.getByRole('button', { name: /Filters/ })).toHaveFocus();
  });

  it('closes via Escape', async () => {
    setup();
    await open();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByLabelText('Sector')).not.toBeInTheDocument();
  });

  it('leaves an Escape that is meant for something else alone: only one pressed inside the panel closes it', async () => {
    setup();
    await open();
    screen.getByRole('button', { name: /Filters/ }).focus();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByLabelText('Sector')).toBeInTheDocument();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(screen.getByLabelText('Sector')).toBeInTheDocument();
  });

  it('closes when the scrim behind it is pressed (a narrow screen), but not when the panel itself is', async () => {
    const { container } = setup();
    await open();
    await userEvent.click(container.querySelector('.map-panel'));
    expect(screen.getByLabelText('Sector')).toBeInTheDocument();

    await userEvent.click(container.querySelector('.map-panel-scrim'));
    expect(screen.queryByLabelText('Sector')).not.toBeInTheDocument();
  });

  it('tells the page when it opens and closes, so the map\'s controls can move aside', async () => {
    const onOpenChange = vi.fn();
    setup({ onOpenChange });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    await open();
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByLabelText('Close'));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  describe('where it starts', () => {
    const screenIs = (wide) => vi.stubGlobal('matchMedia', vi.fn((query) => ({ matches: query === '(min-width: 1200px)' ? wide : false })));
    afterEach(() => { vi.unstubAllGlobals(); try { localStorage.removeItem('auStartupPanel'); } catch (e) { /* ignore */ } });

    it('is open on a wide screen when the map is under it', () => {
      screenIs(true);
      const onOpenChange = vi.fn();
      setup({ defaultOpen: true, onOpenChange });
      expect(screen.getByLabelText('Sector')).toBeInTheDocument();
      expect(onOpenChange).toHaveBeenLastCalledWith(true);
      expect(screen.getByRole('tab', { name: 'Filters' })).not.toHaveFocus(); // it opened by itself: focus stays where it was
    });

    it('is shut on a phone, however it was asked to start', () => {
      screenIs(false);
      setup({ defaultOpen: true });
      expect(screen.queryByLabelText('Sector')).not.toBeInTheDocument();
    });

    it('is shut when nothing under it is the map', () => {
      screenIs(true);
      setup();
      expect(screen.queryByLabelText('Sector')).not.toBeInTheDocument();
    });

    it('stays shut next time on a wide screen once the visitor has closed it, and opens again when they open it', async () => {
      screenIs(true);
      const first = setup({ defaultOpen: true });
      await userEvent.click(screen.getByLabelText('Close'));
      expect(localStorage.getItem('auStartupPanel')).toBe('0');
      first.unmount();
      setup({ defaultOpen: true });
      expect(screen.queryByLabelText('Sector')).not.toBeInTheDocument();
      await open();
      expect(localStorage.getItem('auStartupPanel')).toBe('1');
    });

    it('does not keep a phone visitor\'s choice, which would open it over the map next time', async () => {
      screenIs(false);
      setup({ defaultOpen: true });
      await open();
      expect(localStorage.getItem('auStartupPanel')).toBeNull();
    });
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
    const group = screen.getByRole('group', { name: 'Sector' });
    await userEvent.click(group.querySelector('summary'));
    await userEvent.click(within(group).getByRole('checkbox', { name: 'Fintech' }));
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
