import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import InfoPage, { INFO_PAGES } from '../src/InfoPage.jsx';
import { LINKEDIN_URL } from '../src/siteMeta.js';

const body = (container) => container.querySelector('.info-body').textContent;

describe('the plain pages', () => {
  it('each has one h1, a main landmark, the site\'s navigation and footer, and a way past the navigation', () => {
    for (const page of Object.keys(INFO_PAGES)) {
      const { container, unmount } = render(<InfoPage page={page} />);
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(container.querySelector('main#main')).toBeInTheDocument();
      expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
      expect(screen.getByRole('navigation', { name: 'Footer' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
      unmount();
    }
  });

  it('never carries an email address (the owner\'s is not published)', () => {
    for (const page of Object.keys(INFO_PAGES)) {
      const { container, unmount } = render(<InfoPage page={page} />);
      expect(container.innerHTML).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
      expect(container.innerHTML).not.toMatch(/mailto:/);
      unmount();
    }
  });

  describe('About', () => {
    it('says who runs it and why it exists, in five sentences, and claims nothing it has not done', () => {
      const { container } = render(<InfoPage page="about" />);
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('About Still Early');
      const text = [...container.querySelectorAll('.info-body > p:not(.info-links)')].map((p) => p.textContent).join(' ');
      expect(text).toContain('run by Aryan, a Monash University student who builds it alone');
      expect(text).toContain('founders ghost good candidates');
      expect(text).toContain('hard to find in one place');
      expect(text.split(/[.!?](?:\s|$)/).filter((s) => s.trim()).length).toBeLessThanOrEqual(5);
      expect(text).toMatch(/Live now/);
      expect(text).toMatch(/Not yet/);
      expect(text).toMatch(/not affiliated with any company listed/);
      expect(text).not.toMatch(/award|users|customers|funded by|partner|backed|\d{2,}/i);
    });

    it('links to the owner\'s LinkedIn profile, to how it verifies and to Contact', () => {
      const { container } = render(<InfoPage page="about" />);
      const links = within(container.querySelector('.info-body'));
      expect(links.getByRole('link', { name: 'Aryan on LinkedIn' })).toHaveAttribute('href', LINKEDIN_URL);
      expect(LINKEDIN_URL).toBe('https://www.linkedin.com/in/aryaninspires');
      expect(links.getByRole('link', { name: 'Contact' })).toHaveAttribute('href', '/contact');
      expect(links.getByRole('link', { name: 'How we verify' })).toHaveAttribute('href', '/methodology');
    });
  });

  describe('How we verify', () => {
    it('says where facts are read from, what the labels mean and the real windows (14 days, 60 days)', () => {
      const { container } = render(<InfoPage page="methodology" />);
      const text = body(container);
      expect(text).toMatch(/own website, its careers page, and the public job boards/);
      for (const label of ['Verified <date>', 'Hiring now', 'Roles unverified']) expect(screen.getByText(label)).toBeInTheDocument();
      expect(text).toContain('last 14 days');
      expect(text).toContain('After 60 days the card says');
    });

    it('states the real update cadence: by hand, no schedule', () => {
      const { container } = render(<InfoPage page="methodology" />);
      expect(body(container)).toMatch(/no automatic schedule yet/);
    });

    it('says how to ask for a correction or a removal, and what is not collected (no LinkedIn or Crunchbase scraping)', () => {
      const { container } = render(<InfoPage page="methodology" />);
      const text = body(container);
      expect(text).toMatch(/Suggest an edit/);
      expect(text).toMatch(/remove a company, an investor or a person/);
      expect(text).toMatch(/do not scrape LinkedIn or Crunchbase/);
      expect(text).toMatch(/No LinkedIn or Crunchbase scraping/);
      expect(within(container.querySelector('.info-body')).getAllByRole('link', { name: 'contact page' })[0]).toHaveAttribute('href', '/contact');
    });
  });

  describe('Contact', () => {
    it('says the form is not set up while its address is the placeholder, rather than showing a broken frame, and points to what works', () => {
      const { container } = render(<InfoPage page="contact" />);
      expect(container.querySelector('iframe')).toBeNull();
      expect(screen.getByRole('status')).toHaveTextContent(/contact form is not set up yet/);
      expect(screen.getByRole('status')).toHaveTextContent(/Suggest an edit/);
    });

    it('shows the Tally form in a frame once its address is a Tally link', async () => {
      vi.resetModules();
      vi.stubEnv('VITE_TALLY_CONTACT_URL', 'https://tally.so/r/abc123');
      const { default: Page } = await import('../src/InfoPage.jsx');
      const { container } = render(<Page page="contact" />);
      const frame = container.querySelector('iframe');
      expect(frame).toHaveAttribute('src', expect.stringMatching(/^https:\/\/tally\.so\/embed\/abc123/));
      expect(frame).toHaveAttribute('title', 'Contact form');
      expect(screen.queryByRole('status')).toBeNull();
      vi.unstubAllEnvs();
    });
  });
});
