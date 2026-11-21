# Innovation Bay as a job discovery source

Innovation Bay's job board (`jobs.innovationbay.com`) is read as a place to **find employers and vacancies to check**, never as a place roles are copied from. The vacancies on the hiring desk still come from each employer's own feed, so a role is shown once and every application link is the employer's own. Code: `backend/src/jobsync/network.js`; the step is `network` in `refresh.js`; it runs inside the existing twice-daily refresh (8:10 am and 8:10 pm Melbourne time).

## Is there an authorised feed? No (checked 2026-11-21)

| Where | What it gives | Verdict |
|---|---|---|
| `jobs.innovationbay.com` pages | The board is a **Getro** network (its own page data names network `innovation-bay`, 415 companies, ~9,000 jobs worldwide). The page serves the newest 20 jobs, not filtered by place. | A **sample**. Read, never stored as roles. |
| `jobs.innovationbay.com/robots.txt` | Rules for three named bots (`ExaSearchBot`, `AhrefsBot`, `meta-externalagent`: `Disallow:` empty, `Crawl-delay: 10`) and a `Sitemap:` line. Nothing for any other client. | Our reader is not refused. It keeps to the 10 s pace anyway. |
| `jobs.innovationbay.com/sitemap_companies.xml` | The company pages the site lists for crawlers (415). | Read. |
| A company page | The company's profile: name, website, places, size, industries, whether it has open jobs. Its jobs are drawn by script from Getro's API. | Read (profile only). |
| `api.getro.com` | Getro's API. `robots.txt`: `User-agent: * / Disallow: /`. Getro's own help article ("Ways to Use the Getro API") says it is read-only access to **your** job board, with a key the board's owner takes from its Getro account (API docs at developers.getro.com, whose `robots.txt` answers access-controlled, so the fetcher did not read it). | **Not used.** No key exists for us, and the host asks clients not to read it. |
| An RSS / XML / JSON job export | None found on Innovation Bay's or Getro's public pages or help centre. | None. |

So the only route to the complete list of Innovation Bay jobs is a key issued **by Innovation Bay** from its Getro account. That is theirs to give; nothing here asks for it, bypasses a refusal, or pays for one. If the owner wants it, the message to send is at the end of this page. Even with a key, the roles would be confirmed through each employer's own feed before they were shown (below), so the key would add coverage, not change the rule.

## What a refresh does with it

1. **The board page** is checked to be Innovation Bay's (its own data names the network), and its 20-job sample goes through the same path as every venture firm's sample (`vc.js`):
   - a company we hold whose job links to a board on a supported provider becomes a `review` row. `confirm.js` asks the **employer's own feed** whether it lists that job, and only then is the board read;
   - an Australian company we do not hold becomes a **lead**;
   - a LinkedIn link, or anything on a provider the sync does not read, names nothing.
2. **The company list** (415 companies) is read a slice at a time: each company once a week, by the same stateless half-day rotation the website discovery uses, at most 45 pages a refresh, **one page every 10 seconds**. A company the directory holds and whose job board is already read is skipped. Each profile is matched against the directory with the project's own resolver (`discovery/resolve.js`: website domain, then name):

| What the profile is | What happens |
|---|---|
| In the directory, hiring, no board of its own read yet | `job_coverage.hiring_hint_at` is set: its own website is looked at for a job board at the **next refresh**, not at its turn in the week. |
| In the directory, on the list | A lead made earlier for it is settled (`in_directory`). |
| Already a pending candidate | Nothing: it is in the review queue. |
| The same name as a company or candidate we hold, with another website on record (a rebrand, a second domain) | Counted (`same_name`), not queued: a person would only be asked to confirm it. A looser resemblance is still a lead, saying what it resembles. |
| Innovation Bay itself (it is on its own list) | Skipped. |
| Not in the directory, Australian, not obviously large (≤ 1,000 people), with a website | A **lead** (`unknown_company`, `needs_review`) holding what its page says. |
| A venture firm we hold, hiring, whose own careers page is not one of the 15 firms checked | A lead (`investor_hiring`) saying so. |
| A venture firm we do not hold, Australian | A lead (`unknown_investor`): it goes through the investor directory, not the startup queue. |
| Outside Australia, or no website, or large | Counted, nothing kept. |

3. The roles of every company in the directory are read from the employers' own boards as before. **Nothing in `jobs.json` comes from Innovation Bay**: there is no `jobs.innovationbay.com` link in any role, and no role of its own to duplicate. A role Innovation Bay shows that an employer's feed also lists is the employer's role, once (`tests/innovationBay.test.js` runs this end to end).

Australian locations and remote roles open to Australians are decided where they always were: from the employer's own feed (`locations.js`), never from the network's label.

## The approval queue

New startups wait in two places, and the sync never adds to the directory itself:

- **`job_leads.json`** is written by every refresh and committed by the existing workflow, so it is current twice a day. See them: `npm run jobsync -- leads` (`--kind`, `--status`).
- **The directory's own review queue** (`candidates.json`, the admin "Discovered" list) is fed by a command, because the workflow commits only a fixed list of files and `candidates.json` is not on it:

```bash
cd backend
npm run jobsync -- leads --promote --by "your name" --limit 25    # hand the eligible startups to the review queue
```

The directory's own engine then does what it always does for a candidate: matches it against the directory and the queue again, reads the company's **own** website (robots.txt obeyed, three pages), judges whether it is Australian and a startup, and leaves it waiting for a person. The lead becomes `queued` (with the candidate's id), `in_directory` (the engine found it was already ours) or `rejected` (the engine had explicit evidence against it). Approving it in the admin is still a person's act.

The hiring desk's coverage dialog says how many startups wait for a person (`leads_waiting`): the leads still waiting plus those already in the review queue, **not** the venture-firm leads (they go through the investor directory), and not what was rejected or is now in the directory.

To have the refresh queue them by itself, the workflow would have to commit `backend/src/data/candidates.json`, `evidence.json` and `identifiers.json` too (one line in `.github/workflows/jobs-sync.yml`, which only the owner can edit). That is deliberately not done: a refresh that wrote candidates the workflow then threw away would mark leads queued that were not.

## Commands

```bash
npm run jobsync -- network               # read Innovation Bay now: the board's sample, and this half-day's slice of the company list
npm run jobsync -- network --all         # every company on the list (about an hour: 10 s a page); --limit N for part
npm run jobsync -- leads                 # what the boards and networks named that the directory does not hold
npm run jobsync -- leads --promote --by "name" [--limit 25] [--dry-run]
```

## What it costs and what it will not do

No subscription, no key, no language model: HTTP reads of public pages at the site's own pace, and arithmetic. If the site's `robots.txt` starts refusing, or it answers 401/403/429, reading stops for that run, says so in the board's note (`job_vc_boards.json`, shown in the hiring desk's coverage dialog), and tries again at the next. It does not use `api.getro.com`, any login, any cookie, or anything the site did not serve to an ordinary visitor.

## A message to Innovation Bay, if you want the complete list

> Hi, we run Still Early (stillearly-au.vercel.app), a free directory of Australian startups, with a hiring desk that links every role to the employer's own application page. Would Innovation Bay be willing to share a read-only Getro API key for its job board, or a feed of its jobs? We would use it to find employers and to check each role against the employer's own careers page, and link back to jobs.innovationbay.com. Happy to follow any terms you set.
