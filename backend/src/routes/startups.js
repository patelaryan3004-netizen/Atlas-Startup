import { Router } from 'express';
import { HttpError } from '../catalog/respond.js';
import { FACETS, MARKER_FIELDS, SORTS, readFilters, select, pageOf, facets, summary, markers, areas, recordFor, sourcesFor, precisionOf } from '../catalog/catalog.js';
import { describeLocation } from '../models/location.js';
import { offsetParams, offsetInfo } from '../http/paging.js';

const MAX_LIMIT = 200;
// How many sets of filters one /counts request may ask about, and how long one may be.
const MAX_COUNTS = 50;
const MAX_FILTER_CHARS = 2000;

// GET /api/startups?search=&sector=&city=&investor=&stage=&hiring=yes|no&taskGate=yes|no&verified=yes|no&name=
//                   &precision=EXACT,SUBURB,CITY,STATE,UNKNOWN&state=NSW,VIC
//
// Always one page: `limit` (1 to 200, 20 unless asked) from `offset` (0 unless asked), offset paging because the list is
// sorted by a column the visitor picks, filtered, and small enough to slice in memory. The answer is
// { total, count, results, offset, limit, hasMore, nextOffset } (total is every company, count is the matches, nextOffset is
// where the next page starts and null on the last), and carries the facet counts of all the matches when asked for them:
//   sort=file|name|hiring|location|industry|stage|verified   view=card|full   facets=sector,city,stage,investor
function list(snap, query) {
  const filters = readFilters(query);
  const matched = select(snap, filters);
  const sort = query.sort === undefined ? 'file' : String(query.sort);
  if (!SORTS.includes(sort)) throw new HttpError(400, `sort must be one of ${SORTS.join(', ')}`);
  const view = query.view === undefined ? 'full' : String(query.view);
  if (!['card', 'full'].includes(view)) throw new HttpError(400, 'view must be card or full');
  const wanted = query.facets === undefined ? [] : String(query.facets).split(',').filter(Boolean);
  const unknown = wanted.filter((f) => !FACETS.includes(f));
  if (unknown.length) throw new HttpError(400, `facets must be from ${FACETS.join(', ')}`);

  const { limit, offset } = offsetParams(query, { max: MAX_LIMIT });
  const rows = pageOf(snap, matched, { sort, offset, limit });
  const source = view === 'card' ? snap.cards : snap.records;
  const results = Array.from(rows, (i) => source[i]);
  const body = { total: snap.count, count: matched.length, results, ...offsetInfo({ offset, limit, shown: rows.length, total: matched.length }) };
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

  // How many companies each of several sets of filters picks, in one request: for the badges on a page of curated lists, which asked once
  // per list. Each f is a query string like the one /count takes (f=sector%3DAI%26city%3DSydney), and the counts come back in the order
  // asked: { total, counts: [n, ...] }. The kept answer is keyed by that order, which the usual key (parameters sorted) would lose.
  router.get('/counts', (req, res, next) => {
    const sets = [].concat(req.query.f ?? []).map(String);
    const key = `${req.baseUrl}${req.path}?${sets.map(encodeURIComponent).join('&f=')}`;
    respond(req, res, (snap) => {
      if (sets.length === 0) throw new HttpError(400, 'f is needed: one or more sets of filters');
      if (sets.length > MAX_COUNTS) throw new HttpError(400, `f may be given at most ${MAX_COUNTS} times`);
      if (sets.some((f) => f.length > MAX_FILTER_CHARS)) throw new HttpError(400, `each f may be at most ${MAX_FILTER_CHARS} characters`);
      return { total: snap.count, counts: sets.map((f) => select(snap, readFilters(Object.fromEntries(new URLSearchParams(f)))).length) };
    }, { key }).catch(next);
  });

  // Counts and short lists about a result, so the page need not hold the result to show them.
  router.get('/summary', send((snap, req) => ({ total: snap.count, ...summary(snap, select(snap, readFilters(req.query))) })));

  // The map: one compact tuple per company whose location is a point (an exact office or a suburb), never the full
  // records; and one group per city or state for the companies known only to that much. A group is `areas`
  // ({ kind, label, city, state, lat, lng, count, sample }), drawn as a group and never as a company's own pin;
  // `unplaced` counts the group members whose city has no centre on file. A company whose location is not known has
  // neither: it is in the list and the search.
  router.get('/markers', send((snap, req) => {
    const matched = select(snap, readFilters(req.query));
    const items = markers(snap, matched);
    const found = areas(snap, matched);
    return { total: snap.count, count: matched.length, pinned: items.length, areas: found.items, unplaced: found.unplaced, fields: MARKER_FIELDS, items };
  }));

  // One company in full, by slug (or id), with how well its place is known in the words the page shows, and where its facts came from
  // (sources, checked_at, hiring_source: the public pages only, never a note an owner or a visitor wrote).
  router.get('/:slug', send((snap, req) => {
    const record = recordFor(snap, req.params.slug);
    if (!record) throw new HttpError(404, 'Startup not found');
    return { ...record, location: describeLocation({ ...record, location_precision: precisionOf(record) }), ...sourcesFor(snap, record) };
  }));

  return router;
}
