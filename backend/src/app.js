import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCatalog } from './catalog/catalog.js';
import { createInvestorCatalog } from './catalog/investors.js';
import { createCommunityCatalog } from './catalog/community.js';
import { createResponder, HttpError } from './catalog/respond.js';
import { createStartupsRouter } from './routes/startups.js';
import { createSearchRouter } from './routes/search.js';
import { createDirectoryRouter } from './routes/directory.js';
import { createInvestorsRouter, createInvestorPeopleRouter } from './routes/investors.js';
import { createCommunityRouter } from './routes/community.js';
import newsRouter from './routes/news.js';
import submissionsRouter from './routes/submissions.js';
import editsRouter from './routes/edits.js';
import feedbackRouter from './routes/feedback.js';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const DATA_FILE = path.join(DATA_DIR, 'startups.json');

// Does this server serve the people and institutions at all? Only when the machine says so (SHOW_PEOPLE=1): until then /api/people,
// /api/institutions (and their pins) and /api/lists answer "not found", whatever the seed files hold, so a person who has not yet been told they
// are listed is not one request away on the live site. The site's own switch is VITE_SHOW_PEOPLE (frontend/src/flags.js): both are turned on together.
export const peopleShown = (env = process.env) => ['1', 'true', 'yes', 'on'].includes(String(env.SHOW_PEOPLE ?? '').trim().toLowerCase());

// A company counts as hiring now when a page CONFIRMED its open roles within this many days (catalog.js, hiringStateOf); earlier readings are
// said with their date. The server asks for it; a test's or a scale run's own catalog does not unless it says so.
export const HIRING_WINDOW_DAYS = 14;

// The app, over a catalog of companies and a catalog of investors. The server and the tests use the real data files; a
// scale test gives it a catalog over synthetic companies in a temporary folder (scripts/scale/serve.js). There is
// deliberately no environment variable that points the public server at another file.
// The people pages read people_seed.json and the investor directory. An entry marked placeholder is hidden unless the machine asks to see
// it (SHOW_PLACEHOLDERS=1, on the owner's own computer while building): the safe way round, so a server that forgets to say it is live
// never shows a made-up person.
export function createApp({
  catalog = createCatalog({ file: DATA_FILE, hiringWindowDays: HIRING_WINDOW_DAYS }), investorCatalog = createInvestorCatalog({ dir: DATA_DIR }), correctionsFile, cache,
  communityCatalog = createCommunityCatalog({
    file: path.join(DATA_DIR, 'people_seed.json'), institutionsFile: path.join(DATA_DIR, 'institutions_seed.json'), geocodeFile: path.join(DATA_DIR, 'geocode_cache.json'),
    investorCatalog, production: process.env.SHOW_PLACEHOLDERS !== '1',
  }),
  showPeople = peopleShown(),
} = {}) {
  const respond = createResponder(catalog, cache);
  // The investor directory is answered from its own snapshot (several files, one version) with its own kept answers.
  const respondInvestors = createResponder(investorCatalog, cache);
  const respondCommunity = createResponder(communityCatalog, cache);
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/startups', createStartupsRouter({ respond }));
  app.use('/api/investors', createInvestorsRouter({ respond: respondInvestors, catalog: investorCatalog, correctionsFile }));
  app.use('/api/investor-people', createInvestorPeopleRouter({ respond: respondInvestors, catalog: investorCatalog, correctionsFile }));
  app.use('/api', createCommunityRouter({ respond: respondCommunity, companyCatalog: catalog, enabled: showPeople })); // before the search router: /api/people here, /api/people/:name there
  app.use('/api', createSearchRouter({ respond }));
  app.use('/api/news', newsRouter);
  app.use('/api/submissions', submissionsRouter);
  app.use('/api/edits', editsRouter);
  app.use('/api/feedback', feedbackRouter);
  app.use('/directory', createDirectoryRouter({ respond }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message }); // a request that cannot be answered (a bad page), not a fault
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  app.locals.catalog = catalog;
  app.locals.investorCatalog = investorCatalog;
  app.locals.communityCatalog = communityCatalog;
  app.locals.respond = respond;
  return app;
}

const app = createApp();
// Load the companies and the investors now, so the first visitor does not wait for it; a failure here is reported on the first request.
app.locals.catalog.refresh().catch(() => {});
app.locals.investorCatalog.refresh().catch(() => {});
app.locals.communityCatalog.refresh().catch(() => {});

export default app;
