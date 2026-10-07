# The landing page

`/welcome` is the page a new visitor lands on (`frontend/vercel.json` serves it). It is `frontend/src/LandingPage.jsx`: a navigation bar, the hero, then the sections that were there before (companies that are hiring, curated lists, how the data is reviewed, closing links, privacy and terms).

## The hero

Two columns. On the left, the headline, the line under it, two buttons and two counts; on the right, the directory drawn on Australia. The code is in `frontend/src/components/landing/` (`LandingNav.jsx`, `LandingHero.jsx`, `EcosystemGraphic.jsx`, and `australia.js`, which holds the geometry). The styles are `landing.css` (the tokens and buttons the whole page shares) and `landing-hero.css`.

- **Colour and type.** The app's near-black ground and off-white ink. Amber means one thing in the hero: *a company that is hiring now* (the dot in a named company's label, and the dot in the "hiring now" count). The type is Geist, bundled from `@fontsource-variable/geist`, so no request goes to a font host.
- **Navigation.** Discover (`/`), Lists (`/?view=lists`), Jobs (`/?view=jobs`) and Join waitlist (`/?view=waitlist`). There is no Sign in, because the product has no accounts. The waitlist opens the app's own waitlist form, which is still a placeholder (`TALLY_URL` in `WaitlistForm.jsx` is empty), so until a real form address is set there it tells the visitor it is not set up yet.
- **Buttons.** "Explore the map" goes to `/` and "Browse startups" to `/?view=list`. The app opens at the list for `?view=list` and at the waitlist form for `?view=waitlist`, as it already did for `?view=jobs` and `?view=lists`.
- **Counts.** The directory's own totals from `/api/startups/summary`, left out until they arrive.

## The picture

It is a drawing, not a map, and it keeps the location system's rule: [a mark must mean what it looks like](locations.md).

- The country is a field of dots, about 90 km apart, inside a coarse outline of the coast.
- A dot is lit, and sized by area, by how many startups with a known place (the map's pins: an office or a suburb) fall in it.
- A company known only to its city has no pin and lights nothing. It is counted in its capital's label (the pins within 60 km plus the city-level groups), and a capital with only such companies gets a dashed ring, as on the map.
- Capitals that have startups are labelled with the count, and joined by routes. The routes are the long ones only; they say "connected", not that two companies are.
- Up to five real companies are named, one per capital: the first company in the list the page asks for (hiring, in the data's own order) whose city is that capital and whose name is at most 18 characters. A name that is too long is left out, not cut. Each name is a link to the list, filtered to that company.
- Nothing is typed in. With no data the picture is only the country in dots, the caption is hidden, and the figure is hidden from assistive technology.

To change it: the outline, the capitals, the routes and where each name hangs are `MAINLAND`, `HUBS` and `LINKS` in `australia.js`. `layoutEcosystem` is a pure function and is tested in `frontend/tests/landing/`. The picture makes no request of its own. It draws what the page already asks for: the map's pins and groups, and the first 80 companies that are hiring (the job cards show the first four of them).

## Motion and small screens

One entrance (the dots fade in, the routes draw, the lit dots grow, the names rise) and a very slow float of the names. Both are off under `prefers-reduced-motion`.

Below 960 px the picture sits under the text. Its labels are sized from the picture's own width (11 to 13.5 px), and a capital that would crowd a bigger one loses its label when the picture is under 440 px wide. The buttons stack under 560 px, and under 720 px the links fold into a menu button.
