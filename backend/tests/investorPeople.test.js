import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateDataset, serializeDataset, writeFiles } from '../src/models/dataset.js';
import { createApp } from '../src/app.js';
import { createCatalog } from '../src/catalog/catalog.js';
import { createInvestorCatalog } from '../src/catalog/investors.js';
import { geoOfLocation, roleClassOf, roleClassLabel, profileKey, isLinkedInProfile, personNameKey, ROLE_CLASSES } from '../src/investors/people.js';
import { tempDir, removeTempDirs } from './helpers/catalog.js';
import { co, world, backed, source, person, role, record } from './helpers/investors.js';

afterEach(removeTempDirs);

const ISO = '2026-10-08T01:00:00.000Z';
const published = { verification_status: 'published' };

// Three public firms (Sydney, Melbourne, San Francisco), a private one, and nine people at them in every state a person can be in. The names are invented.
function data() {
  const orgs = [
    backed('harbour', { ...published, name: 'Harbour Capital', stages: ['Seed'], sectors: ['Software'] }, [['stages', 'Seed'], ['sectors', 'Software']]),
    backed('yarra', { ...published, name: 'Yarra Partners', headquarters_city: 'Melbourne', state: 'VIC', investor_type: 'angel_network', stages: ['Pre-seed'], sectors: ['Health'], lead_or_follow: 'lead' },
      [['stages', 'Pre-seed'], ['sectors', 'Health'], ['lead_or_follow', 'lead']]),
    backed('bay', { ...published, name: 'Bay Ventures', headquarters_city: 'San Francisco', state: null, country: 'United States', inclusion_basis: 'international', stages: ['Series A'], sectors: ['AI'] },
      [['stages', 'Series A'], ['sectors', 'AI']]),
    backed('hidden', { name: 'Hidden Fund' }),
  ];
  const src = [source('team')];
  const stated = (id, over = {}) => person(id, { verification_status: 'published', last_verified_at: ISO, current_organisation_id: 'harbour', current_title: 'Partner', ...over });
  const people = [
    stated('ada', { name: 'Ada Example', location: 'Sydney, NSW', sector_focus: ['Fintech'], stage_focus: ['Seed'], photo: 'https://photos.example/ada.jpg' }),
    stated('ben', { name: 'Ben Sample', current_organisation_id: 'yarra', location: 'Melbourne', current_title: 'Scout', photo: 'http://photos.example/ben.jpg' }),
    stated('cal', { name: 'Cal Demo', current_organisation_id: 'bay', location: 'SF', current_title: 'General Partner' }),
    stated('dee', { name: 'Dee Test', current_organisation_id: 'bay', location: 'Other', current_title: 'Platform Partner' }),
    stated('eli', { name: 'Eli Trial', current_organisation_id: 'bay', location: null, current_title: 'Talent Partner' }),
    stated('fay', { name: 'Fay Invented', current_organisation_id: 'harbour', location: 'Brisbane', current_title: 'Investor', role_class: 'other' }),
    stated('gus', { name: 'Gus Hidden', current_organisation_id: 'hidden', location: 'Sydney' }),
    stated('hal', { name: 'Hal Candidate', verification_status: 'candidate', last_verified_at: null }),
  ];
  // Each claim a published person makes (a place, a focus) has the record of the page that says it.
  const claims = people.filter((p) => p.verification_status === 'published').flatMap((p) => [
    ...(p.location ? [['location', p.location]] : []), ...(p.sector_focus ?? []).map((s) => ['sector_focus', s]), ...(p.stage_focus ?? []).map((s) => ['stage_focus', s]),
  ].map(([field, value]) => record(p.id, field, value, 'team', { subject_type: 'investor_person' })));
  return world({
    companies: [co('Acme')],
    orgs,
    extra: {
      sources: src,
      verification_records: claims,
      investor_people: people,
      investor_people_organisations: people.filter((p) => p.verification_status === 'published' || p.id === 'hal')
        .map((p) => role(p.id, p.current_organisation_id, 'team', { role: p.current_title, verification_status: p.id === 'hal' ? 'unverified' : 'verified', verified_at: p.id === 'hal' ? null : ISO })),
    },
  });
}

async function app() {
  const dir = await tempDir();
  await mkdir(dir, { recursive: true });
  await writeFiles(dir, serializeDataset(data()));
  const catalog = createCatalog({ file: path.join(dir, 'startups.json'), reloadMs: 0 });
  const investorCatalog = createInvestorCatalog({ dir, reloadMs: 0 });
  await investorCatalog.refresh();
  const correctionsFile = path.join(dir, 'investor_corrections.json');
  return { investorCatalog, correctionsFile, app: createApp({ catalog, investorCatalog, correctionsFile }) };
}
const get = async (f, query = '') => (await request(f.app).get(`/api/investors${query}`)).body;
const names = (body) => body.results.map((r) => r.name);

describe('the data these tests use is itself valid', () => {
  it('passes every check the store makes', () => expect(validateDataset(data()).join('\n')).toBe(''));
});

describe('where a person is, from the place a directory lists', () => {
  it('reads Australia from a city, a state or the country, and nothing else', () => {
    for (const text of ['Sydney', 'Melbourne, VIC', 'Sydney NSW', 'Perth, Western Australia', 'Australia', 'Adelaide, SA']) expect(geoOfLocation(text).scope, text).toBe('au');
    expect(geoOfLocation('Melbourne, VIC')).toMatchObject({ city: 'Melbourne', state: 'VIC', country: 'Australia' });
  });

  it('never presumes a place is Australian: a place that is not known, or is somewhere else, is global', () => {
    for (const text of ['SF', 'NYC', 'US', 'UK', 'Europe', 'SEA', 'Other', 'WA', 'SA', 'Richmond', 'Melbourne, Florida', '', null, undefined]) expect(geoOfLocation(text).scope, String(text)).toBe('global');
    expect(geoOfLocation('SF')).toMatchObject({ city: 'San Francisco', country: 'United States' });
    expect(geoOfLocation('Europe')).toMatchObject({ country: null, region: 'Europe' });
    expect(geoOfLocation('Other').label).toBe('Other');
  });
});

describe('what kind of role a title is', () => {
  it('tells investing roles from scouts, talent, platform and other roles', () => {
    expect(['Partner', 'General Partner', 'Investment Partner', 'Venture Partner', 'Principal', 'Investor', 'Analyst', 'Managing Director'].map(roleClassOf)).toEqual(Array(8).fill('investment'));
    expect(roleClassOf('Scout')).toBe('scout');
    expect(['Talent Partner', 'Head of People', 'Recruiter'].map(roleClassOf)).toEqual(Array(3).fill('talent'));
    expect(['Platform Partner', 'Operating Partner', 'Head of Platform', 'Community Manager'].map(roleClassOf)).toEqual(Array(4).fill('platform'));
    expect(roleClassOf('Founder & CEO')).toBe('other');
  });

  it('gives no class to no title: a firm alone does not make someone an investor', () => {
    expect(roleClassOf(null)).toBeNull();
    expect(roleClassOf('  ')).toBeNull();
    expect(roleClassLabel(roleClassOf('Scout'))).toBe('Scout');
    expect(ROLE_CLASSES).toEqual(['investment', 'scout', 'talent', 'platform', 'other']);
  });
});

describe('matching a person', () => {
  it('writes a professional-profile address one way, however it is written', () => {
    const key = 'linkedin.com/in/jane-doe';
    for (const url of ['https://www.linkedin.com/in/jane-doe', 'http://au.linkedin.com/in/Jane-Doe/', 'https://linkedin.com/in/jane-doe?utm_source=x#top']) expect(profileKey(url)).toBe(key);
    expect(profileKey('mailto:jane@example.com')).toBeNull();
    expect(profileKey('not a url')).toBeNull();
    expect(profileKey('https://Jane.Example.com/About/')).toBe('jane.example.com/About');
  });

  it('accepts a LinkedIn address only at /in/<name>: a company, a search or a post is not a person\'s profile', () => {
    expect(isLinkedInProfile('https://www.linkedin.com/in/jane-doe/')).toBe(true);
    for (const url of ['https://www.linkedin.com/company/acme', 'https://www.linkedin.com/search/results/people/?keywords=a', 'https://www.linkedin.com/posts/x_1']) expect(isLinkedInProfile(url)).toBe(false);
  });

  it('writes a name one way, without accents, case, punctuation or a title', () => {
    expect(personNameKey('Dr. José  O\'Brien')).toBe(personNameKey('jose o brien'));
  });
});

describe('the list, as it always was', () => {
  it('is the firms alone, with no kind on a card, when no kind is asked for', async () => {
    const f = await app();
    const body = await get(f);
    expect(names(body)).toEqual(['Bay Ventures', 'Harbour Capital', 'Yarra Partners']);
    expect(body.total).toBe(3);
    for (const r of body.results) expect(r).not.toHaveProperty('kind');
  });

  it('keeps people out of the map\'s marks even when asked for them', async () => {
    const f = await app();
    const pins = (await request(f.app).get('/api/investors/pins?kind=all')).body;
    expect(pins.count).toBe(3);
    expect(pins.items.every((i) => i.slug)).toBe(true);
  });
});

describe('the people in the list', () => {
  it('lists only people who are published beside a public firm, with their kind, role, firm, place and where they are based', async () => {
    const f = await app();
    const body = await get(f, '?kind=person');
    expect(names(body)).toEqual(['Ada Example', 'Ben Sample', 'Cal Demo', 'Dee Test', 'Eli Trial', 'Fay Invented']);
    expect(body.total).toBe(6);
    const ada = body.results.find((r) => r.slug === 'ada');
    expect(ada).toMatchObject({
      kind: 'person', key: 'people/ada', title: 'Partner', role_class: 'investment', role_label: 'Investing', scope: 'au', type_label: 'Venture Capital',
      organisation: { slug: 'harbour', name: 'Harbour Capital', domain: 'harbour.example' }, location: { city: 'Sydney', state: 'NSW', country: 'Australia', label: 'Sydney, NSW' },
    });
    expect(names(body)).not.toContain('Gus Hidden'); // beside a firm that is not public
    expect(names(body)).not.toContain('Hal Candidate'); // not published
  });

  it('lists firms and people together, firms with a kind and a key too, once people are asked for', async () => {
    const f = await app();
    const body = await get(f, '?kind=all');
    expect(body.total).toBe(9);
    expect(body.count).toBe(9);
    expect(body.results.filter((r) => r.kind === 'firm').map((r) => r.key)).toEqual(expect.arrayContaining(['harbour', 'yarra', 'bay']));
    expect(body.results.filter((r) => r.kind === 'person').map((r) => r.key)).toEqual(expect.arrayContaining(['people/ada', 'people/ben']));
    expect(body.results.find((r) => r.key === 'bay')).toMatchObject({ kind: 'firm', scope: 'global' });
    expect(body.results.find((r) => r.key === 'harbour')).toMatchObject({ kind: 'firm', scope: 'au' });
  });

  it('shows the focus the record states for a person, and otherwise the firm\'s, and says which it is', async () => {
    const f = await app();
    const body = await get(f, '?kind=person');
    expect(body.results.find((r) => r.slug === 'ada')).toMatchObject({ sectors: ['Fintech'], stages: ['Seed'], focus_from: 'person' });
    expect(body.results.find((r) => r.slug === 'ben')).toMatchObject({ sectors: ['Health'], stages: ['Pre-seed'], focus_from: 'firm' });
  });

  it('uses the role a person was given by hand over the one their title says', async () => {
    const f = await app();
    const fay = (await get(f, '?kind=person')).results.find((r) => r.slug === 'fay');
    expect(fay).toMatchObject({ title: 'Investor', role_class: 'other' });
  });
});

describe('Australia and global', () => {
  it('keeps the Australian ones with scope=au, firms and people, and never counts an unknown place as Australia', async () => {
    const f = await app();
    const body = await get(f, '?kind=all&scope=au');
    expect(names(body).sort()).toEqual(['Ada Example', 'Ben Sample', 'Fay Invented', 'Harbour Capital', 'Yarra Partners'].sort());
    for (const r of body.results) expect(r.scope).toBe('au');
    expect(names(body)).not.toContain('Cal Demo'); // San Francisco
    expect(names(body)).not.toContain('Dee Test'); // "Other"
    expect(names(body)).not.toContain('Eli Trial'); // no place at all
  });

  it('lists every investor with scope=global, or with no scope', async () => {
    const f = await app();
    expect((await get(f, '?kind=all&scope=global')).count).toBe(9);
    expect((await get(f, '?kind=all')).count).toBe(9);
    expect((await get(f, '?scope=au')).count).toBe(2); // firms only, by default
  });

  it('counts both scopes and both kinds in the options, whatever list is being drawn', async () => {
    const f = await app();
    const meta = (await request(f.app).get('/api/investors/meta?kind=all')).body;
    expect(meta.kinds).toEqual({ firm: 3, person: 6 });
    expect(meta.scopes).toEqual({ au: 5, global: 9 });
    expect(meta.total).toBe(9);
    const firms = (await request(f.app).get('/api/investors/meta')).body;
    expect(firms.total).toBe(3);
    expect(firms.kinds).toEqual({ firm: 3, person: 6 });
  });
});

describe('roles', () => {
  it('filters people by the kind of role, and a firm has none', async () => {
    const f = await app();
    expect(names(await get(f, '?kind=all&role=scout'))).toEqual(['Ben Sample']);
    expect(names(await get(f, '?kind=person&role=talent,platform')).sort()).toEqual(['Dee Test', 'Eli Trial']);
    expect(names(await get(f, '?kind=all&role=investment')).sort()).toEqual(['Ada Example', 'Cal Demo']);
  });

  it('counts the roles among the people', async () => {
    const f = await app();
    const roles = (await request(f.app).get('/api/investors/meta?kind=person')).body.roles;
    expect(roles).toEqual([
      { value: 'investment', count: 2, label: 'Investing' }, { value: 'scout', count: 1, label: 'Scout' }, { value: 'talent', count: 1, label: 'Talent' },
      { value: 'platform', count: 1, label: 'Platform' }, { value: 'other', count: 1, label: 'Other role' },
    ]);
  });
});

describe('searching, saving and the filters that only describe a firm', () => {
  it('finds a person by name, title, firm or place, and a firm by the name of its team', async () => {
    const f = await app();
    expect(names(await get(f, '?kind=person&search=ada'))).toEqual(['Ada Example']);
    expect(names(await get(f, '?kind=person&search=scout'))).toEqual(['Ben Sample']);
    expect(names(await get(f, '?kind=person&search=bay%20ventures')).sort()).toEqual(['Cal Demo', 'Dee Test', 'Eli Trial']);
    expect(names(await get(f, '?kind=person&search=melbourne'))).toEqual(['Ben Sample']);
    expect(names(await get(f, '?kind=firm&search=ada'))).toEqual(['Harbour Capital']); // a firm is found by the name of its published team too
  });

  it('lists the ones saved, a person by people/<slug> and a firm by its address, narrowed by every other filter', async () => {
    const f = await app();
    expect(names(await get(f, '?kind=all&slug=harbour,people/ben,people/nobody,nobody')).sort()).toEqual(['Ben Sample', 'Harbour Capital']);
    expect(names(await get(f, '?kind=all&slug=harbour,people/ben&scope=au&role=scout'))).toEqual(['Ben Sample']);
  });

  it('leaves people out of a question about leading, cheques or whether an investor is still investing: a person states none of them', async () => {
    const f = await app();
    expect(names(await get(f, '?kind=all&lead=lead'))).toEqual(['Yarra Partners']);
    expect(names(await get(f, '?kind=all&active=active'))).toEqual([]);
  });

  it('filters people by type, stage, sector and place the way it does firms', async () => {
    const f = await app();
    expect(names(await get(f, '?kind=person&type=angel_network'))).toEqual(['Ben Sample']);
    expect(names(await get(f, '?kind=all&stage=Seed')).sort()).toEqual(['Ada Example', 'Harbour Capital', 'Fay Invented'].sort());
    expect(names(await get(f, '?kind=person&sector=fintech'))).toEqual(['Ada Example']);
    expect(names(await get(f, '?kind=person&location=VIC'))).toEqual(['Ben Sample']);
    expect(names(await get(f, '?kind=person&location=United%20States')).sort()).toEqual(['Cal Demo']);
  });

  it('answers a different kind or scope with a different answer, not the one kept for another question', async () => {
    const f = await app();
    const a = await get(f, '?kind=person');
    const b = await get(f, '?kind=firm');
    const c = await get(f, '?kind=person&scope=au');
    expect([a.count, b.count, c.count]).toEqual([6, 3, 3]);
  });

  it('refuses a kind or a scope it does not know', async () => {
    const f = await app();
    expect((await request(f.app).get('/api/investors?kind=robot')).status).toBe(400);
    expect((await request(f.app).get('/api/investors?scope=moon')).status).toBe(400);
    expect((await request(f.app).get('/api/investors/meta?kind=robot')).status).toBe(400);
  });

  it('counts the options of the facets over the entries asked for', async () => {
    const f = await app();
    const body = await get(f, '?kind=all&limit=1&facets=kind,scope,role');
    expect(body.facets.kind.values).toEqual([{ value: 'person', count: 6 }, { value: 'firm', count: 3 }]);
    expect(body.facets.scope.values).toEqual([{ value: 'au', count: 5 }, { value: 'global', count: 4 }]);
  });
});

describe('a person\'s profile', () => {
  it('says their role class, their firm with its website, and where they are based, and gives no private detail', async () => {
    const f = await app();
    const res = await request(f.app).get('/api/investor-people/cal');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      slug: 'cal', name: 'Cal Demo', current_title: 'General Partner', role_class: 'investment', role_label: 'Investing', location: 'SF', scope: 'global',
      organisation: { slug: 'bay', name: 'Bay Ventures', domain: 'bay.example', website: 'https://bay.example/', type_label: 'Venture Capital', country: 'United States', scope: 'global' },
    });
    expect(Object.keys(res.body)).not.toEqual(expect.arrayContaining(['email', 'phone']));
  });

  it('is a 404 for a person beside a firm that is not public, or who is not published', async () => {
    const f = await app();
    expect((await request(f.app).get('/api/investor-people/gus')).status).toBe(404);
    expect((await request(f.app).get('/api/investor-people/hal')).status).toBe(404);
  });

  it('carries their picture only when it is a secure address, on their card and in their profile, and none otherwise', async () => {
    const f = await app();
    expect((await request(f.app).get('/api/investor-people/ada')).body.photo).toBe('https://photos.example/ada.jpg');
    expect((await request(f.app).get('/api/investor-people/ben')).body.photo).toBeNull(); // an insecure address is left out, not rewritten
    const cards = Object.fromEntries((await get(f, '?kind=person')).results.map((r) => [r.slug, r.photo]));
    expect(cards.ada).toBe('https://photos.example/ada.jpg');
    expect(cards.ben).toBeNull();
    expect(cards.cal).toBeNull(); // no picture held: the page draws initials
  });

  it('says on what basis their firm is listed, so a page can tell a firm that backs Australian startups from one only listed to be found', async () => {
    const f = await app();
    expect((await request(f.app).get('/api/investor-people/cal')).body.organisation.inclusion_basis).toBe('international');
    expect((await request(f.app).get('/api/investor-people/ada')).body.organisation.inclusion_basis).not.toBe('international');
  });
});

describe('a correction or a removal asked for a person', () => {
  const ask = (f, slug, body) => request(f.app).post(`/api/investor-people/${slug}/corrections`).send(body);

  it('is staged against the person\'s own key for a person to read, and changes nothing itself', async () => {
    const f = await app();
    const before = await get(f, '?kind=person');
    const res = await ask(f, 'ada', { message: 'Please remove this profile.', source_url: 'https://ada.example/', email: 'ada@example.com' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'pending' });
    const rows = JSON.parse(await readFile(f.correctionsFile, 'utf8'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ investor: 'people/ada', investor_name: 'Ada Example', message: 'Please remove this profile.', source_url: 'https://ada.example/', status: 'pending' });
    expect(await get(f, '?kind=person')).toEqual(before); // staged, never applied
  });

  it('is refused without a message, with a page that is not an http(s) address, or with too long a message, and stages nothing', async () => {
    const f = await app();
    expect((await ask(f, 'ada', { message: '   ' })).status).toBe(400);
    expect((await ask(f, 'ada', { message: 'x', source_url: 'javascript:alert(1)' })).status).toBe(400);
    expect((await ask(f, 'ada', { message: 'x'.repeat(2001) })).status).toBe(400);
    await expect(readFile(f.correctionsFile, 'utf8')).rejects.toThrow();
  });

  it('is a 404 for a person who is not public, so it cannot be used to find out who is listed privately', async () => {
    const f = await app();
    expect((await ask(f, 'gus', { message: 'x' })).status).toBe(404);
    expect((await ask(f, 'hal', { message: 'x' })).status).toBe(404);
    expect((await ask(f, 'nobody', { message: 'x' })).status).toBe(404);
  });
});

describe('what the options are for a kind of list', () => {
  it('counts the people and the firms and what is in Australia, and offers the roles people have', async () => {
    const f = await app();
    const meta = (await request(f.app).get('/api/investors/meta?kind=all')).body;
    expect(meta.kinds).toEqual({ firm: 3, person: 6 });
    expect(meta.scopes).toEqual({ au: 5, global: 9 });
    expect(meta.roles.map((r) => r.value).sort()).toEqual(['investment', 'other', 'platform', 'scout', 'talent']);
    expect(meta.roles.find((r) => r.value === 'scout')).toMatchObject({ count: 1, label: 'Scout' });
  });

  it('counts the options over the Australian investors when scope=au is asked, so a filter never offers a choice with nothing behind it', async () => {
    const f = await app();
    const au = (await request(f.app).get('/api/investors/meta?kind=all&scope=au')).body;
    const all = (await request(f.app).get('/api/investors/meta?kind=all')).body;
    expect(au.total).toBeLessThan(all.total);
    expect(au.locations.map((l) => l.value)).not.toContain('United States');
    expect(all.locations.map((l) => l.value)).toContain('United States');
  });
});
