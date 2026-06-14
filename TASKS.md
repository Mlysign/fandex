# ReleaseRadar — Task Tracker

Local working copy of the [ToDo List - ReleaseRadar](https://docs.google.com/spreadsheets/d/1dmO238QWVfjoi0quv8v0xaO4fW13GsX_YZadd4WJ2BI/edit) Google Sheet.
This file is the **source of truth for execution** — Claude reads/writes here instead of the sheet.

**Status legend:** ⬜ Not started · 🔵 In progress · ✅ Done · ⏸️ Blocked
**ID:** `T#` is a stable id (assigned here; the sheet has none). Ids stay fixed even as order changes.
**Epic tags:** A Insights · B Search/Discovery · C Detail/Component/Caching · D Library · E Audits · F Data/Profile · G Foundations/tech-debt (from [IMPROVEMENTS.md](IMPROVEMENTS.md)).
**Est.** = rough tokens to complete one task end-to-end (reading code + reasoning + edits + verify). Order-of-magnitude only; buckets: **~30k** trivial · **~75k** small · **~150k** medium · **~300k** large · **400k+** may span sessions. For ✅ tasks it's the approximate actual, for calibration.

Tasks are ordered into **execution phases**. Original sheet fields (Category / Context / Priority / Urgency) are preserved per task.

---

## Phase 0 — Warm-up (orient in the codebase, low-risk wins)

| ID | Status | Epic | Task | Pri | Urg | Est. | Notes |
|----|:--:|:--:|------|:--:|:--:|:--:|------|
| T1 | ✅ | A | Remove elements from Insights page ("Median", highest and lowest rating) | Low | Later | ~40k | Removed Median stat + Highest/Lowest blocks (OverviewCards); dropped dead median()/highest/lowest from insights.ts payload + types. tsc clean |
| T2 | ✅ | A | Change "Volume vs quality" to just "most watched", split by actor, director, film studio, game studio | Med | Later | ~50k | Section renamed "Most watched"; 4 columns (Actors=cast, Directors, Film studios=studio, Game studios=developer), ranked by count. Dropped "Highest rated" column |
| T3 | ✅ | A | Add clickable bars to bar graphs — show item list contributing to a bar (Rating Distribution, Taste by era) | Med | Soon | ~110k | Histogram + DecadeChart bars clickable → single-row horizontal **carousel** of PosterCards below (not a wrapping grid). Added rated `items` to payload + `InsightItem` client type. Click again/Clear to dismiss |
| T4 | ✅ | A | Collapse tag ratings to show 3 tags by default, click to expand | Med | Later | ~45k | FacetSection gained `collapsible`/`defaultVisible`; **Tag, People AND Studio** groups show 3 + "Show N more"/"Show less" |
| T14 | ✅ | D | Add filter to library to hide already-rated items | Med | Soon | ~50k | "Hide rated" toggle in SubBar filter row (new `filters` slot); filters `rating != null`. Empty-state broadened for filter-only empties |
| T15 | ✅ | D | Add "jump to next item" button to calendar view | Low | Later | ~60k | Computes months-with-releases; "Next release →" in header + empty-month state with prev/next jump buttons. Skips empty stretches |

## Phase 1 — Foundational audits (non-destructive → `improvements` doc, reviewed together before executing) — ✅ done, see [IMPROVEMENTS.md](IMPROVEMENTS.md)

| ID | Status | Epic | Task | Pri | Urg | Est. | Notes |
|----|:--:|:--:|------|:--:|:--:|:--:|------|
| T16 | ✅ | E | **Data structure** review — scalable? modular? consistent? → improvements doc | High | Soon | ~120k | 7 findings (D1–D7) in [IMPROVEMENTS.md](IMPROVEMENTS.md). Headline: per-source user state is JSON-in-column not queryable rows (D1); no migration framework (D4) |
| T17 | ✅ | E | **Software architecture** review — scalable/modular/consistent; flag duplicate code to modularise & reuse → improvements doc | High | Soon | ~120k | 6 findings (A1–A6). Headline: merge.ts is a 1006-line field-switch monolith (A1); no tests around merge/matcher (A4) |

## Phase 1.5 — Foundation hardening — ✅ COMPLETE
From [IMPROVEMENTS.md](IMPROVEMENTS.md); done before feature work to de-risk Phases 2/4. Ordered: tests → quick footguns → migration runner → data-shape migrations → big merge refactor. Epic **G = Foundations/tech-debt**. All landed in the working tree (no commits); `tsc --noEmit` clean, 29 tests green, live DB migrated + verified with backups (`data/rr.db.bak-pre-d1d5-20260614`).

| ID | Status | Epic | Task | Pri | Urg | Est. | Notes |
|----|:--:|:--:|------|:--:|:--:|:--:|------|
| A4 | ✅ | G | Add vitest + fixtures for `findMatchingItem` and `mergeForCanonical` | 🔴 High | Next | ~130k | Done: vitest + `vitest.config.ts` (in-memory DB isolation), `npm test`. 16 tests (merge priorities/normalize/extractYear + matcher cross-id false-merge protection, fallback, type-split). Surfaced **D8** (hyphen normalization quirk). All green, tsc clean |
| D3 | ✅ | G | Extract `normalizeName` to a dep-free module; import in `db.ts` + `merge.ts` | 🟡 Med | Next | ~40k | Done: new `src/lib/normalize.ts` (single source); `merge.ts` re-exports it; `db.ts` imports it. **D8 folded in** (hyphen→space, apostrophes dropped) + version-guarded full `norm_title` re-backfill (`user_version`). Applied to real DB (2497 rows, `.bak-pre-d8` taken). 16 tests green, tsc clean |
| A2 | ✅ | G | Make `initDb()` implicit inside `getDb()`; drop the 24 manual calls | 🟡 Med | Next | ~70k | Done: schema setup moved to private `ensureSchema(db)` run from `getDb()` (guarded by `_initialized`, takes db handle to avoid recursion). Removed all 24 `initDb()` calls + imports across API routes + `oauthConnect.ts`. `initDb()` kept as a deprecated thin alias (`getDb()`) for scripts/tests. tsc clean |
| D4 | ✅ | G | Add a `PRAGMA user_version` migration runner | 🟡 Med | Soon | ~90k | Done: `src/lib/migrations.ts` — ordered `MIGRATIONS` + `runMigrations(db)` (each in a txn, bumps user_version). Pure-SQL bodies so the SAME list runs in-app (via `getDb()`) AND standalone (`scripts/migrate.mjs`, imports the `.ts` under Node 26 type-stripping). user_version 1 = norm baseline (stays inline in db.ts); migrations are ≥2 |
| D1 | ✅ | G | Normalize per-source user state → `user_item_state` table; `rating` column becomes a derived cache | 🔴 High | Soon | ~280k | Done (migration v3): `user_item_state(user,item,source,relation,…)` is the truth; `user_library`/`user_watchlist` are caches rebuilt from it on every write (`rebuildCaches` in matcher.ts). Library route's bespoke write routed through `recordLibraryRating` → **fixes the un-propagated "clear a rating" bug**. Backfilled live DB (2139 library + 104 wishlist rows, 0 rating drift). Verified |
| D2 | ✅ | G | Unify `user_watchlist`/`user_library` (one table or shared helpers) | 🟡 Med | Soon | ~160k | Done with D1: the 4 copy-paste twins (`upsert/remove` × watchlist/library) now delegate to one `setSourceState`/`clearSourceState` + `rebuildCaches` over `user_item_state`. Signatures unchanged → callers untouched |
| D5 | ✅ | G | Add indexed `media_external_ids` table; populate via `extractCrossIds`; matcher reads it | 🟡 Med | Soon | ~150k | Done (migration v2): `media_external_ids(media_item_id, source, external_id)` indexed by (source, external_id). `remergeItem` rebuilds it from links; `findMatchingItem` does an indexed cross-id lookup instead of parse-all-candidates. Backfilled live DB (4000 rows) via pure-SQL `json_extract`. Cross-title id-merge now works |
| A1 | ✅ | G | Invert `merge.ts`: each source contributes `normalize() → partial`; merge becomes a priority-merge. **Staged**, one field-group at a time | 🔴 High | Soon | ~400k+ | Done: new `src/lib/sources/normalize.ts` — one `normalizeX(raw,type) → SourceNormalized` per source in a registry; `merge.ts` is now pure priority/union policy over the partials (no more `switch(source)`). New source = one normalizer, zero merge edits. Guarded by a 7-snapshot **characterization test** (full mergeLinks/explainMerge/mergeForCanonical over rich movie/game/show fixtures) → output byte-identical. **Note:** follow-up A5 can co-locate each normalizer with its adapter |

> **DB-migration note (D1/D2/D5):** these rewrite rows in the live `data/rr.db`. Land D4 first, build each migration against a copy with a verify script, take a timestamped `.bak` before applying, and expand-then-contract (add+backfill+switch reads → verify → drop old). Never add-and-drop in one step.

## Phase 2 — Search & Discovery redesign — ✅ COMPLETE & APPROVED (2026-06-14)
All tasks reviewed and approved by the user. In the working tree (no commits); `tsc` clean, 29 tests green, all routes return 200. Spec blocks below retained for reference.

| ID | Status | Epic | Task | Pri | Urg | Est. | Notes |
|----|:--:|:--:|------|:--:|:--:|:--:|------|
| T5 | ✅ | B | Rename current "For you" page → "Search"; add the same search bar that the "timeline" page has | Med | Next | ~100k | Merged Timeline+For You into one `/discover` (browse default → catalog search on query/filter via `find()` + sort). Completed via T23 |
| T6 | ✅ | B | Add "must include" & "must exclude" filters to the search bar | High | Next | ~120k | Facet include/exclude now in the always-visible unified filter section (SubBar), client-side on wishlist/library via `facetFilter.ts`. Completed via T23 |
| T23 | ✅ | B | **Make the shared bar own the FULL search/filter UI, consistently across Discover / Wishlist / Library** | High | Next | ~150k | `SubBar` is now the single unified bar: type + source chips, must-include/exclude facets (inline, no popover), hide-rated (shared `hideRated` prop), sort, search input — all always visible. `SearchBar` reduced to the text input. Discover: dead "Filters" button removed (ranges/membership always-visible via `FilterPanel`); type/source chips now trigger search (`hasActiveFilters`); **fetch-more on a text query** merges live TMDB/RAWG/Letterboxd matches ("More from the databases", deduped) via the existing `/api/discover?q=`. Sync stays in the shared `actions` slot. tsc clean, 29 tests, routes 200. **Review (2026-06-14) found follow-ups → T24 (consistency + filter pruning) and T8 (sort redesign).** See spec block below ↓ |
| T7 | ✅ | B | Make all tags and people labels clickable everywhere → enter the facet details page | High | Next | ~100k | New shared `FacetLink` component (`src/components/FacetLink.tsx`) computes the normalized facet key (person/company/tag) → `/insights/facet`. Wired on **Item Detail** (director/creator, developer, publisher, full cast, tags, keywords). Insights facets were already clickable. |
| T8 | ✅ | B | **Sort redesign + sort-driven result layout** | Med | Soon | ~180k | New 5-sort set in `types.ts` `SORTS` (release new/old, **user rating**, **platform rating** = avg across DBs via new `averageCommunity` in ratings.ts, best match). `find()` SortKey replaced; sort **always available** on all 3 pages. `GroupedView` gained `groupBy` ("month"/"rating"/"none") + `descending` + `ratingOf` → rating dividers + side nav for rating sorts, flat for best-match; **calendar view only for date sorts**. Wishlist/Library sort client-side (`src/lib/sortItems.ts`). |
| T24 | ✅ | B | **Search-bar consistency & filter pruning** | High | Next | ~90k | Sort dropdown + facets + hide-rated all in `SubBar`, always-visible, consistent across Discover/Wishlist/Library. Removed **source / Community / Runtime** filters (FilterPanel → Year + membership). Type chips trigger search; search starts on any filter. |
| T9 | ✅ | B | Remove "More like…", "I like…" etc. search options — rely on search bar + filters + sorting | Med | Soon | ~50k | Done as part of the T5 merge — taste-refine pills (seeds + like/dislike) gone; taste is now the "Best match" sort. `TasteMatchView.tsx` deleted. Fetch-more was rehomed as the search "More from the databases" merge (text query + must-include facet → external pull via `/api/discover?q=` and `/api/discover/facet-fetch`). |
| T10 | ✅ | B | New "For you" page: endless Tinder-style feed. Card view, swipe left=ignore / right=wishlist. Hide ignored, already-in-library, or wishlisted items | Low | Later | ~250k | New `/foryou` page (card stack, pointer-drag + buttons + ←/→ keys, batch prefetch). Ignore persistence via a new `ignored` relation in `user_item_state` (`ignoreItem`/`unignoreItem` + `/api/discover/ignore`); feed = `find()` with `excludeIgnored` + membership exclude library/wishlist + match sort. Added to NavBar. |

### T23 spec — unified search/filter bar (from T5/T6 review, 2026-06-14)
**Problem:** the shared `SearchBar` only owns the text input + must-include/exclude facets, so each page still wires the rest of search/filter itself → inconsistency. Pull **all** search controls into the shared component (or a shared filter section it renders) so Discover / Wishlist / Library behave identically.

**Discrepancies to fold into the shared component:**
- **Library:** the "Hide rated" toggle is page-local → move into the shared filter section.
- **Wishlist + Library:** the "Sync" button and the **source filters** are page-local → make them part of the shared bar (Sync as a standard action slot; source chips as a standard filter).
- **Discover:** the "Filters" button currently **does nothing** (dead — `showFilters`/`FilterPanel` ranges aren't reachable/meaningful in the always-visible model) → remove the disclosure button; surface its controls inline.

**Layout requirements:**
- **One filter UI section** containing ALL of: media type, source, facet include/exclude, hide-rated (and the ranges/membership where they apply).
- **Do NOT collapse filters behind a button** — no popover/disclosure (the current facet-include popover and the Discover "Filters" button both violate this). Filters are always visible.
- Keep it consistent across the three pages (a page opts controls in/out, e.g. Discover has no "hide rated"; Wishlist/Library have no ranges — but the ones they share look/behave identically).

**Behavior decisions (confirmed by user 2026-06-14):**
- **Type/source chips ARE normal search filters** — they should trigger search-results mode like q/facets (drop the "type/source only refine browse" rule from the T5 first pass).
- **Fetch more on search:** when a search query is active, also **pull matching titles from the external DBs (TMDB/RAWG)** into the local catalog so search isn't limited to already-ingested items (rewire the "Fetch more" logic still living in the orphaned `TasteMatchView.tsx`, e.g. as an automatic top-up or a "search the web / fetch more" affordance).

**Touch points:** `src/components/SearchBar.tsx`, `src/components/SubBar.tsx` (may merge the two or have SubBar fully delegate), `src/app/discover/page.tsx`, `src/app/dashboard/page.tsx` (wishlist), `src/app/library/page.tsx`, `src/components/discovery/FilterPanel.tsx`, `src/lib/facetFilter.ts`, `src/app/api/discover/find` + `src/lib/discovery.ts` (fetch-more on q), `src/lib/recommendIngest.ts` (catalog growth). After this, delete the orphaned `TasteMatchView.tsx` once its fetch-more logic is rehomed.

### T24 spec — search-bar consistency & filter pruning (from T23 review, 2026-06-14)
The unified bar landed (T23) but is still inconsistent between pages, and carries filters the user doesn't want:
- **Sort dropdown is Discover-only and only after a query** → make the **sort control available on all three pages (Discover / Wishlist / Library) and always visible** (not gated on a query). Wishlist/Library currently have no sort at all → add it (client-side sort of the loaded list; see T8 for the algorithms).
- **"Additional" filters (e.g. year) must be part of the always-visible filter section** above (next to facet/type), consistent across pages — not a separate/implicit area.
- **Remove these filters entirely:** **source** filter (tmdb/trakt/… chips — reverses the earlier "include source" decision), **Community** range, **Runtime** range. (Keep **Year** range + **membership** library/wishlist.) → `FilterPanel` shrinks to Year + membership; drop source chips from `SubBar` usages; drop `sources`/`communityMin/Max`/`runtimeMin/Max` from the find request builder (`apiFilters`).
- **Search starts as soon as ANY filter is applied** (already true for facets/ranges; ensure type — and the remaining filters — all trigger it; keep that behavior).
- Keep "no collapse / always visible" from T23.

**Touch points:** `src/components/SubBar.tsx`, `src/app/discover/page.tsx`, `src/app/dashboard/page.tsx`, `src/app/library/page.tsx`, `src/components/discovery/FilterPanel.tsx`, `src/components/discovery/types.ts` (drop unused range fields), `src/lib/discovery.ts` (`passesFilters` — drop community/runtime/source if unused elsewhere). NOTE: wishlist/library sort is client-side over already-loaded `EnrichedItem`s; Discover sort goes through `find()`.

### T8 spec — sort options + sort-driven result layout (revised from BUGS.md 2026-06-14)
**Exactly these 5 sort options** (replace the current match/community/releaseNew/releaseOld/title/recentlyAdded set):
1. **Release date — newest first**
2. **Release date — oldest first**
3. **Rating (user rating)** — the user's own 0–10 score (`user_library`/`user_item_state`); unrated items sort last.
4. **Rating (platform rating)** — an **AVERAGE across databases** (imdb, tmdb, metacritic, …) normalized to one scale. NEW: today `representativeCommunity` picks ONE source; this needs a new avg-of-all-community-scores helper + a new `SortKey`. (OMDB imdb/RT unconfigured per memory → uses whatever DBs are present.)
5. **Best Match** — rank by how well each item matches the user's preferences. The taste profile already exists (`buildProfile`/`scoreCandidate` in `discovery.ts` = current "match" sort) → reuse it; only a "user preference" analysis if that proves insufficient.

**Sort always available** (pairs with T24), on all pages.

**Result list regroups by the active sort** (currently `GroupedView` always groups by month + a month side-scrollbar):
- **Release date (newest/oldest):** current timeline grouping (month dividers + month scrollbar); newest = reversed order.
- **Rating (user or platform):** replace month dividers with **rating dividers** and the month side-scrollbar with a **rating scrollbar**.
- **Best Match:** plain list, no dividers, normal scrollbar, best match on top.
- **Remove "calendar" as a view option for any non-date sort** — calendar only makes sense for date sorts; for rating/best-match keep just **list + card**.

**Touch points:** `src/lib/discovery.ts` (`SortKey` + new platform-avg & user-rating sorts + remove dropped sorts), `src/lib/ratings.ts` (avg-across-DBs helper), `src/components/discovery/types.ts` (SortKey mirror), `src/components/GroupedView.tsx` (group-by-sort: month vs rating vs none), `src/components/CalendarView.tsx` (gate to date sorts), `src/app/discover/page.tsx` + wishlist/library (sort state, available views per sort). Pairs tightly with **T24** and **T11/T12** (Phase 3 card/list rework).

## Phase 3 — UX layer (review then execute)

| ID | Status | Epic | Task | Pri | Urg | Est. | Notes |
|----|:--:|:--:|------|:--:|:--:|:--:|------|
| T18 | ⬜ | E | **UI/UX** review of the whole project → improvements doc | High | Later | ~150k | Do before T11–T13 |
| T11 | ⬜ | C | Improve card & list view components: keep type tag + icon (with color coding), remove source color-coding. Add wishlist icon (bookmark) to corner when wishlisted; library icon when in library | Low | Next | ~100k | |
| T12 | ⬜ | C | Cache previous pages correctly — back-nav currently loses filters, scroll position, calendar location | Med | Soon | ~130k | Context: Wishlist, Library, Discover - Up Next |
| T13 | ⬜ | C | Make details page more in line with other sites for readability/UX: card view w/ profile pictures for people, co-locate user rating + source rating, reuse Insights tag color-coding; improve further at discretion | Med | Soon | ~180k | Context: Item Detail, Facet Detail |
| A3 | ⬜ | G | Split `item/page.tsx` (790L) into sections; remove the duplicated `PLATFORM_CONFIG` in favour of the registry | 🟡 Med | Later | ~150k | Pairs with T13 detail redesign |
| A5 | ⬜ | G | Move residual per-source switches (colors/labels/url-params) onto `catalog.ts` entries | 🟢 Low | Later | ~60k | After A1 |
| A6 | ⬜ | G | `withUser(handler)` wrapper for uniform auth/error handling across API routes | 🟢 Low | Later | ~70k | Pairs with A2 |
| D6 | ⬜ | G | Fix `libraryAnalysis` cache signature so offsetting rating edits invalidate it | 🟢 Low | Later | ~30k | |
| D7 | ⬜ | G | Add child-FK indexes (`idx_library_media`, `idx_watchlist_media`) | 🟢 Low | Later | ~25k | Trivial — can fold into a D4 migration step |
| D9 | ⬜ | G | Persist game **developer/publisher** (+ other detail-only fields) at sync time so Insights/facets have data | 🟡 Med | Soon | ~120k | From [BUGS.md](BUGS.md): only 3% of library games (24/713) have dev/pub in `raw_data` — Steam owned-games + RAWG list payloads omit them (detail-endpoint only); movies/shows are 99% (TMDB). Options: enrich+persist RAWG/IGDB detail during `pullLibrary`/ingest (rate-limited, 713 fetches) or a one-off backfill script. IGDB `involved_companies` needs Twitch creds (currently unset). Display half already fixed (publishers now shown in Insights) |
| A7 | ⬜ | G | Fix the **~27 `react-hooks` lint errors** (refs-in-render, set-state-in-effect, purity, static-components) — real render-correctness bugs | 🟡 Med | Soon | ~80k | Pairs with T18. Concentrated in `item/page.tsx`, `discover/page.tsx`. Also clear the 19 cosmetic `no-unescaped-entities` + 1 `prefer-const` + 33 warnings (`exhaustive-deps`, `<img>`→next/image, unused-vars) while in those files. NB: `no-explicit-any` downgraded to warn 2026-06-14 (260 of them — deliberate API-JSON style, not in scope) |

## Phase 4 — Data feature (depends on T16)

| ID | Status | Epic | Task | Pri | Urg | Est. | Notes |
|----|:--:|:--:|------|:--:|:--:|:--:|------|
| T22 | ⬜ | F | Country setting on profile page — drives which release dates are pulled from DBs and updates streaming availability correctly | Med | Later | ~160k | Context: Profile |

## Phase 5 — Go-live (only once features + architecture are stable)

| ID | Status | Epic | Task | Pri | Urg | Est. | Notes |
|----|:--:|:--:|------|:--:|:--:|:--:|------|
| T19 | ⬜ | E | **Productionization readiness** review → improvements doc. Two sub-sections: **(a) Android app / Play Store**, **(b) public website** | High | Later | ~150k | Merged (was T19 + T20) |
| T21 | ⬜ | E | **Security analysis** assuming public launch as Android app or website | High | Later | ~150k | |

---

## Rough budget by phase (remaining ⬜ work)
- **Phase 1.5:** ✅ done (was ~1.32M)
- **Phase 2:** ✅ done (was ~700k+)
- **Phase 3:** ~895k
- **Phase 4:** ~160k
- **Phase 5:** ~300k
- **Total remaining:** ~3.4M tokens (very rough; refactors carry the most uncertainty)

## Open decisions
1. **Sequencing:** ✅ resolved — phased, audits-early. Foundation refactors live in Phase 1.5.
2. **T19 + T20 merge:** ✅ merged → T19.
3. **DB migrations (D1/D2/D5):** ✅ approved — D4 first → build against a DB copy + verify script → timestamped `.bak` → expand-then-contract (add+backfill+switch reads → verify → drop old).
4. **Phase 1.5 vs Phase 2 order:** ✅ approved — do Phase 1.5 before Phase 2.

## Changelog
- _2026-06-14_ — ✅ **Phase 2 COMPLETE & APPROVED.** All tasks (T5, T6, T7, T8, T9, T10, T23, T24) reviewed and approved by the user after the search-bar fixes (merged DB results, date-sort timeline both directions, sticky shared filter bar). tsc clean, 29 tests, routes 200. Next up: **Phase 3 (UX layer)** — T18 review, then T11–T13 + the folded-in G items (A3/A5/A6/D6/D7) + A7 (react-hooks) + D9 (game studio data).
- _2026-06-13_ — Tracker created from sheet snapshot (22 tasks, 6 epics).
- _2026-06-13_ — Reordered into 6 execution phases. Merged T19+T20 → T19 (Productionization readiness, Android + Web sub-sections). Started T1.
- _2026-06-13_ — ✅ T1: removed Median / Highest / Lowest from Insights page + dead computation.
- _2026-06-13_ — ✅ **Phase 0 complete** (T2, T3, T4, T14, T15). `tsc --noEmit` clean; eslint clean on changed files (remaining warnings are pre-existing). No commits — all in working tree for review.
- _Tech-debt noted for Phase 3 (T18):_ pre-existing lint in `CalendarView`/`library` — `<img>` vs next/image, `ref.current`-in-render Tooltip pattern, unescaped quotes/apostrophes in JSX copy.
- _2026-06-13_ — ✅ **Phase 1 complete** (T16, T17). Wrote [IMPROVEMENTS.md](IMPROVEMENTS.md): 7 data findings (D1–D7) + 6 architecture findings (A1–A6), severity/effort-rated, with a recommended execution order. No code changed — diagnostic only.
- _2026-06-13_ — Pulled IMPROVEMENTS.md findings into the plan: new **Phase 1.5 (Foundation hardening)** = A4, D3, A2, D4, D1, D2, D5, A1 (ordered); UI/cleanup findings (A3, A5, A6, D6, D7) added to Phase 3. New epic **G**.
- _2026-06-13_ — Added **Est.** (rough token-cost) column to all task tables + a per-phase budget summary.
- _2026-06-13_ — ✅ **A4** (Phase 1.5): vitest harness + 16 tests for merge/matcher (in-memory DB isolation, real `data/rr.db` untouched). Found + logged **D8** (hyphen normalization quirk) in IMPROVEMENTS.md.
- _2026-06-13_ — ✅ **D3 + D8** (Phase 1.5): centralized `normalizeName` in `src/lib/normalize.ts` (re-exported by merge.ts, imported by db.ts); fixed hyphen→space rule; `user_version`-guarded re-backfill of all 2497 `norm_title` rows on the real DB (backup `data/rr.db.bak-pre-d8`). Tests + tsc green.
- _2026-06-14_ — ✅ **A2** (Phase 1.5): schema setup implicit in `getDb()` (`ensureSchema`); removed all 24 `initDb()` calls; alias kept for scripts/tests.
- _2026-06-14_ — ✅ **Phase 1.5 COMPLETE** (D4, D5, D1, D2, A1 in one session):
  - **D4** migration runner (`src/lib/migrations.ts`, `runMigrations`) — pure-SQL versioned migrations, runnable in-app and standalone (`scripts/migrate.mjs`).
  - **D5** `media_external_ids` (migration v2) — indexed cross-id matching; backfilled 4000 rows; matcher reads the table.
  - **D1+D2** `user_item_state` (migration v3) — normalized per-source truth unifying wishlist+library; cache tables rebuilt from it; backfilled 104 wishlist + 2139 library rows, 0 drift; fixed the clear-a-rating bug.
  - **A1** merge inversion — per-source normalizers (`src/lib/sources/normalize.ts`) + policy-only `merge.ts`; locked by a 7-snapshot characterization test (byte-identical output).
  - Live `data/rr.db` migrated to user_version 3 + verified; backup `data/rr.db.bak-pre-d1d5-20260614`. 29 tests green, tsc clean. No commits — working tree for review.
- _2026-06-14_ — Lint triage: `npm run lint` had 307 errors but 260 were `no-explicit-any` (deliberate API-JSON style) → downgraded that rule to **warn** in `eslint.config.mjs` so real issues surface (now 47 errors). Added **A7** (Phase 3) for the ~27 `react-hooks` correctness errors; cosmetic JSX/img/deps left to fold into T18.
- _2026-06-14_ — **Phase 2 start (T5/T6 first pass):** merged Timeline+For You into one `/discover` (browse default → catalog search on query/filter, with T8 sort); new shared `SearchBar` (text + must-include/exclude) rendered by `SubBar` across discover/wishlist/library; client-side facet filtering (`facetFilter.ts`); backend `find()` gained `q`; `FilterPanel` trimmed; T9 folded in (taste pills removed; `TasteMatchView` orphaned). tsc clean, 29 tests green, routes 200.
- _2026-06-14_ — **Fix (advanced filters placement):** Year + In-library/On-wishlist were rendered in the scroll area (above GroupedView) on Discover, so they scrolled away, and were absent on Library/Wishlist. Moved into the **sticky SubBar** via a new `advancedFilters` slot (FilterPanel restyled to a compact inline row), and rendered on **all three pages** consistently. Library/Wishlist filter by them client-side (`passesYearMembership` in facetFilter.ts — inLibrary via libraryStatus/rating, onWishlist via platformSources; both cross-relation fields are already returned by /api/library + /api/calendar).
- _2026-06-14_ — **Fix (date sort in search mode):** with a facet/query active, switching newest↔oldest stayed "oldest." `GroupedView.groupByMonth` ordered months by input-array order, which in search mode is already sorted → newest-first input + `descending` reverse = double-reversal back to oldest. Now months are always ordered chronologically, so `descending` is the single source of direction.
- _2026-06-14_ — **Fix (T8 date sorts):** both "Release (newest/oldest)" now drive the live infinite **timeline** (not a finite local page) — `searchActive` excludes date sorts so they browse. Auto-scrolls to today on select (GroupedView today-scroll runs for both directions, re-anchors when direction flips). newest-first = newer at top / scroll-up loads future, scroll-down loads past (+ reversed month scrollbar); oldest-first = the reverse. Sentinels + scroll-anchor map to past/future by direction (`topLoadRef`/`bottomLoadRef`, anchor on whichever load grows the top).
- _2026-06-14_ — **Fix (T24/T5 follow-up):** must-include facets now trigger an external DB fetch, not just local results. New `/api/discover/facet-fetch` reuses `buildFacetDetail` to pull a facet's full external set (e.g. a person's TMDB filmography). Local + DB results are now **merged into ONE list** (`sortDiscover` orders the combined set by the active sort — `score`/`communityAvg`/`communityScore` across both shapes; `webLoading` shows local first, then "Pulling more from the databases…"). Previously only a text query hit the DBs (RR returned ~6 local titles), and DB results were a separate section below. (Known gap: DB items aren't filtered by year/exclude-facet/membership — those apply to local results only.)
- _2026-06-14_ — ✅* **Phase 2 COMPLETE (pending review):** **T24** (unified always-visible filter bar; removed source/Community/Runtime; type chips trigger search) + **T8** (5-sort set incl. new platform-avg & user-rating sorts; sort always available; `GroupedView` regroups by sort — rating dividers/nav, flat best-match; calendar only for date sorts; client-side `sortItems` for wishlist/library) + **T7** (`FacetLink` makes tags/people/companies clickable → facet detail, wired on item page) + **T10** (`/foryou` swipe feed: drag/buttons/keys, `ignored` relation persistence + `/api/discover/ignore`, feed via `find()` excludeIgnored + membership-exclude). Deleted orphaned `TasteMatchView.tsx`. tsc clean, 29 tests, routes 200.
- _2026-06-14_ — **T23 review (from BUGS.md) → added T24 + rewrote T8.** Search bar still inconsistent (sort Discover-only/query-gated; filters not uniformly visible) and carries unwanted filters → **T24** (consistency, remove source/Community/Runtime, search-on-any-filter). Sort redesign → **T8**: fixed 5 options (release new/old, user rating, platform-avg rating [new], best match), sort always available, and the result list regroups by sort (rating dividers/scrollbar; calendar only for date sorts). Full specs under the Phase 2 table. No code yet.
- _2026-06-14_ — ✅* **T23 (+ closes T5/T6), pending review:** `SubBar` is now the single unified search/filter bar — type + source chips, must-include/exclude facets inline (no popover), shared `hideRated` prop (Library), sort, and text input, all always visible. `SearchBar` slimmed to the text input. Discover: removed the dead "Filters" button (ranges/membership always-visible), type/source chips now trigger search, and a text query also pulls fresh TMDB/RAWG/Letterboxd matches ("More from the databases", deduped) via `/api/discover?q=`. `TasteMatchView.tsx` still orphaned (tag-based "fetch more" not rehomed — left in place). tsc clean, 29 tests, routes 200.
- _2026-06-14_ — **T5/T6 review → reopened as 🔵; added T23.** User found the shared SearchBar doesn't own the full search UI (Library hide-rated, Wishlist/Library sync + source filters, Discover dead "Filters" button all still page-local). New **T23**: pull ALL filters (type, source, facet include/exclude, hide-rated) into one always-visible shared section — no collapse/popover. Confirmed decisions: type/source chips count as search filters; fetch-more from external DBs on a search query. Full spec under the Phase 2 table.
- _2026-06-14_ — Bug triage ([BUGS.md](BUGS.md)): "Warriors of the Wind merge" = not a bug (TMDB alt-title). Insights studios = fixed display half (publishers now shown in `InsightsView`) + logged the data-coverage root cause as **D9** (game sync persists list payloads lacking dev/pub; 97% of library games affected). 29 tests green, tsc clean.
- _2026-06-14_ — ✅ **A2** (Phase 1.5): schema setup now implicit in `getDb()` via private `ensureSchema(db)` (guarded by `_initialized`); removed all 24 `initDb()` calls + imports from API routes + `oauthConnect.ts`. `initDb()` kept as a deprecated alias for standalone scripts/tests. tsc clean, 16 tests green. Next: **D4** (migration runner).
