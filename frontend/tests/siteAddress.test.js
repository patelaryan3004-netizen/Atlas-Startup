// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_URL, OG_IMAGE, absolute } from '../src/siteMeta.js';

// The site's address: Still Early lives at stillearly-au.vercel.app, and the old address (au-startup-map.vercel.app) stays connected and redirects to it, for good,
// with the path and the query kept. These checks are on the settings that do that (frontend/vercel.json) and on where the new address is written.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const NEW_HOST = 'stillearly-au.vercel.app';
const OLD_HOST = 'au-startup-map.vercel.app';

describe('the site\'s address', () => {
  it('is the new one, for the canonical address, the sitemap and the preview picture (unless a build setting names another)', () => {
    expect(SITE_URL).toBe(`https://${NEW_HOST}`);
    expect(absolute('/map')).toBe(`https://${NEW_HOST}/map`);
    expect(absolute('/')).toBe(`https://${NEW_HOST}/`);
    expect(`${SITE_URL}${OG_IMAGE.path}`).toBe(`https://${NEW_HOST}/og-image.png`);
  });

  it('is not written as the old address anywhere in the source of the site', () => {
    for (const file of ['src/siteMeta.js', 'scripts/prerender.mjs', 'scripts/make-og-image.mjs', 'index.html']) {
      expect(readFileSync(path.join(root, file), 'utf8'), file).not.toContain(OLD_HOST);
    }
  });
});

describe('the old address', () => {
  const all = config.redirects ?? [];
  const redirects = all.filter((rule) => rule.has); // the ones for the old host (the welcome page's own redirect is checked below)

  it('has two redirects, both permanent, to the same path and query on the new address: one for the root and one for every other path', () => {
    // (the pattern for every other path does not catch the bare root on Vercel: the old address's "/" answered 200 until it had a rule of its own, found when it was checked live)
    expect(redirects).toHaveLength(2);
    const [root, rest] = redirects;
    expect(root.source).toBe('/');
    expect(root.destination).toBe(`https://${NEW_HOST}/`);
    expect(rest.source).toBe('/:path*');
    expect(rest.destination).toBe(`https://${NEW_HOST}/:path*`);
    for (const rule of redirects) {
      expect(rule.permanent).toBe(true);
      expect(rule.destination).not.toContain('?'); // Vercel carries the query string over by itself, so none is named here
    }
  });

  it('applies to the old host and to no other, so the new address can never redirect to itself', () => {
    for (const rule of redirects) {
      expect(rule.has).toEqual([{ type: 'host', value: OLD_HOST }]);
      expect(new URL(rule.destination.replace(':path*', '')).hostname).toBe(NEW_HOST);
      expect(rule.destination).not.toContain(OLD_HOST);
    }
    expect(NEW_HOST).not.toBe(OLD_HOST);
  });

  it('sends the old address of the welcome page to the homepage for good, with the query kept, and has no page left at it', () => {
    const welcome = all.filter((rule) => !rule.has);
    expect(welcome.map((rule) => rule.source)).toEqual(['/welcome', '/welcome/']);
    for (const rule of welcome) {
      expect(rule.destination).toBe('/');
      expect(rule.permanent).toBe(true);
    }
    expect(config.rewrites.map((r) => r.source)).not.toContain('/welcome');
  });

  it('leaves the own rewrites and headers of the pages as they were: /map, /investors and the rest still have an address', () => {
    const sources = config.rewrites.map((r) => r.source);
    for (const page of ['/map', '/investors', '/about', '/lists', '/jobs', '/news', '/startup/:path*', '/investors/:path*']) expect(sources, page).toContain(page);
    expect(config.headers.map((h) => h.source)).toEqual(['/assets/(.*)', '/img/(.*)', '/data/(.*)']);
  });
});
