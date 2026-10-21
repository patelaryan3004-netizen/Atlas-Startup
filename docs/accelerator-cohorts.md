# Accelerator cohorts

A company can say it went through an accelerator's intake ("Startmate · Winter 2026"). This is how the directory holds that, shows it, lets a visitor filter by it, and how the first cohort (Startmate Winter 2026, 16 companies) was added.

The rule it follows is the rest of the directory's: **say only what a public page backs.** A cohort is membership of a programme and nothing more. It does not say the company raised money, what stage it is at, that it is hiring, or that it has anything to do with this site.

## What is kept

- `backend/src/models/cohorts.js` is the registry: an id (`startmate-w26`), the accelerator, the intake as its organiser writes it (`Winter 2026`), the one-line label a visitor reads (`Startmate · Winter 2026`) and aliases that are searchable but never shown as a second name (`W26`, `Winter 26`). A new intake is one entry there.
- On a company, `cohorts` is a list of those ids. It is an optional fact like `tech_stack` (`company.js`, `FACT_FIELDS`): a record has the key once a page has said so, and the public API serves it **only where an active evidence row from a public page backs it** (`catalog.js`, `backedFacts`). A cohort no page backs, or only a low-confidence lead supports, is not served.
- The evidence row is `field: "cohorts"`, one row per intake, `value` the id, from a source of kind `accelerator_profile` (Startmate's own pages), `high` confidence with the day the page was read. The dataset checks refuse an id the registry does not know, on the record and in the evidence.
- The API gives each company `cohorts` (the ids) and `programs` (each with its label, the accelerator, the intake, the aliases, and the address of the page that says so with the day it was read). The company page also lists the page under "Where this comes from". The CSV export has `accelerator_cohorts`, `accelerator_cohort_source_url` and `accelerator_cohort_verified_at`.

## Finding the companies

- Filter: `?cohort=startmate-w26` on the startups list, markers, summary, count and CSV (several ids may be given, comma separated). The filter options are `GET /api/startups/meta` → `cohorts: [{ id, label, accelerator, cohort, count }]`, and only cohorts some company is in appear.
- Search: a search for `startmate`, `W26`, `winter 2026` or `Startmate Winter 2026` finds the companies, and the search box suggests the cohort ("Accelerators") and applies the filter when picked.
- The site: Filters → Accelerator → Cohort; a chip ("Startmate · Winter 2026") over the map and the list; a quick-filter button above the list; the cohort and its Startmate page on a company's panel and page; a badge on a company's card.
- Where the answer is kept per question (`catalog/respond.js`), `cohort` is one of the parameters it knows, or a filtered answer would be served for the unfiltered question.

## The Startmate Winter 2026 import

Source: Startmate's announcement (`https://www.startmate.com/writing/meet-our-winter-26-accelerator-cohort`), cross-checked against each company's profile page and the portfolio page (16 W26 Accelerator companies on both), all read on 2026-10-21 (robots.txt allows it). Each company's own website was read the same day with the project's polite fetcher (`startmate_w26_scan.py`: robots.txt first, one request per host every 2 seconds, nothing from LinkedIn, Crunchbase or any search page).

Files in `backend/scripts/enrich/`:

| File | What it is |
|---|---|
| `startmate_w26_startmate.json` | what Startmate's pages say, parsed from the raw HTML (the one-liner, tags, website, founders, location) |
| `startmate_w26_scan.json` | what each company's own pages say (places, legal entities, ABN/ACN, founders on its pages, icons, redirects) |
| `startmate_w26_judgements.json` | the decisions: description wording (our own words), sector (mapped to the directory's existing ones), who is a founder, where each is placed, and what to flag |
| `startmate_w26_import.mjs` | applies them through the discovery pipeline (candidates, a named person approves, then publish) |

```bash
node scripts/enrich/startmate_w26_import.mjs plan --data <dir>                  # what each resembles in the directory today; nothing is written
node scripts/enrich/startmate_w26_import.mjs all --by "name" --data <dir>      # run, enrich, publish
```

It is safe to run again: a run that finds everything in place writes nothing. Matching is by website domain and name (the discovery engine's own resolver, which also uses the aliases and ABN/ACN on record); a company already here is enriched and never added twice (`Forward` was). An address a company has moved from (`cocothecreator.com`, `glowback.tech`) is kept as a `domain` identifier, so a later import of the old address finds the company.

What was decided, and what a person should look at (also in the notes of each candidate in the Command Center):

- **Added (14):** Ansight, Antares Aerospace, BrandViz.AI, Clausifai, Coco, Derive, Develpr, EstiMate, GlowBack, Hyperlocalise, SecurityBreak, Sunburnt Space Co, Quarter, Veltora. Names follow each company's own site (`Develpr`, `GlowBack`). Websites are the addresses the sites answer at today. Stage, funding and hiring are left empty: a cohort does not establish them.
- **Updated (1):** Forward, which was already here: given the cohort and its evidence only. Its place, sector, description and hiring answer are untouched.
- **Not on the Australian map:** Forward stays "location unknown" (Startmate says San Francisco; its own footer lists Sydney and its entity is Australian, but no street address or Australian office page is given, so a person must confirm one). Orva (Christchurch, New Zealand, and India) is held as a candidate waiting for review, not in the directory.
- **Places:** a street address is an exact pin only once the geocoder finds the house: SecurityBreak (2/290 Boundary Street, Spring Hill) is. Sunburnt Space Co's own page gives an office at Unit 12, 7-9 Rhodes Street, West Ryde; the geocoder found only the street, so it stays at its city until a person settles it. Every other company is at its city, drawn as a dashed group, never as a pin and never as an office. Where only Startmate names the city (Ansight, BrandViz.AI, Clausifai, Coco, Derive, Veltora) the source of the place says so. Quarter is on the map at Melbourne (its Australian entity and Australia site) and has Wellington, New Zealand as a second office that is stored and not drawn.
- **Founders in question:** Hyperlocalise (Michael Levot is on Startmate's profile only), Sunburnt Space Co (the third founder is "Sam Cain" in the announcement and "Samuel Cain-Copnall" on the profile). Neither is on the record; each claim is kept as low-confidence evidence that appears in the Command Center's suggested fills.
- **Logos:** the existing picture service (a favicon by domain) supplies them, with the initial where there is none. Antares Aerospace and Sunburnt Space Co have none (their own icons are white on transparent), so they show their initial. The service answers an unknown site with a 16-pixel grey globe that a browser draws as if it were a logo; the site now treats any picture narrower than 24 pixels as "no logo" (`frontend/src/logo.js`).

## Adding another cohort

1. Add its entry to `COHORTS` in `backend/src/models/cohorts.js`.
2. Read the accelerator's own pages, and put each company's membership in as evidence (`field: "cohorts"`, an `accelerator_profile` source, `high` only with the day the page was read). Copy the import's pattern for the rest: match against what is here first, read the company's own site, write nothing a page does not state.
3. Add the intake's test data where `backend/tests/cohorts.test.js` pins the first one.
