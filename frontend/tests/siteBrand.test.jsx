import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import SiteBrand from '../src/components/SiteBrand.jsx';
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

describe('SiteBrand', () => {
  beforeEach(() => { window.history.replaceState(null, '', '/'); });

  it('is a link to the home page named "Go to home", and a small link to the map beside it', () => {
    render(<SiteBrand />);
    const home = screen.getByRole('link', { name: 'Go to home' });
    expect(home).toHaveAttribute('href', '/welcome');
    expect(home).toHaveTextContent('AU Startup Map');
    expect(screen.getByRole('link', { name: 'Map' })).toHaveAttribute('href', '/');
  });

  it('is reached by the keyboard, home first and then the map', async () => {
    render(<SiteBrand />);
    await userEvent.tab();
    expect(screen.getByRole('link', { name: 'Go to home' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('link', { name: 'Map' })).toHaveFocus();
  });

  it('takes a page that sits over the map back to it on a plain click, without loading the app again', async () => {
    const onMap = vi.fn();
    render(<SiteBrand onMap={onMap} />);
    await userEvent.click(screen.getByRole('link', { name: 'Map' }));
    expect(onMap).toHaveBeenCalledTimes(1);
  });

  it('leaves a click that means a new tab, a new window or a download to the browser, and a link with nothing to call to a link', () => {
    const onMap = vi.fn();
    render(<SiteBrand onMap={onMap} />);
    const map = screen.getByRole('link', { name: 'Map' });
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) fireEvent.click(map, modifier);
    expect(onMap).not.toHaveBeenCalled();
  });

  it('does not change the address when the home link is pressed on its own: it is a real link', () => {
    render(<SiteBrand onMap={() => {}} />);
    const home = screen.getByRole('link', { name: 'Go to home' });
    expect(fireEvent.click(home)).toBe(true); // not prevented: the browser goes to the landing page
  });
});

describe('the focus ring', () => {
  const styles = read('styles.css');
  it('is drawn for the brand on every page: the pages\' bar, the map page\'s header and the landing page\'s', () => {
    expect(styles).toMatch(/\.site-brand a:focus-visible, \.nav-brand a:focus-visible, \.landing-brand:focus-visible\{outline:2px solid var\(--accent\);outline-offset:4px;/);
  });
});

describe('the brand on each page that has a header', () => {
  const needs = (file, ...parts) => { const text = read(file); for (const part of parts) expect(text, `${file}: ${part}`).toContain(part); };

  it('has the brand and the Map link in the pages that sit over the map, and the name only as a link', () => {
    needs('components/JobsView.jsx', '<SiteBrand onMap={onClose} />');
    needs('components/NewsPage.jsx', '<SiteBrand onMap={onClose} />');
    needs('components/people/PeopleView.jsx', '<SiteBrand onMap={onClose} />');
    needs('components/investors/InvestorsView.jsx', '<SiteBrand onMap={close} />');
    for (const file of ['components/NewsPage.jsx', 'components/people/PeopleView.jsx', 'components/investors/InvestorsView.jsx']) {
      expect(read(file), file).not.toContain('inv-bar-name');
    }
  });

  it('has them on the map page\'s own header, and the landing page\'s brand says where it goes', () => {
    needs('App.jsx', 'className="nav-brand-link" href={HOME_PATH} aria-label="Go to home"', 'className="site-brand-map" href={MAP_PATH}');
    needs('components/landing/LandingNav.jsx', 'className="landing-brand" href={HOME_PATH} aria-label="Go to home"');
  });
});
