# Where companies are

A pin on the map says "here". For a long time many pins said it about places nobody knew: every company the directory knew only as "Sydney" sat on one point near the city centre, so 36 companies looked as if they shared an office. This is how the directory now says what it knows and no more.

The rule everything follows: **a pin must mean what it looks like.** A city centre is not an office, so a company known only to its city has no coordinates and is not drawn as a pin; it is counted in a group at its city. Nothing is spread out, jittered or guessed to make the map look better. Accuracy matters more than a full map.

## How exactly a place is known

Every company has a `location_precision`:

| Precision | What is known | Coordinates | On the map | Words the site uses |
|---|---|---|---|---|
| `EXACT` | the office: a street address, and the point it is at | yes | a pin | "Verified office" (a source was checked), or "Office address on file" (it is the directory's own record, no source checked yet) |
| `SUBURB` | the suburb, not the office | yes (the suburb, or a point inside it) | a pin with a dashed edge: approximate | "Location: suburb-level" |
| `CITY` | the city only | none | a dashed ring at the city with a label ("Sydney — 34 startups with city-level locations"); clicking it lists the companies | "Location: city-level" |
| `STATE` | the state only | none | the same, at the state | "Location: state-level" |
| `UNKNOWN` | no confirmed Australian place | none | nothing; the company is still in the list and the search | "Location unknown" |

A city or state centre is a reference point (`backend/src/geo/places.js`) used to put the label of a group, to recognise a pin that is really a city centre, and to notice a pin that is nowhere near its city. It is never written to a company as where the company is.

## What is kept

On each company: `address`, `suburb`, `city`, `state`, `country`, `postcode`, `lat`, `lng` (the legacy names for latitude and longitude), `location_precision`, `location_source`, `location_source_url`, `location_verified_at`, `location_confidence`. Where a location came from, when it was checked and how sure we are stay internal: the public API serves only whether the address was checked (`location_verified`).

`company_locations.json` holds a row per place: a `HEADQUARTERS` row for every company, derived from the company itself so the two cannot drift (`npm run data:migrate` rewrites it, and `npm test` fails if they differ), and room for `OFFICE` and `OTHER` rows. The HQ is what is drawn today; other offices are stored and validated but not drawn yet.

`geocode_cache.json` keeps every answer a geocoder gave, so the same address is never asked twice. It is an internal record: no route serves it.

**Sources**, best first: the company's own website or contact page (`company_website`), a document the company publishes (`company_document`: privacy policy, terms), a credible profile that states a location (`credible_profile`: an accelerator, press), another ecosystem source (`ecosystem_source`), and a person who confirmed it (`manual`, who says what they checked). A record that predates all of this is labelled honestly `directory_record`. Never used, and refused by the code: LinkedIn and other personal profiles (they say where a person works or lives), a founder's home, a search snippet, a postcode guess. A residential address is not a company's place.

**Confidence** is `high` only with all three of: a source the company itself publishes, a check of that source, and a geocoder that finds the same place. Without the geocoder it is `medium`; a record nobody can trace is `low`.

## Where the existing data came from

`npm run data:migrate` classifies each existing company from what it already holds, and never touches the legacy fields: a street address and a point is `EXACT`; a suburb and a point is `SUBURB`; a city with no address is `CITY`; a company that was never confirmed in Australia is `UNKNOWN`. The coordinates a city-only company carried were a city centre, not its own: `npm run locations -- normalize` took them off (each change is in the audit trail with its old value).

## Geocoding

The geocoder is OpenStreetMap's Nominatim (`backend/src/geo/geocode.js`). It follows the usage policy: at most one request a second, a user agent that names this site, answers kept, no bulk use (a run is a few hundred addresses, once), and a 429, 403 or 503 stops the whole run. What is sent is the business address a company publishes (street, suburb, state, postcode, with the unit, level and building left out), never a person's. The result is ODbL data; the map already credits "© OpenStreetMap contributors".

An answer is judged before it is used:

- It must be a **house** (the street number found), in the state the record names, in the postcode (or, when the postcode differs on a boundary, the suburb) the record names, and with the street number the record names (a building listed as `435-441` contains `441`). A street or a suburb is not an address. A street of the same name in another suburb of the same city (`99 Queen Street, Altona` for `99 Queen Street, Melbourne 3000`) is refused because its postcode differs.
- With no point on file to compare it with, it must also be within 100 km of the city the record names.
- A point on file that is within 25 m of the geocoder's is left exactly as it is. One within 500 m is the same place, and the geocoder's point (which can be traced) replaces it. **Anything further is a conflict: it is reported, never overwritten.** A suburb-level company's point stays where it is when it is inside the suburb the geocoder found.
- A pin that sits on a city centre, with no source behind it, is a fallback somebody used when the office was not known: it counts as no point at all, and the geocoder's answer takes its place (the audit trail keeps what it was).

## Tools

From `backend/`. `verify`, `promote` and `normalize` show what they would do and write nothing unless given `--apply`; add `--data <dir>` to work on a copy. Every change is one audit row per company (`location.geocode`, `.verify`, `.promote`, `.normalize`, `.set`), by `cli` or by you (`--by`).

```bash
npm run locations -- status                # the five counts, six flags and the review queue by problem
npm run locations -- review [--issue code] # the queue, worst first (codes: see below)
npm run locations -- geocode [--apply]     # ask the geocoder about the addresses (answers cached); --apply puts good answers on the records
npm run locations -- promote [--apply]     # a city-level company whose own website states a street address gets it, at the geocoded point
npm run locations -- verify [--apply]      # attach the page that states an address to a location with no source yet
npm run locations -- normalize [--apply]   # take the coordinates off city- and state-level companies
npm run locations -- places                # check the city-centre reference points against the geocoder
npm run locations -- set acme --city Sydney --address "…" --lat -33.87 --lng 151.2 --source company_website --source-url https://… --reason "their contact page"
```

A good order for new data: `normalize`, `geocode`, `promote`, `verify`, then work the queue by hand. `promote` only acts when everything agrees: the company's own pages state one address, in the state the record names, and the geocoder found the house in the right suburb and near the right city. A disagreement is reported ("its own page puts it in NSW, the record in ACT") and left for a person.

The review queue's problems, each with what to do about it: `coordinates_conflict` (the point is not in the state or is over 100 km from the city), `geocode_disagrees`, `coordinates_on_area_location` (a city-level company carries coordinates), `missing_coordinates`, `address_not_geocoded`, `shared_coordinates` (a pin shared with a company at a different address; companies at the same address are not flagged), `city_centre_coordinates`, `unknown_location`, `city_level_only`, `state_level_only`, `historical_location` (closed, acquired or a subsidiary), `suburb_level_only`, `address_unverified`, `stale_location` (last checked over a year ago), `suburb_in_city_field`, `no_state`.

## On the site

`GET /api/startups/markers` sends a pin only for a company whose place is a point: `[slug, name, lat, lng, sector, city, hiring, domain, precision, place, checked]` (a reader that knows only the first eight still works). Companies known only to a city or state come back as `areas`, one per place, at the place's reference centre with `count` and a `sample` of names, and `unplaced` counts the ones whose city has no centre on file (they are in the list and the search, on no map). The list, counts, summary and markers all take `precision=EXACT,SUBURB,CITY,STATE,UNKNOWN` and `state=NSW,VIC`; a group's "View all" opens the list with exactly the filters that name its companies. One company's page carries `location`: `{ precision, place, quality }`, in the words above. The hover tooltip is the name, where, and how well that is known ("Example Startup / 123 Example Street, Melbourne / Verified office").

The answer is larger than before: at 10,000 synthetic companies it is 226 KB over the wire (7,348 pins, 13 groups) where 10,000 pins used to be 214 KB, because each pin now carries a place line and two more fields. At the real directory it is 7 KB. See [scale.md](scale.md).

## The Command Center

The **Locations** section shows the five counts, the six flags and the review queue, and an admin can set a location with the geocoder's help: see [admin.md](admin.md).

## What was done to the real directory (2026-10-06)

Of 216 companies: **148 exact, 11 suburb, 43 city only (none with coordinates), 14 unknown.**

- 46 city-only companies carried coordinates that were a city centre, not their own (36 of them the one point in Sydney, which looked like 36 companies at one office): the coordinates were cleared, each in the audit trail with its old value.
- The 156 companies with a street address or a suburb (149 different addresses) were put to the geocoder. 90 agreed with the point on file; 5 whose pin was a city-centre fallback were placed at their address; 5 had a point within 500 m replaced by the geocoder's; 47 could not be settled (the geocoder found only the street, or nothing); 9 disagreed (below).
- 3 city-only companies were given the street address their own website or privacy policy states, at the geocoded point, so 43 of the 46 stayed city-level.
- **9 companies were not moved because the geocoder disagrees with them** and a person should look: their pins are 0.5–1.6 km from the address the record gives, or the address resolves to another suburb (Care GP's `19 North Terrace, Adelaide 5000` resolves to a North Terrace in 5069, and DataMesh Group's `60 Margaret St, Sydney 2000` to one in 2049, so those two pins are probably in the wrong place altogether). They are `geocode_disagrees` in the queue.
- **112 exact addresses have not been checked against a source.** They come from the directory's own record, are labelled "Office address on file" and not "Verified office", and are counted as "Addresses not checked".
- 43 companies are known only to their city. 7 of them have a street address on their own website that could not be used yet (the geocoder found only the street, found a street of the same name in another suburb, or knew nothing of it, or the website says a different state from the record: Quantum Brilliance is recorded in Canberra and its site states a Sydney address). They wait in Suggested fills for a person.
- 16 companies have a suburb in the city field (`Richmond`, `Carlton`): the legacy `city` field is never rewritten automatically; they are `suburb_in_city_field`.

## Limits

- OpenStreetMap does not know every building. Where it finds only the street, the address is not plotted and stays as the directory had it. Where the directory's point and OpenStreetMap's disagree by more than 500 m, which is right is a person's decision; the queue says what each side is.
- Nothing can tell by itself whether an address is somebody's home. The code only takes an address from a business page or from the directory's own record, refuses the sources that say where a person is (LinkedIn and the like), and sends nothing but the address to the geocoder; a small business that publishes its founder's home as its office would still be on the map at that address. The review queue shows every address with where it came from, and "Set location" can drop one to the suburb or the city. A scan of the 216 stored addresses for words like home, residence, apartment or PO box found none (the one hit was Captains Flat Road).
- A company with several offices has one place drawn (its headquarters). Other offices can be stored in `company_locations` but are not drawn.
- Nothing here checks that an address is *current*. A location older than a year, or of a company that has closed or been acquired, is flagged; it is not fixed.
- A suburb's point is wherever the geocoder (or a person) puts it: that is what "approximate" means.
