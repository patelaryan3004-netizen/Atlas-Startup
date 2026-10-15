# The investors page

`/investors` is the public directory of investors: cards or a table of the same results, with a profile that opens beside them.
Only investors that have been **published** appear (see `backend/src/catalog/investors.js`); every fact shown is one the record states, and a
blank is shown as a dash with "Not stated" for screen readers.

## Addresses

| Address | What it shows |
| --- | --- |
| `/investors` | the directory |
| `/investors/<slug>` | the directory with that investor's panel open (a full-screen drawer under 1000px) |
| `/investors/<slug>/profile` | the long, full profile page ("Open full profile") |
| `/investors/people/<slug>` | a person (only while the people switch is on) |
| `/?view=investors&investor=<slug>` | an older address; it still opens the panel |

Opening a panel from the list adds one history step (`state.investors === 'panel'`), so the Close button and the browser's Back button do the
same thing. Closing keeps the list where it was: the card the visitor was looking at stays at the same place on the screen.

## What the visitor can do

- Search, and filter by Stage, Sector and Location (menus of checkboxes with counts), and by Investor type, Leads or follows, Investing and
  Cheque size under **More filters**. Cards and Table are two views of the same results: the search, filters, sort and count are shared and
  survive switching.
- Sort by name (A-Z, Z-A), most connected companies, or location.
- Save an investor with its bookmark; the **Saved** tab lists them. Saved investors live in the visitor's browser (`auStartupSavedInvestors`),
  there are no accounts. The header's "Saved" on this page opens the same list.
- Switch the page between a light theme (default, orange) and a dark one (mint, the map page's); the choice is kept in `auStartupInvestorTheme`.
- "Add investor" is a suggestion form: it sends a `feedback` of type `investor`. **Nothing is listed on a suggestion alone**; publishing is a
  separate step in the Command Center.

## Location filter

An investor is found under both its state and its country, so `location=Australia` lists every Australian investor and `location=NSW` only the
ones in NSW. The menu's counts follow the same rule (an investor counts once under each).

## Office addresses

An investor can state the street address of an office: `office_addresses`, one `"City: street address"` per entry, where the city is its headquarters
city or one of `other_offices`. Like every claim it needs a page that states it and the page's words (the Command Center's edit form asks for both; the
research file `backend/scripts/investors/research.json` takes `["office_addresses", "Melbourne: 15 Dover St, Cremorne VIC 3121", "contact", "<the
words on the page>"]` and `npm run investors -- fetch` then `import --apply` applies it only if those words are on the cached page). A pasted address that
no page of the firm's own states is not entered: it goes in the file's `unconfirmed` list with the reason (Artesian's, for instance).

The page shows the addresses under "Office addresses". `npm run investors -- offices [--geocode] [--only slug,slug]` reports where each address stands and
asks the geocoder for the ones not asked yet; the map draws an office at its address only once that answer is confirmed (see `docs/map.md`).

## API used by the page

`GET /api/investors` (search, type, stage, sector, location, lead, active, chequeMin, chequeMax, **slug**; sort `name | name_desc | portfolio |
location`; pages of 20), `GET /api/investors/meta` (the menus), `GET /api/investors/<slug>`, `GET /api/investor-people/<slug>`, and
`POST /api/feedback`. The `slug` filter (comma-separated) is how the Saved tab asks for exactly the investors a visitor saved. A new query
parameter must also be added to `KNOWN` in `backend/src/catalog/respond.js`, or the response cache ignores it.

## Where the code is

`frontend/src/components/investors/` (`InvestorsView` = page and routing, `InvestorDirectory` = tools, tabs, results, `InvestorCard`,
`InvestorTable`, `InvestorPanel` = the side panel and drawer, `InvestorProfile` = the full page, `SuggestInvestor`), `frontend/src/investors.css`
(everything under `#investorsView`; the light and dark token sets are on `#investorsView[data-theme]`), and the hooks `useSavedInvestors` and
`useInvestorTheme`. The header and filter controls are the map page's (`explore/ExploreHeader`, `explore/CheckMenu`, `explore.css`).
