# Scale: 213 companies today, 10,000 tomorrow

The directory has about 213 public companies. This is what was done to make sure it still works, and still feels quick, at 500, 1,000, 2,500, 5,000 and 10,000: how it was tested, what was slow, what changed, what it now costs, and what is still not solved.

**Every company used in a test is synthetic and exists only in a temporary folder.** `backend/scripts/scale/fixtures.js` writes them and refuses to write anywhere near `backend/src/data`. Nothing synthetic is in the repository's data, on Render or on Vercel; the raw results in `docs/scale/` contain numbers, not companies.

## The short version

At 10,000 companies, the old app downloaded the 7 MB directory twice, built 10,000 map markers and 10,000 list cards, and took 78 seconds to show its first pins on a throttled phone; the List tab then froze that phone for 45 seconds and the Jobs page for 6. The server's memory reached 654 MB, more than Render's free tier has (512 MB), and ten visitors at once got 6 requests a second. The new one sends the map's pins in 220 KB, draws only the pins in view, shows 48 cards at a time and a page of 24 jobs, and shows its first pins on the same phone in 4 seconds; no step freezes that phone for more than about a third of a second (the median of three runs). The server stays under 215 MB and answers ten visitors at once at 3,356 requests a second. At 5,000 companies the phone sees the first pins in 3 seconds instead of 40.

Not everything got better, and the tables say so: at today's size, zooming to street level on a slow phone is a little less smooth than before (a longest freeze of 0.27 s against 0.22 s), and between 500 and 2,500 companies a fast computer sees the first pins at about the same time as before (within the noise of a busy laptop). What changed is that nothing grows with the directory any more.

Old → new, on the throttled phone and on a desktop. Each number is the median of its own measurement across three runs (the old app at 5,000 and over: one run); a "longest freeze" is the longest single stretch in which the page could not answer a click. The full tables are in [`results.md`](scale/results.md).

**On a phone** (390×844, processor 4× slower, 1.6 Mbit/s with 150 ms round trip):

| Companies | First pins | Zoom to street level: longest freeze | List tab: longest freeze | Jobs page: longest freeze | Whole session: main thread busy |
| --- | ---: | ---: | ---: | ---: | ---: |
| 213 | 4.2 s → 2.5 s | 219 ms → 270 ms | 1.5 s → 305 ms | 379 ms → 254 ms | 5.7 s → 3.8 s |
| 500 | 6.5 s → 2.5 s | 174 ms → 281 ms | 2.4 s → 290 ms | 549 ms → 257 ms | 7.2 s → 4.1 s |
| 1,000 | 9.9 s → 2.6 s | 168 ms → 155 ms | 3.8 s → 315 ms | 726 ms → 273 ms | 9.3 s → 3.9 s |
| 2,500 | 21.5 s → 2.8 s | 207 ms → 130 ms | 9.8 s → 300 ms | 1.8 s → 225 ms | 19 s → 4.1 s |
| 5,000 | 40.2 s → 3.1 s | 199 ms → 184 ms | 18.3 s → 312 ms | 3.7 s → 213 ms | 34.3 s → 4.7 s |
| 10,000 | 78.2 s → 4 s | 236 ms → 162 ms | 45.3 s → 272 ms | 6.3 s → 221 ms | 76.3 s → 5.2 s |

**On a desktop** (1280×800, no throttling):

| Companies | Data to open the map | First pins | List tab: page elements | List tab: longest freeze | Jobs page: longest freeze | Memory at the end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 213 | 308 KB → 12 KB | 915 ms → 458 ms | 2,018 → 508 | 201 ms → 100 ms | 66 ms → 53 ms | 10 MB → 5 MB |
| 500 | 705 KB → 19 KB | 667 ms → 600 ms | 4,658 → 508 | 635 ms → 49 ms | 118 ms → 39 ms | 9 MB → 6 MB |
| 1,000 | 1.4 MB → 31 KB | 641 ms → 641 ms | 9,213 → 507 | 1.1 s → 105 ms | 195 ms → 54 ms | 23 MB → 6 MB |
| 2,500 | 3.4 MB → 62 KB | 907 ms → 949 ms | 22,971 → 503 | 2.6 s → 98 ms | 440 ms → 78 ms | 55 MB → 12 MB |
| 5,000 | 6.9 MB → 115 KB | 1.8 s → 538 ms | 45,843 → 504 | 4 s → 52 ms | 567 ms → 44 ms | 103 MB → 18 MB |
| 10,000 | 13.7 MB → 220 KB | 2.1 s → 600 ms | 91,620 → 503 | 12.3 s → 54 ms | 3.3 s → 58 ms | 190 MB → 15 MB |

## How it was tested

| What | How |
|---|---|
| Sizes | 213 (today), 500, 1,000, 2,500, 5,000, 10,000 synthetic companies, shaped like the real directory: names, founders and investors invented, websites on the reserved `.test` domain (which never resolves), and the real directory's statistics copied: dense in Sydney and Melbourne and in a few streets within them (which is what makes clustering hard), about a third hiring, some without a confirmed location, sectors, stages and investor counts in the real proportions |
| The old and the new | the commit before this work (`973f554`) and the current one, built and served the same way (production build, the same proxy), each with its own server, on the same fixtures |
| API and server | `scripts/scale/bench.js`: for every call, 30 to 40 sequential requests (the median and the 95th percentile), the same call computed from scratch, and as many requests as it can sustain with ten at once; start-up time and memory |
| In a browser | `scripts/scale/cdp-bench.js` drives a real headless Chrome: the page loads cold (cache off), the map zooms to street level in the Sydney CBD and back out, the search box is typed into, the List tab opens, a company opens, the Jobs page opens. It records when the pins appear, what crossed the network, how long the page could not answer a click (the longest single freeze, and all the freezes added up: the gaps of a 10 ms heartbeat longer than 60 ms), page nodes, memory and how long the main thread was busy. A step ends when what it should show (the cards, the panel) is on the page and the page has been quiet for 300 ms, so a slow answer cannot end it before anything is drawn |
| A phone | the same, at 390×844 with the processor 4× slower and a 1.6 Mbit/s connection with 150 ms round trip: what Lighthouse calls "slow 4G" mobile |
| Repeats | each browser cell three times, each number the median of its own measurement across the three runs; the old app at 5,000 and over takes minutes and was run once (it differs from the new one by a factor of ten or more, which noise cannot change) |

Three things to know about the numbers:

- **It was a shared laptop.** Someone was using it for other things, so the machine was 55 to 100% busy while the tests ran (this test included; the raw files record how busy, per run). Read differences of tens of percent in the small numbers as noise, particularly on the desktop, where a whole step takes tens of milliseconds; the large ones are factors of ten and more.
- **Nothing outside the app was reached.** A company logo is answered locally with a one-pixel image as if it had loaded (refusing logos would run every card's failure path, which is the old app's worst case, not its usual one); Leaflet's stylesheet comes from this repository's copy; the font stylesheet is empty; map tiles are refused. Without that, a slow outside network delayed every run by the same twenty seconds.
- **The old server does not compress**, and a CDN in front of it may do so in production. The tables show both what it sent and what the same answer weighs gzipped. The work the browser does with 7 MB of JSON does not change.

The full tables, generated from the raw files, are in [`docs/scale/results.md`](scale/results.md); the raw files are `results-baseline.json`, `results-current.json`, `browser-desktop.json` and `browser-mobile.json` beside it. `node scripts/scale/report.js` makes the tables again.

## What was slow, and what changed

The old app treated the directory as a file: the server read all of it, filtered it with a scan on every request and sent every match, and the browser held every company as an object, a map marker and a list card. That is fine at 200 companies and the wrong shape at 5,000.

| Concern | Before | Now |
|---|---|---|
| **Database queries** (the JSON file stands in for the tables) | every request scanned every company | the file is read once into an in-memory read model (`src/catalog`) and rebuilt only when `startups.json` changes. A query starts from the shortest of the per-sector, per-city, per-stage and per-investor lists and checks the rest, so its cost follows the answer, not the directory |
| **Indexes** | none | row lists per sector, city, stage and investor; sort orders worked out ahead (name, hiring, location, industry); a name-prefix index for suggestions; a lower-case text haystack for search. The whole set is built in under a second at 10,000 companies |
| **Server-side filtering** | the browser filtered the whole directory | every filter runs on the server; `/api/startups/summary` and `/count` return counts for the filters in force with no companies at all |
| **Pagination** | none (7 MB at 10,000) | `limit` (1 to 200), `offset`, `sort`; the list loads 48 cards and the next 48 as the visitor nears the end; the no-JavaScript `/directory` is 250 a page |
| **Payload size** | every field of every company, uncompressed | the map gets one compact array per pin (slug, name, lat, lng, sector, city, hiring, domain); a card gets the 11 fields it shows; a company's full record arrives when it is opened; everything is gzipped |
| **Caching** | none | an `ETag` from the data version and the canonical question (a repeat visit is a `304` with no work); a bounded cache of serialised answers (300 entries, 64 MB); `Cache-Control: public, max-age=60, stale-while-revalidate=600`; an error is never cached |
| **Map rendering and clustering** | one marker per company, all created at load (leaflet.markercluster) | supercluster groups the pins for the window and zoom; elements are created only for what is in view, padded a little, and a few at a time (a dozen in the frame the map moved, then batches that grow while they are quick and shrink when they are slow, so a phone keeps answering touches while a crowded view fills in); pins, clusters and tooltips are built as elements, never HTML strings |
| **Lazy loading** | every logo, every card | logos only from street level (zoom 13) and only while 60 or fewer pins are on screen; cards 48 at a time; a company's details after it opens |
| **Search indexing** | a substring scan in the browser | the same substring rule, on the server, over a precomputed haystack (2 ms uncached at 10,000); suggestions from a prefix index |
| **Request debouncing** | the whole directory re-filtered on every keystroke | typing waits 250 ms; suggestions 200 ms and can be cancelled; an answer to a question that has since changed is dropped (every request carries an abort signal) |

The old answers did not change. `/api/startups` with none of the new parameters returns what it always did, so anything built on it keeps working, and a test compares the new filter with the old one on 400 random queries. The live site's old front end keeps working against the new server while the new one is deployed.

A bug that was already there turned up on the way. The company panel answered a logo that would not load by pointing the image at the next address, and React keeps its own error listener on an `<img>`, so for a visitor whose browser could load neither address (an ad blocker, no network) it failed again at once, thousands of times a second, for as long as the panel stayed open: 49,000 attribute writes in eight seconds, a processor core pinned. It now moves one step on for each failure and stops. The scale test found it (a company opened from the list never went quiet); two tests that fail on the old code cover it.

## Results

The headline numbers; everything else is in [`results.md`](scale/results.md).

### The server

| Companies | Opening the map: old | Opening the map: new | Ten at once: old | Ten at once: new | Memory after load: old | Memory after load: new |
|---|---:|---:|---:|---:|---:|---:|
| 213 | 153 KB | 7.4 KB | 229 req/s | 12,344 req/s | 214 MB | 90 MB |
| 1,000 | 702 KB | 25 KB | 68 req/s | 8,575 req/s | 119 MB | 92 MB |
| 5,000 | 3.4 MB | 110 KB | 13 req/s | 4,430 req/s | 390 MB | 124 MB |
| 10,000 | 6.9 MB | 214 KB | 6 req/s | 3,356 req/s | 654 MB | 212 MB |

"Opening the map" is what crosses the wire for the pins (or, in the old app, the whole directory) plus the counts and the filter options. "Ten at once" is the heaviest call each app makes. A cached answer from the new server takes 0.1 to 0.3 ms at every size; from scratch the heaviest (all the pins at 10,000) takes 50 ms, and a name search 2 ms. The new server takes under a second to start at 10,000 companies (it builds the indexes first); the old one started in a third of a second and then managed 6 requests a second. The old server's memory is erratic from one size to the next (it depends on when the garbage collector last ran); its worst case, 654 MB, is the one that matters.

### What each part of the app asks for, at 10,000 companies

| The visitor | Old: asks for | Old: wire, median | New: asks for | New: wire, median cached (from scratch) |
|---|---|---:|---|---:|
| opens the map | the whole directory | 6.9 MB, 148 ms | the pins | 212 KB, 0.2 ms (50 ms) |
| opens the list | the same file again | | the first 48 cards | 1.6 KB, 0.3 ms (0.4 ms) |
| filters by sector and city | every match, in full | 529 KB, 69 ms | a page of cards, and the counts | 1.8 KB, 0.1 ms (0.7 ms); counts 1.6 KB, 0.1 ms (6.5 ms) |
| types in the search box | every match, in full | 59 KB, 56 ms | name suggestions | 0.6 KB, 0.1 ms (0.4 ms) |
| opens a company | nothing: it was in the page | | its record | 0.7 KB, 0.3 ms (0.2 ms) |
| opens Jobs | every company hiring | 2.2 MB, 82 ms | a page of 24 and the filter counts | 1.8 KB, 0.1 ms (2 ms) |
| reads the directory without JavaScript | every company | 2.1 MB, 110 ms | 250 companies | 5.1 KB, 0.1 ms (1.4 ms) |
| (the filter options for the dropdowns) | | 2.8 KB, 58 ms | | 0.8 KB, 0.1 ms (0.4 ms) |

### In a browser

The two tables at the top of this page are the summary (old → new, on a throttled phone and on a desktop); [`results.md`](scale/results.md) has every table. What they say, with the median of three runs behind each number:

- **Opening the map.** On the phone the first pins took 4.2 seconds at 213 companies and 78 seconds at 10,000 in the old app; they take 2.5 and 4 seconds in the new one, and what growth there is comes from work that depends on the number of pins (their download, parse and index; 220 KB at 10,000). What crosses the wire to open the map is 12 KB instead of 308 KB at 213 companies and 220 KB instead of 13.7 MB at 10,000: the old app asked for the whole directory twice. On a desktop the first pins come at about the same time as before between 500 and 2,500 companies (a busy laptop's noise is as large as the difference), and in 0.5 seconds instead of 1.8 at 5,000.
- **The list.** The old app made a card for every company: 2,018 page elements at 213 companies, 45,843 at 5,000, 91,620 at 10,000. The new one shows 48 cards and about 500 elements at every size. The phone's longest freeze when the List tab opens went from 1.5 seconds (213) and 18 seconds (5,000) to 0.27 to 0.32 seconds at every size; on a desktop from 0.2 seconds (213) and 4 seconds (5,000) to 0.05 to 0.1 seconds.
- **Jobs.** The old Jobs page drew every company that is hiring: 73 cards at 213 companies, 1,609 at 5,000, 3,172 at 10,000, and froze the phone for 0.4, 3.7 and 6.3 seconds. The new one draws 24 and freezes it for 0.21 to 0.27 seconds at every size.
- **A company.** Opening one froze the old app's phone for 0.3 seconds at 213 companies, 1.9 at 5,000 and 5.2 at 10,000 (with every card still on the page); the new app takes 0.12 to 0.2 seconds at every size.
- **The page's own work.** Over the whole scenario the phone's main thread was busy for 5.7 seconds at 213 companies and 76 seconds at 10,000 in the old app, and for 3.8 and 5.2 in the new one. On a desktop the page's memory at the end was 190 MB at 10,000 companies against 15 MB.
- **Searching.** The old app sent a request for every key and every request carried every match; the new one waits for the typist to pause, then asks for suggestions, counts and pins for the final text. Neither freezes a phone for long (the new app's longest is 0.08 seconds).
- **What did not get better.** The phone's longest freeze when the map jumps to street level is about 0.2 to 0.3 seconds in both apps; in the new one it is a little longer at 213 and 500 companies (0.27 and 0.28 seconds against 0.22 and 0.17) and shorter from 1,000 up, and it is spread over several short freezes that add up to 0.8 to 0.9 seconds at 5,000 and 10,000 companies (0.2 seconds in the old app, which had built every pin at load). See "What is still not solved".

## What is still not solved

- **The store is a JSON file.** The catalog holds the whole directory in memory: 148 MB at start and 212 MB after load at 10,000, 850 ms to build. By extrapolation that is comfortable to roughly 20,000 companies on Render's free tier and not much beyond; at 50,000 the memory alone is a problem, and the file is rewritten whole on every change. That is the point to move to a database. The shapes were chosen so it is a load step: every collection maps to a table, every id is a stable string. The indexes below are what to create then.
- **The map's pins grow with the directory.** 214 KB at 10,000, about a megabyte at 50,000. Beyond that the server should cluster for the window (`/markers?bbox=&zoom=`), not send every pin.
- **Not re-measured since companies gained a "how well is the place known" (2026-10-06, [locations.md](locations.md)).** Companies known only to their city are no longer pins but a group per city, and each pin now carries a place line, a precision and a checked flag; the scale fixtures have the real directory's mix (73% exact, 5.5% suburb, 21.5% city-only). The map's answer was measured again by itself (`gzip -5`, as the server sends it): 7 KB at 213 companies, 25 KB at 1,000, 114 KB at 5,000, **226 KB at 10,000** (7,348 pins and 13 groups; the same pins in the old shape are 169 KB, so the new fields cost about a third more per pin, and 10,000 old pins were 214 KB). The server numbers, the browser sweeps and the tables above are from before the change and were not run again: the pin count is lower and each pin a little heavier, which should roughly cancel, and nothing was measured to say so.
- **Zooming to street level still costs a slow phone a few short freezes.** The pins in view are made a few at a time (a dozen in the frame the map moved, then batches sized by how long the last one took), so the longest single freeze is 0.13 to 0.28 s at every size. The old app's was 0.17 to 0.24 s because it had made every pin at load. At 213 and 500 companies the new one is a little longer (0.27 and 0.28 s against 0.22 and 0.17), and the freezes add up: 0.8 to 0.9 s at 5,000 and 10,000 companies against 0.2 s. The pins fill in over about a second and the page answers a tap in between. Drawing the pins on a canvas instead of as elements would remove most of it; that changes how the map works and has not been done.
- **Opening the Jobs page or a company still costs a slow phone about a quarter of a second** (0.21 to 0.27 s for Jobs, 0.12 to 0.2 s for a company, at every size), mostly the browser laying out a new page on a processor four times slower. At 213 companies that is no better than the old app (0.25 s against 0.38 s for Jobs, 0.18 s against 0.29 s for a company, within a busy laptop's noise); it does not grow with the directory, and the old app's grew to 6.3 s and 5.2 s at 10,000.
- **One process, one cache.** The answer cache is per process; Render's free tier runs one. Several instances would each build their own catalog, which is correct and wasteful, not wrong.
- **Measured on loopback.** The phone profile adds the latency and bandwidth of a slow connection; the desktop numbers do not. A real network adds to both apps.
- **Synthetic data is not real data.** The fixtures copy the shape of the real directory, not its quirks. At 10,000 real companies the distribution of sectors and cities, or an unusually long description, could move the numbers.

## The indexes for the move to a database

Not applied anywhere: the data is a JSON file and its in-memory indexes do this work today. When the collections become tables, these are the indexes that match what the catalog builds, and the queries that need them.

```sql
-- Filters the API takes, each combinable with the others and with paging
CREATE INDEX companies_sector_idx ON companies (sector);
CREATE INDEX companies_city_idx   ON companies (city);
CREATE INDEX companies_stage_idx  ON companies (stage);
CREATE INDEX companies_hiring_idx ON companies (id) WHERE hiring;           -- a third of the rows
CREATE INDEX companies_pinned_idx ON companies (id) WHERE lat IS NOT NULL;  -- the map's pins
CREATE TABLE company_investors (
  investor_id text NOT NULL REFERENCES investors (id),
  company_id  text NOT NULL REFERENCES companies (id),
  PRIMARY KEY (investor_id, company_id)
);
CREATE INDEX company_investors_company_idx ON company_investors (company_id);

-- The sort orders the list offers; the id breaks ties so a page never repeats or skips a row
CREATE INDEX companies_name_idx     ON companies (lower(name), id);
CREATE INDEX companies_hiring_sort  ON companies (hiring DESC, lower(name), id);
CREATE INDEX companies_location_idx ON companies (city, lower(name), id);
CREATE INDEX companies_industry_idx ON companies ((coalesce(nullif(sector_full, ''), sector)), lower(name), id);

-- Search: suggestions are a name prefix; the search box matches a substring of the name, sector, city and description
CREATE INDEX companies_name_prefix_idx ON companies (lower(name) text_pattern_ops);
-- needed only if substring search is kept past roughly 100,000 rows; below that a scan of a few thousand short strings is faster than the index
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX companies_search_trgm_idx ON companies USING gin ((lower(name || ' ' || sector || ' ' || city || ' ' || blurb)) gin_trgm_ops);

-- The company panel, the Jobs page and the scheduler
CREATE UNIQUE INDEX companies_slug_key ON companies (slug);
CREATE INDEX jobs_company_open_idx ON jobs (company_id) WHERE status = 'open';
CREATE INDEX evidence_company_field_idx ON evidence (company_id, field) WHERE status = 'active';
CREATE UNIQUE INDEX refresh_state_key ON refresh_state (scope, target_id, facet);
CREATE INDEX refresh_state_due_idx ON refresh_state (scope, facet, next_check_at);
```

Paging stays `LIMIT 48 OFFSET n` while the offsets are in the low thousands; past that, page by the last row's sort key and id.

## Run it again

**The API and server** need nothing but the repository. From `backend/`, each architecture on its own server and its own fixtures in a temporary folder (the old one runs from a git worktree of the commit before this work):

```bash
git worktree add "$TMPDIR/au-scale/baseline" 973f554
node scripts/scale/bench.js --arch baseline --baseline "$TMPDIR/au-scale/baseline" --out ../docs/scale/results-baseline.json
node scripts/scale/bench.js --arch current --out ../docs/scale/results-current.json
```

**The browser** needs four servers, because it measures the old and the new app side by side. Each front end is built (`vite build`) from a copy that differs from the repository's in two lines only: the Vite proxy points at that app's own backend, and `MapView` exposes its Leaflet map as `window.__map` (after `mapRef.current = map;`), which is how the script moves the map. In the folder `$TMPDIR/au-scale`:

| Server | Command | Port |
|---|---|---|
| old backend | `BACKEND_PORT=4001 node baseline/backend/src/server.js` | 4001 |
| new backend | `node scripts/scale/serve.js --file live-current/startups.json --port 4002 --max-age 0` (from `backend/`) | 4002 |
| old front end | `vite preview --port 4173 --strictPort` in `baseline/frontend` (proxy to 4001) | 4173 |
| new front end | `vite preview --port 4174 --strictPort` in a built copy of `frontend` (proxy to 4002) | 4174 |

The script copies each size's fixture over the file a backend reads (`baseline/backend/src/data/startups.json` and `live-current/startups.json`), waits until the backend is serving that many companies, and drives a fresh Chrome for every run:

```bash
node scripts/scale/cdp-bench.js --profile desktop --sizes 213,500,1000,2500,5000,10000 --repeat 3 --heavy-once --budget 90000 --out ../docs/scale/browser-desktop.json
node scripts/scale/cdp-bench.js --profile mobile  --sizes 213,500,1000,2500,5000,10000 --repeat 3 --heavy-once --budget 420000 --out ../docs/scale/browser-mobile.json
node scripts/scale/report.js --out ../docs/scale/results.md
```

The desktop sweep takes about five minutes and the phone sweep about twelve (the old app at 10,000 companies takes minutes on its own). The result file is written after every run, so a sweep that is cut short keeps what it measured (`meta.complete` says whether it reached the end). `node scripts/scale/report.js --headline` prints the two summary tables at the top of this page.

`scripts/scale/serve.js` starts the current app over any file of fixtures. `npm test` includes the fixture generator's guard (it must refuse to write near the real data) and the proof that the catalog answers exactly what the old filter did. Close other programs first, or read the "how busy was the machine" table in `results.md` before trusting a small difference.
