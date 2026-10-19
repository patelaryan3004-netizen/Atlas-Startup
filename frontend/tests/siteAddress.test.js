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
    expect(absolute('/welcome')).toBe(`https://${NEW_HOST}/welcome`);
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
  const redirects = config.redirects ?? [];

  it('has one redirect, a permanent one, to the same path and query on the new address', () => {
    expect(redirects).toHaveLength(1);
    const [rule] = redirects;
    expect(rule.permanent).toBe(true);
    expect(rule.source).toBe('/:path*'); // every path, the root included
    expect(rule.destination).toBe(`https://${NEW_HOST}/:path*`); // Vercel carries the query string over by itself, so none is named here
    expect(rule.destination).not.toContain('?');
  });

  it('applies to the old host and to no other, so the new address can never redirect to itself', () => {
    const [rule] = redirects;
    expect(rule.has).toEqual([{ type: 'host', value: OLD_HOST }]);
    expect(new URL(rule.destination.replace(':path*', '')).hostname).toBe(NEW_HOST);
    expect(rule.destination).not.toContain(OLD_HOST);
    expect(NEW_HOST).not.toBe(OLD_HOST);
  });

  it('leaves the pages\' own rewrites and headers as they were: /welcome, /investors and the rest still have an address', () => {
    const sources = config.rewrites.map((r) => r.source);
    for (const page of ['/welcome', '/investors', '/about', '/lists', '/jobs', '/news', '/startup/:path*', '/investors/:path*']) expect(sources, page).toContain(page);
    expect(config.headers.map((h) => h.source)).toEqual(['/assets/(.*)', '/img/(.*)', '/data/(.*)']);
  });
});
