# Data Command Center

A private page for deciding what is true enough to publish. It shows what discovery found, what is missing, what disagrees, and what the enrichment pipeline read, and every decision is made by a named person and recorded.

It is **not** part of the public site. It runs on your own machine, listens on `127.0.0.1` only, and refuses to start on Render or with `NODE_ENV=production`. Two reasons: Render keeps no disk (state lives in git), so a change made there would be lost; and a page that can publish companies must not be reachable from the internet.

## Run it

From `backend/`:

```bash
npm run admin -- init --name "Your name"    # once: makes the first admin and shows their token ONCE
npm run admin                               # then open http://127.0.0.1:4010 and paste the token
npm run admin -- add-user --name Riley --role reviewer
npm run admin -- users                      # who can sign in, and as what
npm run admin -- revoke --name Riley
npm run admin -- serve --port 4020 --data /path/to/a/copy/of/the/data   # work on a copy
```

Only a hash of each token is stored (`backend/.admin/users.json`, gitignored). A lost token cannot be recovered: revoke the user and make a new one. Every change the page makes is a change to the JSON files in `backend/src/data/`, so review and commit them like any other change.

## Roles

| Role | Can |
|---|---|
| `viewer` | look at everything: the dashboard, candidates, evidence, the audit trail |
| `reviewer` | decide about candidates (approve, reject, edit, reopen, note, "not a duplicate"), dismiss a suggestion, queue a website, retry or cancel a task, acknowledge a failed import, look an address up on the map (that changes nothing) |
| `admin` | everything that changes what the **public** sees: merge a candidate into a company, publish one, settle a conflict, apply a suggestion, set where a company is on the map, seed and run the enrichment queue |

The line is drawn at the public record: until something reaches a company, a mistake costs a reviewer's time. The check is made in the service, not only in a route, so no door into it can skip it.

## What is on the page

Eight counts at the top, each a link to where it is worked:

| Count | Means |
|---|---|
| Total companies, Published | every company in the directory (all are listed), split into pins on the map, city-level (a group at its city, no pin) and unconfirmed |
| New candidates | found in the last 7 days and still open |
| Needs review | waiting for a person: new companies and possible duplicates |
| Potential duplicates | open candidates that look like a company we have, plus pairs of published companies that look alike |
| Updated this week | companies edited or re-verified in the last 7 days |
| Missing data | companies lacking a website, sector, location, stage or description (the list behind it is under Data quality) |
| Failed imports | sources whose latest import failed and nobody has looked, plus enrichment tasks that failed |

Then, in order: **New startups discovered** (Approve, Reject, Edit, Merge, Publish, and a review drawer with the evidence), **Data quality** (coverage for website, sector, location, stage, founders, funding and investors, and who is missing what), **Locations** (how well each company's place is known, and the review queue: see below), **Conflicts** (two sources disagree, or one disagrees with our record: a person says which is right, with a reason), **Suggested fills** (facts found on websites that the record lacks: apply or dismiss), **Enrichment queue** (seed, run in suggest or fill mode, watch it, retry), **Failed imports**, **Scheduled refresh** (read only: the six jobs and when each last ran and runs next, how far each company fact is behind its clock, the status watch of companies whose website moved, was renamed or says it was acquired or closed, the sources and the websites being left alone, and the recent runs; the scheduler itself is run from a terminal, a timer or CI: see [scheduler.md](scheduler.md)), and the **Audit trail**.

### Locations

A location is the careful case, because a pin on the map is public and a pin says "here". The **Locations** section shows five counts, as the directory knows them today (exact, suburb, city-only, state-only and unknown locations), six flags (duplicate coordinates, city-centroid coordinates, location conflicts, missing coordinates, potentially stale locations, addresses not checked), and the **review queue**: every company whose place a person should look at, worst first, with its city, its latitude and longitude, how exactly it is known, where that came from, and what is wrong with it. Pick a flag or one kind of problem to narrow it.

An admin presses **Set location** on a row to say where the company is, and how exactly they know: an exact office (an address and a point), a suburb (a suburb and a point, drawn as approximate), only the city or only the state (no point at all: the company is a group on the map, never a pin), or not known (takes it off the map). **Find on the map** asks OpenStreetMap about the address (one question a second, the answer kept so the same address is never asked twice), says how exactly it found it and whether it agrees with the point on file, and fills the coordinates in for you to check; you can also read them off a map yourself. Where you found it is part of the record (the company's own page needs its link; LinkedIn and other personal profiles are refused: they say where a person is, not where the company is), and so is why. Publishing a candidate, settling an address conflict and applying a suggested address use the same form. The page never guesses coordinates. The same work can be done in bulk from a terminal (`npm run locations`); see [locations.md](locations.md).

## The audit trail

Every action writes exactly one row, in the same write as the change: who (from the sign-in, never from the request), what, to what, why, and each field's before and after. A refused action writes nothing. The trail is append-only: a change that would alter or remove an earlier row is refused. The enrichment worker writes its own rows as `enrichment`, the CLI as `cli`, and a scheduled job that found something leaves one row (`scheduler.run`, by `scheduler`).

## How it is protected

- Never mounted by the public app, never imported by it (a test follows the import graph). Its addresses answer 404 on the public server.
- Loopback only; a request must carry this machine's own `Host`, so a web page cannot reach it through a DNS trick. A change must come from the page itself (same origin) as JSON. No CORS headers.
- The token is an `Authorization` header, never a cookie, so another site cannot make the browser send it. After too many wrong tokens everything is refused for a minute. Refused and failed attempts go to `backend/.admin/security.log`.
- A strict content policy: only its own script and style, no inline anything. The page builds everything with `textContent`, because company names and page titles come from websites we do not control. `tests/adminUi.test.js` reads the source for each promise.
- Errors never carry a stack, a path or a token.

## Limits

- One person at a time is the design. Two people editing the same files will be told ("the data changed") instead of overwriting each other.
- It cannot merge two **published** companies; it reports pairs that look alike so you can correct the data files.
- It changes files on your disk. Nothing reaches the public site until you commit and push them.
