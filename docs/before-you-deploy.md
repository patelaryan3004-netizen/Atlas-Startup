# Before you deploy: what to check by hand

Written at the end of the staged rebuild (Stages 0 to 9, 2026-10-13). Stages 0 to 6 are already live. **Stages 7, 8 and 9 are built and tested but not committed**, and nothing here has been deployed. Every number below was read from the real data on that day; re-run the commands in "Preview" for today's.

## Preview locally

Run from the project root, in PowerShell. The first line frees the ports if an earlier preview is still running.

```powershell
# 1. Everything, with the people switched ON (what you will see after you flip both switches). Site 5173, API 4000.
Get-NetTCPConnection -LocalPort 4000,5173,5174 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
$env:VITE_SHOW_PEOPLE = '1'; $env:SHOW_PEOPLE = '1'; npm run dev

# 2. What is live today: the people switched OFF (both switches unset). Use a fresh terminal.
Remove-Item Env:VITE_SHOW_PEOPLE, Env:SHOW_PEOPLE -ErrorAction SilentlyContinue; npm run dev

# 3. Side by side: the site with the people off on 5174, against the API of copy 1
cd frontend; Remove-Item Env:VITE_SHOW_PEOPLE -ErrorAction SilentlyContinue; npx vite --port 5174 --strictPort

# 4. The tests (backend, then frontend) and the production build
npm test
npm run build --prefix frontend
```

Open http://localhost:5173 and look at: `/` (map), `/?view=list`, `/jobs`, `/lists`, `/news`, `/investors`, `/investors/airtree`, `/people`, `/startup/canva`, `/welcome`. Try each at 375px wide (browser dev tools, device toolbar) as well as full width.

## Pins (the map)

- [ ] Zoom to the Sydney and Melbourne centres and open about five pins in each. The card shows the name, one line, "Hiring now" only where it is true, and under "More" an address that matches the company's own site.
- [ ] 148 companies have an exact pin and 11 a suburb pin (159 on the map). The 11 are drawn as approximate; open two and read the wording under "More".
- [ ] 43 companies are known only to a city and have **no pin** on purpose: they show as grey "Sydney 34 city-level" groups. Click one: it opens the list. 14 have no location at all and are not on the map.
- [ ] The location problems still open (nothing was changed by this work): 9 where a geocoder puts the address somewhere else, 6 pins shared between companies at different addresses, 2 on a city centre, 2 closed or acquired, 112 addresses not yet checked against a source. Look at the worst first: `npm run locations --prefix backend -- review --issue geocode_disagrees`.
- [ ] On a pin for a hiring company, "Report: role closed" opens the edit form with the sentence already started. It is not shown on a company that is not hiring.
- [ ] Light and dark map, the Layers buttons, the Key, and the panel on the left (open by default only on wide screens).
- [ ] The basemap is OpenStreetMap. **No Mapbox token exists anywhere**, so nothing uses Mapbox yet. To use it: put a public token in Vercel as `VITE_MAPBOX_TOKEN` (restrict it to your site's address in Mapbox), and for geocoding the firms' offices set `MAPBOX_TOKEN` in your own shell only, then `node backend/scripts/institution-pins.js geocode --provider mapbox` (it lists any match under 0.85 relevance for you to check, and draws none of them).

## People and firms (behind the two switches)

- [ ] Both switches are OFF by default: `VITE_SHOW_PEOPLE` (Vercel, read when the site is built, so redeploy after changing it) and `SHOW_PEOPLE` (Render). With them off there is no People page, link, section or pin, the people API answers 404, and no named person is anywhere on the site. Check the live site after the deploy: `curl -i https://atlas-startup.onrender.com/api/people` must say 404.
- [ ] With them on, `/people` has four tabs. There are **28 people** (12 founders, 7 operators, 9 investors). **22 are "medium" confidence**: open every one's source link and read that it says what the card says before you notify anyone.
- [ ] The 5 people on `hold` are never shown. Search the page for each name.
- [ ] **No vouch has been recorded** (0 that a person agreed to), so no quotation appears anywhere. A vouch only goes in with the person's agreement.
- [ ] `institutions_seed.json` does not exist yet. The Institutions tab shows the 19 published investors; no firm has an office pin. When you have the file: `node backend/scripts/seeds.js check`, then `install`, then the geocode step above.
- [ ] **The GitHub repository is public.** `backend/src/data/people_seed.json` (28 named people, with the notes on the held ones) and `people_seed.json` in the project root are not committed. Committing them publishes those names whatever the switches say. Decide first: keep both out of git and give Render the file as a secret file, or accept that.
- [ ] The nomination and removal forms are placeholders (`VITE_TALLY_NOMINATE_URL`, `VITE_TALLY_REMOVAL_URL`): the pages say "not set up yet" rather than link to nothing.

## Links, forms and facts

- [ ] **Waitlist**: opens your Tally form `kdVrGo`. Its cover reads "Roventra". The line above it, "Get early access to task-gated startup applications.", is yours, but the site elsewhere calls task-gated applications a concept preview. Decide whether both stay. To use another form: `VITE_TALLY_WAITLIST_URL`.
- [ ] **Submit a startup**: the Tally form is not made, so the site's own form shows (name, website, city, your role, "Do you want to claim this profile?", plus a one-line description and stage). To switch to Tally, make the form with those five questions and set `VITE_TALLY_SUBMIT_URL`.
- [ ] From `/jobs`, click ten "View open roles" links. Each must land on a real job page. 21 companies are "hiring now" (a page confirmed their roles in the last 14 days) and 3 more say "Hiring (checked 5 Oct)".
- [ ] Websites: 4 domains are dead (Zoomo, DataMesh Group, Gloss Guide, PentaCue AI), 14 redirect (listed, not changed), 3 careers pages are LinkedIn only (Marqo, Unloan, Andisor). The site says "Website unavailable" for a dead one, not a link.
- [ ] 14 companies carry the "Unverified" badge, and 73 of 216 have no verified date (nothing is shown for them).
- [ ] Investors: 19 published. Four named firms are still unverified (Tank Stream, Skip, Investible, Startmate). 58 portfolio links are recorded; `link --apply` has not been run.
- [ ] Pass 2 (remote policy, tech stack, last role seen, read from the 24 verified companies' own postings) is staged in `backend/scripts/enrich/pass2_findings.json` and **not merged**. Until it is, those facts show nowhere.
- [ ] There is no sitemap, so nothing can list a person or a firm there.

## Design (Stage 9), checked by machine; look at it too

- [ ] Tab through `/welcome`, `/jobs`, `/investors` and the company panel with the keyboard only: every control shows a green focus ring, the dialogs keep focus inside and give it back.
- [ ] Switch your system's animations off (Windows: Settings, Accessibility, Visual effects, Animation effects). The landing page shows everything at once, the picture stops, the map still zooms.
- [ ] The company panel opens on the company's own colour. It is a light colour for most sectors, so its text is dark; check two or three sectors.
- [ ] The text sizes beyond a headline are 15px and 13px on every content page (the line under a headline is 17px). The map's own controls (header, search, filters, key, tooltips) keep their compact sizes on purpose.

## Deploy, when you say so

1. Look at what changes: `git status` and `git diff --stat` (about 50 files changed, 1,100 lines added, 600 removed, plus new files). Say "commit" and it is committed; nothing is pushed until you say "push".
2. Pushing to `main` deploys the API on Render by itself. Leave `SHOW_PEOPLE` unset.
3. The site: `vercel deploy --prod --cwd frontend`, from a clean copy (the command uploads the working copy, so uncommitted scratch files would go too). Leave `VITE_SHOW_PEOPLE` unset.
4. Check the live site: the map, `/jobs`, `/investors`, `/welcome`, the waitlist, the submit form, `/people` (must open the map), and the 404 above.
5. When the people have been told: set both switches, redeploy the site (the Vercel one is read at build), and check `/people` live.
