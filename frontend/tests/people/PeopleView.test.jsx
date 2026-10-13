import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/api.js', () => ({ fetchPeople: vi.fn(), fetchInstitutions: vi.fn(), fetchLists: vi.fn(), fetchList: vi.fn() }));

import { fetchPeople, fetchInstitutions, fetchLists, fetchList } from '../../src/api.js';
import PeopleView, { readAddress, addressOf, TABS } from '../../src/components/people/PeopleView.jsx';

const person = (n, over = {}) => ({
  id: `person-${n}`, name: `Person ${n}`, type: 'person', roleType: 'founder', title: 'Co-founder', orgName: `Org ${n}`, orgType: 'company', city: 'Sydney',
  whyFollow: `Why ${n}.`, links: {}, sources: [], verifiedAt: null, vouches: [], ...over,
});
const firm = (n, over = {}) => ({ id: `firm-${n}`, name: `Firm ${n}`, type: 'institution', city: 'Melbourne', stageFocus: 'Seed', sectors: [], website: null, sources: [], verifiedAt: null, ...over });
const COUNTS = { founders: 3, operators: 2, investors: 1, institutions: 4 };
const answer = (results, over = {}) => ({ counts: COUNTS, total: results.length, count: results.length, results, offset: 0, limit: 20, hasMore: false, nextOffset: null, ...over });
const mount = (props = {}) => render(<PeopleView onClose={() => {}} onOpenCompany={() => {}} onOpenInternal={() => {}} initialAddress={{ tab: null, list: null, q: '' }} {...props} />);

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/people');
  fetchLists.mockResolvedValue({ results: [] });
  fetchPeople.mockResolvedValue(answer([person(1), person(2), person(3)]));
  fetchInstitutions.mockResolvedValue(answer([firm(1), firm(2)], { count: 2, total: 2 }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('the address of the page', () => {
  it('reads the tab, the list and the word, and ignores a tab it does not know', () => {
    expect(readAddress('?tab=operators&q=perth')).toEqual({ tab: 'operators', list: null, q: 'perth' });
    expect(readAddress('?list=founders-to-follow')).toEqual({ tab: null, list: 'founders-to-follow', q: '' });
    expect(readAddress('?tab=nonsense')).toEqual({ tab: null, list: null, q: '' });
    expect(readAddress('')).toEqual({ tab: null, list: null, q: '' });
  });

  it('writes them back, and a list stands alone: the tab and the word do not apply to it', () => {
    expect(addressOf({ tab: 'operators', list: null, q: 'perth' })).toBe('/people?tab=operators&q=perth');
    expect(addressOf({ tab: null, list: null, q: '' })).toBe('/people');
    expect(addressOf({ tab: 'operators', list: 'picks', q: 'perth' })).toBe('/people?list=picks');
  });
});

describe('the tabs', () => {
  it('has four tabs, Founders, Operators, Investors (people) and Institutions, each with how many are in it', async () => {
    mount();
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent.replace(/\s+/g, ' ').trim())).toEqual(['Founders 3', 'Operators 2', 'Investors (people) 1', 'Institutions 4']);
    expect(TABS.map((t) => t.label)).toEqual(['Founders', 'Operators', 'Investors (people)', 'Institutions']);
  });

  it('shows founders first, asking for 20, and the people it was sent as cards', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Person 1' })).toBeInTheDocument();
    expect(fetchPeople).toHaveBeenCalledWith({ role: 'founder', search: '' }, expect.objectContaining({ limit: 20, offset: 0 }));
    expect(screen.getByRole('tab', { name: /Founders/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('3 founders');
  });

  it('asks for the other role when another tab is chosen, and for the firms on Institutions', async () => {
    mount();
    await screen.findByRole('heading', { name: 'Person 1' });
    fetchPeople.mockResolvedValue(answer([person(9, { roleType: 'operator' })], { count: 1 }));
    await userEvent.click(screen.getByRole('tab', { name: /Operators/ }));
    await screen.findByRole('heading', { name: 'Person 9' });
    expect(fetchPeople).toHaveBeenLastCalledWith({ role: 'operator', search: '' }, expect.anything());
    await userEvent.click(screen.getByRole('tab', { name: /Institutions/ }));
    expect(await screen.findByRole('heading', { name: 'Firm 1' })).toBeInTheDocument();
    expect(fetchInstitutions).toHaveBeenCalledWith({ search: '' }, expect.objectContaining({ limit: 20 }));
    await waitFor(() => expect(window.location.search).toBe('?tab=institutions'));
  });

  it('moves between the tabs with the arrow keys, one tab stop for the group', async () => {
    mount();
    await screen.findByRole('heading', { name: 'Person 1' });
    expect(screen.getAllByRole('tab').map((t) => t.tabIndex)).toEqual([0, -1, -1, -1]);
    screen.getByRole('tab', { name: /Founders/ }).focus();
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(screen.getByRole('tab', { name: /Operators/ })).toHaveAttribute('aria-selected', 'true'));
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    await waitFor(() => expect(screen.getByRole('tab', { name: /Institutions/ })).toHaveAttribute('aria-selected', 'true'));
  });

  it('opens on the first tab that has someone in it when none is asked for and founders is empty', async () => {
    fetchPeople.mockImplementation(async ({ role }) => (role === 'founder'
      ? answer([], { counts: { founders: 0, operators: 2, investors: 0, institutions: 4 } })
      : answer([person(7, { roleType: 'operator' })], { counts: { founders: 0, operators: 2, investors: 0, institutions: 4 }, count: 1 })));
    mount();
    expect(await screen.findByRole('heading', { name: 'Person 7' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Operators/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('opens on the tab the address names, even an empty one, and says it is empty', async () => {
    fetchPeople.mockResolvedValue(answer([], { counts: { founders: 0, operators: 0, investors: 0, institutions: 4 } }));
    mount({ initialAddress: { tab: 'founders', list: null, q: '' } });
    expect(await screen.findByText('No founders are listed yet.')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Founders/ })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('searching', () => {
  it('asks again when typing pauses, not for every letter, and puts the word in the address', async () => {
    mount();
    await screen.findByRole('heading', { name: 'Person 1' });
    fetchPeople.mockClear();
    await userEvent.type(screen.getByRole('searchbox'), 'perth');
    await waitFor(() => expect(fetchPeople).toHaveBeenCalledTimes(1));
    expect(fetchPeople).toHaveBeenCalledWith({ role: 'founder', search: 'perth' }, expect.anything());
    await waitFor(() => expect(window.location.search).toBe('?q=perth')); // no tab was chosen: the default is not written down
  });

  it('applies the word the address carries when it opens, and says when nothing matches', async () => {
    fetchPeople.mockResolvedValue(answer([], { count: 0, total: 3 }));
    mount({ initialAddress: { tab: 'founders', list: null, q: 'zzz' } });
    expect(await screen.findByText('No one matches that.')).toBeInTheDocument();
    expect(fetchPeople).toHaveBeenCalledWith({ role: 'founder', search: 'zzz' }, expect.anything());
    expect(screen.getByRole('searchbox')).toHaveValue('zzz');
  });
});

describe('an index of names, a way to nominate, and a way to ask for more', () => {
  it('has an index of the names on the page near the top, each a link to its card', async () => {
    mount();
    const index = await screen.findByRole('navigation', { name: 'Index of the founders listed' });
    expect(within(index).getAllByRole('link').map((a) => a.textContent)).toEqual(['Person 1', 'Person 2', 'Person 3']);
    const target = document.getElementById(within(index).getByRole('link', { name: 'Jump to Person 2' }).getAttribute('href').slice(1));
    expect(target).toBe(screen.getByRole('heading', { name: 'Person 2' }).closest('li'));
  });

  it('has "Nominate someone", which says the form is not set up yet until the owner makes it', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Nominate someone' }));
    const dialog = screen.getByRole('dialog', { name: 'Nominate someone' });
    expect(dialog).toHaveTextContent('This form is not set up yet');
    expect(within(dialog).getAllByRole('listitem').map((li) => li.textContent)).toContain('A checkbox: I am nominating myself or have asked them');
  });

  it('offers to nominate someone in an empty tab', async () => {
    fetchPeople.mockResolvedValue(answer([], { counts: { founders: 0, operators: 0, investors: 0, institutions: 4 } }));
    mount({ initialAddress: { tab: 'operators', list: null, q: '' } });
    await userEvent.click(await screen.findByRole('button', { name: 'Nominate them' }));
    expect(screen.getByRole('dialog', { name: 'Nominate someone' })).toBeInTheDocument();
  });

  it('shows more a page at a time, after the ones already there, and says how many are left', async () => {
    fetchPeople.mockResolvedValueOnce(answer([person(1), person(2)], { count: 5, hasMore: true, nextOffset: 2 }));
    mount();
    await screen.findByRole('heading', { name: 'Person 2' });
    fetchPeople.mockResolvedValueOnce(answer([person(3), person(4), person(5)], { count: 5, offset: 2 }));
    await userEvent.click(screen.getByRole('button', { name: 'Show more (3 left)' }));
    await screen.findByRole('heading', { name: 'Person 5' });
    expect(fetchPeople).toHaveBeenLastCalledWith({ role: 'founder', search: '' }, expect.objectContaining({ offset: 2 }));
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent).filter((t) => t.startsWith('Person'))).toEqual(['Person 1', 'Person 2', 'Person 3', 'Person 4', 'Person 5']);
    expect(screen.queryByRole('button', { name: /Show more/ })).not.toBeInTheDocument();
  });

  it('keeps what it has and says so when the next page cannot load', async () => {
    fetchPeople.mockResolvedValueOnce(answer([person(1)], { count: 4, hasMore: true, nextOffset: 1 }));
    mount();
    await screen.findByRole('heading', { name: 'Person 1' });
    fetchPeople.mockRejectedValueOnce(new Error('down'));
    await userEvent.click(screen.getByRole('button', { name: /Show more/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load more right now.');
    expect(screen.getByRole('heading', { name: 'Person 1' })).toBeInTheDocument();
  });

  it('says it could not load, and tries again on request', async () => {
    fetchPeople.mockRejectedValueOnce(new Error('down'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this right now.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Person 1' })).toBeInTheDocument();
  });

  it('goes back to the map from its bar', async () => {
    const onClose = vi.fn();
    mount({ onClose });
    await userEvent.click(await screen.findByRole('button', { name: '← Back to map' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('opens an investor\'s own page in the app, through the app\'s own hand-off', async () => {
    const onOpenInternal = vi.fn();
    fetchPeople.mockResolvedValue(answer([person(1, { href: '/investors/people/person-1', roleType: 'investor' })]));
    mount({ onOpenInternal });
    await userEvent.click(await screen.findByRole('link', { name: 'Person 1' }));
    expect(onOpenInternal).toHaveBeenCalledWith('/investors/people/person-1');
  });
});

describe('curated lists', () => {
  const LISTS = [
    { id: 'founders-to-follow', title: 'Founders to follow', description: 'Worth watching.', curator: 'Aryan', type: 'people', count: 2 },
    { id: 'picks', title: 'Company picks', description: null, curator: null, type: 'companies', count: 1 },
  ];
  const onList = (list, results, over = {}) => ({ list, total: results.length, count: results.length, results, offset: 0, limit: 20, hasMore: false, nextOffset: null, ...over });

  it('offers the lists that have someone on them, with how many, and none when there are none', async () => {
    fetchLists.mockResolvedValue({ results: LISTS });
    mount();
    const nav = await screen.findByRole('navigation', { name: 'Lists' });
    expect(within(nav).getAllByRole('button').map((b) => b.textContent.replace(/\s+/g, ' ').trim())).toEqual(['Founders to follow 2', 'Company picks 1']);
  });

  it('has no lists row when there are no lists', async () => {
    mount();
    await screen.findByRole('heading', { name: 'Person 1' });
    expect(screen.queryByRole('navigation', { name: 'Lists' })).not.toBeInTheDocument();
  });

  it('opens a list from its chip: the list\'s own title, description and curator, its people in its order, with a link to copy', async () => {
    fetchLists.mockResolvedValue({ results: LISTS });
    fetchList.mockResolvedValue(onList(LISTS[0], [person(2), person(1)]));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /Founders to follow/ }));
    const banner = await screen.findByRole('region', { name: 'List: Founders to follow' });
    expect(banner).toHaveTextContent('Worth watching.');
    expect(banner).toHaveTextContent('Curated by Aryan');
    expect(banner).toHaveTextContent('2 people');
    expect(fetchList).toHaveBeenCalledWith('founders-to-follow', expect.objectContaining({ limit: 20, offset: 0 }));
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent).filter((t) => t.startsWith('Person'))).toEqual(['Person 2', 'Person 1']);
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument(); // a list is its own page
    await waitFor(() => expect(window.location.search).toBe('?list=founders-to-follow'));
  });

  it('copies the list\'s address, in full, from "Copy link"', async () => {
    const writeText = vi.fn().mockResolvedValue();
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    fetchList.mockResolvedValue(onList(LISTS[0], [person(1)]));
    mount({ initialAddress: { tab: null, list: 'founders-to-follow', q: '' } });
    await userEvent.click(await screen.findByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/people?list=founders-to-follow`);
    expect(await screen.findByRole('button', { name: 'Link copied' })).toBeInTheDocument();
  });

  it('applies the list the address carries when it opens, and goes back to everyone from "All people"', async () => {
    fetchList.mockResolvedValue(onList(LISTS[0], [person(1)]));
    mount({ initialAddress: { tab: null, list: 'founders-to-follow', q: '' } });
    await screen.findByRole('region', { name: 'List: Founders to follow' });
    expect(fetchPeople).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'All people' }));
    expect(await screen.findAllByRole('tab')).toHaveLength(4);
    await waitFor(() => expect(window.location.search).toBe(''));
  });

  it('shows the companies of a list of companies, each opening in the app', async () => {
    const onOpenCompany = vi.fn();
    const company = { name: 'Canva', slug: 'canva', sector: 'SaaS', city: 'Sydney', stage: 'Series D+', blurb: 'Design.' };
    fetchList.mockResolvedValue(onList(LISTS[1], [company]));
    mount({ onOpenCompany, initialAddress: { tab: null, list: 'picks', q: '' } });
    await userEvent.click(await screen.findByRole('link', { name: 'Canva' }));
    expect(onOpenCompany).toHaveBeenCalledWith(company);
    expect(screen.getByText('SaaS · Sydney · Series D+')).toBeInTheDocument();
  });

  it('says there is no such list for an address that names none, and offers everyone', async () => {
    fetchList.mockRejectedValue(Object.assign(new Error('x'), { status: 404 }));
    mount({ initialAddress: { tab: null, list: 'nope', q: '' } });
    expect(await screen.findByText('There is no such list.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'See everyone' }));
    expect(await screen.findByRole('heading', { name: 'Person 1' })).toBeInTheDocument();
  });
});
