# The job sync: keeping the hiring desk current

The hiring desk (`/jobs`, see [hiring-desk.md](hiring-desk.md)) shows roles read from **employers' own public job boards**. This is the part that finds those boards and reads them. It is the scheduler's seventh job, `jobsync`, and it runs
**twice a day, at 8:10 am and 8:10 pm Melbourne time**, without anyone adding a role by hand, without the website open, and **without any call to a language model or other paid service**: it is HTTP reads of public pages and feeds, and arithmetic.

It describes its own timing honestly: **a role appears after the next successful refresh, not the moment the employer posts it.** Nothing here is instant.

## What one refresh does (`src/jobsync/refresh.js`)

| Step | What | Where |
|---|---|---|
| **vc** | Checks the venture firms' job boards that are due: which exist, what platform, what may be read. Names companies and boards to queue. Reads a firm's **own** vacancies when its own careers page links to a feed the sync reads. | `vc.js` |
| **confirm** | A board a venture firm's board named for a company we hold is asked of the **employer**: approved only if its own feed lists the job that was shown and the board is the company's. | `confirm.js` |
| **discover** | Looks at the own website of the companies due (each company without a board once a week, by rotation; never-looked-at at once) for a job board. A board its page links to, whose feed answers with a whole list, is approved and read at once. Everything else is written down for review. | `discover.js`, `discoverRun.js` |
| **boards** | Reads every approved employer board that is due, **whole**, and brings `jobs.json` in line with what each employer lists: new roles, changed roles, roles gone. | `scheduler/jobs/jobsync.js`, `engine.js`, `adapters.js` |
| **dedupe** | Shows one role once when two boards list it. | `dedupe.js` |
| **health** | Writes one row for the whole refresh to `job_health.json`. | `health.js` |

A step that fails says so and the next step runs; no step can undo another's work. A refresh has a budget of 1,500 requests and 20 minutes (`--max-requests`, `--max-minutes`); when one is reached it stops *starting* work, finishes what is in flight, and what was
left stays due for the next refresh.

## Whose job board is read, and how it is found

**Every company in the directory that has not closed is looked at** (917 of 920 on 2026-11-20; closed ones are the catalogue's own `isInactive`). The look is the company's **own website**: the homepage; the careers links it carries (its own domain, its `careers.` or `jobs.`
subdomain, or one separate careers domain it links to by name); the jobs page those link to; and one job page, because an apply button is often the only place a board is named. Six pages at most, through the project's one compliant fetcher (robots.txt, pacing, an honest user
agent, a size cap, a timeout, no access control bypassed). The result is written for **every** company in `job_coverage.json`:

| Outcome | Meaning | Needs a person |
|---|---|---|
| `board` | its own page links to a board the sync reads, and the feed answered with a whole list: approved (a `sources.json` row `<company>-<provider>-jobs`, then a `job_sources.json` row). Also: a company covered by a board approved some other way (below). | no |
| `board_unreadable` | its page links to a board we can read, but the feed would not answer | yes |
| `unsupported_provider` | its job board is on a provider the sync does not read (named) | yes |
| `careers_page_only` | it has a careers page, but nothing on the pages read links to a board we recognise (a board drawn by script is invisible to a plain page read) | yes |
| `no_careers_found` | no careers page or job-board link found | yes |
| `unreadable` | the website would not answer, or refuses robots | yes |
| `no_website` | the record has no website | no |

**How often.** A company with no board is looked at **once a week**, by *rotation* rather than a stored clock: a week is 14 half-day blocks, and each block takes the companies whose id falls in it (`rotationBucket`). So nothing about the schedule has to be saved between
refreshes (a refresh that commits nothing loses no progress), a company never looked at is looked at at once, and a refresh's requests are about a fourteenth of the week's. A company **with** a working board is not looked at again, unless its board has failed three times in a
row (then its page is read again to see whether the link moved). A second refresh in the same half-day asks nothing of a company looked at in the last six hours.

**Nothing is guessed.** A board is approved only when (a) the company's own page links to it, or (b) the employer's own feed lists a job a venture board showed and the board is the company's (below), or (c) a careers page that draws its jobs by script was read in a browser (below).
A token is never invented or tried. A board someone only *named* is a `review` row of `job_sources.json`: never read.

### Careers pages that need JavaScript

A plain page read cannot see a board a page draws by script. Two ways in, both through the employer:
1. **A venture firm's board names it, the employer confirms it** (`confirm.js`). Airwallex, SafetyCulture (its board is "mitti": it has moved to mitti.com), Secure Code Warrior, Sitemate and Advanced Navigation were approved this way: the Getro sample showed one of their jobs linking to an
   Ashby, Lever or Rippling board; that board's own public feed was read whole and lists that very job; and the board's name is the company's name or its own website's name. A board failing any of the three stays in review with the reason and is asked again in a week.
2. **Read in a browser** (`scripts/jobsync-confirmed.json`, `npm run jobsync -- confirmed --write`). For companies that matter, the careers page was read as a visitor sees it and the board it names was recorded with how. The importer approves it only if the board's feed answers
   whole and the page's claim is confirmed by that feed (`evidence: "link"`: the page links to the board's address; `"jobs"`: at least one job the page shows is listed by the board's feed). Rokt (a Workable embed), Phocas (a Rippling embed), Go1 (its Australian Greenhouse board) and
   Pet Circle (Teamtailor) were approved this way. A page behind a bot challenge (Cloudflare) was not worked around.

**Not readable, and why** (plainly, per company, in `job_coverage.json`): **Canva** (its own careers site refuses automated readers with a 403, its SmartRecruiters API says `Disallow: /` to every robot, and SmartRecruiters' careers page draws its list by script), **Linktree** (its `robots.txt` disallows our reader) and **Flippa** (its `robots.txt` is access-controlled and its page sits behind a bot challenge).

## What each provider's feed is, and what is not read

| | |
|---|---|
| Reads (10) | the provider's **public postings feed**, over GET: Greenhouse (`boards-api.greenhouse.io`), Lever (`api.lever.co`), Workable (the widget feed, by subdomain or account id), **Ashby** (`api.ashbyhq.com/posting-api`, with the pay the employer publishes), **Recruitee** (`<company>.recruitee.com/api/offers`), **Breezy** (`<company>.breezy.hr/json`), **Pinpoint** (`<company>.pinpointhq.com/postings.json`), **BambooHR** (`<company>.bamboohr.com/careers/list`), **Teamtailor** (the board's `jobs.rss`) and **Rippling** (`api.rippling.com/platform/api/ats/v1/board/<name>/jobs`). Each was chosen by how many Australian companies in the directory use it and checked live. |
| Does **not** read | **SmartRecruiters** (`api.smartrecruiters.com/robots.txt` says `Disallow: /` to every robot but LinkedIn's), **Workday** (its list is served to a POST request; no GET feed confirmed), **Notion pages** (a document, not a feed), Employment Hero Hire, ELMO, SAP SuccessFactors, JazzHR (no public feed the sync can read has been confirmed). Their companies are on the unsupported list with that reason; none is worked around. |
| Does not read | any competitor's listings, LinkedIn, a search page, a page that needs a login (the fetcher refuses them), or Getro's and Consider's search APIs (below). |
| Each company decides | Pinpoint boards publish their own `robots.txt`; one company's disallows its feed, so it is refused for that company and recorded as `board_unreadable`. |
| One exception to say out loud | Ashby's API host answers **401 on `/robots.txt`** (no rules, not "no"). RFC 9309 reads a 4xx there as "no rules", and the project otherwise reads it as "closed". `PUBLIC_API_HOSTS` (`providers.js`) lists that one host, Ashby's documented public job-posting API, and the fetcher option (`noRulesWhenRobotsForbiddenHosts`) is off for everything else. It never applies to a company's own site, to a robots.txt that is there and says no, or to a 429 or 5xx. **Delete `api.ashbyhq.com` from that list to switch it off.** |

What a feed states is kept; what it does not state stays unstated: the **pay** a listing publishes (a structured range or the employer's own wording, never converted or estimated), the **experience** it asks for, the employment kind, the team, the work places, how it is worked, and
the employer's own posted date. The company's funding round and backers come from the directory (each backer is an investment the directory holds), never from where a role was found.

## Venture firms (`vc.js`, `job_vc_boards.json`)

The 15 firms asked about were checked from their **own websites** (the board is found by a link there, never guessed; Startmate's, which its site does not link to, is accepted only because the board's own data names `startmate` as its network). Verdicts, 2026-11-20:

| Firm | Portfolio job board | Its own vacancies |
|---|---|---|
| Blackbird, AirTree, Square Peg, OIF Ventures, Antler, Accel | Getro: the page's first 20 jobs, a **sample** | none on a feed the sync reads (Antler's are on JazzHR) |
| Startmate | Getro: lists no jobs at present | none found |
| EVP, Sequoia Capital, Lightspeed, Bessemer | Consider: nothing, the list is drawn by script from the platform's API | none found |
| Andreessen Horowitz, Main Sequence | own / unknown platform: nothing usable | none found |
| Y Combinator | Work at a Startup: every apply link goes through a YC sign-in, which is not used | none found |
| **Investible** | none | **its own Rippling board is read** (the firm is the employer: `vc-investible`): its Melbourne General Counsel role is on the desk |

A **sample** is not a source of roles: it cannot say a role has closed, and Getro's `robots.txt` asks to arrange its search API (`api@getro.com`) instead of being scraped, which is respected. So a venture board is used to **discover**, and the **employer** confirms:
1. a company we hold whose job board a sighting names becomes a `review` row (with the job that was shown), and `confirm.js` asks the employer (above); until it confirms, nothing is read and nothing is published;
2. an Australian company the directory does not hold is a **lead** in `job_leads.json`: a person approves it; the sync never adds to the directory;
3. a firm's **own** vacancies are read only if its own careers page links to a feed the sync reads **and the board is named for the firm** (a firm's careers page may show its portfolio's boards: those are not the firm's). The firm is then an employer like a company (id `vc-<investor id>`),
   approved by the same rule: its own page links to the board. A firm's vacancy on a provider the sync does not read stays in the registry, named.
The vacancies themselves always come from the employers' own feeds, so **a role is shown once, whichever way it was found.**

## The rules (engine.js, and its tests)

**Keys.** A role is the same role when `(company, provider, external id)` match; failing that, when its **canonical application address** matches (https, lower-case host, no tracking or fragment, no trailing slash; `gh_jid` is kept because on an employer's own careers page it
is what names the job). A role the slower reader held is **adopted**: it keeps its id (so a saved role stays saved) and its first read. The application link is always the employer's own (a link on the provider's host or the company's own domain; anything else is skipped).

**Three dates, never mixed up.**

| Field | Meaning |
|---|---|
| `posted_at` | what the **employer** says; null when it does not. Never filled from a check. |
| `first_seen_at` | the first whole read that listed it. |
| `last_confirmed_at` | the **last successful verification**: the last whole read that listed it. (`retrieved_at` is the same date, as the rest of the system has always read it.) |

**Complete reads only.** An adapter returns the whole board or throws: a timeout, a 429, a 5xx, a board that says it holds 12 jobs and returns 9, a Lever page that repeats or never ends, a response that is not JSON, all fail the read. **A failed or partial read never closes a role and
never moves a date**: it only writes the board's state row (`job_sync_state.json`): when it failed, why, and when to try again. (A source that fails for a while keeps its roles; this is tested.)

**Lifecycle.** `open` → not in a whole read → `hidden` (off the board at once) → not in the next whole read either, **at least 30 minutes later** → `archived`. Listed again: `open` again. `closed`: the employer or the provider said so (explicit). A role is **never deleted**: a bookmark
still finds it with its true status. A board that suddenly lists **nothing** while roles are held is believed only when it is still empty at a read at least 10 minutes later.

**Stale.** A role not confirmed for 48 hours says "Not rechecked since ..."; after **14 days** it leaves the default board and is found only by a bookmark.

**Duplicates (`dedupe.js`).** The same company, title and place on **different** boards is one role: the better-supported copy stays, the other is `hidden` with `duplicate_of`, and the sync does not reopen it while the original is open. The same board's own repeats are never merged
(three "Account Executive" openings in Sydney are three openings). Roles at the same address are already one role by the key above. A venture board's sample is never stored as roles, so there is nothing to merge it with.

**Where a role is (Australian eligibility).** From the **employer's advertised work places** (`locations.js`), never the company's head office. A place is Australian only when it says so, or is a capital whose name is not also a famous place elsewhere. **Remote AU** only when the
employer's own words say someone in Australia can do it remotely ("Remote", "Remote - US", "Remote - APAC" are not evidence). A role at no Australian place and not remote from Australia is not stored.

**Retries.** Inside a run, one retry of a transient failure with a short backoff; a provider's `Retry-After` is honoured (a long one is not waited out). Across runs the wait grows: 15 minutes, 1 hour, 3, 6, 12, 24 (`state.js`); a board that is not there or refuses us waits the longest step
and shows up as needing a person after three failures. The fetcher also leaves a host that said 429/503 alone for the rest of the run, and paces requests per host (1.5 s).

**Locks.** The scheduler's tick lock (one tick at a time, a stale lock taken over after 90 minutes), the data lock around every write, and the workflow's concurrency group. Each board is its own write, so one board's trouble loses no other's work.

## The schedule: 8:10 am and 8:10 pm, Melbourne time

**Method: GitHub Actions** ([`jobs-sync.workflow.yml`](jobs-sync.workflow.yml)), because the hosting cannot do it: Render's free web service sleeps and **erases its disk on every deploy**, and the Vercel site is static (its cron is, on the Hobby plan, once a day at most). GitHub Actions
minutes are free on a public repository. **Nothing is scheduled today**: the workflow is not installed, not enabled, and has never run.

```yaml
schedule:
  - cron: '10 8,20 * * *'
    timezone: 'Australia/Melbourne'
```
GitHub's workflow syntax takes an IANA `timezone` beside `cron`, so this is 8:10 am and 8:10 pm in Melbourne all year and follows daylight saving (neither time falls in the skipped hour). GitHub can start a scheduled run late when it is busy; nothing here depends on the minute it starts.

**Commits and deploys are not made for nothing.** The repository is the database, so a refresh starts from the committed data. After a refresh `jobsync meaningful` decides (`changes.js`):
- a **role** that is new, gone, edited or changed status, or a board that went failing, recovered or answered empty: commit **and redeploy** the API (a visitor can see it);
- a board approved or put in review, a company whose job-board outcome changed, a lead, a venture board that changed: commit, **without** a redeploy (`[skip render]`);
- **nothing**: no commit at all (the dates that moved are not worth one);
- and one **heartbeat** a day, when nothing else has been committed for 20 hours: a commit and a redeploy, so the page's "last read" stamp is true. The stamp says the refresh is late only after 40 hours.
So the repository sees a commit when something changed, and a redeploy at most when a visitor could see it, plus one a day. (Failure counts and a board's first empty answer are committed too: the next refresh must remember them for "three failures in a row" and "empty twice" to be reachable.)
The weekly look at companies keeps no state, so skipping a commit loses no progress.

**To turn it on** (needs the owner; the credential on this machine cannot add a workflow file):
1. In GitHub, open the repository, **Add file → Create new file**, name it `.github/workflows/jobs-sync.yml`, paste the contents of `docs/jobs-sync.workflow.yml`, and commit.
2. **Settings → Secrets and variables → Actions → Variables → New repository variable**: `JOBSYNC_ENABLED` = `true`.
3. **Actions → Job board refresh → Run workflow** (choose `force: true` the first time), and read the log before trusting the timer.
To turn it off, set `JOBSYNC_ENABLED` to anything else.

## The health record (`job_health.json`, `health.js`)

One row per refresh that was committed, newest last, the last 120 kept, written at the end of the refresh:

`companies_with_sources`, `boards_ok`, `boards_failed`, `boards_held_empty`, `boards_needing_attention` (ids failing three times running), `open_roles`, `new_roles`, `closed_roles` (hidden or archived), `roles_listed_again`, `duplicates_removed`, `duplicates_hidden`, `companies_eligible`,
`companies_looked_at`, `companies_with_board`, `companies_for_review`, `vc_boards_checked`, `vc_boards_readable`, `leads_waiting`, `stopped_for`, `last_success_at`, and the `slot` label. The hiring desk's "See feed coverage" shows the last row's numbers.
Unsupported or persistently failing sources are flagged: `npm run jobsync -- status` and `job_coverage.json` (`review: true`) list them.

## The final check (`npm run jobsync -- verify [--links]`)

Reads the stored data and finds: **duplicates** (an id, an application address or the same role from two boards on the desk twice), **expired** vacancies (an open role its board's last whole read did not list; a board never read; roles kept while their board fails are named, not
called expired), **Australian eligibility** (every role on the desk has an Australian place or the employer's words for remote from Australia), **application links** (https, on the provider's or the company's own host; with `--links` each address is asked whether it still answers, through the
compliant fetcher: a 404 or 410 is a violation, a refusal by robots or a login is "not checked", never pushed past) and **timestamps** (first seen ≤ last confirmed ≤ its board's last read ≤ now; posted not in the future; health rows in order). It changes nothing and exits 2 on a violation.

## Commands

```bash
cd backend
npm run scheduler -- tick --job jobsync                       # one whole refresh now (add --force to read boards read within the hour; --data <dir> for a copy)
npm run scheduler -- tick --job jobsync --steps boards        # only some steps: vc, confirm, discover, boards, dedupe, health
npm run scheduler -- tick --job jobsync --board a,b           # just these catalogue boards (a board in review is never read, even when named)
npm run jobsync -- discover --all --concurrency 6             # look at every company's own website for a board now (--company a,b; --plan to see what is due; --force)
npm run jobsync -- confirmed [--write]                        # approve the boards read in a browser (scripts/jobsync-confirmed.json), each only if its own feed confirms the page
npm run jobsync -- verify [--links]                           # the final check
npm run jobsync -- meaningful                                 # would the last refresh be committed, and redeployed, against the last commit?
npm run jobsync -- slot [--force] [--now ISO]                 # the slot label for a time ("2026-11-20 AM"); what the workflow records
npm run jobsync -- status                                     # where every board stands
npm run jobsync -- read <source-id>                           # one board now: what it WOULD do (a dry read, writes nothing)
npm run jobsync -- board                                      # the desk's counts as the API will serve them
npm run jobsync -- sources --write                            # rebuild the catalogue (job_sources.json) from sources.json
```
A plain `tick` does **not** run `jobsync` (`ROUTINE_JOBS` in `models/jobRuns.js`): it is asked for by name, so there is one schedule for it.

## The data

`job_sources.json` (the catalogue, with why each board is trusted; a review row keeps the `sighted` jobs that name it and the date it was last asked), `job_sync_state.json` (each board's last whole read, failures, next try), `jobs.json` (the roles, with `provider`, `external_id`,
`canonical_url`, `first_seen_at`, `last_confirmed_at`, `absent_reads`, `locations`, `workplace_type`, `team`, `salary`, `experience_level`, `duplicate_of`; statuses `open|hidden|archived|closed`; an employer is a company, or a venture firm as `vc-<id>`), `sources.json` (the page or feed
that approves each board), `job_coverage.json`, `job_vc_boards.json`, `job_leads.json`, `job_health.json` (above), and the run log (`job_runs.json`, job `jobsync`, which keeps the boards that changed or failed, not every board each time).

## What it costs

**$0 a month.** GitHub Actions on a public repository is free; Render and Vercel stay on their free plans (a deploy is about 30 seconds and then a cold start; the refresh causes at most a few a day); no paid API is called. A refresh is about a hundred to a thousand requests spread over
many hosts (one per host per 1.5 s) and 5 to 20 minutes; 40 minutes is the workflow's hard stop. The cleaner design, if the owner ever buys it, is Render Starter with a persistent disk, where the same `tick --job jobsync` runs in the server's own cron and nothing is committed or
redeployed: the code does not change, only where it runs. **Nothing was bought, and nothing should be without the owner's say-so.**

## What it will never do

Send a message, submit an application, create an account, read a page that needs a login, read LinkedIn or a search page, get past a bot challenge, scrape a provider's search API, guess a feed address, add a company to the directory, or call a language model.

**A private preview's automation is separate:** a Vercel preview of a branch has **no** schedule. Its data is the commit's data; it does not update itself.
