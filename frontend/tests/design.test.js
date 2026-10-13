// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The design's rules, as checks on the stylesheets: one accent, text that can be read on the ground, one card, a type scale that a
// section does not stray from, and motion that stops when it is asked to.

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const css = (name) => readFileSync(path.join(src, name), 'utf8').replace(/\r\n/g, '\n');
const styles = css('styles.css');
const landing = css('landing.css');
const hero = css('landing-hero.css');
const investors = css('investors.css');

const token = (text, name) => new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(text)?.[1].trim();

// WCAG contrast, from the hex colours themselves.
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

describe('the colours', () => {
  const ground = token(styles, '--paper');
  const panel = token(styles, '--panel');
  const accent = token(styles, '--accent');
  const ink = token(styles, '--accent-ink');

  it('keeps the dark ground and has one accent, a neon green, with a lifted green for text', () => {
    expect(ground).toBe('#0a0e0f');
    expect(accent).toBe('#3ecf6e');
    expect(token(styles, '--accent-rgb')).toBe('62 207 110'); // the same green, for tints
    expect(contrast(ink, accent)).toBeGreaterThan(1.2); // lifted, not the same colour
  });

  it('can be read: the accent as a fill with dark text on it, the lifted green as text on the ground and on a panel, and the muted text beside it', () => {
    expect(contrast(token(styles, '--on-accent'), accent)).toBeGreaterThanOrEqual(7);
    expect(contrast(ink, ground)).toBeGreaterThanOrEqual(7);
    expect(contrast(ink, panel)).toBeGreaterThanOrEqual(7);
    expect(contrast(accent, ground)).toBeGreaterThanOrEqual(7);
    expect(contrast(token(styles, '--muted'), ground)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token(styles, '--muted'), panel)).toBeGreaterThanOrEqual(4.5);
  });

  it('has no second accent left in the stylesheets: no amber, and no other green drawn as the interface\'s', () => {
    for (const [name, text] of [['styles.css', styles], ['landing.css', landing], ['landing-hero.css', hero], ['investors.css', investors]]) {
      expect(text, name).not.toMatch(/#f5a623|#ffb84d|245, ?166, ?35/i);
    }
    expect(investors).toContain('--inv-ok: var(--accent-ink)');
    expect(styles).not.toMatch(/\.hiring-badge\{[^}]*#4ade80/);
  });

  it('puts the accent into small text only through the lifted green; the one word of display type may take the accent itself', () => {
    const withoutTheWord = hero.replace(/\.hero-title em\{[^}]*\}/, '');
    for (const [name, text] of [['styles.css', styles], ['landing.css', landing], ['landing-hero.css', withoutTheWord], ['investors.css', investors]]) {
      expect(text.match(/(^|[^-\w])color:\s*var\(--accent\)/g) ?? [], name).toEqual([]);
    }
    expect(hero).toMatch(/\.hero-title em\{[^}]*color: var\(--accent\)/);
  });
});

describe('the card', () => {
  const CARDS = ['.card', '.startup-card', '.job-card', '.inv-card', '.landing-job-card', '.landing-list-card', '.person-card'];
  const shared = styles.slice(styles.indexOf('/* The card.'));

  it('is one box for a company, a job, an investor, a list and a person: the same radius, border, padding and hover', () => {
    const rule = /\n((?:\.[\w-]+(?:, )?)+)\{([^}]*)\}/.exec(shared);
    for (const card of CARDS) expect(rule[1], card).toContain(card);
    expect(rule[2]).toContain('border:1px solid var(--line)');
    expect(rule[2]).toContain('border-radius:var(--card-radius)');
    expect(rule[2]).toContain('padding:var(--card-pad)');
    expect(token(styles, '--card-radius')).toBe('12px');
    expect(shared).toMatch(/transform:translateY\(-2px\)/);
  });

  it('is not given another radius, border or padding of its own anywhere', () => {
    for (const [name, text] of [['styles.css', styles.slice(0, styles.indexOf('/* The card.'))], ['landing.css', landing], ['investors.css', investors]]) {
      for (const card of ['startup-card', 'job-card', 'inv-card', 'landing-job-card', 'landing-list-card']) {
        const own = new RegExp(`\\n\\.${card}\\s*\\{([^}]*)\\}`, 'g');
        for (const [, body] of text.matchAll(own)) expect(body, `${name} .${card}`).not.toMatch(/border-radius|(?<![-\w])padding\s*:|(?<![-\w])border\s*:|box-shadow:\s*0 8px/);
      }
    }
  });

  it('lifts only when it is a link or a button, and stops lifting for a visitor who asks for less motion', () => {
    expect(shared).toMatch(/:is\(button, a\)\.card:hover/);
    expect(shared).not.toMatch(/\n\.card:hover/); // a card that goes nowhere does not invite a click
    const calm = shared.slice(shared.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(calm).toContain('transition:none');
    expect(calm).toContain('transform:none');
  });
});

describe('the landing page\'s type', () => {
  it('has a display size for the headline, as asked: clamp(40px, 7vw, 96px)', () => {
    expect(token(landing, '--fs-display')).toBe('clamp(40px, 7vw, 96px)');
    expect(hero).toMatch(/\.hero-title\{[^}]*font-size: var\(--fs-display\)[^}]*line-height: \.98/);
  });

  it('keeps a section to the scale: a display size, a heading size and two text sizes, and nothing else', () => {
    const allowed = new Set(['var(--fs-display)', 'var(--fs-figure)', 'var(--fs-heading)', 'var(--fs-body)', 'var(--fs-small)']);
    const heroSection = hero.slice(hero.indexOf('/* Hero */'), hero.indexOf('/* The picture'));
    for (const [name, text] of [['landing.css', landing.slice(landing.indexOf('/* A section opens'))], ['hero section', heroSection]]) {
      const sizes = [...text.matchAll(/(?<![-\w])font-size:\s*([^;}]+)/g)].map((m) => m[1].trim());
      expect(sizes.length, name).toBeGreaterThan(3);
      for (const size of sizes) expect(allowed.has(size), `${name}: ${size}`).toBe(true);
    }
    expect(token(landing, '--fs-body')).toBe('17px');
    expect(token(landing, '--fs-small')).toBe('13px');
  });

  it('sets one word in italic in a face that has an italic, and the numbers and labels in the monospace', () => {
    expect(hero).toMatch(/\.hero-title em\{[^}]*font-family: var\(--l-serif\)[^}]*font-style: italic/);
    expect(landing).toContain("'Instrument Serif'");
    expect(landing).toMatch(/\.sec-rule\{[^}]*font-family: var\(--l-mono\)/);
  });
});

describe('the grid', () => {
  it('has twelve columns for the landing page, and every block says how many it takes', () => {
    expect(landing).toMatch(/\.l-grid\{[^}]*grid-template-columns: repeat\(12, minmax\(0, 1fr\)\)/);
    expect(hero).toMatch(/\.hero-copy\{ grid-column: 1 \/ span 5; \}/);
    expect(hero).toMatch(/\.hero \.eco\{ grid-column: 6 \/ -1; \}/);
    expect(landing).toMatch(/\.landing-job-grid > \*\{ grid-column: span 3; \}/); // four across
  });
});

describe('motion', () => {
  it('rises into place only for a visitor who has not asked for less, and the picture\'s animations stop for one who has', () => {
    expect(styles).toMatch(/@media \(prefers-reduced-motion: no-preference\)\{\n  \.reveal\{/);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: no-preference\)\{[^@]*\.reveal:not\(\.is-in\)\{ opacity:0; transform:translateY\(14px\); \}/);
    expect(hero).toMatch(/@media \(prefers-reduced-motion: reduce\)\{\n  \.eco \*, \.eco-chip\{ animation: none !important/);
    expect(landing).toMatch(/@media \(prefers-reduced-motion: reduce\)\{\n  \.landing-btn-primary/);
    expect(`${styles}${landing}${hero}`).not.toMatch(/<video|autoplay/i);
  });
});

describe('the endorsement', () => {
  it('is set as a quotation, with who said it under it in muted text, and has no coloured edge', () => {
    expect(styles).toMatch(/\.vouch figcaption\{[^}]*color:var\(--muted\)/);
    expect(styles).toMatch(/\.vouch blockquote p::before\{ content:'\\201c'; \}/);
    expect(styles).not.toMatch(/\.vouch[^{]*\{[^}]*border-left/);
  });
});
