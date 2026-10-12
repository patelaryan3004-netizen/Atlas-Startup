import { describe, it, expect } from 'vitest';
import { verifiedLabel, shortDate, nextEvent, isBlank } from '../src/freshness.js';

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
