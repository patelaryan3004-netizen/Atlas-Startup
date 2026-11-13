# The job sync: keeping the hiring desk current

The hiring desk (`/jobs`, see [hiring-desk.md](hiring-desk.md)) shows roles read from **employers' own public job boards**. This is the part that reads them. It is the scheduler's seventh job, `jobsync`: it
reads every approved board that is due, **whole**, and brings `jobs.json` in line with what each employer lists, without anyone adding a role by hand and without the website open.

It describes hourly polling honestly: **a role appears after the next successful check, not the moment the employer posts it.** Nothing here is instant.

## What it reads, and what it will not

| | |
|---|---|
| Reads | the provider's **official public postings feed** for a board the company's own careers page links to: Greenhouse (`boards-api.greenhouse.io`), Lever (`api.lever.co`), Workable (the widget feed). Through the project's one compliant fetcher (robots.txt, pacing, an honest user agent, a size cap, a timeout, no access control bypassed). |
| Approves a board | only when the company's own site links to it: a `sources.json` row named like `acme-greenhouse-jobs` (what the careers-page reader writes). `job_sources.json` is the catalogue built from those rows. |
| Does not guess | a board someone only **named** (the pilot handoff's Deputy and VGW) is in the catalogue as `review`: never polled, never guessed, until the employer's own page confirms it. A board that cannot be matched to a directory company is not added. |
| Does not read | any competitor's listings, LinkedIn, or a search page (the fetcher refuses them). |
| Cannot read yet | Ashby, Recruitee and SmartRecruiters boards. They stay with the slower hiring reader (every three days) and are listed as unsupported in the desk's "feed coverage" and in `npm run jobsync -- sources`. |
| Not every company | only the approved boards are read. The coverage view says how many companies of the directory that is; it is not all of them and the page never says it is. |

## The rules (engine.js, and its tests)

**Keys.** A role is the same role when `(company, provider, external id)` match; failing that, when its **canonical application address** matches (https, lower-case host, no tracking or fragment, no trailing slash;
`gh_jid` is kept because on an employer's own careers page it is what names the job). A role the slower reader held is **adopted**: it keeps its id (so a saved role stays saved) and its first read.

**Three dates, never mixed up.**

| Field | Meaning |
|---|---|
| `posted_at` | what the **employer** says; null when it does not. Never filled from a check. (Greenhouse `first_published`, Lever `createdAt`, Workable `published_on`; `updated_at` is not a posted date.) |
| `first_seen_at` | the first whole read that listed it. |
| `last_confirmed_at` | the last whole read that listed it. (`retrieved_at` is the same date, as the rest of the system has always read it.) |

A role is never presented as newly posted because it was just checked: the desk sorts "Latest additions" by posted date, else first-seen, and labels only the employer's date "Posted by the employer".

**Complete reads only.** An adapter returns the whole board or throws (`adapters.js`): a timeout, a 429, a 5xx, a board that says it holds 12 jobs and returns 9 (Greenhouse `meta.total`), a Lever page that repeats or never ends, a
response that is not JSON, all fail the read. **A failed or partial read never closes a role and never moves a date**: it only writes the board's state row (`job_sync_state.json`): when it failed, why, and when to try again.

**Lifecycle.** `open` → not in a whole read → `hidden` (off the board at once) → not in the next whole read either, **at least 30 minutes later** (so one bad answer seen twice a minute apart is not two absences) → `archived`.
Listed again: `open` again. `closed`: the employer or the provider said so (explicit; a signed webhook would say it, below). A role is **never deleted**: a bookmark still finds it with its true status.
A board that suddenly lists **nothing** while roles are held is believed only when it is still empty at a read at least 10 minutes later.

**Stale.** A role not confirmed for 36 hours says "Not rechecked since …"; after **14 days** it leaves the default board (`stale_hidden` in the board's totals) and is found only by a bookmark.

**Where a role is.** From the **employer's advertised work places** (`locations.js`), never the company's head office: a role open in Melbourne and Sydney is in both cards and once in the national count. A place is Australian
only when it says so, or is a capital whose name is not also a famous place elsewhere ("Melbourne, FL" and "Perth, Scotland" are not ours). **Remote AU** only when the employer's own words say someone in Australia can do it
remotely ("Remote - Australia"; a "remote" workplace type with an Australian place); "Remote", "Remote - Global", "Remote - US", "Remote - APAC" are not evidence about Australia. The page shows the words it relied on.
A role at no Australian place and not remote from Australia is not stored.

**Retries.** Inside a run, one retry of a transient failure with a short backoff; a provider's `Retry-After` is honoured (a long one is not waited out: the board is left for the next run). Across runs the wait grows: 15 minutes,
1 hour, 3, 6, 12, 24 (`state.js`); a board that is not there or refuses us waits the longest step and shows up as needing a person after three failures. The fetcher also leaves a host that said 429/503 alone for the rest of the run.

**Locks.** The scheduler's tick lock (one tick at a time, a stale lock taken over after 90 minutes) and the data lock around every write. Each board is its own write, so one board's trouble loses no other's work.

**Webhooks.** If an employer later offers an authorised, **signed** job-published webhook, it goes through the same rows and rules (`engine.applyEvent`: upsert one posting, or close one explicitly) and **reads keep running** to repair a missed event. No
employer offers one today, so there is no endpoint and no secret.

## Commands

```bash
cd backend
npm run jobsync -- sources --write          # build the catalogue (job_sources.json) from sources.json; the review queue is scripts/jobsync-candidates.json
npm run jobsync -- status                   # where every board stands
npm run jobsync -- read <source-id>         # one board now: what it WOULD do (a dry read, writes nothing)
npm run jobsync -- board                    # the desk's counts as the API will serve them
npm run jobsync -- meaningful               # did the last run change anything a visitor could see, against the last commit?
npm run scheduler -- tick --job jobsync     # the sync itself (add --force to read boards that were read within the hour; --data <dir> for a copy)
npm run scheduler -- status                 # shows the job beside the other six
```
A plain `tick` does **not** run it (`ROUTINE_JOBS` in `models/jobRuns.js`): it is asked for by name, so there is one schedule for it.

## The data

`job_sources.json` (the catalogue, with why each board is trusted), `job_sync_state.json` (each board's last whole read, failures, next try), `jobs.json` (the roles, with `provider`, `external_id`, `canonical_url`,
`first_seen_at`, `last_confirmed_at`, `absent_reads`, `locations`, `workplace_type`, `team`; statuses `open|hidden|archived|closed`), and the run log (`job_runs.json`, job `jobsync`). The slower hiring reader leaves a role that has an
`external_id` alone (it neither updates, closes nor re-adds it), so the two never disagree about one role.

## The schedule

**What exists:** nothing is scheduled. The repository has no `.github/workflows`, the scheduler has only ever been run by hand, and the workflow in `docs/scheduled-refresh.workflow.yml` is parked (see
[scheduler.md](scheduler.md)). The GitHub credential on this machine has no `workflow` scope, so a workflow cannot be installed from here.

**What the hosting supports:** Render's free web service sleeps and **erases its disk on every deploy**, so it can neither run an hourly timer nor keep the sync's state; the Vercel site is static (and its cron is, on the Hobby plan,
once a day at most: this account's plan is not visible from here). **GitHub Actions** can run hourly (schedules run at most every 5 minutes; the repository is public, so the minutes are free) and the state can live in git, which is
how the rest of the pipeline works.

**Proposed:** [`jobs-sync.workflow.yml`](jobs-sync.workflow.yml), once an hour (`9 * * * *`), the only schedule for this job. It runs `tick --job jobsync`, asks `jobsync meaningful` whether anything a visitor could see changed, and commits
`backend/src/data` only if so or once a day; a commit that changed roles redeploys the API (that is how a new role reaches the site), a heartbeat is `[skip render]`. **Status: not installed, not enabled, never run.** To turn it on: add the
file in GitHub's web editor, set the repository variable `JOBSYNC_ENABLED` to `true`, and run it once by hand (`workflow_dispatch`) and read the log before trusting the timer.

**The cost of this design, honestly:** every commit that changes a role redeploys the API on a free plan (about 30 seconds, then a cold start). Roles change a few times a day, not every hour. The cleaner fix is Render Starter with a persistent
disk, where the same `tick --job jobsync` runs in the server's own cron and nothing is committed or redeployed: the code does not change, only where it runs.

**A private preview's automation is separate:** the Vercel preview of this branch has **no** schedule. Its data is one real run made on 13 November 2026; it does not update itself.
