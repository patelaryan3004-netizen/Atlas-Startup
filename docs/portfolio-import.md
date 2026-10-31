# Portfolio import: adding companies from public portfolio pages

A repeatable way to add Australian startups that a venture-capital firm or an accelerator names on its own public portfolio page, without adding one twice and without
publishing anything nobody has checked. It sits on the [discovery engine](discovery.md) and reuses its rules: `robots.txt` is obeyed, LinkedIn and proprietary startup
databases are never read, a refusal (a 403, a login, a disallow) is not worked around, and nothing becomes a company until a person approves it.

Everything is in `backend/scripts/portfolio/`:

| File | What it is |
|---|---|
| `sources.mjs` | the portfolio pages read, and how each lists its companies (one parser per page layout) |
| `scan.mjs` | reads those pages and writes `scans/<source>.json`: each company's name, its own website, the page's description, the page's address and the day it was read |
| `scans/*.json` | what each page said, kept as the record of the read (committed) |
| `import.mjs` | `plan`, `run`, `reread`, `propose`, `publish`, `report`: takes the scans through the engine |
| `places.mjs` | the city an address puts a company in (state + postcode, inside the city's own range; `src/geo/metro.js`) |
| `judgments.json` | a person's decision for each company that may be published: its sector and the line that describes it, or a reason to hold it |

## The steps

```bash
cd backend
node scripts/portfolio/scan.mjs [--source id] [--refresh]       # read the portfolio pages
node scripts/portfolio/import.mjs plan                           # what each scan resembles in the directory: writes nothing
node scripts/portfolio/import.mjs run --by "name"                # candidates, with each company's OWN website read
node scripts/portfolio/import.mjs reread --by "name"             # read again the sites that could not be read (network, a slow page)
node scripts/portfolio/import.mjs propose                        # which candidates clear the rules: proposals.json
node scripts/portfolio/import.mjs publish --by "name" [--data copy]   # approve and publish what judgments.json accepts
node scripts/portfolio/import.mjs report                         # the counts
```

`--data <dir>` works on a copy of the data files for any step. Every step that writes validates the whole dataset first and writes nothing if a check fails; every step can
be run again and changes nothing that is already done (a company a source named before is not made twice; a scan that exists is kept, and `--refresh` writes a new one
only if the listing page was reachable and named companies, so a site that is down never empties an earlier scan).

## Duplicates

Each name is compared with every company and every pending candidate by the engine's resolver: **website domain first, then name**, with city, address and founders only as
corroboration. A domain alone is not proof (a matching website with a different name is a *likely* match to judge: a rebrand? an acquisition?), a name alone is never exact.

- **Exact** (same domain and a compatible name): already ours. Skipped, and counted.
- **Likely or possible**: held for a person with the reason (`might be X`); never added, never silently merged.
- The same company named by several portfolios is one lead with several sources; each page that names it stays on the candidate and, once published, as evidence.

## What may be published

A candidate is published only when **all** of these hold (`problemWith` in `import.mjs`); anything else stays a candidate, with the reason `report` counts:

1. the resolver finds nothing like it in the directory;
2. its **own website was read** and the engine judges it Australian: an Australian street address, an ABN/ACN printed on its pages, an `.au` domain or a Pty Ltd, enough together
   to be *yes*, or *likely* with a place (or on a signal that is itself a registration). Being listed by an Australian firm is not enough: such firms back overseas companies;
3. the engine does not judge it a fund or an ordinary business;
4. a person has written its sector and description in `judgments.json` (the description is a short plain line in our words from what its own page says, never the page's marketing
   copy), or has held it.

What is stored: the company's website (as the portfolio page lists it, and as its own site answers), the investor where the firm invests (**not** for a residency such as Cicada),
and, as evidence, the portfolio page that named it with the day it was read. **Stage and funding are never filled in**: no portfolio page states a company's current stage,
and a company's own site is not a legitimate source for it.

## Where a company is

- A company whose own pages state a street address with an Australian state and postcode is placed in the city that postcode belongs to (one of the ten the map page lists),
  **at city level**: a dashed, labelled group ("city-level", approximate), never a pin.
- A pin needs more: `npm run locations -- geocode --apply` asks the geocoder (OpenStreetMap's Nominatim, one request a second) about each address, and
  `npm run locations -- promote --apply` gives a city-level company the street address its own page states **only once the geocoder agrees**: that is the one way a new company
  gets a pin, and its source is the company's own page.
- No address and no city on its pages: the company is published with its place unknown (listed, not on the map), or not published.

## Adding a source

Add an entry to `sources.mjs` (a listing URL and a parser; `profiles` for a page that links to one page per company, `direct` for a page that carries each company's name and
website), run `scan.mjs --source <id>`, then the steps above. The parser reads only what the page says; whether a company is Australian, new and where it is are decided later, from
the company's own pages.

## Tests

`backend/tests/portfolioImport.test.js` (the parsers, the website choice, the postcode rule) and `backend/tests/metro.test.js` (the city filter finds a suburb's companies).

## The first run (read 31 October 2026, Sydney time)

Nine pages: Blackbird, AirTree, Square Peg, OneVentures, Investible, Folklore, Giant Leap (venture capital) and Startmate, Cicada Innovations (accelerators).

| | |
|---|---|
| companies in the directory before | 266 |
| names the nine pages gave | 570 (529 different companies: 41 are named by more than one page) |
| already in the directory (exact: same domain and name), skipped | 196 |
| possible duplicates (same or near name, another or no website), **not** added, left for a person | 59 |
| made candidates, their own websites read | 430 |
| **published** | **101** (companies in the directory now: 367) |
| held by a person, with the reason in `judgments.json` | 15 (an events business, a services provider, an acquired company, two products under one name, an initiative of a government, nothing to describe it from, one that serves New Zealand) |
| their own pages do not show they are Australian | 245 |
| own website could not be read (robots.txt, a refusal, down) | 8 |
| judged not a startup, or rejected by the engine | 2 |

Where the 101 are: 45 at their city (30 Sydney, 10 Melbourne, 2 Brisbane, one each in Adelaide, Hobart and Canberra: dashed, labelled "city-level", approximate) and 56 with no place on record
(listed, counted as "not on the map"). **None has an exact pin**: the geocoder has to confirm a house before a company gets one (`npm run locations -- geocode`, then `promote`), and none has been run
for these. None has a stage or a funding fact: no portfolio page states one. The investor is recorded only where the firm invests (Investible 22, Startmate 20, Blackbird 15, Folklore 10, Giant Leap 9,
AirTree 8, Square Peg 5); the 15 from Cicada's residency list have none.

What the first run showed: a network failure part-way through left about 190 sites unread (they were read again with `reread`); a company's own page often gives no Australian signal the engine can use
(a page built with scripts, an address only in an image), which is why 245 candidates wait; and a name can belong to two companies (the portfolio page and the site described different products), which is why
a person decides.
