# People and curated lists

The People page (`/people`) lists the people and firms worth following in Australian startups, in four tabs: **Founders**, **Operators**, **Investors (people)** and **Institutions**. A curated list gathers some of them in an order the curator chose, and has an address to share.

Nothing on it is made up. Every entry is typed in by the owner, with the pages that back it; a field nobody has checked is left blank, not filled in. Nothing is copied from LinkedIn or any other site by machine.

## Where the entries come from

| What | From |
|---|---|
| Founders, operators, investors who are people | `backend/src/data/people_seed.json`, typed in by the owner |
| Investors (people) | also the investor people published in the Command Center (none yet), each beside the page that backs it |
| Institutions | `people_seed.json` `institutions`, **and** the investors published in the Command Center (19 today), which appear without being listed again |
| Lists | `people_seed.json` `lists` |

A firm or person already in the seed wins over the same name in the investor directory, so nothing is listed twice. A published investor's name opens its own page in the app (`/investors/<slug>`).

## `people_seed.json`

The file explains itself in its `_comment`. A **person**:

```json
{
  "id": "ada-example",
  "name": "Ada Example",
  "type": "person",
  "roleType": "founder",
  "title": "Co-founder",
  "orgName": "Example Co",
  "orgType": "company",
  "city": "Sydney",
  "whyFollow": "Built a thing people use.",
  "links": { "website": "https://ada.example", "linkedin": null, "x": null },
  "sources": [{ "label": "Example Co team page", "url": "https://example.example/team" }],
  "verifiedAt": "2026-10-01",
  "vouches": [{ "name": "Sam Lee", "role": "Investor", "note": "Backed their seed round.", "consented": true }]
}
```

- `roleType` is `founder`, `operator` or `investor`; `orgType` is `company`, `firm` or `null`.
- `whyFollow` is 140 characters at most.
- `links` are `http(s)` addresses or `null`. They open in a new tab with `rel="noopener noreferrer"`.
- `verifiedAt` needs at least one `source`: a check no page backs is not shown.
- A **vouch** is shown only where `consented` is `true`. Say yes or no for every one; a vouch with no answer is refused.

An **institution** is `{ id, name, type: "institution", city, stageFocus, sectors: [], website, sources, verifiedAt }`. A **list** is `{ id, title, description, curator, type: "people" | "institutions" | "companies", itemIds: [] }`; `itemIds` name entries of that kind (a company by its slug, a published investor as `investor-<slug>`), and the list shows them in that order. A list with no one on it is not shown.

An entry that does not meet the rules is left out of every answer, and named in the server's log; nothing is repaired. `backend/tests/community.test.js` checks the shipped file, so a slip fails `npm test` instead of the live site.

### The placeholders

The file ships with **three entries marked `"placeholder": true`**. They are not people: they show the layout while this is built. They appear only on a computer that sets `SHOW_PLACEHOLDERS=1` (for example `SHOW_PLACEHOLDERS=1 npm run dev`) and are served to nobody else, so the live site shows nothing for them. Delete them when the first real entry is added.

## The forms

Two Tally forms are the owner's to make: **nominate someone** and **request an edit or removal**. Until one is made, its button says the form is not set up yet (and, for the nomination, what it will ask) instead of linking to nothing. To set one up, make the form in Tally and put its share link (`https://tally.so/r/<id>`) in `VITE_TALLY_NOMINATE_URL` or `VITE_TALLY_REMOVAL_URL` on Vercel (or replace `TALLY_NOMINATE_URL_HERE` / `TALLY_REMOVAL_URL_HERE` in `frontend/src/tally.js`).

- **Nomination** asks for: name, a link, role type (founder, operator, investor), why they are worth following, and a checkbox "I am nominating myself or have asked them".
- **Removal** is opened from a card with `name`, `id` and `type` in the address; add them as hidden fields in the form so a request says which card it is about.

## The API

All are public, read-only, and 20 to a page (up to 100; see the README's Paging).

- `GET /api/people?role=founder|operator|investor&search=&list=` — `{ counts, total, count, results, offset, limit, hasMore, nextOffset }`. `counts` is how many are in each tab.
- `GET /api/institutions?search=&list=` — the same for the firms.
- `GET /api/lists` — the lists that have someone on them: `{ results: [{ id, title, description, curator, type, count }] }`.
- `GET /api/lists/:id` — one list in its own order (people, institutions or companies, as its type says).

What a visitor gets is only the public projection of an entry (`publicPerson` in `backend/src/models/community.js`): the vouches that were agreed to, links that are web addresses, and the fields a card shows; nothing else in the file is passed on.

## The page

`/people?tab=operators&list=<id>&q=perth`: the tab, a list and a word are in the address, so each is a link, and they apply when it opens. A list is its own view (its title, description and curator, how many it holds, **Copy link**, and **All people** to go back); the tab and the word do not apply to it. The first tab with someone in it is shown when none is asked for.

Every card is the app's one card and has **Request edit or removal**; every list of names has an index row at the top.
