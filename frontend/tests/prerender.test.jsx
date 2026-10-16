import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hydrateRoot } from 'react-dom/client';
import { act } from '@testing-library/react';
import { ROUTES, renderRoute } from '../src/entry-server.jsx';
import { PAGE_META } from '../src/siteMeta.js';
import { Lazy } from '../src/lazyLoad.jsx';
import LandingPage from '../src/LandingPage.jsx';
import InfoPage from '../src/InfoPage.jsx';

// The pages the build writes as HTML (scripts/prerender.mjs draws them with the functions tested here), from the committed snapshot.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const data = { snapshot: read('public/data/snapshot.json'), prerenderData: read('prerender-data.json') };
const route = (p) => ROUTES.find((r) => r.path === p);
const dom = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };
const text = (el) => el.textContent.replace(/\s+/g, ' ');

describe('the welcome page as HTML (what a browser without scripts, a search engine and a link preview get)', () => {
  const { html, attributes } = renderRoute(route('/welcome'), data);
  const page = dom(html);

  it('has one h1, the four sections, the email forms, the way into the community and the foot, all in the file itself', () => {
    expect(page.querySelectorAll('h1')).toHaveLength(1);
    expect(page.querySelector('h1').textContent).toBe('The next big thingis someone.');
    expect([...page.querySelectorAll('h2')].map((h) => text(h))).toEqual(['Find your people.Start something.', 'Make room forwhat you could become.', 'Show your work.Meet the founder.', 'Stay inspired. Keep building.']);
    expect(page.querySelectorAll('input[type="email"]')).toHaveLength(2);
    expect(page.querySelectorAll('form')).toHaveLength(2);
    const explore = [...page.querySelectorAll('a')].filter((a) => /Explore the community/.test(a.textContent)).map((a) => a.getAttribute('href'));
    expect(explore).toEqual(['/', '/']);
    const nav = [...page.querySelectorAll('.se-nav-links a')].map((a) => [a.textContent, a.getAttribute('href')]);
    expect(nav.map(([label]) => label)).toEqual(['People', 'Companies', 'Our story']);
    for (const href of ['/about', '/contact', '/news', '#join', '#login', '#privacy']) expect([...page.querySelectorAll('a')].map((a) => a.getAttribute('href')), href).toContain(href);
  });

  it('has the opening\'s picture asked for with its size and a narrow file for a phone, and the constellation as a drawing', () => {
    const img = page.querySelector('.se-hero-art img');
    expect(img.getAttribute('src')).toBe('/img/hero-night.webp');
    expect(img.getAttribute('alt')).toBe('');
    expect(page.querySelector('.se-hero-art source').getAttribute('srcset')).toBe('/img/hero-night-sm.webp');
    expect(page.querySelector('svg.se-hero-constellation').getAttribute('aria-hidden')).toBe('true');
  });

  it('says in the file that its pictures of the product are previews, and shows no figure it could not know', () => {
    expect(text(page)).toContain('Product preview · Illustrative content');
    expect(text(page)).toContain('Coming next, not live yet');
    expect(page.querySelectorAll('[data-preview]').length).toBeGreaterThan(5);
    expect(html).not.toMatch(/hero-stat|landing-job-card|verify-example/); // nothing of the old page: no number, no company
  });

  it('reads no data: the root says only that it is to be hydrated, whatever the snapshot is', () => {
    expect(attributes).toEqual({ 'data-prerender': 'landing' });
    const again = renderRoute(route('/welcome'), data).html;
    expect(renderRoute(route('/welcome'), {}).html).toBe(again);
    expect(renderRoute(route('/welcome'), { ...data, snapshot: { generatedAt: '2020-01-01T00:00:00.000Z', answers: {} } }).html).toBe(again);
  });

  it('asks for the opening\'s picture in the head, the one the screen will use', () => {
    expect(route('/welcome').preload).toEqual([['/img/hero-night.webp', '(min-width: 701px)'], ['/img/hero-night-sm.webp', '(max-width: 700px)']]);
  });

  it('leaves the people out while they are switched off', () => {
    expect([...page.querySelectorAll('a')].map((a) => a.getAttribute('href'))).not.toContain('/people');
  });
});

describe('the plain pages as HTML', () => {
  it('each has one h1 and its own words', () => {
    for (const [p, h1, words] of [['/about', 'About Still Early', 'Monash University student'], ['/methodology', 'How we verify', 'no automatic schedule yet'], ['/contact', 'Contact', 'contact form is not set up yet']]) {
      const page = dom(renderRoute(route(p), data).html);
      expect(page.querySelectorAll('h1')).toHaveLength(1);
      expect(page.querySelector('h1').textContent).toBe(h1);
      expect(text(page)).toContain(words);
      expect(renderRoute(route(p), data).attributes).toEqual({ 'data-prerender': 'info' });
    }
  });
});

describe('the pages the app draws itself, as plain HTML for those who do not run it', () => {
  it('the map has a heading and the way to the plain list of every company', () => {
    const page = dom(renderRoute(route('/'), data).html);
    expect(page.querySelector('h1').textContent).toBe('Still Early');
    expect([...page.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toContain('/directory');
  });

  it('the lists page names every list that picks companies, with its count, and links each', () => {
    const page = dom(renderRoute(route('/lists'), data).html);
    const items = [...page.querySelectorAll('li')].filter((li) => li.querySelector('a[href^="/lists/"]'));
    expect(items.length).toBeGreaterThan(3);
    expect(items[0].querySelector('a').getAttribute('href')).toBe('/lists/currently-hiring');
    expect(text(items[0])).toMatch(/Startups Hiring Now: Companies with open roles right now\. \d+ companies?\./);
  });

  it('the investors page names every published investor and links its page', () => {
    const page = dom(renderRoute(route('/investors'), data).html);
    const investors = Object.values(data.prerenderData.answers).find((a) => a.results?.[0]?.slug).results;
    const links = [...page.querySelectorAll('a[href^="/investors/"]')];
    expect(links).toHaveLength(investors.length);
    expect(links.map((a) => a.textContent)).toEqual(investors.map((i) => i.name));
  });

  it('every address that has no page of its own gets the same plain shell', () => {
    const shell = renderRoute({ shell: undefined }, data);
    expect(dom(shell.html).querySelector('h1').textContent).toBe('Still Early');
  });
});

describe('what each pre-rendered page says about itself', () => {
  it('has its own title and description, each of a length a search engine shows, and none repeated', () => {
    expect(ROUTES.map((r) => r.path)).toEqual(['/', '/welcome', '/lists', '/investors', '/methodology', '/about', '/contact']);
    const titles = ROUTES.map((r) => r.meta.title);
    const descriptions = ROUTES.map((r) => r.meta.description);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
    for (const meta of Object.values(PAGE_META)) {
      expect(meta.title.length).toBeLessThanOrEqual(70);
      expect(meta.description.length).toBeGreaterThan(40);
      expect(meta.description.length).toBeLessThanOrEqual(200);
    }
  });

  it('has no People page while the people are switched off: that address opens the map', () => {
    expect(ROUTES.find((r) => r.path === '/people')).toBeUndefined();
  });
});

// A page drawn on the server and hydrated by the browser must come out the same, or the browser throws the HTML away and draws it afresh.
describe('hydration: the first render in the browser is the HTML the server wrote', () => {
  let errors;
  beforeEach(() => { errors = vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { errors.mockRestore(); document.body.innerHTML = ''; });

  async function hydrate(kind, tree, html) {
    document.body.innerHTML = `<div id="root">${html}</div>`;
    const rootEl = document.getElementById('root');
    await act(async () => { hydrateRoot(rootEl, tree); });
    return rootEl;
  }
  const complaints = () => errors.mock.calls.map((c) => String(c[0])).filter((m) => /hydrat|did not match|Text content|server HTML/i.test(m));

  it('the welcome page: same markup, no complaint, and the content rises into place once the page is up', async () => {
    const { html } = renderRoute(route('/welcome'), data);
    const rootEl = await hydrate('landing', <React.StrictMode><Lazy><LandingPage /></Lazy></React.StrictMode>, html);
    expect(complaints()).toEqual([]);
    expect(rootEl.querySelector('h1').textContent).toBe('The next big thingis someone.');
    expect(rootEl.querySelectorAll('input[type="email"]')).toHaveLength(2);
    // a browser that cannot (or may not) animate shows everything once it is hydrated
    expect(rootEl.querySelectorAll('.reveal:not(.is-in)')).toHaveLength(0);
  });

  it('the plain pages: same markup, no complaint', async () => {
    for (const p of ['/about', '/methodology', '/contact']) {
      const r = route(p);
      const { html } = renderRoute(r, data);
      await hydrate('info', <React.StrictMode><Lazy><InfoPage page={r.page} /></Lazy></React.StrictMode>, html);
      expect(complaints(), p).toEqual([]);
    }
  });
});
