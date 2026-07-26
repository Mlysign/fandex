# 00 · Decisions — Fandex UI Overhaul

**Chosen direction: 2a "Ticket · Calm".**

## What it is

Ticket · Calm treats Fandex like a well-set printed programme rather than a
streaming storefront. It pairs a **warm, near-black paper ground** (`#100E0C`,
not a cool blue-black) with an **editorial serif for display** (DM Serif
Display), a **quiet grotesque for UI** (Space Grotesk), and a **monospace for
metadata and micro-labels** (Space Mono). Colour is rationed hard: a single
brass **gold accent** (`#C8A24B`) carries every primary action and active
state, and the only other colour on a typical screen is the small media-type
dot and the Fandex Score. Posters and the titles themselves are meant to be the
loudest things on screen.

## Personality, in concrete terms

- **Density:** medium-calm. Screen gutter is 20px on mobile. Vertical rhythm is
  generous (section headers sit ~13–26px off their content). Cards are equal
  size in a rail or a 2-up grid; nothing is a hero tile competing for attention.
- **Contrast:** high for text (primary text is 14–15:1 on both surfaces), low
  for chrome. Dividers are 9% white hairlines, never solid rules. The interface
  recedes; content does not.
- **Corner language:** soft but not round. Panels and inputs are 12px, poster
  cards 10px, inline buttons 7px, and anything that is a *control you toggle*
  (filter chips, primary buttons, avatars, the score pill) is fully rounded
  (`999px`). The mix of 12px panels and pill controls is the signature.
- **Motion:** restrained. 120ms press feedback, 200ms for hovers and chip
  swaps, 320ms for view/sheet changes, all on `cubic-bezier(0.2,0,0,1)`. No
  parallax, no auto-playing carousels, no bounce. Things fade and slide short
  distances.
- **How it should feel to scroll:** unhurried. Serif section headers act as
  chapter markers; horizontal rails invite a lateral glance then return you to
  the vertical spine. It should feel like paging through a curated catalogue,
  not doom-scrolling a feed.

## Why this over the alternatives

Two other directions were built and rejected:

- **1a "Cinemascope"** — poster-forward, dramatic, neon lime/gold/pink accents,
  ring-style scores, condensed display type. Rejected: the neon accents fight
  the posters, three loud accent colours undercut the media-type semantics, and
  the drama does not age well across seven utilitarian pages (calendar,
  library, settings). Great for a launch screen, tiring as a daily tool.
- **1b "Index / The Collection"** (later reworked into a TMDB/Trakt-style modern
  minimal take) — cool near-black, monochrome chrome, one green accent.
  Rejected as the primary: it is *good* but generic; it reads like every other
  tracker. Ticket · Calm keeps the same content-first discipline but has a point
  of view (editorial serif + brass) that is recognisably Fandex.

Ticket · Calm won because it is **calm enough to live in every day**, **opinionated
enough to be a brand**, and **cheap to extend** — every new page is assembled
from the same handful of parts (panel, rail, card, pill, eyebrow) with no
bespoke chrome.

## The one thing to preserve above all

The restraint. If a future feature "needs" a fourth accent colour or a second
filled button on a screen, that is almost always the wrong call in this system —
reach for the gold accent, a neutral, or hierarchy/spacing first.
