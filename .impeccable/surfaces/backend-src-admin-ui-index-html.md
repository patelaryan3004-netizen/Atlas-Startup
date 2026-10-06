---
version: 1
slug: "backend-src-admin-ui-index-html"
primary_target: "backend/src/admin/ui/index.html"
related_targets: []
---

# Surface brief: Data Command Center

Scope: `backend/src/admin/ui/` (index.html, app.js, styles.css). One internal page served by `npm run admin`.
Mode: Operate (the visitor completes a task). The owner pinned the content and its order, so no direction roll
was run: "a brief-pinned direction beats the roll".

## Audience, job, task

One operator, at their own laptop, deciding what is true enough to publish. They open it, see eight counts, and
work down: discovered companies (approve, reject, edit, merge, publish), data quality, conflicts (settle by
choosing which source is right), suggested fills, the enrichment queue, failed imports, the audit trail.
Used in short sessions, often; real states matter more than looks: empty, loading, error, forbidden, mid-run.
Constraints: vanilla JS, no build, strict CSP, `textContent` only, token in sessionStorage, light and dark.
Unresolved: whether colleagues will use it (roles exist; viewers see no action buttons).

## Direction contract

THESIS: The page is the operator's queue, not a report: every number leads to the thing it counts, and every
control says what it does to the public record. Refuses the hero-metric card grid and a card per section: the
eight counts are one instrument band; sections are hairline-ruled bands on one page.

OWN-WORLD: The public site's world, rendered as a tool: ink-green-black ground and amber as the single accent
(act here), warm-neutral light theme for daytime. Hairline rules, 6px controls, tabular numerals, Inter or the
system sans, text chips with a leading dot for status, amber for "needs a person", red only for failure.
Rows not cards; bars drawn as thin tracks; icons drawn at one 1.75 stroke. Recognisable with content removed
by the band of eight cells, the amber action color and the hairline table rhythm.

STORY: The owner sees at once whether anything needs them, believes each number because it states what it
counts, and acts without leaving the page, knowing every action is recorded with their name and a reason.

FIRST VIEWPORT: Top bar (title, section links with live counts, signed-in name and role, refresh, theme, sign
out). Directly beneath, the band of eight cells in one row at 1200px and wider (4x2 then 2x4 below), each a
link to where that number is worked. The discovered table begins in the same viewport, filters and search
above it, row actions at its right; no hero, no intro copy.

FORM: Brief-pinned order (tiles, discovered, quality, conflicts, then suggestions, queue, imports, audit).
Position on the ordered list: not applicable (no roll). Seed key: none.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict,
DESIGN.md, and every shipping raster carrying its provenance.
