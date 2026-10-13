import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { showPeople } from '../src/flags.js';
import { readAppRoute, appPath } from '../src/appRoute.js';
import { curatedLists } from '../src/curatedLists.js';
import { footerColumns } from '../src/components/landing/LandingFooter.jsx';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'src');
const SEED = JSON.parse(readFileSync(path.join(HERE, '..', '..', 'backend', 'src', 'data', 'people_seed.json'), 'utf8'));

describe('the switch for the people (VITE_SHOW_PEOPLE)', () => {
  it('is off in a build that does not set it: the real default', () => {
    vi.unstubAllEnvs();
    expect(import.meta.env.VITE_SHOW_PEOPLE).toBeUndefined();
    expect(showPeople()).toBe(false);
  });

  it('is off for anything but a yes, and on for the usual yeses, in any case', () => {
    for (const off of ['', '0', 'false', 'no', 'off', 'maybe', ' ']) { vi.stubEnv('VITE_SHOW_PEOPLE', off); expect(showPeople(), JSON.stringify(off)).toBe(false); }
    for (const on of ['1', 'true', 'TRUE', 'yes', ' on ']) { vi.stubEnv('VITE_SHOW_PEOPLE', on); expect(showPeople(), JSON.stringify(on)).toBe(true); }
  });

  it('takes the /people address away when it is off: the address is the map\'s, not a page that is not there', () => {
    vi.stubEnv('VITE_SHOW_PEOPLE', '1');
    expect(readAppRoute({ pathname: '/people', search: '?tab=operators' })).toEqual({ kind: 'people' });
    vi.stubEnv('VITE_SHOW_PEOPLE', '');
    expect(readAppRoute({ pathname: '/people', search: '?tab=operators' })).toEqual({ kind: 'explore' });
    expect(readAppRoute({ pathname: '/people', search: '?list=founders-to-follow' })).toEqual({ kind: 'explore' });
    expect(readAppRoute({ pathname: '/investors', search: '' })).toEqual({ kind: 'investors' }); // the published investor directory is not behind it
    expect(readAppRoute({ pathname: '/lists', search: '' })).toEqual({ kind: 'lists' });
    expect(appPath({ kind: 'people' })).toBe('/people');
  });

  it('takes the People and Nominate links out of the footer when it is off', () => {
    const links = (people) => footerColumns(people).flatMap((c) => c.links.map(([label]) => label));
    expect(links(true)).toEqual(expect.arrayContaining(['People', 'Nominate someone']));
    expect(links(false)).not.toEqual(expect.arrayContaining(['People']));
    expect(links(false)).not.toEqual(expect.arrayContaining(['Nominate someone']));
    vi.stubEnv('VITE_SHOW_PEOPLE', '');
    expect(footerColumns().flatMap((c) => c.links.map(([, href]) => href))).not.toContain('/people');
  });
});

describe('what the site\'s own files may hold', () => {
  const walk = (dir) => readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    return statSync(file).isDirectory() ? walk(file) : [file];
  });
  const source = walk(SRC).filter((f) => /\.(jsx?|css|json|html)$/.test(f));
  const text = source.map((f) => [f, readFileSync(f, 'utf8')]);
  // every name the owner has typed, and every name on hold (one entry may name several, or end in "others"). The owner's reviewed file is kept
  // out of the public repository: with only the committed placeholders there is nobody real to look for, and the check of the names skips.
  const heldNames = (SEED.hold ?? []).flatMap((h) => h.name.split(',')).map((n) => n.replace(/\(.*?\)/g, '').trim()).filter((n) => n && !/^others$/i.test(n));
  const names = [...SEED.people.filter((p) => !p.placeholder).map((p) => p.name), ...heldNames];

  it.skipIf(names.length === 0)('names no person from people_seed.json, and no one on hold: the people are served, never built into the site', () => {
    expect(names.length).toBeGreaterThan(20);
    for (const [file, content] of text) {
      for (const name of names) expect(content.includes(name), `${name} is in ${path.relative(SRC, file)}`).toBe(false);
    }
  });

  it('has no list of named people in the lists any more', () => {
    expect(curatedLists.some((l) => l.type === 'people')).toBe(false);
    expect(curatedLists.every((l) => l.type === 'filter')).toBe(true);
    expect(JSON.stringify(curatedLists)).not.toMatch(/linkedin\.com\/in\//);
  });

  it('has no sitemap that could list a person or a firm, and none is linked', () => {
    const publicDir = path.join(HERE, '..', 'public');
    const files = existsSync(publicDir) ? readdirSync(publicDir) : [];
    expect(files.filter((f) => /sitemap/i.test(f))).toEqual([]);
    const html = readFileSync(path.join(HERE, '..', 'index.html'), 'utf8');
    expect(html).not.toMatch(/sitemap/i);
  });
});
