# The welcome page (Still Early)

`/welcome` is the site's front door, built from the approved design (a composed picture of the whole page). The brand is **Still Early** (lowercase wordmark "still early."); the site was called AU Startup Map until October 2026. The rules for keeping other pages consistent are in `BRAND_GUIDELINES.md`.

## Where it is

| What | Where |
| --- | --- |
| The page | `frontend/src/LandingPage.jsx` (reads nothing from the server on load) |
| The opening, the capsule | `components/landing/Hero.jsx`, `Constellation.jsx` |
| The four sections and the foot | `components/landing/Sections.jsx` |
| The product previews and their pictures | `components/landing/previews.jsx`, `scenes.jsx` |
| The email forms | `components/landing/SubscribeForm.jsx`, `hooks/useSubscribe.js` |
| Styles | `frontend/src/welcome.css` (tokens in `styles.css`) |
| The night-sky pictures | `frontend/public/img/hero-night.webp`, `hero-night-sm.webp` (phone) |
| How the pictures are made | `frontend/scripts/art/finish-hero-ai.mjs` (from the Real-ESRGAN 4x of `scripts/art/hero-night-source.webp`); `upscale-hero.mjs` is the no-model fallback |
| The link-preview picture | `frontend/scripts/make-og-image.mjs` writes `public/og-image.png` |

It is pre-rendered at build (`scripts/prerender.mjs`) and hydrated: the build also asks, in the head, for the picture that the screen will use and for the two Instrument Serif files, and the page is not sent the snapshot the map draws from.

## The artwork

The night sky is the clean, text-free original the owner supplied (1527 x 1030, kept as `scripts/art/hero-night-source.webp`), made HD with a trained upscaler. **Real-ESRGAN x4plus** (the photo model, run on the laptop with `realesrgan-ncnn-vulkan`, the official release of github.com/xinntao/Real-ESRGAN) draws it at 4x (6108 x 4120): individual hair strands, sharp stars, tree branches, rock texture and the village lights, which a plain resampler cannot. `scripts/art/finish-hero-ai.mjs` then fits that output to the page: it is reduced to **3200 x 2158** with a Lanczos-3 filter widened for the reduction, 20% of the classical resampling of the original is blended back in (so it stays photographic, not painted), and a fine dither is added; the export is a lossy WebP at quality .92 (`hero-night.webp`, about 520 KB). The phone's file (`hero-night-sm.webp`, 1312 x 2158, about 155 KB) is the same slice of that picture as always (29.6% to 70.6% of the width, the person in the middle), cut from it, not enlarged again. The framing is the original's and the same as the page had before (an alignment test found the best match at zero shift and scale), so nothing in the layout moved. The picture is never stretched by CSS: a 1440 px screen at 2x draws it at 0.9x of its own size.

A trained model invents plausible detail, so it can leave small artifacts (a few tiny streaks among the stars); the blend and the size the page draws it at keep them out of sight. The classical route (`scripts/art/upscale-hero.mjs`: Lanczos-3, anti-ringing clamp, sharpening, no model) is kept as the fallback if the program is not at hand. Every word on the page is live text and the constellation is a live drawing; none is in the picture. The pictures inside the product previews are SVG illustrations (`scenes.jsx`), not photographs.

To change the picture: replace `scripts/art/hero-night-source.webp` with a new original of the same framing, make the 4x picture (command at the top of `finish-hero-ai.mjs`, about 5 minutes; the program and its 22 MB output are not in the repo), then run `node scripts/art/finish-hero-ai.mjs <the 4x png>` (add `--report=<folder>` for side-by-side comparisons). If the aspect ratio is not 1527:1030, update the `width`/`height` of the two image tags in `Hero.jsx`. A larger original is better still.

## Previews are previews

Everything in `previews.jsx` is illustrative: names, work, pictures. Each group is wrapped by `<Preview>` (`aria-hidden`, `inert`, no controls inside), has one sentence for a screen reader, and a note in words that it is illustrative. Nothing in them is a member or is in a database; do not put an invented testimonial, count, score or endorsement in one. Hiring is labelled "Coming next" and says its buttons do nothing.

## The email forms

Both forms (the opening's and the foot's) are one component on one hook. The address is checked in the browser and sent to `POST /api/feedback` with `type: "subscribe"` and a note of where it was left (`Signup: hero` or `Signup: footer`); the server needs a valid address and stores it in the same queue as the other feedback (`backend/src/data/feedback.json`, read with the admin key at `GET /api/feedback`). **The form says it worked only after the server answers 201.** A refusal or an unreachable server says so, and keeps what was typed.

What is **not** there: nothing sends an email (the site stores addresses; it has no mailing list or email service), and the feedback file is a file on the API server's disk, so on a host that resets its disk on each deploy the addresses are lost with it. Before the address is promoted, connect a real list (an email service, or a database) and point `submitFeedback` at it, or export the queue regularly.

## What goes where

| Link | Goes to |
| --- | --- |
| Explore the community (both) | `/` (the map): works with no sign-up |
| People | `/people` when the people page is switched on, else `/investors` (the one directory of people that is live) |
| Companies / Our story | `/` / `/about` |
| Log in | `#login`, a note that accounts are not open yet (there are no accounts) |
| Join us | `#join`, the sign-up at the foot |
| Explore the feed | `/news`, with a line saying the community feed is still being built |
| About, Contact, Privacy | `/about`, `/contact`, `#privacy` (a short note on the page) |

## Checked

Desktop (1920, 1440, 1024), tablet (768) and phone (390): no sideways scroll, a visible focus ring on every stop, controls at 44px or more, reduced motion honoured (the rising is off and nothing animates). The screenshots are in `docs/design-review/still-early/`.
