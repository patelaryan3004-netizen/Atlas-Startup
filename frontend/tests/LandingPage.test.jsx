import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../src/api.js', () => ({
  fetchStartupPage: vi.fn(),
  fetchSummary: vi.fn(),
  fetchMarkers: vi.fn(),
  fetchCounts: vi.fn(),
  fetchPeople: vi.fn(),
  DIRECTORY_URL: '/directory',
}));

import { fetchStartupPage, fetchSummary, fetchMarkers, fetchCounts, fetchPeople } from '../src/api.js';
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
      ],
    });
    fetchMarkers.mockResolvedValue({
      items: [['canva', 'Canva', -33.9, 151.2, 'SaaS', 'Sydney', 1, 'canva.com'], ['airwallex', 'Airwallex', -37.8, 144.9, 'Fintech', 'Melbourne', 1, '']],
      areas: [{ kind: 'CITY', label: 'Sydney', city: 'Sydney', lat: -33.87, lng: 151.21, count: 34 }],
    });
    fetchPeople.mockResolvedValue({ results: [], counts: { founders: 0, operators: 0, investors: 0, institutions: 0 } });
    fetchCounts.mockImplementation(async (sets) => ({ total: 213, counts: sets.map((filters) => (filters.hiring === 'yes' ? 2 : 7)) }));
  });

  describe('the hero', () => {
    it('says what the product is: the headline and the line under it', async () => {
      render(<LandingPage />);
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Australia’s startup ecosystem, mapped.');
      expect(hero()).toHaveTextContent('Discover startups, founders, investors and jobs across Australia — all in one place.');
    });

    it('has two calls to action, both going to the real app', async () => {
      render(<LandingPage />);
      expect(within(hero()).getByRole('link', { name: 'Explore the map' })).toHaveAttribute('href', '/');
      expect(within(hero()).getByRole('link', { name: 'Browse startups' })).toHaveAttribute('href', '/?view=list');
      // the closing call to action says the same
      screen.getAllByRole('link', { name: 'Explore the map' }).forEach((link) => expect(link).toHaveAttribute('href', '/'));
      screen.getAllByRole('link', { name: 'Browse startups' }).forEach((link) => expect(link).toHaveAttribute('href', '/?view=list'));
    });

    it('has a minimal navigation with a way into the app for each name, and no sign-in because there are no accounts', async () => {
      render(<LandingPage />);
      const nav = screen.getByRole('navigation', { name: 'Main' });
      expect(within(nav).getByRole('link', { name: 'Discover' })).toHaveAttribute('href', '/');
      expect(within(nav).getByRole('link', { name: 'Lists' })).toHaveAttribute('href', '/?view=lists');
      expect(within(nav).getByRole('link', { name: 'Jobs' })).toHaveAttribute('href', '/?view=jobs');
      expect(screen.getByRole('link', { name: 'Join waitlist' })).toHaveAttribute('href', '/?view=waitlist');
      expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
      expect(document.getElementById('main').tagName).toBe('MAIN');
    });

    it('shows three figures under the headline, each with what it counts, worked out by the server', async () => {
      fetchSummary.mockResolvedValue({ count: 213, founders: 1234, hiring: 2 });
      const { container } = render(<LandingPage />);
      await screen.findByText('Startups tracked');
      const stats = [...container.querySelectorAll('.hero-stat')].map((li) => [li.querySelector('.hero-stat-num').textContent, li.querySelector('.hero-stat-label').textContent, li.querySelector('.hero-stat-def').textContent]);
      expect(stats).toEqual([
        ['213', 'Startups tracked', 'Companies in the directory.'],
        ['1,234', 'Founders named', 'People named as founders on a company record.'],
        ['2', 'Verified hiring', 'Companies whose open roles we checked on their own pages.'],
      ]);
      expect(fetchSummary).toHaveBeenCalledWith({});
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
    expect(fetchStartupPage).toHaveBeenCalledWith({ hiring: 'yes' }, { limit: 80, sort: 'file' });
    expect(fetchMarkers).toHaveBeenCalledWith({});
  });

  it('shows the first four hiring companies the server sent as job cards, and no task-gated tag: that is not a thing a company has opted in to', async () => {
    const { container } = render(<LandingPage />);
    await waitFor(() => expect(container.querySelectorAll('.landing-job-card')).toHaveLength(4));
    const cards = [...container.querySelectorAll('.landing-job-card')].map((card) => card.querySelector('.landing-job-name').textContent);
    expect(cards).toEqual(['Canva', 'Airwallex', 'SafetyCulture', 'Culture Amp']);
    expect(screen.queryByText('Task-gated')).not.toBeInTheDocument();
    expect(container.querySelector('.landing-tag')).toBeNull();
  });

  it('takes curated list counts from the server, counted with each list\'s own filters, not a hardcoded number', async () => {
    render(<LandingPage />);
    const listName = (name) => screen.getByText(name, { selector: '.landing-list-name' }); // a name is also in the index above the cards
    expect(await screen.findByText('Sydney Startups', { selector: '.landing-list-name' })).toBeInTheDocument();
    expect(screen.queryByText('Task-gated only')).not.toBeInTheDocument();
    expect(listName('Melbourne AI startups')).toBeInTheDocument();
    expect(listName('Startups Hiring Now')).toBeInTheDocument();
    await waitFor(() => expect(listName('Startups Hiring Now').closest('.landing-list-card')).toHaveTextContent('2 companies'));
    expect(listName('Melbourne AI startups').closest('.landing-list-card')).toHaveTextContent('7 companies');
    // every list in ONE request, in the lists' order, each counted with the list's own filters
    expect(fetchCounts).toHaveBeenCalledTimes(1);
    expect(fetchCounts.mock.calls[0][0]).toEqual(curatedLists.filter((l) => l.type === 'filter').map((l) => l.filters));
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
      expect([...container.querySelectorAll('.landing-people-grid .person-name')].map((n) => n.textContent)).toEqual(['Ada Example', 'Bea Builder']);
      expect(container.querySelector('.landing-people-grid .person-name').tagName).toBe('H3');
      expect(screen.getByText('See everyone →').closest('a')).toHaveAttribute('href', '/people');
      expect(fetchPeople).toHaveBeenCalledWith({}, { limit: 3 });
    });

    it('has no People section when no one is listed, and does not leave a gap in the numbers', async () => {
      const { container } = render(<LandingPage />);
      await waitFor(() => expect(fetchPeople).toHaveBeenCalled());
      expect(screen.queryByRole('heading', { name: 'People worth following.' })).not.toBeInTheDocument();
      expect([...container.querySelectorAll('.sec-rule')].map((r) => r.textContent)).toEqual(['01Map', '02Lists', '03How we verify']);
    });

    it('opens the lists and the hiring cards with an index of names that jump to their cards', async () => {
      const { container } = render(<LandingPage />);
      await waitFor(() => expect(container.querySelectorAll('.landing-job-card')).toHaveLength(4));
      const indexes = screen.getAllByRole('navigation', { name: /^Index of/ });
      expect(indexes.map((n) => n.getAttribute('aria-label'))).toEqual(['Index of the companies hiring', 'Index of the curated lists']);
      const hiring = within(indexes[0]).getAllByRole('link').map((a) => a.textContent);
      expect(hiring).toEqual(['Canva', 'Airwallex', 'SafetyCulture', 'Culture Amp']);
      const first = within(indexes[0]).getByRole('link', { name: 'Jump to Canva' });
      expect(document.getElementById(first.getAttribute('href').slice(1))).toBe(container.querySelector('.landing-job-card'));
      const lists = within(indexes[1]).getAllByRole('link');
      expect(lists).toHaveLength(6); // short: the first six, then how many more
      expect(indexes[1]).toHaveTextContent(/\+\d+ more/);
    });

    it('makes each hiring card a link to the company and each list card a link to the list, so a card that lifts on hover goes somewhere', async () => {
      const { container } = render(<LandingPage />);
      await waitFor(() => expect(container.querySelectorAll('.landing-job-card')).toHaveLength(4));
      expect(container.querySelector('.landing-job-card').tagName).toBe('A');
      expect(container.querySelector('.landing-job-card')).toHaveAttribute('href', '/startup/canva');
      expect(container.querySelector('.landing-list-card').tagName).toBe('A');
      expect(container.querySelector('.landing-list-card')).toHaveAttribute('href', `/lists/${curatedLists.find((l) => l.type === 'filter').id}`);
    });

    it('never hides content from a visitor who cannot be shown it rising: with no way to watch the screen, everything is there at once', async () => {
      const { container } = render(<LandingPage />);
      await waitFor(() => expect(container.querySelectorAll('.landing-job-card')).toHaveLength(4));
      expect(container.querySelectorAll('.reveal:not(.is-in)')).toHaveLength(0);
    });
  });

  it('deep-links into Jobs and Curated lists inside the real app', async () => {
    render(<LandingPage />);
    expect(screen.getByText('See every open role →').closest('a')).toHaveAttribute('href', '/?view=jobs');
    expect(screen.getByText('Open curated lists →').closest('a')).toHaveAttribute('href', '/?view=lists');
  });

  it('flags business details as an unfilled draft rather than inventing them, in both Privacy and Terms', async () => {
    render(<LandingPage />);
    expect(screen.getByText(/Placeholder: operator name, ABN/)).toBeInTheDocument();
    expect(screen.getByText(/Draft, for review before this site is public/)).toBeInTheDocument();
    expect(screen.getByText('Full list (no JS)').closest('a')).toHaveAttribute('href', '/directory');
  });

  it('says in its privacy text that the waitlist form is hosted by Tally', async () => {
    render(<LandingPage />);
    expect(screen.getByText('The waitlist.')).toBeInTheDocument();
    expect(screen.getByText(/opens a form hosted by Tally/)).toBeInTheDocument();
  });

  it('still says what it is, without the live numbers, if the counts cannot be fetched', async () => {
    fetchSummary.mockRejectedValue(new Error('network error'));
    const { container } = render(<LandingPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Australia’s startup ecosystem, mapped.');
    expect(await screen.findByText(/A company is listed as hiring once its open roles have been checked against its own pages/)).toBeInTheDocument();
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
