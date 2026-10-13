import { Router } from 'express';
import { HttpError } from '../catalog/respond.js';
import { selectPeople, selectInstitutions, ROLE_TYPES } from '../catalog/community.js';
import { offsetParams, offsetInfo } from '../http/paging.js';

const MAX_LIMIT = 100;

// GET /api/people?role=founder|operator|investor&search=&list=<id>&limit=&offset=
//     the people worth following: { counts, total, count, results, offset, limit, hasMore, nextOffset }. `counts` is how many there
//     are in each tab (founders, operators, investors, institutions) whatever the question; `total` is how many are in this role,
//     and `count` how many of those match the word. 20 to a page.
// GET /api/institutions?search=&list=&limit=&offset=      the same for the firms, beside the investor pages that back them
// GET /api/lists                                          the curated lists that have someone on them: { results: [{ id, title, description, curator, type, count }] }
// GET /api/lists/:id?limit=&offset=                       one list, in its own order: { list, results, ... } (people, institutions or companies)
// What is in any of it is only what the owner typed into people_seed.json and what the investor directory has published; see
// models/community.js. (A person's own page is /api/people/:name, which is a founder's companies, in routes/search.js.)
export function createCommunityRouter({ respond, companyCatalog }) {
  const router = Router();
  const send = (build) => (req, res, next) => respond(req, res, (snap) => build(snap, req)).catch(next);
  const text = (value) => (value === undefined ? '' : String(Array.isArray(value) ? value[0] : value).slice(0, 80));

  function listOf(snap, query, type) {
    if (query.list === undefined || query.list === '') return null;
    const list = snap.listById.get(String(query.list));
    if (!list) throw new HttpError(404, 'There is no such list');
    if (list.type !== type) throw new HttpError(400, `that list is of ${list.type}, not ${type}`);
    return list;
  }

  router.get('/people', send((snap, req) => {
    const role = req.query.role === undefined || req.query.role === '' ? null : String(req.query.role);
    if (role && !ROLE_TYPES.includes(role)) throw new HttpError(400, `role must be one of ${ROLE_TYPES.join(', ')}`);
    const { limit, offset } = offsetParams(req.query, { max: MAX_LIMIT });
    const { inRole, matched } = selectPeople(snap, { role, search: text(req.query.search), list: listOf(snap, req.query, 'people') });
    const results = matched.slice(offset, offset + limit);
    return { counts: snap.counts, total: inRole.length, count: matched.length, results, ...offsetInfo({ offset, limit, shown: results.length, total: matched.length }) };
  }));

  // GET /api/institutions/pins     the firms' offices drawn on the map: { count, items: [{ id, institution, name, lat, lng, city, state, place,
  //                                office, website, href }] }. An office is here only when its place is known to be that office (a point the owner gave, or
  //                                a street address the geocoder found to the house); what is not yet settled is in the CLI's report, never on the map.
  router.get('/institutions/pins', send((snap) => {
    const items = snap.institutionPins.pins.map(({ how, ...pin }) => pin);
    return { count: items.length, items };
  }));

  router.get('/institutions', send((snap, req) => {
    const { limit, offset } = offsetParams(req.query, { max: MAX_LIMIT });
    const { inRole, matched } = selectInstitutions(snap, { search: text(req.query.search), list: listOf(snap, req.query, 'institutions') });
    const results = matched.slice(offset, offset + limit);
    return { counts: snap.counts, total: inRole.length, count: matched.length, results, ...offsetInfo({ offset, limit, shown: results.length, total: matched.length }) };
  }));

  // The companies of a list: the ones named that are in the directory, as the cards the list page shows.
  async function companiesOf(list) {
    const companies = await companyCatalog.snapshot();
    return list.itemIds.map((slug) => companies.bySlug.get(slug)).filter((i) => i !== undefined).map((i) => companies.cards[i]);
  }
  const summary = (list, count) => ({ id: list.id, title: list.title, description: list.description, curator: list.curator, type: list.type, count });

  router.get('/lists', send(async (snap) => {
    const results = [];
    for (const list of snap.lists) {
      const count = list.type === 'companies' ? (await companiesOf(list)).length : list.itemIds.length;
      if (count > 0) results.push(summary(list, count));
    }
    return { results };
  }));

  router.get('/lists/:id', send(async (snap, req) => {
    const list = snap.listById.get(req.params.id);
    if (!list) throw new HttpError(404, 'There is no such list');
    const { limit, offset } = offsetParams(req.query, { max: MAX_LIMIT });
    const rows = list.type === 'people' ? list.itemIds.map((id) => snap.personById.get(id))
      : list.type === 'institutions' ? list.itemIds.map((id) => snap.institutionById.get(id)) : await companiesOf(list);
    const all = rows.filter(Boolean);
    if (all.length === 0) throw new HttpError(404, 'There is no such list');
    const results = all.slice(offset, offset + limit);
    return { list: summary(list, all.length), total: all.length, count: all.length, results, ...offsetInfo({ offset, limit, shown: results.length, total: all.length }) };
  }));

  return router;
}
