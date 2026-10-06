import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCatalog } from './catalog/catalog.js';
import { createResponder } from './catalog/respond.js';
import { createStartupsRouter } from './routes/startups.js';
import { createSearchRouter } from './routes/search.js';
import { createDirectoryRouter } from './routes/directory.js';
import newsRouter from './routes/news.js';
import submissionsRouter from './routes/submissions.js';
import editsRouter from './routes/edits.js';
import feedbackRouter from './routes/feedback.js';

const DATA_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'startups.json');

// The app, over a catalog of companies. The server and the tests use the real data file; a scale test gives it
// a catalog over synthetic companies in a temporary folder (scripts/scale/serve.js). There is deliberately no
// environment variable that points the public server at another file.
export function createApp({ catalog = createCatalog({ file: DATA_FILE }), cache } = {}) {
  const respond = createResponder(catalog, cache);
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/startups', createStartupsRouter({ respond }));
  app.use('/api', createSearchRouter({ respond }));
  app.use('/api/news', newsRouter);
  app.use('/api/submissions', submissionsRouter);
  app.use('/api/edits', editsRouter);
  app.use('/api/feedback', feedbackRouter);
  app.use('/directory', createDirectoryRouter({ respond }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  app.locals.catalog = catalog;
  app.locals.respond = respond;
  return app;
}

const app = createApp();
// Load the companies now, so the first visitor does not wait for it; a failure here is reported on the first request.
app.locals.catalog.refresh().catch(() => {});

export default app;
