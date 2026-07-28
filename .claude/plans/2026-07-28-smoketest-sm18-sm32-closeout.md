---
plan_id: 2026-07-28-smoketest-sm18-sm32-closeout
created: 2026-07-28
status: in_progress
branch: current
---

# Close out the 6th smoke sweep — SM18–SM32

## Objective

The 6th smoke sweep (2026-07-28, `8619c05`) logged 15 findings against the surfaces shipped that day. All 15 are still open. This session closes every one of them: four 🟠 correctness/perf bugs, seven 🟡 copy/a11y/UI problems, and four 🔵 polish items — plus one (SM25) that Nils has decided to close as won't-fix rather than build.

Nothing here touches `migrations.ts`, sync/pull adapters, or auth/session code, so the whole session is safe for an unattended Sonnet run under AGENTS.md's routing rules. There is no schema change and no new runtime dependency.

The sweep ran on `dc91279`. The calendar/layout batch (`476d66a`) landed **after** it and already moved two findings' ground truth — SM25 and SM28 both concern calendar mobile density, which changed from 40.7×128 to 50.8×80 px cells. SM28 must therefore be **re-measured before it is fixed**, not fixed from the sweep's numbers.

## Decisions

Every one of these is settled. Do not re-open them.

- **How much of SM18–SM32 is in scope?** → **All 15 findings.** Each gets its own task; SM25 is closed by documentation rather than code (see below).
- **SM19 — how to fix `/library` rendering 2,014 cards at once?** → **Incremental rendering plus a debounced search input. No new dependency.** Cap the rendered count and grow it with an IntersectionObserver sentinel. Rejected: `@tanstack/react-virtual` (the repo runs on 9 runtime deps and `GroupedView`'s variable-height month sections, sticky scrubber and scroll-restore would all need rebuilding around it) and server-side pagination (client-side search/sort/facet filtering all assume the full set is in memory). Accepted cost: the month scrubber lists only loaded months until the user scrolls further.
- **SM21 — should the Library/Wishlist tab live in the URL?** → **Yes, `?tab=…` via `router.push`.** This deliberately **reverses C8's "switching tabs is never navigation"** call. Rationale: `/wishlist` is a real route that already gets URL, title, heading and count right, so the two paths to the same content behave inconsistently today, and Back exiting the page is the concrete harm.
- **SM23 — which score belongs in the card badge?** → **The Fandex Score wherever one exists**, on every surface, with the provider/community rating as fallback only. Note `PosterCard` **already implements exactly this** (`PosterCard.tsx:49`, `:105-107`) — so this is not a card bug. The facet page is failing to *supply* `fandexScore` for those items; fix it at the source.
- **SM25 — should Month view stop being the mobile default?** → **No. Keep Month everywhere.** The L4 density work already improved the cells; the remaining title clipping is accepted so the calendar has one consistent entry point at all widths. Close it in `TASKS.md` with this rationale; write no code.
- **SM30 — how far to restyle `/settings`?** → **Full restyle to the B7 panel/eyebrow anatomy** that `/insights` got. It is the last page on the old design generation and the components already exist.
- **SM31 — which of the two duplicate ratings goes?** → **Drop the star from the meta line**, keep the gold button as the single rating display. The line below keeps `✓ Watched · Apr 6, 2015` — the date is the only thing it uniquely adds.
- **SM20 — what should Discover's "TITLES · N" count?** → **Nothing — drop the count entirely while a search is active.** Keep it when browsing, where it is unambiguous. This avoids inventing a number that spans the local catalog and the external databases and still would not equal the visible card count.
- **SM18 — fix the API or the consumer?** → **The consumer (`/profile`).** `/api/calendar` legitimately serves three callers and two of them (`/calendar`'s Month grid, `MyStuffView`'s Wishlist tab) *want* the full unfiltered set including past releases. Filtering server-side would silently break both.
- **SM22 — fix the facet delta number or the sentence?** → **The sentence.** The like-for-like math (your average vs. the crowd's, across only the titles you rated) is the statistically correct comparison — comparing your 9 against the crowd's 22 different titles would be worse. The panel is wrong because it never says that's the basis. State it.
- **SM27(a) — is "½-point buckets" a copy bug?** → **Neither; it's a chart bug.** `insights.ts:52` genuinely builds 0.5-step buckets, but every rating in the DB is an integer (10-star picker), so 9 of 19 buckets are always empty and invisible while still consuming width. Make the step adaptive and let the copy follow the actual step.

## Out of scope

- PR17 (blocked until Railway's billing cycle resets ~2026-08-01 — the site 404s at the edge, nothing is reachable).
- P15 / P16 (blocked on Nils building and signing the TWA).
- P18, H3.x, H4.x — all need Nils's decisions, signups or legal advice.
- Re-running `/smoketest` for a 7th sweep. This session fixes the 6th sweep's findings; the next sweep is a separate session.
- Any change to the Library/Wishlist sticky-header height (207px at 375px) — that is a knowingly accepted trade-off recorded in `TASKS.md`, not a bug.

## Do not touch

- `src/lib/migrations.ts`, `src/lib/db.ts`, and `scripts/migrate.mjs` — no schema work in this session.
- `src/lib/sync/**`, `src/lib/matcher.ts` write paths, and any provider pull adapter (the prune invariant).
- `src/lib/session.ts`, `src/lib/withUser.ts`, `src/app/api/auth/**`, `src/app/api/dev/login/**` — auth/session code is main-loop-only per AGENTS.md.
- `src/lib/popularMonth.ts` and `src/app/api/calendar/popular/route.ts` — shipped and verified hours ago in `476d66a`.
- `package.json` dependencies — this session adds no runtime dependency (see the SM19 decision).
- Never call `/api/auth/logout` during verification. It bumps `session_epoch` and kills Nils's own browser session, which only a real OAuth round-trip restores.

## Verification commands

- tests: `npm test`
- lint: `npm run lint`
- typecheck: `npx tsc --noEmit`

Baselines to hold, measured on `476d66a` at plan time: **362 tests passing / 1 skipped across 47 files**, typecheck silent, lint **0 errors and 385 warnings**. The warnings are pre-existing `no-explicit-any` in files this session does not touch. Errors must stay at zero — `react-hooks/*` are errors in this repo.

Note `vitest.config.ts` includes **`src/**/*.test.ts` only**. A `.test.tsx` file will never run — do not write one and assume it passed. Tests below are specified only where the logic can be extracted as plain TS.

## Tasks

- [x] **T1** — Filter `/profile`'s "Coming up" to actually-upcoming releases (SM18 🟠)
  - Files: `src/app/profile/ProfilePageClient.tsx`, `src/lib/upcoming.ts` (new), `src/lib/upcoming.test.ts` (new)
  - Detail: `/api/calendar` returns all wishlist items sorted ascending with no future filter (`src/app/api/calendar/route.ts:94-99`), so `/profile` — which just slices the first 5 — shows Seven Samurai (1954), Dr. Strangelove (1964), The Godfather (1972). Do **not** change the API (see Decisions). Extract a pure `upcomingFrom(items, now)` helper into `src/lib/upcoming.ts` that keeps items whose `releaseDate` is today or later, drops undated ones, and preserves ascending order; call it in `ProfilePageClient.tsx` before the `.slice(0, 5)`. `/calendar`'s agenda view already does this filtering inline (`CalendarView.tsx:287`) — reuse the new helper there too so there is one definition of "upcoming".
  - Done when: `/profile`'s "Coming up" lists only releases dated today or later, and `npm test` covers the helper.
  - Tests: `src/lib/upcoming.test.ts` — today's date included, yesterday excluded, `null` release date excluded, ascending order preserved.
  - Depends on: none

- [x] **T2** — Fix the two wrong page titles (SM26 🟡)
  - Files: `src/app/settings/page.tsx`, `src/app/discover/page.tsx` → split into `src/app/discover/page.tsx` + `src/app/discover/DiscoverPageClient.tsx`
  - Detail: `/settings` exports `metadata = { title: "Profile" }` (`settings/page.tsx:9`) while its `<h1>` reads "Settings" — change the string to `"Settings"`. `/discover/page.tsx` is a `"use client"` file, so it cannot export `metadata` at all and falls back to the root title. Split it exactly as `src/app/library/page.tsx` and `src/app/calendar/page.tsx` already do: move the entire current file to `DiscoverPageClient.tsx` (keeping `"use client"`), and leave a server `page.tsx` that exports `metadata = { title: "Discover" }` and renders `<DiscoverPageClient />`. Carry over the S1/SM10 rationale comment those two files share.
  - Done when: a hard load (not client-side nav) of `/settings` shows `Settings · Fandex` and of `/discover` shows `Discover · Fandex` in the SSR `<title>`.
  - Tests: none — verified in browser
  - Depends on: none

- [x] **T3** — Drop Discover's result count while searching (SM20 🟠)
  - Files: `src/app/discover/DiscoverPageClient.tsx`
  - Detail: `resultCount={searchActive ? (searchTotal || combined.length) : browseSorted.length}` reads `searchTotal`, which comes from `/api/discover/find` — the **local catalog** count only — while the grid renders `combined` (local + external database results). Hence "TITLES · 1" over 17 cards. Per the decision, pass `null` for `resultCount` when `searchActive` is true and keep `browseSorted.length` when browsing. Confirm `SubBar` already renders nothing for a `null` count (`MyStuffView.tsx:250` passes `null` while loading, so it should). Leave the "Load more (N left)" line alone — it is correctly scoped to the local set.
  - Done when: searching `inception` on `/discover` shows no "TITLES · N" eyebrow, and browsing with no query still shows one that matches the grid.
  - Tests: none — verified in browser
  - Depends on: T2 (renames the file)

- [x] **T4** — Make the ratings histogram's bucket step match the data (SM27 🟡)
  - Files: `src/lib/insights.ts`, `src/components/insights/InsightsView.tsx`, `src/lib/insights.test.ts` (extend if it exists, else create)
  - Detail: two separate problems. (a) `histogram(values, step = 0.5, lo = 1, hi = 10)` (`insights.ts:52`) always builds 19 buckets, but every stored rating is an integer, so 9 buckets are permanently empty — they render as zero-height bars that still consume width, which is why the sweep counted "10 integer bars" under a caption promising ½-point ones. Make the step adaptive: if every value is an integer, use step 1; otherwise keep 0.5. Return the chosen step so the caller can describe it, and make the "How you rate" hint string reflect the actual step instead of hard-coding "½-point buckets". Keep `ratingBucket()` in `InsightsView.tsx:16` consistent with the step actually used, or the click-to-drill-down will select the wrong items. (b) The OVERVIEW `PanelHeader` hint reads "Scored against your 6.7/10 average — the tick on each bar" (`InsightsView.tsx:167`) but sits above five stat tiles that have no bars and no ticks. Drop the "— the tick on each bar" clause from the Overview hint; that sentence belongs to the histogram, which already has its own.
  - Done when: `/insights` shows one bar per distinct rating value with no invisible gaps, the caption names the step the chart actually uses, and the Overview hint no longer mentions bars or ticks.
  - Tests: extend the insights tests — all-integer input yields step 1 and 10 buckets; input containing a `.5` value yields step 0.5 and 19 buckets.
  - Depends on: none

- [x] **T5** — Stop the item page showing the rating twice (SM31 🔵)
  - Files: the item-detail personal block shipped as B6 — locate via `grep -rn "Watched" src/components/item/` and follow the rated-state render
  - Detail: a rated item renders the gold button "★ 8/10" and, directly beneath, "✓ Watched · Apr 6, 2015   ★ 8 / 10". Remove the star + score from the **meta line** only, leaving "✓ Watched · Apr 6, 2015". The button is the interactive control and stays exactly as-is. Check the equivalent played/read states if the block has them, so the fix is not movie-only.
  - Done when: a rated item shows its score exactly once, and the watched date is still visible.
  - Tests: none — verified in browser
  - Depends on: none

- [ ] **T6** — Close the calendar star picker on Escape (SM32 🔵)
  - Files: the inline star picker used by `ActionCells` — `grep -rn "star" src/components/ | grep -i picker` to locate
  - Detail: the 10-star picker on a calendar agenda row does not dismiss on Escape, while the item page's "Why?" popover does. Add an Escape keydown handler that closes it and returns focus to the trigger. Mirror whatever pattern the "Why?" popover already uses rather than inventing a second one. Do **not** change the stars' hit area — `.tap-44-y` already expands them correctly and that was a deliberate a11y fix.
  - Done when: opening the picker on a `/calendar` agenda row and pressing Escape closes it, with focus back on the trigger.
  - Tests: none — verified in browser
  - Depends on: none

- [ ] **T7** — Say what the facet you-vs-crowd delta is computed over (SM22 🟡)
  - Files: `src/components/facet/PublicFacetView.tsx`
  - Detail: the panel shows "Crowd average 7.2 · 22 titles" and "Your average 7.4 · 9 rated", then asserts "You rate Christopher Nolan 0.6 lower than the crowd" — visibly contradicting its own two numbers. The delta is right; it is computed like-for-like over just the 9 titles the viewer rated (see the Decisions entry). Fix the copy at `PublicFacetView.tsx:189-190` to name the basis, e.g. "Across the 9 you've rated, you score Christopher Nolan 0.6 lower than the crowd". Keep the number and its sign unchanged.
  - Done when: the sentence states the comparison set, and a reader can no longer derive a contradiction from the two displayed averages.
  - Tests: none — copy change
  - Depends on: none

- [ ] **T8** — Make the desktop nav search keyboard-operable (SM24 🟡)
  - Files: `src/components/NavSearch.tsx`
  - Detail: the B5 nav search is mouse-only. Suggestions are `<li role="option">` inside a `<ul role="presentation">` with no `href`; the input is `role="combobox" aria-expanded="true"` but never sets `aria-activedescendant`; ArrowDown/ArrowUp do nothing and **Enter does nothing at all**. Fix all of it: give each suggestion a real `<a href>` (the same target the click handler navigates to) so middle-click, open-in-new-tab and copy-link work; correct the list container to `role="listbox"` with each option carrying a stable `id`; track an active index, wire ArrowDown/ArrowUp/Home/End to move it, set `aria-activedescendant` to the active option's id, make Enter activate it, and make Escape close the list. Keep the existing mouse path working unchanged.
  - Done when: typing "nolan", pressing ArrowDown then Enter navigates to that person's page; each suggestion is a real link; `aria-activedescendant` tracks the highlighted option.
  - Tests: none — verified in browser
  - Depends on: none

- [ ] **T9** — Fix the two remaining a11y structure problems (SM29 🔵)
  - Files: `src/components/LibraryWishlistTabs.tsx`, the B6 item-detail score panel (same file as T5)
  - Detail: (a) the four tabs are `role="tab"` but their direct parent is not the `role="tablist"` and nothing bridges them, and there is no `role="tabpanel"` anywhere. Either make the immediate parent the `tablist` or add `aria-owns`, and give the content region `role="tabpanel"` with `aria-labelledby` pointing at the active tab. (b) the entire item-detail score panel is one `<button>`, so its accessible name is the whole blob "71Your Fandex ScoreTypical match — you rate Christopher Nolan highly.Why? ▼". Split it: the score and its description become static content, and only the "Why?" disclosure stays a button with its own short accessible name.
  - Done when: the tab strip exposes a valid tablist/tab/tabpanel relationship, and the score panel's disclosure button reads as "Why?" rather than the full panel text.
  - Tests: none — verified in browser
  - Depends on: T5 (same file region as (b))

- [ ] **T10** — Put the Library/Wishlist tab in the URL (SM21 🟠)
  - Files: `src/components/MyStuffView.tsx`, `src/lib/myStuffMerge.ts`, `src/lib/myStuffMerge.test.ts`
  - Detail: `activeTab` is plain `useState(initialTab)` (`MyStuffView.tsx:111`), so switching tabs changes no URL, no `document.title`, no heading and no count, pushes no history entry, and is lost on reload — and Back leaves the page entirely. Per the decision this reverses C8's "switching tabs is never navigation": **update the comment block at `MyStuffView.tsx:98-102` to record the reversal and why**, do not leave it contradicting the code. Implement: read the tab from `?tab=` on mount (falling back to the route's `initialTab`), and on tab change call `router.push` with the new query so Back returns to the previous tab. Add a pure `parseTab(raw, fallback)` to `myStuffMerge.ts` that validates against the four known tabs and falls back on anything unrecognised. Make the `sr-only` `<h1>` (`:238`) and the `resultCount`/`resultNoun` pair (`:250-251`) track the **active tab** rather than the route — today they always report the route's rated/saved totals, which is the "still reads 1597 rated" half of the finding. Keep `/library` and `/wishlist` as the two entry routes; only the tab moves into the query string.
  - Done when: clicking "Wishlist" on `/library` gives `/library?tab=wishlist`, the count and heading match that tab, a reload restores it, and Back returns to the All tab instead of leaving the page.
  - Tests: `myStuffMerge.test.ts` — `parseTab` accepts each of the four valid values, falls back for `undefined`, empty string and an unknown value.
  - Depends on: none

- [ ] **T11** — Render `/library` incrementally and debounce its search (SM19 🟠)
  - Files: `src/components/GroupedView.tsx`, `src/components/MyStuffView.tsx`, `src/lib/useDebounced.ts` (new), `src/lib/incrementalList.ts` (new) + `src/lib/incrementalList.test.ts` (new)
  - Detail: `/library` renders all 2,014 cards in one pass — 44,517 DOM nodes, 125,923px of scroll height — because `GroupedView` maps the full array with no windowing. A keystroke in "Search your library" blocks the main thread for 237ms, and clearing the box for 1,426ms. Per the decision, no new dependency. Two changes: (1) add an `initialCount`/`step` cap to `GroupedView` (default it to unlimited so Discover, the facet pages and the wishlist keep today's behaviour) that renders only the first N items and grows by `step` when an IntersectionObserver sentinel at the end of the list comes into view; put the pure "how many to render next" arithmetic in `incrementalList.ts` so it is testable. Start at 300 with a step of 300. Grouping, month dividers and the sticky scrubber all operate on the **rendered** slice — the scrubber listing only loaded months is the accepted cost. (2) debounce the search input in `MyStuffView` (~200ms) so filtering does not run per keystroke; keep the input itself controlled and instant so typing never feels laggy. Preserve `useScrollRestore` — verify a Back-nav still lands in the right place once the list grows lazily, since the saved offset may exceed the initially rendered height.
  - Done when: `/library` renders roughly 300 cards initially and grows on scroll; a search keystroke measures well under 100ms; and Back from an item still restores scroll position.
  - Tests: `src/lib/incrementalList.test.ts` — first page equals `initialCount`, growth is by `step`, it never exceeds the total, and a total below `initialCount` renders everything with no sentinel.
  - Depends on: T10 (same file, and T10's smaller diff should land first)

- [ ] **T12** — Give facet-page cards their Fandex Score (SM23 🟡)
  - Files: `src/app/api/facet/mine/route.ts`, possibly `src/components/facet/PublicFacetView.tsx`
  - Detail: on `/person/christopher-nolan`, rated titles show the gold Fandex Score (`71 /100`) while unrated ones fall back to the provider rating (`6.0 /10`) — even though a score exists (Batman v Superman's detail page shows 62). **`PosterCard` is not the bug**: it already prefers `fandexScore` and only falls back to `communityScore` (`PosterCard.tsx:49`, `:105-107`). The facet payload simply lacks a score for those ids, so diagnose the supply side. The Q24 mechanism that should cover exactly this case is `route.ts:62-75` — the client posts the rendered ids via `?ids=` and the server scores each one from its own stored links. Three candidate causes, in the order worth checking: `loadLinks(id)` returning nothing for a thin `browsed=1` row; the `SELECT type FROM media_items` lookup missing; or `computeFandexScore(extractFacets(...))` legitimately returning `null` where the detail page's path succeeds. Compare against whatever path the item-detail page uses to reach 62 for the same uuid — that discrepancy is the finding. Fix so the facet page and the detail page agree.
  - Done when: on `/person/christopher-nolan` logged in, a card whose detail page shows a Fandex Score shows the same score on the card, and `/100` and `/10` badges no longer appear side by side for items that both have scores.
  - Tests: none — behaviour depends on real catalog data; verify in the browser against the named repro
  - Depends on: none

- [ ] **T13** — Re-measure, then fix, the calendar agenda rows at 375px (SM28 🟡)
  - Files: `src/components/CalendarView.tsx`
  - Detail: the sweep found the A1 Rate + Bookmark bar consuming ~145px of each agenda row at 375px, truncating titles to ~12 characters ("Mistfall Hu…", "Beast of Rei…"). That measurement predates `476d66a`, which changed calendar layout — so **measure first** at 375px with `javascript_tool` and record the actual title width. If titles still truncate below roughly 20 characters, fix by reclaiming space in `AgendaRow` (`CalendarView.tsx:290-328`): the `platformSources` meta line is the least load-bearing element at that width and can drop below `sm:`. Do not shrink the action buttons — they are `tap-44` for a reason. If the measurement shows titles now fit, close SM28 in `TASKS.md` with the measured numbers instead of changing code.
  - Done when: either agenda titles at 375px show ~20+ characters, or `TASKS.md` records the measured width that made the fix unnecessary.
  - Tests: none — measured in browser
  - Depends on: none

- [ ] **T14** — Restyle `/settings` to the B7 panel/eyebrow anatomy (SM30 🔵)
  - Files: `src/app/settings/**`, reusing `src/components/insights/PanelHeader` (or wherever B7 put it — `grep -rn "PanelHeader" src/components/`)
  - Detail: `/settings` still uses plain headings while `/insights` was restyled in B7, so the two read as different design generations. Apply the same `PanelHeader` eyebrow + panel container treatment to Settings' sections. This is a visual change only — **do not alter any behaviour** in the account-deletion flow (H4.6), the data-export link (H4.7), or the provider connect/disconnect controls. Those carry their own invariants and are out of scope beyond their styling wrapper.
  - Done when: `/settings` sections use the same eyebrow/panel anatomy as `/insights`, and the delete-account dialog, export download and connect/disconnect buttons all still work.
  - Tests: none — verified in browser
  - Depends on: T2 (touches `settings/page.tsx`)

- [ ] **T15** — Close SM25 as won't-fix in the docs (SM25 🟡)
  - Files: `TASKS.md`
  - Detail: Nils's decision is that Month view stays the default at every width; the L4 density work (40.7×128 → 50.8×80) already improved it and the remaining title clipping is accepted in exchange for one consistent entry point. Record that rationale against SM25. Write no code.
  - Done when: `TASKS.md` marks SM25 closed with the reasoning, and no calendar default-view code changed.
  - Depends on: none

- [ ] **T16** — Verify in the browser, then update the docs (all findings)
  - Files: `STATUS.md`, `TASKS.md`, `.claude/plans/2026-07-28-smoketest-sm18-sm32-closeout.md`
  - Detail: run the full verification set, then verify logged in via the browser pane. Start the dev server with `preview_start({name: "dev"})` and get a session with **`GET /api/dev/login`** — never hand-mint a JWT, never call `/api/auth/logout`. Walk each fixed surface: `/profile` (T1), `/settings` + `/discover` titles (T2, T14), `/discover` search (T3), `/insights` (T4), an item page (T5, T9), a `/calendar` agenda row (T6, T13), `/person/christopher-nolan` (T7, T12), the nav search by keyboard (T8), `/library` tab switching and Back (T10), `/library` render count and keystroke timing (T11). Check `read_console_messages` is clean on every page touched and `preview_logs` shows no server errors. Then record the outcome: add an `SM#` resolution section to `TASKS.md` marking each of the 15 findings closed (with the measured numbers for T11 and T13), update `STATUS.md`'s lead paragraph, and fill this plan's Session log.
  - Done when: `npx tsc --noEmit` silent, `npm run lint` at 0 errors, `npm test` green with the new tests included, every surface above checked in the browser with no console or server errors, and all three docs updated.
  - Tests: none — this is the verification task
  - Depends on: T1–T15

## Blockers log

## Session log
