# The community: accounts, Home feed, saved items, Opportunities

Added 2026-10-28 (not yet committed or deployed). One small layer on top of the directory: people can join, post short notes, reply, like and bookmark; save startups, investors, roles, events and people; suggest a role or an event for review; and moderators read reports and approve suggestions. Everything real is kept by the server. Nothing is invented, and nothing pretends to be a live community when it is stored in the visitor's browser.

## What is where

| Place | What it is |
|---|---|
| `backend/src/network/` | the whole server side: `store.js` (one JSON file, written atomically), `auth.js`, `members.js`, `feed.js`, `saved.js`, `events.js`, `jobs.js`, `suggestions.js`, `index.js` (availability), `router.js` (every address), `validate.js` |
| `backend/src/data/events.json` | the curated events, each with the page it was read from and the day it was read |
| `backend/.network/network.json` | the community's data on a developer's machine (git ignores it) |
| `frontend/src/components/network/` | Home feed, composer, post card, reports, sign-in dialog, profile and editor, Discover People, Jobs board, Events board, Saved, Moderation |
| `frontend/src/{networkApi,session,savedStore,authUi,navigate}.js` | the API client, the session, where saved things live, the sign-in dialog's state, in-app moves |

## Addresses (frontend)

`/` the welcome page (the homepage; `/welcome` is redirected to it); `/home` Home; `/map` the map page; `/discover` Startups (list; `?view=map` the map); `/discover/people`; `/investors…`; `/startup/<slug>`; `/jobs` (also `/opportunities`); `/events`; `/me` your profile; `/members/<id>`; `/saved`; `/moderation` (linked from nowhere). The welcome page (`/welcome`) is unchanged. Three places in the header and on a phone's bottom bar: Home, Discover, Opportunities; profile, saved and sign out are under the avatar.

## API (all under `/api`)

Public: `GET /network/status`, `/feed`, `/feed/:id`, `/members`, `/members/:id`, `/events`, `/events/:id`, `/events/:id/calendar.ics`, `/jobs`.
Needs an account: `POST /auth/signup|signin|signout`, `GET|PATCH|DELETE /account`, `POST /account/password`, `POST /feed`, `PATCH|DELETE /feed/:id`, `POST /feed/:id/replies`, `PATCH|DELETE /replies/:id`, `PUT|DELETE /feed/:id/like`, `POST /feed/:id/report`, `POST /replies/:id/report`, `GET|PUT /account/saved`, `POST /account/saved/merge`, `POST /suggestions`.
Moderator (header `x-admin-key`, the `ADMIN_KEY` variable): `/admin/network/summary|reports|reports/:kind/:id|suggestions|suggestions/:id/approve|reject|listings/:kind/:id/withdraw|members|members/:id`.

The account address is `/api/account`, not `/api/me`: the Command Center owns `/api/me`, and a test (`adminIsolation.test.js`) pins that the public server answers 404 there.

## Accounts

Email and password. Passwords are hashed with scrypt; a session token (`se_…`) is sent as `Authorization: Bearer` and only its SHA-256 is stored; 30 days. Limits: 6 sign-ups an hour per address, 8 sign-ins per 15 minutes per email and address, 12 posts an hour, 40 replies, 30 reports a day, 10 suggestions a day. Unknown emails take as long as known ones. There is no email check and no password reset: there is no mail service to send them. Profile photos are not offered (initials only): there is nowhere to keep files.

## Home feed

Five kinds of short post: an idea, a question, what you are building, a request for feedback, a small win. Posts up to 600 characters, replies up to 400, at most two links. Filters: All, Ideas, Building (building, feedback, wins), Questions. There is no Following filter because there is nothing to follow. Authors edit and delete their own (the server checks; a deleted post keeps no words). Anyone signed in can report a post or reply; three different reporters hide it for everyone but its author until a moderator decides. Moderator actions: leave it up, hide, restore, remove, remove and suspend the author; each is written to an audit list.

## Saving

Startups, investors, roles and events can be saved without an account: they stay in this browser (`auStartupTracked`, `auStartupSavedInvestors`, `stillEarlySavedJobs`, `stillEarlySavedEvents`), and the Saved page says so. Posts and people need an account. On signing in, what the browser held is added to the account (nothing is ever removed by that); on signing out the browser's own list is back.

## Opportunities

**Jobs** come only from the directory's own careers-page reads (`jobs.json`) for companies in the catalog. Generic rows ("Careers", "Open roles"), closed rows and unknown companies are left out. Each shows the role and company, where it is, remote or not (only when the page says), employment type and level read from the title, a plain reason it is listed, the employer's own application link, and the day it was last read. A board where every read is older than 14 days says so at the top. There is no salary and no experience field because nothing in the data states them. Overseas roles are behind an "Overseas" choice and never shown as Australian.

**Events** come from `events.json` plus approved suggestions. A record needs: name, organiser, starts (and ends, if known), an Australian IANA timezone, a place or a link, who it is for, why it is listed, the registration page, the page the facts came from and the day it was read. Cost is "free" or "paid" only when the page says so; otherwise "not confirmed". Past events are hidden by the clock (no end time means three hours after the start; a day with no time lasts until the end of that day). Each has an `.ics` download with a reminder a day before, and a Google Calendar link. `eventProblems()` is the single validator for both curated and approved events.

To add an event: open the organiser's page, read it, add a record to `events.json` (see any existing one), run `npx vitest run tests/networkStore.test.js` (it checks every record). Never copy a date from a search summary: two events that only a summary mentioned did not hold up on their own pages and were left out.

**Suggestions**: "Suggest a role" / "Suggest an event" on the boards need an account. A suggestion is stored as pending and is not public. A moderator opens the page, checks every fact, fills in what the page says (time zone, audience, reason, source day; for a role: the day the employer's page was read and a factual reason), and only then does "Approve and list" put it live. Withdrawing a listing later is one more moderator action.

## Moderators

Open `/moderation`, type the key. The key is held in the page's memory only and is sent with each request; the server compares it in constant time and locks out repeated misses. The page lists open reports, pending suggestions and members (search; suspend or lift).

## The one thing that must be connected before this goes live

The server keeps the community in one JSON file. Render's free plan erases its disk on every restart, so an account or post made there would silently vanish. For that reason the community is **closed** on Render until `NETWORK_DATA_DIR` points at a disk that survives restarts (Render Starter with a persistent disk, or a mounted volume) — the API answers `503 network_unavailable`, the pages say the community is not open yet, and the curated events and jobs still show. On a developer's machine it opens by itself (folder `backend/.network`). `NETWORK_ENABLED=0` closes it by hand. Also set `ADMIN_KEY` for moderation. A database would be the better long-term store; the file store is fine for the first few thousand people.

## Not built, and why

Email checking and password reset (no mail service). Profile photos (no file storage). Following (no one to follow yet). Groups, chat, trending (not wanted). Salary and experience on roles (not in the data). Introductions or any "member" status for directory people: Discover shows members and directory records separately and says directory people have not joined.

## Tests

`backend/tests/network.test.js` and `networkStore.test.js` (accounts, ownership, feed, reports, saving, events, jobs, suggestions, restarts); `frontend/tests/network/` (Home, accounts, Opportunities, saving and Discover People, moderation).
