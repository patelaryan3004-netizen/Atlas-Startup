import { describe, it, expect, vi } from 'vitest';
import {
  EMPTY, readFilters, writeFilters, sectorLabel, matches, filterRoles, placeCounts, placeBreakdown, companyIndex, sortRoles, filterOptions, confirmedWords, whereWords, rowMeta, standing, feedStamp,
  loadSnapshot, normaliseRole, initialsOf, activeSecondary, isStart,
} from '../src/jobsBoard.js';
import { deskRole, deskBoard } from './network/helpers.js';

const at = (iso) => Date.parse(iso);
const NOW = at('2026-11-13T04:00:00Z');
const place = (label, city, over = {}) => ({ places: [{ label, au: true, city }], cities: city ? [city] : [], remote_au: false, remote_evidence: null, arrangement: null, ...over });

describe('the address', () => {
  it('opens on every sector and every place by default, and writes nothing for the default board', () => {
    expect(readFilters('')).toEqual(EMPTY);
    expect(writeFilters(EMPTY)).toBe('');
    expect(isStart(readFilters(''))).toBe(true);
  });

  it('reads the old addresses: ?sector=Unknown, ?city=Sydney and ?remote=yes', () => {
    expect(readFilters('?sector=Unknown').sector).toBe('Unknown');
    expect(readFilters('?city=sydney').place).toBe('Sydney');
    expect(readFilters('?remote=yes').arrangement).toBe('remote');
    expect(readFilters('?place=remote-au').place).toBe('remote-au');
    expect(readFilters('?place=Nowhere').place).toBe('');
  });

  it('writes only what differs from the start, and reads it back', () => {
    const f = { ...EMPTY, place: 'Melbourne', sector: 'Unknown', level: 'senior', saved: true, sort: 'company' };
    expect(writeFilters(f)).toBe('?place=Melbourne&sector=Unknown&level=senior&saved=1&sort=company');
    expect(readFilters(writeFilters(f))).toEqual(f);
    expect(activeSecondary(f)).toBe(2);
  });

  it('calls a company with no sector "Sector not supplied" and leaves other sectors as they are', () => {
    expect(sectorLabel('Unknown')).toBe('Sector not supplied');
    expect(sectorLabel('Fintech')).toBe('Fintech');
  });
});

describe('which roles match, and how many are in each place', () => {
  const roles = [
    deskRole({ id: 'a', title: 'Analyst', work: place('Melbourne', 'Melbourne', { arrangement: 'hybrid' }) }),
    deskRole({ id: 'b', title: 'Engineer', work: { ...place('Sydney', 'Sydney'), places: [{ label: 'Sydney', au: true, city: 'Sydney' }, { label: 'Melbourne', au: true, city: 'Melbourne' }], cities: ['Sydney', 'Melbourne'] } }),
    deskRole({ id: 'c', title: 'Designer', company: { name: 'Immutable', slug: 'immutable', city: 'Sydney', sector: 'Web3', stage: '', website: '' }, work: place('Remote - Australia', null, { remote_au: true, arrangement: 'remote' }) }),
    deskRole({ id: 'd', title: 'Geelong Role', work: place('Geelong, Victoria, Australia', null) }),
  ];

  it('puts a role open in two cities under both and counts it once in the national figure', () => {
    const counts = placeCounts(roles, EMPTY);
    expect(counts).toMatchObject({ national: 4, Melbourne: 2, Sydney: 1, Perth: 0, 'remote-au': 1, 'other-au': 1 });
  });

  it('splits the national figure into groups that add up to it, from the roles alone', () => {
    const sum = placeBreakdown(roles, EMPTY);
    expect(sum).toEqual({ total: 4, uniqueIds: 4, inCity: 2, inTwoCities: 1, cityCounts: 3, remoteOnly: 1, elsewhere: 1 });
    expect(sum.inCity + sum.remoteOnly + sum.elsewhere).toBe(sum.total);
    expect(sum.elsewhere).toBe(placeCounts(roles, EMPTY)['other-au']);
    // narrowing the roles narrows every figure with it: nothing is a fixed total
    expect(placeBreakdown(roles, { ...EMPTY, search: 'engineer' })).toMatchObject({ total: 1, inCity: 1, inTwoCities: 1, cityCounts: 2, remoteOnly: 0, elsewhere: 0 });
  });

  it('counts each card with every filter but the place, so a card says how many roles it would show', () => {
    const f = { ...EMPTY, place: 'Sydney', search: 'engineer' };
    expect(placeCounts(roles, f)).toMatchObject({ national: 1, Melbourne: 1, Sydney: 1 });
    expect(filterRoles(roles, f).map((r) => r.id)).toEqual(['b']);
  });

  it('is the work place that counts, not the company\'s city: a Sydney company\'s remote role is not Sydney\'s', () => {
    expect(filterRoles(roles, { ...EMPTY, place: 'Sydney' }).map((r) => r.id)).toEqual(['b']);
    expect(filterRoles(roles, { ...EMPTY, place: 'remote-au' }).map((r) => r.id)).toEqual(['c']);
    expect(filterRoles(roles, { ...EMPTY, place: 'other-au' }).map((r) => r.id)).toEqual(['d']);
  });

  it('lists the companies with a role among those that match, most roles first, and leaves the company filter out of its own count', () => {
    expect(companyIndex(roles, EMPTY).map((c) => [c.name, c.count])).toEqual([['Zeller', 3], ['Immutable', 1]]);
    expect(companyIndex(roles, { ...EMPTY, company: 'immutable' }).map((c) => c.name)).toEqual(['Zeller', 'Immutable']);
    expect(companyIndex(roles, { ...EMPTY, place: 'remote-au' }).map((c) => c.name)).toEqual(['Immutable']);
  });

  it('searches the title, the company, the place and the team, every word', () => {
    expect(matches(roles[0], { ...EMPTY, search: 'zeller analyst' })).toBe(true);
    expect(matches(roles[0], { ...EMPTY, search: 'zeller designer' })).toBe(false);
    expect(matches(roles[0], { ...EMPTY, search: 'sales' })).toBe(true); // the team
  });

  it('matches the sector (Unknown is a sector like another), the level, the type and the arrangement', () => {
    const r = deskRole({ company: { name: 'Bellroy', slug: 'bellroy', city: '', sector: 'Unknown', stage: '', website: '' }, level: 'senior', employment_type: 'contract' });
    expect(matches(r, { ...EMPTY, sector: 'Unknown' })).toBe(true);
    expect(matches(r, { ...EMPTY, sector: 'Fintech' })).toBe(false);
    expect(matches(r, { ...EMPTY, level: 'senior', type: 'contract', arrangement: 'hybrid' })).toBe(true);
    expect(matches(r, { ...EMPTY, arrangement: 'remote' })).toBe(false);
  });

  it('offers only the choices some role has', () => {
    const o = filterOptions(roles, EMPTY);
    expect(o.sectors.map((s) => s.value).sort()).toEqual(['Fintech', 'Web3']);
    expect(o.arrangements.map((s) => s.value).sort()).toEqual(['hybrid', 'remote']);
  });
});

describe('the order', () => {
  it('puts the latest additions first by when the employer posted them, else when we first saw them, never by when we last checked', () => {
    const list = [
      deskRole({ id: 'old', title: 'A', posted_at: '2026-08-01T00:00:00Z', last_confirmed_at: '2026-11-13T00:00:00Z' }),
      deskRole({ id: 'new', title: 'B', posted_at: '2026-11-10T00:00:00Z', last_confirmed_at: '2026-11-01T00:00:00Z' }),
      deskRole({ id: 'unposted', title: 'C', posted_at: null, first_seen_at: '2026-11-12T00:00:00Z' }),
    ];
    expect(sortRoles(list, 'latest').map((r) => r.id)).toEqual(['unposted', 'new', 'old']); // seen on the 12th, posted on the 10th, posted in August
    expect(sortRoles(list, 'title').map((r) => r.id)).toEqual(['old', 'new', 'unposted']);
  });
});

describe('the words', () => {
  it('says when a role was last confirmed: today, yesterday, or the day', () => {
    expect(confirmedWords('2026-11-13T01:00:00Z', NOW)).toBe('today');
    expect(confirmedWords('2026-11-12T01:00:00Z', NOW)).toBe('yesterday');
    expect(confirmedWords('2026-11-09T01:00:00Z', NOW)).toBe('9 Nov');
    expect(confirmedWords('2025-12-24T01:00:00Z', NOW)).toMatch(/24 Dec 2025/);
    expect(confirmedWords(null, NOW)).toBe('');
  });

  it('says where a role is worked in the employer\'s words trimmed to the place, and leaves out what it did not say', () => {
    expect(whereWords(deskRole({ work: place('Sydney / Melbourne', 'Sydney', { cities: ['Sydney', 'Melbourne'] }) }))).toBe('Sydney / Melbourne');
    expect(whereWords(deskRole({ work: place('Remote (Victoria, Australia)', null, { remote_au: true, arrangement: 'remote' }) }))).toBe('Victoria');
    expect(whereWords(deskRole({ work: place('Remote - Australia', null, { remote_au: true }) }))).toBe('Australia');
    // a town or state the employer named stays as written, with no city invented for it; a bare "Australia" says no city was given
    expect(whereWords(deskRole({ work: place('Cairns, Queensland', null) }))).toBe('Cairns, Queensland');
    expect(whereWords(deskRole({ work: place('Waterloo, NSW', null) }))).toBe('Waterloo, NSW');
    expect(whereWords(deskRole({ work: place('Geelong, Victoria, Australia', null) }))).toBe('Geelong, Victoria');
    expect(whereWords(deskRole({ work: place('Australia', null) }))).toBe('Australia, no city given');
    expect(whereWords(deskRole({ work: { places: [], cities: [], remote_au: false, arrangement: null } }))).toBe('');
    expect(rowMeta(deskRole({ work: place('Melbourne', 'Melbourne', { arrangement: null }) }))).toEqual(['Zeller', 'Melbourne']);
    expect(rowMeta(deskRole())).toEqual(['Zeller', 'Melbourne', 'Hybrid']);
  });

  it('gives a role its true standing: nothing when it is open and confirmed, a note when it needs a recheck, and a plain word when it is gone', () => {
    expect(standing(deskRole(), NOW)).toBeNull();
    expect(standing(deskRole({ confirmation: 'recheck', last_confirmed_at: '2026-11-09T02:00:00Z' }), NOW)).toMatchObject({ tone: 'recheck', label: 'Not rechecked since 9 Nov' });
    expect(standing(deskRole({ confirmation: 'stale', last_confirmed_at: '2026-10-01T02:00:00Z' }), NOW)).toMatchObject({ tone: 'stale', label: 'Not confirmed since 1 Oct' });
    expect(standing(deskRole({ lifecycle: 'hidden' }), NOW).label).toBe('Not on the employer\'s board at the last check');
    expect(standing(deskRole({ lifecycle: 'archived' }), NOW).label).toBe('No longer listed by the employer');
    expect(standing(deskRole({ lifecycle: 'closed' }), NOW).label).toBe('Closed by the employer');
  });

  it('does not call the board current when the hourly check has not run, and does not pretend when it never has', () => {
    expect(feedStamp(deskBoard([]), at('2026-11-13T03:00:00Z'))).toMatchObject({ tone: 'ok', text: expect.stringMatching(/Employer boards last read 13 Nov 2026/) });
    expect(feedStamp(deskBoard([]), at('2026-11-14T03:00:00Z'))).toMatchObject({ tone: 'late', text: expect.stringMatching(/hourly check has not run since/) });
    expect(feedStamp(deskBoard([], { sync: { last_success_at: null } }), NOW)).toMatchObject({ tone: 'none' });
    // a saved copy never reads as live, whatever its age: it says it is a copy and when the employers' boards were checked for it
    expect(feedStamp(deskBoard([]), NOW, 'snapshot')).toMatchObject({ tone: 'saved', text: expect.stringMatching(/^Saved copy · checked 13 Nov 2026/) });
    expect(feedStamp(deskBoard([]), at('2026-12-30T03:00:00Z'), 'snapshot').text).toMatch(/^Saved copy · checked 13 Nov 2026/);
  });

  it('makes initials of a company\'s name, and the same tint every time', () => {
    expect(initialsOf('Culture Amp')).toBe('CA');
    expect(initialsOf('Zeller')).toBe('Ze');
    expect(initialsOf('')).toBe('?');
  });
});

describe('the saved copy of the board', () => {
  const answer = (body, ok = true) => vi.fn(async () => ({ ok, json: async () => body }));

  it('is used when it is recent, and not when it is more than two weeks old or is not a board', async () => {
    expect((await loadSnapshot(NOW, answer(deskBoard([deskRole()]))))?.roles).toHaveLength(1);
    expect(await loadSnapshot(NOW, answer(deskBoard([deskRole()], { generated_at: '2026-10-01T00:00:00Z' })))).toBeNull();
    expect(await loadSnapshot(NOW, answer({ schema: 2, roles: [] }))).toBeNull();
    expect(await loadSnapshot(NOW, answer({}, false))).toBeNull();
    expect(await loadSnapshot(NOW, vi.fn(async () => { throw new Error('offline'); }))).toBeNull();
  });

  it('reads a role from an older server\'s answer (no work places, no lifecycle) so a saved role is shown and not lost', () => {
    const old = { id: 'j-1', title: 'Engineer', company: { name: 'Cobalt', slug: 'cobalt' }, location: 'Sydney, NSW', region: 'au', remote: null, status: 'closed', last_checked_at: '2026-10-27T01:00:00Z', stale: false, apply_url: 'https://x.example/1' };
    const r = normaliseRole(old);
    expect(r).toMatchObject({ lifecycle: 'closed', last_confirmed_at: '2026-10-27T01:00:00Z' });
    expect(r.work.places).toEqual([{ label: 'Sydney, NSW', au: true, city: null }]);
    expect(normaliseRole(null)).toBeNull();
  });
});
