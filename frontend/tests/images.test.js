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
    // (the two pictures the site serves are the tab icon, favicon.svg, and the preview a link to it shows, og-image.png: no page draws either,
    // so there is nothing to optimise in the app)
    // The welcome page's night sky is the other artwork the site owns: two webp files (img/), a wide one and a narrow one for a phone, made from the approved
    // design with every word taken out of them (scripts/art). They are drawn by one image tag (components/landing/Hero.jsx), tested below.
    expect(pictures(publicDir).map((f) => String(f).replace(/\\/g, '/')).sort()).toEqual(['favicon.svg', 'img/hero-night-sm.webp', 'img/hero-night.webp', 'og-image.png']);
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
    // the logos beside a name are drawn in one place now, the shared avatar (EntityCard: the cards, the rows, the previews and the company's panel); the investors' own are the other
    // (components/investors/common.jsx draws two: a firm's logo and a person's picture, which is drawn only from a secure address a record holds)
    expect(all.map((i) => i.file).sort()).toEqual(['components/EntityCard.jsx', 'components/investors/common.jsx', 'components/investors/common.jsx', 'components/landing/Hero.jsx']);
  });

  it('has an alt (empty: the name is beside it), and decodes off the main thread', () => {
    for (const { file, tag } of all) {
      expect(tag, file).toMatch(/\balt=("[^"]*"|\{[^}]*\})/);
      expect(tag, file).toContain('decoding="async"');
    }
  });

  it('waits until it is near the screen (loading="lazy"), except the picture of the welcome page\'s opening, which is the first thing on it', () => {
    for (const { file, tag } of all.filter((i) => i.file !== 'components/landing/Hero.jsx')) expect(tag, file).toContain('loading="lazy"');
    const hero = all.find((i) => i.file === 'components/landing/Hero.jsx').tag;
    expect(hero).not.toContain('lazy');
    expect(hero).toContain('fetchPriority="high"');
    expect(hero).toContain('alt=""'); // the picture says nothing a screen reader needs: the words on it are live text
  });

  it('gives the opening\'s picture its size and a narrower file for a phone, so the page does not move and a phone does not download the wide one', () => {
    const hero = text(path.join(src, 'components', 'landing', 'Hero.jsx'));
    expect(hero).toMatch(/<img src="\/img\/hero-night\.webp" width="3200" height="2158"/);
    expect(hero).toMatch(/<source media="\(max-width: 700px\)" srcSet="\/img\/hero-night-sm\.webp"/);
  });

  it('is given its size, where it sits in a box that is the same on every screen, so the page does not move as logos arrive', () => {
    for (const { file, tag } of all.filter((i) => ['components/EntityCard.jsx'].includes(i.file))) {
      expect(tag, file).toMatch(/\bwidth=(?:"\d+"|\{size\})/); // the avatar's size is its own prop, 40 unless a card says otherwise
      expect(tag, file).toMatch(/\bheight=(?:"\d+"|\{size\})/);
    }
  });
});

describe('the map\'s pins, built as elements', () => {
  it('decode their logos off the main thread, show one only once it has loaded, and ask nobody else\'s service for it', () => {
    const map = text(path.join(src, 'components', 'MapView.jsx'));
    expect(map).toContain("img.decoding = 'async'");
    expect(map).toContain('isRealLogo(img)'); // a picture too small to be a logo (the service's 16-pixel globe) is not drawn
    expect(map).toContain("img.onerror = () => { img.style.display = 'none'; }");
    // a pin\'s logo is the company\'s own `logo` address when the record has one, else the picture its website gives, from the one source every card on
    // the site uses (logo.js); the map names no other service
    expect(map).toContain("import { logoUrl, isRealLogo } from '../logo.js';");
    expect(map).toContain('logo || (domain ? logoUrl(domain, 96) : null)');
    expect(map).not.toMatch(/gstatic|clearbit|favicon/i);
  });
});
