// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { build } from 'vite';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// What a visit downloads before it can draw anything is a promise worth keeping: the app is built here, as the site is, and the files
// the page asks for at once are measured. Everything else (each page, the map and its library, every dialog) is a file of its own,
// fetched when it is first wanted.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIMIT = 200_000; // bytes of JavaScript before the first page can draw, as the browser receives it uncompressed
let dist;
let files; // name -> text
let html;

beforeAll(async () => {
  dist = await mkdtemp(path.join(os.tmpdir(), 'au-bundle-'));
  // The test runner sets NODE_ENV to "test", which would put React's development build in; the site is built for production.
  const mode = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await build({ root, mode: 'production', logLevel: 'silent', build: { outDir: dist, emptyOutDir: true, reportCompressedSize: false } });
  } finally {
    process.env.NODE_ENV = mode;
  }
  const names = await readdir(path.join(dist, 'assets'));
  files = Object.fromEntries(await Promise.all(names.filter((n) => n.endsWith('.js')).map(async (n) => [n, await readFile(path.join(dist, 'assets', n), 'utf8')])));
  html = await readFile(path.join(dist, 'index.html'), 'utf8');
}, 120_000);

afterAll(() => rm(dist, { recursive: true, force: true }));

// The JavaScript files a file loads at once: itself and everything it imports by name (not the ones it imports when asked).
function closure(name, seen = new Set()) {
  if (seen.has(name)) return seen;
  seen.add(name);
  // from"./x.js" and import"./x.js" are static imports; a file asked for later is import("./x.js"), which this does not match.
  for (const [, dep] of files[name].matchAll(/(?:from|import)\s*"\.\/([^"]+\.js)"/g)) if (files[dep] !== undefined) closure(dep, seen);
  return seen;
}
const bytes = (names) => [...names].reduce((sum, n) => sum + Buffer.byteLength(files[n]), 0);
const called = (prefix) => Object.keys(files).filter((n) => n.startsWith(`${prefix}-`));
const entry = () => /<script type="module"[^>]*src="\/assets\/([^"]+\.js)"/.exec(html)[1];

describe('what the first visit downloads', () => {
  it('is under 200 KB of JavaScript: the entry and what it loads at once', () => {
    const initial = closure(entry());
    expect(bytes(initial)).toBeLessThan(LIMIT);
    // index.html names them all up front, so the browser fetches them side by side
    const preloaded = [...html.matchAll(/rel="modulepreload"[^>]*href="\/assets\/([^"]+\.js)"/g)].map((m) => m[1]);
    for (const n of preloaded) expect(initial.has(n), n).toBe(true);
  });

  it('holds React and the page code that starts the app, and nothing of the pages themselves', () => {
    const initial = closure(entry());
    const text = [...initial].map((n) => files[n]).join('\n');
    expect(called('react').some((n) => initial.has(n))).toBe(true);
    for (const library of ['leaflet-container', 'leaflet-tile-pane']) expect(text, library).not.toContain(library);
    for (const piece of ['MapView', 'JobsView', 'InvestorsView', 'StartupDetailPanel', 'LandingPage', 'InfoPage', 'NewsPage', 'SubmitStartupForm']) {
      expect(called(piece).length, `${piece} is a file of its own`).toBe(1);
      expect(initial.has(called(piece)[0]), `${piece} is not fetched at once`).toBe(false);
    }
  });
});

describe('what the first paint waits for', () => {
  it('is served with the page: index.html asks no other site for a stylesheet, a script or a connection', () => {
    expect(html).not.toMatch(/<link[^>]+(?:href|src)="https?:\/\//);
    expect(html).not.toMatch(/<script[^>]+src="https?:\/\//);
    expect(html).not.toMatch(/googleapis|gstatic|cdnjs/);
  });

  it('starts the typeface and the snapshot early: a preload for the Latin Inter file, and the snapshot\'s download before any script runs', () => {
    expect(html).toMatch(/<link rel="preload" as="font" type="font\/woff2" href="\/assets\/inter-latin-wght-normal-[^"]+\.woff2" crossorigin/);
    expect(html).toContain("fetch('/data/snapshot.json')");
  });

  it('names the files of the page an address opens, so the browser asks for them with the app\'s own instead of a round trip later', async () => {
    const files = JSON.parse(/files = (\{.*?\});/s.exec(html)[1]);
    // the app, the map, the list and the jobs board; not the landing page (measured: preloading its files made its largest paint later)
    expect(Object.keys(files).sort()).toEqual(['app', 'jobs', 'list', 'map']);
    const names = await readdir(path.join(dist, 'assets'));
    for (const [kind, { js, css }] of Object.entries(files)) {
      for (const file of [...js, ...css]) expect(names, `${kind}: ${file}`).toContain(file.replace('/assets/', ''));
      expect(js.some((f) => f.includes(entry())), `${kind} does not repeat the entry`).toBe(false);
    }
    expect(files.map.js.some((f) => /leaflet-.*\.js$/.test(f)) && files.map.css.some((f) => /leaflet-.*\.css$/.test(f))).toBe(true);
    expect(files.list.js.some((f) => /ListView-/.test(f))).toBe(true);
    expect(files.jobs.js.some((f) => /JobsView-/.test(f))).toBe(true);
    expect(Object.values(files).flatMap((f) => f.js).some((f) => /react-/.test(f))).toBe(false); // React is index.html's own
  });

  it('sets the typeface to swap in, so text is drawn at once in the system face and never waits for the file', async () => {
    const own = /<link rel="stylesheet"[^>]*href="\/assets\/([^"]+\.css)"/.exec(html)[1];
    const css = await readFile(path.join(dist, 'assets', own), 'utf8');
    const faces = css.match(/@font-face\{[^}]*Inter Variable[^}]*\}/g) ?? [];
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) expect(face).toMatch(/font-display:\s*swap/);
  });
});

describe('what each page downloads', () => {
  const sizeOf = (names) => bytes(closure(names[0]));

  it('keeps Leaflet to the map: no other page loads it', () => {
    const leaflet = called('leaflet');
    expect(leaflet).toHaveLength(1);
    expect(closure(called('MapView')[0]).has(leaflet[0])).toBe(true);
    for (const piece of ['App', 'LandingPage', 'JobsView', 'InvestorsView', 'ListView', 'StartupDetailPanel']) {
      expect(closure(called(piece)[0]).has(leaflet[0]), `${piece} would load Leaflet`).toBe(false);
    }
    expect(closure(entry()).has(leaflet[0])).toBe(false);
  });

  it('gives the landing page none of the app, and the app none of the landing page', () => {
    const landing = closure(called('LandingPage')[0]);
    const app = closure(called('App')[0]);
    expect(landing.has(called('App')[0])).toBe(false);
    expect(app.has(called('LandingPage')[0])).toBe(false);
    // a visit to /welcome: the entry, the page, and what they share
    const visit = new Set([...closure(entry()), ...landing]);
    expect(bytes(visit)).toBeLessThan(LIMIT + 60_000);
  });

  it('keeps Supercluster (the pins\' grouping) to the map: the list, the jobs board and the landing page never download it', () => {
    const carrier = Object.keys(files).filter((n) => files[n].includes('getClusterExpansionZoom'));
    expect(carrier, 'one file carries Supercluster').toHaveLength(1);
    expect(closure(called('MapView')[0]).has(carrier[0])).toBe(true);
    for (const piece of ['App', 'LandingPage', 'ListView', 'JobsView', 'StartupDetailPanel']) {
      expect(closure(called(piece)[0]).has(carrier[0]), `${piece} would load Supercluster`).toBe(false);
    }
    expect(closure(entry()).has(carrier[0])).toBe(false);
  });

  it('keeps Leaflet\'s stylesheet to the map: it is not in the page\'s own stylesheet', async () => {
    const own = /<link rel="stylesheet"[^>]*href="\/assets\/([^"]+\.css)"/.exec(html)[1];
    const css = await readFile(path.join(dist, 'assets', own), 'utf8');
    // (the page's own sheet has a few rules of its own for Leaflet's classes; Leaflet's sheet is the one that moves the map's panes about)
    expect(css).not.toContain('leaflet-zoom-animated');
    const names = await readdir(path.join(dist, 'assets'));
    const sheets = names.filter((n) => n.endsWith('.css') && n.startsWith('leaflet-'));
    expect(sheets).toHaveLength(1);
    expect(await readFile(path.join(dist, 'assets', sheets[0]), 'utf8')).toContain('leaflet-zoom-animated');
  });

  it('keeps each dialog and view small: the largest piece besides the libraries is a page, and it is a file of its own', () => {
    const libraries = [...called('react'), ...called('leaflet')];
    const rest = Object.keys(files).filter((n) => !libraries.includes(n) && !n.startsWith('index-'));
    const biggest = rest.sort((a, b) => Buffer.byteLength(files[b]) - Buffer.byteLength(files[a]))[0];
    // (The app's shell is the biggest: it grew by the VC layer, the entity switch and the sheet's VC rows; the panels and the VC list are files of their own. It is
    // 6 kB bigger since the welcome page stopped sharing the header, the cards and the skeletons with it: they are the app's alone again, not more code.)
    // The investors page is the next, and is lazy like the rest (loaded only on /investors): it grew by the compact list, the people layer, the filter sheet and
    // the person panel, and is the biggest piece now.
    expect(Buffer.byteLength(files[biggest])).toBeLessThan(80_000);
    expect(sizeOf(called('InvestorsView'))).toBeGreaterThan(0);
  });
});
