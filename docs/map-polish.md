# The map polish pass (19 Nov 2026)

A final polish of `/map` and its handoff to Discover. Local changes only (branch `feature/map-polish`, from `feature/curated-map`): nothing is committed, pushed, merged or deployed. The map's engine, its
basemap, its city navigation, its logo pins, the company profiles and the Still Early look are as they were.

## 1. One sector list for the map and Discover

The data keeps the sector each source gave a company (97 different labels: `HealthTech` and `Healthtech`, `Enterprise AI`, `Sales AI`, `Construction SaaS`...). **No record was changed.** The server adds
`sectorGroup` beside `sector`, from a table placed by hand (`backend/src/models/sectors.js`; nothing is guessed from a word inside a label), and every sector menu offers the twelve display sectors and
"Other", never the ninety-seven labels.

| Display sector | Companies | Source labels placed in it (companies) |
|---|---|---|
| AI & Data | 68 | AI 50, AI infrastructure 2, Enterprise AI 1, Enterprise AI software 1, Sales AI 1, Vertical AI 1, Industrial AI 1, Maritime AI 1, Computer vision 1, Data 7, Data infrastructure 1, Analytics 1 |
| Software & DevTools | 158 | SaaS 86, B2B SaaS 2, DevTools 3, Enterprise 1, Enterprise Software 2, Productivity SaaS 1, Strategy SaaS 1, Engineering SaaS 1, Contact-centre SaaS 1, Video software 1, HR Tech / HR tech 24, HR 2, Workforce 1, Legal tech 14, Legaltech 1, GRC 1, MarTech / Martech 13, Adtech 1, Research Tech 1, Web3 1 |
| Cybersecurity | 21 | Cybersecurity 21 |
| Fintech | 99 | Fintech 89, Insurtech 8, WealthTech 1, Open banking 1 |
| Health & Biotech | 128 | HealthTech / Healthtech 73, Medtech 29, Biotech 23, Telehealth 1, Aged 1, Wearables 1 |
| Climate & Energy | 55 | Energy 29, Climate 20, ClimateTech 1, Climate SaaS 2, ESG SaaS 1, Green ammonia 2 |
| Food & Agriculture | 27 | AgTech 21, Food 4, Alt-protein 1, Cellular agriculture 1 |
| Consumer & Commerce | 79 | Consumer 22, Marketplace 12, Retail 8, Retail media 1, Ecommerce 1, Fashion 3, Sports 3, Media 9, Gaming 4, Gaming infrastructure 1, Travel 5, Experiences 1, Hospitality 1, Hospitality Tech 7, Hospitality SaaS 1 |
| Education | 37 | EdTech 37 |
| Property & Construction | 42 | PropTech 33, Construction SaaS 8, Construction safety SaaS 1 |
| Industrial & Logistics | 35 | Logistics 15, Logistics SaaS 1, Industrial Automation 4, Manufacturing 3, Mining Tech 3, Mobility 5, Automotive 1, Automotive SaaS 1, Automotive data 1, Packaging 1 |
| Deep Tech & Space | 55 | Space 10, Satellite IoT 1, Geospatial 2, Quantum 7, Quantum computing 1, Hardware 17, Robotics 13, Defence 2, Spatial Computing 1, VR 1 |
| Other | 29 | Community 29 (the coworking and community spaces) |
| *(no sector: unclassified)* | 87 | "Unknown": not "Other", not guessed; the company is in no sector's list |

Judgement calls a person may want to change (one line each in the table, then the test): business-software categories (HR, legal, marketing, ad tech, GRC) sit in **Software & DevTools** (the twelve have
no "business services"); Hardware, Robotics, Defence, VR and Satellite IoT are **Deep Tech & Space**; Industrial Automation, Mining Tech and Mobility are **Industrial & Logistics**; Wearables and Aged care
are **Health & Biotech**; Web3 is **Software & DevTools** (its one company is not a payments firm). A label the table does not know is "Other" until it is placed, and `backend/tests/sectors.test.js`
fails until it is (it lists every label in the data).

**Filter.** `sector=` takes a display sector or a source label, one or several (`sector=Health & Biotech`, `sector=HealthTech,Fintech`). An older link keeps its meaning: `sector=HealthTech` is still exactly
the companies the source labelled HealthTech (66), and a name that is both a label and a display sector (`Fintech`) now means the display sector (99, the labelled 89 and the Insurtech, WealthTech and
Open banking ones). In the app a chosen sector the menu does not offer (an older link's label, or a sector with no result here) stays in the menu, ticked and removable, and has its chip.

**What a menu offers.** Only the sectors that have a result for the city and the type of organisation chosen, with how many (`summary.sectors`; `frontend/src/sectorOptions.js`). With neither chosen the page
already has the counts (the directory's, or the map's), so no request is made. The sector, the search and the stage are deliberately not part of that question, or the menu would shrink to what is chosen.
Search suggestions ("industries") are the same twelve.

**Stage = funding rounds.** The Stage options are Pre-seed, Seed, Series A, B, B+, C, C+, D, D+, E (only those a company is at). Acquired, Subsidiary, Unicorn, Defunct (...), Unknown, and also Early, Growth
and Other Equity (which say how far along a company is, or are not a round; Early / Growth is the maturity filter, also under More filters) are not offered. A link that names one still filters; no record changed.

**A company that has closed** (stage "Defunct (in administration)" or "Defunct (in liquidation)", `company_status` defunct, or the owner's list's "Collapsed") is kept off the map, out of the pins, the
groups and every count the map shows, and out of the list opened from the map. Its record, its place in the directory and its `/startup/<slug>` page are untouched. (All four were already off the map by the
curated list; the rule is now in the code and tested.)

## 2. No circles, no clutter

* **Australia:** each city is its name on the map (a small gold anchor and the name, clickable). No number, no dashed ring, no "City level" label, no count bubble, no hint pill.
* **A city:** pins are drawn from zoom 8 (a city's scale); between the country and that the map is the street map with the cities' names. There are no clusters, stacks or groups; the pins are *spaced*
  instead (the final pass, below).
* **A company known only to its city** has no pin and no ring: it is in the filtered list (and in the count), never drawn. (Melbourne: 176 companies, 168 pins, 8 city-only; Melbourne + Fintech: 12 / 11 / 1.)
* **One row of controls** in the directory panel: Search · City · Sector · Type · View list, then "More filters" (the stage, Early / Growth and everything else) and the one count. The kicker, the line under
  the heading, the "with a pin" sub-line, the pins footnote, the Stage menu, the Early / Growth buttons, the city card and "National overview" over the map, the "Choose a city to explore" pill and the
  panel's second "See all as a gallery" button are gone. The compass stays. On a phone the same controls are two lines in the bar.

### Overlapping logos: spacing by zoom, revealed as the map comes closer

`createPlainPinIndex` (`frontend/src/pinIndex.js`) works out, for each zoom, which companies get a logo. Companies are taken in a fixed order (an investor's mark; those hiring now; those with a logo or a
website to take one from; then a fixed number from the name) and each gets its logo only if it is at least `pinSpacing(zoom)` pixels from every logo already given. The spacing is 58 px (a 40 px logo and 18 px
of air) at zoom 9 and under and narrows to 44 px at zoom 14, so every zoom level shows more logos. A company with no room is a small plain dot at its place (navy with an ivory edge: no number, no letter, no
ring) if that spot is clear of a logo (24 px) and of another dot (14 px), and is not drawn otherwise. A dot opens the same card as a logo. The result does not depend on the window (it is worked out over every
pin in the world's own pixels), so panning never swaps logos; the open company and the ones you saved always have a logo and take none from the others. A logo grows into place as it appears (not for a
visitor who asked for less motion).

Melbourne's 168 pins, by zoom: 3 logos at zoom 8, 6 at 9, 14 at 10, 23 at 11, 40 at 12, 59 at 13, 78 at 14, 103 at 15, 123 at 16, 134 at 17, 137 at 18. The other 31 share a building (the same point, or within
a logo's width at street scale): they are in the list beside the map and are reached from it (a row lights its pin, drawn as a logo, and brings it into view), and on a phone from the sheet's list. Nothing
is counted, no number is drawn.

### Investors: a logo for each at a verified street address

The numbered VC tile ("8 VCs in Sydney") is gone from the map page. An investor **at a verified street address** (precision EXACT: its own page gives the address, and it was placed at the
building) is its own mark: its logo, the yellow VC badge and a solid edge (an office). It goes through the same reveal as a startup, in one order with them: a startup that is hiring first, then
the investors, then the startups with a picture of their own, then the rest (each band by a fixed number from the name). That is a modest lean, not a first place: in the middle of a city, where the
startups are many, equal footing left no investor with a logo until the map was very close. An investor with no room is a small yellow dot (a startup's is navy).

**An investor known only to its city has no mark and no offset.** Its record states a city and no address, so the only place the map could give it is the city's reference point, or a point made up
round it, and neither is a place it is. It is not drawn at all (the 8 firms of Sydney, 4 of Melbourne and 4 of Brisbane are in this case). The earlier spread of such firms round the city's point
is removed (`spreadVcPins` now moves only firms at one verified address, 30 m a step, a few paces: they are in one building; no real pair does today). It stays in **the city's directory**: the rows
beside the map (and the phone's sheet) list every firm once, counted in the figure at the top, whichever of its marks (if any) is on the map. Picking the row of a firm with a verified office lights
that mark and opens its card ("View investor profile"), as before, even where its logo would not fit; picking the row of a firm known only to its city opens the firm's own page (as a company known
only to its city does), because there is no mark to light and no place to fly to; the browser's Back returns to the map as it was. A firm with an office in one city and only a city in another is one
row that picks its office. The map key says a firm known only to its city has no mark. The older Discover map (`?view=map`) is as it was, with its numbered VC tile at a city's centre; so is the
investors' list. Nothing is changed in the data.

Sydney with startups and investors together: 2 investor logos among 19 startups at the city's zoom, all 4 of its verified firms from three zooms closer; the other 8 firms are in the rows.

## 3. The pin's card

The logo and the name, one plain sentence (the first sentence of the company's description, cut at a word if long, nothing added), its sector (the display sector) and its suburb and city where known, and
one button: **View company**. A missing part is left out. Not on it: sources, evidence links, verification dates, hiring, the website, the stage, the founders, the accelerator, the location's precision,
the street, saving, reporting (they are on the company's own page, which is unchanged). The hover label is the name, the sector and the suburb and city. The map's attribution stays.
(Investors' cards are the same shape: name, "Venture capital · city", "View investor profile".)

## 4. Map and list

**View list** opens Discover's list with the same city, sector, type, stage and search, and the scope "only what the map shows": `/discover?city=Melbourne&sector=Fintech&onMap=yes`, with an "On the map" chip
that takes the scope off. The list's switch then says **Back to map**, which returns to `/map?city=Melbourne&sector=Fintech`. Discover without the scope still lists every company.

**The map comes back exactly where it was.** The app keeps the map page's last view (centre, zoom and the city it was looking at: `lastMapView` in `App.jsx`, from the map's own `moveend`). A company's page
opened from the map leaves the map under it, so closing it (its X, or the browser's Back) finds the map untouched. "Back to map" and the browser's Back from the list make a new map, which opens at the saved
centre and zoom (`restoreView` in `MapView.jsx`) instead of the city's or the country's view, with the filters (one state, and in the address) still on. If the city was changed on the list, the saved view is
not used and the map goes to the city (or the country) the filters now say. A company picked before leaving is not flown to again by the map that comes back. Not kept: a reload (the address has the
filters, not the camera) and the open card. Checked in headless Edge at 1440×900 and 390×844: after each of the four returns the pins and the basemap tiles on screen are at the same pixels (±1).

## Tests and checks

Backend `tests/sectors.test.js` (every label placed; mappings; old links; facets and summary for a city and type; funding-only stages; closed companies; the pin's new fields) and the updated
catalog/API tests; frontend `popupText`, `sectorOptions`, `mapPins` (the plain index), `mapPopups`, `atlasPanel`, `mapPage`, `curatedMap`, `explore`, `exploreResults`, `MapView`, `GalleryPage`, `FilterPanel`,
`cohort` and `App` tests. The journey (Australia → Melbourne → Fintech → a logo → View company → back → View list → Back to map) was run in headless Edge at 1440×900 and 390×844 (screenshots in
`docs/design-review/map-polish/`, which stays local like the other design reviews). The final pass added `pinIndex` spacing tests (`mapPins.test.js`), `MapViewAtlas.test.jsx` (where the map opens; logos and
dots) and App tests for the return to the map.

## The street basemap (checked in a normal browser)

The tiles are OpenStreetMap's (`mapTiles.js`; no key), shown quiet over the ivory paper (`.map-quiet-light`: half opacity, saturation 0.6). In the Claude desktop app's browser pane (a real Chromium), at
1024×768 and with the pane's mobile preset (375×812 at 2× device pixels, a Pixel 8 user agent): 9 of 9 tiles loaded, none broken, the credit "© OpenStreetMap contributors" shown beside "Coastline: Natural
Earth" (screenshots `basemap-desktop-*.jpg`, `basemap-mobile-real-browser.jpg`). A headless Edge with no profile is slow to its first tiles (10 to 25 seconds here, then they load), so a screenshot taken at once shows the
paper only: that is the browser, not the page. The tiles are fetched from the visitor's browser, so a visitor who blocks OpenStreetMap sees the ivory map with the pins and no streets.
