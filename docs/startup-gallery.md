# The startup gallery (`/discover`)

Discover's startups are a gallery: a grid of each company's own picture with its name, one line about it, and "Sector · City · Stage" under it. It is the **map's other view**: the map
(`/map`, the Startup atlas) and the gallery share one set of filters, so what is chosen on one is what the other shows.

Built on `feature/startup-gallery`. Not deployed.

## What a visitor gets

- **Gallery** (`src/components/gallery/`, `src/components/ListView.jsx`): three across on a wide screen, two on a tablet, one on a phone. 16:9 pictures, a very light border, rounded
  corners, and a small zoom of the picture on hover or keyboard focus (none for a visitor who asked for less motion). Each card is one real link to `/startup/<slug>`: Tab reaches it,
  Enter opens it over the gallery, a click with Ctrl or Cmd opens a new tab.
- **Bar above it**: search (name or keyword, with the existing suggestions), City, Industry, Stage, the kind of organisation, **Filters** (the existing slide-out panel, a bottom sheet on
  a phone: it holds every other filter), and **Clear filters**. Each sets the same filter the map sets (`search`, `city`, `sector`, `stage`...), and a change shows at once. On a phone only the
  search and the one Filters button are drawn.
- **Map | Gallery** switch in the gallery's head, and a **Gallery** link on the map page (its panel on a wide screen, the pulled-up sheet on a phone). The phone's bottom bar (Discover /
  Map) does the same.
- **Order**: "Pictures first" (the companies that have a cover, then the rest, each in name order) is how the gallery opens; Name, Stage, Recently verified, Hiring first, Location and Industry
  are there as before. A **Grid | Table** switch keeps the old table, and Export CSV is unchanged (it exports in name order unless another sort was chosen).
- The quick chips that switch (Hiring, Seed to Series A, Events this week, a cohort such as Startmate) stay under the bar; a chip for a filter the bar already shows (search, city, industry, stage)
  is not drawn twice.

## The journey: Map → Melbourne → Fintech → Gallery → company → back → Map

Checked in headless Edge at 1440 px (`scratchpad/journey.mjs`, not in the repo) and by tests:

1. `/map`, click the Melbourne badge → `/map?city=Melbourne` (392 organisations).
2. Sector: Fintech → `/map?sector=Fintech&city=Melbourne` (26 organisations, 19 pins).
3. Gallery → `/discover?sector=Fintech&city=Melbourne`: 26 startups, all Melbourne, the City and Industry menus say Melbourne and Fintech.
4. Scroll down, open a company → `/startup/<slug>?sector=Fintech&city=Melbourne` over the gallery. Back (or Escape) closes it at the same scroll position, with the filters on.
5. Map → `/map?sector=Fintech&city=Melbourne`: the same 26, flown to Melbourne.
6. Gallery again → the same place in the gallery (the page it was left on, the same number of cards, the same scroll): `src/gallery.js` keeps that in the tab's sessionStorage for fifteen minutes, for
   the same filters and sort only.

What is **not** kept: a pan or zoom the visitor did by hand on the map. The map comes back to what the filters say (a city's view, or Australia).

## Pictures

The dataset had no cover pictures and no logos. Each company's cover is **the preview picture its own website names for itself** (`og:image`, `twitter:image`, `image_src`), read once by
`backend/scripts/covers/collect.mjs` through the project's compliant fetcher (`robots.txt` obeyed on the page *and* on the host the picture is on, the honest `AUStartupMapBot` user agent, pacing,
nothing behind a login, no access control worked around), cut to 16:9 (720 × 405) and **kept as a WebP file in `frontend/public/img/covers/<id>.webp`**: the page never depends on another
site's picture URL.

Never kept: a page that says `noimageindex`; a picture under 600 × 300 or not roughly landscape (a logo or an icon); a picture two or more companies share (a template's default image says
nothing about any one of them). Nothing is drawn, generated or guessed.

On the company record: `cover` (the local path; public, on the card), `cover_source_url` and `cover_retrieved_at` (internal: where and when it was read). `scripts/covers/cover-results.json` has the
outcome for every company.

**A company without a cover** is drawn with its real logo (the favicon service, as everywhere on the site) on one quiet neutral tile, or its first letter until the logo arrives. It is still in
the gallery, in every filter and on the map.

### Where the pictures stand (16 Nov 2026)

920 companies: **303 have a cover** (Melbourne 127 of 381, Sydney 109 of 342, Perth 20 of 67, Brisbane 7 of 22, Adelaide 3 of 6); **617 do not**, and show their logo:

| Why | Companies |
|---|---|
| Its site, or the server holding its preview picture, would not answer a `robots.txt` request (the fetcher leaves the picture alone) | 228 |
| The page names no preview picture | 200 |
| The preview picture is not landscape (a logo or an icon) | 64 |
| The preview picture is under 600 × 300 | 40 |
| No website on file | 38 |
| The preview picture is a format that is not read (svg, gif...) | 18 |
| Its website did not resolve, is access-controlled, answered an error, or timed out | 22 |
| The picture is over the size limit | 6 |
| `robots.txt` does not allow it | 1 |

The full list, with each reason, is `docs/gallery-missing-covers.csv`. The 228 are the biggest group: a re-run later may reach some of them (`collect --retry`), and the owner could decide
whether a preview picture a site publishes for link cards may be read from a host whose `robots.txt` cannot be read (today the fetcher fails closed, as for every other fetch).
The rest need a picture from the owner or from the company.

### Taking a picture down

The pictures are other people's work, published by them for link previews, and used here to represent the company on its own listing. If a company asks for its picture to go: add its id to
`backend/scripts/covers/excluded.json`, then `SHARP_FROM=<folder with sharp> node scripts/covers/collect.mjs apply --by "name"`. That clears the three fields and deletes the file; `collect` never
reads that company's site again. (`cover_source_url` says where each one came from.)

### Re-running

```bash
npm i sharp            # in a scratch folder: sharp is not a project dependency
SHARP_FROM=<that folder> node scripts/covers/collect.mjs collect [--only "Name;Name"] [--retry] [--workers 6]
SHARP_FROM=<that folder> node scripts/covers/collect.mjs report
SHARP_FROM=<that folder> node scripts/covers/collect.mjs apply --by "name"
npm run snapshot       # the site's first screen is drawn from public/data/snapshot.json: remake it after the data changes
```

The fetcher gained a `binary` option for this (`src/discovery/http.js`), tested in `tests/fetch.test.js`.

## Code map

| | |
|---|---|
| `frontend/src/components/gallery/` | `GalleryPage` (head + bar + body), `GalleryHead`, `GalleryToolbar`, `GalleryCard`, `Cover` (cover or logo tile), `ViewToggle` |
| `frontend/src/components/ListView.jsx` | the list's data and layouts (gallery, table); uses `hooks/useStartupPages.js` (paging, snapshot-first paint, restore) |
| `frontend/src/gallery.js` | where the gallery was left (sessionStorage, same filters and sort, 15 minutes) |
| `frontend/src/gallery.css` | the look: the atlas's navy header and ivory, the serif heading, the grid |
| `frontend/src/App.jsx` | `galleryPage` (route `explore`, view `list`), `showMap`, the chips the bar does not show |
| `backend/scripts/covers/` | `collect.mjs`, `cover-results.json`, `excluded.json` |
| `backend/src/catalog/catalog.js` | `cover` on the card; the `pictures` sort |

## Left as it was

The older Discover map (`/discover?view=map`, with its Map | Gallery switch in the toolbar) still opens as before, and the investors, people, jobs and the rest are untouched.
The Table keeps every column; the gallery's cards leave out the hiring states other than "Hiring now", the verified note, the event badge and the concept-preview label (they are in the table and on
the company's page). "Hiring now" on a picture appears only for a company a page confirmed lately, and "Unverified" still shows under a name that nobody has verified.
