import { Router } from 'express';
import { HttpError } from '../catalog/respond.js';
import { FACETS, MARKER_FIELDS, SORTS, readFilters, select, pageOf, facets, summary, markers, recordFor } from '../catalog/catalog.js';

const DEFAULT_LIMIT = 48;
const MAX_LIMIT = 200;

function whole(value, name, { min, max, fallback }) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${name} must be a whole number from ${min} to ${max}`);
  return n;
}

// GET /api/startups?search=&sector=&city=&investor=&stage=&hiring=yes|no&taskGate=yes|no&verified=yes|no&name=
//
// With none of the paging parameters the answer is what it always was: { total, count, results } with every match
// in full, in file order. That is kept so nothing that already calls it breaks, but it is the expensive way to
// ask, and nothing in the app does any more. With `limit` (1 to 200) or `offset` it is one page:
//   sort=file|name|hiring|location|industry   view=card|full   facets=sector,city,stage,investor
// and the answer also carries offset, limit, hasMore and the facet counts of the matches.
function list(snap, query) {
  const filters = readFilters(query);
  const matched = select(snap, filters);
  const paged = query.limit !== undefined || query.offset !== undefined;
  const sort = query.sort === undefined ? 'file' : String(query.sort);
  if (!SORTS.includes(sort)) throw new HttpError(400, `sort must be one of ${SORTS.join(', ')}`);
  const view = query.view === undefined ? 'full' : String(query.view);
  if (!['card', 'full'].includes(view)) throw new HttpError(400, 'view must be card or full');
  const wanted = query.facets === undefined ? [] : String(query.facets).split(',').filter(Boolean);
  const unknown = wanted.filter((f) => !FACETS.includes(f));
  if (unknown.length) throw new HttpError(400, `facets must be from ${FACETS.join(', ')}`);

  const limit = paged ? whole(query.limit, 'limit', { min: 1, max: MAX_LIMIT, fallback: DEFAULT_LIMIT }) : matched.length;
  const offset = paged ? whole(query.offset, 'offset', { min: 0, max: 1e7, fallback: 0 }) : 0;
  const rows = pageOf(snap, matched, { sort, offset, limit });
  const source = view === 'card' ? snap.cards : snap.records;
  const results = Array.from(rows, (i) => source[i]);
  const body = { total: snap.count, count: matched.length, results };
  if (paged) Object.assign(body, { offset, limit, hasMore: offset + rows.length < matched.length });
  if (wanted.length) body.facets = facets(snap, matched, wanted);
  return body;
}

export function createStartupsRouter({ respond }) {
  const router = Router();
  const send = (build, options) => (req, res, next) => respond(req, res, (snap) => build(snap, req), options).catch(next);

  router.get('/', send((snap, req) => list(snap, req.query)));

  // Distinct filter option values, for the dropdowns.
  router.get('/meta', send((snap) => snap.meta));

  // How many companies a set of filters picks: for a badge on a curated list, without the list.
  router.get('/count', send((snap, req) => ({ total: snap.count, count: select(snap, readFilters(req.query)).length })));

  // Counts and short lists about a result, so the page need not hold the result to show them.
  router.get('/summary', send((snap, req) => ({ total: snap.count, ...summary(snap, select(snap, readFilters(req.query))) })));

  // The map: one compact tuple per company with a confirmed location, never the full records.
  router.get('/markers', send((snap, req) => {
    const matched = select(snap, readFilters(req.query));
    const items = markers(snap, matched);
    return { total: snap.count, count: matched.length, pinned: items.length, fields: MARKER_FIELDS, items };
  }));

  // One company in full, by slug (or id).
  router.get('/:slug', send((snap, req) => {
    const record = recordFor(snap, req.params.slug);
    if (!record) throw new HttpError(404, 'Startup not found');
    return record;
  }));

  return router;
}
