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
| How the pictures were made | `frontend/scripts/art/make-hero-art.mjs` |
| The link-preview picture | `frontend/scripts/make-og-image.mjs` writes `public/og-image.png` |

It is pre-rendered at build (`scripts/prerender.mjs`) and hydrated: the build also asks, in the head, for the picture that the screen will use and for the two Instrument Serif files, and the page is not sent the snapshot the map draws from.

## The artwork is a stand-in

Only the composed design (793 px wide) was supplied, not the clean hero picture it mentions. `make-hero-art.mjs` takes the opening out of it, removes every baked-in word, control and the constellation, refills those places from the sky around them, and writes a 2000 px picture and a 900 px phone crop. Every word on the page is live text and the constellation is a live drawing. Because the source is small, the picture is softer than an original would be (most visible on a large retina screen). **To finish it, replace the two files with a clean, text-free, full-size original of the same scene** (about 2400 x 1620, and about 1000 x 1650 with the person in the middle); nothing else needs to change. The pictures inside the product previews are SVG illustrations (`scenes.jsx`), not photographs.

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
