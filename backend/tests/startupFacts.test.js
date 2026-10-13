import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tempDir, removeTempDirs } from './helpers/catalog.js';
import { createApp } from '../src/app.js';
import { createCatalog, backedFacts, freshOf, select, readFilters } from '../src/catalog/catalog.js';
import { CSV_COLUMNS, csvCell } from '../src/catalog/exportCsv.js';
import { generateCompanies } from '../scripts/scale/fixtures.js';
import { teamBucketOf, TEAM_BUCKETS } from '../src/models/company.js';

afterEach(removeTempDirs);

const DAY = 86400000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString().replace(/\.\d+Z$/, 'Z');
const dayAgo = (days) => ago(days).slice(0, 10);

// Ten synthetic companies, some with the optional facts and some of those backed by a page, some not.
async function world() {
  const dir = await tempDir();
  const rows = generateCompanies(10, { seed: 3 }).map((r) => ({ ...r }));
  const evidence = [];
  const back = (i, field, value, { confidence = 'high', source = 's-site', verified_at = ago(2) } = {}) => evidence.push({
    id: `${rows[i].id}.${field}.${evidence.length}`, company_id: rows[i].id, field, value, source_id: source, confidence, verified_at, status: 'active', note: null,
  });
  // 0: everything, backed
  Object.assign(rows[0], { team_size: 5, remote_policy: 'remote-au', tech_stack: ['TypeScript', 'Go'], last_role_seen_at: ago(3) });
  back(0, 'team_size', 5); back(0, 'remote_policy', 'remote-au'); back(0, 'tech_stack', 'TypeScript'); back(0, 'tech_stack', 'Go'); back(0, 'last_role_seen_at', ago(3));
  // 1: remote worldwide, Go, raised five days ago (a press page)
  Object.assign(rows[1], { team_size: 10, remote_policy: 'remote-global', tech_stack: ['Go'], last_funding_date: dayAgo(5) });
  back(1, 'team_size', 10); back(1, 'remote_policy', 'remote-global'); back(1, 'tech_stack', 'Go'); back(1, 'last_funding_date', dayAgo(5), { source: 's-press', verified_at: null, confidence: 'medium' });
  // 2..5: the edges of the team-size buckets
  for (const [i, size] of [[2, 29], [3, 30], [4, 99], [5, 100]]) { rows[i].team_size = size; back(i, 'team_size', size); }
  // 2 says hybrid and 3 on-site, in the postings (see backend/scripts/enrich/pass2_postings.py)
  rows[2].remote_policy = 'hybrid'; back(2, 'remote_policy', 'hybrid');
  rows[3].remote_policy = 'onsite'; back(3, 'remote_policy', 'onsite');
  // 6: facts no page backs (nothing, or a lead only): none of them is public
  Object.assign(rows[6], { team_size: 50, remote_policy: 'remote-au', tech_stack: ['Rust'] });
  back(6, 'remote_policy', 'remote-au', { confidence: 'low', verified_at: null });
  // 7: raised "in October" (no day), 8: a funding date in the future: neither is "lately"
  rows[7].last_funding_date = dayAgo(1).slice(0, 7); back(7, 'last_funding_date', rows[7].last_funding_date, { source: 's-press', verified_at: null, confidence: 'medium' });
  rows[8].last_funding_date = new Date(Date.now() + 9 * DAY).toISOString().slice(0, 10); back(8, 'last_funding_date', rows[8].last_funding_date, { source: 's-press', verified_at: null, confidence: 'medium' });
  // 9: a name a spreadsheet would run
  rows[9].name = '=HYPERLINK("http://x.test","click")';
  const sources = [
    { id: 's-site', kind: 'company_website', url: 'https://acme.test/about', title: 'About', publisher: null, retrieved_at: ago(2), note: null },
    { id: 's-press', kind: 'press', url: 'https://news.test/story', title: 'Story', publisher: 'News', retrieved_at: ago(5), note: null },
  ];
  const file = path.join(dir, 'startups.json');
  for (const [name, data] of [['startups.json', rows], ['sources.json', sources], ['evidence.json', evidence], ['jobs.json', []]]) await writeFile(path.join(dir, name), `${JSON.stringify(data, null, 2)}\n`);
  const catalog = createCatalog({ file, reloadMs: 0 });
  await catalog.refresh();
  return { rows, catalog, app: createApp({ catalog }), snap: await catalog.snapshot() };
}

describe('the optional facts are served only where a page backs them', () => {
  it('serves a fact with the page behind it and the date it was checked', async () => {
    const { app, rows } = await world();
    const res = await request(app).get(`/api/startups/${rows[0].slug}`);
    expect(res.body).toMatchObject({ team_size: 5, remote_policy: 'remote-au', tech_stack: ['TypeScript', 'Go'], last_role_seen_at: expect.any(String) });
    expect(res.body.facts.team_size).toEqual({ source_url: 'https://acme.test/about', verified_at: expect.stringMatching(/^\d{4}-/) });
    expect(Object.keys(res.body.facts).sort()).toEqual(['last_role_seen_at', 'remote_policy', 'team_size', 'tech_stack']);
  });

  it('serves a press-backed fact with the page and no date when it was never checked by a person', async () => {
    const { app, rows } = await world();
    const res = await request(app).get(`/api/startups/${rows[1].slug}`);
    expect(res.body.last_funding_date).toBe(rows[1].last_funding_date);
    expect(res.body.facts.last_funding_date).toEqual({ source_url: 'https://news.test/story', verified_at: null });
  });

  it('does not serve a value no page backs, nor one only a low-confidence lead supports', async () => {
    const { app, rows } = await world();
    const res = await request(app).get(`/api/startups/${rows[6].slug}`);
    expect(res.body.team_size).toBeNull() === undefined; // (absent or null: not a number)
    expect(res.body.team_size ?? null).toBeNull();
    expect(res.body.remote_policy ?? null).toBeNull();
    expect(res.body.tech_stack ?? null).toBeNull();
    expect(res.body.facts).toBeUndefined();
  });

  it('keeps only the members of a tech stack that a page names', () => {
    const found = { facts: { tech_stack: [{ value: 'Go', url: 'https://a.test/', verified_at: '2026-10-01T00:00:00Z' }] } };
    const { values, sources } = backedFacts({ tech_stack: ['Go', 'Rust'] }, found);
    expect(values.tech_stack).toEqual(['Go']);
    expect(sources.tech_stack).toEqual({ source_url: 'https://a.test/', verified_at: '2026-10-01T00:00:00Z' });
    expect(backedFacts({ tech_stack: ['Rust'] }, found).values.tech_stack).toBeNull();
    expect(backedFacts({ tech_stack: ['Go'] }, undefined).values.tech_stack).toBeNull();
  });

  it('does not use a page that says something else: a record\'s value must be the one the page states', () => {
    const found = { facts: { team_size: [{ value: 12, url: 'https://a.test/', verified_at: null }] } };
    expect(backedFacts({ team_size: 12 }, found).values.team_size).toBe(12);
    expect(backedFacts({ team_size: 40 }, found).values.team_size).toBeNull();
  });

  it('puts the facts on a card, and none on a company that has none', async () => {
    const { app, rows } = await world();
    const res = await request(app).get('/api/startups?view=card&limit=200');
    const card = (i) => res.body.results.find((c) => c.slug === rows[i].slug);
    expect(card(0)).toMatchObject({ team_size: 5, remote_policy: 'remote-au', tech_stack: ['TypeScript', 'Go'] });
    expect(card(0)).not.toHaveProperty('facts'); // the page behind each fact is the company's own page's business
    expect(card(6).team_size ?? null).toBeNull();
  });
});

describe('filtering and sorting by the facts', () => {
  const names = (body) => body.results.map((r) => r.slug);

  it('filters by remote policy: only a backed value counts', async () => {
    const { app, rows } = await world();
    expect(names((await request(app).get('/api/startups?remote=remote-au&view=card')).body)).toEqual([rows[0].slug]);
    expect(names((await request(app).get('/api/startups?remote=remote-global&view=card')).body)).toEqual([rows[1].slug]);
    expect(names((await request(app).get('/api/startups?remote=hybrid&view=card')).body)).toEqual([rows[2].slug]);
    expect(names((await request(app).get('/api/startups?remote=onsite&view=card')).body)).toEqual([rows[3].slug]);
    expect((await request(app).get('/api/startups?remote=remote-au,remote-global&view=card')).body.count).toBe(2);
  });

  it('filters by tech: a company that uses any of the ones asked for', async () => {
    const { app, rows } = await world();
    expect(names((await request(app).get('/api/startups?tech=Go&view=card&sort=file')).body)).toEqual([rows[0].slug, rows[1].slug]);
    expect(names((await request(app).get('/api/startups?tech=TypeScript,Rust&view=card')).body)).toEqual([rows[0].slug]); // Rust is unbacked: nobody has it
  });

  it('filters by team size in buckets that do not overlap: 9 and 10, 29 and 30, 99 and 100 fall on different sides', async () => {
    const { app, rows } = await world();
    const among = async (team) => names((await request(app).get(`/api/startups?team=${team}&view=card&sort=file`)).body);
    expect(await among('lt10')).toEqual([rows[0].slug]);
    expect(await among('10-29')).toEqual([rows[1].slug, rows[2].slug]);
    expect(await among('30-99')).toEqual([rows[3].slug, rows[4].slug]);
    expect(await among('100plus')).toEqual([rows[5].slug]);
    expect((await request(app).get('/api/startups?team=lt10,100plus&view=card')).body.count).toBe(2);
    expect([4, 9, 10, 29, 30, 99, 100, 5000].map(teamBucketOf)).toEqual(['lt10', 'lt10', '10-29', '10-29', '30-99', '30-99', '100plus', '100plus']);
    expect([0, -1, 2.5, null, undefined, '12'].map(teamBucketOf)).toEqual([null, null, null, null, null, null]);
    expect(TEAM_BUCKETS.map((b) => b.code)).toEqual(['lt10', '10-29', '30-99', '100plus']);
  });

  it('filters by several stages at once ("Seed to Series A"), as it does a single one', async () => {
    const { app, rows } = await world();
    const stages = [...new Set(rows.map((r) => r.stage))].slice(0, 2);
    const expected = rows.filter((r) => stages.includes(r.stage)).length;
    expect((await request(app).get(`/api/startups?stage=${encodeURIComponent(stages.join(','))}&view=card&limit=200`)).body.count).toBe(expected);
    expect((await request(app).get(`/api/startups?stage=${encodeURIComponent(stages[0])}&view=card&limit=200`)).body.count).toBe(rows.filter((r) => r.stage === stages[0]).length);
  });

  it('finds the companies that raised, or had a role seen, in the last 14 days: a day, not a month, and never a date in the future', async () => {
    const { app, rows } = await world();
    const res = await request(app).get('/api/startups?fresh=week&view=card&sort=file');
    expect(names(res.body)).toEqual([rows[0].slug, rows[1].slug]);
    expect(freshOf({ last_funding_date: dayAgo(5) })).toEqual({ kind: 'funding', at: dayAgo(5) });
    expect(freshOf({ last_role_seen_at: ago(3) })).toMatchObject({ kind: 'role' });
    expect(freshOf({ last_funding_date: dayAgo(20), last_role_seen_at: ago(40) })).toBeNull();
    expect(freshOf({ last_funding_date: dayAgo(1).slice(0, 7) })).toBeNull();
    expect(freshOf({ last_funding_date: dayAgo(10), last_role_seen_at: ago(2) }).kind).toBe('role'); // the newer of the two
    expect(freshOf({})).toBeNull();
  });

  it('sorts by team size, the biggest first with the ones no page gives a size last, and by remote policy', async () => {
    const { app, rows } = await world();
    const bySize = names((await request(app).get('/api/startups?sort=team&view=card&limit=200')).body);
    expect(bySize.slice(0, 6)).toEqual([rows[5], rows[4], rows[3], rows[2], rows[1], rows[0]].map((r) => r.slug));
    const byRemote = names((await request(app).get('/api/startups?sort=remote&view=card&limit=200')).body);
    expect(byRemote.slice(0, 4)).toEqual([rows[1], rows[0], rows[2], rows[3]].map((r) => r.slug)); // worldwide, Australia, hybrid, on-site, then the rest
  });

  it('asks the filters through readFilters and keeps a company out when it does not match any of them', async () => {
    const { snap, rows } = await world();
    const picked = (query) => [...select(snap, readFilters(query))].map((i) => snap.records[i].slug);
    expect(picked({ remote: 'remote-au', team: 'lt10', tech: 'Go' })).toEqual([rows[0].slug]);
    expect(picked({ remote: 'remote-au', team: '100plus' })).toEqual([]);
  });

  it('lists as filter options only what the data has', async () => {
    const { app } = await world();
    const meta = (await request(app).get('/api/startups/meta')).body;
    expect(meta.remotePolicies).toEqual(['remote-global', 'remote-au', 'hybrid', 'onsite']);
    expect(meta.techStack).toEqual(['Go', 'TypeScript']); // most used first; Rust is not backed
    expect(meta.teamSizes).toEqual([{ code: 'lt10', label: 'Under 10' }, { code: '10-29', label: '10–29' }, { code: '30-99', label: '30–99' }, { code: '100plus', label: '100+' }]);
    expect(meta.hasFresh).toBe(true); // two companies are new this week
  });
});

describe('the spreadsheet of the filtered list', () => {
  const parse = (text) => {
    const rows = [];
    let row = [''];
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { row[row.length - 1] += '"'; i += 1; } else if (c === '"') quoted = false; else row[row.length - 1] += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') row.push('');
      else if (c === '\r' && text[i + 1] === '\n') { rows.push(row); row = ['']; i += 1; } else row[row.length - 1] += c;
    }
    return rows;
  };

  it('is a file to save: CSV, as an attachment, UTF-8 with a byte-order mark', async () => {
    const { app } = await world();
    const res = await request(app).get('/api/startups/export.csv').buffer(true).parse((r, cb) => { const parts = []; r.on('data', (d) => parts.push(d)); r.on('end', () => cb(null, Buffer.concat(parts).toString('utf8'))); });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv; charset=utf-8/);
    expect(res.headers['content-disposition']).toBe('attachment; filename="au-startup-map.csv"');
    expect(res.body.startsWith('﻿')).toBe(true);
  });

  const download = async (app, query = '') => {
    const res = await request(app).get(`/api/startups/export.csv${query}`).buffer(true).parse((r, cb) => { const parts = []; r.on('data', (d) => parts.push(d)); r.on('end', () => cb(null, Buffer.concat(parts).toString('utf8'))); });
    const [header, ...rows] = parse(res.body.replace(/^﻿/, '')).filter((r) => r.length > 1 || r[0] !== '');
    return { res, header, rows, text: res.body };
  };

  it('has every column, and each optional fact comes with the page behind it and when it was checked', async () => {
    const { app } = await world();
    const { header } = await download(app);
    expect(header).toEqual(CSV_COLUMNS.map(([name]) => name));
    for (const fact of ['team_size', 'remote_policy', 'tech_stack', 'last_funding_date', 'last_role_seen_at']) {
      expect(header).toEqual(expect.arrayContaining([fact, `${fact}_source_url`, `${fact}_verified_at`]));
    }
    expect(header).toEqual(expect.arrayContaining(['last_verified_at', 'website', 'hiring', 'hiring_source_url']));
  });

  it('is exactly the companies the filters pick, in the order asked for', async () => {
    const { app, rows } = await world();
    const all = await download(app, '?sort=file');
    expect(all.rows).toHaveLength(10);
    const col = (header, name) => header.indexOf(name);
    const go = await download(app, '?tech=Go&sort=file');
    expect(go.rows.map((r) => r[col(go.header, 'slug')])).toEqual([rows[0].slug, rows[1].slug]);
    const big = await download(app, '?team=30-99,100plus&sort=team');
    expect(big.rows.map((r) => r[col(big.header, 'team_size')])).toEqual(['100', '99', '30']);
    const none = await download(app, '?remote=remote-au&team=100plus');
    expect(none.rows).toEqual([]); // only the header
  });

  it('fills the page and date of a fact, and leaves the cells of a fact nobody has empty: no "unknown", no "N/A"', async () => {
    const { app, rows } = await world();
    const { header, rows: out, text } = await download(app, '?sort=file');
    const at = (row, name) => row[header.indexOf(name)];
    const mine = out.find((r) => at(r, 'slug') === rows[0].slug);
    expect(at(mine, 'team_size')).toBe('5');
    expect(at(mine, 'team_size_source_url')).toBe('https://acme.test/about');
    expect(at(mine, 'tech_stack')).toBe('TypeScript; Go');
    expect(at(mine, 'remote_policy')).toBe('remote-au');
    const bare = out.find((r) => at(r, 'slug') === rows[6].slug);
    for (const name of ['team_size', 'team_size_source_url', 'remote_policy', 'tech_stack', 'tech_stack_source_url']) expect(at(bare, name)).toBe('');
    expect(text).not.toMatch(/N\/A|\bnull\b|undefined|Unknown/);
  });

  it('says what the site says about hiring, in words, never a bare yes or no', async () => {
    const { app } = await world();
    const { header, rows } = await download(app);
    const values = new Set(rows.map((r) => r[header.indexOf('hiring')]));
    for (const v of values) expect(['Hiring now', 'Roles unverified']).toEqual(expect.arrayContaining([v.replace(/ \(.*\)$/, '')]) );
  });

  it('writes a name a spreadsheet would run as text, with an apostrophe in front', async () => {
    const { app, rows } = await world();
    const { header, rows: out } = await download(app, '?sort=file');
    const cell = out.find((r) => r[header.indexOf('slug')] === rows[9].slug)[0];
    expect(cell).toBe(`'${rows[9].name}`);
    expect(cell.startsWith("'=")).toBe(true);
  });

  it('refuses a sort it does not know, and says so', async () => {
    const { app } = await world();
    const res = await request(app).get('/api/startups/export.csv?sort=popularity');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sort must be one of/);
  });
});

describe('csvCell', () => {
  it('quotes a cell that has a comma, a quote or a line break, and doubles its quotes', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });

  it('writes nothing for nothing', () => {
    for (const v of [null, undefined, '']) expect(csvCell(v)).toBe('');
    expect(csvCell(0)).toBe('0');
  });

  it('puts an apostrophe before what a spreadsheet would read as a formula', () => {
    for (const v of ['=SUM(A1)', '+1', '-1', '@x', '\tx', '\rx']) expect(csvCell(v)).toMatch(/^"?'/);
    expect(csvCell('a=b')).toBe('a=b');
  });
});
