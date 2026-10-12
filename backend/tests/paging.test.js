import { describe, it, expect } from 'vitest';
import { DEFAULT_PAGE_SIZE, whole, offsetParams, offsetInfo, cursorParams, cursorPage } from '../src/http/paging.js';
import { HttpError } from '../src/catalog/respond.js';

describe('offset paging', () => {
  it('is 20 from the start unless asked, up to a largest page the caller sets', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(20);
    expect(offsetParams({})).toEqual({ limit: 20, offset: 0 });
    expect(offsetParams({ limit: '5', offset: '40' })).toEqual({ limit: 5, offset: 40 });
    expect(offsetParams({ limit: '100' })).toEqual({ limit: 100, offset: 0 });
    expect(offsetParams({ limit: '200' }, { max: 200 }).limit).toBe(200);
  });

  it('refuses a size or a start that is not a whole number in range, as a 400 the caller can send', () => {
    for (const query of [{ limit: '0' }, { limit: '101' }, { limit: 'x' }, { limit: '2.5' }, { offset: '-1' }, { offset: 'x' }]) {
      let error;
      try { offsetParams(query); } catch (err) { error = err; }
      expect(error, JSON.stringify(query)).toBeInstanceOf(HttpError);
      expect(error.status).toBe(400);
      expect(error.message).toMatch(/must be a whole number from/);
    }
    expect(() => offsetParams({ limit: '0' }, { fail: (m) => new RangeError(m) })).toThrow(RangeError);
    expect(whole(undefined, 'n', { min: 1, max: 5, fallback: 3 })).toBe(3);
  });

  it('says whether more follow and where they start', () => {
    expect(offsetInfo({ offset: 0, limit: 20, shown: 20, total: 45 })).toEqual({ offset: 0, limit: 20, hasMore: true, nextOffset: 20 });
    expect(offsetInfo({ offset: 40, limit: 20, shown: 5, total: 45 })).toEqual({ offset: 40, limit: 20, hasMore: false, nextOffset: null });
    expect(offsetInfo({ offset: 0, limit: 20, shown: 20, total: 20 })).toMatchObject({ hasMore: false, nextOffset: null }); // exactly full: nothing after it
    expect(offsetInfo({ offset: 500, limit: 20, shown: 0, total: 45 })).toMatchObject({ hasMore: false, nextOffset: null }); // past the end
  });
});

describe('cursor paging', () => {
  const rows = Array.from({ length: 45 }, (_, i) => ({ id: `r${i}` }));
  const all = (list, limit) => {
    const seen = [];
    let cursor = null;
    for (let pages = 0; pages < 100; pages += 1) {
      const page = cursorPage(list, { limit, cursor });
      seen.push(...page.results);
      if (!page.nextCursor) return seen;
      cursor = page.nextCursor;
    }
    throw new Error('never ended');
  };

  it('walks a list once, in order, whatever the page size', () => {
    for (const limit of [1, 7, 20, 44, 45, 100]) expect(all(rows, limit).map((r) => r.id), String(limit)).toEqual(rows.map((r) => r.id));
  });

  it('says what it is: a page, its size, whether more follow, and an opaque cursor for the next', () => {
    const first = cursorPage(rows, cursorParams({}));
    expect(first).toMatchObject({ limit: 20, hasMore: true });
    expect(first.results).toHaveLength(20);
    expect(typeof first.nextCursor).toBe('string');
    expect(first.nextCursor).not.toContain('r19'); // opaque: callers hand it back, they do not build it
    const last = cursorPage(rows, { limit: 20, cursor: cursorPage(rows, { limit: 40, cursor: null }).nextCursor });
    expect(last).toMatchObject({ hasMore: false, nextCursor: null });
    expect(last.results).toHaveLength(5);
    expect(cursorPage([], { limit: 20, cursor: null })).toEqual({ results: [], limit: 20, hasMore: false, nextCursor: null });
  });

  it('is not moved by rows added after the cursor, or before the first page is read', () => {
    const first = cursorPage(rows, { limit: 10, cursor: null });
    const grown = [...rows, { id: 'new' }];
    expect(cursorPage(grown, { limit: 10, cursor: first.nextCursor }).results.map((r) => r.id)).toEqual(rows.slice(10, 20).map((r) => r.id));
    // a newest-first list: a new newest row would shift every offset by one, and does not move the cursor
    const newestFirst = [...rows].reverse();
    const page = cursorPage(newestFirst, { limit: 10, cursor: null });
    const withNewer = [{ id: 'newer' }, ...newestFirst];
    expect(cursorPage(withNewer, { limit: 10, cursor: page.nextCursor }).results.map((r) => r.id)).toEqual(newestFirst.slice(10, 20).map((r) => r.id));
  });

  it('refuses a cursor that names no row of the list, rather than starting over', () => {
    expect(() => cursorPage(rows, { limit: 10, cursor: Buffer.from('nope').toString('base64url') })).toThrow(/does not match any row/);
    const first = cursorPage(rows, { limit: 10, cursor: null });
    expect(() => cursorPage(rows.slice(15), { limit: 10, cursor: first.nextCursor })).toThrow(HttpError); // the filter changed under it
  });

  it('reads limit and cursor from a query: 20 by default, 100 at most, and a cursor of text', () => {
    expect(cursorParams({})).toEqual({ limit: 20, cursor: null });
    expect(cursorParams({ limit: '100', cursor: 'abc' })).toEqual({ limit: 100, cursor: 'abc' });
    for (const query of [{ limit: '101' }, { limit: '0' }, { cursor: '' }, { cursor: 'x'.repeat(301) }]) expect(() => cursorParams(query), JSON.stringify(query)).toThrow(HttpError);
    expect(cursorParams({ limit: '500' }, { max: 500 }).limit).toBe(500);
  });
});
