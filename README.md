# AU Startup Map

Interactive map of VC-backed Australian startups, split into a backend API and a React frontend.

## Structure

```
backend/            Express API
  src/server.js      entry point
  src/routes/         /api/startups, /api/search, /api/news, /directory
  src/catalog/        the public read model: indexes built once, answers cached (see docs/scale.md)
  src/geo/             where things are: city and state reference points, the geocoder, and the location tools (see docs/locations.md)
  src/data/            startups.json (source of truth) and the collections beside it
  src/scheduler/       the scheduled refresh jobs (run by `npm run scheduler`, never by the server)
  scripts/             command lines: discovery, admin, scheduler, scale test tools
frontend/            React (Vite) app
  src/App.jsx          top-level layout/state
  src/LandingPage.jsx  the /welcome page; its navigation, headline and dot picture of Australia are in src/components/landing/ (see docs/landing.md)
  src/components/      MapView, ListView, FilterPanel, JobsView, Leaderboard, NewsTicker
  src/mapPins.js       groups pins for the map (only what is in view is drawn), and the words for how well a place is known
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

## Hosting

- **The site (`frontend/`)** is on Vercel: project `au-startup-map`, https://au-startup-map.vercel.app. `frontend/vercel.json` holds its settings (the `/welcome` page, and long caching for the hashed files in `/assets`). The one environment variable the build needs, `VITE_API_BASE` (the API's address), is set on the Vercel project for Production and Preview, because Vercel builds the site. Deploy by hand with `vercel deploy --prod --cwd frontend` (needs `npm install -g vercel` and `vercel login`).
- **The API (`backend/`)** is on Render (`render.yaml`), https://atlas-startup.onrender.com, and deploys on every push to `main`. It stays there: it is an always-on Express server that reads the JSON data files, and Vercel Functions run on a read-only disk. On Render's free plan it goes to sleep when nobody has asked for a while, so the first visit after a quiet spell can wait many seconds (about 15 the last time it was timed) for it to wake.

## API

- `GET /api/startups` — list startups, supports `search`, `sector`, `city`, `investor`, `stage`, `hiring` (`yes`/`no`), `state` (`NSW,VIC`) and `precision` (`EXACT,SUBURB,CITY,STATE,UNKNOWN`: how well the place is known) query params. With none of the paging parameters below it answers as it always did, `{ total, count, results }` with every match, so anything built on it keeps working
  - `limit` (1–200), `offset`, `sort` (`name`, `hiring`, `location`, `industry`), `view=card` (the few fields a card shows) or `view=full`, and `facets=sector,city,stage` (the counts for those filters, for the matches) turn it into a page: `{ total, count, offset, limit, results, facets? }`
- `GET /api/startups/markers` — for the map (same filters): one compact array per company whose place is a point (an exact office or a suburb), and one group per city or state (`areas`) for the companies known only to that much, which are drawn as a group and never as a pin. See [docs/locations.md](docs/locations.md)
- `GET /api/startups/summary` and `GET /api/startups/count` — counts for the filters in force, without any companies
- `GET /api/startups/meta` — distinct sector/city/investor/stage values for populating filter dropdowns
- `GET /api/startups/:slug` — one company in full; `GET /api/people/:name` — the companies a person founded
- `GET /api/search?q=` — name suggestions for the search box
- `GET /directory?page=n` — the no-JavaScript list, 250 companies a page
- `GET /api/news` — recent AU startup deal headlines, cached server-side for 6h, backed by `src/data/seedDeals.json` until a real source is wired up in `fetchLiveDeals()` (`backend/src/routes/news.js`)

Every read is answered from an in-memory index built once and rebuilt only when `startups.json` changes, carries an `ETag` (a repeat visit is a `304` with no work), and is gzipped. At 10,000 companies the whole map's pins are 214 KB over the wire and answer in under a millisecond from cache. See [docs/scale.md](docs/scale.md).

## Adding startups

Edit `backend/src/data/startups.json` (the only place companies live), then from `backend/`:

```bash
npm run data:migrate   # assigns id/slug to new records, fills derived fields, regenerates people.json and investors.json
npm test               # includes a drift check: fails if the data files are out of date
```

The migration only fills fields that are missing, never overwrites a value, and never touches the legacy fields the app reads. Unknown stays `null` — don't estimate. For anything you verified, add its source to `sources.json` and record what it said as evidence (see Data provenance below).

### Data model (schema v2)

Companies keep their original fields (`name, sector, sectorFull, city, lat, lng, investors, stage, hiring, verified, website, blurb, taskGate, address, founders, foundedYear`) and gain `id, slug, logo, subsector, state, country, suburb, postcode, location_precision, location_source, location_source_url, location_verified_at, location_confidence, company_status, hiring_status, employee_range, funding_total, last_funding_date, last_funding_round, verification_status, confidence_score, created_at, updated_at, last_verified_at, founder_ids, investor_ids, source_ids`. Concepts the long-term model names differently but that already exist (`description` = `blurb`, `latitude`/`longitude` = `lat`/`lng`, `founded_year` = `foundedYear`) are not duplicated in storage; `toCanonical()` projects them. Definitions and enums are in `backend/src/models/company.js`; the related collections (`people`, `investors`, `sources`, `evidence`, `funding_rounds`, `jobs`, `news`, `company_locations`) are described in `backend/src/models/dataset.js`.

### Data provenance

`sources.json` records what was read (a page at a URL, and when). `evidence.json` records what it said: one row per claim about one company field.

```json
{ "id": "acme.stage.acme-funding-post", "company_id": "acme", "field": "stage", "value": "Series A",
  "source_id": "acme-funding-post", "confidence": "high", "verified_at": "2026-10-05T03:59:04.292Z",
  "status": "active", "note": null }
```

- A row joined to its source holds everything the model calls for: `source_id, company_id, field, value, source_name, source_url, source_type, retrieved_at, verified_at, confidence` (`flattenEvidence()` in `backend/src/models/evidence.js`). Several sources can back one field. List fields (founders, investors) take one row per member.
- `confidence`: **high** is a retrieved primary source stating the fact; **medium** a retrieved secondary source, press seen only in search results, or an inference from a retrieved page; **low** an owner-supplied lead or a listing nobody opened. `high` requires `verified_at`, and `verified_at` requires a source that was actually retrieved.
- **Evidence never changes a company.** If two active sources give a field different values, or the record differs from what the evidence says, it is reported as a conflict (`detectConflicts()`, listed by `npm run data:audit`) for a person to resolve: mark one row `rejected` or `superseded` with a note, or edit the record. Rows are not deleted to settle a disagreement, so a claim that was checked and turned down stays on file and does not get re-added.
- Add rows by hand (or with `makeEvidenceRow()`), then run `npm run data:migrate`. It sorts the file, lists each cited source on the company, advances `last_verified_at` and validates.
- This is internal. No route serves `sources.json` or `evidence.json`, and `/api/startups` omits `source_ids, confidence_score, last_verified_at, created_at, updated_at` (`INTERNAL_FIELDS` in `company.js`).

### Data quality audit

```bash
npm run data:audit                                 # coverage summary and the top of the queue
npm run data:audit -- --out ../docs/data-quality   # also write the report and two CSVs
```

Read-only: it never changes a data file and never proposes a value. It reports coverage for 14 attributes (website, sector, city, state, coordinates, stage, hiring, description, founders, founded year, funding, investors, source, last verified), flags unknown, missing, null, invalid-URL, generic-sector, stale, defunct and acquired records, and builds a prioritized enrichment queue (P0 integrity, P1 core identity, P2 freshness and confidence, P3 depth). The report's "Method and definitions" section states every rule. Dated snapshots are kept in `docs/data-quality/`.

### Where companies are

A pin must mean what it looks like. Every company has a `location_precision`: `EXACT` (the office: a pin), `SUBURB` (a pin drawn as approximate), `CITY` or `STATE` (no coordinates at all: the company is counted in a group at its city or state, never given a pin), or `UNKNOWN` (listed, not drawn). A city centre is not a company's address, so nothing is placed on one and nothing is spread out to look better.

```bash
cd backend
npm run locations -- status                # how well locations are known, and what to look at
npm run locations -- review                # the review queue, worst first
npm run locations -- geocode [--apply]     # OpenStreetMap Nominatim: one request a second, answers kept; a disagreement is reported, never overwritten
npm run locations -- promote [--apply]     # give a city-only company the address its own website states
```

Of the 216 companies today: 148 exact, 11 suburb, 43 city only, 14 unknown; 112 of the exact addresses are the directory's own record and have not yet been checked against a source, and 9 companies' pins disagree with the geocoder and are waiting for a person. The design, the sources that are and are not allowed (never LinkedIn, never a home address), how the geocoder is judged, what was done to the real data and what is still open: [docs/locations.md](docs/locations.md).

### Discovery engine

```bash
npm run discovery -- run --dry-run     # find candidate companies from the configured sources, writing nothing
npm run discovery -- list              # the review queue
npm run discovery -- resolve --name "Leonardo.Ai" --website https://leonardo.ai   # have we seen this?
```

Finds candidate Australian startups from licensed or public sources, checks each against the companies already here (by website, ABN/ACN and name, including aliases and former names), checks it is Australian and a startup, reads the company's own website, scores it, and queues it for a person. Candidates are staging data: they enter as `candidate`, no route serves them, and only a named person can approve, merge or publish one. It never reads LinkedIn or a proprietary database, obeys `robots.txt` and refuses access-controlled pages. See [docs/discovery.md](docs/discovery.md).

### Data Command Center

```bash
cd backend
npm run admin -- init --name "Your name"   # once: shows your access token a single time
npm run admin                              # http://127.0.0.1:4010
```

A private page, never part of the public site, for working the data: the eight counts (companies, candidates, needs review, duplicates, updated this week, missing data, failed imports), new startups discovered (approve, reject, edit, merge, publish), data quality, locations (how well each place is known, and a review queue), conflicts a person settles, suggested fills, the enrichment queue, the scheduled refresh and the audit trail of every action. Local only, with roles. See [docs/admin.md](docs/admin.md).

### Keeping it current (the scheduler)

```bash
cd backend
npm run scheduler -- status        # the six jobs, when each last ran, what is due, what is wrong
npm run scheduler -- plan          # exactly what a run would do (reads and writes nothing)
npm run scheduler -- tick          # one run of every job that is due
```

Six jobs keep the directory current, each looking at its own kind of fact at its own pace: **discovery** (new candidates, never public until a person publishes), **funding** (stories about companies we have, as evidence), **hiring** (open roles, from the careers page and the job board it links to), **company status** (acquired, closed, renamed), **enrichment** (description, address, founders, investors) and **data quality** (what is stale or in conflict). Roles change within days, a founding year never moves, so a role is looked at every 3 days and a founding year every 365. Every fact has four clocks (`last_checked_at`, `last_verified_at`, `last_changed_at`, `next_check_at`), every run is logged including the ones that found nothing, and running it twice gives the same answer. It reads other people's websites politely (robots.txt, pacing, a request budget, `Retry-After`), writes evidence rather than editing companies, and is a separate process the public server never loads. It runs from a terminal or a timer on your machine, and a GitHub Actions workflow for it is kept in `docs/scheduled-refresh.workflow.yml` until it can be installed (GitHub wants a credential with the `workflow` scope for that; the workflow does nothing until you set `SCHEDULER_ENABLED`). It has not yet been run against the real directory. See [docs/scheduler.md](docs/scheduler.md).

### Scale

Tested at 213, 500, 1,000, 2,500, 5,000 and 10,000 companies, on synthetic fixtures that exist only in temp folders (`backend/scripts/scale/fixtures.js` refuses to write near the real data): the API and server, and the app in a headless browser on a desktop and on a throttled phone. At 5,000 companies the map's pins arrive in 3 seconds on a slow phone instead of 40; the List tab no longer freezes that phone for 18 seconds (0.3 s now); the page holds 500 elements instead of 46,000; and the server's memory stays under 130 MB instead of 390. Not everything got better (zooming to street level on a slow phone is about as smooth as before, not smoother), and the measurements were taken on a busy shared laptop. What changed, how it was measured and what is still not solved are in [docs/scale.md](docs/scale.md); the raw results and the tables made from them are in `docs/scale/`.

## Testing

Both apps use [Vitest](https://vitest.dev) with the `v8` coverage provider.

```bash
npm test              # run backend + frontend test suites
npm run test:coverage # same, with a coverage report for each
```

- `backend/tests/` — supertest hitting the Express `app` directly: filtering logic for every query param on `/api/startups`, `/api/startups/meta`, and the `/api/news` live/cache behavior; model tests (`companyModel`, `evidence`, `audit`) on small synthetic datasets; discovery tests (`identity`, `resolve`, `fetch`, `sources`, `enrich`, `relevance`, `pipeline`, `review`, `candidates`, `cli`) against a scripted web, never the real one; the public read model (`catalog` proves its answers equal the old filter's on 400 random queries; `startupsApi`; `scaleFixtures`); the scheduler (`schedulerTick`, `schedulerState`, `schedulerFeeds`, `schedulerQuality`, `schedulerCli`, `statusSignals`, `fetchCooldown`), including that a second run at the same moment changes nothing; where companies are (`location`, `places`, `geocode`, `locate`, `locationAudit`, `locationsCli`, `catalogLocations`, `adminLocations`), against a scripted geocoder that never touches the network or waits a second; `dataIntegrity` on the shipped data files
- `frontend/tests/` — React Testing Library for each component (`leaflet` is mocked in `MapView.test.jsx` so tests don't need a real map), plus `api.js` and top-level `App.jsx` wiring

Coverage reports are written to `backend/coverage/` and `frontend/coverage/` (open `coverage/index.html` for the interactive view); both are gitignored.

Current coverage (statements): ~99% (backend), ~99% (frontend). Not counted, and said so in each `vitest.config.js`/`vite.config.js`: the Command Center's page (`backend/src/admin/ui`, browser code that Node never runs; counted it would take the backend to 84%) and the generated shadcn/AI Elements components that nothing imports yet (counted, they would take the frontend to 76%).
