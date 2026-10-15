# The map

The map page (`/`, App.jsx with `components/MapView.jsx` and `components/explore/`) draws startups and venture capital firms on one Leaflet map.

## What is on it

| Mark | What it is | Where it stands |
| --- | --- | --- |
| A rounded square with a logo | a startup | its office (`EXACT`) or its suburb (`SUBURB`, dashed edge) |
| The same square with **VC** on it and a **solid** edge | one office of a venture capital firm, at a street address its own page gives (`EXACT`) | the address, found by the geocoder and checked (below) |
| The same square with **VC** on it and a dashed edge | one venture capital firm alone in a city | that city's reference point (`geo/places.js`) |
| A square with a number and **VC** | the VCs of one city (they all stand on one point), or of one street address (the number and "at one address", solid edge) | that city's reference point, or the address; pressed, it lists them |
| A numbered ring | marks close together | their centre; pressed, the map is fitted to them (or, if they stand on one point, they are listed) |
| A dashed ring with a label | startups known only to a city or state | the city's reference point (label from zoom 8) |

**Logos.** A tile shows the company's own `logo` when its record has one, otherwise the picture its website's domain gives through the one source the
cards use (`logo.js`), and its first letter when there is neither or the picture does not load. Every logo keeps its colours and proportions (`object-fit: contain`).

**Investors are drawn at a city unless their own page gives a street address and it was placed.** `investors.json` has a headquarters city, a list of
office cities and, for the offices whose own page prints one, `office_addresses` (`"City: street address"`, each backed by a verification record with the
page's words; the city must be the headquarters or one of the other offices). `GET /api/investors/pins` (`catalog/investors.js` `investorPins`) turns each
office city the project knows (`geo/places.js`) into a mark, with `precision: "CITY"` and `role: "headquarters" | "office"`. Nothing is moved or jittered
to tell two apart: the firms of one city are one group mark. A firm whose record gives only a country, a state or a suburb has no mark; the response
counts them (`unplaced`) and the list says how many. Every city-level place it tells says "City-level ... no address on file".

**An office at its address (`precision: "EXACT"`).** For an office with an address, `investors/offices.js` reads the geocoder's cached answer
(`geocode_cache.json`, the same cache and the same rules as the startups: `geo/geocode.js`) and draws the mark at that point **only if** the answer names
the street number in the right state, suburb and postcode and lies within 100 km of the city. Anything else (no answer yet, only the street, another
state or suburb, too far away) leaves the office a city-level mark, so a wrong geocode can never put a firm on the wrong street. The mark's id is
`<slug>@<city>#n`, its `place` and `address` are the address in the page's words, its tile has a solid edge, and its tooltip says "Office address from
its own website". `npm run investors -- offices` lists each address and its status (`placed`, `conflict`, `unsettled`, `not asked`, `no street`); with
`--geocode` it asks the geocoder (Nominatim, one request a second) for the ones not yet asked, and `--only slug,slug` narrows it. The profile
(`/api/investors/<slug>`) lists `office_addresses` as `{ city, address, located }`, shown as "Office addresses" on the investor's page and "Addresses" in
the map's panel.

## What is shown

The toolbar's **All / Startups / VCs** is in the address (`?show=startups`, `?show=vcs`; both is no parameter). The search, sector, stage and city narrow the
investors as well as the startups; the filters about a startup alone (hiring, remote policy, tech, team size, ...) leave the VCs off when both are shown and
are ignored when only they are. With only the VCs on, the Sector menu offers the sectors investors state and a Stage menu appears. The List view lists the
VCs (one card each) instead of the startups.

## Panels

A startup opens a panel (Overview and Jobs tabs: website, stage, what a page says of its open roles and the way to them, View company, Save). A VC opens its
focus, stages, its place (said as a city, or as the street address for an office at its address), other offices, the addresses its pages give and the companies a page says it backed, each a way into that company, and View investor profile and Save
(the same saved list as the Investors page). Wide screens dock the panel on the map's right and bring the open mark clear of it (`focus.insetRight`); a phone has
the bottom sheet (`focus.inset`). Search, filters and city are not touched by opening or closing a panel or switching Map / List.

## Clusters and overlap

Supercluster's radius is in tile-extent pixels, so it is given Leaflet's 256 extent (`pinIndex.js`): radius 64 is 64 screen pixels, more than two marks' halves, and
the grouping is for the whole zoom below the map's, so two marks never overlap. Names under the tiles are only written where they fit (`chooseLabels`).

## Keyboard

Every mark is a tab stop with a name (`aria-label`); Enter and Space press it (Leaflet's own Enter only opens a popup bound to a mark, so `MapView.named` adds the
key handler). Escape closes a panel; the toolbar, the menus and the panels are ordinary buttons and links.

## Background

OpenStreetMap's tiles, quieted by CSS (`.map-quiet-dark`, `.map-quiet-light` in `styles.css`). CARTO's Dark Matter and Positron look better but answer "API key
required" without a key (checked 2026-10-15). With a Mapbox token (`VITE_MAPBOX_TOKEN`) its dark and light styles are used. A keyed provider is a change to
`mapTiles.js` only.
