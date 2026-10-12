// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logoUrl } from '../src/logo.js';

// The app owns no picture files: what it shows is company logos from a favicon service, and map tiles. So what is checked is how
// they are asked for: from one address that exists, small, and not before they are needed.

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
function sources(dir = src) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return /^(ui|ai-elements)$/.test(name) ? [] : sources(full); // generated library components nothing imports
    return /\.(jsx?|css)$/.test(name) ? [full] : [];
  });
}
const rel = (file) => path.relative(src, file).replace(/\\/g, '/');
const text = (file) => readFileSync(file, 'utf8');

describe('the app owns no picture files to optimise', () => {
  it('has no image file in src or public, and no image imported or drawn from the page\'s own files', () => {
    const publicDir = path.resolve(src, '..', 'public');
    const pictures = (dir) => readdirSync(dir, { recursive: true }).filter((f) => /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i.test(String(f)));
    expect(pictures(src)).toEqual([]);
    expect(pictures(publicDir)).toEqual([]);
    for (const file of sources()) {
      expect(text(file), rel(file)).not.toMatch(/(?:import|url\()\s*\(?['"]?[^'")\s]*\.(png|jpe?g|gif|webp|avif|bmp)/i);
    }
  });
});

describe('a company\'s logo', () => {
  it('is asked for at one address that exists, by domain and size, never over plain http', () => {
    expect(logoUrl('canva.com', 64)).toBe('https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://canva.com&size=64');
    expect(logoUrl('atlassian.com')).toContain('size=64');
    for (const file of sources()) {
      const code = text(file);
      expect(code, `${rel(file)} asks Clearbit, whose logo address no longer exists`).not.toMatch(/clearbit\.com\//);
      if (rel(file) !== 'logo.js') expect(code, `${rel(file)} builds a logo address of its own`).not.toMatch(/gstatic\.com|google\.com\/s2\/favicons/);
      for (const [url] of code.matchAll(/src=\{?[`'"]http:\/\/[^`'"}]+/g)) expect.fail(`${rel(file)} loads a picture over plain http: ${url}`);
    }
  });

  it('is small: the largest size asked for is 96 pixels, for a box drawn at 32 to 64', () => {
    for (const file of sources()) {
      for (const [, size] of text(file).matchAll(/logoUrl\([^)]*?,\s*(\d+)\)/g)) expect(Number(size), rel(file)).toBeLessThanOrEqual(96);
    }
  });
});

// An image element in JSX. The pattern is put together from pieces so that this file is not itself read as a picture with no source.
const IMAGE_TAG = new RegExp(['<', 'img\\b[\\s\\S]*?\\/>'].join(''), 'g');

describe('every image tag', () => {
  // Comments that talk about an image element are not one.
  const code = (file) => text(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const all = sources().filter((f) => f.endsWith('.jsx')).flatMap((file) => [...code(file).matchAll(IMAGE_TAG)].map(([tag]) => ({ file: rel(file), tag })));

  it('is found where the logos are drawn (this test would otherwise check nothing)', () => {
    expect(all.map((i) => i.file).sort()).toEqual([
      'LandingPage.jsx', 'components/JobsView.jsx', 'components/ListView.jsx', 'components/StartupDetailPanel.jsx', 'components/investors/common.jsx',
    ]);
  });

  it('has an alt (empty: the name is beside it), and decodes off the main thread', () => {
    for (const { file, tag } of all) {
      expect(tag, file).toMatch(/\balt=("[^"]*"|\{[^}]*\})/);
      expect(tag, file).toContain('decoding="async"');
    }
  });

  it('waits until it is near the screen (loading="lazy"), except the company panel\'s, which opens on a click and is wanted at once', () => {
    for (const { file, tag } of all) {
      if (file === 'components/StartupDetailPanel.jsx') expect(tag, file).not.toContain('loading="lazy"');
      else expect(tag, file).toContain('loading="lazy"');
    }
  });

  it('is given its size, where it sits in a box that is the same on every screen, so the page does not move as logos arrive', () => {
    for (const { file, tag } of all.filter((i) => ['LandingPage.jsx', 'components/JobsView.jsx', 'components/ListView.jsx'].includes(i.file))) {
      expect(tag, file).toMatch(/\bwidth="\d+"/);
      expect(tag, file).toMatch(/\bheight="\d+"/);
    }
  });
});

describe('the map\'s pins, built as elements', () => {
  it('decode their logos off the main thread, and show one only once it has loaded and is a real logo', () => {
    const map = text(path.join(src, 'components', 'MapView.jsx'));
    expect(map).toContain("img.decoding = 'async'");
    expect(map).toContain('naturalWidth >= 24');
    expect(map).toContain('logoUrl(domain, size)');
  });
});
