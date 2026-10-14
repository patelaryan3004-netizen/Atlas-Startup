# Pages with real HTML, the trust pages, and search/sharing (2026-10-14)

## What ships as HTML

`npm run build --prefix frontend` is now `vite build` and then `node scripts/prerender.mjs`. The second step draws pages with React's server renderer and writes them into the build, so the text is in the file before any script runs:

| Address | File | Kind |
|---|---|---|
| `/welcome` | `welcome/index.html` | the landing page, **hydrated** by the browser (heading, three figures, hiring companies, the example entry, calls to action, footer) |
| `/about`, `/methodology`, `/contact` | `about/`, `methodology/`, `contact/` | new plain pages (`src/InfoPage.jsx`), hydrated |
| `/` | `index.html` | the map: a heading, a sentence and the link to the plain list of every company (`/directory`) |
| `/lists`, `/investors` | `lists/`, `investors/` | a plain version of the page (every list with its count; every published investor), for search engines and visitors with no scripts |
| any other address (a company, jobs, news, deeper investor pages) | `app.html` | the same plain shell, with no canonical address of its own |

- **Hydrated** means the browser keeps the HTML and makes it live (`main.jsx`), so the text never flashes. The first render in the browser must equal the HTML, so: `Reveal` always starts as "not yet shown"; "Verified 3 days ago" is read as of the moment the snapshot was made until the page is up (`clock.js`); the landing page is hydrated only once the browser has the very snapshot it was built from (the root carries its time), otherwise it is drawn afresh. `tests/prerender.test.jsx` hydrates every hydrated page and fails on any mismatch.
- **Plain shell** pages (`/`, `/lists`, `/investors`, `app.html`) are hidden from a visitor whose scripts run (`html.js .static-shell`), and the app draws over them. They exist for search engines, link previews and no-script visitors. They are not hydrated: they are a different, simpler page than the app.
- A visitor with **no scripts** gets the page styled: the hydrated pages link their own stylesheets in the HTML (the build writes a note of which, `vitePreload.js`, and `prerender.mjs` uses and deletes it), and a `<noscript>` rule shows the content that otherwise rises into place. The `<noscript>` note links to the plain list of every company (`/directory`, served by the API).
- **`/people` is not pre-rendered.** With `VITE_SHOW_PEOPLE` off (as it is live) there is no People page, so that address opens the map; its content is not in any file the build has. If the people are ever switched on, add a plain version to `src/entry-server.jsx` from data the build can read.
- The map stays client-only and lazy: Leaflet is still fetched only by the map.

## What the build reads

`public/data/snapshot.json` (the figures; see `performance.md`) and `prerender-data.json` (the lists' counts and the investors; not served), both made by **`npm run snapshot --prefix backend`**. Remake them and commit both before a deploy, or the pages carry old counts. A snapshot older than 14 days is not used: the landing page is then built without figures and the browser draws it afresh (the build prints no error).

## The new pages

All three are short, link to each other, and are linked from the landing page's bar and footer (and the app's footer).

- **About**: who runs it (Aryan, a Monash University student, alone), why (founders ghost good candidates; startups are hard to find in one place), what is live and what is not yet. Five sentences, no numbers.
- **How we verify**: where facts are read from (a company's own website, careers page, the public job boards it links to), what *Verified &lt;date&gt;*, *Hiring now*, *Hiring (checked &lt;date&gt;)*, *Roles unverified* and *Unverified* mean (the 14-day and 60-day windows are the code's real ones), the real cadence (**no automatic schedule yet**: a person starts the checks by hand), how to ask for a correction or a removal, and what is not collected (no LinkedIn or Crunchbase scraping).
- **Contact**: a Tally form in a frame. Its address is `VITE_TALLY_CONTACT_URL` (`TALLY_CONTACT_URL_HERE` in `src/tally.js` until you make it). **Until then the page says the form is not set up yet and points to "Suggest an edit"**; no email address is anywhere on the site. The form should ask for: a name (optional), an email address to answer to, what it is about (correction, removal, question), what it concerns, a link to a page that shows it, and the message.

## Search and sharing

- Every pre-rendered page has its own `<title>`, description, `og:*` and `twitter:*` tags, and a canonical address (`src/siteMeta.js` holds the text and the address, `https://au-startup-map.vercel.app`; set `VITE_SITE_URL` if the site moves to its own domain).
- `og-image.png` (1200 × 630) is drawn by `node scripts/make-og-image.mjs` (needs Chrome or Edge) from the site's own type and the country in dots; it makes no claim. Remake it if the headline changes.
- `robots.txt` and `sitemap.xml` are written by the build and list the seven pre-rendered addresses (not `/people`).
- `vercel.json` serves each pre-rendered address from its file and every other app address from `app.html`.

## Checks

`tests/prerenderBuild.test.js` builds the site and runs the script, then checks every file (title, description, canonical, preview tags, the heading, figures and links in `/welcome`, the `<noscript>` link, the sitemap and `robots.txt`). `tests/prerender.test.jsx` checks what each page says and that the browser's first render equals the HTML. `tests/InfoPage.test.jsx` checks the three pages' claims.

## What it cost, and an open point (read before deploying)

- The landing page's HTML is 24 KB (about 6 KB gzipped); its decorative dot picture is drawn after hydration (its city names and counts are in the HTML), and hydration waits for the browser's first paint of the HTML (`main.jsx`).
- **On the slow-phone Lighthouse setting `/welcome` is less steady than before.** The previous, client-drawn build measured a largest paint of 2.3 to 2.5 s and a score of 97 on this laptop; the pre-rendered one measures 2.3 s in some runs and 3.4 to 4.0 s in others (score 85 to 97), because in about half the runs the browser's first paint came at 1.2 to 2.2 s instead of 0.2 s, with long main-thread tasks in between. The same HTML with no script paints at 0.3 to 0.75 s every run, so it is the scripts that sometimes hold the first paint, but splitting the page into separately hydrated parts, drawing the picture later and hydrating after the first paint did **not** remove it, and this laptop's own variance (software drawing, a network that stalls) makes small samples hard to read. Worth checking on a real phone or a hosted test (WebPageTest, PageSpeed Insights) after a deploy.
- Showing the hero at first paint instead of fading it in after hydration is the one change likely to make the largest paint reliably early (the headline would then be visible in the HTML itself). It changes how the page opens, so it is left to you: `.hero .reveal:not(.is-in){opacity:1;transform:none}` in `styles.css` does it.
- The other pre-rendered pages (About, How we verify, Contact) are 98 to 100 on a phone.

## Things that are the owner's to decide

- **The in-app "About &amp; sources" window still says the data is "based on public sources, including LinkedIn, press coverage, and VC/accelerator portfolio pages"**, while How we verify says nothing is taken from LinkedIn or Crunchbase and only a company's own pages verify a fact. Make the two agree (this work left the window as it was).
- The in-app Privacy window still has a placeholder for the operator's name, ABN and contact details; the landing page's footer now points to About and Contact instead.
