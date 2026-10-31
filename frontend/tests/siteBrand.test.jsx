import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import SiteHeader from '../src/components/brand/SiteHeader.jsx';
import { NAV, DISCOVER_TABS, OPPORTUNITY_TABS } from '../src/components/brand/nav.js';
import { HOME_PATH, MAP_PATH, OLD_WELCOME_PATH } from '../src/paths.js';
import { closeAuth } from '../src/authUi.js';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file) => readFileSync(path.join(src, file), 'utf8').replace(/\r\n/g, '\n');

describe('where the brand goes', () => {
  it('is the welcome page (the homepage) for the name, the map page for the way in, and main.jsx shows the welcome page at the root and sends its old address there', () => {
    expect(HOME_PATH).toBe('/');
    expect(OLD_WELCOME_PATH).toBe('/welcome');
    expect(MAP_PATH).toBe('/map');
    expect(read('main.jsx')).toContain('const isLanding = opensWelcome();');
    expect(read('main.jsx')).toContain('=== OLD_WELCOME_PATH');
    expect(read('main.jsx')).toContain("from './paths.js'");
  });
});

describe('the places', () => {
  it('are Home, Discover, Map and Opportunities, each with an address of its own, and what is inside Discover and Opportunities is tabs', () => {
    expect(NAV.map((n) => [n.label, n.href])).toEqual([['Home', '/home'], ['Discover', '/discover'], ['Map', '/map'], ['Opportunities', '/jobs']]);
    expect(DISCOVER_TABS.map((t) => [t.label, t.href])).toEqual([['People', '/discover/people'], ['Startups', '/discover'], ['Investors', '/investors']]);
    expect(OPPORTUNITY_TABS.map((t) => [t.label, t.href])).toEqual([['Jobs', '/jobs'], ['Events', '/events']]);
  });
});

describe('SiteHeader', () => {
  beforeEach(() => { window.history.replaceState(null, '', '/'); localStorage.clear(); });
  afterEach(() => { closeAuth(); });
  const header = () => screen.getByRole('banner');
  const places = () => within(screen.getByRole('navigation', { name: 'Main' }));

  it('has the name as a link to the welcome page ("Go to home"), and a navigation of the places, each a real link', () => {
    render(<SiteHeader />);
    const home = screen.getByRole('link', { name: 'Go to home' });
    expect(home).toHaveAttribute('href', '/');
    expect(home).toHaveTextContent('still early.');
    expect(places().getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([['Home', '/home'], ['Discover', '/discover'], ['Map', '/map'], ['Opportunities', '/jobs']]);
  });

  it('says which place the page is (aria-current) and only that one', () => {
    render(<SiteHeader active="opportunities" />);
    expect(places().getByRole('link', { name: 'Opportunities' })).toHaveAttribute('aria-current', 'page');
    expect(places().getAllByRole('link').filter((a) => a.hasAttribute('aria-current'))).toHaveLength(1);
  });

  it('is reached by the keyboard: the name first, then the places, then Sign in and the menu', async () => {
    render(<SiteHeader />);
    await userEvent.tab();
    expect(screen.getByRole('link', { name: 'Go to home' })).toHaveFocus();
    for (const place of ['Home', 'Discover', 'Map', 'Opportunities']) {
      await userEvent.tab();
      expect(places().getByRole('link', { name: place })).toHaveFocus();
    }
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Sign in' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Menu' })).toHaveFocus();
  });

  it('takes a place on a plain click inside the app, and leaves a click that means a new tab, a new window or a download to the browser', () => {
    const go = { discover: vi.fn() };
    render(<SiteHeader go={go} />);
    const link = places().getByRole('link', { name: 'Discover' });
    expect(fireEvent.click(link)).toBe(false); // prevented: the app moves, the page does not load again
    expect(go.discover).toHaveBeenCalledTimes(1);
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) fireEvent.click(link, modifier);
    expect(go.discover).toHaveBeenCalledTimes(1);
  });

  it('does not take the name: it is a real link to the welcome page', () => {
    render(<SiteHeader go={{ home: () => {} }} />);
    expect(fireEvent.click(screen.getByRole('link', { name: 'Go to home' }))).toBe(true);
  });

  it('has an action only when the page has one: a button where the page has the form, a link to it where it has not, and none otherwise', async () => {
    const onAdd = vi.fn();
    const { unmount } = render(<SiteHeader onAdd={onAdd} addLabel="Add company" />);
    await userEvent.click(screen.getByRole('button', { name: 'Add company' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    unmount();
    const second = render(<SiteHeader addLabel="Add company" />);
    expect(screen.getByRole('link', { name: 'Add company' })).toHaveAttribute('href', '/discover?view=submit');
    second.unmount();
    render(<SiteHeader />);
    expect(screen.queryByRole('link', { name: /Add/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add/ })).toBeNull();
    expect(header()).toBeInTheDocument();
  });

  it('puts a person\'s own things under their avatar and not among the places: signed out it is a Sign in button that opens the dialog', async () => {
    render(<SiteHeader />);
    expect(places().queryByRole('link', { name: /Saved|Profile/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('dialog', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('has the places along the bottom of a phone too, the same links, with the open one marked', () => {
    render(<SiteHeader active="home" />);
    const bar = within(screen.getByRole('navigation', { name: 'Main (phone)' }));
    expect(bar.getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([['Home', '/home'], ['Discover', '/discover'], ['Map', '/map'], ['Opportunities', '/jobs']]);
    expect(bar.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
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
    const network = read('network.css');
    for (const selector of ['.sh-signin', '.am-btn', '.am-item', '.bn-link', '.st-tab', '.pc-act', '.cmp-topic', '.dp-main']) expect(network, selector).toContain(`${selector}:focus-visible`);
  });
});

describe('the header on each page', () => {
  const needs = (file, ...parts) => { const text = read(file); for (const part of parts) expect(text, `${file}: ${part}`).toContain(part); };

  it('is the one shared header on every page that has one: the community, opportunities, news, people, collections, investors, Discover, the landing page and the plain pages', () => {
    needs('components/network/HomeFeed.jsx', '<SiteHeader active="home"');
    needs('components/network/DiscoverPeople.jsx', '<SiteHeader active="discover"');
    needs('components/network/JobsBoard.jsx', '<SiteHeader active="opportunities"');
    needs('components/network/EventsBoard.jsx', '<SiteHeader active="opportunities"');
    needs('components/network/SavedPage.jsx', '<SiteHeader');
    needs('components/network/MemberProfile.jsx', '<SiteHeader');
    needs('components/network/ProfileEditor.jsx', '<SiteHeader');
    needs('components/network/ModerationPage.jsx', '<SiteHeader');
    needs('components/NewsPage.jsx', '<SiteHeader');
    needs('components/people/PeopleView.jsx', '<SiteHeader');
    needs('components/CuratedLists.jsx', '<SiteHeader active="discover"');
    needs('components/investors/InvestorsView.jsx', '<SiteHeader active="discover"');
    needs('App.jsx', "<SiteHeader active={isMapPage ? 'map' : 'discover'}");
    needs('components/landing/Hero.jsx', '<NavCapsule />'); // the welcome page's own capsule over the night sky, with the same wordmark
    needs('components/landing/Hero.jsx', '<Wordmark />');
    needs('InfoPage.jsx', '<SiteHeader />');
    for (const file of ['components/network/JobsBoard.jsx', 'components/NewsPage.jsx', 'components/people/PeopleView.jsx', 'components/investors/InvestorsView.jsx', 'App.jsx']) {
      expect(read(file), file).not.toContain('ExploreHeader');
      expect(read(file), file).not.toContain('SiteBrand');
    }
  });
});
