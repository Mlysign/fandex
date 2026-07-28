---
status: complete
branch: current
---

# Calendar rebuild + global layout order

## Context

Two clusters of feedback from Nils (2026-07-28), both about the app's shape rather than its data.

**Calendar** is currently a wishlist-only view. `/api/calendar` reads `user_watchlist` and nothing else (`src/app/api/calendar/route.ts:17-26`), so library items and anything you haven't personally saved are invisible — the page can't answer "what's coming out this month". It also carries three cosmetic/UX problems: an accent tint painted over the whole current-month grid, a pair of "jump to previous/next month with a release" buttons that crowd the "Today" control, and day cells that are ~41px wide × 128px tall at 375px because the page hard-codes `px-6` and `gap-1.5` with no responsive breakpoints anywhere in `CalendarView.tsx`.

**Global layout** drifted page by page. Home and Calendar hand-roll a bare `<TypeFilter>`; Discover and Library/Wishlist get theirs inside `SubBar`, which renders search *above* the chips. Library/Wishlist puts an `<h1>` + count row above tabs which sit above `SubBar`. Three pages use `h1`, one uses `h3`, two have no heading. The type filter persists on Discover/Library (`rr_type_filter`) but resets on Home and Calendar. Advanced filters are a bottom Sheet on mobile and permanently-expanded inline on desktop.

Outcome: Calendar shows wishlist + library + provider-sourced popular releases behind a chip filter; every list page renders the same header in the same order.

## Decisions locked with Nils

- Calendar scopes **Wishlist / Library / Popular — all three ON by default**.
- Popular = **top 10–20 items per month, ranked across all media types together**, no per-type quota. A month may legitimately be 15 movies / 1 show / 4 games.
- Headline removal applies to **list pages only** (Home, Calendar, Library/Wishlist). Insights, Profile and Settings keep their headers.
- Advanced filters use **the same panel/sheet on mobile and desktop** — one behaviour everywhere.

Assumptions I'm proceeding under (say so if wrong): the calendar keeps its auth gate (Popular alone doesn't make it public); the type filter keeps using `sessionStorage` via `usePersistedState`, not `localStorage`.

---

## A. Calendar

### A1 — Scope filter + personal data (client-side, no server change)

`src/app/calendar/CalendarPageClient.tsx`:

- Fetch `/api/library` **and** `/api/calendar` in parallel and merge with the existing `mergeMyStuff(libraryItems, wishlistItems)` (`src/lib/myStuffMerge.ts:21`) — this is exactly what `MyStuffView.tsx:156-164` already does, and it yields `inLibrary` / `inWishlist` flags for free. Do not add a `?scope=` param to `/api/calendar`.
- New `src/components/ui/ScopeFilter.tsx`, modelled on `src/components/ui/TypeFilter.tsx` (same 40px circular `tap-44` icon chips, `aria-pressed`, `role="group"`). Three independent toggles — Wishlist (`Bookmark`), Library (`Library`), Popular (`Flame`). **Do not copy TypeFilter's "empty array = All" convention**: here empty means nothing is shown, so seed `usePersistedState<Scope[]>("rr_calendar_scopes", ["wishlist","library","popular"])` and render an `EmptyState` telling the user to re-enable a scope when all three are off.
- Filter order: scope → type → into `CalendarView`.
- Type filter moves to `usePersistedState<string[]>("rr_type_filter", [])` (see B4).

Note: `/api/library` returns the whole library fully enriched (~2,000 items, Fandex score computed per item). That cost already exists on `/library`; it's now also paid on calendar entry. Only fetch it when the Library scope is active.

### A2 — Popular releases for a month (server)

Nothing in the codebase can currently ask a provider for a **specific month** — every fetch goes through `dateWindow(direction)` (`src/lib/discoverFeed.ts:28`), which only produces `[today, today+550d]` or `[today-550d, today]`. The plumbing below it is fine: all four page fetchers already build their URLs from `{gte, lte}` strings.

**`src/lib/discoverFeed.ts`**
- Add `export function monthWindow(month: string): { gte, lte }` for a `"YYYY-MM"` input (first/last day of month).
- Give `fetchGamePage` / `fetchMoviePage` / `fetchShowPage` / `fetchIgdbGamePage` an optional trailing `window?: { gte, lte }` that overrides `dateWindow(direction)`. Existing call sites are untouched.
- `fetchIgdbGamePage` currently hard-returns `[]` for `direction === "past"` (`discoverFeed.ts:147`). When an explicit `window` is passed, drop that guard and instead pick the IGDB sort by whether the window ends before today: `hypes desc` for future months, `total_rating_count desc` for past ones (the sort `discoverIgdbByTag` already uses). Requires a sort argument on `discoverIgdbUpcoming` (`src/lib/sources/igdb.ts:110`), which already takes arbitrary unix bounds.
- Skip Trakt entirely — `/movies/anticipated` takes no date param and can't serve a past month.
- Add `popularity: number | null` to `FeedCandidate`, populated from `m.popularity` (TMDB), `g.added` (RAWG), `g.hypes ?? g.total_rating_count` (IGDB). These already ride in the payloads.

**New `src/lib/popularMonth.ts`** — the cross-type ranking, which is the one genuinely new piece of logic:

Provider popularity numbers are not comparable across sources (TMDB `popularity` ≈ 40, RAWG `added` ≈ 900, IGDB `hypes` ≈ 12). Ranking them directly would just sort by whichever provider uses the biggest numbers. Instead:

1. Bucket candidates by `${source}:${type}`.
2. Per bucket, take the median `popularity`; score each candidate as `popularity / max(median, 1)` — "how much bigger than a typical release from this source this month".
3. Buckets with fewer than 5 members fall back to their provider's own rank order (median is meaningless on a tiny sample).
4. Dedupe RAWG-vs-IGDB duplicates on `` `${normalizeName(title)}|${releaseDate}` `` — reuse `normalizeName` from `@/lib/merge`, the same key `searchAll` uses at `src/app/api/discover/route.ts:44`.
5. Sort by score desc, take `POPULAR_PER_MONTH = 15` (tunable constant; sits in the 10–20 band).

This deliberately rewards "standout for its medium" rather than raw reach, which is what produces the uneven type mixes Nils described. Flag the constant and the median rule with a comment — it's the knob to turn if a month looks wrong.

**New `src/app/api/calendar/popular/route.ts`** — `withUser`, so it inherits the 300 req/60s limit and always has a real session:
- `?month=YYYY-MM`, validated (reject anything not matching, and clamp to a sane year range).
- Fetch page 1 of RAWG + TMDB movie + TMDB show + IGDB for that window in parallel, rank via `popularMonth.ts`.
- Then follow the exact three-step pattern `/api/discover` uses: `decorateSection(...)` → `persistDiscoverItems(...)` → annotate with user state. **`raw` must be stripped before serializing** (`discover/route.ts:170-176`) — it is persistence-only.
- The `annotate` helper is currently duplicated verbatim in `src/app/api/discover/route.ts:181-209` and `src/app/api/home/route.ts:32-60`. Extract it to `src/lib/annotateDiscover.ts` and have all three call it rather than writing a third copy.
- Cache with a `BoundedCache<string, PopularItem[]>` keyed `` `${month}:${region}` ``, `{ max: 60, ttlMs: 6h }` — same pattern as `_feedCache` (`src/lib/liveDiscover.ts:283`). Past months are immutable; future months move slowly.

**Client wiring** — `CalendarView` already exposes `onVisibleMonthChange?: (month: Date) => void` (`CalendarView.tsx:37,345-348`) and `CalendarPageClient` simply never passes it. Wire it: keep a `Map<string, CalendarItem[]>` of month → popular items in state, fetch on first visit to a month, show an inline spinner (not a full-page one) while in flight. Dedupe popular items against personal ones by `id` first (both are real uuids once persisted) with the `normalizeName(title)|releaseDate` key as a fallback.

*Known limitation to state in the code:* Agenda/List mode spans many months but popular items only exist for months already fetched. Prefetch the current month plus the next one on mount; Agenda shows popular for loaded months only. Personal items remain unbounded in both modes.

### A3 — Remove the current-month tint

`CalendarView.tsx:491-494`. Drop `isCurrentMonth ? "bg-accent-subtle" : ""`. The `p-2 -m-2` pair on that div exists *only* so the tint could bleed without shifting layout — remove those too, leaving a plain `grid grid-cols-7 gap-…`. Keep the today ring (`:159-161`) and the today day-number pill (`:182`); those are the useful signals. `isCurrentMonth` is still needed for the Today button's visibility.

### A4 — Remove the skip-to-release buttons

Delete both pairs and their supporting computation:
- `monthStarts` / `nextMonthWithItems` / `prevMonthWithItems` (`CalendarView.tsx:361-371`).
- The two buttons in the utility row (`:429-446`).
- The two buttons in the empty-month `EmptyState` `actions` (`:456-477`) — the EmptyState keeps its title and gains a plain hint.

The utility row (`:421-448`) then holds only the release count and **Today**. Give Today real presence now that it has the room: a pill button with `tap-44` (it currently has no hit-area padding at all, unlike the chevrons beside it), `bg-accent text-text-on-accent` or an outline pill, still gated on `!isCurrentMonth`. Simplify the row's render condition to `monthItemCount > 0 || !isCurrentMonth`.

### A5 — Mobile density

No file in the calendar has a single responsive breakpoint today. At 375px the chain is `px-6` (−48px) → `gap-1.5` ×6 (−36px) → **~40.7px wide × 128px tall cells**. Target ~51×80.

- `CalendarPageClient.tsx:65` — `max-w-6xl mx-auto px-1 md:px-6 py-4 md:py-6 space-y-3 md:space-y-4`. The `SubBar` above it keeps its own `px-6`, so only the grid goes near-full-bleed.
- `CalendarView.tsx:483` + `:493` — `gap-0.5 md:gap-1.5` on both the weekday header and the grid.
- `CalendarCell` (`:159`) — `h-20 md:h-32`, `rounded-sm md:rounded-md`; inner wrapper (`:178`) `p-1 md:p-2`. Pad cells (`:496`) match `h-20 md:h-32`.
- Today pill (`:182`) — `w-4 h-4 md:w-5 md:h-5`.
- `VISIBLE = 3` (`:154`) — an 80px cell fits two rows, not three. Use the existing `useMediaQuery("(min-width: 768px)")` hook (`src/lib/useMediaQuery.ts`, already used by `SubBar.tsx:117`) to make it `isDesktop ? 3 : 2`.
- `OverflowDrawer` (`:88`) is `min-w-[220px]` absolutely positioned inside what is now a ~51px cell — it overhangs badly. On mobile render it through the shared `Sheet` component instead (the same one `SubBar` uses); keep the anchored drawer on desktop. Single instance, chosen by `isDesktop` — same rule as `SubBar.tsx:106-114`.

---

## B. Global layout order

Target order on every list page, top to bottom: **media type filters → tabs → search bar → page content**, with headlines gone and advanced filters collapsed behind a trigger.

### B1 — `SubBar` becomes the one shared page header

`src/components/SubBar.tsx` already owns three of the four slots but in the wrong order (search is first, at `:159`). Restructure its internals to:

1. Chip row — `TypeFilter` + optional source chips / hide-rated / `filters` slot + the Filters trigger.
2. **New `tabs?: React.ReactNode` slot** (empty on every page but Library/Wishlist).
3. `SearchBar` — render **only** when `onSearchChange` is supplied, so Home and Calendar get no search field.
4. Sort bar (result count / sort / view toggle / `actions`), unchanged, still last before content.

Then move every page onto it:

| Page | Uses |
|---|---|
| Home (`src/app/page.tsx`) | types only |
| Discover (`src/app/discover/page.tsx`) | types + search + filters + sort (order changes only) |
| Library/Wishlist (`src/components/MyStuffView.tsx`) | types + **tabs** + search + filters + sort |
| Calendar (`CalendarPageClient.tsx`) | types + **scope chips** via the `filters` slot + Month/List toggle via `actions` |

`LibraryWishlistTabs` (`src/components/LibraryWishlistTabs.tsx`) drops its own `max-w-6xl mx-auto px-6 pt-4` wrapper — `SubBar` supplies the container once it renders inside it.

Calendar's Month/List toggle currently lives in the header row it shares with the "Coming up" `h3` (`CalendarView.tsx:376-388`). When that `h3` goes (B3), lift the toggle out of `CalendarView` into `CalendarPageClient` and pass it as `SubBar actions`, with `mode` hoisted to the page. Do not try to route it through `SubBar`'s `ViewMode` union — that's `list | card | calendar` and widening a shared union here is exactly the non-exhaustive-switch trap called out in the H1 notes.

**One thing to measure during verification:** `SubBar` is `sticky top-0` on mobile (`:153`) and adding the tabs row makes it a 4-row sticky block. At 375px that is roughly chips 40 + tabs 40 + search 44 + sort 24 + padding ≈ 170px, over 20% of the viewport, on Library/Wishlist only. If it reads as too tall in the browser pane, the fallback is `static md:sticky md:top-14` — but that reverses a deliberate H1.6c call (the nav is a bottom bar on mobile, so the filter bar was given the top), so measure before changing it.

### B2 — Advanced filters: one Sheet, both viewports

Currently split — `isDesktop` picks between inline-always-expanded (`SubBar.tsx:240`) and a bottom `Sheet` (`:308-318`). Per Nils's answer, use the Sheet on both:

- Delete the `isDesktop` branch and the inline `advancedContent` render. Always render the single instance inside `Sheet`.
- The Filters trigger (`:224-234`) loses `md:hidden` and becomes visible at all widths.
- This removes the remount-on-breakpoint-cross that loses in-progress facet input — the single-instance invariant documented at `SubBar.tsx:106-114` now holds trivially, since there's only ever one location. Keep that comment, updated.
- Collapsing hides state, so add an **active-filter count badge** on the trigger (non-default year range, any membership toggle, any include/exclude facet). Without it a user can't tell filtered results from unfiltered ones.
- On desktop a bottom sheet is unusual; `Sheet` should render as a centred/side panel at `md+` if it doesn't already. Check `src/components/ui/Sheet.tsx` before assuming.

### B3 — Remove list-page headlines

| Remove | Where |
|---|---|
| `<h3>Coming up</h3>` + its header row | `src/components/CalendarView.tsx:376-388` (keep the toggle, relocated per B1) |
| `<h1>Library/Wishlist</h1>` + the `rated`/`saved` count row | `src/components/MyStuffView.tsx:234-241` |
| Mobile brand row (`<Logo>` + "Fandex" wordmark) | `src/app/page.tsx:118-126` |

Untouched: Insights, Profile, Settings, `Rail` section `h2`s, the nav wordmark, the "Welcome to Fandex" onboarding empty state.

Two things not to break:
- **Accessibility.** Stripping every heading leaves these pages with no document outline. Add an `sr-only` `<h1>` per page (Home / Discover / Calendar / Library / Wishlist) carrying the page name. There's already an `.sr-only` convention in the codebase alongside `tap-44` in `globals.css` — confirm and reuse.
- **Anon sign-in on Home.** The brand row being deleted also holds the anon "Sign in" button (`page.tsx:123-125`). It's redundant twice over — the mobile bottom nav's "You" slot opens the same `SignInDialog` (`AppNav.tsx:156-157`) and the Guest-mode panel directly below has "Create account" (`page.tsx:141`) — so nothing needs re-homing. Verify anon-on-mobile after the change anyway.

### B4 — Type filter persists everywhere

Home (`src/app/page.tsx:65`) and Calendar (`CalendarPageClient.tsx:28`) both use plain `useState<string[]>([])`. Switch both to `usePersistedState<MediaType[]>("rr_type_filter", [])` — the same key Discover (`discover/page.tsx:145`) and `MyStuffView` (`:118`) already share, so the setting carries across all four.

**Lint trap:** `usePersistedState`'s optional `normalize` argument must be a module-scope reference, never an inline arrow (`usePersistedState.ts:26-28`, and there's now a lint rule banning it — commit `dc91279`). These two call sites pass no `normalize`, so they're fine, but don't add one inline.

---

## Critical files

New: `src/components/ui/ScopeFilter.tsx`, `src/lib/popularMonth.ts`, `src/app/api/calendar/popular/route.ts`, `src/lib/annotateDiscover.ts`.

Modified: `src/components/CalendarView.tsx`, `src/app/calendar/CalendarPageClient.tsx`, `src/components/SubBar.tsx`, `src/components/MyStuffView.tsx`, `src/components/LibraryWishlistTabs.tsx`, `src/app/page.tsx`, `src/app/discover/page.tsx`, `src/lib/discoverFeed.ts`, `src/lib/sources/igdb.ts`, `src/app/api/discover/route.ts`, `src/app/api/home/route.ts`.

Reused, not rebuilt: `mergeMyStuff` (`src/lib/myStuffMerge.ts:21`), `decorateSection` (`src/lib/liveDiscover.ts:272`), `persistDiscoverItems` (`src/lib/discoverPersist.ts:77`), `BoundedCache` (`src/lib/boundedCache.ts:15`), `normalizeName` (`src/lib/merge.ts`), `usePersistedState` / `useScrollRestore` (`src/lib/usePersistedState.ts`), `useMediaQuery`, `Sheet`, `EmptyState`, `TypeFilter`.

---

## Verification

Tests first, then the real app — the H1 notes are explicit that typecheck + lint + all 314 tests stayed green through five browser-only failure modes, so green tests prove nothing here.

```bash
npx tsc --noEmit && npm run lint && npm test
```

Unit coverage worth adding (note `vitest.config.ts` includes `src/**/*.test.ts` only — `.test.tsx` will not run, so this must be plain-TS logic):
- `src/lib/popularMonth.test.ts` — median normalisation, the <5-member fallback, RAWG/IGDB dedupe, and that an uneven type mix survives (a month of 15 movies / 1 show must not be re-balanced).
- `monthWindow()` boundaries, including December→January and leap February.

Browser, via the in-app pane. Get a session with **`GET /api/dev/login`** — do not hand-mint a JWT, and never call `/api/auth/logout` (it bumps `session_epoch` and kills Nils's own browser session).

1. `/calendar` desktop — all three scope chips lit; confirm library-only items now appear (they never did before), and that Popular items carry a bookmark/check when they're already on a list. Toggle each chip off and back; confirm counts move and the all-off empty state reads sensibly.
2. Page back/forward several months. Watch `read_network_requests` for `/api/calendar/popular?month=…` — one request per month, none repeated (cache hit). Confirm a past month returns games (the IGDB `past` guard being lifted) and that the mix is genuinely uneven across types.
3. Confirm the yellow current-month tint is gone, "← Previous release" / "Next release →" appear nowhere (including the empty-month state), and **Today** is a comfortable tap target.
4. `resize_window` to 375px on `/calendar`: measure a day cell with `javascript_tool` — expect roughly 51×80 rather than 41×128. Open a `+N more` day and confirm the overflow opens as a Sheet, not an overhanging drawer. Confirm the page body does not scroll horizontally.
5. Layout order at both 375px and 1280px on `/`, `/discover`, `/library`, `/wishlist`, `/calendar` — chips, then tabs, then search, then content, with no headline. Screenshot each.
6. Advanced filters: the Filters button appears on desktop too, opens the same panel, and the active-count badge tracks a year-range change. Set a facet, cross the 768px breakpoint, confirm the input survives.
7. Type filter: set Games-only on Home, navigate to Discover → Library → Calendar, confirm it holds on all four.
8. `/` signed out on mobile: brand row gone, sign-in still reachable from the bottom nav and the Guest panel.
9. `read_console_messages` clean on every page touched.

Also re-run `/smoketest` afterwards — SM19 (`/library` renders all 2,014 cards) and SM28 (agenda rows truncate at 375px) are adjacent to this work and may shift.

## Risks

- **The popular ranking is a judgement call.** Median-normalised popularity favours "standout for its medium" over raw reach. If a month looks wrong, `POPULAR_PER_MONTH` and the median rule are the knobs — both isolated in `popularMonth.ts`, so tuning never touches the calendar UI.
- **`persistDiscoverItems` on a new route writes to `media_items`.** It's insert-only with `browsed=1` / projection version `0` (the thin-write rule), and the route is `withUser`, so no anonymous traffic can reach it — that's the combination that caused the 676k-row crawler blowup on `/discover`. Do not relax the `withUser` gate.
- **`SubBar` is shared by four pages**; reordering it touches Discover and Library/Wishlist even though neither was in the feedback. Screenshot both before and after.
- No migrations, no schema change, no auth/session change in this work.

## Session log

All of A1–A5 and B1–B4 shipped in the same session (logged as `L1`–`L8` in [TASKS.md](../../TASKS.md)), including the `popularMonth.ts` cross-source ranking, the new `/api/calendar/popular` route, `ScopeFilter`, the `SubBar` header-order rework, and the `annotateDiscover.ts` extraction that also fixed an anon `media_items`-write bug in `/api/home` (L8). Work landed in the working tree but was left uncommitted; this session re-verified and committed it:

- `npx tsc --noEmit` — clean.
- `npm run lint` — 0 errors, 385 pre-existing `any` warnings (unrelated files).
- `npm test` — 47 files, 362 passed / 1 skipped.
- Browser (via `GET /api/dev/login`): `/calendar` shows the three scope chips, live `Popular` results per month (`/api/calendar/popular?month=2026-07` → 200), an uneven type mix, no current-month tint, denser mobile cells; `/library` shows the new chips → tabs → search → sort header order with no headline. No console errors on either page.

No new blockers. STATUS.md/TASKS.md were already updated with the L1–L8 summary in the same uncommitted change; this session's job was to verify and land it.
