# H1.2 — Design-Input Bundle for Claude Design

_Prepared 2026-07-20. Hand this whole file to Claude Design (or paste its content into the prompt) to kick off H1.3 — the visual-direction round. Full context lives in [ui-overhaul.md](ui-overhaul.md); this is the condensed, self-contained brief._

## Note on the mockup source

The Miro **Page Mockups** frame turned out to be built from labeled wireframe rectangles (gray placeholder boxes with text captions), not actual pixel art — there's nothing to export as a reference image; the boxes carry zero visual design (color coding is access-level, not brand). What follows is a precise structural reconstruction of the target page instead, which is the useful part anyway. If Claude Design benefits from seeing the raw frame, the live board is here: [Page Mockups](https://miro.com/app/board/uXjVHIanl4w=/?moveToWidget=3458764678510157211) (Home is the leftmost column) — a manual screenshot from Miro would be the only way to get a literal image.

## The brief

> Design 2–3 **distinct visual directions** for Fandex's Home page — a public media-tracking/discovery app (games, movies, shows; more types planned). Do not touch any other page yet. We'll pick one direction here, then apply it everywhere.
>
> Visual language, logo, iconography, and typography are all **fully open** — nothing is locked. Surprise us within the constraints below.

### Why Home

Home is the new anchor page of the app's IA (it doesn't exist in code today — currently `/` is a login screen) and it exercises the widest range of shared components: navigation, filtering, search, stat displays, and the app's primary content pattern (card carousels). Per the project's own workflow doc, styling this one page first and picking a direction is cheaper than mocking all 8 pages three times over.

### Target structure (mobile, ~390–430px viewport — this is a mobile-first app)

Top to bottom, single column:

1. **Media type filter** — horizontal bar, persistent global control (Games / Movies / Shows, more types planned)
2. **Simple search** — a search entry point (tapping it is expected to lead into the app's Discover/browse search experience)
3. **Insight stat strip** — small at-a-glance stats (logged-in only — e.g. "12 items rated this month")
4. **"Your best-rated [facet]" callout** — one rotating highlight, e.g. best-rated actor/genre/studio from the user's taste profile (logged-in only)
5. **Card Carousel — "Popular right now"** — horizontal-scroll row of media cards (poster + title + release info), largest single block on the page
6. **Card Carousel — "Upcoming"** — same card treatment, different data set
7. **Card Carousel — "Fandex Recommendations"** — same card treatment, personalized (logged-in) — for anonymous visitors this row either collapses or falls back to a second popularity-driven row (see Auth variants)
8. **Bottom navigation bar** — persistent, 5 icons: Home · Search · Calendar · Wishlist · Profile, with the active item visually distinguished

Relative sizing from the source wireframe: each carousel is proportionally the largest content block (roughly 2× the height of the stat/search rows combined) — carousels are the dominant visual element on this page, not an afterthought.

### Content this page must design for (real data, not lorem ipsum — see [ui-overhaul.md §4](ui-overhaul.md#4-requirements-inventory-h10-output-verified-against-code-2026-07-20))

- **Card content**: poster image, title, media-type indicator, release date (or "TBA"), a crowd rating, and — for logged-in users — a Fandex Score badge (a 0–100 personal taste-match number, color-coded around a baseline).
- **Media types today**: Games, Movies, Shows (color-coded per type — reuse or evolve the existing palette if useful: games `#4ade80` green, movies `#f59e0b` amber, shows `#a78bfa` violet). Books and Boardgames are planned but have no data yet — the type system should read as extensible.
- **Auth variants** — design BOTH:
  - **Anonymous**: Popular + Upcoming carousels render from live/public data; no stat strip, no best-facet callout, no Fandex Score badges on cards; Recommendations row either hidden or replaced by a second Popular-style row. A "Log in" affordance should be reachable without being a full-screen blocker (the old login-only landing page is being retired).
  - **Logged-in**: full page as above, cards can carry Fandex Score badges.
- **States**: default (populated) and **empty/cold-start** (a new account with no ratings yet — the recommendation row and best-facet callout have nothing to show). Loading and error states matter but don't need bespoke treatment in this first direction-pick round.

### Guardrails (non-negotiable, everything else is open)

- **Mobile-first**, but must scale to desktop later — don't design something that only works at one width. Desktop gets the same 5-item nav as a top bar instead of a bottom bar (already decided); layouts widen into multi-column where it makes sense.
- **Five media-type identity must stay visually consistent** wherever a type badge/icon appears — whatever visual system you propose for "this is a Movie" must extend cleanly to Games/Shows/Books/Boardgames.
- **The Fandex Score badge is a first-class element**, not a decoration — it's the app's differentiator (a personal 0–100 taste-match number). Give it real visual weight in at least one direction.
- Treat any AI-generated logo as **directional exploration only** — not a final asset. It's fine to leave the logo/wordmark loose in this round.
- This is a hobby project, not a corporate product — playful/expressive directions are welcome; it should not read as generic dashboard software.

### Deliverable

2–3 directions for this one page (Home, both auth variants + cold-start empty state), visually distinct from each other — not 3 minor color swaps of the same layout. We'll compare and lock one, then this doc's brief gets reused to apply it everywhere else.

---

## Requirements inventory (for reference — full detail in [ui-overhaul.md](ui-overhaul.md))

Every other page's per-page inventory (access, data, views, states, auth variants, components) is documented in ui-overhaul.md §4, and will be handed to Claude Design in the same shape once the Home direction is locked (H1.5). Nothing else needs to be designed in this round.
