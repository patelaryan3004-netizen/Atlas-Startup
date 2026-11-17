# The curated map (17 Nov 2026)

The map shows only the companies the owner's curated list says to show (early and growth stage Australian startups). The list is `Still-Early-startups-curated.xlsx` (Startup, Current,
Recommended, Change, Stage, Note); it is kept in the repo as `backend/scripts/curation/curated-list.json`, and `backend/scripts/curation/apply-curated.mjs` applies it.

## Where the data lives

`backend/src/data/startups.json`: 920 company records in the JSON store (the site reads it through `backend/src/catalog/catalog.js`; `frontend/public/data/snapshot.json` is a generated copy
of the first screens, remade with `npm run snapshot --prefix backend`).

## What the list changed on each company (three new fields, nothing else)

| Field | Meaning | From the sheet |
|---|---|---|
| `show_on_map` | `true`: drawn on the map; `false`: left off it, but still in the directory, the list, the gallery and the search; `null`: never curated, which is shown | Recommended: Pin / Not pin |
| `maturity` | Early, Growth, Late-stage / mature, Listed, Global corp, Community / coworking, Collapsed, Unverified, or null | Stage (blank in the sheet: null) |
| `maturity_check` | `true` where the list could not say; the company stays on the map for now | Change = Check (Stage = Unverified) |

**The funding `stage` (Seed, Series A, Unknown...) is a different field and is untouched.** The sheet's Stage is how far along a company is, so it is `maturity`; putting it in `stage` would have
overwritten real funding data. Nothing else on a company changed: not its place, address, description, sector or website (a check against the backup of the data before the change: 0 other differences).

Rows are matched to companies by name (exact first, then with case, punctuation, ".ai", legal suffixes and "(formerly X)" taken out). **All 920 rows matched exactly; no row is unmatched and no
company is missing from the sheet.** `apply-curated.mjs plan` shows this without writing; `apply --by "name"` writes it with one audit entry, and refuses to write if a row is unmatched or ambiguous.

## What the map draws now

| | Companies |
|---|---|
| In the directory | 920 |
| Shown on the map (Recommended = Pin) | 426 |
| Left off the map (Recommended = Not pin) | 494 (none deleted) |
| Drawn as a pin | 362 (was 533: 171 were unpinned by the list, none was newly pinned) |
| Shown, in a city or state group only (no point location) | 54 |
| Shown, with nothing to draw (no usable place on file) | 10 |

By maturity: Early 344, Growth 58, Unverified 24 (all shown); Late-stage / mature 91, Global corp 34, Listed 26, Community / coworking 19, Collapsed 1 (all left off); 323 have no stage in the
sheet (left off).

**The 64 "Add pin" rows cannot be drawn as pins**: 53 have only a city on file, 1 only a state, 10 no verified location. Making them pins needs an address, which the brief said not to change.
They are shown on the map as far as the data allows (a city group, and in the panel's rows and counts). The list, with what each needs, is `docs/curated-map-pins-needing-addresses.csv`.

**The 24 flagged** (`maturity_check`) are `docs/curated-map-check.csv`; to find them in the data, `maturity_check` is `true` (and `maturity` is "Unverified").

What "left off the map" means in code: no pin, no city group, and no place in the map page's counts or the rows beside its map (the map page asks the API for `onMap=yes`). The gallery, the list
at `/discover`, the company's own page and the search still have every company. (The Command Center's "on the map" figure counts by location only and does not know about the list yet.)

## The Early / Growth filter

A filter `maturity` (one or several values) on the API (`/api/startups`, `/markers`, `/summary`...), `meta.maturities` for its options (only the maturities of companies on the map, with counts),
and in the app: **Early / Growth buttons under the map page's search** (`?maturity=Early`, `?maturity=Early,Growth`), a section "Early or growth" in the filter panel (the phone's sheet too), and a
chip when it is on. The map page's existing Stage menu is the funding stage and is unchanged. Early shows 344 organisations (285 with a pin), Growth 58 (53), both 402 (338).

## The five companies that did not show up in the map's search

Tested in the real map page and through the catalog.

| Company | What was wrong | Now |
|---|---|---|
| OwnHome, Hyperlocalise, Sunburnt Space Co, Harrison.ai | They were found by name (in the panel's rows and counts), but **have only a city on file, no coordinates**, so the map has nothing to draw for them: a company known only to its city is a group, never a pin | Same, and now shown on the map by the list; a pin needs an address (above) |
| Cake Equity | Nothing wrong that could be reproduced: it has an exact address, a pin and a Gold Coast badge, and the search finds it | Unchanged |
| "Own Home" for OwnHome, "harrison ai" for Harrison.ai, "CakeEquity" for Cake Equity | **A name mismatch**: the search matched the typed text against the name as written, so a space or a dot that differs found nothing (0 results) | A search is also matched against the name with everything but letters and digits taken out, for five characters or more (not shorter, so a short word cannot match across two names). The suggestions do the same |

A bug found on the way and fixed: the API's kept answers are keyed by the parameters it knows (`catalog/respond.js` `KNOWN`); the new `maturity` and `onMap` were missing, so a filtered question
was answered with the unfiltered one. Tested (`tests/catalogLocations.test.js`, `tests/curated.test.js`).

## Tests and files

Backend `tests/curated.test.js` (the data matches the list, the unverified are flagged and kept, what the map draws, the filters, the search, the API's kept answers) and the updated pinned
field lists; frontend `tests/curatedMap.test.jsx` (the buttons, the panel's section, the chips and addresses) and the updated App tests (the map page asks for `onMap=yes`).
