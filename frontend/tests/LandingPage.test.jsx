import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../src/api.js', () => ({
  fetchStartupPage: vi.fn(),
  fetchSummary: vi.fn(),
  fetchMarkers: vi.fn(),
  fetchCount: vi.fn(),
  DIRECTORY_URL: '/directory',
}));

import { fetchStartupPage, fetchSummary, fetchMarkers, fetchCount } from '../src/api.js';
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
    fetchCount.mockImplementation(async (filters) => ({ total: 213, count: filters.hiring === 'yes' ? 2 : 7 }));
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

    it('shows real, live counts under the buttons, worked out by the server', async () => {
      const { container } = render(<LandingPage />);
      await screen.findByText('213 startups');
      expect(container.querySelector('.hero-facts')).toHaveTextContent('213 startups');
      expect(container.querySelector('.hero-facts')).toHaveTextContent('2 hiring now');
      expect(fetchSummary).toHaveBeenCalledWith({});
    });

    it('leaves out a count the server did not send, rather than showing a zero', async () => {
      fetchSummary.mockResolvedValue({ count: 213 });
      const { container } = render(<LandingPage />);
      await screen.findByText('213 startups');
      expect(container.querySelector('.hero-facts')).not.toHaveTextContent('hiring');
      expect(container.querySelector('.hero-facts-hiring')).toBeNull();
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
    await screen.findByText('213 startups');
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
    expect(await screen.findByText('Sydney Startups')).toBeInTheDocument();
    expect(screen.queryByText('Task-gated only')).not.toBeInTheDocument();
    expect(screen.getByText('Melbourne AI startups')).toBeInTheDocument();
    expect(screen.getByText('Startups Hiring Now')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Startups Hiring Now').closest('.landing-list-card')).toHaveTextContent('2 companies'));
    expect(screen.getByText('Melbourne AI startups').closest('.landing-list-card')).toHaveTextContent('7 companies');
    for (const list of curatedLists.filter((l) => l.type === 'filter')) expect(fetchCount).toHaveBeenCalledWith(list.filters);
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
    expect(container.querySelector('.hero-facts')).toBeNull();
  });

  it('still shows the rest of the page, and draws no startup it was not told about, when the pins or a count cannot be fetched', async () => {
    fetchMarkers.mockRejectedValue(new Error('down'));
    fetchCount.mockRejectedValue(new Error('down'));
    const { container } = render(<LandingPage />);
    expect(await screen.findByText('213 startups')).toBeInTheDocument();
    expect(container.querySelectorAll('.eco-dot, .eco-city, .eco-chip')).toHaveLength(0);
    expect(screen.queryByText(/Each dot/)).not.toBeInTheDocument();
    expect(container.querySelector('.eco-grid')).not.toBeNull(); // the country in dots is only a drawing
    expect(screen.getByText('Start exploring.')).toBeInTheDocument();
  });
});
