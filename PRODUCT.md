# Product

<!-- impeccable:product-schema 1 -->

> Written 2026-10-06 without an interview: the owner asked for the build to continue without questions, so
> every fact below is drawn from the repository or from the owner's written brief. Facts marked *(inferred)*
> are my reading of that brief and are not confirmed; correct them when you see them.

## Platform

web

## Users

- **Public visitors** find and explore Australian VC-backed startups on a map and in lists: jobs, news,
  curated lists, tracked companies, startup submission (`frontend/`, live at au-startup-map.vercel.app).
- **The operator of the data** is the owner of the project, working alone at their own machine, deciding what
  is true enough to publish. The Data Command Center is for them. *(inferred: "internal tool for one
  operator"; the roles viewer, reviewer and admin exist so colleagues can be added later.)*

## Product Purpose

A live directory of Australian VC-backed startups. The Data Command Center exists so that what the public
sees is true: it shows what discovery found, what is missing, what disagrees, and lets a person decide,
with every decision recorded. Success is a record the owner can defend: every fact has a source, every
change has an author, and unknown stays unknown.

## Positioning

Field-level provenance and an append-only audit trail on a hand-curated directory: a claim shows where it
came from, a conflict is flagged instead of overwritten, and nothing a machine found reaches the public
record without a person's say-so. A scraped or licensed database could not truthfully claim that.

## Operating Context

- Runs locally with `npm run admin`, on 127.0.0.1 only, never deployed; Render keeps no disk, so state lives
  in git as JSON files in `backend/src/data/` and every change is a diff for the owner to commit.
- Candidates are staging data: they never appear publicly until published. Enrichment defaults to
  "suggest" mode, which records evidence and changes no company.
- Work is a loop: open it, see what needs a person, decide, move on. *(inferred)*

## Capabilities and Constraints

- No LinkedIn scraping, no bypassing access controls, no copying proprietary databases, respect robots.txt
  and site terms. Never silently merge uncertain companies. Never fabricate; unknown stays null.
  Never silently overwrite reliable information: flag the conflict.
- Vanilla JS, no build step, strict CSP (no inline script or style); all dynamic content set with
  `textContent`, because company names come from websites.
- Roles: viewer (look), reviewer (decide about candidates, dismiss suggestions, retry tasks),
  admin (merge, publish, settle conflicts, apply suggestions, seed and run the queue).
- Undecided: whether colleagues will use it; whether it should ever be hosted (the answer so far is no).

## Brand Commitments

The public site's identity is the incumbent: ink-green-black ground (`#0a0e0f`), warm off-white ink
(`#e8e6de`), amber (`#f5a623`) as the one accent, Inter / system sans (`frontend/src/styles.css`).
The Command Center inherits it so the two read as one product. *(inferred, not requested.)*

## Evidence on Hand

Real data in `backend/src/data/`: 216 companies, 6 candidates, 29 open conflicts, 49 suggested fills,
213 enrichment tasks, a 141-entry audit trail. There are no other users, no logo for the admin, and no
usage history: do not invent any.

## Product Principles

1. Unknown stays unknown: an empty cell is shown as empty, never as a guess.
2. A decision is a record: every action says who, what and why, and cannot be edited afterwards.
3. Say what a number counts: every figure carries the definition a reader would otherwise have to ask for.
4. The public record moves only by a person's act: the interface names what is public and what is staging.

## Accessibility & Inclusion

Not specified by the owner. Working floor *(inferred)*: WCAG AA contrast, full keyboard operation, state
never carried by color alone, light and dark.
