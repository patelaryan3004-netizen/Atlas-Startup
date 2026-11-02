# Melbourne import: adding Melbourne companies from a research list

The Melbourne research list (`backend/scripts/melbourne/research/melbourne-startups-research-2026-10-31.json`, 342 rows) is **research, not fact**: 45 rows with a reported
Melbourne location, 136 listed in a Melbourne directory, 151 named by a university accelerator or programme, 10 established or acquired businesses. It says so itself: a university
programme, a Victorian investor or an event appearance does not prove a Melbourne office. This import checks every row against the directory and against the company's **own
pages** before anything is published, keeps what cannot be checked in a review queue with what is missing, and never lets a list, a programme or a fund stand in for an office.

It runs on the same importer as [Perth](perth-import.md) (`backend/scripts/places/import.mjs`, one importer for every city; `--city melbourne`), which sits on the
[discovery engine](discovery.md) (robots.txt obeyed, LinkedIn and paid databases never read, nothing public until a person approves it).

## The steps

```bash
cd backend
node scripts/places/import.mjs hubs     --city melbourne                  # read the pages the research cites, once
node scripts/places/import.mjs sites    --city melbourne                  # likely domains for rows with no website (DNS, then a homepage that names the company)
node scripts/places/import.mjs plan     --city melbourne                  # DRY RUN: additions, updates, duplicates, review items. Writes nothing
node scripts/places/import.mjs run      --city melbourne --by "name"      # candidates; each company's OWN website is read (run it again until it reports no new rows)
node scripts/places/import.mjs reread   --city melbourne --by "name"      # read again the sites that failed on the network
node scripts/places/import.mjs ownpages --city melbourne [--retry]        # scan each row's own pages for an address in Greater Melbourne or a "based in Melbourne" statement
node scripts/places/import.mjs propose  --city melbourne                  # classify every row: proposals.json
node scripts/places/import.mjs apply    --city melbourne --by "name"      # publish what the rules clear and judgments.json accepts
node scripts/places/import.mjs tidy     --city melbourne --by "name"      # address evidence = the street address, not the page's wording
node scripts/places/import.mjs update   --city melbourne --by "name"      # companies the directory already has: a website, an address as evidence, a second office
node scripts/places/import.mjs fixes    --city melbourne --by "name"      # a person's corrections (fixes.json): a wrong evidence row, a second office
node scripts/places/import.mjs report   --city melbourne                  # the counts
npm run locations -- geocode --company <id> --apply                       # then for each company: ask the geocoder about its own address
npm run locations -- promote --company <id> --apply --by "name"           # a pin only where the geocoder confirms the house
```

**Dry run and rollback.** `plan` writes nothing, and every step accepts `--data <dir>` to work on a copy of `backend/src/data` (copy the folder, run the step against it, read
the result, then run it for real). Every step that writes validates the whole dataset first and writes nothing if a check fails, and every step can be run again without making a
company twice. The data files are tracked in git, so a run is undone with `git checkout -- backend/src/data` (before the commit) or `git revert` (after it); every change is also
in the audit trail (`audit_trail.json`) with the name given in `--by`.

## What a row has to be to be published

All of these hold (`classify` in `import.mjs`), otherwise it stays in the review queue with the reason, or is excluded:

1. **Identity.** Nothing in the directory resembles it (website domain, then name, then aliases). A site found only by its domain is accepted only when its words meet the words the
   list used about the company (or a person has confirmed it), and the engine must not say the site is another company. A row that is the same company as one already in the
   directory (a name or a website written differently) is recorded as that company, by a person (`same_as`), not added.
2. **Operating.** Its own site was read and does not say the business has closed, been wound up, been acquired or is now part of another. (Insolvency wording in terms of service is not a notice of closure.)
3. **Presence in Greater Melbourne.** Its own pages write an address in Victoria with a postcode in the Greater Melbourne ranges (`src/geo/metro.js`: 3000-3207, 3335-3338, 3427-3429,
   3750-3763, 3765-3811, 3910-3920, 3975-3978), or say it is based in Melbourne. Geelong, Ballarat, Kilmore, Avenel and the rest of regional Victoria are **excluded as regional**; an address in another state is a place elsewhere.
   A PO box, a mailing address, a registered address or a service area is not an operating site: such a row is held, or listed in the city with **no pin** (`no_pin`).
   Where its own pages give its head office elsewhere and Melbourne as an office, a person decides how it is listed (a global headquarters is not a local one).
4. **Description.** A person has written its sector and a one-line description from what its own pages say (`judgments.json`), or has held it with the reason.
5. It is not in the research's `established_or_acquired` group: those are kept apart from the early-stage startups.

What is stored for a published company: its website, a short description, its sector, the page that states its address with the day it was read, and the lists that name it. Its place is
the city, approximate, until `geocode` and `promote` confirm the house. **No stage, funding or founder fact is added.** Logos come from the existing domain-based logo integration (`logo.js`)
keyed by the verified website's domain, with the initials fallback when none loads. A company that shares a building with others shares one point: the map clusters them and opens them from the cluster.

`judgments.json` is where a person records what they read (`sector`, `blurb`, `confirm_site`, `confirm_identity`, `same_as`, `distinct_from`, `no_pin`, `presence`, `hold`, `exclude`); `fixes.json` records corrections.

## Result (first run, 2026-11-02)

| | |
|---|---|
| Research rows | 342 (every one has an outcome: published, an existing record, kept apart, excluded, or in the review queue with its reason) |
| Melbourne view before | 86 companies (80 with the city Melbourne, 6 more found by postcode), 60 with a pin |
| New companies published | **77** (42 from the directory list, 24 from programme leads, 11 from the location-evidence group) |
| Existing records updated | 57 rows are companies the directory already has. 10 company records changed (8 moved from city-level to an exact pin, 2 gained a source), 8 were given the website they lacked, 12 were enriched from a duplicate candidate (unknown fields only), 1 was given a second office (CoinJar); 4 addresses that differ from the one on record are listed for a person, not changed |
| Duplicates merged | 12 duplicate candidate records merged into the existing company, and 57 rows recognised as companies the directory already has and not added again (13 of them by a person: the same company with a name or website written differently). No domain or name is in the directory twice |
| Awaiting verification | 193 rows, each with what is missing |
| Established or acquired, kept apart | 10 |
| Excluded | 5: MOGLabs, See-Mode and Graceview (acquired); Mobble (Avenel) and Infestation Tracking Systems (Kilmore): regional Victoria |
| **Melbourne view now** | **163 companies** (157 with the city Melbourne) |
| **Precise map pins** | **113** (107 of them in the 157): the other 50 are shown as one "Melbourne, city-level" group, never scattered and never on the CBD centre |

The review queue, by what is missing: 84 whose own pages say nothing about Melbourne, 46 whose own website could not be read (a dead domain, robots.txt, an error), 26 with no description, 17 with no official
website identified, 12 whose site was found only by its domain and does not match the list, 5 whose website does not appear to be the company; 29 are held by a person with the reason (a PO box only, a retailer, a rename not confirmed, a head office in another state).

Where the geocoder found the street but not the house (HungryHungry, Nebula Health, PolyActiva, Misti, Traild), knew nothing of the address (Bellroy, Nutromics, O3) or the company's pages give two different addresses
(1Breadcrumb, 1receipt, Brunswick Aces, Vinomofo), the company stays city-level and the CLI says why. Companies with a second office have it as a location of its own (LAB Group, Prophet: Sydney; CoinJar: Melbourne).

## Limits to know

- A cited page that cannot be read (a PDF, a 404, a robots refusal, a 403) is recorded in `hub-facts.json` and the row is checked on its other pages. In the first run, 5 of 40 cited pages could not be read.
- A LinkedIn page is never read (4 rows cite one).
- "Operating" means the company's own site answers and does not say it has stopped; it is not an audit of trading.
- A company's second location in Melbourne (an office of a company based in another city) is stored, but the Melbourne view lists a company under its own record's city.
- The postcode ranges are the Greater Melbourne built-up area and its outer growth areas and hills; a company in the Mornington Peninsula (3926-3944), Bacchus Marsh or Wallan beyond 3756 is treated as regional until the ranges are widened on purpose.
