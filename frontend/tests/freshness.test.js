import { describe, it, expect } from 'vitest';
import { verifiedLabel, shortDate, nextEvent, isBlank, hiringLabel, dayMonth, freshOf, freshText, partialDateText } from '../src/freshness.js';

describe('what is new about a company', () => {
  const NOW = Date.parse('2026-10-13T02:00:00Z');
  const day = (d) => new Date(NOW - d * 86400000).toISOString().slice(0, 10);
  const time = (d) => new Date(NOW - d * 86400000).toISOString();

  it('is a raise, or a role seen on a page of the company\'s own, in the last 14 days: the newer of the two', () => {
    expect(freshOf({ last_funding_date: day(5) }, NOW)).toEqual({ kind: 'funding', at: day(5) });
    expect(freshOf({ last_role_seen_at: time(2) }, NOW)).toEqual({ kind: 'role', at: time(2) });
    expect(freshOf({ last_funding_date: day(10), last_role_seen_at: time(2) }, NOW).kind).toBe('role');
    expect(freshOf({ last_funding_date: day(1), last_role_seen_at: time(9) }, NOW).kind).toBe('funding');
  });

  it('is nothing for what is older, what has no day, what is in the future, or what is not a date', () => {
    expect(freshOf({ last_funding_date: day(15) }, NOW)).toBeNull();
    expect(freshOf({ last_funding_date: '2026-10' }, NOW)).toBeNull(); // a month is not "lately"
    expect(freshOf({ last_funding_date: '2026' }, NOW)).toBeNull();
    expect(freshOf({ last_funding_date: day(-9), last_role_seen_at: time(-9) }, NOW)).toBeNull();
    expect(freshOf({ last_role_seen_at: 'soon' }, NOW)).toBeNull();
    expect(freshOf({}, NOW)).toBeNull();
    expect(freshOf(null, NOW)).toBeNull();
  });

  it('says what is new in a few words, and nothing when there is nothing', () => {
    expect(freshText({ kind: 'funding', at: '2026-10-03' })).toBe('Raised 3 Oct');
    expect(freshText({ kind: 'role', at: '2026-10-09T23:30:00Z' })).toBe('New role 10 Oct');
    expect(freshText(null)).toBeNull();
    expect(freshText({ kind: 'role', at: 'x' })).toBeNull();
  });

  it('writes a date as exactly as it is known: a year, a month, a day', () => {
    expect(partialDateText('2026')).toBe('2026');
    expect(partialDateText('2026-08')).toBe('Aug 2026');
    expect(partialDateText('2026-10-30')).toBe('30 Oct 2026');
    for (const bad of ['2026-13', '30 Sep', '', null, undefined, 2026]) expect(partialDateText(bad)).toBeNull();
  });
});

describe('what a company says about hiring', () => {
  it('writes a day without its year, in Sydney time', () => {
    expect(dayMonth('2026-10-05T03:59:04.292Z')).toBe('5 Oct');
    expect(dayMonth('2026-10-12T23:30:00.000Z')).toBe('13 Oct'); // already the 13th in Sydney
    expect(dayMonth(null)).toBeNull();
    expect(dayMonth('not a date')).toBeNull();
  });

  it('says "Hiring now" only for a company the server says is hiring', () => {
    expect(hiringLabel({ hiring: true, hiringState: 'hiring' })).toEqual({ state: 'hiring', text: 'Hiring now' });
  });

  it('says roles read earlier with the day they were read, never as hiring now', () => {
    expect(hiringLabel({ hiring: false, hiringState: 'checked', hiring_checked_at: '2026-10-05T03:59:04.292Z' })).toEqual({ state: 'checked', text: 'Hiring (checked 5 Oct)' });
    expect(hiringLabel({ hiringState: 'checked' }).text).toBe('Hiring (checked earlier)'); // a missing day is not made up
  });

  it('says a job board that listed no roles was read, and says "Roles unverified" for everything nobody read', () => {
    expect(hiringLabel({ hiringState: 'none', hiring_checked_at: '2026-10-13T04:29:43.000Z' })).toEqual({ state: 'none', text: 'No open roles listed (13 Oct)' });
    for (const company of [{ hiringState: 'unverified' }, { hiring: false }, { hiring: false, rolesUnverified: true }, {}, null, undefined]) {
      expect(hiringLabel(company)).toEqual({ state: 'unverified', text: 'Roles unverified' });
    }
  });

  it('treats an answer from before the states existed as hiring only when it says it is hiring', () => {
    expect(hiringLabel({ hiring: true }).text).toBe('Hiring now');
    expect(hiringLabel({ hiring: false }).text).toBe('Roles unverified');
  });
});

const NOW = Date.parse('2026-10-13T02:00:00Z');
const ago = (d) => new Date(NOW - d * 86400000).toISOString();

describe('freshness', () => {
  it('words a check by how long ago it was, and turns to "Needs re-check" after 60 days', () => {
    expect(verifiedLabel(ago(0), NOW).text).toBe('Verified today');
    expect(verifiedLabel(ago(1), NOW).text).toBe('Verified yesterday');
    expect(verifiedLabel(ago(3), NOW).text).toBe('Verified 3 days ago');
    expect(verifiedLabel(ago(21), NOW).text).toBe('Verified 3 weeks ago');
    expect(verifiedLabel(ago(60), NOW)).toEqual({ text: 'Verified 8 weeks ago', stale: false });
    expect(verifiedLabel(ago(61), NOW)).toEqual({ text: 'Needs re-check', stale: true });
  });
  it('says nothing for a missing or invalid date', () => {
    expect(verifiedLabel(null, NOW)).toBeNull();
    expect(verifiedLabel('soon', NOW)).toBeNull();
    expect(shortDate(undefined)).toBeNull();
    expect(shortDate('2026-10-05T03:59:04.292Z')).toBe('5 Oct 2026');
  });
  it('finds the first event from today to 14 days on', () => {
    const events = [{ title: 'Late', date: '2026-11-30' }, { title: 'B', date: '2026-10-20' }, { title: 'A', date: '2026-10-14' }, { title: 'Gone', date: '2026-10-01' }];
    expect(nextEvent(events, NOW).title).toBe('A');
    expect(nextEvent([{ title: 'Edge', date: '2026-10-27' }], NOW).title).toBe('Edge');
    expect(nextEvent([{ title: 'Over', date: '2026-10-28' }], NOW)).toBeNull();
    expect(nextEvent(undefined, NOW)).toBeNull();
    expect(nextEvent([], NOW)).toBeNull();
  });
  it('treats placeholders as empty', () => {
    for (const v of [null, undefined, '', ' ', 'Unknown', 'N/A', 'null']) expect(isBlank(v)).toBe(true);
    expect(isBlank('Seed')).toBe(false);
  });
});
