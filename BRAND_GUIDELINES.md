# Still Early: brand guidelines

The site is **Still Early** (it was called AU Startup Map until October 2026). Written out it is "Still Early"; as a logo it is the lowercase wordmark **still early.**, with the full stop in coral. It is text, not a picture: `components/brand/Wordmark.jsx`, Instrument Serif, no symbol. The names are in `frontend/src/brand.js`.

The look of the site is one design, set once in `frontend/src/styles.css` (the tokens) and `frontend/src/brand.css` (the shared components). A page uses them and never carries a colour, a font or a button of its own. A new page or component follows this file.

The feeling: **welcoming, distinctive, calm, easy to navigate.** A white page with room to breathe, one forest green for what can be pressed or is chosen, an editorial serif for the big headings, and plain Inter for everything that is read in bulk.

## Colour

Defined as custom properties on `:root` in `styles.css`. Use the names, never the hex.

| Token | Value | What it means |
| --- | --- | --- |
| `--bg` | `#FFFFFF` | The page, panels, cards, fields |
| `--bg-subtle` | `#FAFAF7` | A quiet band, a hover, the table header, a placeholder tile |
| `--text` | `#171C19` | Headings and body text |
| `--text-2` | `#626A65` | Secondary text, labels, captions (5.9:1 on white) |
| `--green` | `#234B3A` | The action and selection colour: primary buttons, the open tab, the selected switch, links, clusters |
| `--green-hover` | `#193B2C` | The green's hover and pressed state |
| `--butter` | `#F6E79A` | **Investors.** The VC badge and the kind of investor, wherever one is named |
| `--coral` | `#E98369` | Warmth, used sparingly: the shapes on the Collections card |
| `--peach` | `#FFF1EA` | The soft surface of an editorial moment (the Collections card, the lists of people) and the **selected row** |
| `--border` | `#E2E5E0` | Every thin line |

| `--navy` | `#071822` | **The night of the welcome page**: its ground and the cinematic opening. Text on it is `--on-navy` (`#FAFAF7`-ish, 17:1) or `--on-navy-2` (74%). Only the welcome page stands on it; every other page is white. |

Derived: `--green-tint` (a tint of the green for hovers and selected chips), `--on-green` (white, the ink on a green fill), `--danger` (`#B3382A`, errors only).

Rules:

- Dark text on yellow, peach and coral surfaces. White text only on the green.
- Company logos keep their own colours and proportions. Never recolour, crop or replace one; when a logo is missing the tile shows the company's first letter, and never another company's logo.
- Colour never carries meaning alone: a state also has words or an icon.
- Contrast: body text at least 4.5:1, large text at least 3:1.
- The older names (`--ink`, `--paper`, `--line`, `--accent`, `--panel`, `--muted`) are aliases of the tokens above for the rules that already use them. New code uses the new names.

## Type

Two families, both served with the site (`@fontsource`), loaded in `main.jsx`.

- **Instrument Serif**, regular and italic: the big headings and the odd editorial moment. At most **one italic word** in a heading, in the green (`Find your <em>people.</em>`). Never for dense information or controls.
- **Inter** (variable): navigation, buttons, forms, company names, metadata and body copy.

| Class / token | Use | Size |
| --- | --- | --- |
| `.display` (`--fs-display`) | The one hero heading of a page | 48px on a phone to 96px |
| `.serif-h1` (`--fs-h1`) | A page's title | 40 to 64px |
| `.serif-h2` (`--fs-h2`) | A section's title | 32 to 44px |
| `.lede` (`--t-lede`) | The line under a heading | 18px |
| body (`--t-body`) | Text a person reads | 16px |
| small (`--t-small`) | Labels, counts, notes | 14px |
| `.kicker` | A small tracked label above the hero heading (use once, on the Explore page) | 12px, caps |

Headings use `text-wrap: balance`; the sizes are fluid (`clamp`), so they stay balanced on a phone. Tracking is never tighter than -0.04em.

## Space, shape, depth

- **8px rhythm**: `--space-1` (8) to `--space-12` (96), with `--space-0` (4) for the smallest gap.
- **Controls** are 40px (`--control-sm`) or 48px (`--control`) tall, and a touch target is never under 44px on a phone.
- **Radius** is modest: `--r-sm` 8, `--r-md` 12 (buttons, fields, rows), `--r-lg` 16 (cards, panels), `--r-xl` 20 (the workspace, dialogs). Pills (`--radius-pill`) are for the header's navigation, the header's one action and the chips.
- **Borders** are 1px `--border`. **Shadows** are soft and only for what floats: `--shadow-1` (a mark on the map) and `--shadow-float` (a menu, the map's preview card, a dialog). No hard offset shadows, no glow.
- **Motion** is short and purposeful (150 to 250ms, `--ease`), and every animation is off for a visitor who asked for reduced motion.

## Components

All are in `frontend/src/components/brand/` (React) and `brand.css` (styles).

| Component | Class | Notes |
| --- | --- | --- |
| `SiteHeader` | `.sh` | On every page: the name (to `/welcome`), the pill of five places (Explore, Collections, Investors, Jobs, Saved), **Add company**, and a menu. Real links, so each opens in a new tab. On a phone the places move into the menu. |
| Buttons | `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-quiet`, `.btn-sm` | Green to go on, outlined for the other way. The older `.taskbtn`, `.hdrbtn`, `.linkbtn` are drawn the same. |
| Field and search | `.field`, `.field-lg`, `SearchBar` | 48px (56px for a page's main search), a green ring on focus. |
| `Segmented` | `.seg` | The switch between ways of looking at one thing: All / Startups / VCs, Map / List, Cards / Table. The chosen one is green. |
| `Badge`, `VcBadge` | `.badge`, `.badge-vc`, `.badge-green` | VC is butter yellow; "Hiring" is green. |
| `CompanyRow` | `.crow` | Logo, name, what it is, bookmark. The open one is peach. Used in the results column, the phone's sheet and Saved. |
| `BookmarkButton` | `.bm` | The one way to save a company or an investor (kept in the visitor's browser). |
| Tabs | `.tabs`, `.tab` | An underline in the green marks the open one. |
| `EmptyState` | `.empty-state` | What is missing, why, and the one thing to do. |
| Collections card | `.collections-card` | The peach, coral-accented card, linked to `/lists`. |
| Surfaces | `.surface`, `.surface-subtle` | A bordered box and a tinted band. |

## The welcome page (the night)

`/welcome` is the one dark page, and it is the front door: `frontend/src/LandingPage.jsx`, `components/landing/`, `welcome.css`. Its order is fixed by the approved design: a cinematic opening, the butter-yellow introduction, the editorial showcase (white, coral, forest green and yellow panels of different sizes), the off-white hiring preview, and the updates sign-up with the foot.

- **The opening** is a night sky over Australia with a person looking up (`public/img/hero-night.webp`, and `hero-night-sm.webp` for a phone). **There are no words in the picture**: the capsule, the headline, the email field, the copy and the buttons are live text over it, and the gold constellation is a live drawing (`Constellation.jsx`, from the coast the site already has), so a phone can move it clear of the headline. Do not put text in the picture.
- **The headline** is Instrument Serif at one weight, large and tight, with one italic word. The full stop of a headline on the navy is quieter (`.se-stop`).
- **Panels** are set into the night with a radius of 18 to 34px. Dark text on yellow, coral and the off-white; white only on the forest green.
- **Product previews are previews.** Each one (`components/landing/previews.jsx`) is wrapped by `<Preview>`, which hides it from a screen reader, takes it out of the keyboard and the pointer (`inert`), and holds nothing that could be pressed. The names and work in them are illustrations: nothing is a member, nothing is in a database. Every group says so in words (`.se-demo-note`, "Product preview · Illustrative content" at the foot) and has one sentence for a screen reader. Never put an invented testimonial, count, score or endorsement in one. Pictures in them are SVG scenes (`scenes.jsx`), not photographs of anyone's work.
- **Honest about what is not there**: hiring is labelled "Coming next"; the buttons in its preview do nothing and the page says so; there are no accounts, so "Log in" goes to a note saying so; "Explore the feed" goes to the news feed that exists and says the community feed is still being built.
- **The two email forms are one implementation** (`SubscribeForm.jsx`, `hooks/useSubscribe.js`): validated in the browser, sent to `POST /api/feedback` with `type: "subscribe"`, and they say it worked only after the server has said it stored it.
- Previews size themselves in `em` from the panel that holds them (container query units) and never go under 9.5px.

## Pages

Every page has the header, the same buttons and fields, and the same spacing. Layout follows the content:

- **Explore**: the heading and the main search, then one workspace (toolbar, results column, map). The map is the largest thing on the page.
- **Welcome**: the night page above. It reads nothing from the server on load.
- **Investors**: cards or a table of the same results, with a profile panel beside them. The kind of investor is a butter badge.
- **Jobs**: a serif heading, filters, and one card per company that is hiring.
- **Collections**: editorial cards; the lists of people are the peach ones.
- **Saved**: a dialog over any page, with the companies and the investors saved.
- **Forms and dialogs**: one dialog style (`.modal-panel`), serif title, 48px fields, a green primary button.

## The map

- The background is the light one: quiet streets, pale green parks, soft blue water (the OpenStreetMap tiles, washed out by `.map-quiet-light`). It never competes with the marks.
- A company is a rounded square with its logo (`.pin-tile`). An investor is the same square with a butter **VC** badge. Marks close together become a numbered green cluster that opens on a press.
- **Precision is shown, never hidden**: a mark at an office address has a solid edge; one at a suburb or a city has a **dashed** edge. A preview card says where the place is and how well it is known. Never invent an address or move a mark to tell two apart.
- Keep the attribution, the zoom buttons and the "All Australia" way back.

## Accessibility

- A visible focus ring on everything that can be pressed: `outline: 2px solid var(--green)`, offset 2px (butter yellow on the navy of the welcome page).
- Every control is reachable and usable from the keyboard; Escape closes a menu, a preview and a dialog.
- State is in the markup (`aria-pressed`, `aria-current`, `aria-expanded`), not only the look.
- The page never scrolls sideways, at 320px and up.

## Do not

- Do not add a colour, a font or a radius that is not above. Add a token first.
- Do not use the serif for body text, controls or dense lists.
- Do not put more than one italic word in a heading.
- Do not use yellow or coral for anything but what they mean here.
- Do not stand a company in for another company's logo, and do not show a fact no page backs.
