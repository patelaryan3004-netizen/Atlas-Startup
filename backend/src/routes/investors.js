import { Router } from 'express';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { HttpError } from '../catalog/respond.js';
import { INVESTOR_SORTS, INVESTOR_FACETS, readInvestorFilters, selectInvestors, sortInvestors, investorFacets, investorMeta } from '../catalog/investors.js';
import { requireAdminKey } from '../middleware/requireAdminKey.js';

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;
const CORRECTIONS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'investor_corrections.json');
const MAX_MESSAGE = 2000;

function whole(value, name, { min, max, fallback }) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${name} must be a whole number from ${min} to ${max}`);
  return n;
}

// GET /api/investors?search=&type=venture_capital,angel_network&stage=Seed&sector=Climate&location=NSW,VIC&lead=lead
//                   &active=active&chequeMin=250000&chequeMax=1000000&sort=name|portfolio|location&limit=&offset=&facets=type,stage
//                   &name=Blackbird%20Ventures&name=OIF   (exact names or other names, repeated: how a company's investors find their pages)
//
// The published investors, as cards: { total, count, results, offset, limit, hasMore, facets? }. `search` looks in a
// firm's name and aliases, its type, stages, sectors and place, the names of its published team and the companies in its
// sourced portfolio. A cheque filter keeps only firms with a cheque range a source states in Australian dollars: a firm
// that states none is not "in range", it is unknown, and is left out when the filter is on.
function list(snap, query) {
  const filters = readInvestorFilters(query);
  for (const key of ['chequeMin', 'chequeMax']) if (key in filters && (!Number.isFinite(filters[key]) || filters[key] < 0)) throw new HttpError(400, `${key} must be a number of 0 or more`);
  const sort = query.sort === undefined ? 'name' : String(query.sort);
  if (!INVESTOR_SORTS.includes(sort)) throw new HttpError(400, `sort must be one of ${INVESTOR_SORTS.join(', ')}`);
  const wanted = query.facets === undefined ? [] : String(query.facets).split(',').filter(Boolean);
  if (wanted.some((f) => !INVESTOR_FACETS.includes(f))) throw new HttpError(400, `facets must be from ${INVESTOR_FACETS.join(', ')}`);
  const limit = whole(query.limit, 'limit', { min: 1, max: MAX_LIMIT, fallback: DEFAULT_LIMIT });
  const offset = whole(query.offset, 'offset', { min: 0, max: 1e6, fallback: 0 });

  const matched = sortInvestors(snap, selectInvestors(snap, filters), sort);
  const rows = matched.slice(offset, offset + limit);
  const body = { total: snap.count, count: matched.length, results: rows.map((i) => snap.cards[i]), offset, limit, hasMore: offset + rows.length < matched.length };
  if (wanted.length) body.facets = investorFacets(snap, matched, wanted);
  return body;
}

export function createInvestorsRouter({ respond, catalog, correctionsFile = CORRECTIONS_PATH }) {
  const router = Router();
  const readCorrections = async () => {
    try { return JSON.parse(await readFile(correctionsFile, 'utf-8')); } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  };
  const send = (build) => (req, res, next) => respond(req, res, (snap) => build(snap, req)).catch(next);

  router.get('/', send((snap, req) => list(snap, req.query)));

  // The filter vocabulary of the whole directory, and whether any investor states a cheque size.
  router.get('/meta', send((snap) => investorMeta(snap)));

  // A correction a visitor suggests. It is staged, never applied: a person reads it, checks it against a page, and edits the
  // record (which then needs a source) or turns it down. A route to CLAIM a profile is deliberately not here: there are no
  // accounts, and a claim needs a way to prove who is asking that this site does not have yet.
  router.get('/corrections', requireAdminKey, async (req, res, next) => {
    try {
      const rows = await readCorrections();
      res.json({ count: rows.length, results: rows });
    } catch (err) { next(err); }
  });

  router.post('/:slug/corrections', async (req, res, next) => {
    try {
      const snap = await catalog.snapshot();
      const profile = snap.profiles.get(req.params.slug);
      if (!profile) return res.status(404).json({ error: 'Investor not found' });
      const { message, source_url: sourceUrl = '', email = '' } = req.body || {};
      if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'message is required: say what is wrong' });
      if (message.length > MAX_MESSAGE) return res.status(400).json({ error: `message is longer than ${MAX_MESSAGE} characters` });
      if (sourceUrl && !/^https?:\/\/\S+$/.test(String(sourceUrl).trim())) return res.status(400).json({ error: 'source_url must be an http(s) address' });
      const rows = await readCorrections();
      const row = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        investor: profile.slug, investor_name: profile.name, message: message.trim(), source_url: String(sourceUrl).trim(), email: String(email).trim(),
        status: 'pending', submittedAt: new Date().toISOString(),
      };
      rows.push(row);
      await writeFile(correctionsFile, `${JSON.stringify(rows, null, 2)}\n`, 'utf-8');
      res.status(201).json({ id: row.id, status: row.status });
    } catch (err) { next(err); }
  });

  // One published investor in full, by slug.
  router.get('/:slug', send((snap, req) => {
    const profile = snap.profiles.get(req.params.slug);
    if (!profile) throw new HttpError(404, 'Investor not found');
    return profile;
  }));

  return router;
}

// GET /api/investor-people/:slug   a published investor person
export function createInvestorPeopleRouter({ respond }) {
  const router = Router();
  router.get('/:slug', (req, res, next) => respond(req, res, (snap) => {
    const profile = snap.personProfiles.get(req.params.slug);
    if (!profile) throw new HttpError(404, 'Person not found');
    return profile;
  }).catch(next));
  return router;
}
