import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../src/api.js', () => ({
  fetchStartupPage: vi.fn(),
  fetchSummary: vi.fn(),
  fetchMarkers: vi.fn(),
  fetchCounts: vi.fn(),
  fetchPeople: vi.fn(),
  fetchInstitutions: vi.fn(),
  DIRECTORY_URL: '/directory',
}));

import { fetchStartupPage, fetchSummary, fetchMarkers, fetchCounts, fetchPeople, fetchInstitutions } from '../src/api.js';
import { curatedLists } from '../src/curatedLists.js';
import LandingPage from '../src/LandingPage.jsx';

const startup = (name, overrides = {}) => ({
  name, slug: name.toLowerCase(), sector: 'AI', city: 'Sydney', stage: 'Seed', hiring: true,
  website: 'https://example.com', taskGate: { enabled: false, type: null }, ...overrides,
});

const hero = () => screen.getByRole('region', { name: /startup ecosystem, mapped/ });

describe('LandingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchSummary.mockResolvedValue({ count: 213, pinned: 200, unverified: 13, hiring: 2, taskGated: 1, cities: 2 });
    fetchStartupPage.mockResolvedValue({
      results: [
        startup('Canva', { taskGate: { enabled: true, type: 'Design task' } }),
        startup('Airwallex', { sector: 'Fintech', city: 'Melbourne' }),
        startup('SafetyCulture'),
        startup('Culture Amp', { city: 'Melbourne' }),
        startup('Linktree', { city: 'Melbourne' }),
        startup('Zeller', { sector: 'Fintech' }),
        startup('Karbon', { city: 'Melbourne' }),
        startup('Sonder', { blurb: 'Employee care.' }),
      ],
    });
    fetchMarkers.mockResolvedValue({
      items: [['canva', 'Canva', -33.9, 151.2, 'SaaS', 'Sydney', 1, 'canva.com'], ['airwallex', 'Airwallex', -37.8, 144.9, 'Fintech', 'Melbourne', 1, '']],
      areas: [{ kind: 'CITY', label: 'Sydney', city: 'Sydney', lat: -33.87, lng: 151.21, count: 34 }],
    });
    fetchPeople.mockResolvedValue({ results: [], counts: { founders: 0, operators: 0, investors: 0, institutions: 0 } });
    fetchInstitutions.mockResolvedValue({ results: [] });
    fetchCounts.mockImplementation(async (sets) => ({ total: 213, counts: sets.map((filters) => (filters.hiring === 'yes' ? 2 : 7)) }));
  });

  describe('the hero', () => {
    it('says what the product is: the headline and the line under it', async () => {
      render(<LandingPage />);
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Australia’s startup ecosystem, mapped.');
      expect(hero()).toHaveTextContent('Discover startups, founders, investors and jobs across Australia — all in one place.');
    });

    it('has two calls to action and only two, going to the real app: the map, and the waitlist', async () => {
      render(<LandingPage />);
      const ctas = [...hero().querySelectorAll('.landing-cta-row a')];
      expect(ctas.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([['Explore the map', '/'], ['Join waitlist', '/?view=waitlist']]);
      // the closing call to action keeps the map first
      screen.getAllByRole('link', { name: 'Explore the map' }).forEach((link) => expect(link).toHaveAttribute('href', '/'));
    });

    it('has a minimal navigation: the map, the people and the lists, with a way into the app for each, and no sign-in because there are no accounts', async () => {
      render(<LandingPage />);
      const nav = screen.getByRole('navigation', { name: 'Main' });
      expect([...nav.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])).toEqual([['Map', '/'], ['People', '/people'], ['Lists', '/lists']]);
      // the header's pill, and the hero's second call to action, both open the same form
      screen.getAllByRole('link', { name: 'Join waitlist' }).forEach((link) => expect(link).toHaveAttribute('href', '/?view=waitlist'));
      expect(within(document.querySelector('.landing-nav')).getByRole('link', { name: 'Join waitlist' })).toBeInTheDocument();
      expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
      expect(document.getElementById('main').tagName).toBe('MAIN');
    });

    it('shows three figures under the headline, each with what it counts, worked out by the server', async () => {
      fetchSummary.mockResolvedValue({ count: 213, founders: 1234, hiring: 2, openRoles: 158 });
      const { container } = render(<LandingPage />);
      await screen.findByText('Startups tracked');
      const stats = [...container.querySelectorAll('.hero-stat')].map((li) => [li.querySelector('.hero-stat-num').textContent, li.querySelector('.hero-stat-label').textContent, li.querySelector('.hero-stat-def').textContent]);
      expect(stats).toEqual([
        ['213', 'Startups tracked', 'Companies in the directory.'],
        ['1,234', 'Founders named', 'People named as founders on a company record.'],
        ['158', 'Open roles', 'Read from the pages of the companies hiring now.'],
      ]);
      expect(fetchSummary).toHaveBeenCalledWith({}, { onSnapshot: expect.any(Function) });
    });

    it('puts a pill above the headline with a real count: the companies hiring now, else the startups tracked, else nothing', async () => {
      fetchSummary.mockResolvedValue({ count: 213, hiring: 21, openRoles: 158 });
      const first = render(<LandingPage />);
      await screen.findByText('Startups tracked');
      const badge = first.container.querySelector('.hero-badge');
      expect(badge).toHaveTextContent('21 companies hiring now');
      // it sits above the headline
      expect(badge.compareDocumentPosition(screen.getByRole('heading', { level: 1 })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      first.unmount();
      fetchSummary.mockResolvedValue({ count: 213, hiring: 1 });
      const one = render(<LandingPage />);
      await screen.findByText('Startups tracked');
      expect(one.container.querySelector('.hero-badge')).toHaveTextContent('1 company hiring now');
      one.unmount();
      // nothing confirmed lately: no zero, no fake count; the pill says what is true
      fetchSummary.mockResolvedValue({ count: 213, hiring: 0, openRoles: 0 });
      const none = render(<LandingPage />);
      await screen.findByText('Startups tracked');
      expect(none.container.querySelector('.hero-badge')).toHaveTextContent('213 startups tracked');
      expect(none.container.querySelector('.hero-stats')).not.toHaveTextContent('Open roles');
      none.unmount();
      fetchSummary.mockResolvedValue(null);
      const nothing = render(<LandingPage />);
      expect(nothing.container.querySelector('.hero-badge')).toBeNull();
    });

    it('shows "Updated <date>" directly under the subline', async () => {
      fetchSummary.mockResolvedValue({ count: 213, hiring: 2, lastVerifiedAt: '2026-10-13T04:29:43.000Z' });
      const { container } = render(<LandingPage />);
      await screen.findByText('Startups tracked');
      const lede = container.querySelector('.hero-lede');
      expect(lede.nextElementSibling).toBe(container.querySelector('.hero-updated'));
      expect(lede.nextElementSibling).toHaveTextContent('Updated 13 Oct 2026');
    });

    it('sets one word of the headline in italic, and gives the headline the display size', async () => {
      render(<LandingPage />);
      const title = screen.getByRole('heading', { level: 1 });
      expect([...title.querySelectorAll('em')].map((em) => em.textContent)).toEqual(['mapped.']);
    });

    it('says when the directory was last updated, from the data, and leaves it out when no company was ever checked', async () => {
      fetchSummary.mockResolvedValue({ count: 213, hiring: 2, lastVerifiedAt: '2026-10-05T15:12:14.342Z' });
      const { container, unmount } = render(<LandingPage />);
      await screen.findByText('Startups tracked');
      expect(container.querySelector('.hero-updated')).toHaveTextContent('Updated 6 Oct 2026');
      unmount();
      fetchSummary.mockResolvedValue({ count: 213, hiring: 2, lastVerifiedAt: null });
      const again = render(<LandingPage />);
      await screen.findByText('Startups tracked');
      expect(again.container.querySelector('.hero-updated')).toBeNull();
    });

    it('leaves out a figure the server did not send, or that is zero, rather than showing a zero', async () => {
      fetchSummary.mockResolvedValue({ count: 213, founders: 0 });
      const { container, unmount } = render(<LandingPage />);
      await screen.findByText('Startups tracked');
      expect([...container.querySelectorAll('.hero-stat-label')].map((l) => l.textContent)).toEqual(['Startups tracked']);
      expect(container.textContent).not.toMatch(/Founders named|Verified hiring/);
      unmount();
      fetchSummary.mockResolvedValue({ count: 0, founders: 0, hiring: 0 });
      const none = render(<LandingPage />);
      await waitFor(() => expect(fetchSummary).toHaveBeenCalledTimes(2));
      expect(none.container.querySelector('.hero-stats')).toBeNull();
    });

    it('draws the picture from the pins and groups the server sent, and names the companies it sent', async () => {
      const { container } = render(<LandingPage />);
      expect(await screen.findByRole('link', { name: 'Canva, Sydney, hiring now' })).toHaveAttribute('href', '/?view=list&search=Canva');
      expect(screen.getByRole('link', { name: 'Airwallex, Melbourne, hiring now' })).toBeInTheDocument();
      const labels = [...container.querySelectorAll('.eco-city')].map((li) => li.textContent.replace(/\s+/g, ' ').trim());
      expect(labels).toEqual(['Sydney 35 startups', 'Melbourne 1 startup']); // one pin and the city-level group of 34 in Sydney, one pin in Melbourne
      expect(container.querySelectorAll('.eco-dot')).toHaveLength(2);
    });
  });

  it('does not ask for the whole list: it asks for the companies that are hiring, the pins and counts', async () => {
    render(<LandingPage />);
    await screen.findByText('Startups tracked');
    // (each also passes onSnapshot: the first screen is drawn from the snapshot file when it holds the answer, and the server's replaces it)
    expect(fetchStartupPage).toHaveBeenCalledWith({ hiring: 'yes' }, { limit: 80, sort: 'file', onSnapshot: expect.any(Function) });
    expect(fetchMarkers).toHaveBeenCalledWith({}, { onSnapshot: expect.any(Function) });
  });

  const names = (container) => [...container.querySelectorAll('.landing-job-card .entity-name')].map((n) => n.textContent);

  it('shows six of the hiring companies the server sent, on the one card, and no task-gated tag: that is not a thing a company has opted in to', async () => {
    const { container } = render(<LandingPage />);
    await waitFor(() => expect(container.querySelectorAll('.landing-job-card')).toHaveLength(6));
    expect(names(container)).toEqual(['Canva', 'Airwallex', 'SafetyCulture', 'Culture Amp', 'Linktree', 'Zeller']);
    expect(screen.queryByText('Task-gated')).not.toBeInTheDocument();
    expect(container.querySelector('.landing-tag')).toBeNull();
    // the one card: a picture or initial, the name, and a row of what it is ("Sector · Stage · City")
    const first = container.querySelector('.landing-job-card');
    expect(first).toHaveClass('card', 'entity-card');
    expect(first.querySelector('.entity-initial')).toHaveTextContent('C');
    expect([...first.querySelectorAll('.meta-row li')].map((li) => li.textContent)).toEqual(['AI', 'Seed', 'Sydney']);
  });

  it('says on a hiring card when the company was last checked, and marks one nobody has verified: nothing for one that has no date or says nothing', async () => {
    const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
    fetchStartupPage.mockResolvedValue({
      results: [
        startup('Canva', { verified: true, last_verified_at: ago(2) }),
        startup('Airwallex', { verified: false, last_verified_at: ago(75) }),
        startup('SafetyCulture'),
      ],
    });
    const { container } = render(<LandingPage />);
    await waitFor(() => expect(container.querySelectorAll('.landing-job-card')).toHaveLength(3));
    const [canva, airwallex, safety] = container.querySelectorAll('.landing-job-card');
    expect(canva).toHaveTextContent('Verified 2 days ago');
    expect(canva.querySelector('.badge-unverified')).toBeNull();
    expect(airwallex).toHaveTextContent('Needs re-check');
    expect(airwallex.querySelector('.verified-note')).toHaveClass('verified-note-stale');
    expect(airwallex.querySelector('.badge-unverified')).toHaveTextContent('Unverified');
    expect(safety.querySelector('.verified-note')).toBeNull();
    expect(safety.querySelector('.badge-unverified')).toBeNull();
  });

  it('adds six more hiring companies each time "Load more" is pressed, says how many are left, and goes when there are no more', async () => {
    const { container } = render(<LandingPage />);
    await waitFor(() => expect(container.querySelectorAll('.landing-job-card')).toHaveLength(6));
    const more = screen.getByRole('button', { name: /Load more/ });
    expect(more).toHaveTextContent('(2 left)');
    more.click();
    await waitFor(() => expect(container.querySelectorAll('.landing-job-card')).toHaveLength(8));
    expect(names(container).slice(6)).toEqual(['Karbon', 'Sonder']);
    expect(screen.queryByRole('button', { name: /Load more/ })).not.toBeInTheDocument();
    expect(screen.getByText('See every open role →').closest('a')).toHaveAttribute('href', '/jobs');
  });

  it('gives a company\'s description on its card, at most two lines of it, and leaves the line out for a company with none', async () => {
    const { container } = render(<LandingPage />);
    await waitFor(() => expect(container.querySelectorAll('.landing-job-card')).toHaveLength(6));
    expect(container.querySelector('.landing-job-card .entity-blurb')).toBeNull(); // the first six have no description in the mock
    screen.getByRole('button', { name: /Load more/ }).click();
    await waitFor(() => expect(container.querySelectorAll('.landing-job-card')).toHaveLength(8));
    expect(container.querySelector('.landing-job-card .entity-blurb')).toHaveTextContent('Employee care.');
  });

  it('shows six curated lists, with counts from the server, counted with each list\'s own filters, not a hardcoded number', async () => {
    const { container } = render(<LandingPage />);
    const listName = (name) => screen.getByText(name, { selector: '.landing-list-name' }); // a name is also in the index above the cards
    expect(await screen.findByText('Australian Deeptech', { selector: '.landing-list-name' })).toBeInTheDocument();
    expect(container.querySelectorAll('.landing-list-card')).toHaveLength(6);
    // the seventh and later lists are not on the page (they are one click away, in the curated lists)
    expect(screen.queryByText('Sydney Startups', { selector: '.landing-list-name' })).not.toBeInTheDocument();
    expect(screen.queryByText('Task-gated only')).not.toBeInTheDocument();
    expect(listName('Australian AI Startups')).toBeInTheDocument();
    expect(listName('Startups Hiring Now')).toBeInTheDocument();
    await waitFor(() => expect(listName('Startups Hiring Now').closest('.landing-list-card')).toHaveTextContent('2 companies'));
    expect(listName('Australian AI Startups').closest('.landing-list-card')).toHaveTextContent('7 companies');
    // the six in ONE request, in the lists' order, each counted with the list's own filters
    expect(fetchCounts).toHaveBeenCalledTimes(1);
    expect(fetchCounts.mock.calls[0][0]).toEqual(curatedLists.filter((l) => l.type === 'filter').slice(0, 6).map((l) => l.filters));
  });

  describe('the sections', () => {
    it('numbers the main sections in the order they run, in small labels, and skips none', async () => {
      const { container } = render(<LandingPage />);
      const rules = [...container.querySelectorAll('.sec-rule')].map((r) => [r.querySelector('.sec-no').textContent, r.querySelector('.sec-name').textContent]);
      expect(rules).toEqual([['01', 'Map'], ['02', 'Lists'], ['03', 'How we verify']]);
      container.querySelectorAll('.sec-rule').forEach((r) => expect(r).toHaveAttribute('aria-hidden', 'true')); // the heading names the section for everyone else
    });

    it('has a People section, numbered 02, when someone is listed, and then the lists are 03 and how we verify 04', async () => {
      fetchPeople.mockResolvedValue({ results: [
        { id: 'ada', name: 'Ada Example', type: 'person', roleType: 'founder', title: 'Co-founder', orgName: 'Example Co', whyFollow: 'Built a thing.', links: {}, sources: [], verifiedAt: null, vouches: [] },
        { id: 'bea', name: 'Bea Builder', type: 'person', roleType: 'operator', title: 'COO', orgName: 'Widgets', links: {}, sources: [], verifiedAt: null, vouches: [] },
      ] });
      const { container } = render(<LandingPage />);
      await screen.findByRole('heading', { name: 'People worth following.' });
      expect([...container.querySelectorAll('.sec-rule')].map((r) => r.textContent)).toEqual(['01Map', '02People', '03Lists', '04How we verify']);
      expect([...container.querySelectorAll('.landing-people-grid .entity-name')].map((n) => n.textContent)).toEqual(['Ada Example', 'Bea Builder']);
      expect(container.querySelector('.landing-people-grid .entity-name').tagName).toBe('H3');
      // a person on the one card: an initial (never a picture), the name, why they are worth following, and a row of who they are
      const ada = container.querySelector('#person-ada');
      expect(ada).toHaveClass('card', 'entity-card');
      expect(ada.querySelector('.entity-initial')).toHaveTextContent('A');
      expect(ada.querySelector('img')).toBeNull();
      expect(ada.querySelector('.entity-blurb')).toHaveTextContent('Built a thing.');
      expect([...ada.querySelectorAll('.meta-row li')].map((li) => li.textContent)).toEqual(['Co-founder', 'Example Co']);
      expect(screen.getByText('See everyone →').closest('a')).toHaveAttribute('href', '/people');
      expect(fetchPeople).toHaveBeenCalledWith({}, { limit: 3 });
      expect(fetchInstitutions).not.toHaveBeenCalled(); // people are shown, so the firms are not asked for
    });

    it('keeps the People section as 02 when no one is listed, by showing the firms published in the investor directory on the same card', async () => {
      fetchInstitutions.mockResolvedValue({ results: [
        { id: 'investor-blackbird', name: 'Blackbird', type: 'institution', city: 'Sydney', stageFocus: 'Seed', sectors: ['Technology'], website: 'https://www.blackbird.vc', sources: [{ label: 'Blackbird', url: 'https://www.blackbird.vc' }], verifiedAt: null, href: '/investors/blackbird' },
        { id: 'investor-airtree', name: 'AirTree', type: 'institution', city: 'Sydney', stageFocus: 'Seed, Growth', sectors: [], website: null, sources: [], verifiedAt: null, href: '/investors/airtree' },
      ] });
      const { container } = render(<LandingPage />);
      await screen.findByRole('heading', { name: 'People and firms worth following.' });
      expect([...container.querySelectorAll('.sec-rule')].map((r) => r.textContent)).toEqual(['01Map', '02People', '03Lists', '04How we verify']);
      expect([...container.querySelectorAll('.landing-people-grid .entity-name')].map((n) => n.textContent)).toEqual(['Blackbird', 'AirTree']);
      const blackbird = container.querySelector('#institution-investor-blackbird');
      expect(blackbird).toHaveClass('card', 'entity-card');
      expect([...blackbird.querySelectorAll('.meta-row li')].map((li) => li.textContent)).toEqual(['Technology', 'Seed', 'Sydney']);
      expect(blackbird.querySelector('.entity-blurb')).toBeNull(); // no description has been written for a firm, and none is made up
      expect(fetchInstitutions).toHaveBeenCalledWith({}, { limit: 3 });
    });

    it('with the people switched off asks for no person and no firm, draws no People section, no People link in the bar, and the numbers close the gap', async () => {
      vi.stubEnv('VITE_SHOW_PEOPLE', '');
      fetchPeople.mockResolvedValue({ results: [{ id: 'ada-example', name: 'Ada Example', type: 'person', roleType: 'founder', title: 'Co-founder', orgName: 'Example Co', sources: [], vouches: [] }], counts: {} });
      fetchInstitutions.mockResolvedValue({ results: [{ id: 'investor-blackbird', name: 'Blackbird', type: 'institution', sources: [] }] });
      const { container } = render(<LandingPage />);
      await waitFor(() => expect(container.querySelectorAll('.landing-job-card')).toHaveLength(6));
      expect(fetchPeople).not.toHaveBeenCalled();
      expect(fetchInstitutions).not.toHaveBeenCalled();
      expect(screen.queryByRole('heading', { name: /worth following/ })).not.toBeInTheDocument();
      expect(container.textContent).not.toMatch(/Ada Example|Blackbird|See everyone/);
      expect([...container.querySelectorAll('.sec-rule')].map((r) => r.textContent)).toEqual(['01Map', '02Lists', '03How we verify']);
      const nav = screen.getByRole('navigation', { name: 'Main' });
      expect([...nav.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])).toEqual([['Map', '/'], ['Lists', '/lists']]);
    });

    it('has no People section when there are neither people nor firms, and does not leave a gap in the numbers', async () => {
      const { container } = render(<LandingPage />);
      await waitFor(() => expect(fetchInstitutions).toHaveBeenCalled());
      expect(screen.queryByRole('heading', { name: /worth following/ })).not.toBeInTheDocument();
      expect([...container.querySelectorAll('.sec-rule')].map((r) => r.textContent)).toEqual(['01Map', '02Lists', '03How we verify']);
    });

    it('opens the lists and the hiring cards with an index of names that jump to their cards', async () => {
      const { container } = render(<LandingPage />);
      await waitFor(() => expect(container.querySelectorAll('.landing-job-card')).toHaveLength(6));
      const indexes = screen.getAllByRole('navigation', { name: /^Index of/ });
      expect(indexes.map((n) => n.getAttribute('aria-label'))).toEqual(['Index of the companies hiring', 'Index of the curated lists']);
      const hiring = within(indexes[0]).getAllByRole('link').map((a) => a.textContent);
      expect(hiring).toEqual(['Canva', 'Airwallex', 'SafetyCulture', 'Culture Amp', 'Linktree', 'Zeller']);
      const first = within(indexes[0]).getByRole('link', { name: 'Jump to Canva' });
      expect(document.getElementById(first.getAttribute('href').slice(1))).toBe(container.querySelector('.landing-job-card'));
      const lists = within(indexes[1]).getAllByRole('link');
      expect(lists).toHaveLength(6); // all six lists on the page, and no "+ more": there is nothing left out of the index
      expect(indexes[1]).not.toHaveTextContent(/\+\d+ more/);
    });

    it('makes each hiring card a link to the company and each list card a link to the list, so a card that lifts on hover goes somewhere', async () => {
      const { container } = render(<LandingPage />);
      await waitFor(() => expect(container.querySelectorAll('.landing-job-card')).toHaveLength(6));
      expect(container.querySelector('.landing-job-card').tagName).toBe('A');
      expect(container.querySelector('.landing-job-card')).toHaveAttribute('href', '/startup/canva');
      expect(container.querySelector('.landing-list-card').tagName).toBe('A');
      expect(container.querySelector('.landing-list-card')).toHaveAttribute('href', `/lists/${curatedLists.find((l) => l.type === 'filter').id}`);
    });

    it('never hides content from a visitor who cannot be shown it rising: with no way to watch the screen, everything is there at once', async () => {
      const { container } = render(<LandingPage />);
      await waitFor(() => expect(container.querySelectorAll('.landing-job-card')).toHaveLength(6));
      expect(container.querySelectorAll('.reveal:not(.is-in)')).toHaveLength(0);
    });

    it('says how it verifies in three short statements, and does not claim a source it does not read', async () => {
      const { container } = render(<LandingPage />);
      const verify = container.querySelector('#verify');
      expect([...verify.querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['Where it comes from', 'What “hiring now” means', 'Who reviews it']);
      for (const dd of verify.querySelectorAll('dd')) expect(dd.textContent.length, dd.textContent).toBeLessThan(260);
      expect(verify.textContent).toContain('last 14 days');
      expect(container.textContent).not.toMatch(/LinkedIn|Crunchbase/);
    });
  });

  it('deep-links into Jobs and Curated lists inside the real app', async () => {
    render(<LandingPage />);
    expect(screen.getByText('See every open role →').closest('a')).toHaveAttribute('href', '/jobs');
    expect(screen.getByText('Open curated lists →').closest('a')).toHaveAttribute('href', '/lists');
  });

  describe('the footer', () => {
    it('is four short columns of links, each going to a real address, and who built it', async () => {
      const { container } = render(<LandingPage />);
      const columns = [...container.querySelectorAll('.footer-column')].map((c) => [c.querySelector('.footer-title').textContent, [...c.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])]);
      expect(columns.map(([title]) => title)).toEqual(['Explore', 'Directory', 'Take part', 'Trust']);
      expect(columns[0][1]).toEqual([['Map', '/'], ['People', '/people'], ['Lists', '/lists'], ['Jobs', '/jobs']]);
      expect(columns[1][1]).toEqual([['Investors', '/investors'], ['News', '/news'], ['Full list, no JavaScript', '/directory']]);
      expect(columns[2][1]).toEqual([['Submit a startup', '/?view=submit'], ['Join waitlist', '/?view=waitlist'], ['Nominate someone', '/people']]);
      expect(columns[3][1]).toEqual([['How we verify', '#verify'], ['Privacy', '#privacy'], ['Terms', '#terms']]);
      for (const [, links] of columns) expect(links.length).toBeLessThanOrEqual(4);
      expect(container.querySelector('.footer-built')).toHaveTextContent('Built by Aryan · Monash University');
    });

    it('has no People link and no "Nominate someone" with the people switched off, and a column of three where there were four', async () => {
      vi.stubEnv('VITE_SHOW_PEOPLE', '');
      const { container } = render(<LandingPage />);
      const columns = [...container.querySelectorAll('.footer-column')].map((c) => [...c.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]));
      expect(columns[0]).toEqual([['Map', '/'], ['Lists', '/lists'], ['Jobs', '/jobs']]);
      expect(columns[2]).toEqual([['Submit a startup', '/?view=submit'], ['Join waitlist', '/?view=waitlist']]);
      expect(container.querySelector('.landing-footer').innerHTML).not.toContain('/people');
    });

    it('has no long paragraphs: the legal notes are short and closed until asked for', async () => {
      const { container } = render(<LandingPage />);
      const footer = container.querySelector('.landing-footer');
      for (const p of footer.querySelectorAll('p')) expect(p.textContent.length, p.textContent).toBeLessThan(330);
      expect(container.querySelector('details#privacy')).not.toHaveAttribute('open');
      expect(container.querySelector('details#terms')).not.toHaveAttribute('open');
    });

    it('opens a legal note when its link is followed', async () => {
      window.location.hash = '#terms';
      const { container } = render(<LandingPage />);
      await waitFor(() => expect(container.querySelector('details#terms')).toHaveAttribute('open'));
      expect(container.querySelector('details#privacy')).not.toHaveAttribute('open');
      window.location.hash = '';
    });

    it('flags business details as an unfilled draft rather than inventing them, in both Privacy and Terms', async () => {
      render(<LandingPage />);
      expect(screen.getByText(/operator.s name and contact details are not published yet/)).toBeInTheDocument();
      expect(screen.getByText(/Draft: not yet reviewed by a lawyer/)).toBeInTheDocument();
    });

    it('says in its privacy text that the waitlist form is hosted by Tally', async () => {
      render(<LandingPage />);
      expect(screen.getByText(/The waitlist is\s+a form hosted by Tally/)).toBeInTheDocument();
    });
  });

  it('still says what it is, without the live numbers, if the counts cannot be fetched', async () => {
    fetchSummary.mockRejectedValue(new Error('network error'));
    const { container } = render(<LandingPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Australia’s startup ecosystem, mapped.');
    expect(await screen.findByText(/A company is listed as hiring now once a job page of its own has confirmed its open roles within the last 14 days/)).toBeInTheDocument();
    expect(container.querySelector('.hero-stats')).toBeNull();
  });

  it('still shows the rest of the page, and draws no startup it was not told about, when the pins or a count cannot be fetched', async () => {
    fetchMarkers.mockRejectedValue(new Error('down'));
    fetchCounts.mockRejectedValue(new Error('down'));
    const { container } = render(<LandingPage />);
    expect(await screen.findByText('Startups tracked')).toBeInTheDocument();
    expect(container.querySelectorAll('.eco-dot, .eco-city, .eco-chip')).toHaveLength(0);
    expect(screen.queryByText(/Each dot/)).not.toBeInTheDocument();
    expect(container.querySelector('.eco-grid')).not.toBeNull(); // the country in dots is only a drawing
    expect(screen.getByText('Start exploring.')).toBeInTheDocument();
  });
});
