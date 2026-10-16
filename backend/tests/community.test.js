import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, peopleShown } from '../src/app.js';
import { createCommunityCatalog, buildCommunity, STARTER_LISTS } from '../src/catalog/community.js';
import { checkSeed, personProblems, institutionProblems, listProblems, publicPerson, WHY_MAX } from '../src/models/community.js';
import { fixture, tempDir, removeTempDirs } from './helpers/catalog.js';

afterEach(removeTempDirs);

const STARTER_IDS = STARTER_LISTS.map((l) => l.id);
const SEED_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'people_seed.json');

const person = (over = {}) => ({
  id: 'ada-example', name: 'Ada Example', type: 'person', roleType: 'founder', title: 'Co-founder', orgName: 'Example Co', orgType: 'company', city: 'Sydney',
  whyFollow: 'Built a thing people use.', links: { website: 'https://ada.example', linkedin: null, x: null }, sources: [{ label: 'Example Co team page', url: 'https://example.example/team' }],
  verifiedAt: '2026-10-01', vouches: [], ...over,
});
const institution = (over = {}) => ({
  id: 'example-capital', name: 'Example Capital', type: 'institution', city: 'Melbourne', stageFocus: 'Seed', sectors: ['Software'], website: 'https://capital.example',
  sources: [{ label: 'Their site', url: 'https://capital.example/about' }], verifiedAt: '2026-10-01', ...over,
});
const list = (over = {}) => ({ id: 'founders-to-follow', title: 'Founders to follow', description: 'Worth watching.', curator: null, type: 'people', itemIds: ['ada-example'], ...over });

describe('what an entry must be', () => {
  it('accepts a complete person, institution and list', () => {
    expect(personProblems(person())).toEqual([]);
    expect(institutionProblems(institution())).toEqual([]);
    expect(listProblems(list())).toEqual([]);
  });

  it('refuses a person with a bad id, a missing name, the wrong type, or a role it does not know', () => {
    const found = (over) => personProblems(person(over)).join('\n');
    expect(found({ id: 'Ada Example' })).toMatch(/id must be/);
    expect(found({ name: '  ' })).toMatch(/name is needed/);
    expect(found({ type: 'company' })).toMatch(/type must be "person"/);
    expect(found({ roleType: 'celebrity' })).toMatch(/roleType must be one of founder, operator, investor/);
    expect(found({ orgType: 'charity' })).toMatch(/orgType/);
  });

  it(`holds "why follow" to ${WHY_MAX} characters`, () => {
    expect(personProblems(person({ whyFollow: 'x'.repeat(WHY_MAX) }))).toEqual([]);
    expect(personProblems(person({ whyFollow: 'x'.repeat(WHY_MAX + 1) })).join('\n')).toMatch(/140 characters or fewer/);
  });

  it('takes links only as web addresses, and only the three it knows', () => {
    expect(personProblems(person({ links: { website: 'javascript:alert(1)' } })).join('\n')).toMatch(/links.website must be an http\(s\) address/);
    expect(personProblems(person({ links: { linkedin: 'linkedin.com/in/ada' } })).join('\n')).toMatch(/links.linkedin must be an http\(s\) address/);
    expect(personProblems(person({ links: { facebook: 'https://facebook.example' } })).join('\n')).toMatch(/links.facebook is not one of/);
    expect(personProblems(person({ links: { website: null, linkedin: 'https://au.linkedin.com/in/ada', x: 'https://x.com/ada' } }))).toEqual([]);
  });

  it('shows a check only with a page behind it: a verification date needs a source', () => {
    expect(personProblems(person({ sources: [] })).join('\n')).toMatch(/verifiedAt needs at least one source/);
    expect(personProblems(person({ sources: [], verifiedAt: null }))).toEqual([]);
    expect(personProblems(person({ verifiedAt: 'last week' })).join('\n')).toMatch(/verifiedAt must be a date/);
    expect(personProblems(person({ sources: [{ label: '', url: 'https://x.example' }] })).join('\n')).toMatch(/needs a label/);
    expect(personProblems(person({ sources: [{ label: 'x', url: 'ftp://x.example' }] })).join('\n')).toMatch(/needs an http\(s\) address/);
  });

  it('needs every vouch to say whether the person agreed to it', () => {
    expect(personProblems(person({ vouches: [{ name: 'Sam', role: 'Investor', note: 'Great.', consented: true }] }))).toEqual([]);
    expect(personProblems(person({ vouches: [{ name: 'Sam', note: 'Great.' }] })).join('\n')).toMatch(/consented must be true or false/);
    expect(personProblems(person({ vouches: [{ name: '', consented: true }] })).join('\n')).toMatch(/needs a name/);
  });

  it('holds an institution and a list to their own rules', () => {
    expect(institutionProblems(institution({ type: 'person' })).join('\n')).toMatch(/type must be "institution"/);
    expect(institutionProblems(institution({ website: 'capital.example' })).join('\n')).toMatch(/website must be an http\(s\) address/);
    expect(institutionProblems(institution({ sources: [], verifiedAt: '2026-10-01' })).join('\n')).toMatch(/needs at least one source/);
    expect(listProblems(list({ type: 'robots' })).join('\n')).toMatch(/type must be one of people, institutions, companies/);
    expect(listProblems(list({ itemIds: 'ada' })).join('\n')).toMatch(/itemIds must be a list/);
    expect(listProblems(list({ title: '' })).join('\n')).toMatch(/title is needed/);
  });
});

describe('what a visitor is shown of an entry', () => {
  it('shows only the vouches that were agreed to, and none of the fields a card does not use', () => {
    const shown = publicPerson(person({
      email: 'ada@secret.example', ownerNote: 'do not publish',
      vouches: [{ name: 'Yes', role: 'Investor', note: 'Backed them.', consented: true }, { name: 'No', role: 'Rival', note: 'Said no.', consented: false }],
    }));
    expect(shown.vouches).toEqual([{ name: 'Yes', role: 'Investor', note: 'Backed them.' }]);
    expect(JSON.stringify(shown)).not.toMatch(/secret|do not publish|Said no|"consented"/);
    expect(Object.keys(shown).sort()).toEqual(['city', 'id', 'links', 'name', 'orgName', 'orgType', 'roleType', 'sources', 'title', 'type', 'verifiedAt', 'vouches', 'whyFollow']);
  });

  it('drops a link that is not a web address and leaves out one that is empty', () => {
    expect(publicPerson(person({ links: { website: 'https://ada.example', linkedin: null, x: 'not a link' } })).links).toEqual({ website: 'https://ada.example' });
  });
});

describe('checking the seed', () => {
  const seed = (over = {}) => ({ people: [person()], institutions: [institution()], lists: [list()], ...over });

  it('keeps the entries that meet the rules and names each one that does not, repairing nothing', () => {
    const checked = checkSeed(seed({ people: [person(), person({ id: 'bad', roleType: 'celebrity' })] }));
    expect(checked.people.map((p) => p.id)).toEqual(['ada-example']);
    expect(checked.problems.join('\n')).toMatch(/person "bad": roleType/);
  });

  it('serves a placeholder only outside production', () => {
    const rows = seed({ people: [person(), person({ id: 'placeholder-founder', placeholder: true })] });
    expect(checkSeed(rows, { production: false }).people.map((p) => p.id)).toEqual(['ada-example', 'placeholder-founder']);
    expect(checkSeed(rows, { production: true }).people.map((p) => p.id)).toEqual(['ada-example']);
    expect(checkSeed(rows).people.find((p) => p.id === 'placeholder-founder').placeholder).toBe(true);
  });

  it('keeps the first of two entries with one id, and says so', () => {
    const checked = checkSeed(seed({ people: [person(), person({ name: 'Another Ada' })] }));
    expect(checked.people.map((p) => p.name)).toEqual(['Ada Example']);
    expect(checked.problems.join('\n')).toMatch(/used more than once/);
  });

  it('treats a seed that is not there, or is not what it should be, as empty', () => {
    expect(checkSeed(undefined)).toMatchObject({ people: [], institutions: [], lists: [], problems: [] });
    expect(checkSeed({ people: 'nobody', lists: {} })).toMatchObject({ people: [], lists: [] });
  });
});

// The owner's reviewed seed (real people, and a "hold" list of those never to show) is kept out of the public repository: what is committed is
// the file with three placeholders. On a computer that has the reviewed file the checks below run on it; on one that does not, they have nothing to
// check and skip, and the committed file is checked by the last test of this block.
const SHIPPED = JSON.parse(readFileSync(SEED_FILE, 'utf8'));
const hasOwnersSeed = Array.isArray(SHIPPED.hold) && SHIPPED.people.some((p) => !p.placeholder);

describe.skipIf(!hasOwnersSeed)('the seed file that ships', () => {
  const shipped = SHIPPED;
  // The names in "hold", one by one: an entry there reads "Name (Org)", or several names with commas, or ends in "others".
  const heldNames = (shipped.hold ?? []).flatMap((h) => h.name.split(',')).map((n) => n.replace(/\(.*?\)/g, '').trim()).filter((n) => n && !/^others$/i.test(n));

  it('meets every rule, so a slip in an edit fails here and not on the live site', () => {
    const checked = checkSeed(shipped, { production: true });
    expect(checked.problems).toEqual([]);
    expect(checked.people.length).toBe(shipped.people.length);
  });

  it('is the owner\'s reviewed file: people only, each with a source and a date, and none marked as a placeholder', () => {
    expect(shipped._readme).toMatch(/NOT approved for publishing/);
    expect(shipped.people.length).toBeGreaterThan(0);
    expect(shipped.people.every((p) => p.type === 'person' && p.sources.length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(p.verifiedAt))).toBe(true);
    expect(shipped.people.some((p) => p.placeholder === true || /PLACEHOLDER/.test(p.name))).toBe(false);
    expect(new Set(shipped.people.map((p) => p.roleType))).toEqual(new Set(['founder', 'operator', 'investor']));
    expect(shipped.institutions).toBeUndefined(); // the firms come from institutions_seed.json and from the investor directory
  });

  it('never serves an entry that is on hold: not one of the held names is among the people, whatever the confidence', () => {
    expect(shipped.hold.length).toBeGreaterThan(0);
    expect(heldNames.length).toBeGreaterThan(3);
    const people = buildCommunity({ seed: shipped, production: true }).people.map((p) => p.name.toLowerCase());
    for (const name of heldNames) expect(people, name).not.toContain(name.toLowerCase());
    expect(JSON.stringify(buildCommunity({ seed: shipped, production: true }))).not.toMatch(/Vullinghs|"hold"|"gaps"|"issue"/);
  });

  it('serves every person in it in production (the placeholders are gone), with the pages behind them', () => {
    const community = buildCommunity({ seed: shipped, production: true });
    expect(community.people).toHaveLength(shipped.people.length);
    expect(community.people.every((p) => p.sources.length > 0 && !p.placeholder)).toBe(true);
    expect(community.counts).toMatchObject({ founders: 12, operators: 7, investors: 9, institutions: 0 });
  });

  it('has the four starter lists the owner named, made from the people in it, in the order they were typed', () => {
    const community = buildCommunity({ seed: shipped, production: true });
    // no firm is in the file, so "Investors (firms)" has no one to show
    expect(community.lists.map((l) => l.title)).toEqual(['Founders to follow', 'Operators to learn from', 'Investors (people)']);
    const founders = community.lists.find((l) => l.id === 'founders-to-follow');
    expect(founders.itemIds).toEqual(shipped.people.filter((p) => p.roleType === 'founder').map((p) => p.id));
    expect(founders).toMatchObject({ type: 'people', curator: 'Still Early' });
  });
});

describe('the seed file as committed', () => {
  it.skipIf(hasOwnersSeed)('is valid, and serves nobody in production: its entries are placeholders', () => {
    expect(checkSeed(SHIPPED).problems).toEqual([]);
    expect(SHIPPED.people.length).toBeGreaterThan(0);
    expect(SHIPPED.people.every((p) => p.placeholder === true)).toBe(true);
    expect(buildCommunity({ seed: SHIPPED, production: true }).people).toEqual([]);
  });
});

describe('the four starter lists', () => {
  it('gather the people by role and the firms, each in the order typed, and show a firm list only with a firm in it', () => {
    const seed = { people: [person({ id: 'z-founder', name: 'Zed' }), person({ id: 'a-founder', name: 'Abe' }), person({ id: 'op', name: 'Ola', roleType: 'operator' }), person({ id: 'inv', name: 'Ivy', roleType: 'investor' })] };
    const c = buildCommunity({ seed, production: true });
    expect(c.lists.map((l) => [l.id, l.itemIds])).toEqual([['founders-to-follow', ['z-founder', 'a-founder']], ['operators-to-learn-from', ['op']], ['investors-people', ['inv']]]);
    const withFirms = buildCommunity({ seed, investors: investors(), production: true });
    expect(withFirms.lists.at(-1)).toMatchObject({ id: 'investors-firms', type: 'institutions', title: 'Investors (firms)', itemIds: ['investor-blackbird', 'investor-skip'] });
  });

  it('give way to a list of the same id in the seed file, which keeps its own members', () => {
    const seed = { people: [person(), person({ id: 'bea', name: 'Bea' })], lists: [list({ itemIds: ['bea'] })] };
    const c = buildCommunity({ seed, production: true });
    expect(c.lists.filter((l) => l.id === 'founders-to-follow')).toHaveLength(1);
    expect(c.lists.find((l) => l.id === 'founders-to-follow').itemIds).toEqual(['bea']);
  });

  it('show nobody who is a placeholder in production, and no list when no one is on it', () => {
    const seed = { people: [person({ id: 'placeholder-founder', name: 'PLACEHOLDER', placeholder: true })] };
    expect(buildCommunity({ seed, production: true }).lists).toEqual([]);
    expect(buildCommunity({ seed: {}, production: true }).lists).toEqual([]);
  });
});

describe('the firms of institutions_seed.json', () => {
  const firms = { institutions: [
    { id: 'example-vc', name: 'Example VC', website: 'https://vc.example', offices: [{ label: 'Sydney', address: 'Level 2, 12 Example Street, Sydney NSW 2000', city: 'Sydney', state: 'NSW' }] },
    { id: 'no-office', name: 'No Office Capital', website: 'https://nooffice.example', offices: [] },
    { id: 'held-vc', name: 'Held VC', placeholder: true, offices: [] },
  ], hold: [{ name: 'Another Held VC', issue: 'unresolved' }] };

  it('are listed under Institutions: the one with offices and the one with none (which has no pin), and not the ones on hold', () => {
    const c = buildCommunity({ seed: {}, institutionSeed: firms, production: true });
    expect(c.institutions.map((i) => i.name)).toEqual(['Example VC', 'No Office Capital']);
    expect(c.institutions[0]).toMatchObject({ id: 'example-vc', city: 'Sydney', website: 'https://vc.example', sources: [], verifiedAt: null });
    expect(c.institutions[1].city).toBeNull();
    expect(JSON.stringify(c)).not.toMatch(/Held VC|Another Held/);
    expect(c.institutionPins.pins).toEqual([]); // nothing is drawn until an address has been geocoded
  });

  it('are on "Investors (firms)", and a firm already published in the investor directory stays as that (with its pages) and is not listed twice', () => {
    const c = buildCommunity({ seed: {}, institutionSeed: { institutions: [...firms.institutions, { id: 'bb', name: 'blackbird ', offices: [] }] }, investors: investors(), production: true });
    expect(c.institutions.map((i) => i.id).sort()).toEqual(['example-vc', 'investor-blackbird', 'investor-skip', 'no-office']);
    expect(c.institutions.find((i) => i.id === 'investor-blackbird').href).toBe('/investors/blackbird');
    expect(c.lists.find((l) => l.id === 'investors-firms').itemIds).toHaveLength(4);
    expect(c.counts.institutions).toBe(4);
  });
});

describe('the switch that keeps the people off the live site (SHOW_PEOPLE)', () => {
  const over = async (showPeople) => {
    // a seed full of invented people: 12 founders, 7 operators and 9 investors, the shape of the owner's file
    const shipped = { people: [...many(12), ...many(7, 'operator'), ...many(9, 'investor')] };
    const f = await fixture(5);
    const dir = await tempDir();
    const file = path.join(dir, 'people_seed.json');
    await writeFile(file, JSON.stringify(shipped));
    const investorCatalog = { snapshot: async () => investors() };
    const communityCatalog = createCommunityCatalog({ file, investorCatalog, production: true, reloadMs: 0 });
    return { app: createApp({ catalog: f.catalog, investorCatalog, communityCatalog, showPeople }), rows: f.rows };
  };

  it('is off unless the machine says so: "not found" for the people, the firms, their pins and the lists, with the seed full of people', async () => {
    const { app } = await over(false);
    for (const url of ['/api/people', '/api/people?role=founder', '/api/institutions', '/api/institutions/pins', '/api/lists', '/api/lists/founders-to-follow']) {
      const res = await request(app).get(url);
      expect(res.status, url).toBe(404);
      expect(res.body).toEqual({ error: 'Not found' });
      expect(JSON.stringify(res.body)).not.toMatch(/Perkins|Canva|Blackbird/);
    }
  });

  it('is off by default: nothing in the environment, nothing served', () => {
    expect(peopleShown({})).toBe(false);
    expect(peopleShown({ SHOW_PEOPLE: '' })).toBe(false);
    expect(peopleShown({ SHOW_PEOPLE: '0' })).toBe(false);
    expect(peopleShown({ SHOW_PEOPLE: 'no' })).toBe(false);
    for (const on of ['1', 'true', 'TRUE', ' yes ', 'on']) expect(peopleShown({ SHOW_PEOPLE: on }), on).toBe(true);
  });

  it('serves everything once it is on', async () => {
    const { app } = await over(true);
    const res = await request(app).get('/api/people?role=founder');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(12);
    expect((await request(app).get('/api/lists')).body.results.map((l) => l.id)).toEqual(['founders-to-follow', 'operators-to-learn-from', 'investors-people', 'investors-firms']);
  });

  it('leaves the companies, and a founder\'s own page, as they are with it off: only the new people pages are held back', async () => {
    const { app, rows } = await over(false);
    expect((await request(app).get('/api/startups?limit=1&view=card')).status).toBe(200);
    const founder = rows.find((r) => r.founders?.length)?.founders[0];
    expect((await request(app).get(`/api/people/${encodeURIComponent(founder)}`)).status).toBe(200);
    expect((await request(app).get('/api/health')).status).toBe(200);
  });
});

// A stand-in for the investor directory: two published firms and one published person, each with the pages behind them.
const investors = () => ({
  version: 'inv1',
  cards: [
    { slug: 'blackbird', name: 'Blackbird', website: 'https://blackbird.example', stages: ['Seed', 'Series A'], sectors: ['Software'], location: { city: 'Sydney', label: 'Sydney, NSW' }, verified_at: '2026-10-08T01:00:00.000Z' },
    { slug: 'skip', name: 'Skip Capital', website: null, stages: [], sectors: [], location: { city: null }, verified_at: null },
  ],
  profiles: new Map([['blackbird', { sources: [{ title: 'Blackbird: portfolio', url: 'https://blackbird.example/portfolio' }] }], ['skip', { sources: [] }]]),
  personProfiles: new Map([['sam-rivera', { name: 'Sam Rivera', current_title: 'Partner', organisation: { name: 'Blackbird' }, location: 'Sydney', personal_website: null, linkedin_url: null,
    sources: [{ title: 'Blackbird: team', url: 'https://blackbird.example/team' }], last_verified_at: '2026-10-08T01:00:00.000Z' }]]),
});

describe('joined to the investor directory', () => {
  it('shows each published investor as an institution, and each published investor person as a person, with their pages', () => {
    const c = buildCommunity({ seed: { people: [], institutions: [], lists: [] }, investors: investors() });
    expect(c.institutions.map((i) => i.id)).toEqual(['investor-blackbird', 'investor-skip']);
    expect(c.institutions[0]).toMatchObject({ name: 'Blackbird', city: 'Sydney', stageFocus: 'Seed, Series A', href: '/investors/blackbird', verifiedAt: '2026-10-08T01:00:00.000Z', sources: [{ label: 'Blackbird: portfolio', url: 'https://blackbird.example/portfolio' }] });
    expect(c.people).toHaveLength(1);
    expect(c.people[0]).toMatchObject({ id: 'investor-person-sam-rivera', roleType: 'investor', title: 'Partner', orgName: 'Blackbird', orgType: 'firm', href: '/investors/people/sam-rivera', whyFollow: null });
    expect(c.counts).toEqual({ founders: 0, operators: 0, investors: 1, institutions: 2 });
  });

  it('says nothing was verified for an investor that has no page behind it, and leaves out what it does not know', () => {
    const skip = buildCommunity({ seed: {}, investors: investors() }).institutions.find((i) => i.id === 'investor-skip');
    expect(skip).toMatchObject({ verifiedAt: null, city: null, stageFocus: null, website: null, sectors: [], sources: [] });
  });

  it('lists a firm once: an entry in the seed with the same name wins', () => {
    const seed = { institutions: [institution({ id: 'blackbird-seed', name: 'blackbird  ' })] };
    const c = buildCommunity({ seed, investors: investors() });
    expect(c.institutions.map((i) => i.id).sort()).toEqual(['blackbird-seed', 'investor-skip']);
  });

  it('keeps a list to the entries it can name, in the list\'s own order, and says what it could not', () => {
    const seed = { institutions: [], lists: [list({ id: 'firms', type: 'institutions', itemIds: ['investor-skip', 'investor-nobody', 'investor-blackbird'] }), list({ id: 'empty', type: 'people', itemIds: ['ghost'] })] };
    const c = buildCommunity({ seed, investors: investors() });
    // (the starter lists made from the directory are also there: see the starter lists below)
    expect(c.lists.filter((l) => !STARTER_IDS.includes(l.id)).map((l) => [l.id, l.itemIds])).toEqual([['firms', ['investor-skip', 'investor-blackbird']]]);
    expect(c.problems.join('\n')).toMatch(/list "firms" names "investor-nobody"/);
  });
});

// The API, over a temporary seed.
async function appOver(seed, { production = false, n = 20 } = {}) {
  const f = await fixture(n);
  const dir = await tempDir();
  const file = path.join(dir, 'people_seed.json');
  await writeFile(file, JSON.stringify(typeof seed === 'function' ? seed(f.rows) : seed));
  const investorCatalog = { snapshot: async () => investors() };
  const communityCatalog = createCommunityCatalog({ file, investorCatalog, production, reloadMs: 0 });
  const app = createApp({ catalog: f.catalog, investorCatalog, communityCatalog, showPeople: true });
  return { app, rows: f.rows, file, communityCatalog };
}
const many = (n, role = 'founder') => Array.from({ length: n }, (_, i) => person({ id: `person-${role}-${String(i).padStart(2, '0')}`, name: `Person ${role} ${String(i).padStart(2, '0')}`, roleType: role }));

describe('GET /api/people', () => {
  it('gives 20 at a time with where the next page starts, and how many there are in every tab', async () => {
    const { app } = await appOver({ people: [...many(45), ...many(3, 'operator')] });
    const first = await request(app).get('/api/people?role=founder');
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ counts: { founders: 45, operators: 3, investors: 1, institutions: 2 }, total: 45, count: 45, offset: 0, limit: 20, hasMore: true, nextOffset: 20 });
    expect(first.body.results).toHaveLength(20);
    const seen = [];
    let offset = 0;
    for (;;) {
      const res = await request(app).get(`/api/people?role=founder&offset=${offset}`);
      seen.push(...res.body.results.map((p) => p.id));
      if (res.body.nextOffset === null) break;
      offset = res.body.nextOffset;
    }
    expect(seen).toHaveLength(45);
    expect(new Set(seen).size).toBe(45);
  });

  it('narrows to a role and by a word, and refuses a role it does not know', async () => {
    const { app } = await appOver({ people: [person(), person({ id: 'op-one', name: 'Olive Operator', roleType: 'operator', title: 'COO', orgName: 'Widgets', city: 'Perth' })] });
    expect((await request(app).get('/api/people?role=operator')).body.results.map((p) => p.id)).toEqual(['op-one']);
    expect((await request(app).get('/api/people?role=founder&search=ada')).body).toMatchObject({ total: 1, count: 1 });
    expect((await request(app).get('/api/people?role=founder&search=perth')).body).toMatchObject({ total: 1, count: 0, results: [] });
    expect((await request(app).get('/api/people?search=widgets')).body.results.map((p) => p.id)).toEqual(['op-one']);
    const bad = await request(app).get('/api/people?role=celebrity');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/role must be one of/);
  });

  it('shows only the vouches that were agreed to, and none of what is not the card\'s', async () => {
    const { app } = await appOver({ people: [person({
      email: 'ada@secret.example', vouches: [{ name: 'Yes', role: 'Investor', note: 'Backed them.', consented: true }, { name: 'No', note: 'Said no.', consented: false }],
    })] });
    const body = (await request(app).get('/api/people?role=founder')).body;
    expect(body.results[0].vouches).toEqual([{ name: 'Yes', role: 'Investor', note: 'Backed them.' }]);
    expect(JSON.stringify(body)).not.toMatch(/secret|Said no/);
  });

  it('serves no placeholder in production, and serves one anywhere else with its mark', async () => {
    const seed = { people: [person({ id: 'placeholder-founder', name: 'PLACEHOLDER Founder', placeholder: true })], lists: [list({ itemIds: ['placeholder-founder'] })] };
    const live = await appOver(seed, { production: true });
    expect((await request(live.app).get('/api/people?role=founder')).body).toMatchObject({ results: [], counts: { founders: 0 } });
    // no list names the placeholder (the lists left are the ones made from the investor directory)
    expect((await request(live.app).get('/api/lists')).body.results.map((l) => l.id)).toEqual(['investors-people', 'investors-firms']);
    expect((await request(live.app).get('/api/lists/investors-people')).body.results.map((p) => p.id)).toEqual(['investor-person-sam-rivera']);
    const dev = await appOver(seed, { production: false });
    expect((await request(dev.app).get('/api/people?role=founder')).body.results).toMatchObject([{ id: 'placeholder-founder', placeholder: true }]);
  });

  it('is empty, not broken, with no seed file and no investors to show', async () => {
    const f = await fixture(5);
    const dir = await tempDir();
    const communityCatalog = createCommunityCatalog({ file: path.join(dir, 'missing.json'), production: true, reloadMs: 0 });
    const app = createApp({ catalog: f.catalog, investorCatalog: { snapshot: async () => ({ version: 'x', cards: [], profiles: new Map(), personProfiles: new Map() }) }, communityCatalog, showPeople: true });
    expect((await request(app).get('/api/people')).body).toMatchObject({ total: 0, count: 0, results: [], counts: { founders: 0, operators: 0, investors: 0, institutions: 0 } });
    expect((await request(app).get('/api/lists')).body).toEqual({ results: [] });
  });

  it('does not take the place of GET /api/people/:name, which is a founder\'s companies', async () => {
    const { app, rows } = await appOver({ people: many(2) });
    const founder = rows.find((r) => r.founders?.length)?.founders[0];
    const res = await request(app).get(`/api/people/${encodeURIComponent(founder)}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: founder, companies: expect.any(Array) });
  });
});

describe('GET /api/institutions', () => {
  it('lists the firms the owner added and the investors published in the Command Center, once each, by name', async () => {
    const { app } = await appOver({ institutions: [institution()] });
    const body = (await request(app).get('/api/institutions')).body;
    expect(body.results.map((i) => i.name)).toEqual(['Blackbird', 'Example Capital', 'Skip Capital']);
    expect(body).toMatchObject({ total: 3, count: 3, limit: 20, hasMore: false, nextOffset: null });
    expect(body.results.find((i) => i.name === 'Blackbird').href).toBe('/investors/blackbird');
    expect((await request(app).get('/api/institutions?search=melbourne')).body.results.map((i) => i.name)).toEqual(['Example Capital']);
  });
});

describe('curated lists', () => {
  const seed = () => ({
    people: [person(), person({ id: 'bea', name: 'Bea Builder' })],
    lists: [
      list({ itemIds: ['bea', 'ada-example'] }),
      list({ id: 'firms', title: 'Firms', type: 'institutions', itemIds: ['investor-skip', 'investor-blackbird'] }),
      list({ id: 'companies-pick', title: 'Companies', type: 'companies', itemIds: ['no-such-company'] }),
      list({ id: 'nobody', title: 'Nobody', type: 'people', itemIds: [] }),
    ],
  });

  it('shows the lists that have someone on them, with how many', async () => {
    const { app } = await appOver(seed());
    expect((await request(app).get('/api/lists')).body.results).toEqual([
      { id: 'founders-to-follow', title: 'Founders to follow', description: 'Worth watching.', curator: null, type: 'people', count: 2 },
      { id: 'firms', title: 'Firms', description: 'Worth watching.', curator: null, type: 'institutions', count: 2 },
      // the starter lists made from the investor directory (no operator is listed, so no list of operators)
      { id: 'investors-people', title: 'Investors (people)', description: expect.any(String), curator: 'Still Early', type: 'people', count: 1 },
      { id: 'investors-firms', title: 'Investors (firms)', description: expect.any(String), curator: 'Still Early', type: 'institutions', count: 2 },
    ]); // the list of companies names one the directory does not have, and the last has no one
  });

  it('gives a list in its own order, a page at a time', async () => {
    const { app } = await appOver(seed());
    const res = await request(app).get('/api/lists/founders-to-follow');
    expect(res.body.list).toMatchObject({ id: 'founders-to-follow', title: 'Founders to follow', type: 'people', count: 2 });
    expect(res.body.results.map((p) => p.id)).toEqual(['bea', 'ada-example']);
    expect((await request(app).get('/api/lists/firms?limit=1')).body).toMatchObject({ hasMore: true, nextOffset: 1, results: [{ id: 'investor-skip' }] });
  });

  it('resolves a list of companies against the directory, in the order of the list, and leaves out one that is not there', async () => {
    const { app, rows } = await appOver((companies) => ({ lists: [list({ id: 'picks', title: 'Picks', type: 'companies', itemIds: [companies[2].slug, 'ghost', companies[0].slug] })] }));
    expect((await request(app).get('/api/lists')).body.results.filter((l) => !STARTER_IDS.includes(l.id))).toEqual([{ id: 'picks', title: 'Picks', description: 'Worth watching.', curator: null, type: 'companies', count: 2 }]);
    const res = await request(app).get('/api/lists/picks');
    expect(res.body.results.map((c) => c.name)).toEqual([rows[2].name, rows[0].name]);
    expect(res.body.results[0]).toHaveProperty('slug', rows[2].slug); // a card, as the company list shows it
    expect(res.body.list).toMatchObject({ type: 'companies', count: 2 });
  });

  it('does not show a list of companies that names none the directory has', async () => {
    const { app } = await appOver({ lists: [list({ id: 'picks', title: 'Picks', type: 'companies', itemIds: ['ghost'] })] });
    expect((await request(app).get('/api/lists')).body.results.filter((l) => !STARTER_IDS.includes(l.id))).toEqual([]);
    expect((await request(app).get('/api/lists/picks')).status).toBe(404);
  });

  it('opens the people or institutions of a list through the same questions as the tabs, and refuses a list of the other kind', async () => {
    const { app } = await appOver(seed());
    expect((await request(app).get('/api/people?list=founders-to-follow')).body.results.map((p) => p.id)).toEqual(['bea', 'ada-example']);
    expect((await request(app).get('/api/institutions?list=firms')).body.results.map((i) => i.id)).toEqual(['investor-skip', 'investor-blackbird']);
    expect((await request(app).get('/api/people?list=firms')).status).toBe(400);
    expect((await request(app).get('/api/people?list=nope')).status).toBe(404);
    expect((await request(app).get('/api/lists/nope')).status).toBe(404);
    expect((await request(app).get('/api/lists/nobody')).status).toBe(404); // a list with no one is not a list
  });

  it('does not mix the answer for a list with the answer for the tab: the two are different questions', async () => {
    const { app } = await appOver(seed());
    const tab = await request(app).get('/api/people?role=founder');
    const onList = await request(app).get('/api/people?role=founder&list=founders-to-follow');
    expect(tab.body.results.map((p) => p.id)).toEqual(['ada-example', 'bea']); // by name
    expect(onList.body.results.map((p) => p.id)).toEqual(['bea', 'ada-example']); // by the list
  });
});

describe('a bad entry in the file', () => {
  it('leaves out the entry that does not meet the rules and serves the rest', async () => {
    const { app, communityCatalog } = await appOver({ people: [person(), person({ id: 'bad one', name: 'Bad' }), person({ id: 'long', whyFollow: 'x'.repeat(200) })] });
    expect((await request(app).get('/api/people?role=founder')).body.results.map((p) => p.id)).toEqual(['ada-example']);
    const snap = await communityCatalog.snapshot();
    expect(snap.problems.join('\n')).toMatch(/person "bad one"/);
    expect(snap.problems.join('\n')).toMatch(/person "long": whyFollow/);
  });

  it('serves the rest, and says so in its problems, when the file is not JSON', async () => {
    const { app, file, communityCatalog } = await appOver({ people: [person()] });
    await writeFile(file, '{ not json');
    await communityCatalog.refresh();
    expect((await request(app).get('/api/people')).body.results.filter((p) => p.roleType !== 'investor')).toEqual([]);
    expect((await communityCatalog.snapshot()).problems.join('\n')).toMatch(/could not be read/);
  });
});

describe('what a page of the answer asks of the question', () => {
  it('refuses a page size of 0 or over 100, and an offset that is not a whole number', async () => {
    const { app } = await appOver({ people: many(3) });
    for (const q of ['limit=0', 'limit=101', 'offset=-1', 'offset=1.5']) {
      const res = await request(app).get(`/api/people?${q}`);
      expect(res.status, q).toBe(400);
    }
    expect((await request(app).get('/api/people?limit=100')).status).toBe(200);
  });

  it('is answered once per question: the role and the list are part of the question', async () => {
    const { app } = await appOver({ people: [person(), person({ id: 'op', name: 'Op', roleType: 'operator' })] });
    const a = await request(app).get('/api/people?role=founder');
    const b = await request(app).get('/api/people?role=operator');
    expect(a.body.results.map((p) => p.id)).toEqual(['ada-example']);
    expect(b.body.results.map((p) => p.id)).toEqual(['op']);
  });
});
