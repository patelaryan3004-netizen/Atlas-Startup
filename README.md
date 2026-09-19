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

Edit `backend/src/data/startups.json` — no code changes needed, both endpoints read from it directly.

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
