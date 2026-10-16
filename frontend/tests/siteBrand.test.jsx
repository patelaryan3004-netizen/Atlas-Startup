import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import SiteHeader from '../src/components/brand/SiteHeader.jsx';
import { NAV } from '../src/components/brand/nav.js';
import { HOME_PATH, MAP_PATH } from '../src/paths.js';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file) => readFileSync(path.join(src, file), 'utf8').replace(/\r\n/g, '\n');

describe('where the brand goes', () => {
  it('is the landing page for home and the app for the map, and main.jsx shows the landing page at the home address', () => {
    expect(HOME_PATH).toBe('/welcome');
    expect(MAP_PATH).toBe('/');
    expect(read('main.jsx')).toContain('const isLanding = path === HOME_PATH;');
    expect(read('main.jsx')).toContain("from './paths.js'");
  });
});

describe('SiteHeader', () => {
  beforeEach(() => { window.history.replaceState(null, '', '/'); });
  const header = () => screen.getByRole('banner');

  it('has the name as a link to the home page ("Go to home"), and a navigation of the five places, each a real link', () => {
    render(<SiteHeader />);
    const home = screen.getByRole('link', { name: 'Go to home' });
    expect(home).toHaveAttribute('href', '/welcome');
    expect(home).toHaveTextContent('still early.');
    const nav = within(screen.getByRole('navigation', { name: 'Main' }));
    expect(nav.getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Explore', '/'], ['Collections', '/lists'], ['Investors', '/investors'], ['Jobs', '/jobs'], ['Saved', '/?view=saved'],
    ]);
    expect(NAV.map((n) => n.label)).toEqual(['Explore', 'Collections', 'Investors', 'Jobs', 'Saved']);
  });

  it('says which place the page is (aria-current) and only that one', () => {
    render(<SiteHeader active="jobs" />);
    const nav = within(screen.getByRole('navigation', { name: 'Main' }));
    expect(nav.getByRole('link', { name: 'Jobs' })).toHaveAttribute('aria-current', 'page');
    expect(nav.getAllByRole('link').filter((a) => a.hasAttribute('aria-current'))).toHaveLength(1);
  });

  it('is reached by the keyboard, home first, then the five places, then the action and the menu', async () => {
    render(<SiteHeader />);
    await userEvent.tab();
    expect(screen.getByRole('link', { name: 'Go to home' })).toHaveFocus();
    for (const place of ['Explore', 'Collections', 'Investors', 'Jobs', 'Saved']) {
      await userEvent.tab();
      expect(screen.getByRole('link', { name: place })).toHaveFocus();
    }
    await userEvent.tab();
    expect(screen.getByRole('link', { name: 'Add company' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Menu' })).toHaveFocus();
  });

  it('takes a place on a plain click inside the app, and leaves a click that means a new tab, a new window or a download to the browser', () => {
    const go = { collections: vi.fn() };
    render(<SiteHeader go={go} />);
    const link = screen.getByRole('link', { name: 'Collections' });
    expect(fireEvent.click(link)).toBe(false); // prevented: the app moves, the page does not load again
    expect(go.collections).toHaveBeenCalledTimes(1);
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) fireEvent.click(link, modifier);
    expect(go.collections).toHaveBeenCalledTimes(1);
  });

  it('does not take the home link: it is a real link to the landing page', () => {
    render(<SiteHeader go={{ explore: () => {} }} />);
    expect(fireEvent.click(screen.getByRole('link', { name: 'Go to home' }))).toBe(true);
  });

  it('has one action, Add company: a button where the page has the form, a link to it where it has not', async () => {
    const onAdd = vi.fn();
    const { unmount } = render(<SiteHeader onAdd={onAdd} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add company' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    unmount();
    render(<SiteHeader />);
    expect(screen.getByRole('link', { name: 'Add company' })).toHaveAttribute('href', '/?view=submit');
    expect(header()).toBeInTheDocument();
  });

  it('says how many are hiring beside Jobs (as its tooltip) and how many are saved beside Saved', () => {
    render(<SiteHeader counts={{ jobs: 25, saved: 3 }} />);
    expect(screen.getByRole('link', { name: 'Jobs' })).toHaveAttribute('title', '25 hiring now');
    expect(screen.getByRole('link', { name: /Saved/ })).toHaveTextContent('Saved3');
  });

  it('has the name only once, as a span: the heading of a page is the page\'s own, not the header\'s', () => {
    render(<SiteHeader />);
    expect(screen.queryByRole('heading')).toBeNull();
  });
});

describe('the focus ring', () => {
  it('is the green ring on everything that can be pressed in the shared components', () => {
    const brand = read('brand.css');
    expect(brand).toMatch(/--focus: ?2px solid var\(--green\)|outline:var\(--focus\)/);
    expect(read('styles.css')).toMatch(/--focus:2px solid var\(--green\)/);
    expect(brand).toMatch(/\.sh-brand:focus-visible\{outline:var\(--focus\);outline-offset:4px;\}/);
    expect(brand).toMatch(/:is\(\.btn,\.bm,\.seg-item,\.sh-link,\.sh-add,\.sh-more[^)]*\):focus-visible\{outline:var\(--focus\);outline-offset:2px;\}/);
  });
});

describe('the header on each page', () => {
  const needs = (file, ...parts) => { const text = read(file); for (const part of parts) expect(text, `${file}: ${part}`).toContain(part); };

  it('is the one shared header on every page that has one: jobs, news, people, collections, investors, the map, the landing page and the plain pages', () => {
    needs('components/JobsView.jsx', '<SiteHeader active="jobs"');
    needs('components/NewsPage.jsx', '<SiteHeader');
    needs('components/people/PeopleView.jsx', '<SiteHeader');
    needs('components/CuratedLists.jsx', '<SiteHeader active="collections"');
    needs('components/investors/InvestorsView.jsx', '<SiteHeader active="investors"');
    needs('App.jsx', '<SiteHeader active="explore"');
    needs('components/landing/Hero.jsx', '<NavCapsule />'); // the welcome page's own capsule over the night sky, with the same wordmark
    needs('components/landing/Hero.jsx', '<Wordmark />');
    needs('InfoPage.jsx', '<SiteHeader />');
    for (const file of ['components/JobsView.jsx', 'components/NewsPage.jsx', 'components/people/PeopleView.jsx', 'components/investors/InvestorsView.jsx', 'App.jsx']) {
      expect(read(file), file).not.toContain('ExploreHeader');
      expect(read(file), file).not.toContain('SiteBrand');
    }
  });
});
