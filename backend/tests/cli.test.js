import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRaw, writeFiles } from '../src/models/dataset.js';
import { main, parseArgs } from '../scripts/discovery.js';
import { renderRunReport, renderQueue, renderCandidate, locationOf } from '../src/discovery/report.js';
import { runDiscovery } from '../src/discovery/pipeline.js';
import { NOW, dataset, lead, fakeSource, fetcherFor, auPage } from './helpers/discovery.js';

const REAL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data');
let dir;
let realBefore;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'discovery-'));
  realBefore = await loadRaw(REAL_DIR);
  // The real companies, evidence and identifiers, but an empty review queue: these tests
  // must not depend on whatever has been discovered so far.
  const copy = Object.fromEntries(Object.entries(realBefore).filter(([, text]) => text != null));
  await writeFiles(dir, { ...copy, 'candidates.json': '[]\n' });
});
afterEach(async () => {
  expect(await loadRaw(REAL_DIR), 'the real data files must never be touched by these tests').toEqual(realBefore);
  await rm(dir, { recursive: true, force: true });
});

const ZORBLY = lead({ key: 'z', name: 'Zorbly', website: 'zorbly.com.au', url: 'https://news.example/z', title: 'Zorbly raises $4m seed', text: 'Zorbly raises $4m seed round. Aussie startup' });
const routes = { 'https://zorbly.com.au/': { body: auPage('Zorbly') } };
const cli = async (argv, deps = {}) => {
  const lines = [];
  const { fetcher } = fetcherFor(routes);
  const code = await main(argv, { dataDir: dir, out: (s) => lines.push(s), now: () => NOW, fetcher, ...deps });
  return { code, text: lines.join('\n') };
};
const runWith = (leads, argv = ['run']) => cli(argv, { sources: [fakeSource({ leads })] });
const candidates = async () => JSON.parse(await readFile(path.join(dir, 'candidates.json'), 'utf-8'));

describe('arguments', () => {
  it('reads positional arguments, flags with values, boolean flags and repeated flags', () => {
    expect(parseArgs(['approve', 'cand-x', '--by', 'Me', '--dry-run', '--founder', 'A B', '--founder', 'C D', '--lat', '-37.8'])).toEqual({
      positional: ['approve', 'cand-x'], flags: { by: 'Me', 'dry-run': true, founder: ['A B', 'C D'], lat: '-37.8' },
    });
  });
});

describe('running discovery', () => {
  it('writes candidates and leaves the companies alone', async () => {
    const { code, text } = await runWith([ZORBLY, lead({ key: 'l', name: 'Leonardo.Ai', website: 'leonardo.ai' })]);
    expect(code).toBe(0);
    expect(text).toMatch(/Discovery run/);
    expect(text).toMatch(/cand-zorbly\s+needs_review\s+NEW_COMPANY/);
    expect(text).toMatch(/cand-leonardo-ai\s+matched\s+EXACT_MATCH/);
    const saved = await candidates();
    expect(saved.map((c) => c.id)).toEqual(['cand-leonardo-ai', 'cand-zorbly']);
    const companies = JSON.parse(await readFile(path.join(dir, 'startups.json'), 'utf-8'));
    expect(companies).toEqual(JSON.parse(realBefore['startups.json']));
  });

  it('writes nothing on a dry run', async () => {
    const { text } = await runWith([ZORBLY], ['run', '--dry-run']);
    expect(text).toMatch(/dry run: nothing written/);
    expect(await candidates()).toEqual([]);
  });

  it('reports a source that failed, exits non-zero, and still keeps what the others found', async () => {
    const failing = fakeSource({ id: 'broken', fail: new Error('feed gone') });
    const { code, text } = await cli(['run'], { sources: [fakeSource({ leads: [ZORBLY] }), failing] });
    expect(code).toBe(2);
    expect(text).toMatch(/broken\s+FAILED - feed gone/);
    expect((await candidates()).map((c) => c.id)).toEqual(['cand-zorbly']);
  });

  it('reports sources it refused to run, with the reason', async () => {
    const { text } = await cli(['run', '--dry-run'], { sourceConfig: [{ id: 'x.unlicensed', adapter: 'structured-feed', license: { basis: 'licensed_api' } }] });
    expect(text).toMatch(/x\.unlicensed\s+skipped - no valid licence/);
  });

  it('applies exact matches to the companies only when told to: fills what is unknown, never overwrites what is known', async () => {
    const real = JSON.parse(realBefore['startups.json']);
    const unknownFounders = real.find((c) => c.website && !(c.founders?.length));
    const knownFounders = real.find((c) => c.id === 'leonardo-ai');
    expect(knownFounders.founders.length).toBeGreaterThan(0);
    const claim = [{ field: 'founders', value: 'Jane Doe', confidence: 'medium', note: 'x' }];
    const leads = [
      lead({ key: 'u', name: unknownFounders.name, website: unknownFounders.website, evidence: claim }),
      lead({ key: 'k', name: 'Leonardo.Ai', website: 'leonardo.ai', evidence: claim }),
    ];
    await runWith(leads, ['run']);
    let companies = JSON.parse(await readFile(path.join(dir, 'startups.json'), 'utf-8'));
    expect(companies).toEqual(real); // without the flag, no company changes
    await runWith(leads.map((l) => ({ ...l, key: `${l.key}2` })), ['run', '--apply-exact']);
    companies = JSON.parse(await readFile(path.join(dir, 'startups.json'), 'utf-8'));
    expect(companies.find((c) => c.id === unknownFounders.id).founders).toEqual(['Jane Doe']);
    expect(companies.find((c) => c.id === 'leonardo-ai').founders).toEqual(knownFounders.founders);
  });
});

describe('looking at candidates', () => {
  it('lists them, filtered, and shows one in full', async () => {
    await runWith([ZORBLY, lead({ key: 'l', name: 'Leonardo.Ai' })]);
    const all = await cli(['list']);
    expect(all.text).toMatch(/cand-zorbly/);
    expect(all.text).toMatch(/cand-leonardo-ai/);
    const likely = await cli(['list', '--outcome', 'LIKELY_MATCH']);
    expect(likely.text).toMatch(/cand-leonardo-ai/);
    expect(likely.text).not.toMatch(/cand-zorbly/);
    const shown = (await cli(['show', 'cand-leonardo-ai'])).text;
    expect(shown).toMatch(/Possible duplicates:/);
    expect(shown).toMatch(/LIKELY_MATCH \d\.\d+ company "Leonardo AI" \(leonardo-ai\): same name/);
    expect(shown).toMatch(/History:/);
    await expect(cli(['show', 'cand-nobody'])).rejects.toThrow(/no candidate/);
  });

  it('answers "have we seen this?" without writing anything', async () => {
    const exact = await cli(['resolve', '--name', 'Leonardo.Ai', '--website', 'https://leonardo.ai']);
    expect(exact.text).toMatch(/^EXACT_MATCH\n  EXACT_MATCH \d\.\d+ company "Leonardo AI"/);
    expect((await cli(['resolve', '--name', 'Leonardo.Ai'])).text).toMatch(/^LIKELY_MATCH/);
    expect((await cli(['resolve', '--name', 'GrazeMate'])).text).toMatch(/former name/);
    expect((await cli(['resolve', '--name', 'Zorbly', '--website', 'zorbly.com.au'])).text).toBe('NEW_COMPANY: nothing resembles "Zorbly".');
    await expect(cli(['resolve'])).rejects.toThrow(/--name is required/);
  });
});

describe('a person deciding', () => {
  it('takes a candidate from review to a company, recording who, and refuses each step out of turn', async () => {
    await runWith([ZORBLY]);
    await expect(cli(['publish', 'cand-zorbly', '--by', 'Me'])).rejects.toThrow(/only an approved candidate can be published/);
    await expect(cli(['approve', 'cand-zorbly'])).rejects.toThrow(/--by is required/);
    await cli(['approve', 'cand-zorbly', '--by', 'Me', '--note', 'Real company.']);
    expect((await candidates())[0]).toMatchObject({ status: 'approved', review: { by: 'Me', note: 'Real company.' } });

    const done = await cli(['publish', 'cand-zorbly', '--by', 'Me', '--city', 'Melbourne', '--lat', '-37.8136', '--lng', '144.9631']);
    expect(done.text).toMatch(/published as zorbly \(on the map\)/);
    const companies = JSON.parse(await readFile(path.join(dir, 'startups.json'), 'utf-8'));
    expect(companies.find((c) => c.id === 'zorbly')).toMatchObject({ name: 'Zorbly', verified: true, lat: -37.8136, state: 'VIC', sector: 'Unknown', blurb: '' });
    expect(companies).toHaveLength(JSON.parse(realBefore['startups.json']).length + 1);
    expect((await candidates())[0]).toMatchObject({ status: 'published', published_company_id: 'zorbly' });
  });

  it('publishes without a confirmed location as unconfirmed, off the map', async () => {
    await runWith([ZORBLY]);
    await cli(['approve', 'cand-zorbly', '--by', 'Me']);
    expect((await cli(['publish', 'cand-zorbly', '--by', 'Me'])).text).toMatch(/location unconfirmed: not on the map; listed under Unconfirmed/);
    const companies = JSON.parse(await readFile(path.join(dir, 'startups.json'), 'utf-8'));
    expect(companies.find((c) => c.id === 'zorbly')).toMatchObject({ verified: false, lat: null });
  });

  it('settles a possible duplicate either way', async () => {
    await runWith([lead({ key: 'l', name: 'Leonardo.Ai', text: 'Aussie startup raises $4m' }), lead({ key: 'g', name: 'GrazeMate Group' })]);
    await expect(cli(['approve', 'cand-leonardo-ai', '--by', 'Me'])).rejects.toThrow(/possible duplicates/);
    await cli(['distinct', 'cand-leonardo-ai', '--from', 'leonardo-ai', '--by', 'Me']);
    await cli(['approve', 'cand-leonardo-ai', '--by', 'Me']);
    expect((await candidates()).find((c) => c.id === 'cand-leonardo-ai').status).toBe('approved');
  });

  it('rejects with a reason, and reopens', async () => {
    await runWith([ZORBLY]);
    await expect(cli(['reject', 'cand-zorbly', '--by', 'Me'])).rejects.toThrow(/say why/);
    await cli(['reject', 'cand-zorbly', '--by', 'Me', '--reason', 'Not a startup.']);
    expect((await candidates())[0].status).toBe('rejected');
    await cli(['reopen', 'cand-zorbly', '--by', 'Me']);
    expect((await candidates())[0].status).toBe('needs_review');
  });

  it('records a rebrand and keeps the old name findable', async () => {
    const done = await cli(['rename', 'leonardo-ai', '--to', 'Leonardo Studio', '--by', 'Me', '--reason', 'Renamed by Canva']);
    expect(done.text).toMatch(/renamed Leonardo AI -> Leonardo Studio\n  kept: former_name: Leonardo AI/);
    const found = await cli(['resolve', '--name', 'Leonardo AI']);
    expect(found.text).toMatch(/Leonardo Studio/);
    expect(found.text).toMatch(/former name/);
    const companies = JSON.parse(await readFile(path.join(dir, 'startups.json'), 'utf-8'));
    expect(companies.find((c) => c.id === 'leonardo-ai')).toMatchObject({ name: 'Leonardo Studio', slug: 'leonardo-ai' });
  });

  it('writes nothing if the result would not validate', async () => {
    // Break the data so a migrate-and-validate fails: a dangling evidence row.
    const evidence = JSON.parse(realBefore['evidence.json']);
    evidence.push({ ...evidence[0], id: 'broken.row', company_id: 'no-such-company' });
    await writeFiles(dir, { 'evidence.json': `${JSON.stringify(evidence, null, 2)}\n` });
    const before = await readFile(path.join(dir, 'candidates.json'), 'utf-8');
    await expect(runWith([ZORBLY])).rejects.toThrow(/nothing was written: \d+ problem/);
    expect(await readFile(path.join(dir, 'candidates.json'), 'utf-8')).toBe(before);
  });

  it('rejects an unknown command', async () => {
    await expect(cli(['frobnicate'])).rejects.toThrow(/unknown command/);
    expect((await cli(['help'])).text).toMatch(/Commands: run, list/);
  });
});

describe('the record of what was done', () => {
  const trail = async () => JSON.parse(await readFile(path.join(dir, 'audit_trail.json'), 'utf-8'));
  const runs = async () => JSON.parse(await readFile(path.join(dir, 'import_runs.json'), 'utf-8'));

  it('leaves exactly one audit row for each decision, with who made it, through which door, and why', async () => {
    await runWith([ZORBLY, lead({ key: 'x', name: 'Xylo Labs', website: 'xylo.com.au' })]);
    const after = async (argv) => { const n = (await trail()).length; await cli(argv); const rows = await trail(); expect(rows.length, argv.join(' ')).toBe(n + 1); return rows[rows.length - 1]; };
    expect(await after(['approve', 'cand-zorbly', '--by', 'Me', '--note', 'Real company.'])).toMatchObject({
      actor: 'Me', role: 'cli', via: 'cli', action: 'candidate.approve', target: { type: 'candidate', id: 'cand-zorbly' }, reason: 'Real company.', summary: 'Approved Zorbly',
    });
    expect(await after(['publish', 'cand-zorbly', '--by', 'Me'])).toMatchObject({ action: 'candidate.publish', target: { id: 'cand-zorbly' } });
    expect(await after(['reject', 'cand-xylo-labs', '--by', 'Me', '--reason', 'Not a startup.'])).toMatchObject({ action: 'candidate.reject', reason: 'Not a startup.' });
    expect(await after(['reopen', 'cand-xylo-labs', '--by', 'Me'])).toMatchObject({ action: 'candidate.reopen' });
    expect(await after(['rename', 'leonardo-ai', '--to', 'Leonardo Studio', '--by', 'Me', '--reason', 'Rebrand'])).toMatchObject({
      action: 'company.rename', target: { type: 'company', id: 'leonardo-ai' }, changes: [{ field: 'name', from: 'Leonardo AI', to: 'Leonardo Studio' }],
    });
  });

  it('writes no audit row for a decision that was refused', async () => {
    await runWith([ZORBLY]);
    const before = await trail();
    await expect(cli(['publish', 'cand-zorbly', '--by', 'Me'])).rejects.toThrow();
    expect(await trail()).toEqual(before);
  });

  it('records each run: when, what each source did, what it found, and who ran it', async () => {
    await cli(['run', '--by', 'Me'], { sources: [fakeSource({ leads: [ZORBLY] }), fakeSource({ id: 'broken', fail: new Error('feed gone') })] });
    const [row] = await runs();
    expect(row).toMatchObject({
      trigger: 'cli', by: 'Me', status: 'partial', dry_run: false, totals: { new: 1 },
      sources: [{ id: 'test.feed', leads: 1, error: null }, { id: 'broken', leads: 0, error: 'feed gone' }],
    });
    expect((await trail()).at(-1)).toMatchObject({ action: 'import.run', actor: 'Me', target: { type: 'import_run', id: row.id } });
    expect((await trail()).at(-1).summary).toMatch(/1 new candidate\(s\).*1 source\(s\) failed/);
  });

  it('records nothing for a dry run', async () => {
    await runWith([ZORBLY], ['run', '--dry-run']);
    expect(await runs()).toEqual([]);
    expect(await trail()).toEqual([]);
  });
});

describe('not writing over a change made while a command ran', () => {
  it('refuses to save a run when the data files changed underneath it, and keeps the other change', async () => {
    const changeMeanwhile = {
      id: 'test.feed', kind: 'press', region: 'AU', licenseBasis: 'public_feed', license: { basis: 'public_feed' },
      async discover() { await writeFiles(dir, { 'news.json': '[ ]\n' }); return [ZORBLY]; },
    };
    await expect(cli(['run'], { sources: [changeMeanwhile] })).rejects.toThrow(/changed while this was running \(news\.json\)/);
    expect(await candidates()).toEqual([]);
    expect(await readFile(path.join(dir, 'news.json'), 'utf-8')).toBe('[ ]\n');
  });
});

describe('the plain-text views', () => {
  it('renders a run report, the queue and a candidate', async () => {
    const { fetcher } = fetcherFor(routes);
    const { ds, report } = await runDiscovery({ ds: dataset(), sources: [fakeSource({ leads: [ZORBLY, lead({ key: 'l', name: 'Leonardo.Ai' })] })], fetcher, now: () => NOW });
    report.requests = 2;
    report.refused = [{ url: 'https://x.example/', code: 'robots_disallow', message: 'robots.txt disallows /' }];
    const text = renderRunReport(report, { skippedSources: [{ id: 'off', reason: 'disabled' }] });
    expect(text).toMatch(/2 new candidate\(s\), 0 added to an existing candidate, 0 seen before, 0 skipped/);
    expect(text).toMatch(/off\s+skipped - disabled/);
    expect(text).toMatch(/Declined to read 1 page\(s\):\n  robots_disallow\s+1/);
    expect(text).toMatch(/Requests made: 2/);
    expect(renderQueue(ds.candidates)).toMatch(/ID\s+STATUS\s+RESOLUTION/);
    expect(renderQueue([])).toBe('No candidates.');
    const shown = renderCandidate(ds.candidates.find((c) => c.id === 'cand-zorbly'));
    expect(shown).toMatch(/Zorbly {2}\[cand-zorbly\]/);
    expect(shown).toMatch(/Evidence:/);
  });

  it('shows the location once: the city and state only when the address does not already say them', () => {
    expect(locationOf({ address: '92 Pitt Street, Sydney NSW 2000', city: 'Sydney', state: 'NSW' })).toBe('92 Pitt Street, Sydney NSW 2000');
    expect(locationOf({ address: '1.103/477 Pitt St, Haymarket NSW 2000', city: null, state: 'NSW' })).toBe('1.103/477 Pitt St, Haymarket NSW 2000');
    expect(locationOf({ address: null, city: 'Perth', state: 'WA' })).toBe('Perth, WA');
    // "WA" inside a word is not the state: in the middle ("Swan"), at the end ("Ottawa"), at the start ("Wallace").
    for (const street of ['5 Swan Street', '10 Ottawa Road', '3 Wallace Avenue']) {
      expect(locationOf({ address: `${street}, Richmond`, city: 'Melbourne', state: 'WA' }), street).toBe(`${street}, Richmond, Melbourne, WA`);
    }
    expect(locationOf({ address: '2 Smith St, Sydney (Chippendale) NSW 2008', city: 'Sydney (Chippendale)', state: 'NSW' })).toBe('2 Smith St, Sydney (Chippendale) NSW 2008');
    expect(locationOf({ address: null, city: null, state: null })).toBe('(unknown)');
  });
});
