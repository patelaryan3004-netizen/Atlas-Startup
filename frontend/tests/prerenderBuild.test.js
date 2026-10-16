// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { build } from 'vite';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The whole of it, as `npm run build` does it: the site is built, then scripts/prerender.mjs writes the HTML into the build. What is checked is
// the files a visitor with no scripts, a search engine and a link preview are given.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://au-startup-map.vercel.app';
let dist;
const file = (name) => readFile(path.join(dist, name), 'utf8');
const tag = (html, re) => re.exec(html)?.[1] ?? null;

beforeAll(async () => {
  dist = await mkdtemp(path.join(os.tmpdir(), 'au-prerender-'));
  const env = { NODE_ENV: process.env.NODE_ENV, VITE_API_BASE: process.env.VITE_API_BASE };
  process.env.NODE_ENV = 'production';
  process.env.VITE_API_BASE = 'https://api.example.test';
  try {
    await build({ root, mode: 'production', logLevel: 'silent', build: { outDir: dist, emptyOutDir: true, reportCompressedSize: false } });
  } finally {
    process.env.NODE_ENV = env.NODE_ENV;
    if (env.VITE_API_BASE === undefined) delete process.env.VITE_API_BASE; else process.env.VITE_API_BASE = env.VITE_API_BASE;
  }
  execFileSync(process.execPath, [path.join(root, 'scripts', 'prerender.mjs')], { cwd: root, env: { ...process.env, PRERENDER_DIST: dist, VITE_API_BASE: 'https://api.example.test' }, stdio: 'pipe', timeout: 120000 });
}, 240_000);

afterAll(() => rm(dist, { recursive: true, force: true }));

const PAGES = { '/': 'index.html', '/welcome': 'welcome/index.html', '/lists': 'lists/index.html', '/investors': 'investors/index.html', '/methodology': 'methodology/index.html', '/about': 'about/index.html', '/contact': 'contact/index.html' };

describe('the built pages carry their own HTML, head and address', () => {
  it('writes a file for every page, and the generic one', async () => {
    for (const name of [...Object.values(PAGES), 'app.html', 'robots.txt', 'sitemap.xml']) expect((await file(name)).length, name).toBeGreaterThan(50);
  });

  it('gives each page its own title, description, canonical address and preview tags', async () => {
    const titles = new Set();
    const descriptions = new Set();
    for (const [route, name] of Object.entries(PAGES)) {
      const html = await file(name);
      const title = tag(html, /<title>([^<]+)<\/title>/);
      const description = tag(html, /<meta name="description" content="([^"]+)"/);
      titles.add(title);
      descriptions.add(description);
      const url = route === '/' ? `${SITE}/` : `${SITE}${route}`;
      expect(tag(html, /<link rel="canonical" href="([^"]+)"/), route).toBe(url);
      expect(tag(html, /<meta property="og:url" content="([^"]+)"/), route).toBe(url);
      expect(tag(html, /<meta property="og:title" content="([^"]+)"/), route).toBe(title);
      expect(tag(html, /<meta property="og:description" content="([^"]+)"/), route).toBe(description);
      expect(tag(html, /<meta name="twitter:title" content="([^"]+)"/), route).toBe(title);
      expect(tag(html, /<meta name="twitter:description" content="([^"]+)"/), route).toBe(description);
      expect(tag(html, /<meta property="og:image" content="([^"]+)"/), route).toBe(`${SITE}/og-image.png`);
      expect(tag(html, /<meta name="twitter:image" content="([^"]+)"/), route).toBe(`${SITE}/og-image.png`);
      expect(tag(html, /<meta property="og:image:width" content="([^"]+)"/), route).toBe('1200');
      expect(tag(html, /<meta property="og:image:height" content="([^"]+)"/), route).toBe('630');
      expect(tag(html, /<meta name="twitter:card" content="([^"]+)"/), route).toBe('summary_large_image');
      expect(html, route).not.toContain('__SITE_URL__');
      expect(html.match(/<h1[ >]/g), route).toHaveLength(1);
      expect(html.match(/<link rel="canonical"/g), route).toHaveLength(1);
    }
    expect(titles.size).toBe(Object.keys(PAGES).length);
    expect(descriptions.size).toBe(Object.keys(PAGES).length);
  });

  it('gives the page every other address falls back to no canonical address and no preview address of its own, and the same plain shell', async () => {
    const html = await file('app.html');
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain('property="og:url"');
    expect(html).toContain('<div id="root" data-prerender="shell"><div class="static-shell"><h1>Still Early</h1>');
    expect(tag(html, /<meta property="og:image" content="([^"]+)"/)).toBe(`${SITE}/og-image.png`);
  });

  it('writes the welcome page as hydratable HTML with its heading, sections, forms and foot in the file itself, and asks for its picture at once', async () => {
    const html = await file('welcome/index.html');
    expect(html).toContain('<div id="root" data-prerender="landing">');
    expect(html).toMatch(/<h1[^>]*>The next big thing<br\/>is <em>someone<span class="se-stop">\.<\/span><\/em><\/h1>/);
    expect(html.match(/<input[^>]*type="email"/g)).toHaveLength(2);
    expect(html).toContain('Explore the community');
    expect(html).toContain('Stay inspired. Keep building.');
    expect(html).toContain('Product preview · Illustrative content');
    for (const href of ['/about', '/contact', '/news', '#join', '#privacy']) expect(html).toContain(`href="${href}"`);
    // the opening's picture, asked for in the head: the wide one for a wide screen and the narrow one for a phone, at high priority, and not on any other page
    expect(html).toContain('<link rel="preload" as="image" href="/img/hero-night.webp" media="(min-width: 701px)" fetchpriority="high">');
    expect(html).toContain('<link rel="preload" as="image" href="/img/hero-night-sm.webp" media="(max-width: 700px)" fetchpriority="high">');
    // and the two cuts of the serif its headline is set in (regular and italic), so the headline is not first drawn in another face
    expect(html.match(/<link rel="preload" as="font" type="font\/woff2" href="\/assets\/instrument-serif-latin-400-(normal|italic)-[^"]+\.woff2" crossorigin>/g)).toHaveLength(2);
    expect(await file('about/index.html')).not.toContain('instrument-serif');
    expect(await file('about/index.html')).not.toContain('hero-night');
    expect(await file('index.html')).not.toContain('hero-night');
    // it reads no data, so it is not sent the snapshot the map and the jobs board draw from
    expect(html).toContain("path === '' || path === '/jobs'");
  });

  it('keeps the no-script fallback to the plain list of every company, and shows the "rising" content to a visitor with no scripts', async () => {
    for (const name of Object.values(PAGES)) {
      const html = await file(name);
      expect(html, name).toMatch(/<noscript>\s*This map needs JavaScript\. <a href="https:\/\/api\.example\.test\/directory">/);
      expect(html, name).toContain('<noscript><style>.reveal{opacity:1!important;transform:none!important}</style></noscript>');
    }
  });

  it('keeps the page\'s scripts: the entry, the font and the early snapshot are still in every page', async () => {
    for (const name of Object.values(PAGES)) {
      const html = await file(name);
      expect(html, name).toMatch(/<script type="module" crossorigin src="\/assets\/index-[^"]+\.js">/);
      expect(html, name).toContain("fetch('/data/snapshot.json')");
      expect(html, name).toMatch(/<link rel="preload" as="font"/);
      expect(html, name).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
    }
  });

  it('lists the pre-rendered pages (and not /people) in sitemap.xml, and points robots.txt at it', async () => {
    const sitemap = await file('sitemap.xml');
    const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(urls).toEqual(Object.keys(PAGES).map((r) => (r === '/' ? `${SITE}/` : `${SITE}${r}`)));
    expect(sitemap).not.toContain('/people');
    expect(await file('robots.txt')).toBe(`User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
  });

  it('serves the preview image the pages name, at 1200 x 630', async () => {
    const png = await readFile(path.join(dist, 'og-image.png'));
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  });
});
