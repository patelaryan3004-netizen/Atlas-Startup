# Speed: what was slow, what changed, how to keep it fast (2026-10-14)

The site felt slow. It was measured first (Lighthouse on a production build, plus the API on Render), then fixed in the order below. No visual design was changed.

## What was slow

1. **The first paint waited on two other companies' servers.** `index.html` asked for Leaflet's stylesheet from cdnjs and Inter's stylesheet from Google Fonts. Both block painting, and the page's scripts do not run until they arrive. They were needed on every page, including the landing page and the list, which have no map. On this laptop's network a first connection to such a host sometimes stalls for 5 to 25 seconds, and the page stayed blank for all of it (first paint at 25 s in one unthrottled run).
2. **The first screen waited on Render.** The figures, the cards, the list, the map's pins and the landing page's picture all came from the API, which is on Render's free plan. An idle instance sleeps, and the first request after that took **21.6 s** (measured 2026-10-14; **14.1 to 14.6 s** in a second test an hour later; a warm one answers in 0.46 to 0.55 s from Australia, nearly all of it connection set-up). Until it answered, the list was the word "Loading…".
3. **Pages carried code they did not use.** `/?view=list` downloaded Leaflet (43 KB gzipped) and Supercluster, because the address was treated as "the map", and the app's shell imported the file that held Supercluster.
4. **Things moved when data arrived**: the "N companies hiring now" pill and the three figures were drawn after the first paint and pushed the page down 81 px (a layout shift of 0.29 in a phone-sized browser with a slowed CPU, 4 runs out of 4; Lighthouse's own runs caught it only some of the time). Now they are in the first paint, and the same check reads 0.000.

The warm API, the bundle size of the landing page (69 KB gzipped, limit 200) and the map's drawing (it already groups pins and draws in batches: 166 pins in the data are 17 elements at the opening zoom) were not the problem.

## What changed

| Change | Where |
|---|---|
| Leaflet's stylesheet and Inter are served with the site: no other site is asked for anything before the first paint. Inter is one variable file (47 KB, the Latin letters), preloaded, `font-display: swap`. | `index.html`, `src/main.jsx`, `src/components/MapView.jsx`, `vitePreload.js` |
| **A snapshot of the first views** is served with the site and drawn at once; the API's answer replaces it a moment later. The site's first screen no longer waits for Render, and still shows when Render is asleep or down. | `public/data/snapshot.json`, `src/snapshot.js`, `src/peek.js`, `src/api.js`, `backend/scripts/snapshot.mjs` |
| The map's file (Leaflet, Supercluster, their stylesheet) is fetched only by an address that opens the map; `?view=list`, the jobs board and the other pages never download it. Supercluster moved to `src/pinIndex.js`. | `src/mapPrefetch.js`, `src/main.jsx`, `src/pinIndex.js` |
| The news ticker is fetched once the page has settled, not with the first view. People and Lists were already files of their own. | `src/App.jsx` |
| The files of the page an address opens (the app, the map, the list, the jobs board) are asked for from `index.html`, beside the app's own file, instead of a round trip later. The landing page is left out: measured, it was slower with them. | `index.html`, `vitePreload.js` |
| Placeholders instead of blank space: cards or table rows for the list and the landing page's hiring section, a map-coloured ground while the map's file arrives. | `src/components/Skeletons.jsx` |
| `/data/*` is cached for 5 minutes and revalidated in the background for a day. Assets were already `immutable` for a year and the HTML already revalidates every time (checked on the live site). | `vercel.json` |

Logos were already lazy with width and height; the map already draws only what is in view, in batches, from Supercluster groups, and only at `moveend`.

## The snapshot

`npm run snapshot` (in `backend/`) starts the real app over the real data files, asks it the questions the first views ask (the list is `src/snapshotRequests.js`, run through the site's own `api.js`), and writes the answers to `frontend/public/data/snapshot.json` (about 78 KB, 16 KB gzipped): the counts, the filters' options, the map's pins, the landing page's hiring companies and list counts, the first page of the list, and the first page of the jobs board. It holds only what the public API already serves.

- A page reads it for its first paint (`peek.js`), and still asks the API; the API's answer replaces it. If the answer is the same, the very same object is kept, so nothing draws twice.
- A question the file does not hold (any filter, search, a company's panel, the next page) goes to the API alone, as before. **With Render asleep those wait for it to wake (14 to 22 s), and the first screens are unaffected.**
- **It expires.** The API says "hiring now" for a company whose open roles a page confirmed in the last 14 days, counted from when it is asked. A file keeps what it said when it was made, so the site ignores a snapshot older than 14 days (`MAX_AGE_DAYS` in `src/snapshot.js`) and behaves as it did before.
- **Remake it whenever the data changes and before every site deploy** (see `before-you-deploy.md`). A data change on Render does not touch it.
- `tests/snapshot.test.js` fails if the file lacks an answer to a first-view question, holds an extra one, or is not readable; `tests/bundle.test.js` fails if the first paint again depends on another site, if Leaflet or Supercluster reach a page without a map, or if the entry grows past 200 KB.

## The cheapest fix for the cold start itself

The snapshot hides Render's sleep from the first screens, but a visitor who filters, searches or opens a company still waits 14 to 22 s if the instance is asleep. The cheapest fix is to keep it awake: an uptime monitor that requests `https://atlas-startup.onrender.com/api/health` every 10 minutes (UptimeRobot and cron-job.org have free plans), or Render's Starter plan (about US$7 a month), which does not sleep. Neither is set up; both need your account.

## Numbers

Lighthouse 12.6, a production build served by `vite preview`, medians of 3 runs, mobile = Lighthouse's default slow-4G and 4× CPU. "Controlled" runs use the API on this laptop so that the runs measure the page and not this network (which stalled first connections to Render, Google Fonts, cdnjs and the map tiles for 5 to 25 s at random during the day).

| Page | | Score | First paint | Largest paint | Blocking time | Layout shift | JS (gz) | Requests | Other sites asked |
|---|---|---|---|---|---|---|---|---|---|
| `/welcome` mobile | before | 80 | 2.30 s | 3.29 s | 0 | 0.000 | 69 KB | 31 | 9 |
| | after | 95 | 1.64 s | 2.89 s | 0 | 0.000 | 71 KB | 31 | 6 |
| `/` (map) mobile | before | 71 | 1.95 s | 4.71 s | 92 ms | 0.045 | 119 KB | 27 | 11 |
| | after | 88 | 1.57 s | 3.71 s | 124 ms | 0.000 | 122 KB | 28 | 8 |
| `/?view=list` mobile | before | 78 | 2.76 s | 3.36 s | 0 | 0.000 | 127 KB | 35 | 14 |
| | after | 96 | 1.48 s | 2.64 s | 0 | 0.000 | 78 KB | 34 | 11 |
| `/welcome` desktop | before | 82 | 0.74 s | 1.01 s | 0 | 0.117 | 69 KB | 31 | 9 |
| | after | 100 | 0.50 s | 0.71 s | 0 | 0.000 | 71 KB | 31 | 6 |
| `/` desktop | before | 72 | 0.60 s | 3.23 s | 0 | 0.047 | 119 KB | 43 | 27 |
| | after | 96 | 0.38 s | 1.37 s | 17 ms | 0.044 | 122 KB | 44 | 24 |
| `/?view=list` desktop | before | 89 | 0.56 s | 0.78 s | 0 | 0.044 | 127 KB | 65 | 44 |
| | after | 100 | 0.39 s | 0.64 s | 0 | 0.000 | 78 KB | 64 | 41 |

The same build against the real Render API (warm), compared with the first baseline of the old build against it (same method, an hour apart, so noisier; the old build's desktop `/welcome` showed 920 ms of blocking time that run; with a local API it was 0, so that came from the network):

| Page | Score before → after | First paint | Largest paint | Blocking time |
|---|---|---|---|---|
| `/welcome` mobile | 81 → 97 | 2.46 → 1.63 s | 2.80 → 2.45 s | 54 → 0 ms |
| `/` mobile | 76 → 88 | 2.60 → 1.61 s | 3.63 → 3.60 s | 0 → 163 ms |
| `/?view=list` mobile | 72 → 98 | 2.28 → 1.60 s | 4.01 → 2.13 s | 140 → 19 ms |
| `/welcome` desktop | 48 → 100 | 1.57 → 0.44 s | 1.91 → 0.59 s | 920 → 0 ms |
| `/` desktop | 70 → 95 | 0.59 → 0.41 s | 3.57 → 1.43 s | 0 → 47 ms |
| `/?view=list` desktop | 74 → 100 | 0.59 → 0.39 s | 0.64 → 0.47 s | 0 → 0 ms |

Run to run on this laptop the landing page's largest paint on a phone-sized, slowed connection is 2.45 to 2.9 s: the 2.5 s target is met on some runs, not reliably. What is left in it is the page's own chain (the page, its eleven small files, its stylesheet) on a simulated 1.6 Mbps connection, and the headline's 0.7 s fade-in (taking the fade out would save about 0.15 s in Lighthouse's estimate; left as designed).

"Other sites asked" is mostly the logos (Google's favicon service, lazy, after the first paint) and the map's tiles. The map's largest paint is an OpenStreetMap tile, which this site does not control.

**Render asleep** (every API reply held 21.6 s, the cold start measured; phone-sized window, no throttling), the moment the content that comes from the API appears:

| Page | before | after |
|---|---|---|
| `/welcome`: figures, hiring cards, the picture's dots | 22.2 s | 0.43 s |
| `/?view=list`: the cards (also its largest paint) | 22.7 s | 0.32 s (0.55 s) |
| `/`: the map's pins | 22.8 s | 0.40 s |

**The real Render, asleep** (idle 17 minutes, the old and new builds loaded at the same moment, so they shared one wake-up): `/?view=list` showed its 48 cards at **14.6 s** before and at **0.61 s** after (its largest paint, the first card's text, at 14.7 s and 0.94 s). The API answered at 14.1 to 14.6 s in both.

## Measuring again

The harness (Lighthouse through `chrome-launcher`, run several times per page and form factor, medians) is not in the repo. To check a change quickly: `npm run build --prefix frontend`, `npx vite preview` in `frontend/`, and Lighthouse on `/welcome`, `/` and `/?view=list` with mobile and desktop settings; look at which requests block rendering (there should be one: the site's own stylesheet) and the JavaScript the landing page downloads (about 70 KB gzipped). The Render side: `curl -w "%{time_connect} %{time_appconnect} %{time_starttransfer}" https://atlas-startup.onrender.com/api/health` after 15 minutes of silence for the cold start, and again straight after for the warm one.
