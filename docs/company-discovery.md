# Company discovery: where the hiring desk finds companies it does not hold

The hiring desk can only show a vacancy for a company in the directory, and the directory is never added to by the sync. So two public sources are read **to find Australian startups we do not hold yet**, and the people who run the directory approve them. Once one is approved, the existing refresh finds its job board by itself (a company never looked at is looked at at once), reads its authorised public feed twice a day, and shows its verified Australian vacancies. Nothing here costs money, calls a language model, uses a key or reads anything an ordinary visitor could not.

| Source | What it names | Read | Code |
|---|---|---|---|
| **Innovation Bay's company directory** (`jobs.innovationbay.com`) | its 415 companies, each with a profile: website, places, size, industries, whether it is hiring | every refresh reads its sitemap; each company's page once a week (about 30 a refresh, one page every 10 seconds) | `network.js` |
| **Nine official portfolio pages** (Blackbird, AirTree, Square Peg, OneVentures, Investible, Startmate, Folklore, Giant Leap, Cicada) | the companies each firm or accelerator backed | each page once a week; only companies nothing has seen are looked at | `portfolio.js`, `discovery/portfolioSources.js` |

## Does the Innovation Bay integration cover the directory, or only a sample? (checked 2026-11-21)

Both, and the directory is the main thing. Its job list is a 20-job worldwide sample (and a sample is never used as a source of roles), but the **company directory is read in full**: the site's own sitemap names 415 companies and the first full read took 379 of their pages (the other 36 are companies we hold whose job board is already read, so their pages say nothing new). Since then every company is read once a week by a rotation that needs nothing saved between runs (each company belongs to one half-day block of fourteen). A company page is public and its robots.txt does not refuse us; its job list is the one thing that needs Getro's API, which is not used.

Nothing is left out that the site lets us read. The company list is the whole directory; what is behind the API (the complete job list) would add vacancies only, and each vacancy comes from the employer's own feed anyway.

## What happens to a company a source names

1. **Match** against the directory and the pending candidates with the project's own resolver (website domain, then name). A company we hold is left to the discover step, which looks at its own website for a job board (sooner if a source says it is hiring and no board of it is read). A pending candidate is already in the review queue. The same name as a company we hold, with another website on record, is counted and not queued.
2. **Judge**, for a company a *portfolio* page names (a portfolio page does not say where a company is): the directory's own engine reads the company's **own** website (robots.txt obeyed, three pages) on a scratch copy that writes nothing, and says whether it looks Australian and a startup. Explicit evidence against either means no lead. (Innovation Bay's profiles carry places, so they need no judging.)
3. **Lead.** What is left becomes a lead in `job_leads.json` (committed by the existing workflow), with the source that named it, what the page says and the engine's verdict. The hiring desk counts as "Australian companies waiting for a person" only the startups from Innovation Bay (an Australian place on the profile) and the portfolio leads the engine judged Australian (yes or likely).
4. **Queue.** `jobsync leads --promote --by "name"` hands the eligible leads to the directory's review queue (`candidates.json`, the admin Discovered list) through the same engine, one source at a time, with that source's page as the evidence. A person approves or rejects each; approving is the only way a company reaches the directory. The queue is a command, not part of the refresh, because the workflow commits a fixed list of files that does not include `candidates.json`.

Where a portfolio page is read: each has a row in `job_vc_boards.json` (platform `portfolio_page`, left out of the public board) saying when it was read, how many companies it names and how many were new. A page never read is due at once; one read is due again a week later; a page that was down, or that has more new companies than one refresh looks at (30), is asked again at the next refresh. A page that names no company any more (a layout we cannot read) changes nothing and says so in its row.

## What it found the first time (2026-11-21)

- Innovation Bay: 379 company pages, 70 already in the directory, 54 already pending candidates, about 118 startup leads and 42 Australian venture firms (which go through the investor directory, not the startup queue). 117 leads went through the engine: 104 now wait in the review queue, 13 were rejected by its own check.
- The portfolio pages: the saved reads of 30 October name 566 companies, **all but two** already in the directory (226) or the queue (340): the importer had taken them. The live pages today name 573 companies; 19 are new since (3 weeks), and those are the weekly reads' first catch.

## Commands

```bash
cd backend
npm run jobsync -- network [--all]                        # Innovation Bay now (this half-day's slice, or every company)
npm run jobsync -- portfolio [--all] [--source id]        # the portfolio pages now
npm run jobsync -- leads [--kind k] [--status s]          # what the sources named that the directory does not hold
npm run jobsync -- leads --promote --by "name" [--limit 25] [--source id] [--dry-run]
```

## What it will never do

Buy or request a Getro key, use `api.getro.com`, read LinkedIn or a proprietary database, read a page its robots.txt refuses, work around a login or a block, add a company to the directory, store a role from a discovery source, or call a language model. A source that goes down, refuses or changes layout leaves everything as it was and says so.
