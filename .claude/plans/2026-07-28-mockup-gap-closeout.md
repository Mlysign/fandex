---
plan_id: 2026-07-28-mockup-gap-closeout
created: 2026-07-28
status: ready
branch: current
---

# Close out the mockup-vs-live gap audit (A1, B5, B6, B7, C8)

## Objective

`docs/mockup-gap-audit.md` left 8 items open because each needed a decision only
Nils could make. Those decisions are now made (see **Decisions** below), so this
session implements all of them and closes the audit. It also corrects stale
bookkeeping in `TASKS.md`/`STATUS.md`, which still list four small tasks as open
that commit `34f87fe` actually shipped.

Every user-facing surface here is behind a login. A dev-only login shortcut
(`GET /api/dev/login`, committed in `c1c57a8`) exists specifically so this
session can verify its own work in a browser — **use it**, and do not ship a
task claiming it was verified if it wasn't.

## Decisions

Every one of these was settled with Nils on 2026-07-28. They are non-negotiable
— do not re-open them, and do not substitute your own judgment if the code
turns out to be inconvenient. If a decision proves genuinely impossible to
implement, mark the task BLOCKED with the reason and move to the next task.

- **Which mockup-gap items are in scope?** → A1, B5, B6, B7 and C8. All of them.
  Item numbering follows `docs/mockup-gap-audit.md`'s "Open" section.

- **A1 — ListCard's trailing slot** → **Do NOT touch `ListCard`.** It is
  unreachable dead code: all four `GroupedView` callers hardcode `view="card"`
  (`discover/page.tsx:575`, `LibraryPageClient.tsx:113`, `WishlistPageClient.tsx:204`,
  `PublicFacetView.tsx:341`), so the list branch never renders. Apply the
  Rate + Bookmark treatment to the **Calendar agenda rows** instead
  (`AgendaRow`, `src/components/CalendarView.tsx:244`) — that is the only
  list-shaped surface a user can actually reach. Rationale: matching the card's
  two-action bar in a place nobody can see is busywork; the agenda row is the
  real instance of the pattern.

- **A1 mechanism** → **Repurpose `ActionCells`' existing `layout="row"`** into
  the compact two-button (Rate + Bookmark) shape and use it from `AgendaRow`.
  `layout="row"` is currently dead (its only caller is the dead `ListCard`), so
  this revives it as the single correct row shape rather than adding a third
  layout. Rationale: one row shape, not two, and `ListCard` inherits the right
  thing if list view ever returns.

- **B5 — desktop nav search field** → **Build it, with live suggestions.** An
  inline typeahead in the desktop nav backed by the existing
  `/api/discover/facets` vocab, grouped People / Tags / Titles, navigating
  straight to the item or facet page. Rationale: a field that merely re-routes
  to `/discover` duplicates the nav item that is already there; suggestions are
  the thing that makes a second search entry point earn its space.

- **B6 — item detail's personal block** → **Full mockup: two controls, and
  "Mark as watched" goes away.** A `YOUR FANDEX SCORE` panel plus a
  `Rate it` / `Save` pair. Accepted consequence, verified in code before
  deciding: `/api/library` (route.ts:154-155) already infers
  `watched`/`played` from a rating, so rating an item still sets its status —
  the only capability actually lost is "watched but deliberately unrated"
  without provider sync. Rationale: the mockup's shape wins, and the real cost
  is much narrower than the control count suggests.

- **B7 — Insights sections** → **Keep all five, restyle to the mockup's
  anatomy.** Do not delete Distribution by type, Taste by era, or You vs the
  crowd. Apply the mockup's panel + accent-eyebrow heading treatment uniformly.
  Rationale: live is a superset of the mockup and the extra sections are real
  earned analysis the mockup simply never considered.

- **C8 — Library/Wishlist merge** → **Merge the view, keep both routes.**
  `/library` and `/wishlist` both render one shared component; the route decides
  only which tab is initially active. No redirect, no dead links, trivially
  revertible. Rationale: the mockup's single-page shape without betting the
  URL structure on it before Nils has seen it.

- **C8 — the tab set** → **Four tabs: All · Wishlist · Unrated · Rated.** The
  mockup's 4th tab is "Playing", but this app stores no in-progress status
  (values are `watched` / `played` / `owned` / `beaten` / `toplay`, all terminal
  or ownership flags). "Unrated" is backed by real data; "Playing" would be
  permanently empty. Rationale: never ship a tab the data cannot fill.

- **C8 — tab state model** → Tab is **local React state initialised from the
  route**, and is **not persisted**. Clicking a tab updates local state only and
  does **not** navigate. `/library` opens on **All**; `/wishlist` opens on
  **Wishlist**. Rationale: deterministic — the same URL always opens the same
  tab, and Back restores the route's tab rather than a stale stored one.

- **C8 — filter/sort state keys** → collapse `rr_library_*` and `rr_wishlist_*`
  into one shared `rr_mystuff_*` set (search, incFacets, excFacets, sort, year,
  membership, scroll). Keep `rr_type_filter` as-is — it is deliberately global
  across Discover/Library/Wishlist (SM2). Default sort `addedAt`.

- **C8 — preserve two existing behaviours** exactly: (a) `autoScrollToToday`
  fires **only** when the active tab is Wishlist *and* sort is `releaseDate`
  (Q3 — Library must never auto-scroll to today); (b) the wishlist page's
  stale-sync-on-mount (`SYNC_STALE_MS`, `WishlistPageClient.tsx:133-136`)
  carries over to the merged component unchanged.

- **Git** → commit per task on `main`, push once at the end. `git fetch` before
  starting — other Claude sessions push to this repo.

- **Verification** → full CI gate plus a real logged-in browser pass using
  `GET /api/dev/login`. See **Verification commands** and T8.

## Out of scope

- `ListCard.tsx`, `GroupedView`'s list branch, and the vestigial `"list"` entry
  in `useViewMode`/`ViewMode`. They are dead but deleting them is a separate
  call Nils has not made. Note the finding in the audit doc (T7); change no code.
- The remaining `docs/mockup-gap-audit.md` items already marked fixed. Do not
  re-litigate round 1–4 decisions.
- PR17 (blocked on Railway resuming ~2026-08-01), P15/P16 (need Nils to build
  the TWA), P18 (needs a JustWatch partner token), and all of H3/H4.
- Deploying anything. Railway is paused; this work stays local until it resumes.

## Do not touch

- `src/lib/migrations.ts` and the `CREATE TABLE`/`CREATE INDEX` block in
  `src/lib/db.ts` — no schema change is needed for any task here.
- `src/lib/matcher.ts` write paths, and anything under `src/lib/sync/`
  (the prune invariant).
- `src/lib/session.ts`, `src/lib/withUser.ts`, `src/app/api/auth/**`, and
  `src/app/api/dev/login/**`. Auth/session code is main-loop-only per AGENTS.md;
  the dev login route is finished and must not be modified or re-gated.
- `.env` / `.env.example` — both are gitignored here; `DEV_LOGIN_USER_ID` is
  already set locally.
- `docs/archive/history.md` except to append (never rewrite existing entries).

## Verification commands

- tests: `npm test`
- lint: `npm run lint`
- typecheck: `npx tsc --noEmit`
- build: `npm run build`

`npm run lint` reports ~389 pre-existing **warnings** and **0 errors**. Zero
errors is the bar — do not try to clear the warnings.

⚠️ **Never run `npm run build` while the dev server is running** — it corrupts
`.next` and produces confusing failures. Stop the preview first.

Logged-in browser access: start the dev server, navigate to
`http://localhost:3000/api/dev/login` (it redirects to `/` with a session for
the real 1,919-item account), then visit the surface under test.

## Tasks

- [ ] **T1** — Correct the stale small-tasks bookkeeping
  - Files: `TASKS.md`, `STATUS.md`
  - Detail: `TASKS.md:29-34` lists S2/S4/S9/S10 as open and `STATUS.md`'s
    "Remaining work" repeats it, but commit `34f87fe` ("fix(S1-S11)") shipped
    all four — verified in code: `discover/page.tsx:155` already defaults to
    `"popularity"`, Settings has no `logout()`, `pickBestGenre`
    (`libraryAnalysis.ts:229`) has the `category === "genre"` clause with six
    tests, and S10's dedupe is in `discovery.ts`. Mark all four done with a
    pointer to `34f87fe`, and move the whole "Small-tasks batch" section to
    `docs/archive/history.md` since nothing in it remains open. Leave a
    one-line pointer behind, per the archive convention in `TASKS.md:7`.
  - Done when: `TASKS.md` and `STATUS.md` contain no claim that S2, S4, S9 or
    S10 is open, and the batch's detail lives in the archive.
  - Tests: none — docs only.
  - Depends on: none

- [ ] **T2** — A1: give Calendar agenda rows the Rate + Bookmark pair
  - Files: `src/components/ActionCells.tsx`, `src/components/CalendarView.tsx`
  - Detail: rewrite `ActionCells`' `layout === "row"` branch (currently
    `ActionCells.tsx:163-168`, three 36px cells) into the compact two-button
    shape: a Rate button (Star glyph + the rating value when rated, no "Rate"
    text label, fixed width — not `flex-1` like the card's) and a fixed
    Bookmark button, both reusing the card branch's token styling and its
    rated/wishlisted accent-subtle states. Keep the `StarPicker` popover. Drop
    the watched/played cell (`watchedCell`), consistent with the card. Then in
    `AgendaRow` (`CalendarView.tsx:244-297`) replace the lone `BellPlus`
    wishlist button with `<ActionCells item={item} layout="row" />`, removing
    the now-unused `useQuickActions` call and `BellPlus` import if nothing else
    in the file uses them. Update the block comment at `ActionCells.tsx:11-19`
    — it currently says the row layout keeps all three cells and defers the
    question; record the 2026-07-28 decision instead.
  - Done when: `/calendar` in Agenda mode shows a Rate + Bookmark pair on each
    row, rating from a row persists across reload, and no `BellPlus` remains in
    `CalendarView.tsx`.
  - Tests: none new — `useQuickActions` is already covered; verify in browser
    per T8.
  - Depends on: none

- [ ] **T3** — B6: rebuild the item-detail personal block to the mockup
  - Files: `src/components/item/PersonalSection.tsx`,
    `src/components/item/FandexScoreSection.tsx`,
    `src/components/item/RatingsSection.tsx`
  - Detail: the mockup (`docs/design/fandex-handoff/04-pages/item-detail.html:147-148`)
    is a score panel — big serif number, `YOUR FANDEX SCORE` accent eyebrow, a
    one-line reason — followed by a two-button row: a primary `Rate it`
    (flex:1) and a secondary `Save`. Restyle `FandexScoreSection` into that
    panel, and replace the current three controls (10-star row, "Mark as
    watched", "+ Add to wishlist") with the two-button pair. `Rate it` opens the
    existing star picker; `Save` is the wishlist toggle. Remove
    `handleMarkWatched` and `onMarkWatched` and their plumbing. Keep all three
    of the mockup's states: scored (`:147`), signed-out — "Sign in to see your
    taste-match Score." with a `Sign in to rate` button (`:161-162`), and
    unscorable — "Not enough ratings yet to score this." (`:176`). The anon
    path must keep working exactly as now: `requestAuth`/`stashIntent` and the
    one-shot drain effect are H2c login-with-intent and must survive; the
    `kind: "watched"` intent branch can go with the control it served.
  - Done when: a logged-in item page shows the score panel plus exactly two
    controls; rating still writes and still implies watched/played status
    (check `/api/library` returns a `libraryStatus` after rating); the
    logged-out page shows the gated panel and its sign-in button.
  - Tests: none new — behaviour is covered by existing `/api/library` tests;
    verify in browser per T8.
  - Depends on: none

- [ ] **T4** — B7: restyle Insights to the mockup's anatomy, keeping all 5 sections
  - Files: `src/components/insights/InsightsView.tsx`,
    `src/components/insights/FacetSection.tsx`,
    `src/components/insights/Histogram.tsx`,
    `src/components/insights/OverviewCards.tsx`,
    `src/components/insights/StatBar.tsx`
  - Detail: the mockup (`04-pages/insights.html:148-149`) frames each section as
    a `.panel` with an accent-colored mono eyebrow heading (9px, `.13em`
    tracking, uppercase) and a right-aligned mono summary stat on the same
    baseline — e.g. `HOW YOU RATE` + `avg 8.1 · 96 rated`. Its bar rows are a
    label + `count · avg` pair above a 6px accent progress bar. Apply that
    treatment uniformly to all five live sections; do not delete any. Use the
    existing design tokens — do not introduce new literal hex values or new
    spacing values.
  - Done when: all five sections render inside the panel/eyebrow treatment,
    `/insights` has no section using the old heading style, and no new hardcoded
    colors were added.
  - Tests: none new — presentational; verify in browser per T8.
  - Depends on: none

- [ ] **T5** — B5: desktop nav search field with live suggestions
  - Files: `src/components/AppNav.tsx`, plus one new component
    (suggested `src/components/NavSearch.tsx`)
  - Detail: add the collapsing search field to the desktop nav's trailing slot
    (`AppNav.tsx:117-120` holds the comment explaining why it was skipped —
    replace it with the decision). Debounced query against the existing
    `GET /api/discover/facets?q=` (and `&kind=title` for titles) — do not build
    a new API route. Render results grouped People / Tags / Titles, each row
    navigating to the facet or item page it already has a URL for (see
    `FacetLink`/`buildItemHref` for href construction). Requirements: full
    keyboard support (↑/↓ to move, Enter to open, Escape to close and blur),
    `role="combobox"` + `aria-expanded` + `aria-activedescendant` on the input
    with `role="listbox"`/`role="option"` results, dismiss on outside
    pointerdown (copy the pattern at `ActionCells.tsx:62-69`), and desktop-only
    rendering — the mobile bottom nav must be untouched. Empty query shows
    nothing; a query with no matches shows a single "No matches" row.
  - Done when: typing 3+ characters in the desktop nav shows grouped
    suggestions, arrow keys move the highlight, Enter navigates, Escape closes,
    and the mobile nav is visually unchanged.
  - Tests: none new — the vocab search behind it is already covered by
    `discoverySearch.test.ts`; verify keyboard + a11y in browser per T8.
  - Depends on: none

- [ ] **T6** — C8: merge Library and Wishlist into one tabbed view
  - Files: new `src/components/MyStuffView.tsx` (or similar),
    `src/app/library/LibraryPageClient.tsx`,
    `src/app/wishlist/WishlistPageClient.tsx`,
    `src/components/LibraryWishlistTabs.tsx`
  - Detail: extract one shared component that both page clients render, taking
    an `initialTab` prop — `/library` passes `"all"`, `/wishlist` passes
    `"wishlist"`. It fetches **both** `/api/library` and `/api/calendar` in
    parallel and merges them into one list keyed by item `id`, tagging each
    item `inLibrary` / `inWishlist` and carrying its `rating`. An item present
    in both must appear **once**. Replace `LibraryWishlistTabs` with a four-tab
    strip — All · Wishlist · Unrated · Rated — reusing its existing underline
    styling (`shadow-[inset_0_-2px_0_var(--color-accent)]`, `text-neutral-400`
    inactive, `role="tablist"`/`role="tab"`/`aria-selected`). Tab filters:
    All = everything; Wishlist = `inWishlist`; Unrated = `inLibrary && rating == null`;
    Rated = `inLibrary && rating != null`. Tab is local state seeded from
    `initialTab`, **not** persisted, and switching tabs must not navigate.
    Collapse the two pages' persisted keys into one `rr_mystuff_*` set (keep
    the global `rr_type_filter`), default sort `addedAt`. Carry over both
    behaviours named in Decisions: `autoScrollToToday` only on the Wishlist tab
    with `releaseDate` sort, and the stale-sync-on-mount from
    `WishlistPageClient.tsx:133-136`. Keep each page's own `<h1>` and count in
    the title row, and keep the existing empty states (route them by active
    tab). Both routes keep their existing auth redirect (`router.replace("/")`).
  - Done when: `/library` opens on All and `/wishlist` on Wishlist; all four
    tabs filter correctly against the real 1,919-item library; an item that is
    both wishlisted and in the library appears once under All; filters and sort
    persist across a reload; `/wishlist` still auto-scrolls to today on
    release-date sort and `/library` never does.
  - Tests: add unit tests for the pure merge + tab-filter logic (extract it as
    an exported pure function so it is testable without a DOM) — cover the
    dedupe of an item in both sets, and each of the four tab predicates.
  - Depends on: none (but do it last of the code tasks — it is the largest)

- [ ] **T7** — Close out the gap audit and the design docs
  - Files: `docs/mockup-gap-audit.md`, `docs/ui-overhaul.md`, `TASKS.md`,
    `STATUS.md`
  - Detail: move items A1, B5, B6, B7 and C8 from `docs/mockup-gap-audit.md`'s
    "🔲 Open" section into a "✅ Fixed 2026-07-28" section recording the
    decision and what shipped for each. Record two findings explicitly: (a)
    `ListCard`/`GroupedView`'s list branch are unreachable dead code (all four
    callers hardcode `view="card"`) and were deliberately left untouched — flag
    as a candidate future cleanup; (b) B6 removed the manual watched/played
    control app-wide, with the `/api/library:154-155` rating-implies-status
    mitigation noted. Update `docs/ui-overhaul.md` §11 if it references any of
    these as open, and update `STATUS.md`'s H1 roadmap line so it no longer
    says 8 items remain open.
  - Done when: `docs/mockup-gap-audit.md` has an empty "Open" section (or says
    so explicitly) and no root doc still describes A1/B5/B6/B7/C8 as open.
  - Tests: none — docs only.
  - Depends on: T1, T2, T3, T4, T5, T6

- [ ] **T8** — Full verification pass, then push
  - Files: none (may fix defects found, in the files owned by T2–T6)
  - Detail: stop the dev server, run all four verification commands, and fix
    anything that fails. Then restart the dev server, log in via
    `http://localhost:3000/api/dev/login`, and walk every surface this session
    touched: `/calendar` in Agenda mode (T2), an item detail page logged in
    **and** logged out (T3 — use a private window or clear the cookie for the
    logged-out half), `/insights` (T4), the desktop nav search incl. keyboard
    nav (T5), and `/library` + `/wishlist` across all four tabs (T6). Check
    `read_console_messages` for errors on each. Capture a screenshot of each
    surface. Then `git fetch`, rebase or merge if `origin/main` moved, and push.
  - Done when: `npm test`, `npm run lint` (0 errors), `npx tsc --noEmit` and
    `npm run build` all pass; every surface above has been seen in a browser
    with no console errors; and `main` is pushed.
  - Tests: the full suite.
  - Depends on: T7

## Blockers log

(Left empty by the planner. The work skill appends here.)

## Session log

(Left empty by the planner. The work skill appends here.)
