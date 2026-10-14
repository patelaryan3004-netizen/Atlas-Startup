import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/api.js', () => ({
  fetchInvestors: vi.fn(), fetchInvestorMeta: vi.fn(), fetchInvestor: vi.fn(), fetchInvestorPerson: vi.fn(), submitInvestorCorrection: vi.fn(), submitFeedback: vi.fn(),
}));

import * as api from '../../src/api.js';
import InvestorsView from '../../src/components/investors/InvestorsView.jsx';
import { card, metaOf, profile, serve } from './helpers.js';

const renderView = (props = {}) => render(<InvestorsView onClose={() => {}} onOpenCompany={() => {}} {...props} />);
const cards = (n) => Array.from({ length: n }, (_, i) => card({ slug: `fund-${i}`, name: `Fund ${String(i).padStart(2, '0')}` }));
const names = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
const menuButton = (name) => screen.getByRole('button', { name: new RegExp(`^${name}`) });
const tick = async (menu, option) => {
  await userEvent.click(menuButton(menu));
  await userEvent.click(within(screen.getByRole('group', { name: menu })).getByRole('checkbox', { name: new RegExp(`^${option}`) }));
};

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
afterEach(() => { window.history.pushState({}, '', '/'); vi.unstubAllGlobals(); });

describe('the investor directory', () => {
  it('has the headline and the line under it the page is named by, and Investors as the place the header is on', async () => {
    serve(api);
    renderView();
    expect(await screen.findByRole('heading', { level: 1, name: 'Find your next backer.' })).toBeInTheDocument();
    expect(screen.getByText('Explore investors by stage, sector and location.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Investors' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Explore' })).not.toHaveAttribute('aria-current');
  });

  it('shows each investor as a card: logo, name, type, focus, stage, place, how many companies a page says it backed, and the way in', async () => {
    serve(api, { cards: [card()] });
    renderView();
    const link = await screen.findByRole('link', { name: 'Blackbird' });
    const item = link.closest('li');
    expect(item).toHaveClass('card', 'entity-card', 'inv-card'); // the app's one card
    expect(item.querySelector('.entity-initial')).toHaveTextContent('B');
    expect(within(item).getByText('Venture Capital')).toBeInTheDocument();
    // the three facts the mockup has, each with its label
    const facts = Object.fromEntries([...item.querySelectorAll('.inv-card-facts > div')].map((row) => [row.querySelector('dt').textContent, row.querySelector('dd').textContent]));
    expect(facts).toEqual({ Focus: 'Software', Stage: 'Seed → Series A', Location: 'Sydney, NSW' });
    expect(within(item).getByText('3 connected companies')).toBeInTheDocument();
    expect(within(item).getByText('View profile')).toBeInTheDocument();
    expect(within(item).getByText('Verified')).toBeInTheDocument();
    expect(within(item).getByTitle(/Verified 8 Oct 2026/)).toBeInTheDocument();
    expect(within(item).getByRole('button', { name: 'Save Blackbird' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows a dash, read out as "Not stated", for what nobody states, and no count and no empty line', async () => {
    serve(api, { cards: [card({ portfolio_count: 0, stages: [], sectors: [], location: { city: null, state: null, country: null, label: null } })] });
    renderView();
    const item = (await screen.findByRole('link', { name: 'Blackbird' })).closest('li');
    expect(within(item).getAllByText('Not stated')).toHaveLength(3);
    expect([...item.querySelectorAll('.inv-card-facts dd')].map((d) => d.textContent)).toEqual(['–Not stated', '–Not stated', '–Not stated']);
    expect(within(item).queryByText(/connected compan/)).not.toBeInTheDocument();
    expect(within(item).getByText('View profile')).toBeInTheDocument(); // the card is still a way in
  });

  it('labels an investor that has stopped investing, and shows a single company in the singular', async () => {
    serve(api, { cards: [card({ status: 'inactive', active_status: 'inactive', portfolio_count: 1 })] });
    renderView();
    const item = (await screen.findByRole('link', { name: 'Blackbird' })).closest('li');
    expect(within(item).getByText('No longer investing')).toBeInTheDocument();
    expect(within(item).getByText('1 connected company')).toBeInTheDocument();
  });

  it('names a long focus by its first three, and says what else there is on hover', async () => {
    serve(api, { cards: [card({ sectors: ['AI', 'Climate', 'Health', 'Space', 'Fintech'] })] });
    renderView();
    const item = (await screen.findByRole('link', { name: 'Blackbird' })).closest('li');
    const focus = item.querySelector('.inv-card-facts dd');
    expect(focus).toHaveTextContent('AI · Climate · Health · +2 more');
    expect(focus).toHaveAttribute('title', 'AI, Climate, Health, Space, Fintech');
  });

  it('asks for the first page in alphabetical order with no filters, and says how many investors there are', async () => {
    serve(api, { cards: cards(3) });
    renderView();
    expect(await screen.findByText('3 investors')).toBeInTheDocument();
    expect(api.fetchInvestors).toHaveBeenCalledWith({}, expect.objectContaining({ limit: 24, offset: 0, sort: 'name' }));
    expect(screen.getByText('Showing 3 of 3 investors')).toBeInTheDocument();
    expect(screen.getByText(/no order is a ranking/)).toBeInTheDocument();
  });

  describe('searching and filtering', () => {
    const three = [
      card({ slug: 'a', name: 'Alpha Angels', type: 'angel_network', type_label: 'Angel Network', stages: ['Pre-seed'], sectors: ['Health'], location: { city: 'Brisbane', state: 'QLD', country: 'Australia', label: 'Brisbane, QLD' } }),
      card({ slug: 'b', name: 'Bravo Capital', stages: ['Seed'], sectors: ['Software'] }),
      card({ slug: 'c', name: 'Charlie Ventures', stages: ['Seed', 'Series A'], sectors: ['Software', 'Climate'] }),
    ];

    it('has one search box, and three small filters that each offer only what some investor has, with how many', async () => {
      serve(api, { cards: three });
      renderView();
      await screen.findByRole('link', { name: 'Alpha Angels' });
      expect(screen.getAllByRole('searchbox')).toHaveLength(1);
      expect(screen.getByRole('searchbox')).toHaveAttribute('placeholder', 'Search investors, sectors or portfolio companies');
      for (const name of ['Stage', 'Sector', 'Location', 'More filters']) expect(menuButton(name)).toHaveAttribute('aria-haspopup', 'true');
      await userEvent.click(menuButton('Stage'));
      const stage = within(screen.getByRole('group', { name: 'Stage' }));
      expect(stage.getAllByRole('checkbox').map((c) => c.closest('label').textContent)).toEqual(['Pre-seed1', 'Seed2', 'Series A1']);
      expect(stage.queryByRole('checkbox', { name: /Growth/ })).not.toBeInTheDocument();
    });

    it('filters by one or several stages, asking the server for the ones chosen, and says how many are on', async () => {
      serve(api, { cards: three });
      renderView();
      await screen.findByRole('link', { name: 'Alpha Angels' });
      await tick('Stage', 'Seed');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith({ stage: 'Seed' }, expect.objectContaining({ offset: 0 })));
      await waitFor(() => expect(screen.queryByRole('link', { name: 'Alpha Angels' })).not.toBeInTheDocument());
      expect(screen.getByText('2 of 3 investors')).toBeInTheDocument();
      expect(menuButton('Stage')).toHaveTextContent('Stage 1');
      await userEvent.click(within(screen.getByRole('group', { name: 'Stage' })).getByRole('checkbox', { name: /^Pre-seed/ }));
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith({ stage: 'Seed,Pre-seed' }, expect.anything()));
      expect(await screen.findByRole('link', { name: 'Alpha Angels' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Clear stages' }));
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith({}, expect.anything()));
    });

    it('filters by sector and by location, together, and the results are the investors that match both', async () => {
      serve(api, { cards: three });
      renderView();
      await screen.findByRole('link', { name: 'Alpha Angels' });
      await tick('Sector', 'Software');
      await tick('Location', 'NSW');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith({ sector: 'Software', location: 'NSW' }, expect.anything()));
      await waitFor(() => expect(names()).toEqual(['Bravo Capital', 'Charlie Ventures']));
      await tick('Stage', 'Series A');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith({ stage: 'Series A', sector: 'Software', location: 'NSW' }, expect.anything()));
      await waitFor(() => expect(names()).toEqual(['Charlie Ventures']));
    });

    it('leaves out a menu that has nothing to offer', async () => {
      serve(api, { cards: three, meta: metaOf(three, { locations: [] }) });
      renderView();
      await screen.findByRole('link', { name: 'Alpha Angels' });
      expect(screen.queryByRole('button', { name: /^Location/ })).not.toBeInTheDocument();
      expect(menuButton('Stage')).toBeInTheDocument();
    });

    it('closes a menu with Escape and with a press outside it, and Escape gives focus back to its button', async () => {
      serve(api, { cards: three });
      renderView();
      await screen.findByRole('link', { name: 'Alpha Angels' });
      await userEvent.click(menuButton('Stage'));
      expect(screen.getByRole('group', { name: 'Stage' })).toBeInTheDocument();
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('group', { name: 'Stage' })).not.toBeInTheDocument();
      expect(menuButton('Stage')).toHaveFocus();
      await userEvent.click(menuButton('Sector'));
      await userEvent.click(document.body);
      expect(screen.queryByRole('group', { name: 'Sector' })).not.toBeInTheDocument();
    });

    it('keeps the filters beyond the three behind "More filters": the investor type, whether it is still investing, and the rest when an investor states them', async () => {
      serve(api, { cards: three, meta: metaOf(three, { lead: [{ value: 'lead', count: 2 }, { value: 'both', count: 1 }], active: [{ value: 'active', count: 2 }, { value: 'inactive', count: 1 }] }) });
      renderView();
      await screen.findByRole('link', { name: 'Alpha Angels' });
      expect(screen.queryByRole('combobox', { name: 'Investor type' })).not.toBeInTheDocument();
      await userEvent.click(menuButton('More filters'));
      const more = within(screen.getByRole('group', { name: 'More filters' }));
      const type = more.getByRole('combobox', { name: 'Investor type' });
      expect(within(type).getByRole('option', { name: 'Venture Capital (2)' })).toBeInTheDocument();
      expect(within(type).getByRole('option', { name: 'Angel Network (1)' })).toBeInTheDocument();
      expect(within(type).queryByRole('option', { name: /Corporate VC/ })).not.toBeInTheDocument();
      expect(within(more.getByRole('combobox', { name: 'Leads or follows' })).getByRole('option', { name: 'Leads rounds (2)' })).toBeInTheDocument();
      const active = more.getByRole('combobox', { name: 'Investing' });
      expect(within(active).getByRole('option', { name: 'Investing now (2)' })).toBeInTheDocument();
      expect(within(active).getByRole('option', { name: 'No longer investing (1)' })).toBeInTheDocument();

      await userEvent.selectOptions(type, 'angel_network');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith({ type: 'angel_network' }, expect.objectContaining({ offset: 0 })));
      await waitFor(() => expect(screen.queryByRole('link', { name: 'Bravo Capital' })).not.toBeInTheDocument());
      expect(screen.getByRole('link', { name: 'Alpha Angels' })).toBeInTheDocument();
      expect(menuButton('More filters')).toHaveTextContent('More filters 1');
      await userEvent.selectOptions(active, 'inactive');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith({ type: 'angel_network', active: 'inactive' }, expect.anything()));
      expect(menuButton('More filters')).toHaveTextContent('More filters 2');
    });

    it('offers no filter that no investor can be filtered by: no leads or follows, no cheque size', async () => {
      serve(api, { cards: three });
      renderView();
      await screen.findByRole('link', { name: 'Alpha Angels' });
      await userEvent.click(menuButton('More filters'));
      expect(screen.queryByRole('combobox', { name: 'Leads or follows' })).not.toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: 'Cheque size' })).not.toBeInTheDocument();
      expect(screen.queryByText(/Cheque size matches only/)).not.toBeInTheDocument();
    });

    it('filters by cheque size when one is stated, as the range it covers, and says an investor with none stated is unknown, not out of range', async () => {
      serve(api, { cards: three, meta: metaOf(three, { cheque: { currency: 'AUD', count: 1, min: 250000, max: 1000000 } }) });
      renderView();
      await screen.findByRole('link', { name: 'Alpha Angels' });
      await userEvent.click(menuButton('More filters'));
      expect(screen.getByText(/Cheque size matches only investors that state a range in Australian dollars \(1 investor does\)/)).toBeInTheDocument();
      const cheque = screen.getByRole('combobox', { name: 'Cheque size' });
      await userEvent.selectOptions(cheque, '$100,000 to $500,000');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith({ chequeMin: '100000', chequeMax: '500000' }, expect.anything()));
      await userEvent.selectOptions(cheque, '$2 million and over');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith({ chequeMin: '2000000' }, expect.anything()));
    });

    it('asks again once typing in the search box pauses, not for every letter', async () => {
      serve(api, { cards: three });
      renderView();
      await screen.findByRole('link', { name: 'Alpha Angels' });
      api.fetchInvestors.mockClear();
      await userEvent.type(screen.getByRole('searchbox'), 'bravo');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith({ search: 'bravo' }, expect.anything()));
      expect(api.fetchInvestors.mock.calls.map(([f]) => f.search)).not.toContain('br');
      await waitFor(() => expect(screen.queryByRole('link', { name: 'Alpha Angels' })).not.toBeInTheDocument());
      expect(screen.getByRole('link', { name: 'Bravo Capital' })).toBeInTheDocument();
    });

    it('says what is searched for in words a person can read, and names only the first things in the box on a phone, where the whole line does not fit', async () => {
      serve(api, { cards: three });
      const first = renderView();
      expect(await screen.findByRole('searchbox')).toHaveAccessibleName(/name, person, sector, stage, location or portfolio company/);
      first.unmount();
      vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} })));
      renderView();
      expect(await screen.findByRole('searchbox')).toHaveAttribute('placeholder', 'Search investors, sectors…');
    });

    it('shows Clear filters only once a filter is on, and it puts every investor back with every menu empty', async () => {
      serve(api, { cards: three });
      renderView();
      await screen.findByRole('link', { name: 'Alpha Angels' });
      expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
      await tick('Stage', 'Seed');
      await waitFor(() => expect(screen.queryByRole('link', { name: 'Alpha Angels' })).not.toBeInTheDocument());
      await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
      expect(await screen.findByRole('link', { name: 'Alpha Angels' })).toBeInTheDocument();
      expect(menuButton('Stage')).not.toHaveTextContent('1');
      expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
    });

    it('says honestly when nothing matches, and offers to clear', async () => {
      serve(api, { cards: three });
      renderView();
      await screen.findByRole('link', { name: 'Alpha Angels' });
      await userEvent.type(screen.getByRole('searchbox'), 'zzzz');
      expect(await screen.findByText('No investors match those filters.')).toBeInTheDocument();
      await userEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
      expect(await screen.findByRole('link', { name: 'Bravo Capital' })).toBeInTheDocument();
    });
  });

  describe('sorting', () => {
    const four = [
      card({ slug: 'a', name: 'Alpha', portfolio_count: 1, location: { city: null, state: null, country: 'New Zealand', label: 'New Zealand' } }),
      card({ slug: 'b', name: 'Bravo', portfolio_count: 9 }),
      card({ slug: 'c', name: 'Charlie', portfolio_count: 4, location: { city: 'Brisbane', state: 'QLD', country: 'Australia', label: 'Brisbane, QLD' } }),
      card({ slug: 'd', name: 'Delta', portfolio_count: 0 }),
    ];

    it('starts A to Z, and offers Z to A, the most connected companies and the place, by a name or a number a page states', async () => {
      serve(api, { cards: four });
      renderView();
      await screen.findByRole('link', { name: 'Alpha' });
      const sort = screen.getByRole('combobox', { name: 'Sort by' });
      expect(sort).toHaveValue('name');
      expect([...sort.options].map((o) => o.textContent)).toEqual(['Name A–Z', 'Name Z–A', 'Most connected', 'Location A–Z']);
      expect(names()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);
    });

    it('asks the server for the order chosen and shows the results in the order it sends', async () => {
      serve(api, { cards: four });
      renderView();
      await screen.findByRole('link', { name: 'Alpha' });
      const sort = screen.getByRole('combobox', { name: 'Sort by' });
      await userEvent.selectOptions(sort, 'name_desc');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith({}, expect.objectContaining({ sort: 'name_desc', offset: 0 })));
      await waitFor(() => expect(names()).toEqual(['Delta', 'Charlie', 'Bravo', 'Alpha']));
      await userEvent.selectOptions(sort, 'portfolio');
      await waitFor(() => expect(names()).toEqual(['Bravo', 'Charlie', 'Alpha', 'Delta']));
      await userEvent.selectOptions(sort, 'location');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith({}, expect.objectContaining({ sort: 'location' })));
    });

    it('sorts the investors that match the filters, and keeps the sort when the filters change', async () => {
      serve(api, { cards: four });
      renderView();
      await screen.findByRole('link', { name: 'Alpha' });
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'name_desc');
      await tick('Location', 'NSW');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith({ location: 'NSW' }, expect.objectContaining({ sort: 'name_desc' })));
      await waitFor(() => expect(names()).toEqual(['Delta', 'Bravo']));
      expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveValue('name_desc');
    });
  });

  describe('cards and a table', () => {
    const two = [card(), card({ slug: 'bare', name: 'Bare Capital', type_label: 'Angel Network', stages: [], sectors: [], portfolio_count: 0, location: { city: null, state: null, country: null, label: null } })];

    it('starts with cards, and the table shows the same investors in rows, and back', async () => {
      serve(api, { cards: two, profiles: { blackbird: profile() } });
      renderView();
      await screen.findByRole('link', { name: 'Blackbird' });
      const cardsButton = screen.getByRole('button', { name: 'Cards' });
      const tableButton = screen.getByRole('button', { name: 'Table' });
      expect(cardsButton).toHaveAttribute('aria-pressed', 'true');
      expect(tableButton).toHaveAttribute('aria-pressed', 'false');
      expect(screen.queryByRole('table')).not.toBeInTheDocument();

      await userEvent.click(tableButton);
      expect(tableButton).toHaveAttribute('aria-pressed', 'true');
      expect(cardsButton).toHaveAttribute('aria-pressed', 'false');
      const table = screen.getByRole('table', { name: 'Investors' });
      expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Investor', 'Focus', 'Stage', 'Location', 'Connected companies', 'Save']);
      const row = within(table).getByRole('row', { name: /Blackbird/ });
      expect(within(row).getByRole('link', { name: 'Blackbird' })).toHaveAttribute('href', '/investors/blackbird');
      for (const text of ['Venture Capital', 'Seed → Series A', 'Software', 'Sydney, NSW', '3 companies']) expect(within(row).getByText(text)).toBeInTheDocument();
      expect(screen.queryByText('View profile')).not.toBeInTheDocument(); // the cards' way in is not the table's

      await userEvent.click(cardsButton);
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Blackbird' }).closest('li')).toBeInTheDocument();
    });

    it('is the same data in both: the same count, filters, sort and results, whichever view it is in', async () => {
      serve(api, { cards: [card({ slug: 'a', name: 'Alpha' }), card({ slug: 'b', name: 'Bravo', stages: ['Pre-seed'] }), card({ slug: 'c', name: 'Charlie' })] });
      renderView();
      await screen.findByRole('link', { name: 'Alpha' });
      await tick('Stage', 'Seed');
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'name_desc');
      await waitFor(() => expect(names()).toEqual(['Charlie', 'Alpha']));
      const asked = api.fetchInvestors.mock.calls.length;
      await userEvent.click(screen.getByRole('button', { name: 'Table' }));
      const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1).map((r) => within(r).getByRole('link').textContent);
      expect(rows()).toEqual(['Charlie', 'Alpha']);
      expect(screen.getByText('2 of 3 investors')).toBeInTheDocument();
      expect(screen.getByText('Showing 2 of 2 investors')).toBeInTheDocument();
      expect(menuButton('Stage')).toHaveTextContent('Stage 1');
      expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveValue('name_desc');
      expect(api.fetchInvestors.mock.calls.length).toBe(asked); // switching the view asks for nothing
    });

    it('says in the table too that an investor has stopped investing', async () => {
      serve(api, { cards: [card(), card({ slug: 'old', name: 'Old Gum Fund', status: 'inactive', active_status: 'inactive' })] });
      renderView();
      await userEvent.click(await screen.findByRole('button', { name: 'Table' }));
      const table = screen.getByRole('table', { name: 'Investors' });
      expect(within(within(table).getByRole('row', { name: /Old Gum Fund/ })).getByText('No longer investing')).toBeInTheDocument();
      expect(within(within(table).getByRole('row', { name: /Blackbird/ })).queryByText('No longer investing')).not.toBeInTheDocument();
    });

    it('writes what nobody states as "Not stated" in the table, and never as a guess', async () => {
      serve(api, { cards: two });
      renderView();
      await screen.findByRole('link', { name: 'Bare Capital' });
      await userEvent.click(screen.getByRole('button', { name: 'Table' }));
      const row = within(screen.getByRole('table', { name: 'Investors' })).getByRole('row', { name: /Bare Capital/ });
      expect(within(row).getAllByText('Not stated')).toHaveLength(4); // focus, stage, place and connected companies
      expect(within(row).getByText('Angel Network')).toBeInTheDocument();
    });

    it('opens an investor from the table the way a card does: from its name, and from anywhere in its row', async () => {
      serve(api, { cards: two, profiles: { blackbird: profile(), bare: profile({ slug: 'bare', name: 'Bare Capital' }) } });
      renderView();
      await userEvent.click(await screen.findByRole('button', { name: 'Table' }));
      await userEvent.click(screen.getByRole('link', { name: 'Blackbird' }));
      expect(await screen.findByRole('complementary', { name: 'Blackbird' })).toBeInTheDocument();
      expect(window.location.pathname).toBe('/investors/blackbird');
      expect(screen.getByRole('row', { name: /Blackbird/ })).toHaveClass('inv-row-on');
      await userEvent.click(within(screen.getByRole('row', { name: /Bare Capital/ })).getByText('Angel Network'));
      expect(await screen.findByRole('complementary', { name: 'Bare Capital' })).toBeInTheDocument();
      expect(screen.getByRole('row', { name: /Bare Capital/ })).toHaveClass('inv-row-on');
      expect(screen.getByRole('row', { name: /Blackbird/ })).not.toHaveClass('inv-row-on');
    });

    it('keeps the view it was in when the filters change, and the table when an investor is opened', async () => {
      serve(api, { cards: two, profiles: { blackbird: profile() } });
      renderView();
      await userEvent.click(await screen.findByRole('button', { name: 'Table' }));
      await tick('Stage', 'Seed');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith({ stage: 'Seed' }, expect.anything()));
      expect(screen.getByRole('table', { name: 'Investors' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('link', { name: 'Blackbird' }));
      await screen.findByRole('complementary', { name: 'Blackbird' });
      expect(screen.getByRole('table', { name: 'Investors' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
    });
  });

  describe('saving investors', () => {
    const three = [card({ slug: 'a', name: 'Alpha' }), card({ slug: 'b', name: 'Bravo' }), card({ slug: 'c', name: 'Charlie' })];

    it('saves an investor from its card without opening it, says so, and keeps it in this browser', async () => {
      serve(api, { cards: three });
      renderView();
      await screen.findByRole('link', { name: 'Alpha' });
      await userEvent.click(screen.getByRole('button', { name: 'Save Bravo' }));
      expect(screen.getByRole('button', { name: 'Remove Bravo from saved' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.queryByRole('complementary')).not.toBeInTheDocument(); // the bookmark is not the card
      expect(window.location.pathname).toBe('/investors');
      expect(JSON.parse(localStorage.getItem('auStartupSavedInvestors'))).toEqual(['b']);
      expect(screen.getByRole('tab', { name: 'Saved 1' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Saved 1' })).toBeInTheDocument(); // the header's own place
      await userEvent.click(screen.getByRole('button', { name: 'Remove Bravo from saved' }));
      expect(JSON.parse(localStorage.getItem('auStartupSavedInvestors'))).toEqual([]);
      expect(screen.getByRole('tab', { name: 'Saved' })).toBeInTheDocument();
    });

    it('finds what was saved on an earlier visit', async () => {
      localStorage.setItem('auStartupSavedInvestors', JSON.stringify(['c']));
      serve(api, { cards: three });
      renderView();
      expect(await screen.findByRole('button', { name: 'Remove Charlie from saved' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save Alpha' })).toBeInTheDocument();
    });

    it('lists only the saved ones on the Saved tab, asking the server for exactly those, and narrows them by the filters like the rest', async () => {
      localStorage.setItem('auStartupSavedInvestors', JSON.stringify(['a', 'c']));
      serve(api, { cards: [...three, card({ slug: 'd', name: 'Delta' })] });
      renderView();
      await screen.findByRole('link', { name: 'Alpha' });
      await userEvent.click(screen.getByRole('tab', { name: 'Saved 2' }));
      expect(screen.getByRole('tab', { name: 'Saved 2' })).toHaveAttribute('aria-selected', 'true');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith({ slug: 'a,c' }, expect.objectContaining({ offset: 0 })));
      await waitFor(() => expect(names()).toEqual(['Alpha', 'Charlie']));
      expect(screen.getByText('2 saved investors')).toBeInTheDocument();
      await userEvent.type(screen.getByRole('searchbox'), 'char');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith({ search: 'char', slug: 'a,c' }, expect.anything()));
      await waitFor(() => expect(names()).toEqual(['Charlie']));
      expect(screen.getByText('1 of 2 saved investors')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('tab', { name: 'All investors' }));
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith({ search: 'char' }, expect.anything()));
    });

    it('takes an investor off the Saved tab when it is unsaved there', async () => {
      localStorage.setItem('auStartupSavedInvestors', JSON.stringify(['a', 'c']));
      serve(api, { cards: three });
      renderView();
      await userEvent.click(await screen.findByRole('tab', { name: 'Saved 2' }));
      await waitFor(() => expect(names()).toEqual(['Alpha', 'Charlie']));
      await userEvent.click(screen.getByRole('button', { name: 'Remove Alpha from saved' }));
      await waitFor(() => expect(names()).toEqual(['Charlie']));
    });

    it('says how to save one when none is saved, asks the server for nothing, and offers the way back', async () => {
      serve(api, { cards: three });
      renderView();
      await screen.findByRole('link', { name: 'Alpha' });
      api.fetchInvestors.mockClear();
      await userEvent.click(screen.getByRole('tab', { name: 'Saved' }));
      expect(await screen.findByText(/You have not saved any investors yet/)).toBeInTheDocument();
      expect(screen.getByText(/kept in this browser only/)).toBeInTheDocument();
      expect(api.fetchInvestors).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole('button', { name: 'See all investors' }));
      expect(await screen.findByRole('link', { name: 'Alpha' })).toBeInTheDocument();
    });

    it('moves between the tabs with the arrow keys, one tab stop at a time', async () => {
      serve(api, { cards: three });
      renderView();
      await screen.findByRole('link', { name: 'Alpha' });
      const all = screen.getByRole('tab', { name: 'All investors' });
      all.focus();
      await userEvent.keyboard('{ArrowRight}');
      expect(screen.getByRole('tab', { name: 'Saved' })).toHaveFocus();
      expect(screen.getByRole('tab', { name: 'Saved' })).toHaveAttribute('aria-selected', 'true');
      expect(all).toHaveAttribute('tabindex', '-1');
      await userEvent.keyboard('{ArrowLeft}');
      expect(all).toHaveFocus();
    });

    it('shows Saved in the header as the saved tab, with how many, from any page of the directory', async () => {
      localStorage.setItem('auStartupSavedInvestors', JSON.stringify(['a']));
      serve(api, { cards: three });
      renderView();
      await screen.findByRole('link', { name: 'Alpha' });
      expect(screen.getByRole('button', { name: 'Saved 1' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Saved 1' }));
      expect(screen.getByRole('tab', { name: 'Saved 1' })).toHaveAttribute('aria-selected', 'true');
      await waitFor(() => expect(names()).toEqual(['Alpha']));
    });
  });

  describe('a directory with nothing published', () => {
    it('says it is being built, lists no one on a guess, and shows no filters', async () => {
      serve(api, { cards: [], meta: metaOf([]) });
      const onClose = vi.fn();
      renderView({ onClose });
      expect(await screen.findByText('The directory is being built.')).toBeInTheDocument();
      expect(screen.getByText(/None has been published yet/)).toBeInTheDocument();
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Back to the map' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('when something goes wrong', () => {
    it('says it could not load, and tries again on request', async () => {
      serve(api, { cards: cards(2) });
      api.fetchInvestors.mockRejectedValueOnce(new Error('down'));
      renderView();
      expect(await screen.findByText('Could not load investors right now.')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByRole('link', { name: 'Fund 00' })).toBeInTheDocument();
      expect(screen.queryByText('Could not load investors right now.')).not.toBeInTheDocument();
    });
  });

  describe('a long list', () => {
    it('shows the first 24 and adds the rest when Show more is pressed, in the order chosen', async () => {
      serve(api, { cards: cards(30) });
      renderView();
      const more = await screen.findByRole('button', { name: 'Show more (6 left)' });
      expect(names()).toHaveLength(24);
      expect(screen.getByText('Showing 24 of 30 investors')).toBeInTheDocument();
      await userEvent.click(more);
      await waitFor(() => expect(names()).toHaveLength(30));
      expect(api.fetchInvestors.mock.calls.at(-1)[1]).toMatchObject({ offset: 24, limit: 24, sort: 'name' });
      expect(screen.queryByRole('button', { name: /Show more/ })).not.toBeInTheDocument();
      expect(screen.getByText('Showing 30 of 30 investors')).toBeInTheDocument();
    });

    it('asks for the next page in the order and with the filters it is showing', async () => {
      serve(api, { cards: cards(30) });
      renderView();
      await screen.findByRole('button', { name: /Show more/ });
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'name_desc');
      await waitFor(() => expect(names()[0]).toBe('Fund 29'));
      await userEvent.click(await screen.findByRole('button', { name: /Show more/ }));
      await waitFor(() => expect(names()).toHaveLength(30));
      expect(api.fetchInvestors.mock.calls.at(-1)[1]).toMatchObject({ offset: 24, sort: 'name_desc' });
    });

    it('says so when the next page cannot be loaded, and keeps what it has', async () => {
      serve(api, { cards: cards(30) });
      renderView();
      const more = await screen.findByRole('button', { name: /Show more/ });
      api.fetchInvestors.mockRejectedValueOnce(new Error('down'));
      await userEvent.click(more);
      expect(await screen.findByText('Could not load more investors right now.')).toBeInTheDocument();
      expect(names()).toHaveLength(24);
    });
  });
});
