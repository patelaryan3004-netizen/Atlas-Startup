import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildBoard, syncSummary } from '../src/network/board.js';
import { presentJob, confirmationOf, curatedJobs, filterJobs, jobFacets, inPlace, CONFIRMED_HOURS } from '../src/network/jobs.js';
import { createNetwork } from '../src/network/index.js';
import { createApp } from '../src/app.js';
import { fixture } from './helpers/catalog.js';

const NOW = Date.parse('2026-11-13T04:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString();
const card = (over = {}) => ({ name: 'Zeller', slug: 'zeller', city: 'Melbourne', sector: 'Fintech', stage: 'Series C', website: 'https://www.myzeller.com', ...over });
const job = (over = {}) => ({
  id: 'zeller-lever-1', company_id: 'zeller', title: 'Account Executive', location: 'Melbourne, Victoria, Australia', employment_type: 'Full-time', remote: null, posted_at: null,
  apply_url: 'https://jobs.lever.co/Zeller/1', status: 'open', source_id: 'zeller-lever-jobs', retrieved_at: hoursAgo(1), provider: 'lever', external_id: '1',
  first_seen_at: hoursAgo(5), last_confirmed_at: hoursAgo(1), absent_reads: 0, locations: ['Melbourne, Victoria, Australia'], workplace_type: 'hybrid', ...over,
});
const cards = { zeller: card(), bellroy: card({ name: 'Bellroy', slug: 'bellroy', sector: 'Unknown', stage: '' }) };
const cardOf = (id) => cards[id] ?? null;
const names = new Map([['zeller', { name: 'Zeller', slug: 'zeller' }], ['bellroy', { name: 'Bellroy', slug: 'bellroy' }]]);

describe('where a role is worked, as the board presents it', () => {
  it('reads the employer\'s places, not the company\'s city: a Melbourne company\'s Sydney role is Sydney\'s', () => {
    const r = presentJob(job({ locations: ['Sydney, NSW'], location: 'Sydney, NSW' }), card(), NOW);
    expect(r.company.city).toBe('Melbourne');
    expect(r.work.cities).toEqual(['Sydney']);
    expect(r.region).toBe('au');
  });

  it('puts a role open in two cities under both, and says how it is worked only if the employer did', () => {
    const two = presentJob(job({ locations: ['Sydney', 'Melbourne'], location: 'Sydney / Melbourne', workplace_type: null }), card(), NOW);
    expect(two.work.cities).toEqual(['Sydney', 'Melbourne']);
    expect(two.work.arrangement).toBeNull();
    expect(inPlace(two, 'Sydney')).toBe(true);
    expect(inPlace(two, 'melbourne')).toBe(true);
    expect(inPlace(two, 'Perth')).toBe(false);
  });

  it('says a role is remote from Australia only with the employer\'s own words, and shows them', () => {
    const yes = presentJob(job({ locations: ['Remote - Australia'], workplace_type: 'remote' }), card(), NOW);
    expect(yes.work).toMatchObject({ remote_au: true, remote_evidence: 'Remote - Australia', arrangement: 'remote' });
    expect(inPlace(yes, 'remote-au')).toBe(true);
    const no = presentJob(job({ locations: ['Remote'], location: 'Remote', workplace_type: 'remote' }), card(), NOW);
    expect(no.work.remote_au).toBe(false);
    expect(no.region).toBeNull(); // no place at all: not Australian, not anywhere
    expect(presentJob(job({ locations: ['Remote - US'], location: 'Remote - US' }), card(), NOW).work.remote_au).toBe(false);
  });

  it('reads a role the slower reader held (no places list, a single location) the same way', () => {
    const legacy = { id: 'acme-x', company_id: 'zeller', title: 'Designer', location: 'Brisbane, QLD', employment_type: null, remote: null, posted_at: null, apply_url: 'https://boards.greenhouse.io/acme/jobs/1', status: 'open', source_id: 's', retrieved_at: hoursAgo(2) };
    expect(presentJob(legacy, card(), NOW).work.cities).toEqual(['Brisbane']);
  });

  it('keeps posted, first listed and last confirmed apart, and shows none of the ones that are not known', () => {
    const r = presentJob(job({ posted_at: '2026-10-01T00:00:00.000Z', first_seen_at: '2026-11-12T00:00:00.000Z', last_confirmed_at: hoursAgo(1) }), card(), NOW);
    expect(r).toMatchObject({ posted_at: '2026-10-01T00:00:00.000Z', first_seen_at: '2026-11-12T00:00:00.000Z', last_confirmed_at: hoursAgo(1) });
    const none = presentJob(job({ posted_at: undefined, first_seen_at: undefined }), card(), NOW);
    expect(none.posted_at).toBeNull();
    expect(none.first_seen_at).toBeNull();
  });
});

describe('how current a role is', () => {
  it('is confirmed within a day and a half of a whole read, needs a recheck after that, and leaves the default board after two weeks', () => {
    expect(confirmationOf(job({ last_confirmed_at: hoursAgo(CONFIRMED_HOURS - 1) }), NOW)).toBe('confirmed');
    expect(confirmationOf(job({ last_confirmed_at: hoursAgo(CONFIRMED_HOURS + 1) }), NOW)).toBe('recheck');
    expect(confirmationOf(job({ last_confirmed_at: hoursAgo(14 * 24 + 1) }), NOW)).toBe('stale');
    expect(confirmationOf(job({ last_confirmed_at: undefined, retrieved_at: hoursAgo(14 * 24 + 1) }), NOW)).toBe('stale');
  });

  it('never makes a role newer by checking it: only a whole read moves last confirmed', () => {
    const old = job({ last_confirmed_at: hoursAgo(100), retrieved_at: hoursAgo(100) });
    expect(presentJob(old, card(), NOW).confirmation).toBe('recheck');
  });

  it('takes the board\'s own account of its source: when it was last read whole, and whether it is failing', () => {
    const r = presentJob(job(), card(), NOW, { last_success_at: hoursAgo(1), last_attempt_at: hoursAgo(0.5), consecutive_failures: 2, last_error: { code: 'timeout' } });
    expect(r.source_health).toEqual({ last_success_at: hoursAgo(1), last_attempt_at: hoursAgo(0.5), failing: true, error: 'timeout' });
    expect(presentJob(job(), card(), NOW).source_health).toBeNull();
  });
});

describe('the whole board', () => {
  const jobs = [
    job({ id: 'a' }),
    job({ id: 'b', locations: ['Sydney', 'Melbourne'], location: 'Sydney / Melbourne', external_id: '2' }),
    job({ id: 'c', locations: ['Remote - Australia'], location: 'Remote - Australia', workplace_type: 'remote', external_id: '3' }),
    job({ id: 'overseas', locations: ['London, United Kingdom'], location: 'London, United Kingdom', external_id: '4' }),
    job({ id: 'stale', last_confirmed_at: hoursAgo(20 * 24), retrieved_at: hoursAgo(20 * 24), external_id: '5' }),
    job({ id: 'hidden', status: 'hidden', absent_reads: 1, external_id: '6' }),
    job({ id: 'archived', status: 'archived', absent_reads: 2, external_id: '7' }),
    job({ id: 'closed', status: 'closed', external_id: '8' }),
    job({ id: 'nobody', company_id: 'ghost', external_id: '9' }),
    job({ id: 'bell', company_id: 'bellroy', external_id: '10', source_id: 'bellroy-greenhouse-jobs', provider: 'greenhouse', title: 'Store Manager' }),
  ];
  const sync = {
    sources: [
      { id: 'zeller-lever-jobs', company_id: 'zeller', provider: 'lever', status: 'approved', basis: 'x' }, { id: 'bellroy-greenhouse-jobs', company_id: 'bellroy', provider: 'greenhouse', status: 'approved', basis: 'x' },
      { id: 'acme-ashby-jobs', company_id: 'zeller', provider: 'ashby', status: 'approved', basis: 'x' }, { id: 'deputy-lever-review', company_id: 'zeller', provider: 'lever', status: 'review', basis: 'named, not confirmed' },
    ],
    state: [
      { source_id: 'zeller-lever-jobs', last_success_at: hoursAgo(1), last_attempt_at: hoursAgo(1), consecutive_failures: 0, last_error: null },
      { source_id: 'bellroy-greenhouse-jobs', last_success_at: hoursAgo(30), last_attempt_at: hoursAgo(0.5), consecutive_failures: 2, last_error: { code: 'server' } },
    ],
  };
  const board = buildBoard({ jobs, cardOf, sync, names, now: NOW });

  it('has the open, confirmed Australian roles at companies in the directory: and only those', () => {
    expect(board.roles.map((r) => r.id).sort()).toEqual(['a', 'b', 'bell', 'c']);
    expect(board.schema).toBe(1);
  });

  it('counts a role open in two cities once nationally and in each city, and Remote AU apart', () => {
    expect(board.totals).toMatchObject({ roles: 4, companies: 2, remote_au: 1 });
    expect(board.totals.places).toMatchObject({ Melbourne: 3, Sydney: 1 }); // a, b, bell in Melbourne; b in Sydney
    expect(board.facets.national).toBe(4);
  });

  it('keeps the roles a bookmark may point at, each with the status it truly has', () => {
    const lapsed = Object.fromEntries(board.lapsed.map((r) => [r.id, r.lifecycle]));
    expect(lapsed).toMatchObject({ hidden: 'hidden', archived: 'archived', closed: 'closed', stale: 'open', overseas: 'open' });
    expect(board.lapsed.find((r) => r.id === 'stale').confirmation).toBe('stale');
    expect(board.lapsed.find((r) => r.id === 'nobody')).toBeUndefined(); // a company the directory does not hold is not here at all
    expect(board.totals.stale_hidden).toBe(1);
  });

  it('says how current it is from the sync\'s own records, what is failing, and what it cannot read or has not confirmed', () => {
    expect(board.sync).toMatchObject({ last_success_at: hoursAgo(1), interval_minutes: 60, boards: { approved: 3, polled: 2, failing: 1, never_read: 0 } });
    expect(board.sync.covered.map((c) => [c.company, c.provider, c.failing, c.roles])).toEqual([['Bellroy', 'greenhouse', true, 1], ['Zeller', 'lever', false, 3]]);
    expect(board.sync.unsupported).toEqual([{ company: 'Zeller', provider: 'ashby' }]);
    expect(board.sync.review).toEqual([{ company: 'Zeller', provider: 'lever', why: 'named, not confirmed' }]);
  });

  it('says nothing was read when nothing was', () => {
    const s = syncSummary({ sources: [{ id: 'x', company_id: 'zeller', provider: 'lever', status: 'approved', basis: 'y' }], state: [], names });
    expect(s.last_success_at).toBeNull();
    expect(s.boards).toMatchObject({ polled: 1, never_read: 1 });
  });
});

describe('the list API', () => {
  it('filters by where the role is worked, and a company\'s sector of Unknown still works', () => {
    const list = curatedJobs({ jobs: [job({ id: 'a' }), job({ id: 'b', company_id: 'bellroy', locations: ['Sydney'], location: 'Sydney', external_id: '2' })], cardOf, now: NOW });
    expect(filterJobs(list, { place: 'Sydney' }).map((j) => j.id)).toEqual(['b']);
    expect(filterJobs(list, { place: 'Melbourne' }).map((j) => j.id)).toEqual(['a']);
    expect(filterJobs(list, { city: 'Melbourne' }).map((j) => j.id).sort()).toEqual(['a', 'b']); // `city` is still the company's: both companies are in Melbourne, one role is in Sydney
    expect(filterJobs(list, { sector: 'Unknown' }).map((j) => j.id)).toEqual(['b']);
    const facets = jobFacets(list);
    expect(facets.national).toBe(2);
    expect(facets.places).toEqual(expect.arrayContaining([{ value: 'Sydney', count: 1 }, { value: 'Melbourne', count: 1 }]));
  });

  async function app(jobs, sync = { sources: [], state: [] }) {
    const f = await fixture(3);
    const [a, b] = f.rows;
    const rows = jobs.map((j, i) => ({ ...j, company_id: i % 2 ? b.id : a.id }));
    const network = createNetwork({ memory: true, now: () => NOW, curatedEvents: [], curatedJobsRows: rows, curatedJobSync: sync, limits: { signups: 1000, logins: 8 } });
    return { app: createApp({ catalog: f.catalog, network }), rows };
  }

  it('serves the hiring desk\'s board in one answer', async () => {
    const { app: server } = await app([job({ id: 'a' }), job({ id: 'b', locations: ['Perth'], location: 'Perth', external_id: '2' }), job({ id: 'gone', status: 'archived', external_id: '3' })]);
    const res = await request(server).get('/api/jobs/board').expect(200);
    expect(res.body.schema).toBe(1);
    expect(res.body.roles.map((r) => r.id).sort()).toEqual(['a', 'b']);
    expect(res.body.lapsed.map((r) => [r.id, r.lifecycle])).toEqual([['gone', 'archived']]);
    expect(res.body.totals.places).toMatchObject({ Melbourne: 1, Perth: 1 });
    expect(res.body.generated_at).toBe(new Date(NOW).toISOString());
  });

  it('finds a bookmarked role whatever became of it, says what it became, and keeps it off the default list', async () => {
    const { app: server } = await app([job({ id: 'a' }), job({ id: 'gone', status: 'archived', external_id: '3' }), job({ id: 'hid', status: 'hidden', external_id: '4' })]);
    expect((await request(server).get('/api/jobs')).body.results.map((j) => j.id)).toEqual(['a']);
    const saved = (await request(server).get('/api/jobs?ids=a,gone,hid')).body.results;
    expect(saved.map((j) => [j.id, j.lifecycle]).sort()).toEqual([['a', 'open'], ['gone', 'archived'], ['hid', 'hidden']]);
  });

  it('puts the place filter into the list API and leaves `city` as the company\'s city', async () => {
    const { app: server } = await app([job({ id: 'a' }), job({ id: 'b', locations: ['Sydney'], location: 'Sydney', external_id: '2' })]);
    expect((await request(server).get('/api/jobs?place=Sydney')).body.results.map((j) => j.id)).toEqual(['b']);
    expect((await request(server).get('/api/jobs?place=remote-au')).body.results).toEqual([]);
  });
});
