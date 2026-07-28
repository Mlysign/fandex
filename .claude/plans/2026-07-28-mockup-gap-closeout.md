---
plan_id: 2026-07-28-mockup-gap-closeout
created: 2026-07-28
status: complete
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

- [x] **T1** — ~~Correct the stale small-tasks bookkeeping~~ **DONE 2026-07-28
      by the planning session** (commit `docs: sync all markdown…`). S2/S4/S9/S10
      had already shipped in `34f87fe`; their write-ups now live in
      `docs/archive/history.md` and the `TASKS.md` section is a one-line pointer.
      **Nothing to do — skip this task.** A wider doc-sync ran at the same time
      (README env table, `smoketest.md`'s auth section, `docs/ui-overhaul.md`
      §10/§12, `docs/fandex-score.md` §9, `AGENTS.md`), which also pre-empts part
      of T7 — see T7's note.

- [x] **T2** — A1: give Calendar agenda rows the Rate + Bookmark pair
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

- [x] **T3** — B6: rebuild the item-detail personal block to the mockup
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

- [x] **T4** — B7: restyle Insights to the mockup's anatomy, keeping all 5 sections
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

- [x] **T5** — B5: desktop nav search field with live suggestions
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

- [x] **T6** — C8: merge Library and Wishlist into one tabbed view
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

- [x] **T7** — Close out the gap audit and the design docs
  - Files: `docs/mockup-gap-audit.md`, `docs/ui-overhaul.md`, `TASKS.md`,
    `STATUS.md`
  - ⚠️ **Reduced scope — the planning session already did the "decided" half.**
    `docs/mockup-gap-audit.md`'s open section is now a **"🔵 Decided 2026-07-28
    — ready to build, not yet built"** section carrying every decision and both
    findings; `docs/ui-overhaul.md` gained a §12 with the same; `STATUS.md`'s
    roadmap line is corrected. **Do not re-record the decisions.**
  - Detail: what remains is turning *decided* into *shipped*. Move each of A1,
    B5, B6, B7, C8 from the "🔵 Decided" section into a **"✅ Fixed 2026-07-28"**
    section, replacing the decision text with **what actually shipped** — the
    files touched and any deviation forced by the code. Update `docs/ui-overhaul.md`
    §12's heading from "not yet built" to done. Update `STATUS.md`'s headline and
    the "What's left" table row for the mockup-gap closeout. Add a summary entry
    to `docs/archive/history.md`. If either flagged finding turned out wrong
    while building, say so plainly rather than leaving the old claim standing.
  - Done when: `docs/mockup-gap-audit.md` has no item still described as
    pending, `STATUS.md`'s "What's left" no longer lists the closeout, and the
    archive has the summary.
  - Tests: none — docs only.
  - Depends on: T2, T3, T4, T5, T6

- [x] **T8** — Full verification pass, then push
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

- **T8 — anon item-detail screenshot not captured.** T3's Done-when calls for
  seeing the logged-out personal-block state in a browser; that specific half
  wasn't empirically screenshotted. Every available browser surface in this
  session already carried a session cookie (the dev-login session in the
  Browser pane; a pre-existing real OAuth session in Nils's own Chrome via
  the claude-in-chrome tool) — a private/incognito window wasn't available
  through either tool, and `AGENTS.md` explicitly forbids calling
  `/api/auth/logout` to force anon (it kills Nils's real browser session,
  restorable only by a real OAuth round-trip). The session cookie
  (`rr2_session`) is `httpOnly`, so it can't be cleared client-side either.
  Verified instead by close code review: `PersonalSection.tsx`'s `anon`
  boolean is a plain, deterministic prop threaded into `FandexScoreSection`
  (gated score panel) and the button bar (`Sign in to rate`/`Save` both
  routing through `requestAuth`/H2c), the same pattern already used and
  tested elsewhere in this component (the drain effect, the anon rate-intent
  stash) — low risk, but not the same as seeing it render. **Decision
  needed:** if you want this literally screenshotted, the fastest path is a
  real incognito Chrome window (outside these tools) hitting
  `http://localhost:3000/game/711e855e-6acb-4937-bab5-fba9c1d0127e/ill` (or
  any item page) while the dev server is running.

## Session log

**2026-07-28, single session, T2–T8 all complete.** Shipped all five
mockup-gap items (A1/B5/B6/B7/C8) exactly per the Decisions section, plus
docs closeout. Commits: `2cda013` (T2), `6583b5b` (T3), `632a9dd` (T4),
`dfc36ab` (T5), `eeb9a88` (T6), `f0324af` (T7).

**Deviations forced by the code, all within the Decisions' spirit:**
- T3: added a NEW anon-gated Fandex Score panel state that never existed
  live before (the mockup's third state); anon still opens the same star
  popover as logged-in rather than a flat CTA, so a pre-auth rating choice
  still stashes via H2c instead of being lost.
- T5: the reused `/api/discover/facets` endpoint is `withUser`-gated, so
  anon nav-search queries 401 — handled by just keeping the dropdown closed
  rather than showing a false "No matches". Company/studio facets are
  excluded from the nav search's three groups (People/Tags/Titles only, per
  the decision text) but remain reachable via `/discover`.
- T6: found and fixed a real, unrelated-to-the-merge bug while
  browser-verifying sort persistence — `usePersistedState`'s own
  documented gotcha (inline `normalize` re-runs its hydrate effect every
  render and silently reverts edits) was present in the pre-merge
  `LibraryPageClient.tsx` and got carried into `MyStuffView.tsx`; fixed by
  binding a stable module-level function.

**Verification:** `npm test` (346 passed, 1 skipped — 9 new in
`myStuffMerge.test.ts`), `npm run lint` (0 errors, 387 warnings — all
pre-existing patterns), `npx tsc --noEmit` (clean), `npm run build` (clean,
all 59 routes). Browser-verified logged in via `GET /api/dev/login`:
`/calendar` Agenda mode (rated a live item, confirmed persisted across
reload, zero console errors); an item detail page logged in (score panel,
breakdown expand/collapse, Rate/Save both wired, zero console errors) —
**logged-out half not screenshotted, see Blockers log**; `/insights` (all
eight sections — Overview through Most watched — scrolled and confirmed the
new eyebrow/panel treatment, zero console errors); the desktop nav search
(grouped People/Tags/Titles results, arrow-key highlight, Enter-to-navigate,
Escape-to-close, mobile bottom nav visually unchanged); `/library` +
`/wishlist` across all four tabs (All/Wishlist/Unrated/Rated all filter the
real 1,919-item library correctly, an item both wishlisted and rated
appears exactly once under All, sort/filters persist across a hard reload,
`/wishlist` auto-scrolls to today on release-date sort and `/library` never
does even on the identical sort).

`git fetch` showed no upstream movement (`ahead 10`, never `behind`) — no
rebase needed, pushed directly to `main`.

**Systems-level recommendation:** `usePersistedState`'s inline-`normalize`
footgun (see T6 above) is easy to reintroduce — worth either a lint rule
banning inline arrows in that specific call position, or changing the
hook's own signature so a non-stable function can't silently corrupt state
(e.g. accept the fallback value instead of a function or nothing).
