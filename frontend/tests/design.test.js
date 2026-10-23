// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The brand's rules (BRAND_GUIDELINES.md), as checks on the stylesheets: the tokens, text that can be read, one card, a type scale a page does not stray
// from, the shared components every page uses, and motion that stops when it is asked to.

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const css = (name) => readFileSync(path.join(src, name), 'utf8').replace(/\r\n/g, '\n');
const code = (name) => readFileSync(path.join(src, name), 'utf8').replace(/\r\n/g, '\n');
const styles = css('styles.css');
const brand = css('brand.css');
const landing = css('landing.css');
const welcome = css('welcome.css');
const investors = css('investors.css');
const explore = css('explore.css');
const people = css('people.css');
const info = css('info.css');

const token = (text, name) => new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(text)?.[1].trim();

// WCAG contrast, from the hex colours themselves.
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '');
const rulesOf = (text) => [...withoutComments(text).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => [selector.trim().replace(/\s+/g, ' '), body]);
const rule = (text, selector) => rulesOf(text).find(([s]) => s === selector)?.[1];
const sizeOf = (body) => /(?<![-\w])font-size:\s*([^;}]+)/.exec(body)?.[1].trim();

describe('the tokens', () => {
  it('names the ten colours of the brand at :root, with the values the brand gives', () => {
    const colours = {
      '--bg': '#ffffff', '--bg-subtle': '#fafaf7', '--text': '#171c19', '--text-2': '#626a65', '--green': '#234b3a', '--green-hover': '#193b2c',
      '--butter': '#f6e79a', '--coral': '#e98369', '--peach': '#fff1ea', '--border': '#e2e5e0',
    };
    for (const [name, value] of Object.entries(colours)) expect(token(styles, name), name).toBe(value);
    expect(token(styles, '--green-rgb')).toBe('35 75 58'); // the same green, for tints
  });

  it('keeps the older names as aliases of the new ones, never as second colours', () => {
    const aliases = {
      '--ink': 'var(--text)', '--paper': 'var(--bg)', '--line': 'var(--border)', '--accent': 'var(--green)', '--accent-ink': 'var(--green)', '--accent-hover': 'var(--green-hover)',
      '--accent-rgb': 'var(--green-rgb)', '--on-accent': 'var(--on-green)', '--panel': 'var(--bg)', '--muted': 'var(--text-2)', '--font': 'var(--font-sans)',
    };
    for (const [name, value] of Object.entries(aliases)) expect(token(styles, name), name).toBe(value);
  });

  it('has an 8px spacing scale, the radii, the pill, the control heights and the page width', () => {
    expect(token(styles, '--space-1')).toBe('8px');
    for (const [name, px] of [['--space-0', 4], ['--space-2', 16], ['--space-3', 24], ['--space-4', 32], ['--space-6', 48], ['--space-8', 64], ['--space-10', 80], ['--space-12', 96]]) expect(token(styles, name), name).toBe(`${px}px`);
    for (const [name, px] of [['--r-sm', 8], ['--r-md', 12], ['--r-lg', 16], ['--r-xl', 20]]) expect(token(styles, name), name).toBe(`${px}px`);
    expect(token(styles, '--radius')).toBe('var(--r-md)');
    expect(token(styles, '--radius-pill')).toBe('999px');
    expect(token(styles, '--control')).toBe('48px');
    expect(token(styles, '--control-sm')).toBe('40px');
    expect(token(styles, '--maxw')).toBe('1120px');
    expect(token(landing, '--l-max')).toBe('var(--maxw)');
  });

  it('has soft shadows, for what floats only: no hard offset and no glow', () => {
    expect(token(styles, '--shadow-1')).toMatch(/^0 1px 2px/);
    expect(token(styles, '--shadow-float')).toMatch(/^0 2px 6px/);
    for (const [name, text] of [['styles.css', styles], ['brand.css', brand], ['explore.css', explore], ['investors.css', investors], ['landing.css', landing]]) {
      expect(withoutComments(text), name).not.toMatch(/box-shadow:\s*\d+px \d+px 0[ ;]/); // a zero-blur block shadow
    }
  });

  it('is served with Inter and Instrument Serif (regular and italic), loaded in main.jsx, and Inter has the system face as its fallback', () => {
    expect(token(styles, '--font-sans')).toMatch(/^'Inter Variable',\s*'Inter',\s*system-ui/);
    expect(token(styles, '--font-serif')).toMatch(/^'Instrument Serif'/);
    const main = code('main.jsx');
    expect(main).toContain("import '@fontsource-variable/inter'");
    expect(main).toContain("import '@fontsource/instrument-serif/latin-400.css'");
    expect(main).toContain("import '@fontsource/instrument-serif/latin-400-italic.css'");
    expect(main.indexOf("import './styles.css'")).toBeLessThan(main.indexOf("import './brand.css'")); // the components after the tokens they read
    expect(styles).toMatch(/html,body,#root\{[^}]*font-family:var\(--font\)/);
    expect(code('LandingPage.jsx')).not.toMatch(/geist/i);
  });

  it('does not switch Tailwind or shadcn on for the whole app', () => {
    for (const file of ['main.jsx', 'App.jsx', 'LandingPage.jsx', 'styles.css', 'landing.css', 'brand.css']) expect(code(file), file).not.toMatch(/shadcn\.css|@import\s+["']tailwindcss/);
  });
});

describe('the colours', () => {
  const bg = token(styles, '--bg');
  const subtle = token(styles, '--bg-subtle');
  const text = token(styles, '--text');
  const text2 = token(styles, '--text-2');
  const green = token(styles, '--green');
  const butter = token(styles, '--butter');
  const peach = token(styles, '--peach');
  const coral = token(styles, '--coral');

  it('can be read: the text on the page, the secondary text on the page and on the tinted surfaces, and white on the green', () => {
    expect(contrast(text, bg)).toBeGreaterThanOrEqual(7);
    expect(contrast(text2, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(text2, subtle)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(text2, peach)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token(styles, '--on-green'), green)).toBeGreaterThanOrEqual(7);
    expect(contrast(green, bg)).toBeGreaterThanOrEqual(7); // the green as text and as a line on white
    expect(contrast(green, peach)).toBeGreaterThanOrEqual(7);
    expect(contrast(token(styles, '--danger'), bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('puts dark text on the yellow, the peach and the coral, never white', () => {
    expect(contrast(text, butter)).toBeGreaterThanOrEqual(7);
    expect(contrast(text, peach)).toBeGreaterThanOrEqual(7);
    expect(contrast(text, coral)).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#a94a30', peach)).toBeGreaterThanOrEqual(4.5); // the Collections card's small label
    expect(rule(brand, '.badge-vc')).toMatch(/background:var\(--butter\)[^}]*color:var\(--text\)/);
    expect(rule(brand, '.collections-card')).toMatch(/background:var\(--peach\)/);
  });

  it('has no dark ground left in any stylesheet, and no second accent: the old neon, the old amber, the old orange and the old mint', () => {
    const OLD = /#0a0e0f|#3ecf6e|#7ee8a0|#5fdc8a|#f5a623|#ffb84d|#d4430d|#c2410c|#9fd8bc|#b4e3cc|232, ?230, ?222|color-scheme:\s*dark|\[data-theme=['"]dark/i;
    for (const [name, sheet] of [['styles.css', styles], ['brand.css', brand], ['landing.css', landing], ['welcome.css', welcome], ['explore.css', explore], ['investors.css', investors], ['people.css', people], ['info.css', info]]) {
      expect(withoutComments(sheet), name).not.toMatch(OLD);
    }
  });

  it('draws the page white: the body, the pages\' roots and the landing page', () => {
    expect(styles).toMatch(/html,body,#root\{[^}]*background:var\(--bg\)/);
    expect(rule(landing, '.landing')).toContain('color-scheme: light');
    expect(rule(investors, '#investorsView')).toContain('color-scheme: light');
    expect(rule(explore, '.xp')).toMatch(/background:var\(--bg\)/);
  });
});

describe('the type', () => {
  it('sets the big headings in the serif at one weight, with one italic word in the green', () => {
    for (const selector of ['.display', '.serif-h1', '.serif-h2']) {
      const body = rule(brand, selector);
      expect(body, selector).toContain('font-family:var(--font-serif)');
      expect(body, selector).toContain('font-weight:400');
      expect(body, selector).toContain('text-wrap:balance');
    }
    expect(rule(brand, '.display em,.serif-h1 em,.serif-h2 em')).toMatch(/font-style:italic;color:var\(--green\)/);
    // the welcome page sets its headings in the same serif, at one weight, with its italic word in the page's own white (the night is not green)
    for (const selector of ['.se-hero-title', '.se-display', '.se-h2', '.se-tile-title']) {
      expect(rule(welcome, selector), selector).toContain('font-family:var(--font-serif)');
      expect(rule(welcome, selector), selector).toContain('font-weight:400');
    }
    expect(rule(welcome, '.se-hero-title em')).toContain('font-style:italic');
  });

  it('has fluid sizes for them, the display at most 6rem, and no tracking tighter than -0.04em anywhere', () => {
    expect(token(styles, '--fs-display')).toBe('clamp(3rem,1.6rem + 5.4vw,6rem)');
    expect(token(styles, '--fs-h1')).toBe('clamp(2.5rem,1.7rem + 3vw,4rem)');
    expect(token(styles, '--fs-h2')).toBe('clamp(2rem,1.5rem + 1.5vw,2.75rem)');
    for (const [name, sheet] of [['styles.css', styles], ['brand.css', brand], ['explore.css', explore], ['landing.css', landing], ['welcome.css', welcome], ['investors.css', investors], ['info.css', info]]) {
      for (const [, em] of withoutComments(sheet).matchAll(/letter-spacing:\s*(-[\d.]+)em/g)) expect(parseFloat(em), `${name}: ${em}em`).toBeGreaterThanOrEqual(-0.04);
    }
  });

  it('has three text sizes for what a person reads: lede 18px, body 16px, small 14px', () => {
    expect(token(styles, '--t-lede')).toBe('1.125rem');
    expect(token(styles, '--t-body')).toBe('1rem');
    expect(token(styles, '--t-small')).toBe('.875rem');
  });

  it('keeps the serif for headings: never in a control, a table, a card\'s facts or body text', () => {
    for (const selector of ['.btn', '.field input', '.seg-item', '.sh-link', '.crow-name', '.crow-sub', '.tab']) {
      const body = rule(brand, selector) ?? '';
      expect(body, selector).not.toContain('font-serif');
    }
    for (const [name, sheet] of [['explore.css', explore], ['investors.css', investors]]) {
      for (const [selector, body] of rulesOf(sheet)) {
        if (!body.includes('var(--font-serif)')) continue;
        expect(selector, `${name}: ${selector}`).toMatch(/h1|h2|h3|\.xp-name|\.vl-title|serif|\.inv-empty|\.inv-section|\.inv-panel-id|\.xc-head|\.inv-profile|\.empty-state/);
      }
    }
  });
});

describe('the shared components (brand.css)', () => {
  it('has the header: sticky, white, 80px, a pill of five places with the open one in the green, and one outlined action', () => {
    expect(rule(brand, '.sh')).toMatch(/position:sticky;top:0/);
    expect(rule(brand, '.sh')).toMatch(/height:80px/);
    expect(rule(brand, '.sh')).toMatch(/background:var\(--bg\)/);
    expect(rule(brand, '.sh-nav')).toMatch(/border:1px solid var\(--border\);border-radius:var\(--radius-pill\)/);
    expect(rule(brand, '.sh-link[aria-current="page"]')).toMatch(/color:var\(--green\)/);
    expect(rule(brand, '.sh-add')).toMatch(/border-radius:var\(--radius-pill\)/);
    expect(rule(brand, '.sh-add')).toMatch(/height:var\(--control\)/);
  });

  it('moves the places into the menu under 900px, keeping the name, the action and the menu', () => {
    const phone = brand.slice(brand.indexOf('/* ---------- on a phone ---------- */'));
    expect(phone).toMatch(/@media \(max-width:899px\)\{[^@]*\.sh-nav\{display:none;\}/);
    expect(phone).toMatch(/\.hdr-menu-mobile-nav\{display:flex/);
    expect(brand).toMatch(/@media \(max-width:1239px\)\{[^@]*\.sh-add-text\{display:none;\}/); // the action keeps its plus as the header tightens
  });

  it('has a primary button in the green, a secondary one outlined, and every control at least 40px tall (48px by default)', () => {
    expect(rule(brand, '.btn')).toMatch(/min-height:var\(--control\)/);
    expect(rule(brand, '.btn-sm')).toMatch(/min-height:var\(--control-sm\)/);
    expect(rule(brand, '.btn-primary')).toMatch(/background:var\(--green\)[^}]*color:var\(--on-green\)/);
    expect(rule(brand, '.btn-primary:hover')).toMatch(/background:var\(--green-hover\)/);
    expect(rule(brand, '.btn-secondary')).toMatch(/border-color:var\(--border\)/);
    expect(rule(brand, '.field')).toMatch(/height:var\(--control\)/);
    expect(rule(brand, '.field-lg')).toMatch(/height:56px/);
    expect(rule(brand, '.seg')).toMatch(/height:var\(--control\)/);
    expect(rule(styles, '.taskbtn')).toMatch(/min-height:var\(--control-sm\)[^}]*background:var\(--accent\)/); // the older button is drawn the same
  });

  it('has the switch, with the chosen one in the green and white on it', () => {
    expect(rule(brand, '.seg-item[aria-pressed="true"],.seg-item[aria-selected="true"]')).toMatch(/background:var\(--green\);color:var\(--on-green\)/);
  });

  it('has the field with a green ring on focus, and the bookmark a 44px target filled in the green when saved', () => {
    expect(rule(brand, '.field:focus-within')).toMatch(/border-color:var\(--green\);box-shadow:0 0 0 3px rgb\(var\(--green-rgb\) \/ \.15\)/);
    expect(rule(brand, '.bm')).toMatch(/width:44px;height:44px/);
    expect(rule(brand, '.bm[aria-pressed="true"]')).toMatch(/color:var\(--green\)/);
  });

  it('marks an investor with the butter yellow and a company that is hiring with the green', () => {
    expect(rule(brand, '.badge-vc')).toContain('background:var(--butter)');
    expect(rule(brand, '.badge-green')).toMatch(/background:var\(--green-tint\)[^}]*color:var\(--green\)/);
    expect(rule(investors, '.inv-card-type > span:first-child:not(.inv-verified)')).toContain('background: var(--butter)');
    expect(rule(explore, '.pin-vc-badge')).toContain('background:var(--butter)');
  });

  it('lights the open row in the peach, with a thin green line and no coloured edge on one side', () => {
    expect(rule(brand, '.crow[aria-current="true"]')).toMatch(/background:var\(--peach\);border-color:rgb\(var\(--green-rgb\) \/ \.22\)/);
    for (const [name, sheet] of [['brand.css', brand], ['explore.css', explore], ['investors.css', investors], ['styles.css', styles]]) {
      for (const [selector, body] of rulesOf(sheet)) {
        const edge = /border-(?:left|right):\s*([\d.]+)px/.exec(body);
        if (edge) expect(parseFloat(edge[1]), `${name}: ${selector}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('draws the Collections card in the peach with the coral for its shapes, and dark text on it', () => {
    expect(rule(brand, '.collections-card .cc-title')).toMatch(/font-family:var\(--font-serif\)/);
    expect(code('components/explore/ResultsColumn.jsx')).toContain("fill: 'var(--coral)'");
    expect(code('components/explore/ResultsColumn.jsx')).toContain('href="/lists"');
  });

  it('has a visible green focus ring on everything that can be pressed', () => {
    expect(token(styles, '--focus')).toBe('2px solid var(--green)');
    expect(brand).toMatch(/:is\(\.btn,\.bm,\.seg-item,\.sh-link,\.sh-add,\.sh-more,\.crow-main,\.tab,\.field-clear\):focus-visible\{outline:var\(--focus\);outline-offset:2px;\}/);
    expect(brand).toMatch(/\.sh-brand:focus-visible\{outline:var\(--focus\);outline-offset:4px;\}/);
    expect(explore).toMatch(/\.xt a:focus-visible,\.xt button:focus-visible,\.xt input:focus-visible\{outline:var\(--focus\);outline-offset:2px;\}/);
    expect(explore).toMatch(/\.xr:focus-visible\{outline:var\(--focus\)/);
    expect(explore).toMatch(/\.pv button:focus-visible\{outline:var\(--focus\)/);
  });

  it('is on every page: the pages, the landing page and the plain pages share one header and none draws its own', () => {
    // (the welcome page has its own capsule over the night sky: components/landing/Hero.jsx, with the same wordmark)
    for (const file of ['App.jsx', 'InfoPage.jsx', 'components/JobsView.jsx', 'components/NewsPage.jsx', 'components/CuratedLists.jsx', 'components/people/PeopleView.jsx', 'components/investors/InvestorsView.jsx']) {
      expect(code(file), file).toContain('<SiteHeader');
    }
    expect(code('main.jsx')).toContain("import './brand.css'");
  });
});

describe('the Explore page (explore.css)', () => {
  it('is a white page: the heading and the search, then one bordered workspace with a toolbar, the results and the map', () => {
    expect(rule(explore, '.xhero')).toMatch(/grid-template-columns:minmax\(0,1\.15fr\) minmax\(320px,560px\)/);
    const workspace = rule(explore, '.xw');
    expect(workspace).toMatch(/border:1px solid var\(--border\);border-radius:var\(--r-xl\)/);
    expect(workspace).toMatch(/isolation:isolate/);
    expect(workspace).toMatch(/height:clamp\(600px,calc\(100dvh - 104px\),880px\)/);
    expect(rule(explore, '.xb')).toMatch(/grid-template-columns:minmax\(340px,400px\) minmax\(0,1fr\)/);
    expect(rule(explore, '.xb[data-view="list"]')).toMatch(/grid-template-columns:minmax\(0,1fr\)/);
  });

  it('lets the page scroll as a document (the old one-screen shell is gone), and the results column scroll by itself', () => {
    expect(rule(styles, '#app')).toBe('position:relative;width:100%;');
    expect(rule(explore, '.xp')).toMatch(/min-height:100vh/);
    expect(rule(explore, '.xc-body')).toMatch(/overflow-y:auto/);
  });

  it('has the toolbar controls at 48px, the city in a bordered box, and the Filters button borderless', () => {
    expect(rule(explore, '.xt-locbtn')).toMatch(/height:var\(--control\)[^}]*border:1px solid var\(--border\)/);
    expect(rule(explore, '.xt-btn')).toMatch(/height:var\(--control\)/);
    expect(rule(explore, '.xt-view')).toMatch(/margin-left:auto/);
  });

  it('draws a company as a 40px rounded square in a 44px place to press, in the logo\'s own colours, with a soft shadow and a hover that grows it', () => {
    expect(rule(explore, '.custom-pin-badge')).toMatch(/width:44px;height:44px/);
    expect(rule(explore, '.pin-tile .pin-face')).toMatch(/width:40px;height:40px;border-radius:var\(--r-md\);overflow:hidden;background:var\(--bg\)/);
    expect(rule(explore, '.pin-tile .pin-face')).toMatch(/box-shadow:0 1px 2px/);
    expect(rule(explore, '.pin-logo')).toMatch(/object-fit:contain;background:#fff/); // a logo keeps its colours and proportions
    expect(rule(explore, '.custom-pin-badge:hover .pin-face')).toMatch(/transform:scale\(1\.08\)/);
    expect(rule(explore, '.pin-fallback')).toMatch(/color:var\(--green\)/); // the first letter when a logo is missing
  });

  it('marks the open company with a ring in the green, and a suburb or a city with a dashed edge, so it is never read as an office', () => {
    expect(rule(explore, '.pin-selected .pin-face')).toMatch(/box-shadow:0 0 0 2px var\(--green\)/);
    expect(rule(explore, '.pin-approx .pin-face')).toMatch(/outline:1\.5px dashed/);
    expect(rule(explore, '.pin-vc.pin-approx .pin-face')).toMatch(/outline-color:var\(--green\)/);
  });

  it('draws a cluster as a green disc with its number in white, sized by how many it holds', () => {
    expect(rule(explore, '.marker-cluster-inner')).toMatch(/background:var\(--green\);color:var\(--on-green\)/);
    for (const [size, px] of [['small', 40], ['medium', 48], ['large', 58]]) expect(rule(explore, `.cluster-${size}`), size).toMatch(new RegExp(`width:${px}px;height:${px}px`));
    expect(explore).toMatch(/\.leaflet-marker-icon:focus-visible \.pin-face,\.leaflet-marker-icon:focus-visible \.marker-cluster-inner\{outline:3px solid var\(--green\)/);
  });

  it('puts the name under the pin on a white card with an 8px radius, in bold 12px', () => {
    const label = rule(explore, '.pin-label');
    expect(label).toMatch(/border-radius:var\(--r-sm\)/);
    expect(label).toMatch(/font-size:\.75rem;font-weight:600/);
    expect(label).toMatch(/background:rgb\(255 255 255 \/ \.96\)/);
  });

  it('draws the preview beside the open mark: a white card with a soft float, 340px wide, that is not part of the map\'s own element', () => {
    expect(rule(explore, '.pin-preview')).toMatch(/position:absolute;left:0;top:0;z-index:650;width:340px/);
    expect(rule(explore, '.pv')).toMatch(/background:var\(--bg\)[^}]*box-shadow:var\(--shadow-float\)/);
    expect(rule(explore, '.pv-cta')).toMatch(/min-height:44px[^}]*color:var\(--green\)/);
    expect(code('components/MapView.jsx')).toMatch(/<div className="pin-preview" ref=\{previewRef\}>/);
  });

  it('has one light map: quiet streets, pale parks and soft water, washed out so the logos are what the eye finds', () => {
    expect(rule(styles, '.map-quiet-light .leaflet-tile-pane')).toMatch(/filter:saturate\(\.6\) contrast\(\.92\);opacity:\.5/);
    expect(styles).not.toMatch(/map-quiet-dark/);
    expect(code('mapTiles.js')).toContain("export const quietClass = () => 'map-quiet-light'");
    expect(styles).toContain('\n#map{background:#f3f5f0;}');
    // the zoom buttons are white, 44px, and the attribution stays
    expect(rule(explore, '.xp .leaflet-control-zoom')).toMatch(/background:var\(--bg\)/);
    expect(rule(explore, '.xp .leaflet-control-zoom a')).toMatch(/width:44px;height:44px/);
    expect(code('components/MapView.jsx')).toContain("L.control.attribution({ position: 'bottomright', prefix: false })");
  });

  it('is a grid of two rows on a phone (a third only for the VCs\' own menus), the width of the screen, with the results in the bottom sheet', () => {
    const phone = explore.slice(explore.indexOf('@media (max-width:899px){'), explore.indexOf('@keyframes xp-sheet-up'));
    expect(phone).toMatch(/\.xw\{width:100%;margin-bottom:0;border-width:1px 0 0;border-radius:0;/);
    expect(phone).toMatch(/\.xt\{display:grid;grid-template-columns:auto minmax\(0,1fr\);/);
    expect(phone).toMatch(/\.xt-vcmenus\{grid-area:3 \/ 1 \/ 4 \/ 3;display:flex;gap:8px;\}/);
    expect(phone).toMatch(/\.xb\{grid-template-columns:minmax\(0,1fr\);\}/);
    expect(phone).toMatch(/\.search-box \.kbd\{display:none;\}/); // no keyboard hint on a touch screen
  });

  it('draws the phone\'s sheet shut at 72px and open at most 560px tall, and lets a card in it take its own height', () => {
    expect(rule(explore, '.xs-peek')).toMatch(/height:calc\(72px \+ env\(safe-area-inset-bottom\)\)/);
    expect(rule(explore, '.xs-open')).toMatch(/height:min\(64%,560px\)/);
    expect(rule(explore, '.xs-detail')).toMatch(/height:auto;max-height:min\(58%,520px\);overflow-y:auto/);
  });

  it('opens the filter panel over the results column on a wide screen, and as a sheet under 900px', () => {
    expect(rule(explore, '.xp .map-panel')).toMatch(/width:var\(--panel-w\)[^}]*background:var\(--bg\)/);
    expect(explore).toMatch(/@media \(max-width:899px\)\{[\s\S]*\.xp \.map-panel\{\s*position:fixed;top:auto;left:0;right:0;bottom:0/);
  });

  it('is loaded by the app only: the landing page and the plain pages never fetch it', () => {
    expect(code('App.jsx')).toContain("import './explore.css'");
    for (const file of ['LandingPage.jsx', 'InfoPage.jsx', 'main.jsx']) expect(code(file), file).not.toContain('explore.css');
  });
});

describe('the one card', () => {
  const CARDS = ['.card', '.startup-card', '.job-card', '.inv-card', '.landing-job-card', '.landing-list-card', '.person-card'];
  const shared = styles.slice(styles.indexOf('/* The card.'));

  it('is drawn the same for a company, a person and a firm: the shared box, a two-line description, a row with a dot between', () => {
    expect(styles).toMatch(/\.entity-blurb\{[^}]*-webkit-line-clamp:2/);
    expect(styles).toMatch(/\.meta-row li:not\(:last-child\)::after\{[^}]*content:'\\00b7'/);
    expect(styles).toMatch(/\n\.sr-only\{[^}]*clip-path:inset\(50%\)/);
    for (const file of ['components/ListView.jsx', 'components/JobsView.jsx', 'components/people/PersonCard.jsx', 'components/people/InstitutionCard.jsx', 'components/investors/InvestorCard.jsx']) {
      expect(code(file), file).toContain('<EntityCard');
    }
  });

  it('is one box for a company, a job, an investor, a list and a person: the same radius, border, padding and hover', () => {
    const body = /\n((?:\.[\w-]+(?:, )?)+)\{([^}]*)\}/.exec(shared);
    for (const card of CARDS) expect(body[1], card).toContain(card);
    expect(body[2]).toContain('border:1px solid var(--line)');
    expect(body[2]).toContain('border-radius:var(--card-radius)');
    expect(body[2]).toContain('padding:var(--card-pad)');
    expect(token(styles, '--card-radius')).toBe('var(--r-lg)');
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
    expect(shared).not.toMatch(/\n\.card:hover/);
    const calm = shared.slice(shared.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(calm).toContain('transition:none');
    expect(calm).toContain('transform:none');
  });
});

describe('the Welcome page (Still Early)', () => {
  const nav = (text) => token(text, '--navy');

  it('has the night: the midnight navy of the brand and an off-white to read on it, and the page and its sections stand on them', () => {
    expect(nav(styles)).toBe('#071822');
    expect(token(styles, '--on-navy')).toBe('#faf9f5');
    expect(contrast(token(styles, '--on-navy'), nav(styles))).toBeGreaterThanOrEqual(7);
    expect(contrast('#f2c871', nav(styles))).toBeGreaterThanOrEqual(7); // the gold of the constellation on the night
    expect(rule(welcome, '.se')).toMatch(/background:var\(--navy\);color:var\(--on-navy\)/);
    expect(withoutComments(welcome)).not.toMatch(/gradient\([^)]*#(?!fff)/i); // no colour of its own in a gradient: the picture carries the sky
  });

  it('puts dark text on the yellow, the coral and the off-white panels and white on the green, never the other way', () => {
    for (const selector of ['.se-intro-panel', '.se-tile-people', '.se-tile-keep', '.se-tile-work', '.se-hiring-panel']) expect(rule(welcome, selector), selector).toMatch(/color:var\(--text\)/);
    expect(rule(welcome, '.se-tile-follow')).toMatch(/background:var\(--green\);color:var\(--on-green\)/);
    expect(rule(welcome, '.se-tile-people')).toMatch(/background:var\(--coral\)/);
    expect(rule(welcome, '.se-intro-panel')).toMatch(/background:var\(--butter\)/);
    expect(rule(welcome, '.se-hiring-panel')).toMatch(/background:var\(--bg-subtle\)/);
  });

  it('sets the opening over a picture with no words in it: the picture fills the hero, the person stays in view on a phone', () => {
    expect(rule(welcome, '.se-hero')).toMatch(/height:clamp\(660px,67\.5vw,1300px\)/);
    expect(rule(welcome, '.se-hero-art img')).toMatch(/object-fit:cover/);
    const phone = welcome.slice(welcome.indexOf('@media (max-width: 700px)'));
    expect(phone).toMatch(/\.se-hero-art img\{object-position:46% 100%;\}/);
    expect(phone).toMatch(/\.se-hero-constellation\{[^}]*top:76px/); // the constellation is moved clear of the headline
  });

  it('keeps every control at 44px or more: the links of the capsule, the menu button, the arrow, the footer links', () => {
    expect(rule(welcome, '.se-nav-links a,.se-nav-login')).toMatch(/min-height:44px/);
    expect(rule(welcome, '.se-nav-join')).toMatch(/min-height:44px/);
    expect(rule(welcome, '.se-sub-go')).toMatch(/width:44px;height:44px/);
    expect(rule(welcome, '.se-footer-links a')).toMatch(/min-height:44px/);
    expect(rule(welcome, '.se-feed a')).toMatch(/min-height:44px/);
  });

  it('sizes the previews in em, from the panel that holds them, and never below 9.5px', () => {
    expect(rule(welcome, '.se-tile')).toMatch(/container-type:inline-size/);
    expect(rule(welcome, '.se-intro-art')).toMatch(/container-type:inline-size/);
    // (every size of the whole preview is set on its wrapper, in px with a floor: the parts inside are in em of it)
    const sizes = [...withoutComments(welcome).matchAll(/(?:^|\n)([^{}\n]*\.wp)\{[^}]*font-size:([^;}]+)/g)].map(([, selector, size]) => [selector, size]);
    expect(sizes.length).toBeGreaterThan(4);
    for (const [selector, size] of sizes) {
      if (/var\(--wp/.test(size)) continue;
      expect(size, selector).toMatch(/^max\(\s*[\d.]+px,/);
      expect(parseFloat(/max\(\s*([\d.]+)px/.exec(size)[1]), selector).toBeGreaterThanOrEqual(9.5);
    }
    expect(rule(welcome, '.wp')).toMatch(/pointer-events:none/);
  });

  it('rises into place only for a visitor who has not asked for less, and has no motion of its own for one who has', () => {
    expect(styles).toMatch(/@media \(prefers-reduced-motion: no-preference\)\{\n  \.reveal\{/);
    expect(welcome).toMatch(/@media \(prefers-reduced-motion: reduce\)\{\s*\.se \*,\.se \*::before,\.se \*::after\{transition:none!important;animation:none!important;scroll-behavior:auto!important;\}/);
    expect(welcome).toMatch(/@media \(prefers-reduced-motion: no-preference\)\{\s*html:has\(\.se\)\{scroll-behavior:smooth;\}/);
    expect(`${styles}${welcome}`).not.toMatch(/<video|autoplay/i);
  });

  it('is the one page with a dark ground: no other stylesheet sets a page to the navy', () => {
    for (const [name, sheet] of [['brand.css', brand], ['explore.css', explore], ['investors.css', investors], ['people.css', people], ['info.css', info]]) {
      expect(withoutComments(sheet), name).not.toMatch(/var\(--navy\)/);
    }
  });

  it('closes the plain pages on one column in the same type', () => {
    expect(rule(info, '.info-body h2')).toMatch(/font-family: var\(--font-serif\)/);
    expect(rule(info, '.info-body')).toMatch(/max-width: 64ch/);
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

  it('has the table and its controls in sentence case: no capitals in a header, a sort or a label', () => {
    expect(rule(styles, '.startup-table thead th')).not.toMatch(/text-transform/);
    expect(rule(styles, '.startup-list-sort')).not.toMatch(/text-transform/);
    expect(rule(styles, '.hiring-badge')).toMatch(/text-transform:none/);
    expect(rule(styles, '.startup-layout-btn[aria-pressed="true"]')).toMatch(/background:var\(--green\);color:var\(--on-green\)/);
  });
});

describe('the grid of cards', () => {
  const FOUR = '.jobs-grid, .startup-grid, .curated-list-grid, .inv-grid';
  const CHILDREN = FOUR.split(', ').map((s) => `${s} > *`).join(', ');

  it('has twelve columns for the jobs, the list, the collections and the investors and people, and each card takes 12, then 6, then 4 of them as the grid\'s own width grows', () => {
    const rules = rulesOf(styles);
    const grid = rules.find(([selector]) => selector === FOUR);
    expect(grid[1]).toMatch(/display:grid; grid-template-columns:repeat\(12,minmax\(0,1fr\)\)/);
    expect(grid[1]).toContain('container-type:inline-size');
    const spans = rules.filter(([selector]) => selector === CHILDREN).map(([, body]) => /grid-column:span (\d+)/.exec(body)[1]);
    expect(spans).toEqual(['12', '6', '4']);
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

  it('shows the collections as editorial cards: a serif title, and the lists of people on the peach', () => {
    expect(rule(styles, '.curated-card h3')).toMatch(/font-family:var\(--font-serif\);font-size:1\.75rem/);
    expect(rule(styles, '.curated-card-people')).toMatch(/background:var\(--peach\)/);
    expect(rule(styles, '.curated-card-people .curated-card-category')).toMatch(/color:#a94a30/);
  });
});

describe('the company\'s panel and the dialogs', () => {
  it('opens the company\'s panel on white, with the logo, the name in the serif, and one switch that saves it: no colour of its own', () => {
    expect(rule(styles, '.pc-hero')).not.toMatch(/background/);
    expect(rule(styles, '.pc-hero-text h2')).toMatch(/font-family:var\(--font-serif\)/);
    expect(styles).not.toMatch(/--on-sector/);
    expect(code('components/StartupDetailPanel.jsx')).not.toMatch(/readableOn|sectorColor/);
  });

  it('draws a dialog as a white box with the serif title, 48px fields and a soft float', () => {
    expect(rule(styles, '.modal-panel')).toMatch(/border-radius:var\(--r-xl\)[^}]*box-shadow:var\(--shadow-float\)/);
    expect(rule(styles, '.modal-panel h2')).toMatch(/font-family:var\(--font-serif\)/);
    expect(rule(styles, '.modal-panel input, .modal-panel select')).toMatch(/min-height:var\(--control\)/);
    expect(rule(styles, '.modal-overlay')).toMatch(/background:rgb\(var\(--ink-rgb\) \/ \.42\)/);
  });

  it('gives what can be pressed at least 24px of height (WCAG 2.2 AA), as padding or as a minimum, though its text is smaller', () => {
    const body = rulesOf(styles).find(([selector]) => selector.startsWith('.index-row a, '))[1];
    expect(body).toMatch(/display:inline-flex; align-items:center; min-height:24px/);
    for (const selector of ['.index-row a', '.st-sort', '.inv-card-link', '.inv-back', '.person-request']) {
      expect(rulesOf(styles).find(([s]) => s.split(', ').includes(selector)), selector).toBeTruthy();
    }
  });

  it('stops every animation and transition for a visitor who has asked for less motion, as a net under the rules that stop their own', () => {
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)\{\n\s*\*, \*::before, \*::after\{ animation-duration:\.01ms !important; animation-iteration-count:1 !important; transition-duration:\.01ms !important; scroll-behavior:auto !important; \}/);
    expect(`${styles}${brand}${explore}${landing}${welcome}${investors}${people}`).not.toMatch(/<video|autoplay/i);
    expect(explore).toMatch(/@media \(prefers-reduced-motion: reduce\)\{\s*\.pin-face,\.marker-cluster-inner\{transition:none;\}/);
    expect(explore).toMatch(/@media \(prefers-reduced-motion: no-preference\)\{\s*\.pv\{animation:pv-in/);
  });
});

describe('the text on the pages', () => {
  const TEXT = new Set(['var(--t-body)', 'var(--t-small)']);

  it('is body and small, the app\'s two text sizes, on the content pages: the card, the table, the lists, the news, the dialogs and the footer', () => {
    const sizes = new Map(rulesOf(styles).filter(([, body]) => sizeOf(body)).map(([selector, body]) => [selector, sizeOf(body)]));
    const content = [
      '.entity-blurb', '.meta-row', '.index-row', '.index-row-label', '.verified-note', '.vouch-badge', '.concept-label',
      '.job-card-meta', '.jobs-filters select', '.jobs-filter-count', '.news-meta', '.news-headline',
      '.curated-card-desc', '.curated-card-count', '.list-banner-desc', '.list-banner-count',
      '.startup-table', '.startup-table thead th', '.st-tags li', '.startup-list-count', '.startup-list-sort', '.startup-layout-btn',
      '.new-week-title', '.new-week-name', '.new-week-what', '.event-badge',
      '.sdp-meta-value', '.sdp-meta-note', '.sdp-hiring-note', '.sdp-source-meta', '.sdp-sources-list', '.pc', '.pc-desc', '.pc-section-label', '.pc-inv-name', '.pc-founder-name',
      '.vouch blockquote', '.vouch figcaption', '.modal-sub', '.modal-panel label', '.modal-panel .hint', '.form-error', '.taskbtn', '.linkbtn',
      '.pin-pop-fresh', '.pin-pop-report',
    ];
    for (const selector of content) expect(TEXT.has(sizes.get(selector)), `${selector} is ${sizes.get(selector)}`).toBe(true);
    expect(sizes.get('.entity-name')).toBe('17px');
  });

  it('is body and small in the investor and people pages too: no size of its own under 17px, but a heading, an initial in a logo and a table\'s initial', () => {
    const ALLOWED = { 'investors.css': ['.inv-logo-initial', '.inv-correct h2'], 'people.css': [] };
    for (const [name, text] of [['investors.css', investors], ['people.css', people]]) {
      const own = rulesOf(text).filter(([, body]) => { const size = sizeOf(body); return size && /^[\d.]+px$/.test(size) && parseFloat(size) < 17; }).map(([selector]) => selector);
      expect(own.filter((selector) => !ALLOWED[name].includes(selector)), name).toEqual([]);
      expect(text.match(/var\(--t-(body|small)\)/g)?.length ?? 0, name).toBeGreaterThan(10);
    }
  });
});

describe('the endorsement', () => {
  it('is set as a quotation, with who said it under it in muted text, and has no coloured edge', () => {
    expect(styles).toMatch(/\.vouch figcaption\{[^}]*color:var\(--muted\)/);
    expect(styles).toMatch(/\.vouch blockquote p::before\{ content:'\\201c'; \}/);
    expect(styles).not.toMatch(/\.vouch[^{]*\{[^}]*border-left/);
  });
});

describe('the investors page (investors.css): one design, one theme', () => {
  it('has one light theme made of the site\'s tokens, with no theme switch and no theme set on :root', () => {
    expect(withoutComments(investors)).not.toMatch(/data-theme/);
    expect(rule(investors, '#investorsView')).toMatch(/--inv-tint: var\(--peach\)/);
    expect(rule(investors, '#investorsView')).toMatch(/--inv-ok: var\(--green\)/);
    expect(investors).not.toMatch(/(^|\n)\s*:root\s*\{/);
    expect(code('components/investors/InvestorsView.jsx')).not.toMatch(/useInvestorTheme|Dark theme/);
  });

  it('opens the investor in the peach, and sets the heading and the panel\'s title in the serif', () => {
    expect(rule(investors, '.inv-card-on, .inv-card-on:hover')).toMatch(/background: var\(--inv-tint\)/);
    expect(rule(investors, '.inv-hero h1, .inv-intro h1')).toMatch(/font-family: var\(--font-serif\)/);
    expect(rule(investors, '.inv-panel-id h2')).toMatch(/font-family: var\(--font-serif\)/);
    expect(rule(investors, '.inv-profile h1')).toMatch(/font-family: var\(--font-serif\)/);
  });

  it('keeps the card the app\'s one card, a little roomier here through its own tokens', () => {
    expect(rule(investors, '#investorsView')).toMatch(/--card-radius: var\(--r-lg\)/);
    expect(rule(investors, '#investorsView')).toMatch(/--card-pad: 24px/);
  });

  it('makes what is pressed big enough: a 56px search, 48px menus, 40px bookmarks and sort, and, in a drawer, a 44px way back', () => {
    expect(code('components/investors/InvestorDirectory.jsx')).toContain('field field-lg inv-search');
    expect(rule(investors, '#investorsView .xt-btn')).toMatch(/height: var\(--control\)/);
    expect(rule(investors, '.inv-save')).toMatch(/width: 40px; height: 40px/);
    expect(rule(investors, '.inv-select')).toMatch(/height: var\(--control-sm\)/);
    expect(investors).toMatch(/\.inv-panel-drawer \.inv-panel-back \{ min-height: 44px;/);
  });

  it('puts the panel beside the results from 1000px, sticky and scrolling by itself, and a full-screen drawer under it, with the page behind it still', () => {
    expect(investors).toMatch(/@media \(min-width: 1000px\) \{\s*\.inv-split-open \{ grid-template-columns: minmax\(0, 1fr\) clamp\(440px, 40vw, 620px\); \}/);
    expect(rule(investors, '.inv-panel-side')).toMatch(/position: sticky;[^}]*overflow-y: auto/);
    expect(investors).toMatch(/@media \(max-width: 999px\) \{\s*\.inv-panel-drawer \{\s*position: fixed; inset: 0;/);
    expect(rule(investors, '#investorsView.inv-locked')).toMatch(/overflow: hidden/);
  });

  it('lets the tags and the words of the way in give way when the results are narrow, so a row never scrolls sideways beside the panel, and stacks it on a phone', () => {
    expect(investors).toMatch(/@container \(max-width: 860px\) \{[^@]*\.inv-item-tags \{ display: none; \}[^@]*\.inv-item-cta \{ display: none; \}/);
    expect(investors).toMatch(/@container \(max-width: 600px\) \{[^@]*\.inv-list-head \{ display: none; \}[^@]*\.inv-item \{ grid-template-columns: minmax\(0, 1fr\) auto;/);
  });

  it('sets the page on the brand\'s off-white with white rows, cards and panel on it, and the scope and the filter sheet are the page\'s own parts', () => {
    expect(rule(investors, '#investorsView')).toMatch(/background: var\(--bg-subtle\)/);
    expect(rule(investors, '.inv-list')).toMatch(/background: var\(--bg\)/);
    expect(rule(investors, '.inv-sheet')).toMatch(/border-radius: var\(--r-xl\) var\(--r-xl\) 0 0/);
    expect(code('components/investors/InvestorDirectory.jsx')).toContain('inv-scope');
    expect(code('components/investors/InvestorDirectory.jsx')).toContain('FilterSheet');
  });

  it('stops its motion for a visitor who has asked for less: the panel, the drawer and the cards', () => {
    expect(investors).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.inv-panel, \.inv-profile \{ animation: none; \} \}/);
    expect(investors).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.inv-panel-drawer \{ animation: none; \} \}/);
  });

  it('shows the filter menus on a phone, though the map\'s toolbar hides its own there', () => {
    expect(rule(investors, '#investorsView .xt-menu')).toContain('display: block');
  });
});
