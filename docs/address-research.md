# Researched addresses (company-addresses-150, 15 Nov 2026)

A researched list of 150 company addresses (a CSV with a source page for each; written by someone else, so a **lead**, not a source) went in through `backend/scripts/addresses/research-import.mjs`:

1. `verify` reads every cited page with the project's compliant fetcher (robots.txt obeyed, LinkedIn and PDFs never read) and checks that the page states the street address. Result: `research-results.json`.
2. `apply --by "name"` stores an address **only where a cited page states it**: an "Office / facility supported" address becomes active address evidence (from the company's own site where the page is on its domain); a postal, registered, historical, conflicting or "office not confirmed" address becomes a location of its own (`company_locations`, kind OTHER, no coordinates, never a pin).
3. Nothing is placed by the importer. `npm run locations -- geocode`, then `promote`, put a pin only where the geocoder finds the building.
4. `promotable.mjs` lists the researched companies that may be promoted now (office, corroborated, and the address the plan would use is the researched one).

Result on the day: 150 companies matched; 99 had a page stating the address, 14 pages were read and did not show it, 14 could not be read (LinkedIn, PDFs, robots.txt), 23 had no street to store. 41 evidence rows and 31 locations of their own were added. 41 companies were promoted to exact pins (27 from the research, 12 more that were already waiting on the geocoder, Matrak and Bare on the owner's word): 482 -> 523 exact.

Decisions by the owner: Matrak's address is 3 Albert Coates Lane (its contact page; `matrak-update.mjs` records it, the older 10 St Andrews Place is superseded); Bare is pinned at 500 Collins Street.

Left for a person: the 28 claims no readable page confirms (listed in the report), the 31 corroborated offices the geocoder could only place at the street, and **ENA Respiratory** and **Traild**, where this research calls the address an office but the city pack's earlier review (address-updates-62) recorded it as not an operating office: the earlier decision stands (the new evidence rows were superseded by `scripts/citypack/addresses.mjs`), pending a decision.

The 26 companies the city pack once made city-level may be pinned again, but only on an address their own website or a document they published states, with a point the geocoder found at the building (`tests/cityPack.test.js`, `stillPinned`).
