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
import { forgetSnapshot, primeSnapshot } from '../src/snapshot.js';
import { setPrerenderClock } from '../src/clock.js';

// The pages the build writes as HTML (scripts/prerender.mjs draws them with the functions tested here), from the committed snapshot.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const data = { snapshot: read('public/data/snapshot.json'), prerenderData: read('prerender-data.json') };
const route = (p) => ROUTES.find((r) => r.path === p);
const dom = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };
const text = (el) => el.textContent.replace(/\s+/g, ' ');

describe('the landing page as HTML (what a browser without scripts, a search engine and a link preview get)', () => {
  const { html, attributes } = renderRoute(route('/welcome'), data);
  const page = dom(html);

  it('has the headline, the three figures, the hiring companies, the call to action and the footer links', () => {
    expect(page.querySelectorAll('h1')).toHaveLength(1);
    expect(page.querySelector('h1').textContent).toBe('Australia’s startup ecosystem, mapped.');
    const stats = [...page.querySelectorAll('.hero-stat')].map((li) => [li.querySelector('.hero-stat-num').textContent, li.querySelector('.hero-stat-label').textContent]);
    expect(stats.map(([, label]) => label)).toEqual(['Startups tracked', 'Founders named', 'Open roles']);
    for (const [num] of stats) expect(num).toMatch(/^[\d,]+$/);
    const cards = [...page.querySelectorAll('.landing-job-card .entity-name')].map((n) => n.textContent);
    expect(cards).toHaveLength(6);
    for (const company of data.snapshot.answers['/api/startups?hiring=yes&limit=80&offset=0&sort=file&view=card'].results.slice(0, 6)) expect(cards).toContain(company.name);
    const ctas = [...page.querySelectorAll('.hero .landing-cta-row a')].map((a) => [a.textContent, a.getAttribute('href')]);
    expect(ctas).toEqual([['Explore the map', '/'], ['Submit a startup', '/?view=submit']]);
    const footer = [...page.querySelectorAll('.landing-footer a')].map((a) => a.getAttribute('href'));
    for (const href of ['/', '/lists', '/investors', '/methodology', '/about', '/contact', 'https://www.linkedin.com/in/aryaninspires']) expect(footer).toContain(href);
  });

  it('shows one real example entry with its source and the day it was verified', () => {
    const example = page.querySelector('.verify-example');
    expect(example).not.toBeNull();
    expect(text(example)).toMatch(/^An example entry\S.* · Hiring nowSource: \S+, its own job page\. Verified \d{1,2} \w{3} \d{4}\.$/);
    const link = example.querySelector('a[target="_blank"]');
    expect(link.getAttribute('href')).toMatch(/^https:\/\//);
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('says what the root is made from: the snapshot it was built from, and that it is to be hydrated', () => {
    expect(attributes).toEqual({ 'data-prerender': 'landing', 'data-snapshot': data.snapshot.generatedAt });
  });

  it('leaves the people out while they are switched off', () => {
    expect(html).not.toContain('/people');
  });

  it('is made without figures, not with stale ones, when the snapshot is too old to use', () => {
    const old = { ...data.snapshot, generatedAt: '2020-01-01T00:00:00.000Z' };
    const made = renderRoute(route('/welcome'), { ...data, snapshot: old });
    expect(made.attributes).toEqual({ 'data-prerender': 'landing' });
    expect(made.html).not.toContain('hero-stat-num');
    expect(made.html).toContain('<h1');
  });
});

describe('the plain pages as HTML', () => {
  it('each has one h1 and its own words', () => {
    for (const [p, h1, words] of [['/about', 'About AU Startup Map', 'Monash University student'], ['/methodology', 'How we verify', 'no automatic schedule yet'], ['/contact', 'Contact', 'contact form is not set up yet']]) {
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
    expect(page.querySelector('h1').textContent).toBe('AU Startup Map');
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
    expect(dom(shell.html).querySelector('h1').textContent).toBe('AU Startup Map');
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
  afterEach(() => { errors.mockRestore(); forgetSnapshot(); setPrerenderClock(null); document.body.innerHTML = ''; });

  async function hydrate(kind, tree, html) {
    document.body.innerHTML = `<div id="root">${html}</div>`;
    const rootEl = document.getElementById('root');
    await act(async () => { hydrateRoot(rootEl, tree); });
    return rootEl;
  }
  const complaints = () => errors.mock.calls.map((c) => String(c[0])).filter((m) => /hydrat|did not match|Text content|server HTML/i.test(m));

  it('the landing page: same markup, no complaint, and the content rises into place once the page is up', async () => {
    const { html } = renderRoute(route('/welcome'), data);
    forgetSnapshot();
    primeSnapshot(data.snapshot);
    setPrerenderClock(Date.parse(data.snapshot.generatedAt));
    const rootEl = await hydrate('landing', <React.StrictMode><Lazy><LandingPage /></Lazy></React.StrictMode>, html);
    expect(complaints()).toEqual([]);
    expect(rootEl.querySelector('h1').textContent).toBe('Australia’s startup ecosystem, mapped.');
    expect(rootEl.querySelectorAll('.landing-job-card')).toHaveLength(6);
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
