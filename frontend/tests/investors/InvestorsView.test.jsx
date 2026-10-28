import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/api.js', () => ({
  fetchInvestors: vi.fn(), fetchInvestorMeta: vi.fn(), fetchInvestor: vi.fn(), fetchInvestorPerson: vi.fn(), submitInvestorCorrection: vi.fn(), submitPersonCorrection: vi.fn(), submitFeedback: vi.fn(),
}));

import * as api from '../../src/api.js';
import InvestorsView from '../../src/components/investors/InvestorsView.jsx';
import { card, personCard, metaOf, profile, person, serve } from './helpers.js';

const renderView = (props = {}) => render(<InvestorsView onClose={() => {}} onOpenCompany={() => {}} {...props} />);
const cards = (n) => Array.from({ length: n }, (_, i) => card({ slug: `fund-${i}`, name: `Fund ${String(i).padStart(2, '0')}` }));
// The names of the investors listed, in order, whichever view they are in.
const names = () => [...document.querySelectorAll('.inv-item-link, .inv-card-link')].map((a) => a.firstChild.textContent);
const menuButton = (name) => screen.getByRole('button', { name: new RegExp(`^${name}`) });
const tick = async (menu, option) => {
  await userEvent.click(menuButton(menu));
  await userEvent.click(within(screen.getByRole('group', { name: menu })).getByRole('checkbox', { name: new RegExp(`^${option}`) }));
};
// What the page asks the server: every list is of firms and people (kind all), in Australia unless the visitor says global.
const asked = (extra = {}) => ({ kind: 'all', scope: 'au', ...extra });
const phone = () => vi.stubGlobal('matchMedia', vi.fn((query) => ({ matches: query === '(max-width: 639px)', addEventListener: () => {}, removeEventListener: () => {} })));

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
afterEach(() => { window.history.pushState({}, '', '/'); vi.unstubAllGlobals(); });

describe('the investor directory', () => {
  it('has the headline and the line under it the page is named by, and Investors as the place the header is on', async () => {
    serve(api);
    renderView();
    expect(await screen.findByRole('heading', { level: 1, name: 'Find your next backer.' })).toBeInTheDocument();
    expect(screen.getByText('Explore investors, understand their focus, and build your shortlist.')).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Discover' })).toHaveAttribute('aria-current', 'page');
    expect(within(screen.getByRole('navigation', { name: 'Discover' })).getByRole('link', { name: 'Investors' })).toHaveAttribute('aria-current', 'page');
    expect(within(screen.getByRole('navigation', { name: 'Discover' })).getByRole('link', { name: 'Startups' })).not.toHaveAttribute('aria-current');
  });

  it('lists each firm as a row: its logo, name, type, the number of companies a page says it backed, place, at most two tags, the bookmark and the way in', async () => {
    serve(api, { cards: [card()] });
    renderView();
    const link = await screen.findByRole('link', { name: 'Blackbird' });
    const item = link.closest('li');
    expect(item).toHaveClass('inv-item');
    expect(link).toHaveAttribute('href', '/investors/blackbird');
    expect(item.querySelector('.inv-logo-initial')).toHaveTextContent('B');
    expect(within(item).getByText('Venture Capital')).toBeInTheDocument();
    expect(within(item).getByText('blackbird.example')).toBeInTheDocument(); // the website its record holds
    expect(within(item).getByText('3 connected companies')).toBeInTheDocument();
    expect(within(item).getByText('Sydney, NSW')).toBeInTheDocument();
    expect([...item.querySelectorAll('.inv-chip')].map((c) => c.textContent)).toEqual(['Software', 'Seed → Series A']);
    expect(within(item).getByText('View profile')).toBeInTheDocument();
    expect(within(item).getByRole('button', { name: 'Save Blackbird' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('lists a person as a row too: initials, name, role, their firm (a way to its page, not theirs), place and tags, and says a firm\'s focus is the firm\'s', async () => {
    serve(api, { cards: [card()], peopleCards: [personCard({ slug: 'ben', name: 'Ben Sample', title: 'Principal', focus_from: 'firm', sectors: ['Health'], stages: [] })] });
    renderView();
    const link = await screen.findByRole('link', { name: 'Ben Sample' });
    const item = link.closest('li');
    expect(link).toHaveAttribute('href', '/investors/people/ben');
    expect(item.querySelector('.inv-person-initials')).toHaveTextContent('BS');
    expect(within(item).getByText('Principal')).toBeInTheDocument();
    expect(within(item).getByRole('link', { name: 'Blackbird' })).toHaveAttribute('href', '/investors/blackbird');
    expect(within(item).getByText('Sydney, NSW')).toBeInTheDocument();
    expect(item.querySelector('.inv-item-tags')).toHaveAttribute('title', 'Health (the focus of Blackbird)');
    expect(within(item).getByRole('list', { name: 'Focus of Blackbird' })).toBeInTheDocument();
    expect(within(item).queryByText('Investing')).not.toBeInTheDocument(); // an investing role needs no tag
  });

  it('says what role a person has when it is not an investing one, so a scout or a platform role is never taken for an investor', async () => {
    serve(api, { cards: [], peopleCards: [personCard({ slug: 'cal', name: 'Cal Scout', title: 'Scout', role_class: 'scout', role_label: 'Scout' }), personCard({ slug: 'dee', name: 'Dee Platform', title: 'Platform Partner', role_class: 'platform', role_label: 'Platform' })], meta: metaOf([], {}, [personCard(), personCard({ slug: 'x' })]) });
    renderView();
    const scout = (await screen.findByRole('link', { name: 'Cal Scout' })).closest('li');
    expect(within(scout).getByText('Scout', { selector: '.inv-tag' })).toBeInTheDocument();
    expect(within(screen.getByRole('link', { name: 'Dee Platform' }).closest('li')).getByText('Platform', { selector: '.inv-tag' })).toBeInTheDocument();
  });

  it('shows a dash, read out as "Not stated", for what nobody states', async () => {
    serve(api, { cards: [card({ portfolio_count: 0, stages: [], sectors: [], location: { city: null, state: null, country: null, label: null } })] });
    renderView();
    const item = (await screen.findByRole('link', { name: 'Blackbird' })).closest('li');
    expect(within(item).getAllByText('Not stated')).toHaveLength(2); // the place and the focus
    expect(within(item).queryByText(/connected compan/)).not.toBeInTheDocument();
    expect(within(item).getByText('blackbird.example')).toBeInTheDocument();
    expect(within(item).getByText('View profile')).toBeInTheDocument(); // the row is still a way in
  });

  it('labels an investor that has stopped investing, and shows a single company in the singular', async () => {
    serve(api, { cards: [card({ status: 'inactive', active_status: 'inactive', portfolio_count: 1 })] });
    renderView();
    const item = (await screen.findByRole('link', { name: 'Blackbird' })).closest('li');
    expect(within(item).getByText('No longer investing')).toBeInTheDocument();
    expect(within(item).getByText('1 connected company')).toBeInTheDocument();
  });

  it('names at most two tags of what an investor invests in, counts the rest, and says all of them on hover', async () => {
    serve(api, { cards: [card({ sectors: ['AI', 'Climate', 'Health'], stages: ['Seed'] })] });
    renderView();
    const item = (await screen.findByRole('link', { name: 'Blackbird' })).closest('li');
    expect([...item.querySelectorAll('.inv-chip')].map((c) => c.textContent)).toEqual(['AI', 'Climate', '+2']);
    expect(item.querySelector('.inv-item-tags')).toHaveAttribute('title', 'AI, Climate, Health, Seed');
  });

  it('asks for the first page, of firms and people, in Australia and in alphabetical order, and says how many investors there are', async () => {
    serve(api, { cards: cards(3) });
    renderView();
    expect(await screen.findByText('3 investors in Australia')).toBeInTheDocument();
    expect(api.fetchInvestors).toHaveBeenCalledWith(asked(), expect.objectContaining({ limit: 24, offset: 0, sort: 'name' }));
    expect(screen.getByText('Showing 3 of 3 investors')).toBeInTheDocument();
    expect(screen.getByText(/no order is a ranking/)).toBeInTheDocument();
  });

  describe('Australia and global', () => {
    const mixed = [card({ slug: 'a', name: 'Alpha' }), card({ slug: 'z', name: 'Zed Capital', location: { city: 'San Francisco', state: null, country: 'United States', label: 'San Francisco, United States' } })];

    it('starts on Australia, and Global lists everyone, in the address, with the options and the count following it', async () => {
      serve(api, { cards: mixed });
      renderView();
      await screen.findByRole('link', { name: 'Alpha' });
      expect(screen.getByRole('button', { name: 'Australia' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Global' })).toHaveAttribute('aria-pressed', 'false');
      expect(api.fetchInvestorMeta).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'all', scope: 'au' }));
      expect(screen.getByText('1 investor in Australia')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Zed Capital' })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Global' }));
      expect(await screen.findByRole('link', { name: 'Zed Capital' })).toBeInTheDocument();
      expect(api.fetchInvestors).toHaveBeenLastCalledWith({ kind: 'all' }, expect.objectContaining({ offset: 0 }));
      expect(api.fetchInvestorMeta).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'all', scope: undefined }));
      expect(screen.getByText('2 investors worldwide')).toBeInTheDocument();
      expect(window.location.search).toBe('?scope=global');

      await userEvent.click(screen.getByRole('button', { name: 'Australia' }));
      await waitFor(() => expect(screen.queryByRole('link', { name: 'Zed Capital' })).not.toBeInTheDocument());
      expect(window.location.search).toBe('');
    });

    it('opens on Global from a link that says so', async () => {
      window.history.pushState({}, '', '/investors?scope=global');
      serve(api, { cards: mixed });
      renderView();
      expect(await screen.findByRole('link', { name: 'Zed Capital' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Global' })).toHaveAttribute('aria-pressed', 'true');
      expect(api.fetchInvestors).toHaveBeenCalledWith({ kind: 'all' }, expect.anything());
    });

    it('says when nothing in Australia matches, and offers to look worldwide when the rest of the world has more', async () => {
      serve(api, { cards: mixed });
      renderView();
      await screen.findByRole('link', { name: 'Alpha' });
      await userEvent.type(screen.getByRole('searchbox'), 'Zed');
      expect(await screen.findByText(/No investors match those filters in Australia\. Global also lists investors based elsewhere\./)).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Look worldwide' }));
      expect(await screen.findByRole('link', { name: 'Zed Capital' })).toBeInTheDocument();
    });

    it('leaves the Saved tab to show what was saved wherever it is, whichever scope is on', async () => {
      localStorage.setItem('auStartupSavedInvestors', JSON.stringify(['z']));
      serve(api, { cards: mixed });
      renderView();
      await screen.findByRole('link', { name: 'Alpha' });
      await userEvent.click(screen.getByRole('tab', { name: 'Saved 1' }));
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith({ kind: 'all', slug: 'z' }, expect.anything()));
      expect(await screen.findByRole('link', { name: 'Zed Capital' })).toBeInTheDocument();
    });
  });

  describe('people and firms', () => {
    const firms = [card()];
    const people = [personCard(), personCard({ slug: 'ben', name: 'Ben Sample', title: 'Scout', role_class: 'scout', role_label: 'Scout' })];

    it('offers no choice between people and firms while the directory has no people', async () => {
      serve(api, { cards: firms });
      renderView();
      await screen.findByRole('link', { name: 'Blackbird' });
      expect(screen.queryByRole('group', { name: 'Who is listed' })).not.toBeInTheDocument();
    });

    it('offers everyone, people or firms once it has people, and asks the server for the one chosen', async () => {
      serve(api, { cards: firms, peopleCards: people });
      renderView();
      await screen.findByRole('link', { name: 'Sam Rivera' });
      expect(names()).toEqual(['Blackbird', 'Ben Sample', 'Sam Rivera'].sort((a, b) => a.localeCompare(b)));
      const group = within(screen.getByRole('group', { name: 'Who is listed' }));
      expect(group.getByRole('button', { name: 'Everyone' })).toHaveAttribute('aria-pressed', 'true');
      await userEvent.click(group.getByRole('button', { name: 'People' }));
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith(asked({ kind: 'person' }), expect.anything()));
      await waitFor(() => expect(names()).toEqual(['Ben Sample', 'Sam Rivera']));
      await userEvent.click(group.getByRole('button', { name: 'Firms' }));
      await waitFor(() => expect(names()).toEqual(['Blackbird']));
    });

    it('filters people by the kind of role they have, in More filters', async () => {
      serve(api, { cards: firms, peopleCards: people, meta: metaOf(firms, { roles: [{ value: 'investment', count: 1, label: 'Investing' }, { value: 'scout', count: 1, label: 'Scout' }] }, people) });
      renderView();
      await screen.findByRole('link', { name: 'Sam Rivera' });
      await userEvent.click(menuButton('More filters'));
      await userEvent.selectOptions(within(screen.getByRole('group', { name: 'More filters' })).getByRole('combobox', { name: 'Role' }), 'scout');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith(asked({ role: 'scout' }), expect.anything()));
      await waitFor(() => expect(names()).toEqual(['Ben Sample']));
    });
  });

  describe('searching and filtering', () => {
    const three = [
      card({ slug: 'a', name: 'Alpha Angels', type: 'angel_network', type_label: 'Angel Network', stages: ['Pre-seed'], sectors: ['Health'], location: { city: 'Brisbane', state: 'QLD', country: 'Australia', label: 'Brisbane, QLD' } }),
      card({ slug: 'b', name: 'Bravo Capital', stages: ['Seed'], sectors: ['Software'] }),
      card({ slug: 'c', name: 'Charlie Ventures', stages: ['Seed', 'Series A'], sectors: ['Software', 'Climate'] }),
    ];

    it('has one search box, and four small filters that each offer only what some investor has, with how many', async () => {
      serve(api, { cards: three });
      renderView();
      await screen.findByRole('link', { name: 'Alpha Angels' });
      expect(screen.getAllByRole('searchbox')).toHaveLength(1);
      expect(screen.getByRole('searchbox')).toHaveAttribute('placeholder', 'Search by name, firm or investment interest');
      for (const name of ['Location', 'Type', 'Sector', 'Stage', 'More filters']) expect(menuButton(name)).toHaveAttribute('aria-haspopup', 'true');
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
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith(asked({ stage: 'Seed' }), expect.objectContaining({ offset: 0 })));
      await waitFor(() => expect(screen.queryByRole('link', { name: 'Alpha Angels' })).not.toBeInTheDocument());
      expect(screen.getByText('2 of 3 investors in Australia')).toBeInTheDocument();
      expect(menuButton('Stage')).toHaveTextContent('Stage 1');
      await userEvent.click(within(screen.getByRole('group', { name: 'Stage' })).getByRole('checkbox', { name: /^Pre-seed/ }));
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith(asked({ stage: 'Seed,Pre-seed' }), expect.anything()));
      expect(await screen.findByRole('link', { name: 'Alpha Angels' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Clear stages' }));
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith(asked(), expect.anything()));
    });

    it('filters by sector and by location, together, and the results are the investors that match both', async () => {
      serve(api, { cards: three });
      renderView();
      await screen.findByRole('link', { name: 'Alpha Angels' });
      await tick('Sector', 'Software');
      await tick('Location', 'NSW');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith(asked({ sector: 'Software', location: 'NSW' }), expect.anything()));
      await waitFor(() => expect(names()).toEqual(['Bravo Capital', 'Charlie Ventures']));
      await tick('Stage', 'Series A');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith(asked({ stage: 'Series A', sector: 'Software', location: 'NSW' }), expect.anything()));
      await waitFor(() => expect(names()).toEqual(['Charlie Ventures']));
    });

    it('filters by the kind of investor, from the Type menu', async () => {
      serve(api, { cards: three });
      renderView();
      await screen.findByRole('link', { name: 'Alpha Angels' });
      await userEvent.click(menuButton('Type'));
      const type = within(screen.getByRole('group', { name: 'Type' }));
      expect(type.getAllByRole('checkbox').map((c) => c.closest('label').textContent).sort()).toEqual(['Angel Network1', 'Venture Capital2']);
      await userEvent.click(type.getByRole('checkbox', { name: /^Angel Network/ }));
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith(asked({ type: 'angel_network' }), expect.anything()));
      await waitFor(() => expect(names()).toEqual(['Alpha Angels']));
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

    it('keeps the filters beyond the four behind "More filters": whether it leads, whether it is still investing, a cheque size and a role, when an investor states them', async () => {
      serve(api, { cards: three, meta: metaOf(three, { lead: [{ value: 'lead', count: 2 }, { value: 'both', count: 1 }], active: [{ value: 'active', count: 2 }, { value: 'inactive', count: 1 }] }) });
      renderView();
      await screen.findByRole('link', { name: 'Alpha Angels' });
      await userEvent.click(menuButton('More filters'));
      const more = within(screen.getByRole('group', { name: 'More filters' }));
      expect(more.queryByRole('combobox', { name: 'Role' })).not.toBeInTheDocument(); // no person has a role to filter by
      expect(within(more.getByRole('combobox', { name: 'Leads or follows' })).getByRole('option', { name: 'Leads rounds (2)' })).toBeInTheDocument();
      const active = more.getByRole('combobox', { name: 'Investing' });
      expect(within(active).getByRole('option', { name: 'Investing now (2)' })).toBeInTheDocument();
      expect(within(active).getByRole('option', { name: 'No longer investing (1)' })).toBeInTheDocument();
      expect(screen.getByText(/a person is not listed when one of them is on/)).toBeInTheDocument();
      await userEvent.selectOptions(active, 'inactive');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith(asked({ active: 'inactive' }), expect.anything()));
      expect(menuButton('More filters')).toHaveTextContent('More filters 1');
    });

    it('offers no filter that no investor can be filtered by: no role, no leads or follows, no still-investing, no cheque size', async () => {
      serve(api, { cards: three, meta: metaOf(three, { lead: [], active: [], cheque: null }) });
      renderView();
      await screen.findByRole('link', { name: 'Alpha Angels' });
      expect(screen.queryByRole('button', { name: /^More filters/ })).not.toBeInTheDocument();
    });

    it('filters by cheque size when one is stated, as the range it covers, and says an investor with none stated is unknown, not out of range', async () => {
      serve(api, { cards: three, meta: metaOf(three, { cheque: { currency: 'AUD', count: 1, min: 250000, max: 1000000 } }) });
      renderView();
      await screen.findByRole('link', { name: 'Alpha Angels' });
      await userEvent.click(menuButton('More filters'));
      expect(screen.getByText(/Cheque size matches only investors that state a range in Australian dollars \(1 investor does\)/)).toBeInTheDocument();
      const cheque = screen.getByRole('combobox', { name: 'Cheque size' });
      await userEvent.selectOptions(cheque, '$100,000 to $500,000');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith(asked({ chequeMin: '100000', chequeMax: '500000' }), expect.anything()));
      await userEvent.selectOptions(cheque, '$2 million and over');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith(asked({ chequeMin: '2000000' }), expect.anything()));
    });

    it('asks again once typing in the search box pauses, not for every letter', async () => {
      serve(api, { cards: three });
      renderView();
      await screen.findByRole('link', { name: 'Alpha Angels' });
      api.fetchInvestors.mockClear();
      await userEvent.type(screen.getByRole('searchbox'), 'bravo');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith(asked({ search: 'bravo' }), expect.anything()));
      expect(api.fetchInvestors.mock.calls.map(([f]) => f.search)).not.toContain('br');
      await waitFor(() => expect(screen.queryByRole('link', { name: 'Alpha Angels' })).not.toBeInTheDocument());
      expect(screen.getByRole('link', { name: 'Bravo Capital' })).toBeInTheDocument();
    });

    it('says what is searched for in words a person can read, and names only the first things in the box on a phone, where the whole line does not fit', async () => {
      serve(api, { cards: three });
      const first = renderView();
      expect(await screen.findByRole('searchbox')).toHaveAccessibleName(/name, firm or investment interest/);
      first.unmount();
      phone();
      renderView();
      expect(await screen.findByRole('searchbox')).toHaveAttribute('placeholder', 'Search investors…');
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
      expect(await screen.findByText(/No investors match those filters in Australia\./)).toBeInTheDocument();
      await userEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
      expect(await screen.findByRole('link', { name: 'Bravo Capital' })).toBeInTheDocument();
    });
  });

  describe('starting points', () => {
    const many = [
      card({ slug: 'a', name: 'Alpha', stages: ['Pre-seed'], sectors: ['Health'], location: { city: 'Melbourne', state: 'VIC', country: 'Australia', label: 'Melbourne, VIC' } }),
      card({ slug: 'b', name: 'Bravo', stages: ['Pre-seed'], sectors: ['Software'], location: { city: 'Melbourne', state: 'VIC', country: 'Australia', label: 'Melbourne, VIC' } }),
      card({ slug: 'c', name: 'Charlie', stages: ['Seed'], sectors: ['Software'] }),
      card({ slug: 'd', name: 'Delta', stages: ['Seed'], sectors: ['Software'] }),
      card({ slug: 'e', name: 'Echo', stages: ['Growth'], sectors: ['Climate'] }),
    ];

    it('offers lists the records really make, each a filter with how many investors it holds, and none that is everyone or only one', async () => {
      serve(api, { cards: many });
      renderView();
      await screen.findByRole('link', { name: 'Alpha' });
      const lists = within(screen.getByRole('region', { name: 'Start with' }));
      // the biggest states first, then the biggest stages, then the biggest sector; Echo's Growth (one investor) and the lone Health are not collections
      expect(lists.getAllByRole('button').map((b) => b.textContent)).toEqual(['New South Wales investors3', 'Victoria investors2', 'Pre-seed investors2', 'Seed investors2', 'Software investors3']);
    });

    it('applies a list as a filter, shows it on, and takes it off when pressed again', async () => {
      serve(api, { cards: many });
      renderView();
      await screen.findByRole('link', { name: 'Alpha' });
      await userEvent.click(screen.getByRole('button', { name: /^Pre-seed investors/ }));
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith(asked({ stage: 'Pre-seed' }), expect.anything()));
      expect(screen.getByRole('button', { name: /^Pre-seed investors/ })).toHaveAttribute('aria-pressed', 'true');
      await waitFor(() => expect(names()).toEqual(['Alpha', 'Bravo']));
      await userEvent.click(screen.getByRole('button', { name: /^Pre-seed investors/ }));
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith(asked(), expect.anything()));
    });

    it('offers none when the records make no collection (one investor each, or everyone)', async () => {
      serve(api, { cards: [card({ slug: 'a', name: 'Alpha' }), card({ slug: 'b', name: 'Bravo' })] });
      renderView();
      await screen.findByRole('link', { name: 'Alpha' });
      expect(screen.queryByRole('region', { name: 'Start with' })).not.toBeInTheDocument();
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
      await screen.findByRole('link', { name: 'Bravo' });
      const sort = screen.getByRole('combobox', { name: 'Sort by' });
      expect(sort).toHaveValue('name');
      expect([...sort.options].map((o) => o.textContent)).toEqual(['Name A–Z', 'Name Z–A', 'Most connected', 'Location A–Z']);
      expect(names()).toEqual(['Bravo', 'Charlie', 'Delta']); // the one in New Zealand is global, not in Australia
    });

    it('asks the server for the order chosen and shows the results in the order it sends', async () => {
      serve(api, { cards: four });
      renderView();
      await screen.findByRole('link', { name: 'Bravo' });
      const sort = screen.getByRole('combobox', { name: 'Sort by' });
      await userEvent.selectOptions(sort, 'name_desc');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith(asked(), expect.objectContaining({ sort: 'name_desc', offset: 0 })));
      await waitFor(() => expect(names()).toEqual(['Delta', 'Charlie', 'Bravo']));
      await userEvent.selectOptions(sort, 'portfolio');
      await waitFor(() => expect(names()).toEqual(['Bravo', 'Charlie', 'Delta']));
      await userEvent.selectOptions(sort, 'location');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith(asked(), expect.objectContaining({ sort: 'location' })));
    });

    it('sorts the investors that match the filters, and keeps the sort when the filters change', async () => {
      serve(api, { cards: four });
      renderView();
      await screen.findByRole('link', { name: 'Bravo' });
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'name_desc');
      await tick('Location', 'NSW');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith(asked({ location: 'NSW' }), expect.objectContaining({ sort: 'name_desc' })));
      await waitFor(() => expect(names()).toEqual(['Delta', 'Bravo']));
      expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveValue('name_desc');
    });
  });

  describe('a list and cards', () => {
    const two = [card(), card({ slug: 'bare', name: 'Bare Capital', type_label: 'Angel Network', stages: [], sectors: [], portfolio_count: 0, location: { city: null, state: null, country: null, label: null } })];

    it('starts with the compact list, and the cards show the same investors, and back', async () => {
      serve(api, { cards: [card()], profiles: { blackbird: profile() } });
      renderView();
      await screen.findByRole('link', { name: 'Blackbird' });
      const listButton = screen.getByRole('button', { name: 'List' });
      const cardsButton = screen.getByRole('button', { name: 'Cards' });
      expect(listButton).toHaveAttribute('aria-pressed', 'true');
      expect(cardsButton).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('list', { name: 'Investors' })).toBeInTheDocument();

      await userEvent.click(cardsButton);
      expect(cardsButton).toHaveAttribute('aria-pressed', 'true');
      expect(screen.queryByRole('list', { name: 'Investors' })).not.toBeInTheDocument();
      const item = screen.getByRole('link', { name: 'Blackbird' }).closest('li');
      expect(item).toHaveClass('card', 'entity-card', 'inv-card'); // the app's one card
      const facts = Object.fromEntries([...item.querySelectorAll('.inv-card-facts > div')].map((row) => [row.querySelector('dt').textContent, row.querySelector('dd').textContent]));
      expect(facts).toEqual({ Focus: 'Software', Stage: 'Seed → Series A', Location: 'Sydney, NSW' });
      expect(within(item).getByText('3 connected companies')).toBeInTheDocument();
      expect(within(item).getByTitle(/Verified 8 Oct 2026/)).toBeInTheDocument();

      await userEvent.click(listButton);
      expect(screen.getByRole('list', { name: 'Investors' })).toBeInTheDocument();
    });

    it('draws a person on a card too: their role, their firm and where they are, with a dash for what nobody states', async () => {
      serve(api, { cards: [], peopleCards: [personCard({ stages: [], sectors: [], location: { city: null, state: null, country: null, label: null }, scope: 'au' })], meta: metaOf([], {}, [personCard(), personCard({ slug: 'x' })]) });
      renderView();
      await userEvent.click(await screen.findByRole('button', { name: 'Cards' }));
      const item = screen.getByRole('link', { name: 'Sam Rivera' }).closest('li');
      expect(item.querySelector('.inv-person-initials')).toHaveTextContent('SR');
      const facts = Object.fromEntries([...item.querySelectorAll('.inv-card-facts > div')].map((row) => [row.querySelector('dt').textContent, row.querySelector('dd').textContent]));
      expect(Object.keys(facts)).toEqual(['Firm', 'Focus', 'Stage', 'Location']);
      expect(facts).toMatchObject({ Focus: '–Not stated', Stage: '–Not stated', Location: '–Not stated' });
      expect(within(item).getByRole('link', { name: 'Blackbird' })).toHaveAttribute('href', '/investors/blackbird');
    });

    it('is the same data in both: the same count, filters, sort and results, whichever view it is in', async () => {
      serve(api, { cards: [card({ slug: 'a', name: 'Alpha' }), card({ slug: 'b', name: 'Bravo', stages: ['Pre-seed'] }), card({ slug: 'c', name: 'Charlie' })] });
      renderView();
      await screen.findByRole('link', { name: 'Alpha' });
      await tick('Stage', 'Seed');
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'name_desc');
      await waitFor(() => expect(names()).toEqual(['Charlie', 'Alpha']));
      const was = api.fetchInvestors.mock.calls.length;
      await userEvent.click(screen.getByRole('button', { name: 'Cards' }));
      expect(names()).toEqual(['Charlie', 'Alpha']);
      expect(screen.getByText('2 of 3 investors in Australia')).toBeInTheDocument();
      expect(screen.getByText('Showing 2 of 2 investors')).toBeInTheDocument();
      expect(menuButton('Stage')).toHaveTextContent('Stage 1');
      expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveValue('name_desc');
      expect(api.fetchInvestors.mock.calls.length).toBe(was); // switching the view asks for nothing
    });

    it('writes what nobody states as "Not stated" in the list, and never as a guess', async () => {
      serve(api, { cards: two });
      renderView();
      const item = (await screen.findByRole('link', { name: 'Bare Capital' })).closest('li');
      expect(within(item).getAllByText('Not stated')).toHaveLength(2);
      expect(within(item).getByText('Angel Network')).toBeInTheDocument();
    });

    it('opens an investor from its name and from anywhere in its row, and lights the open one', async () => {
      serve(api, { cards: two, profiles: { blackbird: profile(), bare: profile({ slug: 'bare', name: 'Bare Capital' }) } });
      renderView();
      await userEvent.click(await screen.findByRole('link', { name: 'Blackbird' }));
      expect(await screen.findByRole('complementary', { name: 'Blackbird' })).toBeInTheDocument();
      expect(window.location.pathname).toBe('/investors/blackbird');
      expect(screen.getByRole('link', { name: 'Blackbird' }).closest('li')).toHaveClass('inv-item-on');
      expect(screen.getByRole('link', { name: 'Blackbird' })).toHaveAttribute('aria-current', 'true');
      await userEvent.click(screen.getByRole('link', { name: 'Bare Capital' }));
      expect(await screen.findByRole('complementary', { name: 'Bare Capital' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Bare Capital' }).closest('li')).toHaveClass('inv-item-on');
      expect(screen.getByRole('link', { name: 'Blackbird' }).closest('li')).not.toHaveClass('inv-item-on');
    });

    it('keeps the view it was in when the filters change, and when an investor is opened', async () => {
      serve(api, { cards: two, profiles: { blackbird: profile() } });
      renderView();
      await userEvent.click(await screen.findByRole('button', { name: 'Cards' }));
      await tick('Stage', 'Seed');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith(asked({ stage: 'Seed' }), expect.anything()));
      expect(screen.queryByRole('list', { name: 'Investors' })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('link', { name: 'Blackbird' }));
      await screen.findByRole('complementary', { name: 'Blackbird' });
      expect(screen.getByRole('button', { name: 'Cards' })).toHaveAttribute('aria-pressed', 'true');
    });
  });

  describe('saving investors', () => {
    const three = [card({ slug: 'a', name: 'Alpha' }), card({ slug: 'b', name: 'Bravo' }), card({ slug: 'c', name: 'Charlie' })];

    it('saves an investor from its row without opening it, says so, and keeps it in this browser', async () => {
      serve(api, { cards: three });
      renderView();
      await screen.findByRole('link', { name: 'Alpha' });
      await userEvent.click(screen.getByRole('button', { name: 'Save Bravo' }));
      expect(screen.getByRole('button', { name: 'Remove Bravo from saved' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.queryByRole('complementary')).not.toBeInTheDocument(); // the bookmark is not the row
      expect(window.location.pathname).toBe('/investors');
      expect(JSON.parse(localStorage.getItem('auStartupSavedInvestors'))).toEqual(['b']);
      expect(screen.getByRole('tab', { name: 'Saved 1' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Remove Bravo from saved' }));
      expect(JSON.parse(localStorage.getItem('auStartupSavedInvestors'))).toEqual([]);
      expect(screen.getByRole('tab', { name: 'Saved' })).toBeInTheDocument();
    });

    it('saves a person by their own key, which no firm\'s address can be', async () => {
      serve(api, { cards: [card()], peopleCards: [personCard()] });
      renderView();
      await userEvent.click(await screen.findByRole('button', { name: 'Save Sam Rivera' }));
      expect(JSON.parse(localStorage.getItem('auStartupSavedInvestors'))).toEqual(['people/sam']);
      await userEvent.click(screen.getByRole('tab', { name: 'Saved 1' }));
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith({ kind: 'all', slug: 'people/sam' }, expect.anything()));
      expect(await screen.findByRole('link', { name: 'Sam Rivera' })).toBeInTheDocument();
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
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith({ kind: 'all', slug: 'a,c' }, expect.objectContaining({ offset: 0 })));
      await waitFor(() => expect(names()).toEqual(['Alpha', 'Charlie']));
      expect(screen.getByText('2 saved investors')).toBeInTheDocument();
      await userEvent.type(screen.getByRole('searchbox'), 'char');
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith({ search: 'char', kind: 'all', slug: 'a,c' }, expect.anything()));
      await waitFor(() => expect(names()).toEqual(['Charlie']));
      expect(screen.getByText('1 of 2 saved investors')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('tab', { name: 'All investors' }));
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith(asked({ search: 'char' }), expect.anything()));
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

    it('keeps what was saved on an earlier visit on its tab, with how many, and lists exactly those', async () => {
      localStorage.setItem('auStartupSavedInvestors', JSON.stringify(['a']));
      serve(api, { cards: three });
      renderView();
      await screen.findByRole('link', { name: 'Alpha' });
      await userEvent.click(screen.getByRole('tab', { name: 'Saved 1' }));
      expect(screen.getByRole('tab', { name: 'Saved 1' })).toHaveAttribute('aria-selected', 'true');
      await waitFor(() => expect(names()).toEqual(['Alpha']));
    });
  });

  describe('on a phone', () => {
    const three = [
      card({ slug: 'a', name: 'Alpha Angels', type: 'angel_network', type_label: 'Angel Network', stages: ['Pre-seed'], sectors: ['Health'] }),
      card({ slug: 'b', name: 'Bravo Capital', stages: ['Seed'], sectors: ['Software'] }),
      card({ slug: 'c', name: 'Charlie Ventures', stages: ['Seed', 'Series A'], sectors: ['Software', 'Climate'] }),
    ];

    it('has one Filters button in place of the menus, which opens a sheet with every filter in it and the number of investors it would show', async () => {
      phone();
      serve(api, { cards: three });
      renderView();
      await screen.findByRole('link', { name: 'Alpha Angels' });
      expect(screen.queryByRole('button', { name: /^Stage/ })).not.toBeInTheDocument();
      const open = screen.getByRole('button', { name: /^Filters/ });
      await userEvent.click(open);
      const sheet = screen.getByRole('dialog', { name: 'Filters' });
      for (const group of ['Location', 'Investor type', 'Sector', 'Stage']) expect(within(sheet).getByRole('group', { name: new RegExp(`^${group}`) })).toBeInTheDocument();
      await userEvent.click(within(within(sheet).getByRole('group', { name: /^Stage/ })).getByRole('checkbox', { name: /^Seed/ }));
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith(asked({ stage: 'Seed' }), expect.anything()));
      expect(await within(sheet).findByRole('button', { name: 'Show 2 investors' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Filters 1/ })).toBeInTheDocument();
      await userEvent.click(within(sheet).getByRole('button', { name: 'Clear all' }));
      await waitFor(() => expect(api.fetchInvestors).toHaveBeenLastCalledWith(asked(), expect.anything()));
    });

    it('closes with its button, with Escape and with a press outside it, and gives focus back to the Filters button', async () => {
      phone();
      serve(api, { cards: three });
      renderView();
      await screen.findByRole('link', { name: 'Alpha Angels' });
      const open = screen.getByRole('button', { name: /^Filters/ });
      await userEvent.click(open);
      await userEvent.click(screen.getByRole('button', { name: 'Close the filters' }));
      expect(screen.queryByRole('dialog', { name: 'Filters' })).not.toBeInTheDocument();
      expect(open).toHaveFocus();
      await userEvent.click(open);
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog', { name: 'Filters' })).not.toBeInTheDocument();
      await userEvent.click(open);
      await userEvent.click(screen.getByRole('button', { name: /^Show 3 investors/ }));
      expect(screen.queryByRole('dialog', { name: 'Filters' })).not.toBeInTheDocument();
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
