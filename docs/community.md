# The Community (v1)

The page at `/home` (also `/community`) is the Community: a place to find people to build with and ways to contribute to Australia's startups. It is one page on the existing site, in the site's own components and tokens (`frontend/src/community.css`), and it leaves Map, Discover and Jobs alone. Its look is the welcome page's night (navy, ivory text, butter gold for the choice you make) over the site's ground (ivory, white rows, green for what can be pressed).

## What is live today, and what is not

The members' side of the site (accounts, posts, profiles, projects, introductions) needs somewhere to keep what people write. Render's free disk is erased on every restart, so the server answers `network_unavailable` and **the Community is closed there** (see [network.md](network.md): it opens when `NETWORK_DATA_DIR` names a disk that survives restarts). So:

| | Today (closed) | Once a durable disk is attached |
|---|---|---|
| The question and the eight choices, the three columns, the sections | live | live |
| Products, new companies, founders named on public pages, investors, collections, hiring companies, roles, events | live, from the directory, the hiring desk and the events list | the same |
| Founding-member list | live: a waiting list, no account | live (an account is better) |
| Profiles, projects, "I'm interested", recommended connections, introductions, the short posts | **built and tested, not offered**: the page says so | live |

Nothing pretends to work while closed: no posting, no member list, no "recommended" person, no project. Where a block has nothing it says so ("Nothing was added this week", "No project has been shared yet").

## The question

"What would you like to do today?" offers eight things: find people to build with, find a co-founder, contribute to a startup, find a startup job, meet founders or investors, get feedback on an idea, find talent for my team, explore the ecosystem. None is required. A choice is a toggle (press it again to clear it), is kept in this browser and in the address (`?for=cofounder`, so a link carries it), and sends nothing anywhere. What a choice changes is written down in `components/community/intents.js` (`PLANS`): which blocks lead the "For you" section, which kind of project to look for, and one sentence saying what it brings. It never hides the rest of the page.

## The page

Three columns on a desktop; on a phone the content comes first, the sections become a row of tabs under the question, and the right column follows the content.

- **Left**: For you, People, Projects & ideas, Products, Curated lists (`?section=people|projects|products|lists`).
- **Centre**: what the section says. "For you" shows up to three blocks the choice leads with: projects and collaboration requests, members, ideas and discussions, products being built in Australia, new in the directory, startups hiring now, open roles, founders in the directory, investors, events.
- **Right**: people to meet (founders named on public company pages: labelled "Directory, not a member", with no way to message them), recommended connections, curated collections, upcoming events.

Every block says in one line what it is made of. **None is a ranking, an endorsement or a feature chosen by the site**: products are verified companies with a picture first; "new" is the directory's own one-week rule; hiring companies are the ones on the hiring desk, in alphabetical order; collections are filters with the rule beside them and the server's own count (fintech, early-stage Melbourne founders, AI, investors whose pages state Pre-seed or Seed: `collections.js`). An event only changes order with the choice; none is hidden.

## Profiles: members and directory records are different things

A **member** profile is claimed and written by the person: who they are, where, what they bring (skills), sectors they care about, what they are looking for (the eight choices), what they are building, previous projects and contributions, LinkedIn, GitHub and portfolio links, whether they can work remotely, how they like to work, and a **private contact line** used only for introductions. It is labelled "Member", and nothing on it is checked or vouched for by the site. A **directory** record (a founder named on a company page, an investor) is what the directory holds, is labelled "Directory, not a member", and the site offers no way to contact them. The skills, goals and sectors are closed lists (`backend/src/network/taxonomy.js`), so matching compares ids, not spellings. The sectors are the directory's twelve display sectors.

## Projects and "I'm interested"

A member can share up to five open projects: name, description, the problem, stage (idea, prototype, being built, launched), skills needed, kind of help (co-founder, contributor, early team member, advisor, feedback), sectors, and a city or remote. They are listed newest first and are exactly what the author wrote. "I'm interested" tells the author someone would like to talk and shares no contact detail; the author sees the interested people's public profiles only. Projects can be reported like posts (three different people hide one until a moderator looks; moderators use the existing reports queue with the admin key). Deleting an account removes its projects, the interest it gave and received, and every introduction it was in.

## Matching and introductions

`backend/src/network/matching.js`: plain points, no model, the same answer every time, and every match says why in a sentence. A pair needs 4 points **and** a reason about what they want or can do (a shared city is never enough): goals that fit (the same goal, or complementary ones such as "find a startup job" and "find talent for their team") +3 each, up to two; a skill one brings and the other does not list, when the other wants skills, +2 each, up to two; sectors in common +2 each, up to two; the same city +2 (or both remote +1); ways of working in common +1 each, up to two. Only members who chose to be listed are suggested, never yourself, a suspended member, or someone you already have an introduction with. Projects are matched the same way against your skills, goals, sectors and place.

An introduction needs **both** people. You send a short note with the reasons you were suggested; the other person sees who is asking and why, and accepts or declines. Only after they accept does either see the other's contact line, and both must have set one first, so nobody's contact is shown without them having said how they want to be reached. The site sends no email: requests appear in the profile page (`/me`). A decline blocks the same request for 30 days; at most eight requests wait at once.

## The founding-member list

While the Community is closed, "Join the founding list" (`POST /api/founding-members`) takes a name, an email, a city, what the person would like to do, skills, a few lines about what they are building and looking for, an optional link, and a tick that says we may keep it and that this makes no account. It is a **waiting list and nothing more**. The email is never public. The list is kept in `founding_members.json` in the network folder (git-ignored) and read with the admin key (`GET /api/admin/network/founding`). The page says that no email is sent automatically, and, where the folder is erased by a restart (Render's free plan), that a very recent sign-up can be lost. **Open decision for the owner**: reading the list and writing to the people on it is a manual job, and a durable disk (or an external form) is what makes it dependable.

## Where the code is

| | |
|---|---|
| `backend/src/network/` | `taxonomy.js`, `members.js` (profile fields), `projects.js`, `matching.js`, `introductions.js`, `founding.js`, `router.js` (every address), `index.js` |
| `backend/tests/community.test.js` | 21 tests: profiles, projects, interest, reports, matching, introductions, leaving, the founding list |
| `frontend/src/components/community/` | `CommunityPage`, `IntentPicker`, `blocks`, `ProjectsPanel`, `Introductions`, `FoundingForm`, `FeedPanel`, `intents`, `collections`, `useCommunity` |
| `frontend/tests/network/community.test.jsx` | the question, the closed state, the founding list, the open state |
| `docs/community-screenshots/` | desktop and mobile screenshots (the open-state ones use labelled test members from a throwaway store, never part of the product) |

## Not built (v1)

Email or push notifications, messaging, profile photos, following, groups, endorsements or references, ratings, any ranking, any model-written text. Matching and every list are deterministic and free to run.
