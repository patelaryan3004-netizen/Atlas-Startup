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
    for (const piece of ['MapView', 'JobsView', 'InvestorsView', 'StartupDetailPanel', 'LandingPage', 'NewsPage', 'SubmitStartupForm']) {
      expect(called(piece).length, `${piece} is a file of its own`).toBe(1);
      expect(initial.has(called(piece)[0]), `${piece} is not fetched at once`).toBe(false);
    }
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

  it('keeps each dialog and view small: the largest piece besides the libraries is a page, and it is a file of its own', () => {
    const libraries = [...called('react'), ...called('leaflet')];
    const rest = Object.keys(files).filter((n) => !libraries.includes(n) && !n.startsWith('index-'));
    const biggest = rest.sort((a, b) => Buffer.byteLength(files[b]) - Buffer.byteLength(files[a]))[0];
    expect(Buffer.byteLength(files[biggest])).toBeLessThan(60_000);
    expect(sizeOf(called('InvestorsView'))).toBeGreaterThan(0);
  });
});
