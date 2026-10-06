// The Command Center's web server: an Express app, kept apart from the public one on purpose.
//
// It is for one person at a time, on their own machine, and is built so that it cannot be mistaken for a
// public service:
//   - it is never mounted by the public app, and the public app never imports it (a test reads both);
//   - it is started only by `npm run admin`, listens on the loopback address only, and refuses to start on
//     Render (scripts/admin.js);
//   - every request must carry the Host of this machine (so a web page cannot reach it through a DNS trick),
//     and a change must come from this page itself (same Origin), as JSON;
//   - there are no CORS headers: no other site can read an answer;
//   - the token is sent as an Authorization header, never a cookie, so a page on another site cannot make the
//     browser attach it; after too many wrong tokens everything is refused for a minute;
//   - the page is served with a policy that allows only its own script and style, and it builds everything
//     from data with textContent, never HTML, so a company name from a website cannot run anything;
//   - an error never carries a stack, a path or a token back.
import express from 'express';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { permissionsOf } from './roles.js';
import { HttpError, UnauthorizedError, ForbiddenError, TooManyRequestsError, BadRequestError, NotFoundError } from './errors.js';

const UI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui');
const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];
const FILES = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'] };

export const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const intOr = (v, fallback) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? n : fallback; };

export function createAdminApp({ service, authenticator, limiter, securityLog, uiDir = UI_DIR, logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  app.use((req, res, next) => { res.set(SECURITY_HEADERS); next(); });

  // Only this machine's own names, on the port this server is listening on.
  app.use((req, res, next) => {
    const host = String(req.get('host') ?? '').toLowerCase();
    if (!LOOPBACK.some((h) => host === `${h}:${req.socket.localPort}`)) return next(new ForbiddenError('this server answers only on this machine'));
    next();
  });

  // The page itself carries no data, so it needs no sign-in: it asks for the token, then asks for data.
  const files = Object.fromEntries(Object.entries(FILES).map(([route, [file, type]]) => [route, { body: readFileSync(path.join(uiDir, file)), type }]));
  for (const [route, { body, type }] of Object.entries(files)) app.get(route, (req, res) => res.type(type).send(body));

  // ---------- the API ----------
  app.use('/api', (req, res, next) => { // a change must come from this page, not another site
    if (['GET', 'HEAD'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (origin && origin !== `http://${req.get('host')}`) return next(new ForbiddenError('requests from another site are not allowed'));
    const site = req.get('sec-fetch-site');
    if (site && !['same-origin', 'none'].includes(site)) return next(new ForbiddenError('requests from another site are not allowed'));
    if (!req.is('application/json')) return next(new HttpError(415, 'send JSON'));
    next();
  });
  app.use('/api', express.json({ limit: '64kb' }));

  app.post('/api/login', ah(async (req, res) => {
    const wait = limiter.locked();
    if (wait) throw new TooManyRequestsError(`too many wrong tokens: try again in ${Math.ceil(wait / 1000)} seconds`);
    const user = authenticator.authenticate(req.body?.token);
    if (!user) {
      const locked = limiter.fail();
      await securityLog.log('login.failed', { locked });
      throw new UnauthorizedError('that token is not valid');
    }
    limiter.succeed();
    await securityLog.log('login', { user: user.name, role: user.role });
    res.json({ name: user.name, role: user.role, permissions: permissionsOf(user.role) });
  }));

  app.use('/api', ah(async (req, res, next) => {
    const wait = limiter.locked();
    if (wait) throw new TooManyRequestsError(`too many wrong tokens: try again in ${Math.ceil(wait / 1000)} seconds`);
    const given = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '');
    const user = given ? authenticator.authenticate(given[1]) : null;
    if (!user) {
      if (given) { const locked = limiter.fail(); await securityLog.log('auth.failed', { path: req.path, locked }); }
      throw new UnauthorizedError();
    }
    req.actor = user;
    next();
  }));

  const get = (route, fn) => app.get(route, ah(async (req, res) => res.json(await fn(req.actor, req))));
  const post = (route, fn) => app.post(route, ah(async (req, res) => res.json(await fn(req.actor, req))));

  get('/api/me', async (actor) => ({ name: actor.name, role: actor.role, permissions: permissionsOf(actor.role) }));
  get('/api/overview', (actor) => service.overview(actor));
  get('/api/candidates', (actor, req) => service.candidates(actor, { status: String(req.query.status ?? 'open'), q: String(req.query.q ?? ''), limit: intOr(req.query.limit, 200) }));
  get('/api/candidates/:id', (actor, req) => service.candidate(actor, req.params.id));
  get('/api/companies', (actor, req) => service.companies(actor, String(req.query.q ?? '')));
  get('/api/missing', (actor) => service.missing(actor));
  get('/api/duplicates', (actor) => service.duplicates(actor));
  get('/api/conflicts', (actor) => service.conflicts(actor));
  get('/api/suggestions', (actor) => service.suggestions(actor));
  get('/api/queue', (actor) => service.queue(actor));
  get('/api/imports', (actor) => service.imports(actor));
  get('/api/job', (actor) => service.job(actor));
  get('/api/audit', (actor, req) => service.audit(actor, {
    limit: intOr(req.query.limit, 100), actor: req.query.actor ? String(req.query.actor) : null,
    action: req.query.action ? String(req.query.action) : null, target: req.query.target ? String(req.query.target) : null,
  }));

  const CANDIDATE_ACTIONS = {
    approve: (a, id, b) => service.approve(a, id, b), reject: (a, id, b) => service.reject(a, id, b), reopen: (a, id) => service.reopen(a, id),
    edit: (a, id, b) => service.edit(a, id, b), note: (a, id, b) => service.note(a, id, b), distinct: (a, id, b) => service.distinct(a, id, b),
    merge: (a, id, b) => service.merge(a, id, b), publish: (a, id, b) => service.publish(a, id, b),
    enrich: (a, id) => service.enqueue(a, { kind: 'candidate', id }),
  };
  post('/api/candidates/:id/:action', (actor, req) => {
    const run = Object.hasOwn(CANDIDATE_ACTIONS, req.params.action) ? CANDIDATE_ACTIONS[req.params.action] : null;
    if (!run) throw new NotFoundError(`there is no action "${req.params.action}"`);
    return run(actor, req.params.id, req.body ?? {});
  });
  post('/api/companies/:id/enrich', (actor, req) => service.enqueue(actor, { kind: 'company', id: req.params.id }));
  post('/api/conflicts/resolve', (actor, req) => service.resolveConflict(actor, req.body));
  post('/api/suggestions/apply', (actor, req) => service.applySuggestion(actor, req.body));
  post('/api/suggestions/dismiss', (actor, req) => service.dismissSuggestion(actor, req.body));
  post('/api/queue/seed', (actor, req) => service.seedQueue(actor, req.body ?? {}));
  post('/api/queue/run', (actor, req) => service.startEnrichmentRun(actor, req.body ?? {}));
  post('/api/queue/stop', (actor) => service.stopEnrichmentRun(actor));
  post('/api/queue/:id/retry', (actor, req) => service.retryTask(actor, req.params.id));
  post('/api/queue/:id/cancel', (actor, req) => service.cancelTask(actor, req.params.id));
  post('/api/imports/dismiss', (actor, req) => service.dismissImport(actor, req.body ?? {}));

  app.use('/api', (req, res, next) => next(new NotFoundError('there is nothing at that address')));
  app.use((req, res) => res.status(404).type('text/plain').send('not found'));

  // eslint-disable-next-line no-unused-vars
  app.use(async (err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'the request is too large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'the request is not valid JSON' });
    if (err instanceof HttpError) {
      if (err instanceof ForbiddenError && req.actor) await securityLog.log('forbidden', { user: req.actor.name, role: req.actor.role, method: req.method, path: req.path });
      return res.status(err.status).json({ error: err.message });
    }
    logger.error(`admin: ${req.method} ${req.path}: ${err.stack ?? err}`); // the detail stays in the server's own log
    return res.status(500).json({ error: 'something went wrong; the server log has the detail' });
  });

  return app;
}

export { BadRequestError };
