# The hiring desk (`/jobs`)

"The hiring desk." replaces the old Jobs list. Same address, same Jobs / Events tabs under Opportunities, same saved-role ids, same "Suggest a role". Only `/jobs` changed: the page carries the class `jd`, every rule in
`src/jobs.css` is under it, and the header's night skin is the one the map page uses (`atlas.css`, shared through `:is(.xp-atlas, .jd)`). The homepage, Events, the investor directory, `/map` and its pins are untouched.

## What a visitor sees

- A heading, "The hiring desk.", and "Find your next team in Australia. Apply directly with the people hiring."
- Four cards: **Melbourne, Sydney, Perth, Remote AU**. Real photography for the first three (Unsplash, bundled in `public/img/jobs/`, credited under "Photography" on the page), the Australian outline for Remote AU. Each shows
  **how many open roles match** (counted, never typed: `jobsBoard.placeCounts`). A role open in two cities is in both cards and counted once in "All Australia". Pressing a card narrows the list; pressing it again clears it.
- Below: a compact list on the left (the company's mark or initials, the role, the company, where it is worked and how, when it was last **confirmed**, the bookmark) and **Who's hiring.** on the right (companies with a role among those
  that match; pressing one filters the list). On a phone the cards are two columns, then the roles, then the index.
- Pressing a row opens the role: where it is worked, **Remote from Australia** with the employer's own words as the evidence, working arrangement, employment, level (only as the title names it), team, and the three dates apart
  (posted by the employer, first listed here, last confirmed), then **Apply at {Company} ↗** on the employer's own site (a new tab that cannot reach back). Anything the employer did not say is left out, not written as "Not stated".
- Search (`/` jumps to it), a location menu (All Australia, the four, the other capitals, "Elsewhere in Australia"), and **Filters** (sector, stage, level, employment, working arrangement) behind one button. The default shows every
  sector. `?sector=Unknown` still works and is called **"Sector not supplied"**. The old `?city=Sydney` and `?remote=yes` addresses still open the board on that place. The address follows the filters and the open role.
- **Saved** shows the roles saved on this device (or in the account). A saved role the employer has taken down stays, with its true status ("No longer listed by the employer", "Closed by the employer", "Not rechecked since …") and no apply link.
- **Suggest a role** is the existing form and queue, unchanged.
- The stamp under the heading says when the employers' boards were last read **whole**, from the sync's own records; if that was more than six hours ago it says the hourly check has not run since. "See feed coverage" lists the boards that are
  read, those that are approved but unreadable yet, and those waiting for a person to confirm: it is not every company, and says so.

## Where the numbers come from

`GET /api/jobs/board` (`backend/src/network/board.js`) returns the whole board in one answer: every open role a visitor can work in Australia that was confirmed within two weeks, the roles a bookmark may still point at, the totals, and the sync's
account of itself. The page counts, filters, searches and sorts it in the browser, so a tap on Melbourne answers at once and every number on the page comes from the same list. `GET /api/jobs` keeps working for a list by id (a person's
saved roles: any status), by `place` (where it is worked) and by the filters it always had; its `city` is still the **company's** city.

The page draws a **saved copy** of the board first (`public/data/jobs-board.json`, made by `npm run snapshot` in `backend/`, ignored after 14 days), then the server's answer replaces it. If the server cannot give one (it is asleep, or is
an older server without the endpoint), the saved copy stays and the page says it is a saved copy and from when.

## Files

`src/components/network/JobsBoard.jsx` (the page), `src/components/jobs/parts.jsx` (cards, rows, index, dialogs), `src/jobsBoard.js` (the logic, tested without a page), `src/jobs.css`; on the server `network/jobs.js` (the role as presented),
`network/board.js` (the board), `jobsync/` (reading the boards, [jobs-sync.md](jobs-sync.md)).

## Photography

Melbourne (Flinders Street Station) and Sydney Harbour: Unsplash; Perth at Elizabeth Quay: Urlaubstracker (urlaubstracker.de), Unsplash; Remote AU: Natural Earth's coastline, the same as the map. Credited on the page and here.

## Tests

`frontend/tests/jobsBoard.test.js` (the logic), `frontend/tests/network/opportunities.test.jsx` (the page), `backend/tests/jobBoard.test.js` (the board and the list API), `backend/tests/jobsync.test.js` (the sync).
