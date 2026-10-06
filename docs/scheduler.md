# The scheduler: keeping the directory current

Six scheduled jobs keep the directory up to date: they find companies we do not have, improve thin profiles, refresh who is hiring, notice new funding, notice an acquisition, a shutdown or a rename, and look for records that have gone stale or disagree with a source. Each fact is looked at again at its own pace, politely, and every run is written down.

It is a separate command (`npm run scheduler` in `backend/`), never part of the public server. It reads feeds and company websites and writes **evidence, clocks and a run log**. It does not change a company unless you start it in `fill` mode, and even then only what the enrichment policy allows.

```
every few hours, by a timer or a person:

  feeds      discovery  -> candidates for review           funding  -> evidence about companies we have
  sites      hiring, status, enrichment  -> queue what is due -> the enrichment worker reads it -> evidence, jobs
  clocks     what each read found moves that company's clocks (last checked, verified, changed, next due)
  quality    what is stale or in conflict is brought forward to be looked at again
  log        one row per job, always, including "nothing was due"
```

Everything runs from `backend/` with `npm run scheduler -- <command>`; add `--data <dir>` to work on a copy of the data files.

## What it will never do

| Rule | How it is kept |
|---|---|
| Never read LinkedIn, a proprietary startup database or a search page | the one fetcher (`src/discovery/http.js`) refuses them, whichever job asks |
| Never bypass access control | a 401, a 403 or a redirect to a login page is final: no retry, no other user agent, no cookies |
| Obey robots.txt and slow-down requests | robots.txt (Disallow, Allow, Crawl-delay) is read first; a host that answers 429 or 503 is left alone, for longer each time it asks (see [Being polite](#being-polite)) |
| A candidate company is never public | discovery only writes `candidates.json`; a person publishes. Nothing here publishes |
| Never merge an uncertain company | a name on its own is never an exact match; a funding story is attached to a company only if the story also agrees with what we hold |
| Unknown stays unknown | nothing is estimated; a field with no evidence stays empty, and a check that finds nothing is "checked", not "verified" |
| Never silently overwrite a reliable value | what a read finds is **evidence**, which never writes to a company. It shows up as a suggestion (the record is empty) or a conflict (the record says something else), for a person to settle |
| Never slow the public site | its own process, below normal priority, never imported by the public server (a test reads the import graph), a few paced requests per run, and the data lock only for the moments it writes |

## The six jobs

| Job | Looks at | From | How often | Writes |
|---|---|---|---|---|
| **discovery** | companies we do not have | feeds and our own submissions queue | each source every 2 days, submissions every 6 hours | candidates (`needs_review`) and an import-run row |
| **funding** | stories about companies we do have | the same feeds | every 2 days | evidence: last round, its date, investors |
| **hiring** | open roles and the hiring flag | the careers page and the job board it links to (Greenhouse, Lever, Ashby, Workable, Recruitee, SmartRecruiters) | every 3 days (6 for a company not hiring) | jobs, and evidence that the company is hiring or its board is empty |
| **status** | acquired, closed, renamed, moved | the homepage | every 14 days, and free whenever the homepage is read for another reason | evidence for what a page says outright; "watch" signals for the rest |
| **enrichment** | description, address, city, state, founders, investors, founded year | the company's own pages | description 60 days, profile 90 days, founded year 365 days | evidence (and fills, in `fill` mode) |
| **quality** | stale, conflicting or failing records | the dataset and the clocks; no network | daily | a report in the run log; brings the right clocks forward; keeps the log short |

The pace follows how fast a fact changes and how much a check costs: a role opens and closes within days, a founding year never moves. The funding feed is read often because a feed only keeps the last few days of stories; a story's evidence is permanent. The table's numbers are one file, `src/scheduler/cadence.js`.

### What each job decides, and what it leaves to a person

- **Funding.** A story is attached to a company only when it gives a round, is dated within four months, was read by a method better than the weakest guess, matches **exactly one** company by name, *and* says something that agrees with the directory: it names an investor the company already has, or places it in the city the record gives. Then three kinds of evidence go on the company, citing the story: the round, the story's date (only if later than the record's), and the investors it names. Against a record that says "Pre-seed" a story about a "Seed" round is a **conflict**; against an empty record it is a **suggested fill**; against the same round it is a confirmation. Every other story (a name alone, a short name, two companies with the name) is not touched here and goes to discovery, which makes a candidate for a person to look at. A story that was attached is *not* also turned into a candidate. Round amounts are not read: a press excerpt rarely states them reliably, so they stay unknown.
- **Status.** Only a sentence about the company itself counts as a claim ("Acme Robotics has been acquired by Beta", "we have ceased trading", "Acme is a subsidiary of..."). It is recorded as `company_status` evidence at medium confidence with the sentence as its note, and never fills the record. "We acquired Beta", a funding round being "closed", and a page that merely mentions another company being acquired do not count (the tests hold both ways). A site that now redirects to another domain, calls itself something else, looks parked, says it used to be called something else, or has not answered for three or more checks in a row over at least three weeks is put on the **status watch**: a signal with a date, shown in the Command Center. It is not evidence, because nothing on the page says what the company's status is.
- **Hiring.** Open roles go into `jobs.json` (a role that disappears from a page or board that was read is closed). A board the careers page links to that answers with a list is `hiring` evidence at high confidence; one that answers with an empty list, when nothing else was found, is `not_hiring` evidence at medium confidence. Against a record that says "hiring" the second is a conflict for a person; it never switches the flag off by itself. A board that would not answer is *incomplete*: the check is tried again within a day.
- **Quality.** Brings a conflicted record's most relevant clock forward (a disagreement about a city moves the profile clock; not more than once a week), and a "hiring now" nobody has confirmed for 30 days (not more than once in 3 days). It resolves nothing.

## Not every fact on the same clock

Each company has one clock per fact, kept in `refresh_state.json`:

| Clock | Meaning |
|---|---|
| `last_checked_at` | the last check that worked: a page was read, a feed answered |
| `last_verified_at` | the last time a source gave a **positive reading** of this fact (a claim read, or read again). A check that finds nothing is checked but not verified |
| `last_changed_at` | the last time a check found something **new** (a claim, a role opened or closed, a signal) |
| `next_check_at` | when it is next due. `null` means due now (never checked, or a person asked) |

plus `checks`, `unchanged_streak`, `failures`, `last_outcome`, `last_error`, `last_task_id`, `last_run_id`, and a small `meta`. One row per (company, fact), per source and per host, so a move to a real database is a table with that key.

How the next date is chosen:

- **A check that works** waits the fact's base interval, lengthened by 1.4 to 2 times for each check in a row that found nothing new (up to a ceiling: hiring 21 days, status 90, description and profile 365, founded year 1,095), and shortened back to the base the moment something changes. A company that is hiring is looked at twice as often as one that is not.
- **Jitter, not randomness.** Every wait is varied by up to 15% from a hash of that row's own state, so companies first read in the same minute do not all stay due in the same minute, and the same state always gives the same date.
- **A failure** (a timeout, a server error) backs off on a ladder: 6 hours, a day, 3 days, a week, a fortnight. It is not counted as checked.
- **A refusal is a result, not a failure.** robots.txt says no: left alone for 30 days. Access-controlled (401, 403): 7 days, because a firewall may only dislike a data-centre address. No website: 30 days, and picked up the moment one is added. The site is someone else's now (a mismatch): 14 days.
- **A read that finds a page for something else** (the homepage is read for hiring too) updates the status clock as well. Status is checked for free whenever the homepage is.

The clocks are learned from the queue, not kept by whoever did the reading. The worker reads a site and finishes a task; the scheduler turns each finished task into stamps on the facts it covered, exactly once. So a task a person queued by hand moves the same clocks, a crash between "the task finished" and "the clocks moved" is repaired by the next run, and `scheduler learn` can set every clock from the history before the first run.

## Being polite

- **One request per host every few seconds**, robots.txt and its Crawl-delay first, an honest user agent that names the site (`AUStartupMapBot/1.0 (+https://au-startup-map.netlify.app/; scheduled refresh)`), a timeout, a size cap, a redirect limit.
- **A budget per run:** 40 companies, 300 requests, 20 minutes, 2 sites at a time (flags `--max-sites`, `--max-requests`, `--max-minutes`, `--concurrency`). When a limit is reached it stops *starting* work, finishes what is in flight, says which limit in the run log, and the rest stays due for the next run. Nothing is lost and nothing is skipped silently.
- **Slow-down requests are remembered.** A host that answers 429 or 503 is written to `refresh_state.json` with how long it asked for (`Retry-After`, in seconds or as a date, capped at a week), or 6 hours the first time and then a day, three days, a week and a fortnight on repeat. The next run does not read its companies and the fetcher refuses the host before sending a request; a host that is used again after its wait and is fine starts again from nothing.
- **Existing work first.** The queue is shared with the Command Center: a task a person queued goes ahead of a refresh, and a company already waiting is widened rather than queued twice.

## It is the same answer when you run it twice

| Situation | What happens |
|---|---|
| Run again at the same moment | nothing is due: no request, and every file but the run log is byte-identical (the run log gains a row saying nothing was due) |
| A run stopped by a limit | the next run takes the rest, and never reads a company twice |
| A run that died mid-way | its rows say `running`; the next run marks them failed ("interrupted") and learns from any task that finished |
| Two runs at once | one holds a lock file; the other writes a `skipped` row saying so and does nothing |
| The same funding story read again | its evidence already exists: nothing is added; a row a person turned down is not added back |
| The same feed item read again | discovery has seen it: no second candidate |
| A queue task asked for twice | one task per company; the second request widens the first |

Each of these is a test (`backend/tests/scheduler*.test.js`).

## The run log

`job_runs.json`: one row per job per run, whatever happened.

| Field | |
|---|---|
| `job`, `tick_id`, `trigger` (`cli`, `ci`, `loop`), `by`, `mode` | what ran, in which tick, how it was started, by whom |
| `started_at`, `finished_at`, `status` | `ok`, `partial` (some failed), `failed`, `idle` (nothing was due), `skipped` (another tick held the lock), or `running` |
| `due`, `processed`, `changed`, `failed`, `deferred`, `requests` | how many were due, read, found something new, failed, and were left for next time |
| `budget` | the limits and which one stopped the run, if any |
| `summary`, `details`, `error` | one readable line; what only that job reports; why it failed |

The row is written when the job **starts**, so a run that dies still left a record. A run that changed data also leaves a row in the audit trail (`scheduler.run`, by `scheduler`). Idle and skipped rows are dropped after a month and anything after a year; finished queue tasks older than a month go too, except the latest for each company.

`npm run scheduler -- status` and the Command Center's **Scheduled refresh** section show the jobs, when each last ran and runs next, how many companies each fact has been checked for and how many are due, the status watch, the sources, the hosts being left alone, and the recent runs.

## Running it

```bash
npm run scheduler -- status                    # jobs, clocks, what is due, what is wrong
npm run scheduler -- plan                      # exactly what a run would do; reads and writes nothing
npm run scheduler -- tick                      # one run of every job that is due
npm run scheduler -- tick --job hiring,status  # only these
npm run scheduler -- run hiring                # one job now, whatever its clock says
npm run scheduler -- loop --every 60           # a tick every hour until stopped (Ctrl+C finishes the current site)
npm run scheduler -- runs --job hiring         # the run log
npm run scheduler -- reset acme-robotics       # make a company due again now (or --facet hiring)
npm run scheduler -- learn                     # set the clocks from the queue's history, with no network
```

`--mode fill` (or `SCHEDULER_MODE=fill`) lets a run fill what the policy allows: a description the company wrote itself when the record has none, a founded year from structured data, `hiring` from structured job postings. The default, `suggest`, changes no company. Exit codes: 0 ok, 2 a job failed, 1 a usage or data error.

**On a schedule, locally:** run `npm run scheduler -- tick --by <you>` from Windows Task Scheduler, cron or launchd every few hours. Commit `backend/src/data` afterwards: the state lives in git.

**On a schedule, in GitHub Actions:** `.github/workflows/scheduled-refresh.yml` runs a tick four times a day and commits what it wrote. It starts nothing until you set the repository variable `SCHEDULER_ENABLED` to `true`. A run that did not touch `startups.json`, the only data file the public site reads, is committed with `[skip render]` so Render does not redeploy for it (check in your Render dashboard that it honours that); one that did touch it is committed plainly and deploys. A person can run it by hand from the Actions tab and choose the jobs and the mode. It cannot be run on Render: Render's disk is wiped on every deploy.

Things to know about running it from a cloud runner: some sites block data-centre addresses, which shows up as refusals (retried after a week), not failures; to read the live submissions queue, set the repository secrets `DISCOVERY_SUBMISSIONS_URL` and `ADMIN_KEY` and pass them as environment variables to the scheduler step (they are not wired by default).

## Where to change things

| To | Edit |
|---|---|
| Change how often a fact is looked at | `src/scheduler/cadence.js` |
| Add a feed | `src/discovery/config.js` (and, for a new kind, an adapter, see [discovery.md](discovery.md)); `refresh_days` sets its pace. A publisher's feed (`adapter: 'rss'`) is read by the funding job too |
| Change what counts as a status claim | `src/enrichment/status.js` (and its tests: both the sentences it must catch and the ones it must not) |
| Change how strict funding matching is | `src/scheduler/funding.js` |
| Change a run's limits | the flags above, or `src/scheduler/budget.js` for the defaults |
| Add a job | a module under `src/scheduler/jobs/`, an entry in `JOBS` (`src/models/jobRuns.js`), and a phase in `src/scheduler/scheduler.js` |

## Honest limits

- **The store is JSON files.** `refresh_state.json` holds up to five rows per company (about 700 KB at today's size). At 10,000 companies it would be around 30 MB, rewritten whenever it changes: that is one of the reasons [docs/scale.md](scale.md) puts the move to a database at the next order of magnitude. The shapes were chosen so that move is a load step.
- **One operator, one machine at a time.** The data lock and the tick lock serialise writers on one checkout. Two checkouts writing to git will conflict on the data files; the workflow retries a push and then stops.
- **The GitHub Actions workflow could not be run from where it was written.** Its YAML parses and its steps were checked by reading, but it has not run on GitHub. Run it once by hand (`workflow_dispatch`) with `SCHEDULER_ENABLED` set and read the log before trusting the timer.
- **Status detection is deliberately narrow.** It catches sentences about the company itself and misses the rest: a shutdown announced only on social media is found by a person. A wrong signal wastes a person's time and teaches them to ignore the list; a missed one is found by the next check or by a person.
- **Funding detection is deliberately strict.** A story about one of our companies that does not name a known investor or its city goes to discovery as a possible duplicate instead of becoming evidence. The cost is a person's look; the alternative is another company's funding on a real record.
- **Times are UTC.** Clocks and the run log are ISO-8601 UTC; a "day" is 24 hours.
