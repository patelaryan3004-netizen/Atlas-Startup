# Discovery engine

Finds candidate Australian startups, checks them against the companies we already have, and queues them for a person to approve. Nothing it finds is public until a person publishes it.

```
source -> lead -> seen before? -> existing companies and candidates -> deduplicate
       -> Australian? -> startup? -> enrich -> confidence -> review -> publish
```

Everything runs from `backend/` with `npm run discovery -- <command>` (add `--data <dir>` to work on a copy of the data files).

## What it can and cannot do to the data

| Step | Who | Effect |
|---|---|---|
| `run` | the engine | writes `candidates.json` only. It never approves, never publishes, and changes no company unless you pass `--apply-exact` |
| `approve`, `reject`, `distinct`, `merge`, `publish`, `rename` | a person, named with `--by` | every decision is recorded with who and when |

`candidates.json` and `identifiers.json` are read by no route. `/api/startups` and `/directory` read `startups.json` alone, and a test pins that.

## Statuses

Every discovered company enters as `candidate`, then the pipeline moves it on.

| Status | Meaning | Reached by |
|---|---|---|
| `candidate` | just found | the engine |
| `needs_review` | processed, waiting for a person (a new company, or a possible duplicate) | the engine |
| `matched` | an exact duplicate of an existing company; its enrichment is staged | the engine |
| `rejected` | not Australian or not a startup (explicit evidence), or a person said no. Kept, so it is not rediscovered | the engine (auto) or a person |
| `approved` | a person says it is a new company | a person only |
| `merged` | confirmed to be an existing company and enriched into it | a person, or the engine for an exact match with `--apply-exact` |
| `published` | became a company | a person only |

## Deciding whether it is one we already know

Compared with every company and every pending candidate. Strongest signal first: ABN/ACN, then website domain, then name, with city, address and founders as corroboration only.

| Outcome | Meaning | What happens |
|---|---|---|
| `EXACT_MATCH` | the same entity | enrich the existing record |
| `LIKELY_MATCH` | very probably the same | a person decides |
| `POSSIBLE_MATCH` | worth a look | a person decides |
| `NEW_COMPANY` | nothing resembles it | goes on through the checks |

Rules that keep it safe:

- **Exact needs a website domain or registry number *and* a compatible name.** A domain alone could be a typo, a forged submission or an acquirer's site, so a matching website with a different name is a `LIKELY_MATCH` to judge (a rebrand? an acquisition? the wrong website?).
- **A name alone is never exact.** "Leonardo.Ai" and "Leonardo AI" normalise to the same name, so with no website it is a `LIKELY_MATCH` for the existing record (never a new company, never silently merged); with `leonardo.ai` it is exact.
- A different website or registry number next to a matching name is a recorded conflict and holds the match below exact. A website shared by two existing companies makes neither match exact.
- Names are read against aliases, former names and legal names, including those the legacy data keeps inside the name (`Hone (HoneAg)`, `Brumby (formerly GrazeMate)`) and those in `identifiers.json`. A rebrand keeps its old name: `npm run discovery -- rename`.
- Enrichment only ever adds evidence and identifiers, fills fields the record leaves unknown (founders, founded year, website), and adds a name as an alias only when the match was strong or a person confirmed it. It never overwrites a value.

Every match stores the signals, conflicts and plain-language reasons behind it. `npm run discovery -- resolve --name "X" --website url` answers "have we seen this?" without writing anything.

## Where it looks

A source states why we may use it (`license.basis`), and a source without a valid licence is refused when loaded, not run.

| Source | Licence basis | Notes |
|---|---|---|
| `rss.startupdaily-funding` | `public_feed` | the publisher's funding feed. Headline, link and date only; the article is never fetched |
| `submissions` | `user_submission` | the submit form's queue. Set `DISCOVERY_SUBMISSIONS_URL` and `ADMIN_KEY` to read the live queue; the submitter's email is never copied |
| a `structured-feed` | `open_data`, `licensed_api` or `permitted_page`, with an attestation and terms link | a licensed API or an open dataset, JSON or CSV, by config. Nothing is enabled by default |

To add a source: write an adapter in `src/discovery/sources/` that returns leads, register it in `sources/index.js`, add an entry in `config.js`. An adapter decides nothing about a lead.

### The rules every read follows

All network reads go through one fetcher (`src/discovery/http.js`), so no adapter can skip them:

- LinkedIn is never read (including subdomains and its link shortener), nor are proprietary startup databases (Crunchbase, PitchBook, Dealroom and others) or search-result pages. A licensed API gets its own adapter and credentials; it is not scraped.
- `robots.txt` is always read and obeyed, including `Crawl-delay`. If it cannot be read the site is treated as closed.
- At most one request per host every couple of seconds; a host that answers 429 or 503 is left alone for the run.
- A 401 or 403 is final: no retry, no other user agent, no cookies, no credentials. A redirect to a login page counts the same.
- An honest user agent (`AUStartupMapBot`, set `DISCOVERY_USER_AGENT` to change it). Several publishers block AI-training crawlers in `robots.txt`; this engine reads feeds to find company names, and stops if a site disallows it.
- No internal addresses (localhost, 10.x, 169.254.x, ...) by name or by what a name resolves to, at every redirect hop.
- Bounded: timeout, response size, redirect limit, expected content types. At most three pages of a company's own site, found by following links, never guessed.

## Reviewing

```bash
npm run discovery -- list --status needs_review
npm run discovery -- show cand-trendspek
npm run discovery -- enrich cand-trendspek --website https://example.com --by "Your Name"
npm run discovery -- approve cand-trendspek --by "Your Name"
npm run discovery -- publish cand-trendspek --by "Your Name" [--city Melbourne --lat -37.81 --lng 144.96 --address "..."]
```

A candidate found in a news story has a name and little else, so its confidence is low until it has a website: `enrich --website` reads the site, checks identity again (a website can reveal that it is a company we already have) and rescores.

`enrich` reads the homepage and up to two pages it links to (privacy, terms, contact, about) and records what they say as evidence with the page as its source: the homepage's own description, an Australian street address and its state, a founding year, founders named in structured data, registry numbers and legal names. It will not record a tagline as the company's name, an inner page's description (that describes the page), or a suburb as the city (`Haymarket` stays in the address; `city` is set only when it is a city the directory uses, so the city filter is not fragmented). A unit number is kept as the site writes it. When a page gives an ABN and an ACN that cannot belong to one company (a company's ABN ends with its ACN), both are recorded as found and the candidate gets a note, because the site is probably naming two legal entities.

`publish` creates the company with exactly what is known: sector and stage stay `Unknown` unless the evidence says, the description is left for a person to write, and the location is unconfirmed (so it is listed under Unconfirmed, not on the map) unless you supply and confirm one. A candidate with a possible duplicate cannot be approved until each is settled: `distinct --from <id>` if it is a different company, `merge --into <company>` if it is the same.

## Enrichment

Existing companies and newly approved candidates go through one pipeline: a queue of "read this company's own website" tasks, worked a task at a time so it can run asynchronously and be stopped between tasks.

```bash
npm run discovery -- queue status                          # what is waiting, running, done, failed
npm run discovery -- queue seed --by "Your Name"           # queue every company, in the order the completeness audit ranks them
npm run discovery -- queue run --by "Your Name" --concurrency 3 [--mode fill] [--limit 20]
npm run discovery -- queue add acme --by "Your Name"       # one company (by id), ahead of the backlog
npm run discovery -- queue retry enq-acme-1 --by "Your Name"   # a failed, cancelled or skipped task; `queue cancel <id>` for a waiting one
```

The same queue is worked from the [Data Command Center](admin.md). Approving a candidate or publishing a company queues its website ahead of the backlog.

- **Rules.** Never fabricate; keep the evidence and its source; keep higher-confidence information that is already there; flag conflicts instead of overwriting; leave a field unknown when the evidence is thin; record `last_verified_at` and a confidence; obey the source's terms. A task is `queued`, `running` (with a lease, so a crashed run is recovered), `done`, `failed`, `skipped` (no website, or the site refused automated readers) or `cancelled`.
- **What a read finds.** The homepage and up to two linked pages: description, an Australian address (and its state and city), founding year, founders named after a founding verb ("founded by"), investors named in a "backed by" sentence, and registry numbers. For hiring: JSON-LD job postings, and the public feed of the job board the company links to from its own careers page (Greenhouse, Lever, Ashby, Workable, Recruitee, SmartRecruiters), with robots.txt respected like any other read. A site whose title says it is someone else's, or that serves a bot-check page, is recorded as `mismatch` or `blocked` and nothing is taken from it.
- **What it does with it.** The default mode, `suggest`, records evidence and changes no company: a person applies what they trust. Mode `fill` writes only fields the record leaves unknown, and only the safest: a description from the page's own text, a founding year from structured data, hiring status from a job board. Founders, investors and addresses are always suggestions; a website is only confirmed. A value the record already has is never replaced: if the evidence differs it is a conflict. A claim a person turned down is never added again.
- **What it never fills.** Sector, stage and funding: no company's own website is a legitimate source for them. They come from news (discovery) or a person.
- **Failing politely.** A timeout, a network error, or a 429/5xx is retried after 10 minutes, 1 hour, then 6 hours, three attempts at most. A robots.txt disallow, an access-controlled page or an oversized page is not retried.
- **Each task** writes its evidence and its result in one transaction against fresh data, so a decision a person made while the site was being read is never overwritten, and an audit row (`enrichment.task`) for each task that changed anything.
- **On a schedule.** The [scheduler](scheduler.md) puts tasks on this same queue (`reason: refresh`, behind anything a person queued, one task per company) when a company's facts come due, works the queue within a request budget, and learns each company's clocks from the tasks that finish, whoever queued them. It also runs this engine over the feeds and records funding stories about companies we have as evidence.

## Confidence

One number from 0 to 1 for ordering the review queue; it never publishes anything. 40% how Australian it looks, 35% how much like a startup, 25% how good the evidence is (a little more when independent sources found it separately). Capped at 0.5 while a possible duplicate is unresolved and at 0.6 with no website. The breakdown is stored with the candidate.

## Limits to know about

- **State lives in git, not on the server.** The review queue is `candidates.json`; run the engine on your machine (or a scheduled job that commits: `.github/workflows/scheduled-refresh.yml`, see [scheduler.md](scheduler.md)), not on Render, whose disk is not kept. A database is the next step before running it at a larger scale.
- **News extraction favours precision over recall.** It reads the headline and excerpt, skips roundups ("3 startups pocket $18.75 million") and headlines that do not name the company, and finds a handful of companies per feed read.
- **No website discovery.** The engine does not search for a company's site; a reviewer supplies it.
- **ABN/ACN are checksum-validated, not looked up.** The ABN Lookup web service would confirm them against the register.
- The "Australian" and "startup" gates are heuristics for ordering the work. They reject only on explicit evidence against (a foreign address, a fund, an ordinary business) and keep the record.
