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

The migration only fills fields that are missing, never overwrites a value, and never touches the legacy fields the app reads. Unknown stays `null` — don't estimate. For anything you verified, add its source to `sources.json` and record what it said as evidence (see Data provenance below).

### Data model (schema v2)

Companies keep their original fields (`name, sector, sectorFull, city, lat, lng, investors, stage, hiring, verified, website, blurb, taskGate, address, founders, foundedYear`) and gain `id, slug, logo, subsector, state, country, company_status, hiring_status, employee_range, funding_total, last_funding_date, last_funding_round, verification_status, confidence_score, created_at, updated_at, last_verified_at, founder_ids, investor_ids, source_ids`. Concepts the long-term model names differently but that already exist (`description` = `blurb`, `latitude`/`longitude` = `lat`/`lng`, `founded_year` = `foundedYear`) are not duplicated in storage; `toCanonical()` projects them. Definitions and enums are in `backend/src/models/company.js`; the related collections (`people`, `investors`, `sources`, `evidence`, `funding_rounds`, `jobs`, `news`) are described in `backend/src/models/dataset.js`.

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

A private page, never part of the public site, for working the data: the eight counts (companies, candidates, needs review, duplicates, updated this week, missing data, failed imports), new startups discovered (approve, reject, edit, merge, publish), data quality, conflicts a person settles, suggested fills, the enrichment queue and the audit trail of every action. Local only, with roles. See [docs/admin.md](docs/admin.md).

## Testing

Both apps use [Vitest](https://vitest.dev) with the `v8` coverage provider.

```bash
npm test              # run backend + frontend test suites
npm run test:coverage # same, with a coverage report for each
```

- `backend/tests/` — supertest hitting the Express `app` directly: filtering logic for every query param on `/api/startups`, `/api/startups/meta`, and the `/api/news` live/cache behavior; model tests (`companyModel`, `evidence`, `audit`) on small synthetic datasets; discovery tests (`identity`, `resolve`, `fetch`, `sources`, `enrich`, `relevance`, `pipeline`, `review`, `candidates`, `cli`) against a scripted web, never the real one; `dataIntegrity` on the shipped data files
- `frontend/tests/` — React Testing Library for each component (`leaflet` is mocked in `MapView.test.jsx` so tests don't need a real map), plus `api.js` and top-level `App.jsx` wiring

Coverage reports are written to `backend/coverage/` and `frontend/coverage/` (open `coverage/index.html` for the interactive view); both are gitignored.

Current coverage: ~93% (backend), ~99% (frontend) statements.
