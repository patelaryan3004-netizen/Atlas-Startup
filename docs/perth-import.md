# Perth import: adding Perth companies from a research list

The Perth research list (`backend/scripts/perth/research/perth-startups-research-2026-10-31.json`, 210 rows) is **research, not fact**: a mix of companies whose own pages
report a Perth location, directory listings, accelerator and award lists, investor portfolios and established businesses. This importer checks every row before it can
be published, keeps what cannot be checked in a review queue with what is missing, and never lets a list, an award or a fund stand in for a Perth office.

The importer is shared by every city (`backend/scripts/places/import.mjs`, `--city perth`; `node scripts/perth/import.mjs <step>` still works): see [Melbourne](melbourne-import.md) for the second city. It sits on the [discovery engine](discovery.md) (robots.txt obeyed, LinkedIn and paid databases never read, a refusal is not worked around, nothing is public until a person
approves it) and reuses the [portfolio importer](portfolio-import.md)'s rules: a company already in the directory is never added twice (website domain, then name), a company
is placed at its **city only** (approximate) until its own page gives a street address that the geocoder confirms, and no stage or funding fact is filled in.

## The steps

```bash
cd backend
node scripts/places/import.mjs hubs --city perth                       # read the pages the research cites, once
node scripts/places/import.mjs sites --city perth                      # likely domains for rows with no website (DNS, then a homepage that names the company)
node scripts/places/import.mjs plan --city perth                       # DRY RUN: proposed additions, updates, duplicates, review items. Writes nothing
node scripts/places/import.mjs run --city perth     --by "name"        # candidates; each company's OWN website is read
node scripts/places/import.mjs reread --city perth  --by "name"        # read again the sites that could not be read
node scripts/places/import.mjs ownpages --city perth [--retry]         # read each row's OWN site (4 pages) for an address in Greater Perth or a "based in Perth" statement: own-pages.json
                                                         #   --retry reads again a site whose read failed on the network (a DNS blip, a timeout); a site that answered is not read again
node scripts/places/import.mjs propose --city perth                    # classify every row: proposals.json
node scripts/places/import.mjs apply --city perth   --by "name"        # publish what the rules clear and judgments.json accepts
node scripts/places/import.mjs tidy --city perth    --by "name"        # make each published company's address evidence the street address and not the page's wording around it
node scripts/places/import.mjs fixes --city perth   --by "name"        # a person's corrections from fixes.json (a wrong evidence row, a second office or facility as a location of its own)
node scripts/places/import.mjs report --city perth                     # the counts
npm run locations -- geocode --company <id> --apply      # then, for each new company: ask the geocoder about its own address
npm run locations -- promote --company <id> --apply      # and give it a pin only where the geocoder confirms the house
```

`judgments.json` is where a person records what they read: a sector and a one-line description (`sector`, `blurb`); `confirm_site` (a site found only by its domain is the company:
`confirm_note` says why); `website` (the right site, when the research's is wrong); `distinct_from` (a candidate with a similar name is a different company); `hold` (stays in
the review queue, with the reason); `exclude` (not added, with the reason). `fixes.json` records corrections after reading a company's own pages. Both are read on every run.

`--data <dir>` works on a copy of the data files for any step. Every step that writes validates the whole dataset first and writes nothing if a check fails; every step can be
run again and changes nothing that is done (a row the engine saw before is attached, not made twice; a published company is never published again).

## What a row has to be to be published

All of these hold (`classify` in `import.mjs`), otherwise it stays in the review queue with the reason, or is excluded:

1. **Identity.** Nothing in the directory resembles it (website domain, then name, then aliases: "Previously X / Y" and a name in brackets are read as aliases). Its website is the
   research's own, a link next to its name on a list, or a domain found by its name: **a domain found only by its name is accepted only when the words of its own pages meet the
   words the list used about the company** (a name alone is not an identity), and the engine's own check must not say the site is another company.
2. **Operating.** Its own site was read, and does not say the business has closed, been wound up, been acquired or is now part of another.
3. **Presence in Greater Perth.** Its **own pages** (read by the engine, or a page the research cites that is on the company's own domain) write an address in Western Australia with a
   postcode inside the Perth range (6000 to 6199, `src/geo/metro.js`). A WA investor, accelerator, award or directory does not count. An address in a regional WA town
   is **excluded as regional**, one in another state is excluded, and a row with no address at all waits.
4. **Description.** A person has written its sector and a one-line description from what its own pages say (`judgments.json`), or has held it with the reason.
5. It is not in the research's `established_or_listed_tech` group: those are **kept apart** from the early-stage startups (listed, acquired or long established) and are not added.

What is stored for a published company: its website, a short description, its sector, the page that states its address and the day it was read, and the lists that name it
(each a `website` evidence row with the page and the day read; a list is marked as not proof of a Perth office). Its place is the city, **Perth, approximate**, until `geocode` and
`promote` confirm the house. **No stage, funding or founder fact is added.** Logos come from the existing domain-based logo integration (`logo.js`), keyed by the verified
website's domain, with the initials fallback when none loads.

## First run (2026-10-31 to 2026-11-02)

| | |
|---|---|
| Research rows | 210 |
| Perth companies before | 2 (Facet Amtech, HealthEngine) |
| New Perth companies published | 57 (city-level at first; verified on their own pages) |
| Existing records updated | 0 (HealthEngine already complete; On The House is a Brisbane record, a WA fund's portfolio is not a Perth office; Caligra is an unreviewed candidate from another source) |
| Duplicates merged | 0 (no website domain or name is in the directory twice; 3 rows matched an existing record and were left alone, 1 more, Renewable Metals, is held as a likely duplicate of a candidate) |
| In the review queue (awaiting verification) | 140, each with what is missing: no official website identified (60), its own pages give no address or statement placing it in Greater Perth (55), a website found only by its domain whose content does not match (34, overlapping), no description (16), a name that might be another company, others held by a person with the reason |
| Kept apart as established or listed | 9 |
| Excluded | 1 (Snackr: its own page gives Coblinine WA 6317, regional) |
| Perth companies now | 59 |
| Pins (exact, geocoder-confirmed house) | 25; the other 34 are shown as one "Perth, city-level" group, never scattered and never at the CBD centre |

Where the geocoder knew the street but not the house (Biotome, FlyOnE, VeinTech) or knew nothing of the address (Enzide, Hyprfire), the company stays city-level and the CLI says why.
A company with two places (AMLab's R&D facility, Hyprfire's Sydney office, PlanCare's Parramatta office) has the second as a location of its own in `company_locations`, so the record's
address is its Perth one.

## Limits to know

- A cited page that cannot be read (a 403, a robots refusal, a PDF, a site that did not resolve) is recorded in `hub-facts.json` and the row is checked on its other pages; the
  limitation is in the report. In the first run: 4 of the 41 cited pages could not be read (StartupBlink, 403 access-controlled; an Austrade PDF; startupnews.com.au, which did not
  resolve; Terra15's contact page, whose robots.txt is access-controlled), 6 cited LinkedIn pages were skipped on purpose, and Cribber's own domain refuses automated reads, so
  Cribber and Terra15 stay in the queue until a person checks them by hand.
- A LinkedIn page is never read: rows that cite only LinkedIn need another source.
- "Operating" means the company's own site answers and does not say it has stopped; it is not an audit of trading.
- Greater Perth is the 6000 to 6199 postcode range; a company in Mandurah or the Peel region would be excluded as regional until the range is widened on purpose.
