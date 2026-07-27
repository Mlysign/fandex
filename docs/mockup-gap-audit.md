# Mockup-vs-live structural audit — 2026-07-27

**Why this exists.** H1.6 applied the design system's *tokens* (colour, type,
radius, spacing) but kept the app's *existing structure* almost everywhere. The
cause was a rule written down early in H1.6d — "respect the shipped Q14
decision, restyle colours/tokens only, don't relitigate working UX without
being asked" — which was then applied to every subsequent mockup-vs-code
conflict. Roughly 30 instances. The result is an app that is Ticket·Calm
*coloured* but anatomically pre-H1. Verification compounded it: the standard
was "no console errors, tests pass, tokens resolve", never "put the mockup
beside the live page and list the differences".

**The rule is now inverted:** where the mockup and the shipped UI disagree, the
mockup wins unless there's a data or platform constraint that makes it
impossible. Those exceptions get named here, not assumed.

Source of truth: `docs/design/fandex-handoff/03-components.md` (structure) and
`04-pages/*.html` (the 10 mobile frames). Token-level differences are NOT in
this list — those are done. This is anatomy only.

---

## ✅ Fixed 2026-07-27

### Poster card (`PosterCard`, `ActionCells`, both score badges)
The card appears on every page, so this was the single biggest source of "looks
nothing like the mockup".

| | Was | Now (per §2) |
|---|---|---|
| Poster | Below a full-width type-chip strip; 140% padding-box ratio | Flush to the card's top edge, `aspect-[2/3]` |
| Type chip | Its own strip above the poster | Overlaid on the poster, top-left, on a 62%-opacity plate |
| Score | Two overlay badges in the poster's top corners (Fandex right, crowd left) | ONE score in the meta row — serif number + mono `/100`. Fandex when signed in, community rating in its place for anon (D-E) |
| Actions | 3 cells (Rate · Watched · Wishlist), above the footer | 2 buttons (Rate `flex:1` with Star+label · Bookmark 32px square), below title+meta |
| Title | 2-line clamp with reserved min-height | Single line, ellipsis |

### Home
- **Logo replaced.** The old mark was an indigo→violet (`#6366f1`/`#8b5cf6`)
  "F" monogram — two colours in *no* Ticket·Calm token. Now the mockups' own
  stacked-card mark (show-purple card rotated -9° behind an accent-gold one).
- **Removed** the big centred logo, the "Fandex" headline, the "Track your
  wishlists…" flavour paragraph and the 4-provider button stack. None are in
  the mockup. Anon now gets the mockup's brand row + `Sign in` pill (mobile;
  desktop's AppNav already carries both) and the **GUEST MODE** panel
  ("Sign in to unlock your Fandex Score" + Create account).
- **Media-type filter added** above the rails, driving *all* carousels at once.

### Discover
- **List and calendar views removed** — grid only. No mockup has a view
  switcher; `/calendar` is the IA's home for month/agenda.
- **Header re-ordered** to the mockup's sequence: search (own full-width row) →
  type chips + round filters button → advanced filters → **sort bar** → grid.
- **Sort bar added** (the mockup's `.sortbar`): result count eyebrow
  (`TITLES · 40`) left, sort dropdown right, sitting directly above the grid
  instead of as a pill row wedged between the chips and the search box.

## ✅ Fixed 2026-07-27 (round 4 — autonomous pass on the remaining safe items)

Worked unsupervised through the audit's "safe" items only (A + the additive
half of B.5), skipping anything that required a judgment call the way B.6/B.7
and C.8 already were flagged.

- **A.2 — Library/Wishlist title row.** Added: serif page name + a mono count
  (`{ratedCount} rated` / `{items.length} saved`) above the tab switcher, per
  both mockups.
- **A.4 — Insights heading.** `Eyebrow` "YOUR TASTE, IN NUMBERS" + plain serif
  "Insights", replacing "Library insights" + the explanatory sentence.
- **A.3 — App icons/favicon/manifest/OG image.** `scripts/gen-icons.mjs`'s SVG
  source now draws the real brand mark (the same two rotated cards `Logo.tsx`
  uses) on the dark surface ground instead of the old indigo→violet "F"
  monogram — re-run, regenerating every PNG target (`icon-192`, `icon-512`,
  `icon-maskable-512`, `apple-icon`, the favicon `icon.png` + `icon.svg`).
  Also fixed two more instances of the same stale-brand issue found while in
  here: `opengraph-image.tsx` (the social-share card) had the identical old
  gradient and a generic sans "Fandex" — restyled to the dark surface + the
  brand mark + the real tagline copy; `manifest.ts`'s `background_color`/
  `theme_color` were still the pre-token `#0a0a0a` (the same class of bug
  H1.6e's item-detail page had — `layout.tsx`'s `viewport.themeColor` was
  fixed in H1.6a but this file was missed), now `#100E0C`.
- **B.5 — desktop nav trailing slot, partial.** Added the avatar-button half:
  the "You"/"Log in" text link is now a circular icon button (accent ring
  when active), matching the mockup's avatar treatment. **Deliberately did
  NOT add the search field** — Search is already a full nav item pointing at
  `/discover`, so a second inline search box needs an actual answer for what
  it does differently (live suggestions? a different destination?) before
  it's worth building; that's a product decision, not a style fix, so it
  stays open below. Also skipped rendering a real avatar *photo*: that needs
  the user's identity data, which the nav's cheap boolean-only
  `probeSession()` doesn't carry — adding a second fetch here would mean
  every page load re-fetches identity data just to draw a nav icon.

Skipped entirely (real judgment calls, not attempted unsupervised): **A.1**
(which action ListCard's trailing slot should keep), **B.6** (item detail's
personal block — would mean removing the "mark as watched" control), **B.7**
(trimming Insights' extra sections), and **C.8** (the Library/Wishlist 4-way
status-filter merge, already flagged as needing an explicit answer).

Verified: typecheck clean, `eslint` 0 errors, 329 tests passing, browser-
checked (Library/Wishlist titles, Insights heading, all 5 regenerated icon
files + the OG image + the manifest JSON, the nav avatar in both active/
inactive states) with zero console errors throughout.

## ✅ Fixed 2026-07-27 (round 3 — Calendar's broken month-nav row)

Reported directly by Nils ("calendar looks broken"), not from the audit list.
Root cause: the month-nav row crammed 5 controls into one
`flex justify-between flex-wrap` row (prev-month arrow, "← Previous release",
the month label, "Today", "Next release →", next-month arrow) — H1.6d bolted
the two jump-to-release buttons onto the mockup's plain 2-arrow-plus-label row
without checking mobile wrap behavior. Below ~600px the middle content
couldn't fit beside both arrows, so it wrapped, and `justify-between` then
stranded the corner arrows away from the label — exactly the disjointed
layout in Nils's screenshot, not a mockup-style nitpick.

Fix: split into two rows. The primary row is now the mockup's literal anatomy
(30×30 icon buttons + serif `MMMM yyyy` label, always one line, no accent-pill
treatment for the current month). The count/Today/jump-to-release controls
— genuinely useful, added post-mockup to solve the board's own flagged
"skip empty months" gap — moved to a secondary, lighter row below that wraps
freely without dragging the primary controls out of alignment. Also switched
the weekday header row to single letters (S M T W T F S) per the mockup,
keeping the full day name for screen readers via `aria-label`.
Left the single/multi-item day-cell treatment (poster-background vs the
mockup's diagonal-stripe placeholder) alone — the mockup's stripes are a
static-file placeholder for "no real art here", and the live cells show real
posters, which reads better with real data than mimicking a placeholder.

## ✅ Fixed 2026-07-27 (round 2 — Nils's decisions on items 3, 7, 10/11)

### Item 10/11 — Profile: merged, mockup first
Nils: *"merge both. start with mockups and append the carousels."* Rebuilt the
header/stats/entries/sign-out block to the mockup literally — 64px avatar
(72px isn't one of `Avatar`'s three sizes; 64 is the closest), serif name,
`@handle · joined YYYY` (handle derived from displayName since there's no
separate username field; joined year from the earliest connected identity's
`created_at`), a settings-gear shortcut, a 3-stat row (tracked/rated/wishlist,
replacing the old 4-tile strip + best-genre card), and a 4-row entry list
(Insights / Wishlist / Your ratings → `/library` / Settings) with a full-width
"Sign out" button. **"Notifications" (mockup's 5th row) stays omitted** — D-C
already dropped the whole reminders feature, so the row has nothing to open.
The old 2-column quick-link grid (Discover/Library/Wishlist/Calendar/Insights/
Settings) is gone, replaced by the entry list — Discover/Calendar aren't
mockup entries and are already one tap away via the bottom nav.
Recently-added / Coming-up / Recommended-for-you are appended below, unchanged.

### Item 3 — Library/Wishlist: view toggles dropped
Same treatment as Discover: `availableViews={["card"]}`, dead list/calendar
branches removed from both page clients.

### Item 7 — Library⇄Wishlist tabs: reordered + restyled, Wishlist default
Nils: *"mockups win. wishlist opens by default. reorder tabs to Wishlist,
Library."* Read narrowly — the mockup's own tab row (library.html) is actually
a 4-way **status filter** (All/Rated/Wishlist/Playing) on a single page, a
bigger IA change than what was asked. Applied the parts that map cleanly onto
what exists: `LibraryWishlistTabs` restyled from a pill/segmented switcher to
the mockup's underline-tab look (13px sans, active = 2px accent inset-shadow
underline) and reordered to Wishlist-first; `AppNav`'s shared "Library" nav
slot now links to `/wishlist` (was `/library`) so the default landing matches.
The 4-way status-filter merge itself is **not** done — flagged below as its
own item, since collapsing two routes into one filtered view is a real
architecture change, not a style/order tweak.

---

## 🔲 Open — grouped by size

### A. Small, self-contained

1. **`ListCard` / `ListRow` trailing slot** (§3) — spec is ONE trailing action
   (icon button or price pill); live renders the same 3-cell `ActionCells` the
   card used to. Should follow the card down to Rate + Bookmark, or to a single
   action. *Needs a call: which?*

### B. Medium — structural, one page each

5. **Desktop nav search field** (§1) — the avatar-button half is done (round
   4). The search field itself is deliberately still missing: Search is
   already a full nav item pointing at `/discover`, so a second inline search
   box needs an answer for what it does differently before it's worth
   building. *Needs a call: live suggestions, a different destination, or
   skip it as redundant?*
6. **Item detail's personal block** — mockup is a `YOUR FANDEX SCORE` panel with
   a `Rate it` / `Save` button pair. Live has a 10-star row, a "Mark as
   watched" button and a separate "+ Add to wishlist" line — three controls
   where the mockup has two, and no score panel framing. *Needs a call:* this
   would mean removing the "mark as watched" control from the one other page
   that could still offer it after round 1 dropped it from the card.
7. **Insights section set** — mockup shows `HOW YOU RATE` and `TOP GENRES`.
   Live ships five sections (Overview, Rating distribution, Distribution by
   type, Taste by era, You vs the crowd). Live is a superset. *Needs a call:*
   trim to the mockup, or keep the extras and just restyle the headings?

### C. Needs a decision before any code

8. **Library's tab row is actually a different feature, not a style choice.**
   `library.html`'s own tab strip isn't "Library vs Wishlist" — it's **one**
   page with a 4-way status filter: All / Rated / Wishlist / Playing. That's
   collapsing the two current routes (`/library`, `/wishlist`, separate fetches,
   separate filter state) into one page filtered by membership status — a real
   architecture change, not the tab-order/style fix already done. Round 2 only
   reordered + restyled the existing two-route switcher. **Do you want the
   actual 4-way single-page merge, or is the two-route switcher (now styled and
   defaulting to Wishlist) close enough?**

---

## How to use this list

Items in **A** are unambiguous and can just be done. **B** are a page's worth of
work each and mostly need a yes/no on the flagged question. **C** genuinely
can't proceed without a decision.
