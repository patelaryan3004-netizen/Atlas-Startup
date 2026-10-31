import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../src/api.js', () => ({
  submitFeedback: vi.fn(),
  DIRECTORY_URL: '/directory',
}));

import { submitFeedback } from '../src/api.js';
import LandingPage from '../src/LandingPage.jsx';

const headings = (level) => screen.getAllByRole('heading', { level }).map((h) => h.textContent);

describe('the welcome page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    submitFeedback.mockResolvedValue({ id: '1', type: 'subscribe' });
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('reads nothing from the server when it opens: its words are fixed, so what the build wrote is what the browser draws', () => {
    render(<LandingPage />);
    expect(submitFeedback).not.toHaveBeenCalled();
  });

  it('opens on the headline, over a picture with no words in it that screen readers skip', () => {
    const { container } = render(<LandingPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('The next big thingis someone.');
    expect(container.querySelector('h1 em')).toHaveTextContent('someone.');
    const art = container.querySelector('.se-hero-art img');
    expect(art).toHaveAttribute('src', '/img/hero-night.webp');
    expect(art).toHaveAttribute('alt', '');
    expect(art).toHaveAttribute('width', '3200');
    expect(art).toHaveAttribute('height', '2158');
    expect(art).toHaveAttribute('fetchpriority', 'high');
    expect(container.querySelector('.se-hero-art source')).toHaveAttribute('srcset', '/img/hero-night-sm.webp'); // the narrow file for a phone
    const constellation = container.querySelector('.se-hero-constellation');
    expect(constellation).toHaveAttribute('aria-hidden', 'true'); // decoration: drawn live, said by nobody
    expect(constellation.querySelectorAll('circle').length).toBeGreaterThan(20);
    expect(screen.getByText('Australia’s startup community')).toBeInTheDocument();
    expect(screen.getByText(/Join our feed for fresh ideas, meaningful connections,/)).toBeInTheDocument();
    expect(screen.getByText(/and a shared journey through what comes next\./)).toBeInTheDocument();
  });

  it('has its sections in the order of the design, each named by its own heading', () => {
    render(<LandingPage />);
    expect(headings(2).map((t) => t.replace(/\s+/g, ' '))).toEqual([
      'Find your people.Start something.',
      'Make room forwhat you could become.',
      'Show your work.Meet the founder.',
      'Stay inspired. Keep building.',
    ]);
    expect(headings(3).map((t) => t.replace(/\s+/g, ' '))).toEqual([
      'Let your work introduce you.', 'Meet peopleworth knowing.', 'Followyour curiosity.', 'Keep your bestdiscoveries.',
    ]);
    expect(screen.getByText('Good things start with people')).toBeInTheDocument();
    expect(screen.getByText('Your work, your interests, and the people you build with.')).toBeInTheDocument();
    expect(screen.getByText('Fresh projects. People to know. Opportunities to start.')).toBeInTheDocument();
  });

  describe('the capsule', () => {
    it('has the wordmark, the places (with the map as one of them) and the two ways in, each going somewhere real', () => {
      vi.stubEnv('VITE_SHOW_PEOPLE', '');
      render(<LandingPage />);
      const nav = within(screen.getAllByRole('navigation', { name: 'Main' })[0]);
      expect(nav.getByRole('link', { name: 'Still Early, home' })).toHaveAttribute('href', '/');
      expect(nav.getByRole('link', { name: 'Still Early, home' })).toHaveTextContent('still early.');
      expect(nav.getAllByRole('link', { name: 'People' })[0]).toHaveAttribute('href', '/investors'); // the people page is switched off: the directory of investors is the live one
      expect(nav.getAllByRole('link', { name: 'Companies' })[0]).toHaveAttribute('href', '/discover');
      expect(nav.getAllByRole('link', { name: 'Map' })[0]).toHaveAttribute('href', '/map');
      expect(nav.getAllByRole('link', { name: 'Our story' })[0]).toHaveAttribute('href', '/about');
      expect(nav.getAllByRole('link', { name: 'Log in' })[0]).toHaveAttribute('href', '#login');
      expect(nav.getByRole('link', { name: 'Join us' })).toHaveAttribute('href', '#join');
    });

    it('goes to the people page when it is switched on', () => {
      vi.stubEnv('VITE_SHOW_PEOPLE', 'true');
      render(<LandingPage />);
      expect(within(screen.getAllByRole('navigation', { name: 'Main' })[0]).getAllByRole('link', { name: 'People' })[0]).toHaveAttribute('href', '/people');
    });

    it('folds the places into a menu that works with no script (a details element), keeping Join us beside it', () => {
      const { container } = render(<LandingPage />);
      const menu = container.querySelector('details.se-nav-menu');
      expect(menu).toBeInTheDocument();
      expect(menu.querySelector('summary')).toHaveAttribute('aria-label', 'Menu');
      expect([...menu.querySelectorAll('a')].map((a) => a.textContent)).toEqual(['People', 'Companies', 'Map', 'Our story', 'Log in']);
    });
  });

  describe('the ways into the community', () => {
    it('opens the community with no sign-up: both "Explore the community" go to the map', () => {
      render(<LandingPage />);
      const links = screen.getAllByRole('link', { name: /Explore the community/ });
      expect(links).toHaveLength(2);
      for (const link of links) expect(link).toHaveAttribute('href', '/map');
    });

    it('says the feed is not there yet, and sends "Explore the feed" to the news feed that is', () => {
      render(<LandingPage />);
      expect(screen.getByRole('link', { name: /Explore the feed/ })).toHaveAttribute('href', '/news');
      expect(screen.getByText('The community feed is still being built. The news feed is live.')).toBeInTheDocument();
    });

    it('has a note that there is no log-in yet, shown when "Log in" is followed (CSS :target) and written in the page for a screen reader to find', () => {
      const { container } = render(<LandingPage />);
      const note = container.querySelector('#login');
      expect(note).toHaveTextContent('Accounts are not open yet');
      expect(note).toHaveTextContent('nothing to log in to');
      expect(container.querySelector('#join')).toBeInTheDocument();
    });
  });

  describe('the previews are previews', () => {
    it('hides each from a screen reader and from the keyboard and the mouse, and holds nothing that could be pressed', () => {
      const { container } = render(<LandingPage />);
      const previews = [...container.querySelectorAll('[data-preview]')];
      expect(previews.length).toBe(8); // the introduction's pair of cards, the four panels and the three hiring cards
      for (const preview of previews) {
        expect(preview).toHaveAttribute('aria-hidden', 'true');
        expect(preview).toHaveAttribute('inert');
        expect(preview.querySelectorAll('a,button,input,select,textarea,[tabindex]'), preview.className).toHaveLength(0);
      }
    });

    it('gives a screen reader one sentence for each group of them, and says in words, three times, that they are illustrations', () => {
      render(<LandingPage />);
      expect(screen.getByText(/An illustration of the community: a search across people, startups and investors/)).toBeInTheDocument();
      expect(screen.getByText(/An illustration of a portfolio with tabs/)).toBeInTheDocument();
      expect(screen.getByText('Preview: the names and the work are illustrations.')).toBeInTheDocument();
      expect(screen.getByText('Preview: the names, the work and the pictures are illustrations.')).toBeInTheDocument();
      expect(screen.getByText(/Coming next, not live yet: the buttons in these previews do nothing, and no application or message can be sent\./)).toBeInTheDocument();
      expect(screen.getByText('Product preview · Illustrative content')).toBeInTheDocument();
    });

    it('presents hiring as coming next, as an ordered list of three stages whose words are real', () => {
      render(<LandingPage />);
      expect(screen.getByText('Hiring · Coming next')).toBeInTheDocument();
      const list = screen.getByRole('list', { name: /How hiring will work\. Coming next: not available yet\./ });
      const stages = within(list).getAllByRole('listitem');
      expect(stages).toHaveLength(3);
      expect(stages[0]).toHaveTextContent('Explore the role');
      expect(stages[1]).toHaveTextContent('Share a work sample');
      expect(stages[2]).toHaveTextContent('Meet the founder');
    });

    it('invents no testimonial, member count, score or endorsement', () => {
      const { container } = render(<LandingPage />);
      const text = container.textContent;
      expect(text).not.toMatch(/\d+\s*(members|people|founders|startups|investors)\b/i);
      expect(text).not.toMatch(/testimonial|% match|compatib|endorse|trusted by|loved by/i);
    });
  });

  describe('the foot', () => {
    it('has the wordmark and About, Contact and Privacy, and a note on privacy that opens when its link is followed', async () => {
      const { container } = render(<LandingPage />);
      const footer = within(container.querySelector('footer'));
      expect(footer.getByRole('link', { name: 'Still Early, home' })).toHaveTextContent('still early.');
      expect(footer.getByRole('link', { name: 'About' })).toHaveAttribute('href', '/about');
      expect(footer.getByRole('link', { name: 'Contact' })).toHaveAttribute('href', '/contact');
      expect(footer.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '#privacy');
      const note = container.querySelector('details#privacy');
      expect(note).not.toHaveAttribute('open');
      window.history.pushState(null, '', '/welcome#privacy');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      await waitFor(() => expect(note).toHaveAttribute('open'));
      expect(note).toHaveTextContent('sent to this site’s own server and kept to tell you about Still Early, and for nothing else');
    });

    it('lets a keyboard user skip to the content', () => {
      render(<LandingPage />);
      expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
      expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
    });
  });

  describe('the two email forms are one implementation', () => {
    const forms = () => screen.getAllByRole('textbox', { name: 'Your email address' });

    it('are two forms with a label each, the opening\'s with a round arrow and the foot\'s with a yellow button', () => {
      render(<LandingPage />);
      expect(forms()).toHaveLength(2);
      expect(screen.getByRole('button', { name: 'Join the feed' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Keep me inspired/ })).toBeInTheDocument();
    });

    it('sends the address from either one, with where it was left, and says it worked only after the server has said so', async () => {
      let answer;
      submitFeedback.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
      render(<LandingPage />);
      await userEvent.type(forms()[0], 'ada@example.com');
      await userEvent.click(screen.getByRole('button', { name: 'Join the feed' }));
      expect(submitFeedback).toHaveBeenCalledWith({ type: 'subscribe', email: 'ada@example.com', message: 'Signup: hero' });
      expect(screen.getByText('Sending…')).toBeInTheDocument();
      expect(screen.queryByText(/You are on the list/)).not.toBeInTheDocument(); // not yet: the server has not answered
      answer({ id: '1' });
      expect(await screen.findByText('You are on the list. We will be in touch.')).toBeInTheDocument();
      expect(forms()[0]).toHaveValue('');

      await userEvent.type(forms()[1], 'grace@example.com');
      await userEvent.click(screen.getByRole('button', { name: /Keep me inspired/ }));
      await waitFor(() => expect(submitFeedback).toHaveBeenLastCalledWith({ type: 'subscribe', email: 'grace@example.com', message: 'Signup: footer' }));
    });
  });
});
