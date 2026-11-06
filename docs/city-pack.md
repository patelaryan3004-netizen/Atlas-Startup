# City pack: the reference directory's Sydney, Melbourne and Perth lists, and 62 address records

The pack (`backend/scripts/citypack/input/`: the prompt, `research-manifest.json`, three `*-worldtechmap-candidates.json` files and `address-updates-62.json`) is **research, not fact**.
Its source totals are not verified companies, not unique organisations across cities, and not a census: a row in "startups" can be a listed company, a row in "companies" a young one,
and a coordinate in it is the reference's own display point. Nothing here makes a company public until its own pages have been read, and no directory row is treated as a verified office.

Nothing in this change is committed or deployed. The data is in the working tree (`backend/src/data/*.json`, tracked in git: `git checkout -- backend/src/data` undoes it).

## What was done, in order

1. **Staging** (`scripts/citypack/import.mjs stage`). Every one of the 2,534 rows (Sydney 1,463, Melbourne 1,032, Perth 39) is staged as research in `scripts/citypack/staging/<city>.json`,
   with the reference's coordinates kept under `source_coordinates` (audit only) and **canonical coordinates null**. Each row has a candidate organisation type (from the source's category:
   startups, companies, vcs, ecosystem), an `organisation_key` (website domain first, so a company in two cities is one organisation with two location rows), and a reconciliation status
   against the directory (`existing_company`, `existing_candidate`, `new`, `review_ambiguous_name`). A name that only looks alike is never merged: it is `review_ambiguous_name`
   with the record it resembles. Staging is deterministic: running it again changes nothing that did not change in the data (the test stages twice on a copy).
2. **The 62 address records** (`scripts/citypack/addresses.mjs plan|apply`). Each record's notes and address type are read, not just the string:
   - **16 operating addresses** from a company's own page become address evidence (Qsic: the Fitzroy office, not the older Abbotsford one; PolyActiva: Notting Hill; Vinomofo: Port Melbourne;
     CoraMetix: Unit 3/4 Gould Street, Osborne Park; AMLab: the head office as the address, the R&D facility apart; 1receipt: the CBD hub as the address, the service address apart).
   - **6 listed-only** addresses (a directory or partner page, not the company's) are kept as notes, not evidence.
   - **21 postal, registered, partner-listed, historical, incomplete or conflicting** addresses become `company_locations` of kind OTHER with **no coordinates** and a label that says what they are
     (Bellroy's registered office c/- a consulting firm; Agpay, Appbot, Scratch and 1Breadcrumb postal addresses; Mark My Words' incomplete "700 Connect"; Cortical Labs' historical address;
     NextAero, Traild, Zerocap, Bae Juice, Nebula Health, Smileyscope, Tixel: conflicting). Any earlier evidence row that said such an address was where the company works is marked superseded.
   - 19 records have nothing to store (no address was published). Unknown streets stay unknown.
   - The source's consulted dates are carried forward (Melbourne 2 Nov 2026, Perth 5 Nov 2026): the dates a page was read, never "verified today". Re-running adds nothing.
   - LinkedIn is not a source the dataset accepts for a location; where a record's only evidence was LinkedIn it is stored with no URL.
   - Slyp and Edstart carried placeholder addresses ("Interface Lane", "Launch Lane") beside a point on the CBD centre; both pins were removed and the placeholder text cleared. Edstart's own
     privacy page gives a real street address (Surry Hills), which went through the normal geocoder check; Slyp has no address on any page and is city-level.
3. **Verification and publication** (`scripts/places/import.mjs --city sydney|melbourne-pack|perth-pack`, the importer that Perth and Melbourne used). The company's own pages are read
   (robots.txt obeyed, LinkedIn never read) for identity, an address in the Greater city (postcode ranges in `src/geo/metro.js`; Sydney's ranges were added) and any notice that it has closed
   or been acquired. A row is published only when all of these hold; everything else stays in the review queue with the reason. Descriptions are the first sentence of the company's own pages and
   sectors are read by keyword; both are marked `auto` in `judgments.json` and can be overridden by a person. **No funding, stage, hiring or founder fact is added.**
4. **Places.** A published company is city-level until `scripts/locations.js geocode` then `promote` confirm the house from the company's **own** page (the geocoder's suburb, state and Greater-city
   postcode must agree, and the company's pages must all give the same address). The pass over every company with an address pinned 228 of 371; the other 143 stay city-level, each with the
   reason the CLI printed (62 geocoder found only the street, 40 own pages give different addresses, 13 geocoder knows nothing of it, 12 postcode disagrees, 5 own page says another state,
   3 not geocoded). Postal, registered, historical and conflicting addresses are never promoted; the dataset test checks it.

## The counts

Before is git `0e99a3e` (`scripts/citypack/baseline.json`); after is the working tree. "In view" is the city view's directory listings (companies, spaces; the investor list is separate).

| City | In view before → after | Startups / companies / spaces after | Pins before → after (exact + suburb) | City-level after |
|---|---|---|---|---|
| Sydney | 157 → 347 | 311 / 29 / 7 | 77 → 207 (203 + 4) | 138 (+2 with no city) |
| Melbourne | 163 → 384 | 298 / 64 / 22 | 113 → 234 (229 + 5) | 150 |
| Perth | 59 → 67 | 63 / 4 / 0 | 25 → 32 (32 + 0) | 35 |
| **Directory** | **501 → 920** | **startup 794, company 97, space 29** | | |

- **Imported candidates:** all 2,534 source rows are staged. **2,293 unique organisations**, 222 of them in more than one city (one organisation, several location rows).
- **Verified directory listings added:** 419 (Sydney 190, Melbourne 221, Perth 8). The discovery queue now holds 2,433 candidates: 704 published, 1,681 needing review, 34 rejected, 14 merged.
- **Rows for a person:** 60 staged rows are still `review_ambiguous_name` (Sydney 35, Melbourne 20, Perth 5); the other 153 were reviewed (see the review pass below).
- **Duplicates:** 18 organisations are listed twice in the same city (Sydney 6, Melbourne 8, Perth 4); 14 candidate duplicates were merged into the company the directory had; rows that matched an existing
  company by website or name were recorded against it and not added again.
- **Unresolved:** the 21 postal/registered/historical/conflicting address records (above) and the 16 companies whose own pages disagree on the address (review pass below).

## Organisation types

`organisation_type` (startup | company | space; empty means startup) is an added field, so the existing records need no migration. It is a **candidate from the source's category** until a person or a page says
otherwise (`type-decisions.json` holds the decisions people made). Investors are not companies: they stay in the investor directory (`/investors`) and appear on the map as city-level group marks.
The map's chips are All, Startups, Companies, Investors and Spaces (`show=startups|companies|vcs|spaces`).

## The map

- `/map?city=melbourne` and the phone's sheet: the city selector, search by name, sector or suburb, type chips, a collapsible results panel (340-400 px, 320-360 on narrower screens) with counts and compact rows, **Search this area** after the
  map moves (the list never jumps by itself), `selected=<id>` and lower-case `city=` in the address, Map/List switch. Clicking a row ringed its pin and opens the same detail card a pin does.
- Pins are logo tiles (a monogram when there is no logo). Dense areas cluster. A company with no confirmed street address is **not** drawn: it is one "Melbourne, city-level" group mark with its count,
  never at the city centre, and its card says "Exact location not published".
- The card shows the summary, website, sector, the address and its status ("Verified office" only where a company's own page gave it), the pages behind it with the day each was read, and "Suggest a correction".
  The source line says each page once. Source coordinates, the source's pin flag and the reconciliation status are never shown to visitors.
- See [map.md](map.md) for the components and the URL state.

## Review pass (2026-11-05, before any deploy)

A second pass for accuracy rather than volume. Nothing was merged automatically, no address was chosen by guesswork, and no listing was added without its own pages being read.

- **Possible duplicates (213 rows).** Each row whose name resembled a company or candidate was checked against both websites (`duplicate-review.json`): **25 are genuine duplicates** (both domains load the same site after redirects, or a stated
  rename whose old site redirects to the new one), **128 are separate companies** with similar names or a shared government/university site, **60 stay open** (the other record has no website to compare, a site could not be read, or the name
  carries a qualifier such as a parent, an acquirer or a former name). Staging records the first two as `duplicate_confirmed` / `distinct_confirmed`; no company was merged.
- **Address conflicts (45 companies).** `conflicts.mjs` settles only what the pages settle: an address in another city becomes a location of its own; placeholders (`18 Example Street`), two addresses run together and non-Australian fragments are superseded;
  one street written several ways is one address; a legal page (privacy policy, terms) loses to a page that says where the company is, and a contact page beats other company pages only where more pages agree. **23 were settled** (19 then pinned by the
  geocoder; 4 stay city-level), **16 stay open with every address kept**: two sites on one contact page (Brightspace, Cario, CoLabs, Engine House, NEXTDC, PageUp, WebBeds), pages that disagree (FOUNDIT, SunWiz, MOGOPLUS, Launch Pad, MLAI, Varicon),
  two legal-page addresses (Novatti, Tendertrace), and Jaunt Motors ("Level 116" is not a plausible level). The five cross-state cases (Adslot, AlayaCare, Humanetix, Stone & Chalk, Zetifi) have no address in Melbourne on record, so they are city-level
  there (AlayaCare's own page labels its Melbourne address "Adelaide office" and its Brisbane address "Melbourne Office", so none of its labels can be trusted). Six location rows labelled with the wrong city by a page's own layout were relabelled from the address.
- **Sydney leads.** 100 well-known global or listed companies were kept apart and not read (`triage.json`: delete a name to read it). The remaining leads' websites were read; those with a Sydney address or statement on their own pages (96 tier-1 rows, then
  the engine's own reads) gave **52 additions** after 14 more were held by hand (12 global companies with a Sydney office, one very large listed company, one whose page puts it in Fremantle). 23 of the 52 were pinned.
- **Types.** Evidence for what a company is was read from each home page (`classify.mjs scan`, 732 pages): only **10** could be retyped from a startup to a company, because the page says the company itself is ASX-listed or a subsidiary of a listed group
  (Archer Materials, Adveritas, icetana AI, Gentrack, Novatti, ReadyTech, Appen, DroneShield, Memphasys, CampaignAgent). A listing named only as a customer, an investor or a testimonial was not used.
- **Descriptions and sectors.** 219 of the 419 new descriptions (every one with promotional wording, first person, a cut-off sentence or boilerplate) were reworded from the company's own tagline with no new fact, and the sectors that were wrong (a keyword reading:
  "game theory" gave a trading firm the sector Gaming) were corrected. The others are still the company's own first sentence.
- **Privacy and placeholders.** See the cleanup pass below.
- **Wording.** A company known to its city only says "Exact location not published" in the card as well as on the map (the server's wording used to differ).
- **Tests.** The Fastlane test depended on the day it ran (hiring now means a page confirmed the roles within 14 days; Fastlane's were read on 13 Oct): its clock is now fixed. The institutions-pins test waited a fixed 50 ms for a background reload and lost the race under
  load: it now polls.

## Cleanup pass (2026-11-05, owner-authorised: privacy and legacy pins)

**Contact details.** A page's phone number or email address, quoted into a title, a note, a description or a working file, is not a fact about where a company is, and can belong to a person. One list of patterns (`src/models/contact.js`: email, Australian
landline, 1300/1800/13 numbers, mobile, foreign and North American numbers) is now used where page text enters the data, so that none is stored from now on: a page's title, description and site name (`discovery/enrich.js`), a source's title, publisher and note and an
evidence note or description value (`discovery/publish.js`), and the summary, reason and free-text changes of every audit row written from now on (`models/auditTrail.js`). `scripts/citypack/hygiene.mjs` cleans what was already there:
- **Data (15 fields):** 2 source titles, 3 evidence notes, 1 evidence description value, 5 candidate source titles, 2 candidate descriptions, 2 candidate description values (14 phone numbers and 1 mobile). Replaced by `[phone removed]` / `[email removed]`; the source
  URL, the date and the rest of the text stay.
- **Working files (209 strings in 7 files that the commit adds):** the own-pages and proposals files of the three city packs and the classification evidence (one email). The text is kept as a sanitised excerpt; URLs, dates and structure are unchanged.
- **NetNada:** its privacy policy gives a number in Australian mobile format (04…) as the company's contact line. A mobile can belong to a person, so it was treated as personal and removed from the evidence note and the own-pages file.
- **Not touched:** the audit trail is append-only and the store refuses an edit, so the four historical entries of 13 Oct 2026 (a role mailbox or business line quoted from four companies' own pages, already in git history) are exactly as written; a test pins each by hash. Files that
  were committed earlier and are not part of this change (`scripts/enrich/*`, `scripts/melbourne/*`, `scripts/perth/*`, `scripts/investors/research.json`: 7 files, 79 strings) were left alone: cleaning them is a separate change.
- **Guard:** `tests/privacyScan.test.js` fails if any data file (the audit trail and the owner's seed excepted), any city-pack working file, or any company the API serves (all 920 detail answers: sources, notes, titles) contains a contact detail, and checks that the four
  historical entries are the only audit rows that do.

**Legacy pins (26 made city-level).** Of the 121 pins that rested on the original directory record, 95 keep their pin (85 exact, labelled "Office address on file", and 10 suburb-level, including Contactile and Diraq) and 26 are city-level until their address is confirmed
(`legacy-pin-decisions.json`, applied by `legacy-pins.mjs`): 17 where the company's own pages give a different address, 5 where the geocoder disagrees with the point on file, 4 where it knows nothing of the address. The company stays in the directory and in its city view
(its city becomes the city its postcode belongs to); the point, suburb, postcode and `address` are cleared so that no geocoding run can pin it again from that address; the address it had is kept as a location of its own ("not confirmed", no coordinates, not served by the API) and
in the audit row; the company's own pages' addresses stay in the evidence, untouched, for the review that decides whether to pin them. No replacement address was chosen and nothing was geocoded.

**Left open on purpose:** the 16 address conflicts, the 60 name-alike rows, the 72 companies with no city (they are in the national catalogue and in no city view), and the classification of listed companies the pages did not say were listed.

Backend 1,763 tests and frontend 1,427 pass.

### Deployment checklist (not run: nothing is deployed)

1. `cd backend && ./node_modules/.bin/vitest run` (use the project's own vitest: `npx` from the repo root fetches another version and runs the wrong configuration) then `git checkout -- src/data/submissions.json src/data/feedback.json` (the tests append to them); `cd ../frontend && ./node_modules/.bin/vitest run`; `./node_modules/.bin/vite build`.
2. `node scripts/citypack/hygiene.mjs plan` and `... files` (both must report nothing to do), then `npm run snapshot --prefix backend` (writes `frontend/public/data/snapshot.json` and `frontend/prerender-data.json`; remake it after the last data change, the site ignores it after 14 days).
3. Stage without the four things that must stay local, and check:
   ```bash
   git add -A -- . ':(exclude)people_seed.json' ':(exclude)backend/src/data/people_seed.json' ':(exclude).impeccable/config.json' ':(exclude)docs/design-review'
   git diff --cached --name-only | grep -E "people_seed|impeccable|design-review"   # must print nothing
   ```
4. Commit (message written with the Write tool, `git commit -F`), push: Render deploys the API from the push. Wait for it to answer (cold start 14-22 s).
5. `vercel deploy --prod --cwd frontend` (a first "Not authorized" is transient: retry). Then open `/map?city=sydney|melbourne|perth` on the live address and check the counts (Sydney 347, Melbourne 384, Perth 67).
6. After the deploy: `curl` the live `/api/startups?limit=1` and check `count` is 920.

## Resuming

```bash
cd backend
node scripts/citypack/import.mjs plan                 # DRY RUN: the match counts. Writes nothing
node scripts/citypack/import.mjs stage                # refresh the staging after the data changed
node scripts/citypack/import.mjs research             # the research files the places importer reads (rows not yet in the directory, street-address rows first)
node scripts/places/import.mjs ownpages --city sydney --only <id>   # read a row's own pages (every step as in docs/melbourne-import.md)
node scripts/places/import.mjs propose|autojudge|apply|tidy|update --city sydney --by "name"
node scripts/citypack/import.mjs types                # apply type-decisions.json
node scripts/locations.js geocode --company <id> --apply; node scripts/locations.js promote --company <id> --apply --by "name"
node scripts/citypack/import.mjs report               # before and after counts
```

**Never write data while an engine pass runs.** The discovery engine takes 200 leads a pass (about 18 minutes) and holds the data lock for all of it; the research files must keep the rows already made candidates
(`research` merges them). A deploy order is Render (API), then `vercel deploy --prod --cwd frontend` after `npm run snapshot --prefix backend`; leave `people_seed.json`, `.impeccable/config.json` and
`docs/design-review/` out of the commit.

## Limits to know

- Auto descriptions are the first sentence of the company's own pages, trimmed; sectors are read by keyword. Both are marked `auto` and are the first thing to improve by hand.
- The type is the directory's candidate; 85 companies and 27 spaces were published on that basis plus their own pages. Mature, listed or acquired businesses under "startups" are not yet separated out.
- Sydney: the city-only startups among the staged rows (about 150) have not had their own pages read for an address; they are staged, not published. 100 global or listed companies are kept apart on purpose (`triage.json`).
- Hiring, funding, stage, founders and employee counts are absent unless a page backs them; no "hiring now" badge was copied.
- A fix was needed for two email addresses that a page's markup gave as a legal name (they had become an alias and a source's publisher in the public repository's data): legal names can no longer contain an address,
  and the two rows were cleaned. Two wrongly parsed suburbs ("WeWork", "Macquarie Park Sydney") were corrected.
- The map's basemap is OpenStreetMap; its attribution stays above every overlay.
