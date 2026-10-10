import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/api.js', () => ({
  fetchInvestors: vi.fn(), fetchInvestorMeta: vi.fn(), fetchInvestor: vi.fn(), fetchInvestorPerson: vi.fn(), submitInvestorCorrection: vi.fn(),
}));

import * as api from '../../src/api.js';
import InvestorsView from '../../src/components/investors/InvestorsView.jsx';
import { card, metaOf, profile, row, company, person, serve } from './helpers.js';

const renderView = (props = {}) => render(<InvestorsView onClose={() => {}} onOpenCompany={() => {}} {...props} />);
const cards = (n) => Array.from({ length: n }, (_, i) => card({ slug: `fund-${i}`, name: `Fund ${String(i).padStart(2, '0')}` }));

describe('the investor directory', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { window.history.pushState({}, '', '/'); });

  it('has the headline and the line under it the page is named by', async () => {
    serve(api);
    renderView();
    expect(await screen.findByRole('heading', { level: 1, name: 'Australian Startup Investors' })).toBeInTheDocument();
    expect(screen.getByText('Discover the funds, angels and institutions backing Australian startups.')).toBeInTheDocument();
  });

  it('shows each investor as a card: name, type, stage range, sectors, place, how many companies a page says it backed, and the way in', async () => {
    serve(api, { cards: [card()] });
    renderView();
    const link = await screen.findByRole('link', { name: 'Blackbird' });
    const item = link.closest('li');
    expect(within(item).getByText('Venture Capital')).toBeInTheDocument();
    expect(within(item).getByText('Seed → Series A')).toBeInTheDocument();
    expect(within(item).getByText('Software')).toBeInTheDocument();
    expect(within(item).getByText('Sydney, NSW')).toBeInTheDocument();
    expect(within(item).getByText('3 connected companies')).toBeInTheDocument();
    expect(within(item).getByText('View investor')).toBeInTheDocument();
    // the facts say what they are to a screen reader, and the tick keeps its date for the tooltip
    for (const label of ['Stage focus', 'Sector focus', 'Location']) expect(within(item).getByText(label)).toHaveClass('sr-only');
    expect(within(item).getByText('Verified')).toBeInTheDocument();
    expect(within(item).getByTitle(/Verified 8 Oct 2026/)).toBeInTheDocument();
  });

  it('leaves out what nobody states: no count, no stages, no sectors, no place, and no empty line in their place', async () => {
    serve(api, { cards: [card({ portfolio_count: 0, stages: [], sectors: [], location: { city: null, state: null, country: null, label: null } })] });
    renderView();
    const item = (await screen.findByRole('link', { name: 'Blackbird' })).closest('li');
    expect(within(item).queryByText(/connected compan/)).not.toBeInTheDocument();
    expect(within(item).queryByText('No portfolio listed yet')).not.toBeInTheDocument();
    for (const label of ['Stage focus', 'Sector focus', 'Location']) expect(within(item).queryByText(label)).not.toBeInTheDocument();
    expect(item.querySelector('dl')).toBeNull();
    expect(within(item).getByText('View investor')).toBeInTheDocument(); // the card is still a way in
  });

  it('labels an investor that has stopped investing, and shows a single company in the singular', async () => {
    serve(api, { cards: [card({ status: 'inactive', active_status: 'inactive', portfolio_count: 1 })] });
    renderView();
    const item = (await screen.findByRole('link', { name: 'Blackbird' })).closest('li');
    expect(within(item).getByText('No longer investing')).toBeInTheDocument();
    expect(within(item).getByText('1 connected company')).toBeInTheDocument();
  });

  it('makes the name a real address (so it can be opened in a new tab), and a plain click opens the profile in place', async () => {
    serve(api, { cards: [card()], profiles: { blackbird: profile() } });
    renderView();
    const link = await screen.findByRole('link', { name: 'Blackbird' });
    expect(link).toHaveAttribute('href', '/investors/blackbird');
    await userEvent.click(link);
    expect(await screen.findByRole('heading', { level: 1, name: 'Blackbird' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/investors/blackbird');
  });

  it('asks for the first page in alphabetical order with no filters, and says how many investors there are', async () => {
    serve(api, { cards: cards(3) });
    renderView();
    expect(await screen.findByText('3 investors')).toBeInTheDocument();
    expect(api.fetchInvestors).toHaveBeenCalledWith({}, expect.objectContaining({ limit: 24, offset: 0 }));
    expect(screen.getByText(/not a ranking/)).toBeInTheDocument();
  });

  describe('searching and filtering', () => {
    const three = [
      card({ slug: 'a', name: 'Alpha Angels', type: 'angel_network', type_label: 'Angel Network', stages: ['Pre-seed'], sectors: ['Health'], location: { city: 'Brisbane', state: 'QLD', country: 'Australia', label: 'Brisbane, QLD' } }),
      card({ slug: 'b', name: 'Bravo Capital', stages: ['Seed'], sectors: ['Software'] }),
      card({ slug: 'c', name: 'Charlie Ventures', stages: ['Seed', 'Series A'], sectors: ['Software', 'Climate'] }),
    ];

    it('offers only options some investor has, each with how many, and asks the server for the one chosen', async () => {
      serve(api, { cards: three });
      renderView();
      await screen.findByRole('link', { name: 'Alpha Angels' });
      const type = screen.getByRole('combobox', { name: 'Investor type' });
      expect(within(type).getByRole('option', { name: 'Venture Capital (2)' })).toBeInTheDocument();
      expect(within(type).getByRole('option', { name: 'Angel Network (1)' })).toBeInTheDocument();
      expect(within(type).queryByRole('option', { name: /Corporate VC/ })).not.toBeInTheDocument();

      await userEvent.selectOptions(type, 'angel_network');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith({ type: 'angel_network' }, expect.objectContaining({ offset: 0 })));
      await waitFor(() => expect(screen.queryByRole('link', { name: 'Bravo Capital' })).not.toBeInTheDocument());
      expect(screen.getByRole('link', { name: 'Alpha Angels' })).toBeInTheDocument();
      expect(screen.getByText('1 investor match')).toBeInTheDocument();
    });

    it('filters by stage, sector and location, and leaves out a dropdown that has nothing to offer', async () => {
      serve(api, { cards: three });
      renderView();
      await screen.findByRole('link', { name: 'Alpha Angels' });
      for (const name of ['Stage', 'Sector', 'Location', 'Investor type']) expect(screen.getByRole('combobox', { name })).toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: 'Investing' })).not.toBeInTheDocument(); // behind "More filters"
      await userEvent.click(screen.getByRole('button', { name: 'More filters' }));
      expect(screen.getByRole('combobox', { name: 'Investing' })).toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: 'Leads or follows' })).not.toBeInTheDocument(); // no investor states it
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Stage' }), 'Seed');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith({ stage: 'Seed' }, expect.anything()));
    });

    it('offers leading or following, and whether it is still investing, when some investor says', async () => {
      serve(api, { cards: three, meta: metaOf(three, { lead: [{ value: 'lead', count: 2 }, { value: 'both', count: 1 }], active: [{ value: 'active', count: 2 }, { value: 'inactive', count: 1 }] }) });
      renderView();
      await screen.findByRole('link', { name: 'Alpha Angels' });
      await userEvent.click(screen.getByRole('button', { name: 'More filters' }));
      const lead = screen.getByRole('combobox', { name: 'Leads or follows' });
      expect(within(lead).getByRole('option', { name: 'Leads rounds (2)' })).toBeInTheDocument();
      expect(within(lead).getByRole('option', { name: 'Leads or follows (1)' })).toBeInTheDocument();
      const active = screen.getByRole('combobox', { name: 'Investing' });
      expect(within(active).getByRole('option', { name: 'Investing now (2)' })).toBeInTheDocument();
      expect(within(active).getByRole('option', { name: 'No longer investing (1)' })).toBeInTheDocument();
      await userEvent.selectOptions(active, 'inactive');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith({ active: 'inactive' }, expect.anything()));
    });

    it('keeps the filters beyond the four everyone uses behind "More filters", and never folds away one that is on', async () => {
      serve(api, { cards: three, meta: metaOf(three, { lead: [{ value: 'lead', count: 2 }], active: [{ value: 'active', count: 2 }, { value: 'inactive', count: 1 }] }) });
      renderView();
      await screen.findByRole('link', { name: 'Alpha Angels' });
      const more = screen.getByRole('button', { name: 'More filters' });
      expect(more).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('combobox', { name: 'Investing' })).not.toBeInTheDocument();
      await userEvent.click(more);
      expect(screen.getByRole('button', { name: 'Fewer filters' })).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('combobox', { name: 'Investing' })).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: 'Leads or follows' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Fewer filters' }));
      expect(screen.queryByRole('combobox', { name: 'Investing' })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'More filters' }));
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Investing' }), 'inactive');
      // a filter that is on cannot be folded out of sight: the way to fold it is to clear it
      expect(screen.queryByRole('button', { name: 'Fewer filters' })).not.toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: 'Investing' })).toHaveValue('inactive');
      await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
      expect(screen.getByRole('button', { name: 'Fewer filters' })).toBeInTheDocument();
    });

    it('folds the filters behind a button for a phone, and the button says how many are on', async () => {
      serve(api, { cards: three });
      renderView();
      await screen.findByRole('link', { name: 'Alpha Angels' });
      const toggle = screen.getByRole('button', { name: 'Filters' });
      const group = screen.getByRole('group', { name: 'Filters' });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(toggle).toHaveAttribute('aria-controls', group.id);
      expect(group).not.toHaveClass('inv-filters-open');
      await userEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(group).toHaveClass('inv-filters-open');
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Stage' }), 'Seed');
      expect(await screen.findByRole('button', { name: 'Filters (1)' })).toBeInTheDocument();
    });

    it('says what is searched for with the words the page is named by', async () => {
      serve(api, { cards: three });
      renderView();
      const box = await screen.findByRole('searchbox', { name: /Search investors/ });
      expect(box).toHaveAttribute('placeholder', 'Search investors, people, sectors or portfolio companies...');
    });

    it('names only the first three things it searches in the box on a phone, where the whole line does not fit', async () => {
      vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} })));
      try {
        serve(api, { cards: three });
        renderView();
        const box = await screen.findByRole('searchbox', { name: /Search investors/ });
        expect(box).toHaveAttribute('placeholder', 'Search investors, people, sectors...');
        expect(box).toHaveAccessibleName(/name, person, sector, stage, location or portfolio company/); // the full line is still its name
        expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 639px)');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('shows no cheque-size filter until some investor states a cheque in Australian dollars', async () => {
      serve(api, { cards: three });
      renderView();
      await screen.findByRole('link', { name: 'Alpha Angels' });
      expect(screen.queryByRole('combobox', { name: 'Cheque size' })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'More filters' }));
      expect(screen.queryByRole('combobox', { name: 'Cheque size' })).not.toBeInTheDocument();
      expect(screen.queryByText(/Cheque size matches only/)).not.toBeInTheDocument();
    });

    it('filters by cheque size when one is stated, as the range it covers, and says an investor with none stated is unknown, not out of range', async () => {
      serve(api, { cards: three, meta: metaOf(three, { cheque: { currency: 'AUD', count: 1, min: 250000, max: 1000000 } }) });
      renderView();
      await screen.findByRole('link', { name: 'Alpha Angels' });
      await userEvent.click(screen.getByRole('button', { name: 'More filters' }));
      expect(screen.getByText(/Cheque size matches only investors that state a range in Australian dollars \(1 investor does\)/)).toBeInTheDocument();
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Cheque size' }), '$100,000 to $500,000');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith({ chequeMin: '100000', chequeMax: '500000' }, expect.anything()));
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Cheque size' }), '$2 million and over');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith({ chequeMin: '2000000' }, expect.anything()));
    });

    it('asks again once typing in the search box pauses, not for every letter', async () => {
      serve(api, { cards: three });
      renderView();
      await screen.findByRole('link', { name: 'Alpha Angels' });
      api.fetchInvestors.mockClear();
      await userEvent.type(screen.getByRole('searchbox', { name: /Search investors/ }), 'bravo');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith({ search: 'bravo' }, expect.anything()));
      expect(api.fetchInvestors.mock.calls.map(([f]) => f.search)).not.toContain('br');
      await waitFor(() => expect(screen.queryByRole('link', { name: 'Alpha Angels' })).not.toBeInTheDocument());
      expect(screen.getByRole('link', { name: 'Bravo Capital' })).toBeInTheDocument();
    });

    it('says what is searched for in the box, in words a person can read', async () => {
      serve(api, { cards: three });
      renderView();
      const box = await screen.findByRole('searchbox', { name: /Search investors/ });
      expect(box).toHaveAccessibleName(/name, person, sector, stage, location or portfolio company/);
    });

    it('shows Clear filters only once a filter is on, and it puts every investor back', async () => {
      serve(api, { cards: three });
      renderView();
      await screen.findByRole('link', { name: 'Alpha Angels' });
      expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Investor type' }), 'angel_network');
      await waitFor(() => expect(screen.queryByRole('link', { name: 'Bravo Capital' })).not.toBeInTheDocument());
      await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
      expect(await screen.findByRole('link', { name: 'Bravo Capital' })).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: 'Investor type' })).toHaveValue('');
    });

    it('says honestly when nothing matches, and offers to clear', async () => {
      serve(api, { cards: three });
      renderView();
      await screen.findByRole('link', { name: 'Alpha Angels' });
      await userEvent.type(screen.getByRole('searchbox', { name: /Search investors/ }), 'zzzz');
      expect(await screen.findByText('No investors match those filters.')).toBeInTheDocument();
      await userEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
      expect(await screen.findByRole('link', { name: 'Bravo Capital' })).toBeInTheDocument();
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
      expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Investor', 'Type', 'Stage focus', 'Sector focus', 'Location', 'Connected companies']);
      const row = within(table).getByRole('row', { name: /Blackbird/ });
      expect(within(row).getByRole('link', { name: 'Blackbird' })).toHaveAttribute('href', '/investors/blackbird');
      for (const text of ['Venture Capital', 'Seed → Series A', 'Software', 'Sydney, NSW', '3 companies']) expect(within(row).getByText(text)).toBeInTheDocument();
      expect(screen.queryByText('View investor')).not.toBeInTheDocument(); // the cards' way in is not the table's

      await userEvent.click(cardsButton);
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Blackbird' }).closest('li')).toBeInTheDocument();
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
      expect(within(row).getAllByText('Not stated')).toHaveLength(4); // stages, sectors, place and connected companies
      expect(within(row).getByText('Angel Network')).toBeInTheDocument();
    });

    it('opens an investor from the table the way a card does', async () => {
      serve(api, { cards: two, profiles: { blackbird: profile() } });
      renderView();
      await userEvent.click(await screen.findByRole('button', { name: 'Table' }));
      await userEvent.click(screen.getByRole('link', { name: 'Blackbird' }));
      expect(await screen.findByRole('heading', { level: 1, name: 'Blackbird' })).toBeInTheDocument();
      expect(window.location.pathname).toBe('/investors/blackbird');
    });

    it('keeps the view it was in when the filters change', async () => {
      serve(api, { cards: two });
      renderView();
      await userEvent.click(await screen.findByRole('button', { name: 'Table' }));
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Stage' }), 'Seed');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith({ stage: 'Seed' }, expect.anything()));
      expect(screen.getByRole('table', { name: 'Investors' })).toBeInTheDocument();
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
    it('shows the first 24 and adds the rest when Show more is pressed', async () => {
      serve(api, { cards: cards(30) });
      renderView();
      const more = await screen.findByRole('button', { name: 'Show more (6 left)' });
      expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(24);
      await userEvent.click(more);
      await waitFor(() => expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(30));
      expect(api.fetchInvestors.mock.calls.at(-1)[1]).toMatchObject({ offset: 24, limit: 24 });
      expect(screen.queryByRole('button', { name: /Show more/ })).not.toBeInTheDocument();
    });

    it('says so when the next page cannot be loaded, and keeps what it has', async () => {
      serve(api, { cards: cards(30) });
      renderView();
      const more = await screen.findByRole('button', { name: /Show more/ });
      api.fetchInvestors.mockRejectedValueOnce(new Error('down'));
      await userEvent.click(more);
      expect(await screen.findByText('Could not load more investors right now.')).toBeInTheDocument();
      expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(24);
    });
  });
});

describe('moving between the directory, an investor and a person', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { window.history.pushState({}, '', '/'); });

  const world = () => serve(api, {
    cards: [card(), card({ slug: 'skip', name: 'Skip Capital', type: 'angel_network', type_label: 'Angel Network' })],
    profiles: { blackbird: profile({ team: [{ person: { slug: 'sam', name: 'Sam Rivera' }, role: 'Partner', is_current: true, started_on: null, ended_on: null, source: { url: 'https://blackbird.example/team' } }], related: [{ slug: 'skip', name: 'Skip Capital', shared: 1, companies: ['Acme'] }] }), skip: profile({ slug: 'skip', name: 'Skip Capital' }) },
    people: { sam: person() },
  });

  it('opens an investor from a link to it, and a person from the investor, and the back button walks back through them', async () => {
    world();
    window.history.pushState({}, '', '/investors/blackbird');
    renderView({ fromLink: true, initialRoute: { kind: 'investor', slug: 'blackbird' } });
    expect(await screen.findByRole('heading', { level: 1, name: 'Blackbird' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Sam Rivera' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Sam Rivera' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/investors/people/sam');

    window.history.back();
    expect(await screen.findByRole('heading', { level: 1, name: 'Blackbird' })).toBeInTheDocument();
  });

  it('goes from one investor to another it invests alongside', async () => {
    world();
    renderView({ initialRoute: { kind: 'investor', slug: 'blackbird' } });
    await userEvent.click(await screen.findByRole('link', { name: 'Skip Capital' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Skip Capital' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/investors/skip');
  });

  it('comes back to the same directory, with the filter still chosen and no new request', async () => {
    world();
    renderView();
    await screen.findByRole('link', { name: 'Blackbird' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Investor type' }), 'angel_network');
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Blackbird' })).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('link', { name: 'Skip Capital' }));
    await screen.findByRole('heading', { level: 1, name: 'Skip Capital' });
    const asked = api.fetchInvestors.mock.calls.length;

    await userEvent.click(screen.getByRole('button', { name: '← All investors' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Australian Startup Investors' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Investor type' })).toHaveValue('angel_network');
    expect(api.fetchInvestors.mock.calls.length).toBe(asked);
  });

  it('opened from the map is a step of its own, and Back is the map', async () => {
    world();
    const onClose = vi.fn();
    const before = window.history.length;
    renderView({ onClose });
    await screen.findByRole('heading', { level: 1, name: 'Australian Startup Investors' });
    expect(window.location.pathname).toBe('/investors');
    expect(window.history.length).toBe(before + 1);
    window.history.back();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('opened from a link adds no step to the history, and an old ?view=investors link is written in the new form', async () => {
    world();
    window.history.pushState({}, '', '/?city=Sydney&view=investors&investor=blackbird');
    const before = window.history.length;
    renderView({ fromLink: true, initialRoute: { kind: 'investor', slug: 'blackbird' } });
    await screen.findByRole('heading', { level: 1, name: 'Blackbird' });
    expect(window.history.length).toBe(before);
    expect(window.location.pathname).toBe('/investors/blackbird');
    expect(window.location.search).toBe('?city=Sydney');
  });

  it('says in the tab which page it is, and gives the tab back on leaving', async () => {
    world();
    document.title = 'AU Startup Map';
    const view = renderView();
    await screen.findByRole('heading', { level: 1, name: 'Australian Startup Investors' });
    expect(document.title).toBe('Australian Startup Investors · AU Startup Map');
    await userEvent.click(screen.getByRole('link', { name: 'Blackbird' }));
    await screen.findByRole('heading', { level: 1, name: 'Blackbird' });
    expect(document.title).toBe('Blackbird · Australian Startup Investors · AU Startup Map');
    await userEvent.click(screen.getByRole('button', { name: '← All investors' }));
    expect(document.title).toBe('Australian Startup Investors · AU Startup Map');
    view.unmount();
    expect(document.title).toBe('AU Startup Map');
  });

  it('says an investor is not in the directory (it was never published, or the link is mistyped) without saying the server is down', async () => {
    world();
    renderView({ initialRoute: { kind: 'investor', slug: 'nobody' } });
    expect(await screen.findByRole('heading', { level: 1, name: 'This investor is not in the directory.' })).toBeInTheDocument();
    expect(screen.getByText(/It may not have been published yet/)).toBeInTheDocument();
  });

  it('says it could not load an investor when the server fails, which is not the same thing', async () => {
    world();
    api.fetchInvestor.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }));
    renderView({ initialRoute: { kind: 'investor', slug: 'blackbird' } });
    expect(await screen.findByRole('heading', { level: 1, name: 'Could not load this investor right now.' })).toBeInTheDocument();
  });

  it('leaves for the map, takes the investor pages out of the address, and keeps what else it said', async () => {
    world();
    const onClose = vi.fn();
    window.history.pushState({}, '', '/investors/blackbird?city=Sydney');
    renderView({ onClose, fromLink: true, initialRoute: { kind: 'investor', slug: 'blackbird' } });
    await screen.findByRole('heading', { level: 1, name: 'Blackbird' });
    await userEvent.click(screen.getByRole('button', { name: '← Back to map' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/');
    expect(window.location.search).toBe('?city=Sydney');
  });

  it('opens a company a page says an investor backed: the app is told which one, and the address is left clean', async () => {
    serve(api, { cards: [card()], profiles: { blackbird: profile({ portfolio: [row()], recent: [row()] }) } });
    const onOpenCompany = vi.fn();
    window.history.pushState({}, '', '/investors/blackbird?city=Sydney');
    renderView({ onOpenCompany, fromLink: true, initialRoute: { kind: 'investor', slug: 'blackbird' } });
    await userEvent.click(await screen.findByRole('button', { name: 'Acme' }));
    expect(onOpenCompany).toHaveBeenCalledWith(company());
    expect(window.location.pathname).toBe('/');
    expect(window.location.search).toBe('?city=Sydney');
  });
});
