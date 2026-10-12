// Paging for every list the API serves, so no answer is a whole table.
//
// Two kinds, chosen by what the list is:
//
//   offset  `limit` and `offset`: for a list that is sorted by a column a visitor picks, filtered, and small enough to
//           hold in memory (the companies, the investors, the Command Center's review queues). A page is a slice, a visitor
//           can jump to any page, and the answer says where the next one starts (nextOffset).
//   cursor  `limit` and `cursor`: for a log that only grows (submissions, edit suggestions, feedback, corrections, the audit
//           trail). The cursor is the last row the caller saw, so a row added while someone reads never moves a page
//           (with an offset, a new newest row pushes every row down and the next page repeats one).
//
// Both answer with `limit`, `hasMore` and where to ask next (nextOffset or nextCursor, null at the end).

import { HttpError } from '../catalog/respond.js';

export const DEFAULT_PAGE_SIZE = 20;

// A refusal is a 400. The public routes read the catalog's HttpError and the Command Center its own BadRequestError, so the
// caller of the Command Center passes that one as `fail`.
const refuse = (message) => new HttpError(400, message);

export function whole(value, name, { min, max, fallback }, fail = refuse) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw fail(`${name} must be a whole number from ${min} to ${max}`);
  return n;
}

// `limit` (1 to max, 20 unless asked) and `offset` (0 or more) from a query string.
export function offsetParams(query, { max = 100, fallback = DEFAULT_PAGE_SIZE, maxOffset = 1e7, fail } = {}) {
  return {
    limit: whole(query.limit, 'limit', { min: 1, max, fallback }, fail),
    offset: whole(query.offset, 'offset', { min: 0, max: maxOffset, fallback: 0 }, fail),
  };
}

// What an offset page says about itself, beside its results: where it started, its size, whether more follow and where they start.
export function offsetInfo({ offset, limit, shown, total }) {
  const hasMore = offset + shown < total;
  return { offset, limit, hasMore, nextOffset: hasMore ? offset + shown : null };
}

// `limit` and `cursor` from a query string. The cursor is whatever an earlier page gave as nextCursor.
export function cursorParams(query, { max = 100, fallback = DEFAULT_PAGE_SIZE, fail } = {}) {
  const cursor = query.cursor === undefined ? null : String(query.cursor);
  if (cursor !== null && (!cursor || cursor.length > 300)) throw (fail ?? refuse)('cursor is not one this list gave');
  return { limit: whole(query.limit, 'limit', { min: 1, max, fallback }, fail), cursor };
}

const encode = (id) => Buffer.from(String(id), 'utf8').toString('base64url');
const decode = (cursor) => Buffer.from(cursor, 'base64url').toString('utf8');

// One page of a list that is already in the order to be shown. `idOf` names a row for good (an id that never changes and is
// never reused). The page starts just after the row the cursor names; a cursor that names no row of this list (the filter
// changed, or it was made up) is refused, not read as "from the start".
export function cursorPage(rows, { limit, cursor }, { idOf = (row) => row.id, fail } = {}) {
  let start = 0;
  if (cursor !== null) {
    const id = decode(cursor);
    const at = rows.findIndex((row) => String(idOf(row)) === id);
    if (at < 0) throw (fail ?? refuse)('cursor does not match any row of this list: start again without it');
    start = at + 1;
  }
  const results = rows.slice(start, start + limit);
  const hasMore = start + results.length < rows.length;
  return { results, limit, hasMore, nextCursor: hasMore ? encode(idOf(results[results.length - 1])) : null };
}
