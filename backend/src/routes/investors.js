import { Router } from 'express';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { HttpError } from '../catalog/respond.js';
import {
  INVESTOR_SORTS, INVESTOR_FACETS, ENTRY_KINDS, SCOPES, readInvestorFilters, selectInvestors, sortInvestors, investorFacets, investorMeta, investorPins, entryOf, entryTotal,
} from '../catalog/investors.js';
import { requireAdminKey } from '../middleware/requireAdminKey.js';
import { offsetParams, offsetInfo, cursorParams, cursorPage } from '../http/paging.js';

const MAX_LIMIT = 100;
const CORRECTIONS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'investor_corrections.json');
const MAX_MESSAGE = 2000;

// GET /api/investors?search=&type=venture_capital,angel_network&stage=Seed&sector=Climate&location=NSW,VIC&lead=lead
//                   &active=active&chequeMin=250000&chequeMax=1000000&sort=name|name_desc|portfolio|location&limit=&offset=&facets=type,stage
//                   &slug=oif,skip   (only these, by address: how a visitor's saved investors are listed)
//                   &name=Blackbird%20Ventures&name=OIF   (exact names or other names, repeated: how a company's investors find their pages)
//                   &kind=firm|person|all   what the list is of: firms (the default), the published people, or both; with a kind named, every entry carries `kind` and
//                                           `key` (a firm's address, or people/<slug>), and `slug` then takes keys
//                   &scope=au|global        au keeps the investors based in Australia; global (or none) is every investor
//                   &role=investment,scout  the kind of role a person has (investment, scout, talent, platform, other); a firm has none, so it leaves firms out
//
// The published investors, as cards: { total, count, results, offset, limit, hasMore, nextOffset, facets? }, 20 to a page unless
// `limit` (1 to 100) says otherwise. `search` looks in a
// firm's name and aliases, its type, stages, sectors and place, the names of its published team and the companies in its
// sourced portfolio. A cheque filter keeps only firms with a cheque range a source states in Australian dollars: a firm
// that states none is not "in range", it is unknown, and is left out when the filter is on.
function list(snap, query) {
  const filters = readInvestorFilters(query);
  for (const key of ['chequeMin', 'chequeMax']) if (key in filters && (!Number.isFinite(filters[key]) || filters[key] < 0)) throw new HttpError(400, `${key} must be a number of 0 or more`);
  if (filters.kind !== undefined && !ENTRY_KINDS.includes(filters.kind)) throw new HttpError(400, `kind must be one of ${ENTRY_KINDS.join(', ')}`);
  if (filters.scope !== undefined && !SCOPES.includes(filters.scope)) throw new HttpError(400, `scope must be one of ${SCOPES.join(', ')}`);
  const sort = query.sort === undefined ? 'name' : String(query.sort);
  if (!INVESTOR_SORTS.includes(sort)) throw new HttpError(400, `sort must be one of ${INVESTOR_SORTS.join(', ')}`);
  const wanted = query.facets === undefined ? [] : String(query.facets).split(',').filter(Boolean);
  if (wanted.some((f) => !INVESTOR_FACETS.includes(f))) throw new HttpError(400, `facets must be from ${INVESTOR_FACETS.join(', ')}`);
  const { limit, offset } = offsetParams(query, { max: MAX_LIMIT, maxOffset: 1e6 });

  const matched = sortInvestors(snap, selectInvestors(snap, filters), sort);
  const rows = matched.slice(offset, offset + limit);
  const body = { total: entryTotal(snap, filters.kind), count: matched.length, results: rows.map((i) => entryOf(snap, i, filters)), ...offsetInfo({ offset, limit, shown: rows.length, total: matched.length }) };
  if (wanted.length) body.facets = investorFacets(snap, matched, wanted);
  return body;
}

// Stages a correction a visitor suggests for a published investor or person: a row for a person to read, check against a page and act on, never applied by
// itself. `profileOf(req)` finds the record (null: 404) and `keyOf` is how the correction names it (a person's key is people/<slug>).
function stageCorrection({ correctionsFile, readCorrections, notFound, profileOf, keyOf }) {
  return async (req, res, next) => {
    try {
      const profile = await profileOf(req);
      if (!profile) return res.status(404).json({ error: notFound });
      const { message, source_url: sourceUrl = '', email = '' } = req.body || {};
      if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'message is required: say what is wrong' });
      if (message.length > MAX_MESSAGE) return res.status(400).json({ error: `message is longer than ${MAX_MESSAGE} characters` });
      if (sourceUrl && !/^https?:\/\/\S+$/.test(String(sourceUrl).trim())) return res.status(400).json({ error: 'source_url must be an http(s) address' });
      const rows = await readCorrections();
      const row = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        investor: keyOf(profile), investor_name: profile.name, message: message.trim(), source_url: String(sourceUrl).trim(), email: String(email).trim(),
        status: 'pending', submittedAt: new Date().toISOString(),
      };
      rows.push(row);
      await writeFile(correctionsFile, `${JSON.stringify(rows, null, 2)}\n`, 'utf-8');
      res.status(201).json({ id: row.id, status: row.status });
    } catch (err) { next(err); }
  };
}

const correctionsReader = (correctionsFile) => async () => {
  try { return JSON.parse(await readFile(correctionsFile, 'utf-8')); } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
};

export function createInvestorsRouter({ respond, catalog, correctionsFile = CORRECTIONS_PATH }) {
  const router = Router();
  const readCorrections = correctionsReader(correctionsFile);
  const send = (build) => (req, res, next) => respond(req, res, (snap) => build(snap, req)).catch(next);

  router.get('/', send((snap, req) => list(snap, req.query)));

  // The filter vocabulary of the whole directory, and whether any investor states a cheque size.
  router.get('/meta', send((snap, req) => {
    const kind = req.query.kind === undefined ? 'firm' : String(req.query.kind);
    if (!ENTRY_KINDS.includes(kind)) throw new HttpError(400, `kind must be one of ${ENTRY_KINDS.join(', ')}`);
    const scope = req.query.scope === undefined ? null : String(req.query.scope);
    if (scope !== null && !SCOPES.includes(scope)) throw new HttpError(400, `scope must be one of ${SCOPES.join(', ')}`);
    return investorMeta(snap, kind, scope);
  }));

  // GET /api/investors/pins?search=&sector=&stage=&type=&city=Sydney,Melbourne   the investors as marks for the map: { total, count, pinned,
  // unplaced, items: [{ id, slug, name, type, type_label, domain, logo, lat, lng, city, state, place, role, precision, stages, sectors,
  // portfolio_count }] }. The same filters as the list, and `city` keeps the marks in those cities. A mark is a city's reference point
  // (precision CITY, role headquarters or office): the records state a city, never an address, so nothing here is an office.
  router.get('/pins', send((snap, req) => {
    const filters = { ...readInvestorFilters(req.query), kind: 'firm' }; // only firms are marks: a place a person lists is not an office
    const cities = req.query.city ? String(Array.isArray(req.query.city) ? req.query.city.join(',') : req.query.city).split(',').map((c) => c.trim()).filter(Boolean) : null;
    return { total: snap.count, ...investorPins(snap, selectInvestors(snap, filters), { cities }) };
  }));

  // A correction a visitor suggests. It is staged, never applied: a person reads it, checks it against a page, and edits the
  // record (which then needs a source) or turns it down. A route to CLAIM a profile is deliberately not here: there are no
  // accounts, and a claim needs a way to prove who is asking that this site does not have yet.
  // The staged corrections, oldest first, a page at a time (a log that only grows, so by cursor): { count, results, limit, hasMore,
  // nextCursor }, 20 to a page; ask for the next with cursor=<nextCursor>.
  router.get('/corrections', requireAdminKey, async (req, res, next) => {
    try {
      const rows = await readCorrections();
      res.json({ count: rows.length, ...cursorPage(rows, cursorParams(req.query, { max: MAX_LIMIT })) });
    } catch (err) { next(err); }
  });

  router.post('/:slug/corrections', stageCorrection({
    correctionsFile, readCorrections, notFound: 'Investor not found', profileOf: async (req) => (await catalog.snapshot()).profiles.get(req.params.slug), keyOf: (p) => p.slug,
  }));

  // One published investor in full, by slug.
  router.get('/:slug', send((snap, req) => {
    const profile = snap.profiles.get(req.params.slug);
    if (!profile) throw new HttpError(404, 'Investor not found');
    return profile;
  }));

  return router;
}

// GET /api/investor-people/:slug   a published investor person
export function createInvestorPeopleRouter({ respond, catalog, correctionsFile = CORRECTIONS_PATH }) {
  const router = Router();
  // POST /api/investor-people/:slug/corrections   a suggested correction (or a request to remove them) for a published person, staged like an investor's
  if (catalog) {
    router.post('/:slug/corrections', stageCorrection({
      correctionsFile, readCorrections: correctionsReader(correctionsFile), notFound: 'Person not found', profileOf: async (req) => (await catalog.snapshot()).personProfiles.get(req.params.slug), keyOf: (p) => `people/${p.slug}`,
    }));
  }
  router.get('/:slug', (req, res, next) => respond(req, res, (snap) => {
    const profile = snap.personProfiles.get(req.params.slug);
    if (!profile) throw new HttpError(404, 'Person not found');
    return profile;
  }).catch(next));
  return router;
}
