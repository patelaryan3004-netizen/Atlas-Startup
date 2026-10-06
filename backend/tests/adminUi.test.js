import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const UI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'admin', 'ui');
const read = (file) => readFile(path.join(UI, file), 'utf8');
// What a comment says is not what the code does: the checks below look at the code (whole-line and block comments removed).
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');

// The page is built from data we do not control (a company name or page title read from a website), under a policy
// that refuses inline script and style. These checks read the source for the ways either promise could be broken.
describe('the Command Center page keeps its promises', () => {
  it('parses, and never puts a string into the page as HTML or runs one as code', async () => {
    const js = code(await read('app.js'));
    expect(() => new vm.Script(js, { filename: 'app.js' })).not.toThrow();
    for (const banned of [/\.innerHTML\b/, /\.outerHTML\b/, /insertAdjacentHTML/, /document\.write/, /\beval\s*\(/, /new\s+Function\b/, /setAttribute\(\s*['"]style['"]/, /setAttribute\(\s*['"]on\w+['"]/, /javascript:/i, /srcdoc/i, /createContextualFragment/, /DOMParser/]) {
      expect(js, `app.js must not match ${banned}`).not.toMatch(banned);
    }
  });

  it('keeps the token in sessionStorage only, sends it only as an Authorization header, and talks only to its own /api', async () => {
    const js = code(await read('app.js'));
    expect(js).not.toMatch(/document\.cookie/);
    expect(js).toMatch(/sessionStorage/);
    // localStorage holds a colour-theme preference and nothing else
    for (const m of js.matchAll(/prefs\.(?:get|set|remove)\(\s*([A-Z_]+)/g)) expect(m[1]).toBe('THEME_KEY');
    for (const m of js.matchAll(/session\.(?:get|set|remove)\(\s*([A-Z_]+)/g)) expect(m[1]).toBe('TOKEN_KEY');
    expect(js.match(/Authorization/g)).toHaveLength(1);
    const targets = [...js.matchAll(/(?:api\.(?:get|post|call)|fetch)\(\s*([`'"])(.*?)\1/g)].map((m) => m[2]);
    expect(targets.length).toBeGreaterThan(10);
    for (const t of targets) expect(t, `a request to ${t}`).toMatch(/^\/api\//);
  });

  it('only ever links outwards through the one function that allows http(s)', async () => {
    const js = code(await read('app.js'));
    expect(js).toMatch(/function safeHref/);
    // every href that is not an in-page anchor is the output of safeHref
    for (const line of js.split('\n')) {
      const m = /\bhref:\s*([^,}]+)/.exec(line);
      if (!m) continue;
      expect(m[1].trim(), line.trim()).toMatch(/^(`#\$\{|'#|href\b|safeHref\()/);
    }
  });

  it('serves a shell with no inline script, style or handler, and nothing from another origin', async () => {
    const html = await read('index.html');
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow">/);
    expect(html).toMatch(/<html lang="en">/);
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(1);
    expect(scripts[0][1]).toMatch(/src="\/app\.js"/);
    expect(scripts[0][2].trim()).toBe('');
    expect(html).not.toMatch(/<style\b/i);
    expect(html).not.toMatch(/\sstyle\s*=/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    for (const m of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) expect(m[1], m[0]).toMatch(/^(\/[a-z]|data:)/);
  });

  it('has a stylesheet that imports nothing and loads nothing from outside', async () => {
    const css = await read('styles.css');
    expect(css).not.toMatch(/@import/);
    expect(css).not.toMatch(/expression\s*\(/i);
    for (const m of css.matchAll(/url\(\s*['"]?([^)'"]+)/g)) expect(m[1], m[0]).toMatch(/^data:/);
  });

  it('uses only colours and sizes it defines, and styles every class it gives an element', async () => {
    const [css, js, html] = [await read('styles.css'), await read('app.js'), await read('index.html')];
    const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...css.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1]));
    for (const v of used) expect(defined.has(v), `${v} is used but never defined`).toBe(true);

    const styled = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
    const given = new Set();
    for (const m of js.matchAll(/class:\s*(['"`])([^'"`]*?)\1/g)) {
      for (const token of m[2].split(/\s+/)) if (token && !token.includes('$') && !token.includes('{')) given.add(token);
    }
    for (const m of js.matchAll(/classList\.(?:add|toggle)\(\s*['"]([\w-]+)/g)) given.add(m[1]);
    for (const m of html.matchAll(/class="([^"]+)"/g)) for (const token of m[1].split(/\s+/)) given.add(token);
    // pieces that are built up from a template (`chip--${tone}`, `btn--${variant}`) are checked by their stems
    const stems = ['chip--ok', 'chip--warn', 'chip--bad', 'chip--info', 'chip--plain', 'btn--primary', 'btn--danger', 'btn--ghost', 'btn--sm', 'btn--quiet', 'btn--danger-solid', 'toast--bad', 'tile__dot--bad', 'dlg--lg', 'band--first'];
    for (const s of stems) expect(styled.has(s), `.${s} has no rule`).toBe(true);
    const unstyled = [...given].filter((c) => !styled.has(c));
    expect(unstyled, `classes with no rule: ${unstyled.join(', ')}`).toEqual([]);
  });
});
