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
const explore = css('explore.css');

const token = (text, name) => new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(text)?.[1].trim();

// WCAG contrast, from the hex colours themselves.
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

describe('the design system, in the hand-written CSS', () => {
  it('names the six colours of the brief as variables at :root, with the values the brief gives', () => {
    expect(token(styles, '--paper')).toBe('#0a0e0f'); // bg
    expect(token(styles, '--panel')).toBe('#14181a'); // surface
    expect(token(styles, '--line')).toBe('#22282a'); // border
    expect(token(styles, '--ink')).toBe('#e8e6de'); // text
    expect(token(styles, '--muted')).toBe('#8a8f8c');
    expect(token(styles, '--accent')).toBe('#3ecf6e');
    // the brief's names are the same values, not second colours
    expect(token(styles, '--bg')).toBe('var(--paper)');
    expect(token(styles, '--surface')).toBe('var(--panel)');
    expect(token(styles, '--border')).toBe('var(--line)');
    expect(token(styles, '--text')).toBe('var(--ink)');
  });

  it('has an 8px spacing scale, a 12px radius, a pill, and a 1120px page width', () => {
    expect(token(styles, '--space-1')).toBe('8px');
    for (const [name, px] of [['--space-2', 16], ['--space-3', 24], ['--space-4', 32], ['--space-6', 48], ['--space-8', 64], ['--space-10', 80]]) expect(token(styles, name), name).toBe(`${px}px`);
    expect(token(styles, '--radius')).toBe('12px');
    expect(token(styles, '--card-radius')).toBe('12px');
    expect(token(styles, '--radius-pill')).toBe('999px');
    expect(token(styles, '--maxw')).toBe('1120px');
    expect(token(landing, '--l-max')).toBe('var(--maxw)');
  });

  it('uses Inter with the system face as its fallback, everywhere: the page, the landing, and the no-JavaScript directory', () => {
    expect(token(styles, '--font')).toMatch(/^'Inter Variable',\s*'Inter',\s*system-ui/); // the variable file served with the site (main.jsx), then an installed Inter
    expect(styles).toMatch(/html,body,#root\{[^}]*font-family:var\(--font\)/);
    expect(token(landing, '--l-font')).toBe('var(--font)');
    expect(readFileSync(path.join(src, 'LandingPage.jsx'), 'utf8')).not.toMatch(/geist/i);
    expect(readFileSync(path.join(src, '..', '..', 'backend', 'src', 'routes', 'directory.js'), 'utf8')).toMatch(/font-family:'Inter',system-ui/);
  });

  it('has no Courier, no paper or ochre left, and does not switch Tailwind or shadcn on for the whole app', () => {
    // (Georgia may sit in the fallback stack of the one italic word's face, --l-serif, and nowhere else)
    const withoutSerifFallback = (text) => text.replace(/--l-serif:[^;]*;/, '');
    for (const [name, text] of [['styles.css', styles], ['landing.css', landing], ['landing-hero.css', hero], ['investors.css', investors]]) {
      expect(withoutSerifFallback(text), name).not.toMatch(/courier|georgia|#c05a2e|#f6f3ec|#d8d2c2|ochre/i);
    }
    // shadcn.css pulls in Tailwind's reset, which would restyle every page: nothing the app loads imports it
    for (const file of ['main.jsx', 'App.jsx', 'LandingPage.jsx', 'styles.css', 'landing.css']) expect(readFileSync(path.join(src, file), 'utf8'), file).not.toMatch(/shadcn\.css|@import\s+["']tailwindcss/);
  });
});

describe('the one card', () => {
  it('is drawn the same for a company, a person and a firm: the shared box, a two-line description, a row with a dot between', () => {
    expect(styles).toMatch(/\.entity-blurb\{[^}]*-webkit-line-clamp:2/);
    // the dot ends the item before it, so a row that wraps never starts a line with one
    expect(styles).toMatch(/\.meta-row li:not\(:last-child\)::after\{[^}]*content:'\\00b7'/);
    expect(styles).toMatch(/\n\.sr-only\{[^}]*clip-path:inset\(50%\)/); // text for a screen reader is hidden on every page, not only the investors'
    expect(styles).toMatch(/\.entity-avatar\{[^}]*border-radius:50%/);
    // it hovers like every card: the accent border and a lift, which stop for a visitor who has asked for less motion
    expect(styles).toMatch(/\.entity-card:hover\{[^}]*border-color:rgb\(var\(--accent-rgb\) \/ \.45\)[^}]*translateY\(-2px\)/);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)\{[^@]*\.entity-card:hover\{ transform:none; \}/);
    // the six places a company, person or firm is drawn all use it
    for (const file of ['components/ListView.jsx', 'components/JobsView.jsx', 'components/people/PersonCard.jsx', 'components/people/InstitutionCard.jsx', 'components/investors/InvestorCard.jsx', 'LandingPage.jsx']) {
      expect(readFileSync(path.join(src, file), 'utf8'), file).toContain('<EntityCard');
    }
  });
});

describe('the map\'s pins', () => {
  it('is a 44px place to press, with a 14px dot or a 36px white tile in it, the tile with a rounded square\'s corners and a soft shadow, and a hover that grows it', () => {
    expect(explore).toMatch(/\.custom-pin-badge\{[^}]*width:44px;height:44px/);
    expect(explore).toMatch(/\.pin-dot \.pin-face\{width:14px;height:14px;border-radius:50%/);
    expect(explore).toMatch(/\.pin-tile \.pin-face\{width:36px;height:36px;border-radius:10px;[^}]*background:#f4f6f8[^}]*box-shadow:0 4px 14px/);
    expect(explore).toMatch(/\.custom-pin-badge:hover \.pin-face\{transform:scale\(1\.14\)/);
    expect(styles).toMatch(/\.inst-pin:hover\{transform:scale\(1\.1\)/);
  });

  it('marks the open company with a ring in the page\'s accent, and a suburb\'s pin with a dashed edge', () => {
    expect(explore).toMatch(/\.pin-selected \.pin-face\{[^}]*0 0 0 3px var\(--accent\)/);
    expect(explore).toMatch(/\.pin-approx \.pin-face\{outline:1\.5px dashed/);
  });

  it('puts the name under the pin on a dark card with an 8px radius, in bold 12px', () => {
    const label = /\.pin-label\{([^}]*)\}/.exec(explore)[1];
    expect(label).toMatch(/background:rgb\(16 20 22/);
    expect(label).toMatch(/border-radius:8px/);
    expect(label).toMatch(/font-size:12px/);
    expect(label).toMatch(/font-weight:600/);
  });

  it('draws a cluster as a ring in the one accent, sized by how many it holds: no amber, no orange, no second green', () => {
    const cluster = /\.marker-cluster-inner\{([^}]*)\}/.exec(explore)[1];
    expect(cluster).toMatch(/border:1\.5px solid rgb\(var\(--accent-rgb\)/);
    expect(cluster).toMatch(/color:var\(--accent-ink\)/);
    expect(explore).toMatch(/\.cluster-large\{width:62px;height:62px/);
    expect(`${styles}${explore}`).not.toMatch(/#fbbf24|#f97316|#4ade80/i);
  });

  it('leaves the old white ring and its sector colours behind: they are in neither stylesheet', () => {
    expect(styles).not.toMatch(/\.custom-pin-badge|\.pin-fallback|\.pin-label|\.marker-cluster-inner/);
    expect(explore).not.toMatch(/border:3px solid #fff/);
  });

  it('draws a firm as a rounded square with the accent as its outline, so it is not taken for a company', () => {
    const inst = /\.inst-pin\{([^}]*)\}/.exec(styles)[1];
    expect(inst).toMatch(/border-radius:12px/);
    expect(inst).toMatch(/border:3px solid var\(--accent\)/);
  });

  it('opens a pin as a card in the app\'s own colours with one accent button, and keeps its focus ring', () => {
    expect(styles).toMatch(/\.pin-popup \.leaflet-popup-content-wrapper\{[^}]*background:var\(--panel\)/);
    expect(styles).toMatch(/\.pin-pop-cta\{[^}]*background:var\(--accent\)/);
    expect(styles).toMatch(/\.pin-pop-cta:focus-visible[^{]*\{outline:2px solid var\(--accent\)/);
  });

  it('has a light basemap whose group rings are dark, so they do not vanish on it', () => {
    expect(styles).toMatch(/#map\[data-basemap="light"\] \.area-ring\{border-color:rgba\(20,24,26/);
  });

  it('stops the pins\' and the controls\' motion for a visitor who has asked for less', () => {
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)\{\n  \.inst-pin\{transition:none;\}\n  \.inst-pin:hover\{transform:none;\}/);
    expect(explore).toMatch(/@media \(prefers-reduced-motion: reduce\)\{\n  \.pin-face,\.marker-cluster-inner\{transition:none;\}\n  \.custom-pin-badge:hover \.pin-face,\.marker-cluster-inner:hover\{transform:none;\}/);
  });
});

describe('the panel on the left and the news pill', () => {
  it('is a panel that slides in beside the map (340px, and 360px on the map\'s page), and stops sliding for a visitor who has asked for less', () => {
    expect(styles).toMatch(/:root\{--panel-w:340px;\}/);
    expect(token(explore, '--panel-w')).toBe('360px');
    const panel = /\.map-panel\{([^}]*)\}/.exec(styles)[1];
    expect(panel).toMatch(/width:var\(--panel-w\)/);
    expect(panel).toMatch(/max-width:88vw/);
    expect(panel).toMatch(/top:0/); // in the map's area, which starts under the header and the toolbar
    expect(panel).toMatch(/z-index:700/); // over everything the map floats (the news pill 600, the card and the dock 480)
    expect(panel).toMatch(/animation:map-panel-in/);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)\{\n  \.map-panel\{animation:none;\}/);
  });

  it('stands beside the map on a wide screen (no scrim), and under 900px it is a sheet that comes up from the bottom, over a scrim', () => {
    expect(styles).toMatch(/\.map-panel-scrim\{[^}]*position:absolute;top:0;[^}]*z-index:690/);
    const wide = /@media \(min-width:900px\)\{([\s\S]*?)\n\}/.exec(styles)[1];
    expect(wide).toMatch(/\.map-panel-scrim\{display:none;\}/);
    const narrow = /@media \(max-width:899px\)\{([\s\S]*?)\n\}\n@keyframes xp-sheet-up/.exec(explore)[1];
    expect(narrow).toMatch(/\.xp \.map-panel\{[^}]*position:fixed;top:auto;left:0;right:0;bottom:0;[^}]*border-radius:20px 20px 0 0/);
    expect(narrow).toMatch(/\.xp \.map-panel-scrim\{position:fixed;inset:0;[^}]*display:block;\}/);
    // the card, the dock, the title and the list make room for it on a wide screen
    for (const selector of ['.xp.panel-open .xm-preview', '.xp.panel-open .xd', '.xp.panel-open .xm-title', '.xp.panel-open #startupListView']) expect(explore).toContain(selector);
    expect(explore).toMatch(/\.xp\.panel-open #startupListView\{padding-left:calc\(var\(--panel-w\) \+ 28px\);\}/);
  });

  it('keeps a visible focus ring on its tabs', () => {
    expect(styles).toMatch(/\.map-panel-tab:focus-visible\{outline:2px solid var\(--accent\)/);
  });

  it('shows the news as a small pill while shut: the card\'s frame is dropped, and the pill has a focus ring', () => {
    expect(styles).toMatch(/#newsTicker\.nt-collapsed\{[^}]*background:none;border:none[^}]*box-shadow:none;overflow:visible/);
    const pill = /\.nt-pill\{([^}]*)\}/.exec(styles)[1];
    expect(pill).toMatch(/min-height:36px/);
    expect(pill).toMatch(/border-radius:var\(--radius-pill\)/);
    expect(styles).toMatch(/\.nt-pill:focus-visible\{outline:2px solid var\(--accent\)/);
  });
});

describe('the map\'s page (explore.css)', () => {
  const ground = '#15191c'; // the header's and the toolbar's
  const mint = token(explore, '--accent');
  const mintInk = token(explore, '--accent-ink');
  const topLevel = rulesOf(explore).map(([selector]) => selector).filter((selector) => !selector.startsWith('@') && !/^(from|to)$/.test(selector));

  it('takes a pale mint for its accent, at .xp only, and dark text on it that can be read', () => {
    expect(mint).toBe('#9fd8bc');
    expect(token(explore, '--accent-rgb')).toBe('159 216 188'); // the same mint, for tints
    expect(/\.xp\{[^}]*--accent:#9fd8bc/.test(explore)).toBe(true);
    expect(contrast(token(explore, '--on-accent'), mint)).toBeGreaterThanOrEqual(7); // the Add startup and View company buttons
    expect(contrast(mintInk, ground)).toBeGreaterThanOrEqual(7); // a count, a hiring label, the number in a ring
    expect(contrast(mint, ground)).toBeGreaterThanOrEqual(7); // the underline, the ring round the open pin, the icon of a saved company
    expect(contrast(token(styles, '--muted'), ground)).toBeGreaterThanOrEqual(4.5);
  });

  it('does not reach another page: every rule is the map page\'s own (its prefix, its pins, its menu or its map controls)', () => {
    const OWN = /\.(xp|xh|xt|xm|xd|xo|xs)\b|\.(hdr-menu|custom-leaflet-marker|custom-pin-badge|pin-|marker-cluster|cluster-|leaflet-)/;
    for (const selector of topLevel) {
      for (const part of selector.split(',')) expect(OWN.test(part.trim()), part.trim()).toBe(true);
    }
  });

  it('has a 72px header with a name, four places and one action, and moves the places into the menu under 900px', () => {
    expect(explore).toMatch(/\.xh\{[^}]*height:72px/);
    expect(explore).toMatch(/\.xh \.xh-title\{[^}]*font-size:24px;font-weight:600/);
    expect(explore).toMatch(/\.xh-link\[aria-current="page"\]::after\{[^}]*height:2px[^}]*background:var\(--accent\)/);
    expect(explore).toMatch(/@media \(max-width:899px\)\{[\s\S]*\.xh-nav\{display:none;\}[\s\S]*\.hdr-menu-mobile-nav\{display:flex;flex-direction:column;gap:2px;\}/);
    expect(explore).toMatch(/\.xh-add-text\{display:none;\}/);
  });

  it('makes what is pressed big enough: 44px in the header, 46px in the toolbar, 52px on the card, and a 60px row in the phone\'s sheet', () => {
    expect(explore).toMatch(/\.xh-add\{[^}]*height:44px/);
    expect(explore).toMatch(/\.xh-more\{[^}]*width:44px;height:44px/);
    expect(explore).toMatch(/\.xt-btn\{[^}]*height:46px/);
    expect(explore).toMatch(/\.xt-view\{[^}]*height:46px/);
    expect(explore).toMatch(/\.xp-cta\{[^}]*height:52px/);
    expect(explore).toMatch(/\.xp-save\{[^}]*width:52px;height:52px/);
    expect(explore).toMatch(/\.xs-row\{[^}]*min-height:60px/);
    expect(explore).toMatch(/\.xd-city\{height:42px/);
  });

  it('is a grid of two rows on a phone, with the sectors left to the filters', () => {
    const narrow = /@media \(max-width:899px\)\{([\s\S]*?)\n\}\n@keyframes xp-sheet-up/.exec(explore)[1];
    expect(narrow).toMatch(/\.xt\{display:grid;grid-template-columns:minmax\(0,1fr\) auto;/);
    expect(narrow).toMatch(/\.xt-search\{grid-area:2 \/ 1;/);
    expect(narrow).toMatch(/\.xt-menu\{display:none;\}/);
  });

  it('draws the phone\'s sheet shut at 70px and open at most 560px tall, and lets a card in it take its own height', () => {
    expect(explore).toMatch(/\.xs-peek\{height:calc\(70px \+ env\(safe-area-inset-bottom\)\);\}/);
    expect(explore).toMatch(/\.xs-open\{height:min\(64%,560px\);\}/);
    expect(explore).toMatch(/\.xs-detail\{height:auto;max-height:80%;overflow-y:auto;\}/);
  });

  it('keeps a visible focus ring on what can be pressed in the header, the toolbar, the card and the dock', () => {
    expect(explore).toMatch(/\.xh button:focus-visible,\.xt button:focus-visible[^{]*\{outline:2px solid var\(--accent\)/);
    expect(explore).toMatch(/\.xp-card button:focus-visible\{outline:2px solid var\(--accent\)/);
    expect(explore).toMatch(/\.xd-city:focus-visible\{outline:2px solid var\(--accent\)/);
    expect(explore).toMatch(/\.xo:focus-visible\{outline:2px solid var\(--accent\)/);
  });

  it('is loaded by the app only: the landing page and the plain pages never fetch it', () => {
    expect(readFileSync(path.join(src, 'App.jsx'), 'utf8')).toContain("import './explore.css';");
    for (const file of ['main.jsx', 'LandingPage.jsx', 'InfoPage.jsx']) expect(readFileSync(path.join(src, file), 'utf8'), file).not.toContain('explore.css');
  });
});

describe('the table, the switch and the strip of what is new', () => {
  it('scrolls a table that is too wide for the screen inside its own box, so the page does not scroll sideways', () => {
    expect(styles).toMatch(/\.startup-table-wrap\{[^}]*overflow-x:auto/);
    expect(styles).toMatch(/\.startup-table\{[^}]*width:100%;border-collapse:collapse/);
  });

  it('keeps a visible focus ring on what can be pressed in them', () => {
    for (const selector of ['\\.st-sort', '\\.st-open', '\\.startup-layout-btn', '\\.new-week-item']) {
      expect(styles).toMatch(new RegExp(`${selector}:focus-visible\\{[^}]*outline:2px solid var\\(--accent\\)`));
    }
  });

  it('makes the cards\' avatar smaller in a table row and in the strip', () => {
    expect(styles).toMatch(/\.startup-table \.entity-avatar\{width:28px;height:28px/);
    expect(styles).toMatch(/\.new-week-item \.entity-avatar\{width:28px;height:28px/);
  });

  it('lays the list to the right of the panel when it is open beside the map', () => {
    expect(explore).toMatch(/\.xp\.panel-open #startupListView\{padding-left:calc\(var\(--panel-w\) \+ 28px\);\}/);
  });
});

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

  it('keeps a section to the scale: a display size, a heading size, the lede under it, and two text sizes (body and small), and nothing else', () => {
    const allowed = new Set(['var(--fs-display)', 'var(--fs-figure)', 'var(--fs-heading)', 'var(--fs-lede)', 'var(--fs-body)', 'var(--fs-small)']);
    const heroSection = hero.slice(hero.indexOf('/* Hero */'), hero.indexOf('/* The picture'));
    for (const [name, text] of [['landing.css', landing.slice(landing.indexOf('/* A section opens'))], ['hero section', heroSection]]) {
      const sizes = [...text.matchAll(/(?<![-\w])font-size:\s*([^;}]+)/g)].map((m) => m[1].trim());
      expect(sizes.length, name).toBeGreaterThan(3);
      for (const size of sizes) expect(allowed.has(size), `${name}: ${size}`).toBe(true);
    }
    // the landing's names are the app's three sizes, not three of its own
    expect(token(landing, '--fs-lede')).toBe('var(--t-lede)');
    expect(token(landing, '--fs-body')).toBe('var(--t-body)');
    expect(token(landing, '--fs-small')).toBe('var(--t-small)');
    expect(token(styles, '--t-lede')).toBe('17px');
    // text a person reads is never under 15px; the 13px size is for labels (a section's number, a count, a date) and the small print
    expect(token(styles, '--t-body')).toBe('15px');
    expect(token(styles, '--t-small')).toBe('13px');
    expect(landing).toMatch(/\.sec-rule\{[^}]*font-size: var\(--fs-small\)/);
    // the lede is the line under a headline: the section's intro and the hero's, and nothing else (a button is body text)
    const ledes = [...`${landing}\n${hero}`.matchAll(/([^{}]+)\{[^{}]*font-size:\s*var\(--fs-lede\)/g)].map((m) => m[1].trim().replace(/\s+/g, ' '));
    expect(ledes.sort()).toEqual(['.hero-lede', '.landing-list-name', '.landing-section-head p']);
    expect(landing).toMatch(/\.landing-btn-primary, \.landing-btn-secondary\{[^}]*font-size: var\(--fs-body\)/);
  });

  it('sets the picture\'s own labels in one size, which grows and shrinks with the picture and is never under 12px', () => {
    expect(hero).toMatch(/--eco-fs: clamp\(12px, 2\.1cqi, 13\.5px\)/);
    expect(hero).toMatch(/\.eco-city\{[^}]*font-size: 1em/);
    expect(hero).toMatch(/\.eco-chip-link\{[^}]*font-size: 1em/);
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
    // three across on a desktop, so six cards are two full rows (and each "Load more" adds two more)
    expect(landing).toMatch(/\.landing-job-grid > \*, \.landing-list-grid > \*, \.landing-people-grid > \*\{ grid-column: span 4; \}/);
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

// ---- the text on the pages, the grid of cards, readable text and what can be pressed ----

const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');
const rulesOf = (text) => [...withoutComments(text).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => [selector.trim().replace(/\s+/g, ' '), body]);
const sizeOf = (body) => /(?<![-\w])font-size:\s*([^;}]+)/.exec(body)?.[1].trim();
const people = css('people.css');

describe('the text on the pages', () => {
  const TEXT = new Set(['var(--t-body)', 'var(--t-small)']);

  it('is body and small, the app\'s two text sizes, on the content pages: the card, the table, the lists, the news, the dialogs and the footer', () => {
    const sizes = new Map(rulesOf(styles).filter(([, body]) => sizeOf(body)).map(([selector, body]) => [selector, sizeOf(body)]));
    const content = [
      '.entity-blurb', '.meta-row', '.index-row', '.index-row-label', '.verified-note', '.badge-unverified', '.hiring-badge', '.vouch-badge', '.concept-label',
      '.job-card-meta', '.jobs-subhead', '.jobs-filters select', '.jobs-filter-count', '.news-meta', '.news-headline',
      '.curated-card-category', '.curated-card-desc', '.curated-card-count', '.list-banner-kicker', '.list-banner-desc', '.list-banner-count',
      '.startup-table', '.startup-table thead th', '.st-tags li', '.startup-list-count', '.startup-list-sort', '.startup-layout-btn',
      '.new-week-title', '.new-week-name', '.new-week-what', '.event-badge',
      '.sdp-meta-value', '.sdp-meta-note', '.sdp-hiring-note', '.sdp-source-meta', '.sdp-sources-list', '.pc', '.pc-desc', '.pc-section-label', '.pc-inv-name', '.pc-founder-name',
      '.vouch blockquote', '.vouch figcaption', '.modal-sub', '.modal-panel label', '.modal-panel .hint', '.form-error', '.taskbtn', '.linkbtn',
      '.site-brand-link', '.site-brand-map', '.pin-pop-fresh', '.pin-pop-report',
    ];
    for (const selector of content) expect(TEXT.has(sizes.get(selector)), `${selector} is ${sizes.get(selector)}`).toBe(true);
    // a card's name is its heading, and takes the heading's size
    expect(sizes.get('.entity-name')).toBe('17px');
  });

  it('is body and small in the investor and people pages too: no size of its own under 17px, but a heading, an initial in a logo and a table\'s initial', () => {
    const OWN = { 'investors.css': ['.inv-logo-initial', '.inv-correct h2'], 'people.css': [] };
    for (const [name, text] of [['investors.css', investors], ['people.css', people]]) {
      const own = rulesOf(text).filter(([, body]) => { const size = sizeOf(body); return size && /^[\d.]+px$/.test(size) && parseFloat(size) < 17; }).map(([selector]) => selector);
      expect(own, name).toEqual(OWN[name]);
      expect(text.match(/var\(--t-(body|small)\)/g)?.length ?? 0, name).toBeGreaterThan(10);
    }
  });
});

describe('the grid of cards', () => {
  const FOUR = '.jobs-grid, .startup-grid, .curated-list-grid, .inv-grid';
  const CHILDREN = FOUR.split(', ').map((s) => `${s} > *`).join(', ');

  it('has twelve columns for the jobs, the list, the lists and the investors and people, and each card takes 12, then 6, then 4 of them as the grid\'s own width grows', () => {
    const rules = rulesOf(styles);
    const grid = rules.find(([selector]) => selector === FOUR);
    expect(grid[1]).toMatch(/display:grid; grid-template-columns:repeat\(12,minmax\(0,1fr\)\)/);
    expect(grid[1]).toContain('container-type:inline-size');
    const spans = rules.filter(([selector]) => selector === CHILDREN).map(([, body]) => /grid-column:span (\d+)/.exec(body)[1]);
    expect(spans).toEqual(['12', '6', '4']);
    expect(styles).toMatch(/@container \(min-width:600px\)\{\s*\.jobs-grid > \*/);
    expect(styles).toMatch(/@container \(min-width:900px\)\{\s*\.jobs-grid > \*/);
  });

  it('is the only place that says how many columns they have: no auto-fill, no 3-column rule of its own', () => {
    for (const [name, text] of [['styles.css', styles], ['investors.css', investors], ['people.css', people]]) {
      for (const [selector, body] of rulesOf(text)) {
        if (selector === FOUR) continue;
        if (/(^|, )\.(jobs-grid|startup-grid|curated-list-grid|inv-grid|people-grid)( |$|,)/.test(selector) && !selector.includes('>')) expect(body, `${name} ${selector}`).not.toMatch(/grid-template-columns|display:\s*grid/);
      }
    }
  });

  it('lays an investor\'s page on twelve columns too: the page takes eight, and the facts beside it four', () => {
    expect(investors).toMatch(/\.inv-profile-body \{ grid-template-columns: repeat\(12, minmax\(0, 1fr\)\)/);
    expect(investors).toMatch(/\.inv-profile-main \{ grid-column: 1 \/ span 8;/);
    expect(investors).toMatch(/\.inv-profile-facts \{ grid-column: 9 \/ -1;/);
  });
});

describe('text that can be read, and what can be pressed', () => {
  it('sets the company\'s panel header in the ink that reads on the company\'s colour, not in white', () => {
    expect(styles).toMatch(/\.pc-hero\{[^}]*color:var\(--on-sector,#fff\)/);
    for (const selector of ['.sdp-close', '.sdp-track', '.pc-avatar-fallback', '.pc-hero .verified-note']) {
      const body = rulesOf(styles).find(([s]) => s === selector)[1];
      expect(body, selector).toContain('var(--on-sector,#fff)');
    }
    expect(readFileSync(path.join(src, 'components', 'StartupDetailPanel.jsx'), 'utf8')).toContain("'--on-sector': readableOn(sectorColor)");
  });

  it('gives what can be pressed at least 24px of height (WCAG 2.2 AA), as padding or as a minimum, though its text is smaller', () => {
    const body = rulesOf(styles).find(([selector]) => selector.startsWith('.site-brand-link, .site-brand-map, .index-row a'))[1];
    expect(body).toMatch(/display:inline-flex; align-items:center; min-height:24px/);
    for (const selector of ['.site-brand-link', '.index-row a', '.st-sort', '.inv-card-link', '.inv-back', '.person-request']) {
      expect(rulesOf(styles).find(([s]) => s.split(', ').includes(selector)), selector).toBeTruthy();
    }
  });

  it('stops every animation and transition for a visitor who has asked for less motion, as a net under the rules that stop their own', () => {
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)\{\n\s*\*, \*::before, \*::after\{ animation-duration:\.01ms !important; animation-iteration-count:1 !important; transition-duration:\.01ms !important; scroll-behavior:auto !important; \}/);
    // and the page's own never starts one that only reduced motion could stop: nothing autoplays
    expect(`${styles}${landing}${hero}${investors}${people}`).not.toMatch(/<video|autoplay/i);
  });
});

describe('the endorsement', () => {
  it('is set as a quotation, with who said it under it in muted text, and has no coloured edge', () => {
    expect(styles).toMatch(/\.vouch figcaption\{[^}]*color:var\(--muted\)/);
    expect(styles).toMatch(/\.vouch blockquote p::before\{ content:'\\201c'; \}/);
    expect(styles).not.toMatch(/\.vouch[^{]*\{[^}]*border-left/);
  });
});

describe('the investors page (investors.css): one design in two themes', () => {
  const themeBlock = (name) => new RegExp(`#investorsView\\[data-theme='${name}'\\] \\{([^}]*)\\}`).exec(investors)[1];
  const light = themeBlock('light');
  const dark = themeBlock('dark');
  const props = (block) => [...block.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]).sort();

  it('has a light theme (a warm off-white page, white cards, one orange) and a dark one (the map page\'s own mint), each a set of the same tokens', () => {
    expect(token(light, '--paper')).toBe('#f8f7f4');
    expect(token(light, '--panel')).toBe('#ffffff');
    expect(token(light, '--accent')).toBe('#d4430d');
    expect(token(dark, '--accent')).toBe(token(explore, '--accent')); // the same mint as the map's page
    expect(token(dark, '--on-accent')).toBe(token(explore, '--on-accent'));
    expect(props(light)).toEqual(props(dark));
    expect(light).toMatch(/color-scheme: light;/);
    expect(dark).toMatch(/color-scheme: dark;/);
  });

  it('can be read in the light theme: white on the orange fill, the orange as text on the page and on a selected card, the muted text on both', () => {
    const [paper, panel, accent, ink, tint] = ['--paper', '--panel', '--accent', '--accent-ink', '--inv-tint'].map((n) => token(light, n));
    expect(contrast(token(light, '--on-accent'), accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ink, paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ink, panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ink, tint)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token(light, '--ink'), paper)).toBeGreaterThanOrEqual(7);
    expect(contrast(token(light, '--inv-soft'), paper)).toBeGreaterThanOrEqual(7);
    expect(contrast(token(light, '--muted'), paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token(light, '--muted'), panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token(light, '--muted'), tint)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token(light, '--xh-dim'), token(light, '--xp-bar'))).toBeGreaterThanOrEqual(4.5); // the header's links
    expect(contrast(token(light, '--xp-placeholder'), token(light, '--xp-field'))).toBeGreaterThanOrEqual(4.5); // a hint in the search box
  });

  it('can be read in the dark theme too', () => {
    const [paper, panel, accent, ink] = ['--paper', '--panel', '--accent', '--accent-ink'].map((n) => token(dark, n));
    expect(contrast(token(dark, '--on-accent'), accent)).toBeGreaterThanOrEqual(7);
    expect(contrast(ink, panel)).toBeGreaterThanOrEqual(7);
    expect(contrast(token(dark, '--ink'), paper)).toBeGreaterThanOrEqual(7);
    expect(contrast(token(dark, '--muted'), paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token(dark, '--muted'), panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token(dark, '--xh-dim'), token(dark, '--xp-bar'))).toBeGreaterThanOrEqual(7);
  });

  it('does not reach another page: every rule is the investors\' own, and the themes are set on the page\'s own root, never on :root', () => {
    const OWN = /#investorsView|\.inv-|\.xh-theme/;
    const selectors = rulesOf(investors).map(([selector]) => selector).filter((selector) => !selector.startsWith('@') && !/^(from|to)$/.test(selector));
    for (const selector of selectors) for (const part of selector.split(',')) expect(OWN.test(part.trim()), part.trim()).toBe(true);
    expect(investors).not.toMatch(/:root\s*\{/);
  });

  it('keeps the card the app\'s one card, a little roomier here through its own tokens', () => {
    expect(token(investors.slice(investors.indexOf('#investorsView {')), '--card-radius')).toBe('14px');
    expect(token(investors.slice(investors.indexOf('#investorsView {')), '--card-pad')).toBe('24px');
    expect(investors).toMatch(/@media \(max-width: 639px\) \{\n  #investorsView \{ --card-pad: 20px; \}/);
    expect(readFileSync(path.join(src, 'components/investors/InvestorCard.jsx'), 'utf8')).toContain('<EntityCard');
  });

  it('makes what is pressed big enough: a 50px search and menus, 40px bookmarks and sort, 44px selects and, in a drawer, a 44px way back', () => {
    expect(investors).toMatch(/#investorsView \.inv-search \{[^}]*height: 50px/);
    expect(investors).toMatch(/#investorsView \.xt-btn \{ height: 50px;/);
    expect(investors).toMatch(/\.inv-save \{[^}]*width: 40px; height: 40px/);
    expect(investors).toMatch(/\.inv-select \{[^}]*height: 44px/);
    expect(investors).toMatch(/\.inv-panel-drawer \.inv-panel-back \{ min-height: 44px;/);
    expect(investors).toMatch(/\.inv-panel-visit, \.inv-panel-apply \{[^}]*height: 44px/);
  });

  it('puts the panel beside the results from 1000px, sticky and scrolling by itself, and a full-screen drawer under it, with the page behind it still', () => {
    expect(investors).toMatch(/@media \(min-width: 1000px\) \{\n  \.inv-split-open \{ grid-template-columns: minmax\(0, 1fr\) clamp\(440px, 40vw, 620px\); \}/);
    expect(investors).toMatch(/\.inv-panel-side \{ position: sticky; top: 88px; max-height: calc\(100vh - 104px\); overflow-y: auto;/);
    expect(investors).toMatch(/@media \(max-width: 999px\) \{\n  \.inv-panel-drawer \{\n    position: fixed; inset: 0; z-index: 1500;/);
    expect(investors).toMatch(/#investorsView\.inv-locked \{ overflow: hidden; \}/);
  });

  it('lets the focus and the companies give way when the results are narrow, so a table never scrolls sideways beside the panel, and stacks it on a phone', () => {
    expect(investors).toMatch(/@container \(max-width: 760px\) \{ \.inv-col-focus, \.inv-col-companies \{ display: none; \} \}/);
    expect(investors).toMatch(/@media \(max-width: 899px\) \{\n  \.inv-views \{ display: none !important; \}/);
    expect(investors).toMatch(/\.inv-results \{ min-width: 0; container-type: inline-size; \}/);
  });

  it('stops its motion for a visitor who has asked for less: the panel, the drawer and the cards', () => {
    expect(investors).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.inv-panel, \.inv-profile \{ animation: none; \} \}/);
    expect(investors).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.inv-panel-drawer \{ animation: none; \} \}/);
    expect(investors).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n  \.inv-card, \.inv-card-arrow, \.inv-card-cta \{ transition: none; \}/);
  });

  it('shows the filter menus on a phone, though the map\'s toolbar hides its own there', () => {
    expect(explore).toMatch(/\.xt-menu\{display:none;\}/);
    expect(investors).toMatch(/#investorsView \.xt-menu \{ display: block; \}/);
  });
});
