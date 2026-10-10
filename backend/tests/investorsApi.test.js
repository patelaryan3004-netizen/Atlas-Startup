import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validateDataset, serializeDataset, writeFiles } from '../src/models/dataset.js';
import { createApp } from '../src/app.js';
import { createCatalog } from '../src/catalog/catalog.js';
import { createInvestorCatalog } from '../src/catalog/investors.js';
import { createResponder } from '../src/catalog/respond.js';
import { createInvestorsRouter } from '../src/routes/investors.js';
import { tempDir, removeTempDirs } from './helpers/catalog.js';
import { co, world, backed, source, investment, person, role } from './helpers/investors.js';

afterEach(removeTempDirs);

// Eight investors in every status, three companies, and the rows that join them. What the public may see is the published
// and inactive ones, the verified investments of companies in the directory, and the published people.
function data() {
  const published = { verification_status: 'published' };
  const orgs = [
    backed('oif', { ...published, name: 'OIF Ventures', aliases: ['OIF'], stages: ['Seed', 'Series A'], sectors: ['Software', 'Health'], lead_or_follow: 'lead',
      typical_cheque_min: 250000, typical_cheque_max: 1000000, cheque_currency: 'AUD', description: 'Backs software founders.', investment_thesis: 'We back founders early.',
      jobs_url: 'https://oif.example/jobs', active_status: 'active', geographies: ['Australia'] },
    [['stages', 'Seed'], ['stages', 'Series A'], ['sectors', 'Software'], ['sectors', 'Health'], ['lead_or_follow', 'lead'], ['typical_cheque', { min: 250000, max: 1000000, currency: 'AUD' }],
      ['description', 'Backs software founders.'], ['investment_thesis', 'We back founders early.'], ['jobs_url', 'https://oif.example/jobs'], ['active_status', 'active'], ['geographies', 'Australia']]),
    backed('skip', { ...published, name: 'Skip Capital', headquarters_city: 'Melbourne', state: 'VIC', stages: ['Series A', 'Series B'], sectors: ['Software'], lead_or_follow: 'both' },
      [['stages', 'Series A'], ['stages', 'Series B'], ['sectors', 'Software'], ['lead_or_follow', 'both']]),
    backed('angels', { ...published, name: 'Brisbane Angels', investor_type: 'angel_network', headquarters_city: 'Brisbane', state: 'QLD', active_status: 'active' }, [['active_status', 'active']]),
    backed('kiwi', { ...published, name: 'Kiwi Ventures', investor_type: 'corporate_vc', headquarters_city: 'Auckland', state: null, country: 'New Zealand', inclusion_basis: 'invests_in_australian_startups', typical_cheque_min: 5e6, typical_cheque_max: 1e7, cheque_currency: 'NZD' },
      [['typical_cheque', { min: 5e6, max: 1e7, currency: 'NZD' }]]),
    backed('old', { name: 'Old Fund', verification_status: 'inactive', active_status: 'inactive' }, [['active_status', 'inactive']]),
    backed('ver', { name: 'Verified Not Public' }),
    { org: { id: 'cand', name: 'Candidate Co', slug: 'cand', aliases: [], verification_status: 'candidate' } },
    { org: { id: 'rej', name: 'Rejected Co', slug: 'rej', aliases: [], verification_status: 'rejected' } },
  ];
  const sources = [source('portfolio'), source('team'), source('news', 'press')];
  const ds = world({
    companies: [co('Acme', { hiring: true, sector: 'SaaS' }), co('Beta'), co('Cee')],
    orgs,
    extra: {
      sources,
      funds: [{ id: 'oif-fund-1', name: 'OIF Fund 1', slug: 'oif-fund-1', organisation_id: 'oif', vintage_year: 2021, publicly_disclosed_size: 5e7, size_currency: 'AUD', verification_status: 'published', last_verified_at: '2026-10-08T01:00:00.000Z' }],
      investments: [
        investment('oif', 'acme', 'portfolio', { round: 'Seed', investment_date: '2026-03', amount: 3500000, currency: 'AUD', lead_status: 'lead', fund_id: 'oif-fund-1', investor_person_id: 'jo' }),
        investment('oif', 'beta', 'news'),
        investment('oif', 'cee', 'portfolio', { verification_status: 'rejected' }),
        investment('skip', 'acme', 'portfolio', { round: 'Series A', investment_date: '2025-06' }),
        investment('skip', 'beta', 'portfolio', { verification_status: 'unverified', verified_at: null }),
        investment('ver', 'acme', 'portfolio'),
      ],
      investor_people: [
        person('jo', { name: 'Jo Citizen', verification_status: 'published', last_verified_at: '2026-10-08T01:00:00.000Z', current_organisation_id: 'oif', current_title: 'Partner', biography: 'Invests in software.', sector_focus: ['Software'] }),
        person('ann', { name: 'Ann Hidden', verification_status: 'candidate', current_organisation_id: 'oif', current_title: 'Analyst' }),
      ],
      investor_people_organisations: [role('jo', 'oif', 'team'), role('ann', 'oif', 'team', { role: 'Analyst' })],
      verification_records: [
        { id: 'oif-fund-1.vintage', subject_type: 'fund', subject_id: 'oif-fund-1', field: 'vintage_year', value: 2021, source_id: 'portfolio', confidence: 'high', verified_at: '2026-10-08T01:00:00.000Z', status: 'active', note: 'Fund 1 (2021).' },
        { id: 'oif-fund-1.size', subject_type: 'fund', subject_id: 'oif-fund-1', field: 'size', value: { amount: 5e7, currency: 'AUD' }, source_id: 'portfolio', confidence: 'high', verified_at: '2026-10-08T01:00:00.000Z', status: 'active', note: 'A$50 million.' },
        { id: 'jo.bio', subject_type: 'investor_person', subject_id: 'jo', field: 'biography', value: 'Invests in software.', source_id: 'team', confidence: 'high', verified_at: '2026-10-08T01:00:00.000Z', status: 'active', note: 'Jo invests in software, the team page says.' },
        { id: 'jo.sector', subject_type: 'investor_person', subject_id: 'jo', field: 'sector_focus', value: 'Software', source_id: 'team', confidence: 'high', verified_at: '2026-10-08T01:00:00.000Z', status: 'active', note: 'Software.' },
      ],
    },
  });
  return ds;
}

async function app({ reloadMs = 0, ds = data() } = {}) {
  const dir = await tempDir();
  await mkdir(dir, { recursive: true });
  await writeFiles(dir, serializeDataset(ds));
  const correctionsFile = path.join(dir, 'investor_corrections.json');
  const catalog = createCatalog({ file: path.join(dir, 'startups.json'), reloadMs });
  const investorCatalog = createInvestorCatalog({ dir, reloadMs });
  await investorCatalog.refresh();
  return { dir, correctionsFile, investorCatalog, rewrite: (next) => writeFiles(dir, serializeDataset(next)), app: createApp({ catalog, investorCatalog, correctionsFile }) };
}
const names = (res) => res.body.results.map((r) => r.name);

describe('the data these tests use is itself valid', () => {
  it('passes every check the store makes', () => expect(validateDataset(data()).join('\n')).toBe(''));
});

describe('what the public may see of the investors', () => {
  it('lists only the published and the inactive ones, never a candidate, a checked-but-unpublished or a rejected one', async () => {
    const f = await app();
    const res = await request(f.app).get('/api/investors');
    expect(res.status).toBe(200);
    expect(names(res)).toEqual(['Brisbane Angels', 'Kiwi Ventures', 'OIF Ventures', 'Old Fund', 'Skip Capital']);
    expect(res.body).toMatchObject({ total: 5, count: 5, offset: 0, limit: 24, hasMore: false });
    for (const slug of ['ver', 'cand', 'rej']) expect((await request(f.app).get(`/api/investors/${slug}`)).status).toBe(404);
    expect((await request(f.app).get('/api/investors/oif')).status).toBe(200);
    expect((await request(f.app).get('/api/investors/old')).body.status).toBe('inactive');
  });

  it('gives a card the few facts a list shows, with how many sourced portfolio companies it has', async () => {
    const f = await app();
    const res = await request(f.app).get('/api/investors?search=oif');
    expect(res.body.results[0]).toEqual({
      slug: 'oif', name: 'OIF Ventures', aliases: ['OIF'], type: 'venture_capital', type_label: 'Venture Capital', website: 'https://oif.example/', domain: 'oif.example',
      stages: ['Seed', 'Series A'], sectors: ['Software', 'Health'], location: { city: 'Sydney', state: 'NSW', country: 'Australia', label: 'Sydney, NSW' },
      portfolio_count: 2, active_status: 'active', status: 'published', verified_at: '2026-10-08T01:00:00.000Z',
    });
  });

  it('counts as portfolio only a verified, sourced investment, not a rejected or unverified one, and not a company\'s own claim', async () => {
    const f = await app();
    const counts = Object.fromEntries((await request(f.app).get('/api/investors')).body.results.map((r) => [r.slug, r.portfolio_count]));
    expect(counts).toMatchObject({ oif: 2, skip: 1, angels: 0, kiwi: 0 });
  });
});

describe('one investor in full', () => {
  it('has every section a source backs, and the sections nothing backs are empty', async () => {
    const f = await app();
    const oif = (await request(f.app).get('/api/investors/oif')).body;
    expect(oif).toMatchObject({
      name: 'OIF Ventures', description: 'Backs software founders.', investment_thesis: 'We back founders early.', geographies: ['Australia'], lead_or_follow: 'lead',
      cheque: { min: 250000, max: 1000000, currency: 'AUD' }, jobs: { url: 'https://oif.example/jobs' },
    });
    const skip = (await request(f.app).get('/api/investors/skip')).body;
    expect(skip).toMatchObject({ description: null, investment_thesis: null, cheque: null, team: [], funds: [], portfolio: expect.any(Array), related: expect.any(Array) });
  });

  it('lists the team as published people with their verified roles, never an unpublished one', async () => {
    const f = await app();
    const oif = (await request(f.app).get('/api/investors/oif')).body;
    expect(oif.team).toEqual([expect.objectContaining({ person: { slug: 'jo', name: 'Jo Citizen' }, role: 'Partner', is_current: true })]);
    expect(JSON.stringify(oif)).not.toContain('Ann Hidden');
  });

  it('lists the funds, with a disclosed size and how many portfolio companies each has', async () => {
    const f = await app();
    const oif = (await request(f.app).get('/api/investors/oif')).body;
    expect(oif.funds).toEqual([{ slug: 'oif-fund-1', name: 'OIF Fund 1', vintage_year: 2021, size: { amount: 5e7, currency: 'AUD' }, stage_focus: [], sector_focus: [], active_status: null, portfolio_count: 1 }]);
  });

  it('lists the portfolio with the page behind each row, newest first, and the dated ones as recent', async () => {
    const f = await app();
    const oif = (await request(f.app).get('/api/investors/oif')).body;
    expect(oif.portfolio.map((r) => r.company.name)).toEqual(['Acme', 'Beta']);
    expect(oif.portfolio[0]).toMatchObject({
      company: { slug: 'acme', name: 'Acme', hiring: true }, round: 'Seed', investment_date: '2026-03', amount: 3500000, currency: 'AUD', lead_status: 'lead',
      fund: { slug: 'oif-fund-1', name: 'OIF Fund 1' }, person: { slug: 'jo', name: 'Jo Citizen' }, source: { url: 'https://portfolio.example/about', kind: 'investor_website' },
    });
    expect(oif.portfolio[1]).toMatchObject({ round: null, investment_date: null, fund: null, person: null, source: { kind: 'press' } });
    expect(oif.recent.map((r) => r.company.name)).toEqual(['Acme']);
    expect(oif.portfolio[0]).not.toHaveProperty('_fund');
  });

  it('names the portfolio companies that are hiring, and the investors that back the same companies', async () => {
    const f = await app();
    const oif = (await request(f.app).get('/api/investors/oif')).body;
    expect(oif.jobs.hiring).toEqual([expect.objectContaining({ slug: 'acme', name: 'Acme' })]);
    expect(oif.related).toEqual([{ slug: 'skip', name: 'Skip Capital', shared: 1, companies: ['Acme'] }]);
  });

  it('lists the sources behind a public record and what each backs, and serves none of the words a page says', async () => {
    const f = await app();
    const oif = (await request(f.app).get('/api/investors/oif')).body;
    const backs = Object.fromEntries(oif.sources.map((s) => [s.id, s.backs]));
    expect(backs['oif-site']).toEqual(expect.arrayContaining(['website', 'stages', 'sectors', 'typical_cheque', 'investment_thesis']));
    expect(backs.portfolio).toContain('portfolio');
    expect(backs.team).toContain('team');
    expect(JSON.stringify(oif)).not.toContain('The page says');
    expect(JSON.stringify(oif)).not.toContain('On the team page');
    expect(oif.sources[0]).toEqual({ id: expect.any(String), title: expect.any(String), url: expect.stringMatching(/^https:/), publisher: expect.any(String), kind: expect.any(String), retrieved_at: expect.any(String), backs: expect.any(Array) });
  });

  it('serves no internal field: ids of records, notes, a status of a record it hides', async () => {
    const f = await app();
    const text = JSON.stringify((await request(f.app).get('/api/investors/oif')).body);
    expect(text).not.toMatch(/verification_status|verification_records|created_at|updated_at|"note"|"id":"oif\./);
  });
});

describe('a published person', () => {
  it('is served with their roles and what a source attributes to them, and nothing private', async () => {
    const f = await app();
    const res = await request(f.app).get('/api/investor-people/jo');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      slug: 'jo', name: 'Jo Citizen', current_title: 'Partner', organisation: { slug: 'oif', name: 'OIF Ventures' }, biography: 'Invests in software.', sector_focus: ['Software'],
      roles: [expect.objectContaining({ organisation: { slug: 'oif', name: 'OIF Ventures' }, role: 'Partner', is_current: true })],
      investments: [expect.objectContaining({ company: expect.objectContaining({ name: 'Acme' }), round: 'Seed' })],
      companies: [expect.objectContaining({ name: 'Acme' })],
    });
    expect(Object.keys(res.body)).not.toEqual(expect.arrayContaining(['email', 'phone']));
  });

  it('is not served until published, and is a 404 for a name nobody has', async () => {
    const f = await app();
    expect((await request(f.app).get('/api/investor-people/ann')).status).toBe(404);
    expect((await request(f.app).get('/api/investor-people/nobody')).status).toBe(404);
  });
});

describe('searching and filtering the directory', () => {
  const find = async (f, q) => names(await request(f.app).get(`/api/investors?${q}`));

  it('searches a firm\'s name and aliases, its team, its sectors and stages, its place and its portfolio companies', async () => {
    const f = await app();
    expect(await find(f, 'search=skip')).toEqual(['Skip Capital']);
    expect(await find(f, 'search=OIF')).toEqual(['OIF Ventures']);
    expect(await find(f, 'search=jo%20citizen')).toEqual(['OIF Ventures']);
    expect(await find(f, 'search=health')).toEqual(['OIF Ventures']);
    expect(await find(f, 'search=series%20b')).toEqual(['Skip Capital']);
    expect(await find(f, 'search=melbourne')).toEqual(['Skip Capital']);
    expect(await find(f, 'search=acme')).toEqual(['OIF Ventures', 'Skip Capital']);
    expect(await find(f, 'search=angel%20network')).toEqual(['Brisbane Angels']);
    expect(await find(f, 'search=zzz')).toEqual([]);
  });

  it('does not search a person who is not public, or a company only a company\'s own record names', async () => {
    const f = await app();
    expect(await find(f, 'search=ann%20hidden')).toEqual([]);
    expect(await find(f, 'search=cee')).toEqual([]);
  });

  it('filters by type, stage, sector (any case), place, lead or follow and active status', async () => {
    const f = await app();
    expect(await find(f, 'type=angel_network')).toEqual(['Brisbane Angels']);
    expect(await find(f, 'type=angel_network,corporate_vc')).toEqual(['Brisbane Angels', 'Kiwi Ventures']);
    expect(await find(f, 'stage=Series%20A')).toEqual(['OIF Ventures', 'Skip Capital']);
    expect(await find(f, 'stage=Seed&type=venture_capital')).toEqual(['OIF Ventures']);
    expect(await find(f, 'sector=software')).toEqual(['OIF Ventures', 'Skip Capital']);
    expect(await find(f, 'location=VIC')).toEqual(['Skip Capital']);
    expect(await find(f, 'location=New%20Zealand')).toEqual(['Kiwi Ventures']);
    expect(await find(f, 'location=NSW,QLD')).toEqual(['Brisbane Angels', 'OIF Ventures', 'Old Fund']);
    expect(await find(f, 'lead=lead')).toEqual(['OIF Ventures', 'Skip Capital']);
    expect(await find(f, 'lead=follow')).toEqual(['Skip Capital']);
    expect(await find(f, 'active=active')).toEqual(['Brisbane Angels', 'OIF Ventures']);
    expect(await find(f, 'active=inactive')).toEqual(['Old Fund']);
  });

  it('finds a firm by the exact name a company gives it, or by one of its other names, however it is cased or punctuated', async () => {
    const f = await app();
    expect(await find(f, 'name=OIF%20Ventures')).toEqual(['OIF Ventures']);
    expect(await find(f, 'name=oif')).toEqual(['OIF Ventures']); // an alias
    expect(await find(f, 'name=skip%20%20capital')).toEqual(['Skip Capital']);
    expect(await find(f, 'name=Skip%20Capital&name=Brisbane%20Angels')).toEqual(['Brisbane Angels', 'Skip Capital']);
    expect(await find(f, 'name=Skip')).toEqual([]); // not a part of a name: that is what search is for
    expect(await find(f, 'name=Verified%20Not%20Public')).toEqual([]); // not public, so not linkable
  });

  it('filters by cheque size only among firms that state one in Australian dollars, never counting an unknown as a fit', async () => {
    const f = await app();
    expect(await find(f, 'chequeMin=500000&chequeMax=600000')).toEqual(['OIF Ventures']);
    expect(await find(f, 'chequeMin=2000000')).toEqual([]); // OIF's range tops out at 1M; Kiwi states New Zealand dollars
    expect(await find(f, 'chequeMax=100000')).toEqual([]);
    expect(await find(f, 'chequeMin=0')).toEqual(['OIF Ventures']);
  });

  it('answers a different filter with a different answer, not the one kept for the unfiltered question', async () => {
    const f = await app();
    const all = await request(f.app).get('/api/investors');
    const one = await request(f.app).get('/api/investors?type=angel_network');
    const two = await request(f.app).get('/api/investors?location=VIC');
    expect(all.body.count).toBe(5);
    expect(one.body.count).toBe(1);
    expect(two.body.count).toBe(1);
    expect(one.body.results[0].slug).not.toBe(two.body.results[0].slug);
    expect((await request(f.app).get('/api/investors?chequeMin=500000')).body.count).toBe(1);
  });

  it('sorts by name, by how many companies a firm backs, or by place', async () => {
    const f = await app();
    expect(names(await request(f.app).get('/api/investors?sort=portfolio'))).toEqual(['OIF Ventures', 'Skip Capital', 'Brisbane Angels', 'Kiwi Ventures', 'Old Fund']);
    expect(names(await request(f.app).get('/api/investors?sort=location'))).toEqual(['Kiwi Ventures', 'Brisbane Angels', 'Skip Capital', 'OIF Ventures', 'Old Fund']);
    expect(names(await request(f.app).get('/api/investors?sort=name'))[0]).toBe('Brisbane Angels');
  });

  it('pages, and says whether there is more', async () => {
    const f = await app();
    const first = await request(f.app).get('/api/investors?limit=2&offset=0');
    expect(first.body).toMatchObject({ count: 5, limit: 2, offset: 0, hasMore: true });
    expect(first.body.results).toHaveLength(2);
    const last = await request(f.app).get('/api/investors?limit=2&offset=4');
    expect(last.body.results).toHaveLength(1);
    expect(last.body.hasMore).toBe(false);
  });

  it('refuses a question it cannot answer', async () => {
    const f = await app();
    for (const q of ['limit=0', 'limit=500', 'offset=-1', 'sort=best', 'facets=colour', 'chequeMin=-5', 'chequeMin=lots']) {
      const res = await request(f.app).get(`/api/investors?${q}`);
      expect(res.status, q).toBe(400);
    }
  });

  it('counts each option over the matches, so every option shown is real', async () => {
    const f = await app();
    const res = await request(f.app).get('/api/investors?type=venture_capital&facets=type,stage,location,lead,active');
    expect(res.body.facets.type.values).toEqual([{ value: 'venture_capital', count: 3, label: 'Venture Capital' }]);
    expect(res.body.facets.stage.values.map((v) => v.value)).toEqual(['Seed', 'Series A', 'Series B']);
    expect(res.body.facets.location.values.map((v) => `${v.value}:${v.count}`).sort()).toEqual(['NSW:2', 'VIC:1']);
    expect(res.body.facets.lead.values.map((v) => v.value).sort()).toEqual(['both', 'lead']);
  });

  it('lists the whole directory\'s vocabulary, and whether any firm states a cheque size', async () => {
    const f = await app();
    const meta = (await request(f.app).get('/api/investors/meta')).body;
    expect(meta.total).toBe(5);
    expect(meta.types.map((t) => t.value)).toEqual(expect.arrayContaining(['venture_capital', 'angel_network', 'corporate_vc']));
    expect(meta.locations.map((l) => l.value)).toEqual(expect.arrayContaining(['NSW', 'VIC', 'QLD', 'New Zealand']));
    expect(meta.cheque).toEqual({ currency: 'AUD', count: 1, min: 250000, max: 1000000 });
  });
});

describe('a directory with nothing published', () => {
  it('answers with an empty list and no cheque filter, and a 404 for any investor', async () => {
    const f = await app({ ds: world({ companies: [co('Acme')], orgs: [backed('ver')] }) });
    const res = await request(f.app).get('/api/investors');
    expect(res.body).toMatchObject({ total: 0, count: 0, results: [], hasMore: false });
    expect((await request(f.app).get('/api/investors/meta')).body).toMatchObject({ total: 0, cheque: null, types: [] });
    expect((await request(f.app).get('/api/investors/ver')).status).toBe(404);
  });

  it('works when the investor files do not exist yet', async () => {
    const dir = await tempDir();
    const ds = world({ companies: [co('Acme')], orgs: [] });
    const files = serializeDataset(ds);
    await writeFiles(dir, { 'startups.json': files['startups.json'] });
    const investorCatalog = createInvestorCatalog({ dir, reloadMs: 0 });
    const a = createApp({ catalog: createCatalog({ file: path.join(dir, 'startups.json') }), investorCatalog, correctionsFile: path.join(dir, 'c.json') });
    expect((await request(a).get('/api/investors')).body.count).toBe(0);
  });
});

describe('keeping up with the data', () => {
  it('serves a change to the files, and keeps answers by the data\'s version', async () => {
    const f = await app({ reloadMs: 0 });
    const before = await request(f.app).get('/api/investors');
    const etag = before.headers.etag;
    expect((await request(f.app).get('/api/investors').set('If-None-Match', etag)).status).toBe(304);
    const next = data();
    next.investors.find((o) => o.id === 'ver').verification_status = 'published';
    await new Promise((r) => setTimeout(r, 15));
    await f.rewrite(next);
    await f.investorCatalog.refresh();
    const after = await request(f.app).get('/api/investors');
    expect(after.body.count).toBe(6);
    expect(after.headers.etag).not.toBe(etag);
  });
});

describe('suggesting a correction', () => {
  it('stages it as pending, and never changes the record', async () => {
    const f = await app();
    const res = await request(f.app).post('/api/investors/oif/corrections').send({ message: 'Their cheque size changed.', source_url: 'https://oif.example/news', email: 'tipster@example.com' });
    expect(res.status).toBe(201);
    const rows = JSON.parse(await readFile(f.correctionsFile, 'utf8'));
    expect(rows).toEqual([expect.objectContaining({ investor: 'oif', investor_name: 'OIF Ventures', message: 'Their cheque size changed.', source_url: 'https://oif.example/news', email: 'tipster@example.com', status: 'pending' })]);
    expect((await request(f.app).get('/api/investors/oif')).body.cheque).toEqual({ min: 250000, max: 1000000, currency: 'AUD' });
    expect(JSON.stringify((await request(f.app).get('/api/investors/oif')).body)).not.toContain('tipster');
  });

  it('needs a message, refuses a very long one or a source that is not an address, and 404s for an investor that is not public', async () => {
    const f = await app();
    const post = (slug, body) => request(f.app).post(`/api/investors/${slug}/corrections`).send(body);
    expect((await post('oif', { message: '  ' })).status).toBe(400);
    expect((await post('oif', {})).status).toBe(400);
    expect((await post('oif', { message: 'x'.repeat(2001) })).status).toBe(400);
    expect((await post('oif', { message: 'ok', source_url: 'not a url' })).status).toBe(400);
    expect((await post('cand', { message: 'ok' })).status).toBe(404);
    expect((await post('nobody', { message: 'ok' })).status).toBe(404);
    await expect(readFile(f.correctionsFile, 'utf8')).rejects.toThrow();
  });

  it('is listed only to someone with the admin key, since it holds a submitter\'s email', async () => {
    const dir = await tempDir();
    const ds = data();
    await writeFiles(dir, serializeDataset(ds));
    const correctionsFile = path.join(dir, 'c.json');
    await writeFile(correctionsFile, `${JSON.stringify([{ id: '1', investor: 'oif', message: 'm', email: 'a@b.c', status: 'pending' }])}\n`);
    const investorCatalog = createInvestorCatalog({ dir, reloadMs: 0 });
    const router = createInvestorsRouter({ respond: createResponder(investorCatalog), catalog: investorCatalog, correctionsFile });
    const mini = express().use(express.json()).use('/api/investors', router);
    process.env.ADMIN_KEY = 'secret';
    expect((await request(mini).get('/api/investors/corrections')).status).toBe(401);
    const ok = await request(mini).get('/api/investors/corrections').set('x-admin-key', 'secret');
    expect(ok.status).toBe(200);
    expect(ok.body.count).toBe(1);
  });

  it('has no route to claim a profile, because claiming needs a way to prove who is asking', async () => {
    const f = await app();
    for (const p of ['/api/investors/oif/claim', '/api/investors/claim']) {
      expect([404]).toContain((await request(f.app).post(p).send({ email: 'a@b.c' })).status);
    }
  });
});
