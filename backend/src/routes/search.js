import { Router } from 'express';
import { HttpError } from '../catalog/respond.js';
import { suggest } from '../catalog/catalog.js';

// GET /api/search?q=&limit=  suggestions for the search box, grouped: companies, people, investors, industries, locations
// GET /api/people/:name      the companies a founder is named on
export function createSearchRouter({ respond }) {
  const router = Router();
  const send = (build) => (req, res, next) => respond(req, res, (snap) => build(snap, req)).catch(next);

  router.get('/search', send((snap, req) => {
    const q = String(req.query.q ?? '').slice(0, 80);
    const n = req.query.limit === undefined ? 5 : Number(req.query.limit);
    if (!Number.isInteger(n) || n < 1 || n > 10) throw new HttpError(400, 'limit must be a whole number from 1 to 10');
    return suggest(snap, q, { limit: n });
  }));

  router.get('/people/:name', send((snap, req) => {
    const rows = snap.founders.get(req.params.name) ?? [];
    return { name: req.params.name, companies: Array.from(rows, (i) => snap.records[i]) };
  }));

  return router;
}
