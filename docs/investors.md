# The investors page

`/investors` is the public directory of investors: a compact **list** (or cards) of the same results, with a profile that opens beside them. It
lists **firms** and, once any are published, the **people** who work at them. Only investors that have been **published** appear (see
`backend/src/catalog/investors.js`); every fact shown is one the record states, and a blank is shown as a dash with "Not stated" for screen readers.

The page is headed "Find your next backer." Under it: a search box, the scope switch (Australia | Global), four filter menus (Location, Type,
Sector, Stage) and **More filters**, a few "Start with" lists, the All investors | Saved tabs, a sort, and the List | Cards switch.

## Addresses

| Address | What it shows |
| --- | --- |
| `/investors` | the directory (Australia) |
| `/investors?scope=global` | the directory with everyone listed, in Australia and elsewhere |
| `/investors/<slug>` | the directory with that firm's panel open (a full-screen drawer under 1000px) |
| `/investors/<slug>/profile` | the long, full profile page ("Open full profile") |
| `/investors/people/<slug>` | the directory with that person's panel open (a drawer under 1000px) |
| `/investors/people/<slug>/profile` | that person's own full page |
| `/?view=investors&investor=<slug>` | an older address; it still opens the panel |

`people` is the one word a firm's own address cannot be. Opening a panel from the list adds one history step (`state.investors === 'panel'`), so the
Close button and the browser's Back button do the same thing; looking from one panel to another replaces it, so Back is the directory and not every
investor looked at. Closing keeps the list where it was and gives focus back to the row that opened the panel (unless focus is somewhere else, the search
box for one). "All investors" on a full page comes back to the panel it was opened from.

## What the visitor can do

- Search (one box: names, firms and what they invest in), and filter by Location, Type, Sector and Stage (menus of checkboxes with counts; on a phone one
  **Filters** button opens a sheet with all of them and the number of investors it would show). **More filters** holds the kind of role a person has,
  Leads or follows, Investing and Cheque size, each only when some investor states it.
- Choose **Australia** (the start: investors based in Australia) or **Global** (everyone). The choice is in the address (`?scope=global`) and the count
  says which it is ("18 investors in Australia", "19 investors worldwide"). When nothing in Australia matches, the empty state offers to look worldwide.
- Choose **Everyone | People | Firms**. The choice is only offered once the directory has people as well as firms.
- Start from a "Start with" list. They are drawn from the directory itself (the biggest states, stages and sector among the investors listed), each a
  filter with a count, offered only where the records make a collection (two or more investors, and not everyone). None is a ranking or a pick.
- Sort by name (A-Z, Z-A), most connected companies, or location. No order is a ranking and the page says so.
- List and Cards are two drawings of the same answer: the search, filters, scope, sort, tab and count are one state and survive switching and opening
  and closing a panel.
- Save an investor or a person with the bookmark; the **Saved** tab lists them (people are saved as `people/<slug>`). Saved investors live in the
  visitor's browser (`auStartupSavedInvestors`), there are no accounts, and the page says so. The header's "Saved" on this page opens the same list.
- There is one look, the site's light design (`BRAND_GUIDELINES.md`): off-white page, white surfaces, no theme switch.
- "Add investor" is a suggestion form: it sends a `feedback` of type `investor`. **Nothing is listed on a suggestion alone**; publishing is a
  separate step in the Command Center.

## People in the directory

A person is public only when they are **published** *and* the firm they work at is public (`investor_people.json`, with the team record in
`investor_people_organisations.json`). A person row says their name, role, firm (a link to the firm's own record, which is kept), where they are
listed, and at most two tags of what they invest in. If the record states no focus of their own, the firm's is shown, and the row says whose it is.

- **Role class** (`investment`, `scout`, `talent`, `platform`, `other`) is worked out from the title (`roleClassOf` in `backend/src/investors/people.js`),
  or set by hand with `role_class`. A role that is not an investing one carries a tag, so a scout or a talent partner is never taken for an investor.
  A firm alone does not make anyone an investor: a title is needed.
- **Where** a person is comes from the place the source lists (`geoOfLocation`). Only a city, state or country that is plainly Australian is Australian;
  "SF", "Other", "WA", "SA", a place that is not known and no place at all are all *global*. A person outside Australia is never placed on an Australian
  location, and the map shows firms only (a place a person lists is not an office).
- **No picture** unless the record holds a secure (`https`) address for one; otherwise their initials. Photos are never taken from a source on
  the importer's say-so.
- **Directory profile.** A person's panel and page say they are a directory listing built from public pages: not a Still Early member, partner or
  endorsement, and nobody is available for introductions through the site. There is deliberately no "request an introduction": there is no workflow behind it.
- A person who is listed from outside Australia carries a note that the profile does not say they invest in Australian startups, unless their firm's
  `inclusion_basis` says it does (`international` is the basis for a firm that is listed only so it can be found).
- **"Not right, or not you?"** opens a correction or removal request (`POST /api/investor-people/<slug>/corrections`). It is staged like a firm's
  correction (`investor_corrections.json`, key `people/<slug>`) for a person to read: nothing changes by itself. There is no email or phone field for a
  person, and the asker's own email is optional and never shown.

## Importing a directory of people

`backend/scripts/investors/people_import.mjs` imports a list of people at firms. It reads a **file** (CSV or JSON): it never fetches a page, so whoever
exports the list from a page they are allowed to read says where it came from and when, and the importer records that and does not claim to have read the
page itself. The columns are `name`, `role`, `firm`, `location`, `profile_url` (a LinkedIn `/in/` address or a personal site) and `firm_website`; other
common names for them are understood (`title`, `company`, `area`, `linkedin`, `website`, ...).

```
node scripts/investors/people_import.mjs --from list.csv --source-url <the page the list is on> --retrieved-at 2026-10-23 --retrieved-by "who exported it"
    [--source-name "Name of the directory"] [--data <dir>] [--report <file.json>] [--runs <dir>]
        a DRY RUN (the default): says what each row would do and writes nothing
... --apply --by "name"
        does it: backs up the files it will change to backend/.import-runs/<run>/before/, writes a manifest of what it made, and records it in the audit trail
node scripts/investors/people_import.mjs --undo <run> --by "name"
        takes out what that run made, if no person has worked on it since
```

How it behaves:

- **Matching.** A person is matched by their normalised professional-profile address (`profileKey`: `www.`/`http`/trailing slash/query/case all ignored).
  A row with no address is matched by name and firm, and a match like that is a *doubt for a person to settle*, never a merge. A firm is matched by its
  website's domain, and by name only when the row has none (and the report says so).
- **Nothing is overwritten.** A difference from what is on record is a conflict in the report; only an empty field is filled.
- **Everything new is a candidate**: the person, their firm and the team record that puts one at the other. Nothing is public until a person checks it
  against pages the firm publishes and publishes it (the Command Center or `npm run investors`).
- **Retrieval is not verification.** The listing is a source of kind `directory_listing` with its `retrieved_at`; each claim made from it is a record with
  `verified_at: null`.
- **No role, no import** (a firm alone does not make someone an investor), and no name or no firm is skipped. A profile address that is not a person's
  (a company page, a social or directory page) is left out and said so. No photos are imported.
- **Repeatable.** Every id is worked out from the record, so running it again changes nothing: no duplicates, and saved lists, ids and relationships are kept.
- **The report** says: source records collected, new people, new firms, existing people and firms matched (and proposed updates), conflicts kept for review,
  duplicates inside the source, rows skipped (with the reason), Australian versus international, and the roles found.

### Lyra Capital's network directory (the blocker)

The list on https://lyracap.vc/network (investors tab) is not in the page: the page is a client-rendered shell, identical for every query, and the list is
loaded by the browser from `/api/connections`. That site's `robots.txt` says `Disallow: /api/`, so this project **does not call it**, and nothing has
been imported from Lyra. No Lyra records, photos or text are in the repository.

Ways forward, none of which has been taken:

1. Ask Lyra Capital for permission or an export of the list (name, role, firm, location, profile link, firm website) and import that file.
2. Export the list from the page as a person who is allowed to read it and run the importer on that file, with `--source-url` and `--retrieved-at` saying so.
3. Research each firm's own team page (the `npm run investors` research flow), which is also what verifies a candidate for publishing.

### Data issues to settle

- Antler's record states its headquarters as Singapore (with Sydney, Melbourne and Brisbane offices), so it is listed under **Global** and not under
  **Australia**. A firm with an Australian office could be counted as Australian too; that is a one-line rule in `scopeOf` (`backend/src/catalog/investors.js`) and
  a decision for the owner.
- No person is published yet, so the real directory is firms only; the people side has been exercised with tests and a throwaway invented dataset.

## Location filter

An investor is found under both its state and its country, so `location=Australia` lists every Australian investor and `location=NSW` only the
ones in NSW. The menu's counts follow the same rule (an investor counts once under each). With `scope=au` the menu's options are counted over the
Australian investors only, so no option offered finds nothing.

## Office addresses

An investor can state the street address of an office: `office_addresses`, one `"City: street address"` per entry, where the city is its headquarters
city or one of `other_offices`. Like every claim it needs a page that states it and the page's words (the Command Center's edit form asks for both; the
research file `backend/scripts/investors/research.json` takes `["office_addresses", "Melbourne: 15 Dover St, Cremorne VIC 3121", "contact", "<the
words on the page>"]` and `npm run investors -- fetch` then `import --apply` applies it only if those words are on the cached page). A pasted address that
no page of the firm's own states is not entered: it goes in the file's `unconfirmed` list with the reason (Artesian's, for instance).

The page shows the addresses under "Office addresses". `npm run investors -- offices [--geocode] [--only slug,slug]` reports where each address stands and
asks the geocoder for the ones not asked yet; the map draws an office at its address only once that answer is confirmed (see `docs/map.md`).

## API used by the page

`GET /api/investors` (search, type, stage, sector, location, lead, active, chequeMin, chequeMax, **slug**, **kind**, **scope**, **role**; sort `name | name_desc |
portfolio | location`; pages of 20), `GET /api/investors/meta` (the menus; `?kind=all&scope=au` counts them over what the page lists),
`GET /api/investors/<slug>`, `GET /api/investor-people/<slug>`, `POST /api/investors/<slug>/corrections`, `POST /api/investor-people/<slug>/corrections`,
and `POST /api/feedback`.

- `kind=firm|person|all` is what the list is of. With no kind the answer is the older firm-only shape, with no `kind` on the cards; with a kind
  named every entry carries `kind` and `key` (a firm's slug, or `people/<slug>`), and `slug` then takes keys.
- `scope=au` keeps the investors based in Australia; `global` (or none) is every investor. A person or firm whose place is not stated is never Australian.
- `role=investment,scout,...` is the kind of role a person has; a firm has none, so it leaves firms out. A firm-only filter (leads or follows, cheque
  size) leaves people out.
- The `slug` filter (comma-separated) is how the Saved tab asks for exactly what a visitor saved.
- A new query parameter must also be added to `KNOWN` in `backend/src/catalog/respond.js`, or the response cache ignores it.

## Where the code is

`frontend/src/components/investors/` (`InvestorsView` = page and routing, `InvestorDirectory` = tools, tabs, results, `InvestorList` = the compact rows,
`InvestorCard`, `InvestorLists` = the "Start with" lists, `FilterSheet` = the phone's filters, `InvestorPanel` = a firm's side panel and drawer,
`PersonPanel` = a person's, `InvestorProfile` / `InvestorPersonProfile` = the full pages, `SuggestInvestor`, `SuggestPersonCorrection`),
`frontend/src/investors.css` (everything under `#investorsView`, on the site's design tokens), and the hook `useSavedInvestors`. The header is the shared
`SiteHeader` and the rows, badges and segmented switch are the shared parts (`components/brand/`); the filter menus are the map page's (`explore/CheckMenu`).

Backend: `src/catalog/investors.js` (the read model: entries, scope, kind, role, facets, meta), `src/routes/investors.js`, `src/investors/people.js`
(place and role rules), `src/investors/peopleImport.js` and `scripts/investors/people_import.mjs` (the importer). Tests: `backend/tests/investorPeople.test.js`,
`backend/tests/peopleImport.test.js`, `frontend/tests/investors/`.
