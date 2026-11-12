# The map page: "Startup atlas"

`/map` was redesigned to the approved "Startup atlas" screenshot: a midnight-navy header and sea, a warm ivory directory panel and drawn land, a restrained gold for what can
be pressed, and the coral full stop of the wordmark. It is the **same map, the same pins and the same data** as before, not a second map: the Leaflet map, its clusters and
pins, the filters, the company card and panel, the VC and spaces layers, saved items and the Add company flow are the existing ones. Only `/map` changed: the class
`xp-atlas` is on the map page's root and nowhere else, every rule in `src/atlas.css` is under it, and Discover, the welcome page and the other routes are untouched.

## The journey

Australia (the national view) → press a city's badge → the map flies to fit that city's published pins → clusters and single logo pins on the street map → press a pin → its
card beside it, its row lit in the directory → Open → the company's page over the map page → close → back on the city → **All Australia** → the national view, with every
other filter as it was.

- The national view is the real map zoomed out: the country, its states and the badges are drawn inside the same Leaflet map (same projection, same coordinates), so zooming is
  one continuous move. As the zoom grows the badges and the drawn land fade out while the clusters and pins fade in and the street map's tiles arrive. The thresholds are in
  `src/atlas/zoomModes.js` (tiles load from 5.5, pins from 5.75, the drawn country goes by 6.5). What is not shown is `visibility: hidden`, so it is not in the tab order either.
- A badge is a button: the city, then its count, on ivory, with a small gold anchor on the city. Labels that would overlap (Sydney, Newcastle and Canberra; Brisbane and the
  Gold Coast) are tried in a few places beside their anchors and joined to them by a thin line when moved (`layoutBadges`).
- A city is the `city` filter, as before. Choosing it from the heading's menu, the badge, or the address (`/map?city=Perth`) all do the same thing, and the flight to it is made
  by `MapView` when the scope changes. The fit is at a **whole zoom level** (tiles are drawn for whole levels; between them their edges show as hairlines), to the box round the
  city's pins with the few far-out ones left to the clusters (`cityBounds`).
- A company opened from the map page keeps the map page behind its panel (`startupOrigin` in `App.jsx`), and closing it returns to the city.

## The numbers

A badge's count is **calculated, never typed**: the distinct organisations with a published pin in that city, under the active filters. `App.jsx` asks for the pins of every
city under the same filters but the city (`nationalPins`; when no city is picked these are the map's own pins), and `src/atlas/cities.js` counts them. A badge sits on the city's
reference point (`src/cityViews.js`, the point the map goes to for it). A city with no published pins has no badge (today: Hobart, Darwin and Canberra).

- Only pins count: a company known only to its city is in the directory (and its count), has no pin, and is never drawn as a point. The panel says both numbers: "933 organisations"
  and "492 with a pin on the map". The badges add up to the second (less the few pins that are in none of the ten cities).
- Investors are counted in the badges only when they are all the map shows (Investors in the type select): their marks stand at a city's reference point, so beside the companies'
  pins they would be a count of another kind. They still appear on the map as before.
- **The city of a pin is the server's, not ours.** Each marker from `/api/startups/markers` carries its `metro` as the last field (`MARKER_FIELDS`): the big city its postcode is in,
  by the same assignment the city filter reads (`geo/metro.js`, `snap.metros`), or `null` for a company in none of the ten (a regional town). The frontend counts a pin under its
  `metro`, and under its own `city` when that is one of the ten (the filter takes a company either way, so a company whose city name and postcode name two cities is in both
  lists and both badges). A pin in none of the ten stays on the map and under no badge. There is no distance rule: a suburban office 45 km out of Sydney whose postcode is Sydney's
  is in Sydney's badge and view; a town 25 km from Canberra that the filter does not call Canberra is in neither. Coordinates are as stored, and a company known only to its city
  still has no pin.
- **A server that does not send `metro` yet** (the field is new): an older answer has twelve fields, and only the pin's own city name counts then, never a guess from where it
  stands. Counts from such a server can be a few short of what the city shows (a suburb named by itself is left out). Deploy the API first (it is additive) and the badges are exact.
- `backend/tests/markerMetro.test.js` runs both halves together: for synthetic companies (a suburban office beyond 20 km, a regional pin in no metro, a pin whose city and postcode
  disagree) and for the real directory (Melbourne + SaaS and other filter sets, without fixed numbers), each badge must equal the pins, at the same places, that the city shows
  under the same filters.

## The drawing

- **Coastline**: Natural Earth 1:10m countries (public domain), Australia only, simplified to about 2 km: `src/atlas/australia-land.json` (39 kB, 30 rings: the mainland, Tasmania
  and the larger islands). It was cut with `scripts/build-australia-land.mjs`, which needs the `world-atlas` and `topojson-client` packages installed *outside* the project (the
  script says how); the app does not depend on them. The credit "Coastline: Natural Earth" is in the map's attribution.
- **State borders**: drawn by hand in `src/atlas/geo.js` from the lines they follow (129°E, 138°E, 141°E, 26°S, 29°S, the Murray), right to a few kilometres: a backdrop,
  not survey lines. Natural Earth's states are a separate, larger download that was not made.
- The land, glow, hatch, borders, graticule, state and sea names, and the edge ticks are in `src/atlas/atlasLayer.js`; the look is `src/atlas.css`. The drawing is its own chunk,
  fetched with the map, so the app's first load did not grow (`tests/bundle.test.js` still holds: App chunk under 84 kB).

## The panel and the header (wide screens)

The toolbar of the old map page is gone on a wide screen; its controls moved into the panel (`components/explore/AtlasHead.jsx`, inside `ResultsColumn` as variant `atlas`) and the
words over the map (`AtlasOverlay.jsx`, a heading that opens the city menu). They are the same filters: the **type** select is the layer the map shows (All, Startups,
Companies, Investors, Spaces), the **sector** and **stage** menus and the search are the page's filters, **More** opens the filter drawer (which keeps the Layers and Key tabs),
**List** goes to Discover's list. "/" focuses the search. The header is the navy variant of the shared one (CSS only). The "FIELD GUIDE" kicker, the compass and "THE AUSTRALIAN
EDITION" are as in the approved screenshot; the screenshot's "/ 01" and its footer "Curated preview directory" were left out (nothing numbered it, and the directory is not a
preview): the footer says what the pins are.

On a phone (under 900 px) the map comes first, under the same compact bar as before (restyled), with the directory in the bottom sheet, one tap away.

## Tests

`tests/atlas.test.js` (the city of a pin, the badge counts, the fit, the label layout, the drawing) and `tests/components/atlasPanel.test.jsx` (the panel head, the heading over the
map, the way back); `tests/App.test.jsx` was changed for the type select and for the extra, city-less request for the badges.
