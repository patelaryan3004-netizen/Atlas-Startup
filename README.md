# AU Startup Map

Interactive map of VC-backed Australian startups, split into a backend API and a React frontend.

## Structure

```
backend/            Express API
  src/server.js      entry point
  src/routes/         /api/startups, /api/news
  src/data/            startups.json (source of truth), seedDeals.json
frontend/            React (Vite) app
  src/App.jsx          top-level layout/state
  src/components/      MapView, FilterPanel, Legend, Leaderboard, NewsTicker
```

## Running locally

From the project root, install dependencies for both apps, then start both dev servers together:

```bash
npm run install:all
npm run dev
```

- Backend: http://localhost:4000
- Frontend: http://localhost:5173 (proxies `/api/*` to the backend)

Or run them separately:

```bash
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

## API

- `GET /api/startups` — list startups, supports `search`, `sector`, `city`, `investor`, `stage`, `hiring` (`yes`/`no`) query params
- `GET /api/startups/meta` — distinct sector/city/investor/stage values for populating filter dropdowns
- `GET /api/news` — recent AU startup deal headlines, cached server-side for 6h, backed by `src/data/seedDeals.json` until a real source is wired up in `fetchLiveDeals()` (`backend/src/routes/news.js`)

## Adding startups

Edit `backend/src/data/startups.json` (the only place companies live), then from `backend/`:

```bash
npm run data:migrate   # assigns id/slug to new records, fills derived fields, regenerates people.json and investors.json
npm test               # includes a drift check: fails if the data files are out of date
```

The migration only fills fields that are missing, never overwrites a value, and never touches the legacy fields the app reads. Unknown stays `null` — don't estimate. For anything you verified, add its source to `sources.json` and list the source id in the company's `source_ids`.

### Data model (schema v2)

Companies keep their original fields (`name, sector, sectorFull, city, lat, lng, investors, stage, hiring, verified, website, blurb, taskGate, address, founders, foundedYear`) and gain `id, slug, logo, subsector, state, country, company_status, hiring_status, employee_range, funding_total, last_funding_date, last_funding_round, verification_status, confidence_score, created_at, updated_at, last_verified_at, founder_ids, investor_ids, source_ids`. Concepts the long-term model names differently but that already exist (`description` = `blurb`, `latitude`/`longitude` = `lat`/`lng`, `founded_year` = `foundedYear`) are not duplicated in storage; `toCanonical()` projects them. Definitions and enums are in `backend/src/models/company.js`; the related collections (`people`, `investors`, `sources`, `funding_rounds`, `jobs`, `news`) are described in `backend/src/models/dataset.js`.

## Testing

Both apps use [Vitest](https://vitest.dev) with the `v8` coverage provider.

```bash
npm test              # run backend + frontend test suites
npm run test:coverage # same, with a coverage report for each
```

- `backend/tests/` — supertest hitting the Express `app` directly: filtering logic for every query param on `/api/startups`, `/api/startups/meta`, and the `/api/news` live/cache behavior
- `frontend/tests/` — React Testing Library for each component (`leaflet` is mocked in `MapView.test.jsx` so tests don't need a real map), plus `api.js` and top-level `App.jsx` wiring

Coverage reports are written to `backend/coverage/` and `frontend/coverage/` (open `coverage/index.html` for the interactive view); both are gitignored.

Current coverage: ~93% (backend), ~99% (frontend) statements.
