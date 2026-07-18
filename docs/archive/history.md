# Project history archive

Everything finished and resolved, in one place — moved out of the active
[TASKS.md](../../TASKS.md), the old root IMPROVEMENTS.md (now deleted, folded
into TASKS.md's audit-summary paragraph), and the old root BUGS.md, 2026-07-18
(and consolidated from three separate archive files into this one the same
day) to keep the working docs short. Nothing here is open; it's a decision/why
record — root causes, commit hashes, verification steps. If you're planning
new work, you want [TASKS.md](../../TASKS.md), not this file. Grep this file
for a keyword rather than reading it end to end. (Internal `[IMPROVEMENTS.md]`
links below are historical artifacts pointing at the "Audit findings archive"
section further down this same file.)

**Contents:** Phases 0–6 (completed execution history) → closed QA/nav/
smoketest findings + H2 (data-model hardening, done) → the five audit passes
(D#/A#/U#/P#/S#, all resolved) → the closed bug tracker → the old budget/
decisions/changelog.

P17) are carried forward live in TASKS.md — they also still appear below for
full history.

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

## Phase 3 — UX layer — ✅ COMPLETE (pending the user's visual review)
All tasks done; tsc clean, 30 tests, 0 eslint errors. Cards/back-nav/detail (T11–T13) were user-approved; the rest (A3/A5/A6/A7/T25/T26/T27/D6/D7/D9) are in the working tree awaiting the user's browser review.

| ID | Status | Epic | Task | Pri | Urg | Est. | Notes |
|----|:--:|:--:|------|:--:|:--:|:--:|------|
| T18 | ✅ | E | **UI/UX** review of the whole project → improvements doc | High | Later | ~150k | Done: 13 findings (U1–U13) + a **live visual pass** (U14/U15 + confirmations) in [IMPROVEMENTS.md](IMPROVEMENTS.md) Part III, with a suggested Phase-3 order. Visual pass confirmed: unified bar consistent across pages (T24 ✓), detail page better than expected (T13 = co-locate ratings + people photos), dev/pub appear on live detail (D9 = stored data only). Mobile breakpoint not visually validated. Surfaced T25/T26/T27; expanded T11/T13 |
| T11 | ✅ | C | Improve card & list view components: keep type tag + icon (with color coding), remove source color-coding. Add wishlist icon (bookmark) to corner when wishlisted; library icon when in library | High | Next | ~120k | *Pending review. **Redesigned per user mockup (2026-06-14):** unified **3-cell action toolbar** (`ActionCells.tsx`) — Rate · Watched · Wishlist — always visible (replaces hover quick-actions + badge overlays), score-colored ★ rate cell with a 10-star picker (inline-left on rows, popover-below on cards), emerald watched cell, amber wishlist cell. **Type-colored border** (top strip on cards, left border on rows) + type icon+label in footer/meta. Source dots removed (kept in Settings). Game art letterboxed over blurred fill (`/foryou` too); broken-image → TypeIcon placeholder. New backend: `toggleWatched` (`useQuickActions`) + `clearLibrary` (matcher) + library `DELETE`. Verified live on Library (card+list) + Discover + For You; star picker confirmed. tsc clean, 29 tests. **Cleanup:** `QuickActions.tsx` (RateBar/WishlistButton) now unused; `ItemBadges` only used by calendar. **Deferred:** U14→T12, U12 contrast, U4 mobile→T26 |
| T12 | ✅ | C | Cache previous pages correctly — back-nav currently loses filters, scroll position, calendar location | Med | Soon | ~130k | *Pending review. New `usePersistedState`/`useScrollRestore` (`src/lib/usePersistedState.ts`, sessionStorage). Filters/search/sort persist across back-nav on Discover/Library/Wishlist; scroll restored on Library/Wishlist (Discover keeps its today-anchor). tsc clean, 29 tests. **Review fix (2026-06-15):** filters were lost on back-nav in dev — `usePersistedState` flipped a `hydrated` **ref** synchronously so the save effect clobbered storage with the stale `initial` before the restored value committed, and React's dev double-invoke read the empty value back. Made `hydrated` **state** (save effect now skips the first commit) + stopped gating `useScrollRestore`'s scroll listener behind its one-time ref (was dropped on effect re-invoke). Re-verified live: back-nav now keeps filter + scroll. **Still open:** calendar month-location persistence + **U14** (month side-nav doesn't scale to multi-decade lists → group by year/decade) |
| T13 | ✅ | C | Make details page more in line with other sites for readability/UX: card view w/ profile pictures for people, co-locate user rating + source rating, reuse Insights tag color-coding; improve further at discretion | Med | Soon | ~180k | *Pending review, verified live: **cast cards with TMDB profile photos** (`cast.profileUrl` added through normalize→merge→EnrichedItem; merge snapshot updated); **your rating co-located** with crowd scores at the top ("You ★N" badge in the Scores row); **tags color-coded by category** (`categorizeTag`+`CATEGORY_COLORS`, like Insights); keywords kept neutral. tsc clean, 29 tests. **A3 (split the 790-line file + drop duplicated PLATFORM_CONFIG) still ⬜** — internal refactor, lower risk to do separately |
| A3 | ✅ | G | Split `item/page.tsx` (790L) into sections; remove the duplicated `PLATFORM_CONFIG` in favour of the registry | 🟡 Med | Later | ~150k | Done: `item/page.tsx` 810→**391 lines** (now just state/effects/handlers + composition). Extracted `src/components/item/`: `format.ts` (fmt*/ratingsTooltip), `primitives.tsx` (ScoreBadge/Fact/RatingsBreakdown), `MediaGallery`, `RatingsSection`, `FactsSection`, `WishlistPanel`, `LowerSections`. Faithful JSX extraction (no behavior change). **`PLATFORM_CONFIG` already gone** — eliminated during the A1/A2 registry work; page uses `catalogForType` + `SOURCE_COLORS/LABELS`. tsc clean, 29 tests. (Pre-existing A7 lint untouched: 1 `no-unescaped-entities` apostrophe in the not-found block.) |
| A5 | ✅ | G | Move residual per-source switches (colors/labels/url-params) onto `catalog.ts` entries | 🟢 Low | Later | ~60k | Done: `SourceMeta` gained `urlParam` (+ optional `shortLabel`); `constants.ts` `SOURCE_COLORS`/`SOURCE_LABELS` now **derive** the 5 connectable platforms from `CATALOG` (display-only rating sources imdb/rt/metacritic/igdb kept as explicit extras); `itemUrl.ts` `SOURCE_PARAM` + new exported `SOURCE_PARAMS` derive from `CATALOG.urlParam` (replaces the hardcoded `["rawgId",…]` lists in item + item/debug). Byte-identical values (only key order differs). tsc clean, 0 eslint errors. |
| A6 | ✅ | G | `withUser(handler)` wrapper for uniform auth/error handling across API routes | 🟢 Low | Later | ~70k | Done: new `src/lib/withUser.ts` — `export const POST = withUser(async (req, session) => …)`; runs `requireSession` once (→401), wraps the handler (throw → logged 500), passes through dynamic route-ctx args. Converted **all 15 session-gated routes** (insights ×2, discover find/ignore/facets/fetch-more/facet-fetch, sync, disconnect, calendar, detail, detail/refresh, library ×3, search, watchlist ×2) — dropped the copy-pasted try/Unauthorized-401/500 boilerplate. (OAuth/`getSession` routes untouched.) tsc clean, 30 tests, 0 eslint errors. |
| D6 | ✅ | G | Fix `libraryAnalysis` cache signature so offsetting rating edits invalidate it | 🟢 Low | Later | ~30k | Done: added a rowid-weighted `SUM(rating*rowid)` term to `librarySignature` so swapping two items' ratings changes the signature |
| D7 | ✅ | G | Add child-FK indexes (`idx_library_media`, `idx_watchlist_media`) | 🟢 Low | Later | ~25k | Done: migration v4 in `migrations.ts` (`idx_library_media`, `idx_watchlist_media`) |
| D9 | ✅ | G | Persist game **developer/publisher** (+ other detail-only fields) at sync time so Insights/facets have data | 🟡 Med | Soon | ~120k | Done via a **detail-backfill** approach. New `src/lib/enrichGameDetail.ts` (`enrichStoredGameDetail`): for each game link from a detail-capable source (rawg/steam — igdb needs Twitch creds, unset), if the stored raw_data lacks dev/pub, refetch its own **detail endpoint** (RAWG `/games/{id}`, Steam `GetItems include_basic_info` → both carry dev/pub) and persist via `linkSourceToItem`→remerge. **Durability keystone:** `matcher.ts` `upsertMediaItem`/`linkSourceToItem` now **merge-preserve** raw_data (`{…existing, …new}`) so a later *list*-payload sync (Steam owned-games/RAWG played-list) no longer clobbers the fetched detail — locked by a new test (30 total). One-off script `scripts/backfill-game-detail.ts` (idempotent, rate-limited, `--dry-run`/`--limit`); dry-run found **741 game items** missing dev/pub (494 rawg + 479 steam links). Backed up live DB (`data/rr.db.bak-pre-d9-20260616`) + ran the full backfill: **967 links enriched, 0 errors**; game studio-data coverage **3% → 93.3% (962/1031 items)**. tsc clean, 30 tests, 0 eslint errors. **Deliberate non-goal:** no in-sync auto-enrich (would make first sync fetch all 700+) — re-running the idempotent backfill picks up new games cheaply. |
| A7 | ✅ | G | Fix the **~27 `react-hooks` lint errors** (refs-in-render, set-state-in-effect, purity, static-components) — real render-correctness bugs | 🟡 Med | Soon | ~80k | Done: **31 react-hooks errors → 0**; **all eslint errors → 0** (also fixed 7 `no-unescaped-entities` + 1 `prefer-const`). Real bugs fixed properly: refs-in-render (Tooltip now takes `anchorRef` read in its effect, not callers' render → fixes PosterCard/ListCard/CalendarView), `static-components` (insights/facet `Row`→module scope `CompareRow`), discover use-before-decl (moved `loadDefault` up) + sentinel-ref false-positive (extracted module-scope `SentinelBar`), settings notice → lazy `useState` init. The `set-state-in-effect` flags on **idiomatic** patterns (sessionStorage/localStorage hydration, prop-sync, data-fetch-on-mount, load guards, layout-measure) are documented with justified `eslint-disable-next-line` (not bugs). 318 warnings remain (deliberate `no-explicit-any` + exhaustive-deps/img/unused) — out of scope. tsc clean, 29 tests. **Not visually verified** (user reviews in browser) |
| T25 | ✅ | C | **Accessibility pass** (from T18 U6): `aria-label`s on icon-only controls (view toggles, sort, clear ×, foryou ✕/♥, facet popover), a global `focus-visible` ring, sensible tab order | 🟡 Med | Soon | ~80k | Done: global `:focus-visible` ring in `globals.css` (keyboard-only, doesn't affect mouse). `aria-label`s + toggle semantics on all icon-only controls: SubBar view toggles (`aria-pressed`, `role=group`) + sort `select` + facet-remove ×; SearchBar input + clear ×; ActionCells rate (`aria-haspopup`/`aria-expanded`) · watched · wishlist (`aria-pressed`) + 10-star picker; MediaGallery carousel arrows + thumbnails; CalendarView + SearchModal close ×; For You ✕/♥. Decorative glyphs marked `aria-hidden`. tsc clean, 29 tests, 0 eslint errors. **Known follow-up:** PosterCard/ListCard are clickable `<div>`s → not keyboard-focusable (can't Tab-to-open a card; the in-card action buttons ARE reachable). Fixing needs role/anchor rework that nests awkwardly with the action buttons — better done in **T27** (shared primitives). **Not visually verified** |
| T26 | ✅ | C | **Responsive / mobile pass** (from T18 U4): NavBar collapses to a menu < md; SubBar's advanced rows collapse behind a "Filters" toggle on mobile (stay always-visible on desktop per T24); check `/foryou` card + chip-row overflow | 🟡 Med | Soon | ~110k | Done: **NavBar** shows the link row on md+, a **hamburger → dropdown menu** (`aria-expanded`, closes on nav) below md. **SubBar** advanced rows (facets + year/membership) wrapped in a `hidden md:block` container that a mobile-only **"Filters" toggle** (`md:hidden`, `aria-expanded`) opens; always-visible on md+ per T24. Search row now `flex-wrap` (wraps on narrow, one line on desktop); `/foryou` meta-chip row `flex-wrap`. tsc clean, 29 tests, 0 eslint errors. **Not visually verified** — worth checking at 375px width |
| T27 | ✅ | C | **Shared UI primitives + consistent states** (from T18 U5/U13): `<Button>`/`<Chip>` to kill style drift, shared `<EmptyState>` + skeletons, lightweight global toast for rate/wishlist errors | 🟢 Low | Later | ~90k | Done: new `src/components/ui/` primitives — **`Button`** (+ `buttonClasses` for link-as-button) · **`Chip`** (faithful extraction of SubBar's color-coded pill → All/type/source/hide-rated now share it) · **`EmptyState`** (adopted on Discover/Library/Wishlist no-results) · **`Spinner`** (replaces ad-hoc "Loading…"/`animate-pulse` on calendar + /foryou + discover) · **`Toast`** provider+`useToast` (mounted via `AppProviders` in root layout; wired into `useQuickActions` so the previously-swallowed rate/wishlist/watched failures now surface) · **`ConfirmDialog`** provider+`useConfirm` (promise-based, **replaces native `confirm()`** in settings disconnect, **U11**). **Card keyboard-access fix deferred from T25:** PosterCard/ListCard now `role=button`+`tabIndex=0`+Enter/Space (guarded to the card itself so nested action buttons keep their own keys). Settings Sync/Disconnect → `Button`. tsc clean, 29 tests, 0 eslint errors. **Not visually verified.** Follow-ups: SubBar color chips adopted; /foryou swipe errors still fire-and-forget (could toast). |

## Phase 3.5 — Personalized discover browse (default upcoming feed)

| ID | Status | Epic | Task | Pri | Urg | Est. | Notes |
|----|:--:|:--:|------|:--:|:--:|:--:|------|
| T28 | ✅ | B | **Personalized default discover feed** — replace the global-popularity browse with a taste-ranked upcoming feed (reuse the facet engine) | High | Now | ~220k | *Pending browser review. Built B2. **New:** `discoverFeed.ts` (wide multi-page upcoming fetchers → `FeedCandidate` w/ genre names + original_language + crowd-vote data), `tmdbGenres.ts` (movie/TV id→name maps for list-payload pre-scoring), `liveDiscover.ts` (the engine). **discovery.ts** exposes `buildProfile`/`scoreFacets`/`getCatalogIdf`/`ROLE_WEIGHT`. **libraryAnalysis.ts** `getMembershipSignal` = library+wishlist facet counts (rated or not) + original-language histogram (wishlist ×2), cached. **Engine:** blended profile (rated signal + membership priors: lib 0.6 / wish 0.9, K=3, role-weighted) → wide pull (5 pages/type) → cheap genre+language pre-score → hydrate top 24 movies/shows via 1 TMDB `fetchById` each (games scored from list genres/tags only — RAWG detail = 4 sub-reqs, not worth it) → full `scoreFacets` → keep 18/type, date-sorted. Community floor drops items with ≥50 votes & <5/10. 45-min per-user+region feed cache. **Route:** default `GET /api/discover` → `personalizedFeed` (cold-start/signed-out → old global-popularity fallback); section load-more → cheap `filterSectionPage` (no hydration, drops floor-fails + negative-taste). Language is a soft tiebreaker only (user declined it as a hard filter). tsc clean, 30 tests, 0 eslint errors. **Not browser-verified.** Follow-up: `invalidatePersonalizedFeed` exported but unwired — feed refreshes only on the 45-min TTL, so new wishlist/ratings reflect with a delay. See spec block ↓ |

### T28 spec — personalized default discover feed (2026-06-17)
**Problem:** `GET /api/discover` with no query (the default browse) hits TMDB/RAWG **live, sorted by pure global popularity** (`popularity.desc` / `-added`) and only pulls page 1 per source, then date-sorts those ~20. Zero personalization → the visible set is whatever's globally trending (e.g. a flood of Korean dramas). Meanwhile the sophisticated IDF-weighted facet ranker (`find()`/`scoreCandidate` in `discovery.ts`) only ranks the **local DB catalog**, never the live upcoming feed. The two engines are disconnected; the default view uses the dumb one.

**Chosen approach (B2 — confirmed by user 2026-06-17):** fetch a wider live candidate pool, then **re-rank it with the existing facet engine**, hydrating the top candidates to get full facets. Signals to drive it (user-selected): **library + wishlist content** (not just rated items) and a **community rating floor**. Language/region NOT a hard filter (user declined) — allowed only as a soft input to the cheap pre-score.

**Design:**
1. **Blended preference profile** (extend `buildProfile`/`libraryAnalysis`): today `analyzeLibraryFacets` skips unrated items, so membership alone contributes nothing. Add library + wishlist items as a **soft positive prior** (weaker than a real rating; wishlist weighted slightly above owned-library for a forward-looking feed). Doubles as the cold-start fix (wishlist-but-no-ratings users get a real profile).
2. **Widen the live candidate pool** (`discover/route.ts`): fetch 3–5 pages per source by popularity in parallel (not just page 1). Apply the **community floor** at the API layer (TMDB `vote_count.gte` + `vote_average` floor; RAWG threshold).
3. **Two-stage rank (B2 core):** cheap pre-score every candidate on what the list endpoint returns (`genre_ids` → tag facets via a TMDB genre-id map; `original_language` as a soft input) → take top ~40 → **hydrate** those via the detail path → `extractFacets` → run the **same `scoreCandidate`** from `discovery.ts` (reasons for free). Present **date-sorted** (release radar — chronological order stays), but the candidate *set* is taste-selected, not popularity-selected.
4. **Caching:** short-lived (~30–60 min) cache of the hydrated upcoming pool keyed by region + week so infinite scroll / revisits don't re-pay detail fetches.

**Open wrinkle:** TMDB list endpoints return numeric `genre_ids`, not names → need a small static TMDB genre-id→name map for the pre-score.

**Touch points:** `src/lib/libraryAnalysis.ts` (membership priors), `src/lib/discovery.ts` (profile build + expose a reusable scorer for live items), `src/app/api/discover/route.ts` (wide fetch + floor + two-stage rank + cache), TMDB genre map (new small module), `src/app/api/detail/route.ts` (hydration path reuse).

## Phase 4 — Data feature — ✅ COMPLETE (pending the user's visual review)

| ID | Status | Epic | Task | Pri | Urg | Est. | Notes |
|----|:--:|:--:|------|:--:|:--:|:--:|------|
| T22 | ✅ | F | Country setting on profile page — drives which release dates are pulled from DBs and updates streaming availability correctly | Med | Later | ~160k | Done. **Storage:** `users.country` (migration v5, applied live; `.bak-pre-v5-20260616`); `getUserCountry` (stored ?? US) + `getStoredCountry` (raw, null=unset). **Settings:** Region section with a curated `COUNTRIES` picker; on first visit the client `detectCountry()` (navigator.language → timezone → US) auto-detects + persists via `POST /api/settings`. **Region-aware merge (T22 core):** `normalize.ts` now exposes full `streamingByRegion` + `releaseDatesByRegion` (movies) maps from the data already in `raw_data`; `mergeLinks(links, type, region)` picks the user's country's streaming (best-effort fallback) + release date (strict country match, else primary). `mergeForCanonical` stays primary (canonical row unaffected). Threaded through detail/calendar/library routes; discovery/insights stay country-agnostic (global caches). **Discover timeline:** TMDB movie pull uses `&region=` + `release_date.gte/lte`. Verified live: a movie returns per-country dates (US/DE/GB/JP) + region streaming. tsc clean, 30 tests, 0 eslint errors. **Not visually verified.** |

## Phase 5 — Go-live (only once features + architecture are stable)

| ID | Status | Epic | Task | Pri | Urg | Est. | Notes |
|----|:--:|:--:|------|:--:|:--:|:--:|------|
| T19 | ✅ | E | **Productionization readiness** review → improvements doc. Two sub-sections: **(a) Android app / Play Store**, **(b) public website** | High | Later | ~150k | *Pending review (merged, was T19+T20). Done as **[IMPROVEMENTS.md](IMPROVEMENTS.md) Part IV** — 16 findings (P1–P16), website-first per user choice (2026-06-18) + an Android PWA/TWA section. Headline: the app is **single-node/single-disk/always-on-Node only** — `better-sqlite3` + local `data/rr.db` rules out serverless & multi-instance (README's "Deploy on Vercel" is wrong); **P1** (pick hosting model) gates most others. 🔴: P1 (SQLite single-node), P2 (in-memory caches assume 1 process, some unbounded), P3 (JWT_SECRET hardcoded fallback → forgeable sessions), P4 (no Dockerfile/standalone/runbook), P5 (no backup/restore). 🟡: P6 (sync runs long in-request → timeouts), P7 (no rate limiting → third-party quota/cost abuse), P8 (no fetch timeout/retry), P9 (console-only, no health/error tracking), P10 (no config validation), P11 (native `<img>`), P12 (no SEO), P14 (no PWA manifest/SW), P15 (asset links). Forward-flagged to T21: P3, P7, plaintext OAuth tokens at rest, RAWG bcrypt path. Recommended order + T21 cross-refs in the doc. |
| T21 | ✅ | E | **Security analysis** assuming public launch as Android app or website | High | Later | ~150k | *Pending review. Done as **[IMPROVEMENTS.md](IMPROVEMENTS.md) Part V** — 13 findings (S1–S13). **Fundamentals sound**: parameterized SQL (no SQLi), no `dangerouslySetInnerHTML`/`eval` (minimal XSS), Steam OpenID properly verified, `/me` leaks no tokens, cookie `httpOnly`+`lax`+`secure`. 🔴: S1 (account-linking trusts unsigned `state.userId` / Steam `?link=` — not session-bound, no nonce), S2 (OAuth tokens plaintext at rest), S3 (no rate limiting — RAWG password brute-force + key-proxy abuse, = P7). 🟡: S4 (JWT unrevocable, 30d), S5 (RAWG stores pointless+crackable bcrypt of password), S6 (no security headers/CSP), S7 (watchlist DELETE missing ownership check), S8 (no boundary schema validation), S9 (rawg error leak). 🟢: S10 (npm audit 2 moderate via Next/postcss — don't downgrade), S11 (JWT readable), S12 (unvalidated posterUrl reflected), S13 (IGDB string-interpolated query). **P3 already fixed.** Findings entered below as S1–S13. |

## Phase 6 — Go-live execution (apply the review findings)

Execution of the go-live review findings: **T19** productionization ([IMPROVEMENTS.md](IMPROVEMENTS.md) Part IV, `P#`) + **T21** security ([Part V](IMPROVEMENTS.md), `S#`). Both reviews are ✅ done; execute together as one prioritized pass (mirrors Phase 1 audits → Phase 1.5 execution). Epic **G = Foundations/tech-debt**.

> **✅ P1 DECISION LOCKED (2026-06-18): Option A — single-instance + SQLite, hosted on [Railway](https://railway.app) (PaaS, push-to-deploy + persistent volume).** Postgres (Option B) shelved — only revisit if real multi-instance traffic ever arrives. This keeps the in-memory caches valid (P2 = just add eviction) and makes P4/P5 Railway-specific (see runbook). **P3 already applied.** Hosting split: the old shared-hosting package stays for **domain + DNS (+ email if used)**; Railway runs the app only (it's not a registrar and hosts no email).

### ▶ Launch runbook — Railway (the concrete steps to go live)

Ordered checklist; each step maps to the P#/S# findings in the tables below. **Stages 1–3 = a working private site; Stages 4–5 = required before sharing it publicly.**

> **✅ UNBLOCKED (2026-07-12): app back online.** Both blockers cleared: (1) the 512 MB **OOM crash-loop** → fixed by upgrading Railway **Trial → Hobby** (~8 GB); (2) a **stale-commit build failure** → Railway kept rebuilding the old `5caf4bc` (pre-lazy-JWT commit) via manual *Redeploy* (Redeploy rebuilds that row's commit, not `main`'s tip; its AI Diagnosis panel pattern-matched the old bug and is misleading) → fixed by deploying the current `cce0183`. Current `main` builds clean under Turbopack with no `JWT_SECRET`. **Longer-term:** the OOM root cause is now addressed in code — **P6** (time-budgeted, resumable sync; done 2026-07-12) + **P2** (bounded caches; done). The RAM upgrade remains as headroom, no longer the only thing keeping the box alive.

**Prereqs:** [x] repo pushed to GitHub (`Mlysign/fandex` — renamed from `releaseradar` 2026-07-15; GitHub redirects the old URL, Railway source re-linked) · [x] Railway account.

**Stage 1 — Code prep (in repo)** → P4/P10/P3 ✅ done
- [x] `start` = `next start` (binds Railway's `$PORT`).
- [x] `output: "standalone"` + multi-stage **Dockerfile**. → **P4**
- [x] Boot-time **config validation** + P3 JWT fail-fast. → **P10/P3**

**Stage 2 — Railway service** ✅ done
- [x] Project created → deploys from the GitHub repo.
- [x] **Volume** mounted at `/app/data`.
- [x] Env vars set (`DB_PATH=/app/data/rr.db`, `JWT_SECRET`, `TMDB_API_KEY`, `RAWG_API_KEY`, `STEAM_API_KEY`, `TWITCH_*`, `TRAKT_*`, `NEXT_PUBLIC_BASE_URL`, …).
- [ ] *(optional)* EU region — currently **US West**.
- [x] Deployed; build compiles `better-sqlite3`, migrations run, app boots `✓ Ready`.

**Stage 3 — Domain + OAuth (Fandex → fandex.org)** ✅ DONE 2026-07-15
> **DOMAIN BOUGHT 2026-07-13** on **domainssaubillig.de**. domainssaubillig's own DNS panel can't CNAME the apex + locks subdomains behind the Webhosting-Paket, so DNS was **moved to Cloudflare** (free; user already had CF for R2). See [[rebrand-fandex]].
- [x] **Connected `fandex.org` (+ `www`) to Railway** — added both as Custom Domains (hit the 2-domain plan limit); at domainssaubillig → Nameserver tab set NS to Cloudflare (`bristol`/`luke`); in Cloudflare DNS: apex+www CNAME → the Railway targets + the two `_railway-verify` TXTs, all **DNS-only / grey-cloud** so Railway issues its own TLS. HTTPS live, `/api/health` = ok.
- [x] `NEXT_PUBLIC_BASE_URL=https://fandex.org` was already set; **fixed `TRAKT_REDIRECT_URI`** (was a broken partial `fandex.org` → now `https://fandex.org/api/auth/trakt/callback`) → redeployed.
- [x] **Trakt** redirect URI registered (Trakt's dev page **moved** to app.trakt.tv → Einstellungen → Apps → API-Anwendungen; old `trakt.tv/oauth/applications` 404s). **Steam + TMDB need nothing** — their callbacks derive from `NEXT_PUBLIC_BASE_URL` at runtime (no allowlist). Corrects the old "re-register at all three" note.
- [x] **Verified:** `https://fandex.org` loads with Fandex branding + valid cert; **Trakt login round-trip confirmed** by user.

**Stage 4 — Data + backups** → P5
- [x] Data loaded via **Sync** from connected providers. (Local `rr.db` migration not needed — synced fresh.) ✅ **Backfilled 2026-07-15 after the Trakt 100-cap fix: movies 100→899, shows 100→273 (auto-sync on dashboard load); Miyazaki Insights 3→11 rated, Spirited Away now logged. DB 84→249 MB.**
- [x] **Litestream** replicating `/app/data/rr.db` → the Railway bucket, **restore drill done 2026-07-13** (see P5). [ ] decommission the old Cloudflare R2 bucket (minor).
- [x] **Email:** `hello@fandex.org` → user's Gmail via **Cloudflare Email Routing** (2026-07-15); deleted the dead `*.fandex.org` + old `mail.fandex.org` MX.

**Stage 5 — Before going public (hardening)** ✅ effectively done — see the P#/S# rows for detail
- [x] `/api/health` + structured logging → **P9** ✅ (endpoint live & verified on fandex.org — re-verified 2026-07-17: `200 {"status":"ok","db":"up"}`). ✅ Railway dashboard Healthcheck Path confirmed = `/api/health` by user (2026-07-17). **Fully closed.**
- [x] 🔴 security: **S1/S3/S4/S5/S7–S13** ✅ · **S2** ✅ **effectively closed (confirmed 2026-07-17)**: encrypt path is universal (`oauthConnect.ts` encrypts every (re)connect) + `decryptSecret` is plaintext-tolerant → zero functional risk. Prod `TOKEN_ENCRYPTION_KEY` is **provably set** (`key()` throws in prod if unset → a successful Trakt login couldn't happen; the recent Trakt login on fandex.org therefore both proves the key AND re-wrote the only sensitive token — Trakt's refresh — encrypted; tmdb/rawg/steam hold API keys/IDs, not OAuth secrets). `scripts/encrypt-tokens.ts` remains as an idempotent dry-run/backfill for any pre-S2 straggler (needs the prod DB → run vs a pulled copy; not worth it given the above).
- [x] **Security headers (S6)** ✅ **enforced 2026-07-15-verified**: enforcing `Content-Security-Policy` live on fandex.org (`default-src 'self'; script-src 'self' 'unsafe-inline'; …`), Report-Only removed, HSTS present. (Old "main gap" note was stale.)

**Known follow-up bugs:**
- ~~Entrypoint `cannot restore, output path already exists` on restart~~ — **FIXED (cce0183):** restore now runs only when the volume has no local DB.
- ~~**Trakt sync capped every library at 100 items**~~ — **FIXED 2026-07-15 (commit `ecd2715`).** Trakt paginates `/sync/watched|ratings|watchlist` at 100/page; the old code fetched only page 1, so users with >100 watched/rated titles lost everything past 100 (movies AND shows both stuck at exactly 100) → Insights facet breakdowns (director/genre/studio) massively undercounted. New `traktGetAllPages()` follows `X-Pagination-Page-Count`. ✅ **Re-sync done 2026-07-15 — backfilled to 899 movies / 273 shows; verified Miyazaki 3→11 rated + Spirited Away logged.** See [[trakt-sync-completeness]].
- ~~**TMDB enrichment 429 swallow (sync hardening)**~~ — **FIXED 2026-07-15 (commit `6c3b905`).** (1) `http.ts` now honors 429 `Retry-After` (bounded ≤10s) and retries for idempotent GET/HEAD → the sync self-paces instead of dropping every rate-limited item's TMDB link; a too-long Retry-After still gives up (best-effort, one item fails not the whole sync). (2) `metadata/tmdb searchByTitle` resolves the id then fetches **full detail** (search results carry no credits) → name-matched Trakt items still get director/cast. (3) trakt+letterboxd `enrich` now `log.warn("enrich_failed", …)` instead of a silent `catch {}` → rate-limit/outage gaps are visible in the Railway logs. 4 new http tests → 114; tsc/eslint(0)/build green. (Verified 0 enrichment gap on the live 899-movie library, so this is defensive headroom for a larger library / public influx.)

| ID | Status | Epic | Task | Pri | Urg | Est. | Notes |
|----|:--:|:--:|------|:--:|:--:|:--:|------|
| P1 | 🔵 | G | **Hosting-model decision + deploy** — ✅ **decided: Option A (single-instance + SQLite) on Railway** (2026-06-18); deploy = the runbook above | 🔴 High | Now | ~120k | Decision done; execution tracked via the runbook + P4/P5. Postgres (B) shelved. |
| P2 | ✅ | G | In-memory module caches assume one long-lived process — add **bounded eviction/TTL** (single-instance) or move to **Redis/shared** (if P1b); some are unbounded (`_personIdCache`, `_tmdbCompanyCache`, `_keywordCache`) | 🔴 High | Soon | ~90k | **Done 2026-07-12:** new dep-free `src/lib/boundedCache.ts` — `BoundedCache<K,V>` (LRU size cap + optional TTL, Map-like API incl. null-sentinel `has()/get()`). Swapped all 8 growing module caches: `_profileCache`/`_cache`(libraryAnalysis) capped 500 (per-user, sig-invalidated); `_personIdCache`/`_rawgEntityCache`/`_tmdbCompanyCache`/`_keywordCache` capped 5000, `_personCache` 2000 (id lookups, no TTL); `_facetCache` LRU 3000 (replaces the crude `size>3000→clear()` dump); `_feedCache` 500 + 45-min TTL moved into the cache. 6 new tests (LRU eviction, cap, null-sentinel, TTL) → **36 total**. tsc clean, 0 eslint errors. Companion to P6. |
| P3 | ✅ | G | **`JWT_SECRET` fail-fast** — throw at boot in production when unset instead of the hardcoded `"change-this-in-production-rr2"` fallback (forgeable sessions) | 🔴 High | Now | ~20k | Done 2026-06-18: `session.ts` `loadSecret()` throws in prod when `JWT_SECRET` unset; dev/test keep a clearly-named insecure fallback so `npm run dev`/tests work. tsc clean, 30 tests. Independent of P1. Also a T21 item. |
| P4 | 🔵 | G | Deployment artifact — **Railway service** (Nixpacks auto-detect, or a multi-stage Dockerfile + `output: "standalone"`) + **mounted volume** at `/app/data` (`DB_PATH`) + env vars + replace boilerplate README | 🔴 High | Soon | ~90k | **Done 2026-06-18:** `next.config.ts` `output: "standalone"` + `outputFileTracingIncludes` for the `better-sqlite3` `.node` binary; multi-stage **`Dockerfile`** (bookworm-slim, build toolchain in builder, non-root runner, `VOLUME /app/data`, `DB_PATH` env, `node server.js`); **`.dockerignore`**. Verified: `npm run build` clean, `.next/standalone/server.js` + the traced `better_sqlite3.node` both present, 30 tests. **README** rewritten. **DEPLOYED LIVE on Railway 2026-06-18** — app boots clean (`✓ Ready`, env vars set, volume mounted at `/app/data`). Build-fix trail: removed Docker `VOLUME` (Railway-rejected), run as root for the mounted volume, lazy `JWT_SECRET` (eager check broke `next build`), `ca-certificates` in runner (Litestream TLS), OAuth redirects use `NEXT_PUBLIC_BASE_URL` not `req.url` (proxy resolves to `0.0.0.0:8080`). **Login confirmed working (Trakt).** **⛔ Now BLOCKED:** app OOM crash-loops on Railway's **512 MB Trial** (`signal: killed`) — needs Hobby upgrade (see blocker callout above + P6). Custom domain optional. |
| P5 | ✅ | G | **Backup / restore** — **Litestream** replicating `/app/data/rr.db` → S3-compatible bucket + tested restore | 🔴 High | Soon | ~70k | **✅ RESTORE DRILL DONE 2026-07-13:** user confirmed the Railway bucket holds recent Litestream objects (replication live — the earlier "empty bucket during OOM" concern is resolved) + ran a full restore-to-scratch via Docker (`litestream/litestream:0.3.13`, `restore -o restore-test.db`) verified by new `scripts/verify-restore.mjs` (PRAGMA integrity_check = ok, sane row counts). Backups proven restorable end-to-end without touching the live volume. **Remaining (minor):** decommission the old Cloudflare R2 bucket. **DR caveat stands:** same-platform (Railway) backup won't survive a *total* Railway loss — covers volume corruption / bad deploys / wipes. Earlier setup notes: | Litestream set up via opt-in `docker-entrypoint.sh` + `litestream.yml` + `.gitattributes` LF guard. **Switched target Cloudflare R2 → the Railway bucket** (2026-06-18, cce0183) to keep one platform — uses the `AWS_*` creds the bucket injects; entrypoint keys on `AWS_S3_BUCKET_NAME` and restores only when the volume has no DB (fixed the restart restore error). First confirmed replicating to R2 (59 MB WAL); Railway bucket shows **empty** so far because the app is OOM-crash-looping (hasn't sustained a replication). **DR caveat:** same-platform backup won't survive a total Railway loss (covers volume corruption / bad deploys / wipes). **Remaining:** confirm replication to the Railway bucket after the RAM upgrade; one-time restore drill; decommission the old R2 bucket + Cloudflare. |
| P6 | ✅ | G | Move provider **sync to a background job/queue** (or server-side time budget + streamed progress) — in-request sync of ~1,700 items OOM'd the 512 MB container | 🔴 High | Soon | ~150k | **RISK REALIZED 2026-06-18:** the full Trakt+Steam+TMDB sync (~1,700 items in one request) + the 1,700-item feed/insights spiked memory past Railway's 512 MB → `signal: killed`. **Done 2026-07-12 (time-budget path):** `runSync`/`orchestrateSync`/`providerQueue` in `src/lib/sync` process whole providers only until a wall-clock budget (`SYNC_BUDGET_MS`, default 25s) is spent, then return `{done,remaining}`; `/api/sync` accepts `{provider}` or a `{providers:[…]}` resume subset; new client driver `src/lib/syncClient.ts` `syncToCompletion()` re-invokes until `done` (guard-capped), wired into dashboard/library/settings. No single request does the whole job → per-request latency bounded + memory reclaimed between calls. Pairs with **P2** (bounded caches, done). 14 tests (budget/resume/queue + client loop) → 82; tsc/eslint(0)/build green. **Follow-up:** granularity is per-provider (one very large provider still syncs in a single window); mid-provider chunking + true streamed progress (NDJSON/SSE) if a single provider ever dominates. Not live-verified (needs a real multi-provider sync under memory watch). |
| P7 | ✅ | G | **Rate limiting / abuse protection** — per-IP/per-user throttle (middleware or platform WAF); gated routes proxy third-party APIs with your keys → quota/cost exposure | 🟡 Med | Soon | ~80k | **Done 2026-07-12 (= S3).** In-process fixed-window limiter `src/lib/rateLimit.ts` (reuses `BoundedCache`, single-instance per P1). `withUser` enforces 300/min/user across all authed routes (key-proxy abuse cap); `/api/auth/rawg` enforces 5/min/IP (brute-force). 4 tests. |
| P8 | ✅ | G | Third-party fetch **timeouts + bounded retries + per-source failure isolation** (`AbortSignal.timeout`); a hung upstream currently blocks the request/sync | 🟡 Med | Soon | ~70k | **Done 2026-07-12:** new `src/lib/http.ts` `httpFetch` — drop-in `fetch` superset adding a 20s `AbortSignal.timeout` + bounded backoff retries for idempotent GET/HEAD only (never POST; not 429). 5 tests. Converted **every** server-side third-party fetch: adapters `trakt`/`tmdb`/`rawg`/`steam`/`igdb`/`omdb`/`letterboxd`, discovery fetchers `tagDiscover`/`discoverFeed`/`facetDetail`, and the `search`/`discover` API routes (~60 sites). Client→own-API fetches deliberately left as plain `fetch` (same-origin, no retry on writes). Per-source isolation already existed (each adapter/sync step try/catches). tsc/55 tests/eslint/build green. Not live-verified (only manifests under a slow/failing upstream). |
| P9 | ✅ | G | **Observability** — `/api/health` liveness/readiness endpoint + error tracker (Sentry) + structured request logging (esp. the `withUser` 500 path) | 🟡 Med | Soon | ~60k | **Sentry declined by user 2026-07-13** (no new third-party account) — structured JSON logs (`level`/event fields) are searchable in Railway's own log viewer, which covers alerting-lite for a solo project; Sentry can be bolted onto `log.error`/the withUser funnel later if wanted. Health + full structured logging done (see below), so P9 is ✅ for launch. | **Health endpoint done 2026-07-12:** new `src/app/api/health/route.ts` — unauthenticated GET, cheap `SELECT 1` DB probe, `200 {status:"ok"}` when ready / `503 {status:"degraded"}` when the DB probe fails; leaks nothing sensitive. Wire it as the Railway healthcheck path in the dashboard. **Structured logging done 2026-07-13:** new `src/lib/logger.ts` — dependency-free `log.{info,warn,error}(msg, fields)` emitting one JSON line per event (level/time/msg + fields) to stdout/stderr for Railway log parsing, plus `errorFields(e)` to normalize thrown values. Wired into `withUser`: the 500 funnel logs `api_error` (method/path/userId/error/stack); validation 400s log `api_bad_request` at warn. 3 tests → 104. **Full log migration done 2026-07-13:** every server-side `console.*` now goes through the structured logger (withUser funnel + watchlist/library write-backs + sync + auth/oauth/tmdb/steam/rawg errors + persist/refresh/discover) as JSON events with typed fields; only `config.ts`'s boot env-var warnings stay human-readable on purpose. **Still open:** Sentry/error tracker (needs a DSN from the user) → keeps P9 🔵. |
| P10 | ✅ | G | **Config validation at boot** — single validated config module that throws listing every missing required env var (folds in P3) | 🟡 Med | Soon | ~40k | **Done 2026-06-18:** `src/lib/config.ts` `validateEnv()` (required: JWT_SECRET/TMDB/RAWG/NEXT_PUBLIC_BASE_URL → throw in prod, listing all missing at once; provider keys → warn). Run once at boot via new `src/instrumentation.ts` `register()` (Node runtime only). session.ts P3 check kept as defense-in-depth. Build + 30 tests clean. |
| P11 | ✅ | G | Adopt **`next/image`** for posters (remotePatterns already set) — optimization/lazy/bandwidth; native `<img>` today (also **U7**) | 🟡 Med | Later | ~60k | **Done 2026-07-13 (pending browser review):** converted **11 of 12** `<img>` → `next/image`. Two patterns: `fill`+`sizes` for the boxed cover images (PosterCard, ListCard, CalendarView cell bg, Tooltip [wrapped in a `relative h-32` box], SearchModal, FacetAutocomplete, MediaGallery thumb, LowerSections cast — added `relative` to sized boxes lacking it); explicit `width`/`height` for the fixed-size inline ones (CalendarView 32×24 poster, LowerSections 20×20 streaming logo, insights/facet 112×160 person photo). onError→placeholder fallbacks preserved (graceful-degrade if the optimizer ever fails). **Left the MediaGallery HERO as a documented `<img>`** (eslint-disabled): remote gallery art has no known intrinsic size + it sizes to natural aspect capped at 460px — pinning a next/image aspect would shift layout, and it's one image, not a bandwidth hotspot. **Config:** added `images.igdb.com` to `next.config.ts` remotePatterns — it was in S12's sanitizer allowlist but MISSING here, so an IGDB poster would've made next/image *throw* at render (now aligned; hosts = tmdb/rawg/igdb/steamstatic). **Prod:** verified `sharp` is traced into `.next/standalone` (image optimizer works on the linux Docker build). tsc/0-eslint-errors/101 tests/build green. eslint no-img-element warnings 326→314. **Not visually verified** — poster/thumbnail layouts across Discover/Library/Wishlist/Calendar/Detail need your Chrome pass; watch for any crop/aspect shifts. |
| P12 | ✅ | G | **SEO primitives** — `robots.txt`, sitemap, `metadata`/Open Graph, canonical URLs (website) | 🟡 Med | Later | ~40k | **Done 2026-07-13:** new `src/lib/baseUrl.ts` (`BASE_URL` from `NEXT_PUBLIC_BASE_URL`, localhost fallback, trailing-slash-trimmed) + `src/app/robots.ts` (allow `/`, disallow `/api/` + all authed app routes since they're client-rendered shells to a crawler; sitemap+host) + `src/app/sitemap.ts` (just `/` — only public indexable page; per-item SSR pages are a P13 follow-up) + `src/app/opengraph-image.tsx` (dynamic 1200×630 `next/og` card, auto-wired into OG+Twitter; renders a valid 69KB PNG at build). Root `layout.tsx` metadata enriched: `metadataBase`, title default+template (`%s · ReleaseRadar`), description, keywords, openGraph, twitter `summary_large_image`, robots index/follow. Both `/robots.txt` + `/sitemap.xml` prerender static; verified generated content. tsc/eslint(0)/build green. **Not visually reviewed** (OG image design). Canonical: skipped a global one (would wrongly canonicalize authed pages to `/`; landing self-canonicals) — proper per-page canonicals need P13 SSR. |
| P13 | ✅ | G | **SSR + clean route URLs** for shareable/crawlable detail pages (`/item/[id]` vs client-built query params); all pages are `"use client"` + fetch-on-mount | 🟢 Low | Later | ~150k | **Done 2026-07-16 (`6aea1c1`)** — shipped **soft-launched** (see P13b). Public SSR page at **`/{type}/{uuid}/{slug}`** (`src/app/[type]/[id]/[slug]/page.tsx`): UUID = sole identity, slug cosmetic → a wrong/stale slug **308**s to canonical, so shared links never rot. Security boundary = `src/lib/detail/publicDetail.ts`: `PublicItem` = `{id,type}` + exactly `mergeLinks`' return, and mergeLinks can't read `user_library`/`user_watchlist` → rating/review/libraryStatus/platformSources **cannot** leak (compiler-enforced, not discipline). Verified vs a real rated item: 0 occurrences of the owner's rating in 28KB HTML. Does **no live provider calls** (unlike `/api/detail`) — crawlers walking ~2,500 pages would blow TMDB/IGDB rate limits; stored-only = a few SQLite reads. `robots.ts` allows `/movie/ /show/ /game/`; `/item` stays disallowed (authed view, same titles → duplicate content). **Gotcha 1:** `sitemap.ts` is a Route Handler Next **caches by default** (built `○ Static`) — it reads SQLite and Railway doesn't mount the volume during `next build`, so it would've shipped a sitemap of only `/` forever → now `force-dynamic`. **Gotcha 2:** root-level `[type]` makes ANY 3-segment path look like a page to `@next/next/no-html-link-for-pages` → 4 NEW lint errors in untouched files (OAuth `<a>` in `page.tsx`/`settings`); `npm run lint` gates CI which gates Railway deploys, so this would've blocked the next deploy. No real conflict (static `/api` wins — `/api/auth/trakt` still 307s); rule disabled at those 4 sites. **Not done:** no personal overlay for a logged-in viewer (rating/wishlist still only on `/item`); nothing internally links to these URLs (sitemap is the only discovery path). |
| P13b | ⬜ | G | **Turn on indexing** for the public item pages — flip `PUBLIC_ITEMS_INDEXABLE` → `true` | 🟡 Med | When ready | ~5k | **One-line change**, `src/lib/publicUrl.ts`. P13 shipped **soft-launched on purpose**: pages are publicly readable and unfurl correctly when shared (OG tags work — unfurlers ignore `robots`), but every page sends **`noindex`** and `sitemap.xml` lists **only `/`**. Reason: the catalog is derived from the owner's library, so indexing + enumerating it publishes *what they watch/play* (titles, never ratings). Flipping the flag drops the noindex AND puts all ~2,500 items in the sitemap — nothing else to change. **Do NOT "fix" this by disallowing `/movie/` etc. in robots.txt:** a crawler must be able to FETCH a page to SEE its noindex; a Disallow hides the tag and can leave URL-only entries indexed via external links. Decide first: index the whole library, or a curated subset (e.g. rated-only). |
| P14 | ✅ | G | **PWA manifest + service worker** (icons 192/512, `display: standalone`, HTTPS) — prerequisite for the Android TWA wrapper | 🟡 Med | Later | ~90k | **Done 2026-07-13:** `src/app/manifest.ts` (name/short_name/description/`start_url`/`display: standalone`/bg+theme `#0a0a0a`/icons) → served at `/manifest.webmanifest` + auto `<link rel=manifest>`. **Placeholder icons** generated by `scripts/gen-icons.mjs` (sharp rasterizes one SVG — a radar mark in the brand gradient — to `public/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `src/app/apple-icon.png`); re-run after swapping in real art. Minimal `public/sw.js` (skipWaiting/claim + pass-through fetch handler, no caching → no stale content; satisfies installability) registered by `ServiceWorkerRegister` (client, **prod-only**) mounted in layout. `themeColor` moved to the `viewport` export (Next convention). HTTPS via Railway. tsc/0-eslint/108 tests/build green; manifest body verified. **Not visually reviewed** (placeholder logo — swap for real brand art anytime). Unblocks P15/P16. |
| P15 | 🔵 | G | **Digital Asset Links** (`/.well-known/assetlinks.json`) + stable HTTPS origin for the Play Store TWA | 🟡 Med | Later | ~25k | **Serving infra done 2026-07-13:** `src/app/.well-known/assetlinks.json/route.ts` — env-driven GET (Next registers the dot-dir route fine) that emits the `delegate_permission/common.handle_all_urls` entry from `TWA_PACKAGE_NAME` + `TWA_CERT_FINGERPRINT` (both added to `config.ts` as optional), or an empty `[]` until set. **BLOCKED on the user:** build/sign the TWA (Bubblewrap/PWABuilder) → gives the package name + signing-cert SHA-256 → set the two env vars on Railway → verify at `/.well-known/assetlinks.json`. Stays 🔵 until the real values are live. |
| P16 | ⬜ | G | Verify **OAuth + cookie flow inside the TWA** — re-register prod redirect URIs per provider; test webview behavior + deep-link return / `sameSite` | 🟢 Low | Later | ~60k | Android. |
| P17 | ✅ | G | **Public facet pages** (provider-sourced, session-aware) — the reframed "P13b" | 🔴 High | Now | ~400k+ | **DONE.** Built 2026-07-17 (all 5 slices; `tsc` clean, 195 tests pass, 0 lint errors, `next build` green), deployed via `aecba6e`, live on fandex.org. **Live provider verification done 2026-07-18** (Claude drove `/person/christopher-nolan`, `/tag/sci-fi`, `/studio/pixar` on the production site — real TMDB/RAWG data, correct sorting, zero app console errors). **UX/taste pass deferred to H1 on purpose (user's call, 2026-07-18)** — not a blocker; closed as done. Files: `facetUrl.ts`(+test), `detail/publicFacetDetail.ts`(+test), `api/facet` (public paging), `api/facet/mine` (authed overlay), `components/facet/PublicFacetView.tsx`, `components/facet/facetSsr.tsx`, `app/{person,tag,studio}/[slug]/page.tsx`; `buildFacetHref` rewired, `/insights/facet`→308, robots updated. **v1 limits:** bounded (not infinite) pool pagination; name-collision→most-popular; thin-persist write amplification. Static-prefix routes cleared the P13 `[type]` lint trap (0 new errors). **Original plan below.** User's P13b concern was really that internal nav points at authed pages. **Audit:** item pages (`buildItemHref`→`/{type}/{uuid}/{slug}`, session-aware `ItemView`) + `/discover` (anon-tolerant API, readable URL) are **already public + linked** ✅. **Facet pages are the only gap.** Replaces authed query-param `/insights/facet?…` with public root-level **`/person/{slug}` · `/tag/{slug}` · `/studio/{slug}`** (slug↔key lossless: keys have no hyphens → spaces↔hyphens; no uuid/redirect table). **LOCKED design decisions:** (1) combined roles, role badged per work (TMDB combined_credits); (2) **provider-sourced lists** (TMDB/RAWG), NOT `itemsWithFacet` — so id resolution moves to provider name-search (TMDB person/company search exists; **RAWG dev/pub search = new**); (3) `/studio` folds studio+dev+publisher; (4) tags **paginated+sorted** (not "all" — a genre = thousands); (5) linking = **persist-at-fetch (H2b thin-write, browsed=1)** so provider titles get uuids; (6) **indexing stays OFF** (`PUBLIC_ITEMS_INDEXABLE`, that's P13b, deferred). Architecture mirrors item page: public SSR shell (`PublicFacetPayload` = compile-enforced leak boundary) + personal-overlay client island (your-avg/delta/library badges when logged in). Full plan → memory `p17-public-facet-pages.md`. **Slices:** 1 `facetUrl.ts`+tests · 2 `buildPublicFacetDetail` · 3 routes+`PublicFacetView`+island · 4 rewire `buildFacetHref`/308-redirect `/insights/facet`/robots · 5 tests+tsc. |

**Note on P13b:** the indexing flip stays a standalone follow-up. **Decision locked 2026-07-18: index the whole library** (not a curated/rated-only subset) — see TASKS.md for the still-open one-line execution step.

**Security findings (T21, [IMPROVEMENTS.md](IMPROVEMENTS.md) Part V).** Recommended order: S2+S5 → S1 → S3 → S6+S4 → S7+S8 → polish.

| ID | Status | Epic | Task | Pri | Urg | Est. | Notes |
|----|:--:|:--:|------|:--:|:--:|:--:|------|
| S1 | ✅ | G | **Bind account-linking to the session** — drop trust in unsigned `state.userId` (Trakt/TMDB/Letterboxd) + Steam `?link=`; derive link target from the session, add a random `state` **nonce** in an httpOnly cookie verified on callback | 🔴 High | Soon | ~120k | **Done 2026-07-12:** new `src/lib/oauthState.ts` (`createOAuthNonce`/`setOAuthStateCookie`/`verifyOAuthState` constant-time/`clearOAuthState`; single-use httpOnly `rr2_oauth_state` cookie, sameSite=lax, 10-min TTL). **Link target now derived from `getSession()`, never client state** in `handleOAuthCallback` (trakt/letterboxd) + steam & tmdb callbacks. **CSRF nonce** round-tripped via `state` (trakt/letterboxd/steam) or bound to the single-use `request_token` (tmdb, which has no `state` param); every callback verifies + clears the cookie on all exits. Removed the forgeable `state.userId` blob and Steam `?link=<userId>`. 8 tests → 68; tsc/eslint(0 err)/build green. Not live-verified (needs a real provider round-trip). |
| S2 | 🔵 | G | **Encrypt OAuth tokens at rest** — app-level AEAD (key from env/KMS, ≠ `JWT_SECRET`); `access_token`/`refresh_token` currently plaintext in `user_identities` | 🔴 High | Soon | ~110k | **Code done 2026-07-12 (NOT pushed — needs env var first):** new `src/lib/crypto.ts` (AES-256-GCM, key = SHA-256 of `TOKEN_ENCRYPTION_KEY`, `enc:1:` prefix; `decryptSecret` passes legacy plaintext through so rollout is non-breaking). Encrypt at every write (`oauthConnect` INSERT+UPDATE, `rawg`/`tmdb` callbacks, `trakt`/`letterboxd` refresh UPDATEs), decrypt at every read (`trakt`/`tmdb`/`rawg`/`letterboxd` `context()` + `search` route). `TOKEN_ENCRYPTION_KEY` added to `config.ts` required-in-prod. One-off `scripts/encrypt-tokens.ts` (idempotent, `--dry-run`) to re-encrypt existing plaintext rows. 5 tests → 60; tsc/eslint/build green. **ROLLOUT (must order): (1) user sets `TOKEN_ENCRYPTION_KEY` on Railway (≠ JWT_SECRET) BEFORE deploy or it crash-loops; (2) push → deploy; (3) encrypt live rows via reconnect or the script over the live DB.** |
| S3 | ✅ | G | **Rate limiting** — per-IP + per-account; strictest on `/api/auth/rawg` (password brute-force); also caps key-proxy abuse | 🔴 High | Soon | ~80k | **Done 2026-07-12 (= P7, one implementation).** `src/lib/rateLimit.ts` fixed-window in-process limiter (`rateLimit`/`enforceRateLimit`/`clientIp`, X-Forwarded-For behind Railway's proxy). Per-account 300/min via `withUser`; per-IP 5/min on `/api/auth/rawg`. tsc/50 tests/build green. **Not live-verified** (would show as 429s under a flood). |
| S4 | ✅ | G | **Session revocation** — shorter JWT expiry + refresh, or a server-side session/token-version store; today logout/disconnect don't invalidate a 30d token | 🟡 Med | Soon | ~90k | **Done 2026-07-12 (token-version store):** migration 6 adds `users.session_epoch`; every JWT is stamped with the epoch at sign time and `getSession()` rejects a token whose stamp is behind the user's current epoch. **logout** now bumps the epoch (revokes the 30d cookie server-side + all other devices) then clears the cookie; **disconnect** bumps too (kills any session minted from the removed identity) and re-issues the acting device's cookie against a still-connected identity so it isn't logged out. Legacy tokens carry no epoch → read as 0 → valid until the first bump (non-breaking). 5 tests (accept/reject-after-bump/re-issue/multi-bump/legacy) → 87; tsc/eslint(0)/build green. Kept the 30d expiry (now revocable) rather than adding a refresh-token flow. |
| S5 | ✅ | G | **Stop storing the RAWG password hash** — `bcrypt(password)` in `metadata` is unused + offline-crackable; keep only the token (encrypted per S2); fix the misleading "encrypted" UI copy | 🟡 Med | Soon | ~30k | **Done 2026-07-12:** confirmed `passwordHash` was written but never read anywhere → removed the `bcrypt.hash` + `bcryptjs` import; `metadata` is now just `{ slug }`. Password is used once for `rawgLogin()` and never persisted. Corrected the two false "password is encrypted before storage" copy lines (landing `page.tsx` + `settings/page.tsx`) to "used only to sign in… never stored — only the session token is kept." (`bcryptjs` is now an unused dep — optional `npm uninstall` later.) |
| S6 | ✅ | G | **Security headers** — CSP (allow poster CDN hosts), HSTS, X-Content-Type-Options, X-Frame-Options/`frame-ancestors`, Referrer-Policy via `next.config` `headers()`/middleware | 🟡 Med | Soon | ~50k | **ENFORCED 2026-07-13:** after validating the Report-Only policy on the live app (user confirmed no `[Report Only]` violations across landing/discover/detail-with-trailer/library/insights — the only console noise was the Grammarly extension + dead-Steam-CDN image 404s, both unrelated), `CSP_RESOURCE_POLICY` is now the **enforcing** `Content-Security-Policy` in production; dev keeps only `frame-ancestors 'none'` (the full policy blocks Next HMR/eval). Kept `report-uri /api/csp-report` in the enforced policy so anything a future change adds that gets blocked is logged, not silently broken. Rollout history below. **Report-Only CSP added 2026-07-13:** the full resource-restricting policy (`CSP_RESOURCE_POLICY` in `next.config.ts`) now ships as **`Content-Security-Policy-Report-Only`** (production-only) alongside the still-enforced `frame-ancestors 'none'`. Report-Only blocks nothing → zero blank-screen risk; it logs violations to the browser console. Directives: `default-src 'self'`; `script-src`/`style-src 'self' 'unsafe-inline'` (Next inline bootstrap + inline `style=`/next-font); `img-src` = self+data+blob+all poster CDNs (tmdb/rawg/igdb/steamstatic — the detail hero `<img>` loads raw); `connect-src 'self'`; `frame-src youtube` (trailer); `base-uri`/`form-action 'self'`; `object-src 'none'`. Verified header emission via `headers()` eval; build green. **Violation sink added 2026-07-13:** the Report-Only policy carries `report-uri /api/csp-report` → new public, IP-rate-limited `app/api/csp-report/route.ts` logs each violation via the P9 structured logger (`log.warn(`"csp_violation"`, …)`), so the rollout can be validated **from the Railway logs**, not just the browser console. Report parsing is a tested pure fn (`src/lib/cspReport.ts`, handles both report-uri + report-to shapes, truncates untrusted strings). **TO FINISH (flip to enforce): after a deploy, exercise the app (Discover/Detail-with-trailer/Insights/Library) and check the logs for `csp_violation` entries; if none, move `CSP_RESOURCE_POLICY` to the enforcing `Content-Security-Policy` header (replace the frame-ancestors-only value) and delete the Report-Only one + its report-uri.** Stays 🔵 until enforced. **Earlier partial 2026-07-12:** `next.config.ts` `headers()` ships the non-breaking set on `/:path*` — `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security` (2y+includeSubDomains), `Permissions-Policy` (camera/mic/geo/browsing-topics off; autoplay/encrypted-media LEFT ON for the YouTube trailer embed), and a CSP carrying only `frame-ancestors 'none'` (clickjacking, restricts no resource loads). Build passes. **Deferred (needs live browser verify):** the resource-restricting CSP (`script-src`/`style-src`/`img-src` w/ the poster CDN hosts + youtube `frame-src`) — a wrong value blank-screens the app; do it in a hands-on session, pairs with **P11** (`next/image`). → keeps S6 🔵. |
| S7 | ✅ | G | **Ownership check on `watchlist` DELETE** + systematic authz pass (every route scopes by `session.userId` before write-back) | 🟡 Med | Soon | ~50k | **Done 2026-07-12:** `watchlist` DELETE now validates `mediaItemId` (string, 400 if missing) and confirms it's on THIS user's `user_watchlist` (`SELECT 1 … WHERE user_id=? AND media_item_id=?`) BEFORE the platform write-back loop — not-owned → idempotent `{ok:true}` no-op, so a caller can't drive removals (with their own tokens) for items they never added. Local DB removal was already user-scoped. **Authz sweep done 2026-07-13:** audited every API route. Found the **same gap on `library` DELETE** (platform `removeFromLibrary` loop ran before any ownership check) → added the matching `user_library` ownership guard. Confirmed all other platform writes are self-scoped (`watchlist`/`library` POST are own-actions) and all user-data reads scope by `session.userId` (calendar `uw.user_id=?`, detail `user_library/user_watchlist … user_id=?`, insights via `buildInsights(session.userId)`, library/watchlist/settings); gated catalog/browse routes (discover/facets/search) return non-user-specific data. No other gaps. |
| S8 | ✅ | G | **Boundary schema validation** (zod) on every API route body → 400 on malformed input instead of 500/type-confusion | 🟡 Med | Later | ~80k | **Done 2026-07-13:** added `zod` dep + `src/lib/validate.ts` (`parseJsonBody(req, schema, {allowEmpty?})` → `BadRequestError`; `allowEmpty` preserves the old `req.json().catch(()=>({}))` tolerance for DELETE/refine bodies) + `src/lib/schemas.ts` (shared enums `zMediaType`/`zSource`/`zFacetRole`/`zSortKey`/`zIds` + per-route body schemas). `withUser` maps `BadRequestError`→400 (was 500), so any wrapped route just `throw`s via the parser; non-withUser `auth/rawg` catches it inline. Wired into **all 9 JSON-body routes**: watchlist POST/DELETE, library POST/DELETE, sync, settings, disconnect, auth/rawg, discover find/fetch-more/facet-fetch. Schemas mirror the old hand-typed bodies (lenient where routes were lenient; tightened rating 0–10 + enums). Unknown keys stripped. GET query-param routes left as-is (strings, already coerced — no type-confusion surface). 14 tests → **74 total**. tsc/eslint(0 err)/build green. |
| S9 | ✅ | G | **Generic error on `/api/auth/rawg`** — stop returning upstream `e.message` to the client; log server-side | 🟢 Low | Later | ~20k | **Done 2026-07-12:** the RAWG login catch now `console.error`s the upstream error and returns a fixed `"Invalid RAWG credentials"` 401 (was `e.message || …`). |
| S10 | ✅ | G | **Dependency hygiene** — `npm audit` in CI + Dependabot/Renovate; adopt a clean Next patch for the postcss advisory (do NOT downgrade Next) | 🟢 Low | Later | ~30k | **Done 2026-07-13:** new `.github/workflows/ci.yml` (Node 22, matches Dockerfile) — `verify` job (tsc/lint/test/build; build gets dummy env to satisfy P10 config validation) + `audit` job (`npm audit --audit-level=high` → passes today since the known advisories are moderate; a new HIGH+ blocks merge). `.github/dependabot.yml` — weekly npm (minor/patch grouped) + github-actions updates. **postcss advisory (GHSA-qx2v-qp2m-jg93):** no clean Next patch exists yet — every Next version through 16.3.0-canary bundles the vulnerable postcss; npm's only "fix" is downgrading to next@9.3.3 (refused). It's moderate + **build-time only** (postcss CSS-stringify XSS, not a runtime surface). Documented as accepted in ci.yml; Dependabot will open the PR when Next ships a fix. Verified locally: audit-high exit 0, audit-moderate exit 1. Did NOT run `npm audit fix` (would downgrade Next). |
| S11 | ✅ | G | **Keep JWT payload minimal** — it's signed-not-encrypted (readable); never add email/tokens/PII | 🟢 Low | Later | ~10k | **Done 2026-07-12:** verified the `SessionUser` JWT payload is already minimal (userId/identityId/provider/displayName — no email/tokens/PII). Added a guardrail comment on the `SessionUser` type (`src/types/index.ts`) documenting that the JWT is signed-not-encrypted so nothing sensitive may be added. |
| S12 | ✅ | G | **Validate `posterUrl`** on `watchlist` POST — require `https://` on an allowed CDN host before storing/reflecting | 🟢 Low | Later | ~20k | **Done 2026-07-12:** new `src/lib/posterUrl.ts` `sanitizePosterUrl()` — accepts only `https:` on the trusted media-CDN hosts (`image.tmdb.org`/`media.rawg.io`/`images.igdb.com`/`*.steamstatic.com`, matching next.config `remotePatterns` + IGDB), else `null`. Applied in `watchlist` POST before persist/reflect. 4 tests (protocol/host/lookalike/junk). Pairs with S6 CSP `img-src`. |
| S13 | ✅ | G | **Harden the IGDB query builder** — stricter sanitization than the current `"`/`\` strip in `searchIgdbGames` | 🟢 Low | Later | ~25k | **Done 2026-07-12:** exported `sanitizeApicalypseSearch()` — strips quote/backslash breakout + clause chars (`;{}()*[]`) + control chars, collapses whitespace, caps 100, bails on empty (skips a malformed query); plus a `safeInt()` runtime backstop on every interpolated numeric (`id`/`gte`/`lte`/`limit`/`offset`). 6 tests. Non-`better-sqlite3` (Apicalypse) interpolation. |

---


---

## Budget / decisions / changelog (historical)

## Rough budget by phase (remaining ⬜ work)
- **Phase 1.5:** ✅ done (was ~1.32M)
- **Phase 2:** ✅ done (was ~700k+)
- **Phase 3:** ✅ done (was ~895k)
- **Phase 4:** ✅ done (was ~160k)
- **Phase 5:** ✅ done — T19 + T21 reviews complete (IMPROVEMENTS.md Parts IV + V)
- **Phase 6 (go-live execution): ✅ launch-blockers all done** — P1–P12, P14, **S1–S13** all ✅ (S6 CSP **enforced + verified live 2026-07-15**; P11 next/image, P12 SEO, S10 dep-hygiene all ✅). App is **live at fandex.org**, secure, and data-complete (899 movies / 273 shows, 0 missing enrichment). **Remaining = optional / needs user / housekeeping:** S2 pre-encryption token-row backfill (likely moot post-reconnect); **P15/P16 Android TWA** (needs a TWA build from the user → package name + cert → 2 env vars); **P13** SSR detail pages (🟢 later); the new **TMDB-429 enrichment hardening** follow-up (defensive, 0 gap seen); decommission old R2 bucket; rename GitHub repo. No 🔴 work left.
- **Total remaining:** ~1.7M tokens (Phase 6 execution; reviews done, P1 decided)

## Open decisions
1. **Sequencing:** ✅ resolved — phased, audits-early. Foundation refactors live in Phase 1.5.
2. **T19 + T20 merge:** ✅ merged → T19.
3. **DB migrations (D1/D2/D5):** ✅ approved — D4 first → build against a DB copy + verify script → timestamped `.bak` → expand-then-contract (add+backfill+switch reads → verify → drop old).
4. **Phase 1.5 vs Phase 2 order:** ✅ approved — do Phase 1.5 before Phase 2.

## Changelog
- _2026-07-15_ — ✅ **Stage 3 go-live complete + a data-loss sync bug found & fixed.** (1) **fandex.org fully wired to Railway** — DNS moved to **Cloudflare** (domainssaubillig couldn't CNAME the apex / locked subdomains behind its webhosting pkg): apex+www CNAME→Railway + `_railway-verify` TXTs, DNS-only. Fixed `TRAKT_REDIRECT_URI` (was a broken partial value) + registered the fandex.org redirect at **Trakt** (dev page moved to app.trakt.tv→Settings→Apps→API-Anwendungen); **Steam/TMDB need nothing** (callbacks derive from `NEXT_PUBLIC_BASE_URL`). HTTPS + Trakt login verified. (2) **Cloudflare Email Routing** — `hello@fandex.org` → user Gmail; removed dead `*.fandex.org`+MX. (3) 🐛→✅ **Trakt sync 100-item cap fixed** (commit `ecd2715`): Trakt paginates `/sync/watched|ratings|watchlist` at 100/page; old code fetched page 1 only → every library capped at exactly 100 movies/100 shows, silently dropping the rest and gutting Insights facet counts. New `traktGetAllPages()` follows `X-Pagination-Page-Count`; 3 tests → 111; tsc clean. ✅ **Re-sync done — backfilled to 899 movies / 273 shows; Miyazaki 3→11 rated.** (4) 🐛→✅ **TMDB enrichment 429-swallow hardened** (commit `6c3b905`): honor 429 Retry-After + retry, search-fallback fetches full detail, enrich failures logged; 4 tests → 114. See [[trakt-sync-completeness]], [[rebrand-fandex]].
- _2026-07-12_ — ✅ **S4 (session revocation) done — server-side token-version store.** Migration 6 adds `users.session_epoch`; `session.ts` stamps every JWT with the epoch at sign time (`se` claim) and `getSession()` rejects any token whose stamp is behind the user's current epoch. `bumpSessionEpoch()` (one indexed UPDATE) revokes every outstanding token instantly. Wired: **logout** bumps + clears cookie (a captured 30d cookie can no longer outlive logout, and other devices are signed out); **disconnect** bumps (kills sessions minted from the removed identity) then re-issues the acting device's cookie against a still-connected identity so it stays logged in. Legacy tokens (no `se` → read as 0) stay valid until the first bump → non-breaking rollout. Kept the 30d expiry, now revocable, instead of a heavier refresh-token flow. 5 tests → 87; tsc/eslint(0)/build green.
- _2026-07-12_ — ✅ **P6 (sync OOM root cause) done — time-budget + resume path.** Refactored `src/lib/sync`: `providerQueue` (registry-filtered, resume-list intersecting) + pure `orchestrateSync` (budget/resume, unit-tested with an injected clock) + `runSync`. Each `/api/sync` request now syncs **whole providers only until `SYNC_BUDGET_MS` (default 25s)** is spent, then returns `{done, remaining}`; the route accepts `{provider}` or a `{providers:[…]}` resume subset. New client driver `src/lib/syncClient.ts` `syncToCompletion()` loops the endpoint (guard-capped at 25) until `done`, wired into dashboard (auto + manual), library, settings. No single request runs the whole ~1,700-item job → per-request latency bounded and memory reclaimed between calls; pairs with P2 (bounded caches). `syncProviders()` kept as a `budgetMs:Infinity` one-shot for non-HTTP callers. 14 new tests (5 orchestrate + 5 queue + 4 client-loop) → 82; tsc/eslint(0)/build green. Follow-up: per-provider granularity today (one giant provider still runs in one window); mid-provider chunking + NDJSON/SSE streaming if needed. Not live-verified.
- _2026-07-12_ — ✅ **S1 (bind account-linking to the session) done.** New `src/lib/oauthState.ts` — single-use httpOnly `rr2_oauth_state` cookie (sameSite=lax, 10-min TTL) + `createOAuthNonce`/`setOAuthStateCookie`/`verifyOAuthState` (constant-time)/`clearOAuthState`. Two fixes across **all** OAuth flows: (1) **link target now derived from `getSession()`**, never from client-supplied `state.userId` (trakt/letterboxd via `handleOAuthCallback`) or Steam `?link=<userId>` — both let an attacker force-link/​hijack an arbitrary account; (2) **CSRF nonce** round-tripped through the provider `state` (trakt/letterboxd/steam) or bound to the single-use `request_token` (tmdb, which has no `state` param), verified against the cookie and cleared on every callback exit. 8 tests → 68; tsc/eslint(0 err)/build green. Not live-verified (needs a real provider round-trip).
- _2026-07-12_ — 🔵 **S2 (encrypt OAuth tokens at rest) — code done, NOT pushed (awaiting env var).** New `src/lib/crypto.ts` (AES-256-GCM; key = SHA-256 of `TOKEN_ENCRYPTION_KEY`, distinct from JWT_SECRET; `enc:1:` prefix; **decrypt passes legacy plaintext through** → non-breaking rollout). Encrypt at all 6 write sites, decrypt at all read sites (adapter `context()` × trakt/tmdb/rawg/letterboxd + search route). Added `TOKEN_ENCRYPTION_KEY` to `config.ts` (required in prod → **crash-loops if unset**, so it MUST be set on Railway before deploy). One-off `scripts/encrypt-tokens.ts` (idempotent) to backfill existing plaintext rows. 5 tests → 60; tsc/eslint/build green. **Committed locally; will push only after the key is set on Railway.**
- _2026-07-12_ — ✅ **P8 fully done** (extended the core): also converted the discovery-read fetchers (igdb/omdb/tagDiscover/discoverFeed/facetDetail), the `search` + `discover` API routes, and letterboxd → **every server-side third-party fetch now goes through `httpFetch`** (~60 sites). Client→own-API `fetch` calls left as-is (same-origin). tsc/55 tests/build green.
- _2026-07-12_ — 🔵 **P8 (fetch timeouts/retries) core done.** New `src/lib/http.ts` `httpFetch` — a drop-in `fetch` superset that adds a 20s `AbortSignal.timeout` (a hung upstream can no longer block a request/sync forever) + bounded backoff retries, ONLY for idempotent GET/HEAD (never a POST write; never 429). 5 tests (success passthrough, retry-5xx, no-retry-POST, no-retry-429, retry-network-then-throw). Converted all 40 external calls in the sync + write-back adapters (`trakt` 12, `tmdb` 8, `rawg` 12, `steam` 8) via `await fetch(`→`await httpFetch(`. Verified no bare `fetch(` remains; tsc/55 tests/eslint/build all green. **Left for later (🔵):** the discovery-read fetchers (igdb/omdb/tagDiscover/discoverFeed/facetDetail) — they already fail-soft, so lower priority. Not live-verified (timeout/retry only manifests under a slow/failing upstream).
- _2026-07-12_ — ✅ **S3 / P7 (rate limiting) done** (one implementation covers both). New `src/lib/rateLimit.ts` — in-process fixed-window limiter reusing `BoundedCache` (single-instance per P1): `rateLimit(key, limit, windowMs)`, `enforceRateLimit` (→ 429 + `Retry-After`), `clientIp` (X-Forwarded-For first hop, for Railway's proxy). Wired: `withUser` caps **300/min per user** across all authed routes (blunts third-party key-proxy abuse); `/api/auth/rawg` caps **5/min per IP** (password brute-force). 4 new tests → 50 total; tsc clean, 0 eslint errors, build green. Limits are tunable constants. Not live-verified (only observable under a flood → 429s).
- _2026-07-12_ — 🐛 **Fix: two more removal bugs (found on live).** (A) **Un-rating** (click the same star → `rating: null` POST) cleared the score locally but never told the platforms → added a rating-ONLY `clearRating` adapter capability (TMDB delete rating; Trakt `/sync/ratings/remove` only, keeps watched — per Trakt convention that rating ≠ watched, confirmed with user), wired into the library POST `rating===null` branch. (B) **Checkmark toggle-off errored** ("Couldn't remove…", no request fired) — client-side `if (!mediaIdRef.current) throw "no id"` on discover/feed cards that never carried the local media_item UUID. Fixed both `toggleWatched`/`toggleWishlist` to send the item's identity (`ids`) on removal, and both DELETE routes (`library` + `watchlist`) now resolve the media_item id from those ids via new `resolveMediaItemFromIds` (userState.ts) when the UUID is absent. tsc clean, 46 tests, build green. **Needs live verify.**
- _2026-07-12_ — 🐛 **Fix: removing a rating / library item didn't propagate to platforms (found on live).** Clearing a rating (the watched-toggle-off → `DELETE /api/library` → `clearLibrary`) only cleared LOCAL state — no platform write-back — so Trakt/TMDB kept the rating and the next sync re-pulled it. **Fix:** new `removeFromLibrary(ctx, sourceId, type)` adapter capability — TMDB `deleteTmdbRating`; Trakt new `removeTraktRating` (`/sync/ratings/remove`) + `removeTraktFromHistory` (`/sync/history/remove`) to also un-watch. The `DELETE /api/library` handler now resolves each connected writable provider's id (media_links cross-ids + the `media_external_ids` fallback) and calls `removeFromLibrary` before clearing locally. tsc clean, 46 tests, build green. **Needs live verify** (platform write-back). **Still open:** watchlist ADD → TMDB (awaiting live logs to see why the earlier `media_external_ids` fallback didn't resolve — suspect the Trakt summary fetch failing → minimal link with no tmdb cross-id).
- _2026-07-12_ — 🐛 **Fix: cross-provider watchlist/rating write-back silently skipped TMDB (found on live).** Adding a Trakt title showed "added to TMDB" but never hit TMDB. Root cause (confirmed via Railway logs — only `[watchlist] Added to trakt`, no tmdb line): the write-back resolves each provider's own id from the CLIENT payload's `ids` (watchlist) / `media_links` `crossIds` (library), which for a Trakt-only item lacks a tmdb id → `resolveSourceId` returns null → `if (!sourceId) continue` skips TMDB with no log/warning. Auth was fine (the earlier pull of TMDB items used the same creds). **Fix:** when `resolveSourceId` returns null, fall back to the cross-source id captured at merge time in `media_external_ids` (D5) for that `media_item_id` + source. Applied in BOTH `watchlist` POST and `library` POST (rating write-back had the identical gap). tsc clean, 46 tests, build green. NOT a regression from the P2/hardening push (that only sanitized `posterUrl`). **Follow-up noted:** `watchlist` POST still swallows genuine write-back errors silently (library POST already returns `warnings`) — surface per-source failures to the client later.
- _2026-07-12_ — 🔵 **S6 (security headers) partial.** `next.config.ts` `headers()` now sends the non-breaking hardening set on all paths (nosniff, `X-Frame-Options: DENY`, Referrer-Policy, HSTS 2y, Permissions-Policy with camera/mic/geo off but autoplay/encrypted-media kept for the YouTube embed, CSP `frame-ancestors 'none'`). Full production build passes. The resource-restricting CSP (script/style/img-src + youtube frame-src) is deferred — needs live browser verification (blank-screen risk), pairs with P11.
- _2026-07-12_ — ✅ **P9 (health) + five security items (S13/S12/S7/S9/S5) done** in one autonomous pass (all self-contained + unit-verifiable; the ones needing live services — P6 sync, S1 linking, S2 token crypto — deliberately deferred to a hands-on session). **P9:** `src/app/api/health/route.ts` (unauth GET, `SELECT 1` probe, 200/503) — wire as Railway healthcheck; Sentry/structured-logging still open (P9 🔵). **S13:** exported `sanitizeApicalypseSearch()` (strip breakout/clause/control chars, cap 100, bail-empty) + `safeInt()` on all IGDB numeric interpolations. **S12:** `src/lib/posterUrl.ts` `sanitizePosterUrl()` (https + CDN-host allowlist) applied on `watchlist` POST. **S7:** `watchlist` DELETE now confirms the item is on the caller's own watchlist before the token-using platform write-back loop. **S9:** RAWG login returns a generic 401 (logs upstream). **S5:** dropped the unused/crackable `bcrypt(password)` hash from `user_identities.metadata` + corrected the false "password encrypted" copy on landing + settings. New tests: +10 (igdb 6, posterUrl 4) → **46 total**; tsc clean, 0 eslint errors. `bcryptjs` now an unused dep (optional uninstall).
- _2026-07-12_ — ✅ **P2 (bounded caches) done.** New dep-free `src/lib/boundedCache.ts` (`BoundedCache<K,V>` — LRU size cap + optional TTL, Map-like API preserving the `has()/get()` null-sentinel the id caches rely on). Replaced all 8 unbounded/growing module `Map` caches across `discovery.ts` (`_profileCache` 500, `_personIdCache`/`_rawgEntityCache` 5000), `facetDetail.ts` (`_personCache` 2000, `_tmdbCompanyCache` 5000), `sources/tagDiscover.ts` (`_keywordCache` 5000), `libraryAnalysis.ts` (`_cache` 500), `liveDiscover.ts` (`_facetCache` LRU 3000 replacing the crude `size>3000→clear()`; `_feedCache` 500 + 45-min TTL folded into the cache). Directly de-risks the OOM class of failure (unbounded growth on the single long-lived process). 6 new tests → 36 total; tsc clean, 0 eslint errors. **Next: P6** (incremental/streamed sync — the OOM root cause the RAM upgrade only band-aided).
- _2026-07-12_ — **Deploy unblocked → app back online.** Resolved the two stacked outage causes: the 512 MB **OOM crash-loop** (upgraded Railway Trial → Hobby, ~8 GB) and a **stale-commit build failure** (Railway repeatedly rebuilt the old `5caf4bc` via manual *Redeploy*, which rebuilds that row's commit, not `main`'s tip — even though `main` was already at the fixed `cce0183`; its AI "Diagnosis" panel pattern-matched the old eager-`JWT_SECRET` bug and was misleading). Verified current `main` builds clean under both Webpack and Turbopack with no `JWT_SECRET`; `git ls-remote` confirmed GitHub `main` = `cce0183`. Fixed by deploying the current tip. **Resumed Phase 6** (see the P2 entry above). The deploy fix itself was deploy-side only (no app-code change); the outage's two stacked causes were RAM (Hobby upgrade) + a stale-commit Railway rebuild.
- _2026-06-18_ — **Login fixed; OOM blocker hit (awaiting RAM upgrade).** Fixed OAuth post-login redirects that used `req.url` → Railway's internal `0.0.0.0:8080` (now `NEXT_PUBLIC_BASE_URL`), across Trakt/Letterboxd (`oauthConnect`), Steam callback, and TMDB init+callback (commit c52ff91). **Trakt login then worked**, and a full **Sync pulled ~1,700 items** (Trakt 1171+67, Steam 475+25, TMDB 43+9), replicated to R2 (59 MB WAL). **But** the in-request sync + 1,700-item personalized feed/insights exceed Railway's **512 MB Trial** → `signal: killed` (OOM) **crash-loop (~every 5 min)**. **Blocked on upgrading Railway Trial → Hobby ($5/mo, ~8 GB)**; user doing it later. **Data is safe** (volume + R2). This realizes **P6** (in-request sync) — proper long-term fix is incremental/streamed sync + bounded caches (**P2**). Minor non-blocking bug noted: entrypoint `litestream restore` errors on restart when the DB already exists (harmless `|| true`; guard on file-absent later).
- _2026-06-18_ — **🚀 LIVE on Railway with backups.** App deployed and booting clean (`✓ Ready`); Litestream confirmed replicating `/app/data/rr.db` → Cloudflare R2 (`releaseradar-backups`) with no TLS error. Full build-fix trail across the session: drop Docker `VOLUME` (Railway-rejected) → run as root for the volume → lazy `JWT_SECRET` resolution (eager check broke `next build`'s page-data collection) → `ca-certificates` in the runner stage (Litestream Go binary's TLS to R2). **P4 done** (deployed); **P5 effectively done** (backups live; one-time restore drill still recommended). Remaining for a usable app: custom domain + register OAuth redirect URIs so login works.
- _2026-06-18_ — **First Railway deploy: build fix.** Railway's Metal builder rejects the Docker `VOLUME` instruction ("use Railway Volumes") — removed it from the Dockerfile (volume is attached in the Railway dashboard at `/app/data`). Also switched the runner to **root** since Railway mounts volumes owned by root (non-root couldn't write `rr.db`); non-root is a hardening follow-up. Repo pushed to `Mlysign/releaseradar` `main` (Railway auto-builds on push).
- _2026-06-18_ — **P4 (deploy artifact) + P10 (config validation) built & verified.** `next.config.ts` → `output: "standalone"` + `outputFileTracingIncludes` for the `better-sqlite3` native `.node` (confirmed traced into `.next/standalone`). New **`Dockerfile`** (multi-stage bookworm-slim: build toolchain + `npm ci` + build in builder; non-root runner serving `node server.js`; `VOLUME /app/data`, `DB_PATH=/app/data/rr.db`, honors `PORT`/`HOSTNAME`) + **`.dockerignore`**. New **`src/lib/config.ts`** `validateEnv()` (required vars throw in prod listing all missing; provider keys warn) run once at boot via **`src/instrumentation.ts`** `register()` (Node-runtime-guarded). `npm run build` clean, `.next/standalone/server.js` + `better_sqlite3.node` present, 30 tests green. Read the Next 16 standalone/instrumentation docs first per AGENTS.md. P4 → 🔵 (artifacts done; README + live Railway deploy remain), P10 → ✅.
- _2026-06-18_ — **P1 hosting decision LOCKED → Option A (single-instance + SQLite) on Railway.** Postgres shelved (revisit only on real multi-instance traffic). Reasoning: matches the code (zero DB rewrite), cheap (~$5/mo), SQLite ideal for this read-heavy workload, and serves both the website and the future Android TWA from one host. Old shared-hosting package can't run the app (PHP-only, no Node) — it's kept solely for **domain + DNS (+ email)**; Railway hosts the app and issues SSL. Added a **Railway launch runbook** to Phase 6 (Stages 1–5: code prep → service+volume → domain/OAuth → data+Litestream backups → pre-public hardening), each step mapped to P#/S#. P4/P5 notes made Railway-specific. P1 → 🔵 (decided; deploy pending).
- _2026-06-18_ — **Phase 5 COMPLETE: T21 (security analysis) review done → [IMPROVEMENTS.md](IMPROVEMENTS.md) Part V** (13 findings S1–S13). Verdict: fundamentals sound (parameterized SQL, no XSS sinks, Steam OpenID verified, no token leak in `/me`, hardened cookie). Real gaps: **S1** account-linking trusts unsigned `state.userId`/Steam `?link=` (not session-bound, no nonce), **S2** OAuth tokens plaintext at rest, **S3** no rate limiting (= P7), plus S4–S13. Applied **P3** (JWT-secret fail-fast: `session.ts` throws in prod when `JWT_SECRET` unset, dev/test keep a named insecure fallback; tsc clean, 30 tests). Entered S1–S13 into **Phase 6** alongside P1–P16; both reviews done, execution recommended as one prioritized pass (S2+S5 → S1 → S3 → …). **The whole tracker (Phases 0–5) is now review-complete; Phase 6 is the remaining execution work.**
- _2026-06-18_ — **Phase 5 started; T19 (productionization readiness) review done → [IMPROVEMENTS.md](IMPROVEMENTS.md) Part IV.** Target confirmed with user: **public website first, Android as a PWA/TWA** wrapper. 16 findings P1–P16 (website Section A + Android Section B). Core conclusion: the app only supports a **single-node, single-disk, always-on-Node** deployment — `better-sqlite3` + local `data/rr.db` + ~10 in-memory module caches rule out serverless/multi-instance; **P1 (hosting-model decision) gates P2/P4/P5/P6**. Security-adjacent items (P3 JWT default secret, P7 no rate limiting, plaintext OAuth tokens at rest, RAWG bcrypt path) forward-flagged to **T21**. Review-only — nothing applied. Also did three small UX asks earlier in the session (removed `/foryou` page + orphaned ignore route; hid Letterboxd via `HIDDEN_PROVIDERS` in catalog/registry incl. the detail-page wishlist list; card view → `object-cover` + `backdropUrl` fallback, dropped blurry letterbox; grid-view loading spinner; IGDB poster fallback to artwork/screenshot). tsc clean throughout.
- _2026-06-17_ — **T28 review fix #2 (the REAL root cause — verified live in the user's browser via Claude-in-Chrome).** The reported "doesn't jump to today / sort jumps to extremes / month nav too long" were NOT the personalized feed — `/api/discover` returns correct future-only items (June 2026→Nov 2027) and the browse anchors today fine. The trigger: applying the **"Hide in-library/wishlist" membership filter** (a natural discovery action) flipped Discover into the `find()` **whole-catalog** search, which — sorted "Release (oldest)" over the user's 600+ -item catalog incl. decades-old rated library titles — dumped them at **Jan 1927 (Metropolis)** with a 50-year month nav. Reproduced + fixed in `src/app/discover/page.tsx`: **type + membership filters now refine the live UPCOMING browse client-side** (`browseFiltered` applies `membership.library/wishlist` exclude/only against the items' `libraryStatus`/`onWatchlist`) instead of triggering catalog search. `needsCatalogSearch()` (replaces `hasActiveFilters`) flips to `find()` only for **facets / a narrowed year range / a text query / a non-date sort** — cases that genuinely need the historical catalog. Verified live: Hide-library now stays on June 2026 upcoming (12-month nav, not 50yr); "Release (newest)" anchors today (centered) instead of the Nov 2027 extreme; default anchors June 2026. tsc clean, 30 tests, 0 eslint errors. (Fix #1's `GroupedView` scroll-robustness + nav max-height still stand as hardening for the legitimate catalog-search cases.)
- _2026-06-17_ — **T28 review fix #1 (browse-timeline scroll robustness — partial; see fix #2 for the real cause).** The personalized feed spreads relevant items across the full ~18-month window (vs the old dense near-term popularity feed), which surfaced three `GroupedView` issues: (1) today-scroll stopped landing reliably, (2) date sorts "jumped to the extremes", (3) the month scrubber (`MonthNav`) overflowed off-screen. Fixes (client-only, `GroupedView.tsx`): today-scroll now re-applies an **instant** scroll on a self-rescheduling `setTimeout` loop (≈up to 1.4s, +0.5s drift-correction after first hit) instead of one 80ms `smooth` shot — survives the slower async load + lazy-poster layout-shift that was making it land at an extreme; **bails the moment the user scrolls** (wheel/touch/keydown). `MonthNav` got `max-h-[calc(100vh-12rem)] overflow-y-auto` (hidden scrollbar) + auto-scrolls to keep the active month button in view, so a long month list now fits/scrolls internally. tsc clean, 30 tests, 0 eslint errors. **Open/flagged to user:** newest-first still anchors "today" at the bottom of the future-only initial set (documented Phase-2 design); and the feed could be biased toward near-term to restore a denser timeline if preferred.
- _2026-06-17_ — **T28 follow-up — multi-source discovery (user asked "are we pulling from all DBs?").** Discovery was single-source per medium (games=RAWG, movies/shows=TMDB); the `MetadataProvider` interface only had `fetchById`/`searchByTitle` (no list/browse), so only TMDB `/discover` + RAWG `/games` were wired for browsing. Added: **IGDB** (`discoverIgdbUpcoming` sort by `hypes`; Twitch creds **are** configured — earlier memory was stale) as a 2nd **game** source in BOTH browse + search (`searchIgdbGames`), deduped vs RAWG by title+year; **Trakt anticipated** (`getTraktAnticipated{Movies,Shows}`) as a 2nd **movie/show** source in the browse feed, mapped to TMDB-id candidates (so they dedupe by id + get a poster/full facets via TMDB hydration — Trakt serves no images). Steam deliberately NOT added (no upcoming-list API — enrichment only). Trakt deliberately NOT added to text search (redundant with TMDB's catalog + no posters). `liveDiscover` now pulls both sources per medium in parallel, dedups, then ranks. tsc clean, 30 tests, 0 eslint errors. Not browser-verified.
- _2026-06-17_ — ✅* **T28 (personalized default discover feed), pending browser review.** Root cause of the "irrelevant flood (e.g. Korean dramas)": the default `GET /api/discover` browse hit TMDB/RAWG by pure global popularity (page-1 only) and date-sorted — zero personalization — while the IDF-weighted facet ranker (`discovery.ts`) only ranked the local catalog. Bridged them (B2, user-confirmed): wide upcoming pull → taste-rank with the SAME facet engine → return the most relevant set, client still date-sorts the timeline. New `discoverFeed.ts` / `tmdbGenres.ts` / `liveDiscover.ts`; `discovery.ts` exports `buildProfile`/`scoreFacets`/`getCatalogIdf`/`ROLE_WEIGHT`; `libraryAnalysis.ts` gains `getMembershipSignal` (library+wishlist facets, rated or not, + language histogram) → fixes the "membership contributes nothing" gap + cold-start. Signals (user-selected): library+wishlist content + crowd-vote floor; language kept as a soft tiebreaker only (declined as a hard filter). Movies/shows hydrate (1 TMDB req each) for full people/keyword facets; games scored from list genres/tags. Section load-more uses a cheap no-hydration filter so deep scroll doesn't revert to popularity. 45-min per-user feed cache. tsc clean, 30 tests, 0 eslint errors. **Not browser-verified** (standing instruction — user reviews in Chrome). Known follow-up: `invalidatePersonalizedFeed` unwired (feed reflects new ratings/wishlist only after the TTL).
- _2026-06-16_ — **T22 review fix (Angel's Egg → region-date cycle guard):** a 1985 film showed a 2026 date because the region override picked TMDB's per-region `release_dates`, which for older films are all **re-release/restoration** entries (DE = the 2026 4K restoration). Fix (after user feedback — they DO want the regional date for recent films "released in the US, coming to my country later"): a region date overrides the primary only when it's in the **same release cycle** — within **~3 years** of the primary. Genuine staggered international releases (months–~1yr later) are kept; decade-later restorations are excluded. Verified: Angel's Egg → 1985 (US/DE); recent films now show the DE date (e.g. *I'm Still Here* US 2024-10-09 → DE 2025-03-13). Deterministic (date-gap, no `today`). tsc clean, 30 tests.
- _2026-06-16_ — ✅ **Phase 4 / T22 (country setting) done.** `users.country` (migration v5, applied live + `.bak-pre-v5-20260616`); `userCountry.ts` (server get/set) + client-safe `countries.ts` (curated list, validation) + `detectCountry.ts` (browser auto-detect → US fallback). Settings page gained a Region picker (auto-detects + persists on first visit via `POST /api/settings`; `/api/auth/me` returns the raw stored country). **Core:** `normalize.ts` exposes per-region `streamingByRegion` + `releaseDatesByRegion`; `mergeLinks(links, type, region)` picks the user's country's streaming + release date (canonical `mergeForCanonical` stays region-agnostic); threaded into detail/calendar/library. Discover movie pull uses TMDB `&region=`. Verified region differences live. tsc clean, 30 tests, 0 eslint errors. Not visually verified. **Only Phase 5 (go-live: T19 productionization, T21 security) remains.**
- _2026-06-16_ — **D9 follow-up (Insights showed only a handful of studios after the backfill):** root cause was the `libraryAnalysis` in-memory facet cache — `librarySignature` keyed only on `user_library`, which the backfill never touches (it rewrites `media_links.raw_data`), so a running dev server kept serving the pre-enrich analysis. Fixed: the signature now also folds in the library links' `COUNT` + `MAX(last_synced)`, so any enrich/re-sync invalidates the cache. Verified the live data is correct (analysis yields 431 developers / 289 publishers incl. Bethesda Softworks publisher×36 / Bethesda Game Studios developer×15). Restart/refresh the dev server to see it. tsc clean, 30 tests.
- _2026-06-16_ — ✅ **Phase 3 COMPLETE** — finished the last three items in one session:
  - **A5** (per-source switches → catalog): `SourceMeta` gained `urlParam`/`shortLabel`; `SOURCE_COLORS`/`SOURCE_LABELS` derive the connectable platforms from `CATALOG` (rating-only sources kept as extras); `itemUrl.ts` exports `SOURCE_PARAMS` derived from `CATALOG.urlParam` (kills the hardcoded `["rawgId",…]` lists). Byte-identical output.
  - **A6** (`withUser` wrapper): `src/lib/withUser.ts`; converted all **15 session-gated API routes** to `export const VERB = withUser(async (req, session) => …)`, dropping the copy-pasted `requireSession`+try/401/500 boilerplate. OAuth/`getSession` routes untouched.
  - **D9** (game dev/publisher data): `enrichStoredGameDetail` refetches each game link's own detail endpoint (RAWG/Steam carry dev/pub) when the stored list-payload lacks it; `matcher` now **merge-preserves** raw_data so later list-payload syncs don't clobber the fetched detail (new test). One-off idempotent `scripts/backfill-game-detail.ts` (`--dry-run`/`--limit`) — dry-run found 741 game items missing dev/pub (494 rawg + 479 steam); backed up live DB (`.bak-pre-d9-20260616`) + ran the full backfill → **967 links enriched, 0 errors, studio-data coverage 3%→93.3%**. tsc clean, **30 tests**, 0 eslint errors.
- _2026-06-16_ — ✅ **T27 (shared UI primitives + states) done:** new `src/components/ui/` — `Button` (+`buttonClasses`), `Chip` (faithful color-coded extraction adopted by SubBar's All/type/source/hide-rated pills), `EmptyState` (Discover/Library/Wishlist no-results), `Spinner` (calendar + /foryou + discover loading), `Toast` (provider+`useToast`, mounted via `AppProviders` in root layout, wired into `useQuickActions` to surface swallowed rate/wishlist/watched failures), `ConfirmDialog` (promise-based `useConfirm`, replaces native `confirm()` in settings — **U11**). **Card keyboard access** (deferred from T25): PosterCard/ListCard are now `role=button`/`tabIndex=0` with Enter/Space activation guarded to the card itself (nested action buttons keep their own keys). Settings Sync/Disconnect → `Button`. tsc clean, 29 tests, 0 eslint errors. Not visually verified. **Phase 3 remaining: A5, A6, D9.**
- _2026-06-15_ — ✅ **T26 (mobile) done:** NavBar collapses to a hamburger dropdown below md; SubBar's facet + year/membership rows collapse behind a mobile-only "Filters" toggle (always-visible md+); search row + /foryou chip row now wrap. tsc clean, 29 tests. Not visually verified.
- _2026-06-15_ — ✅ **T25 (a11y) done:** global keyboard `:focus-visible` ring (`globals.css`) + `aria-label`s/toggle-semantics across every icon-only control — SubBar view toggles/sort/facet-×, SearchBar input+clear, ActionCells rate/watched/wishlist + star picker, MediaGallery arrows+thumbnails, Calendar/SearchModal close, For You ✕/♥; decorative glyphs `aria-hidden`. tsc clean, 29 tests, 0 eslint errors. Noted follow-up for **T27**: clickable card `<div>`s aren't keyboard-focusable (needs role/anchor rework that conflicts with the nested action buttons). Not visually verified.
- _2026-06-15_ — ✅ **A7 done:** cleared **all 31 react-hooks errors → 0** and the remaining 8 cosmetic eslint errors (7 `no-unescaped-entities`, 1 `prefer-const`) → **eslint errors 0**. Genuine bugs fixed properly: refs-in-render (`Tooltip` takes `anchorRef`, read in its own effect — fixes PosterCard/ListCard/CalendarView), `static-components` (insights/facet inline `Row` → module-scope `CompareRow`), discover use-before-declaration (`loadDefault` moved above its effect) + the sentinel-object ref false-positive (module-scope `SentinelBar`, also de-dupes top/bottom), `settings` notice now derived via lazy `useState` init. The `set-state-in-effect` flags that are correct idiomatic patterns (storage hydration, prop→state sync, data-fetch-on-mount, load guards, layout measurement) carry justified `eslint-disable-next-line` with one-line reasons. tsc clean, 29 tests; 318 deliberate warnings remain (`no-explicit-any` etc., out of scope). Not visually verified.
- _2026-06-15_ — ✅ **A3 done:** split `item/page.tsx` **810 → 391 lines**. Extracted 7 focused modules under `src/components/item/` — `format.ts`, `primitives.tsx` (ScoreBadge/Fact/RatingsBreakdown), `MediaGallery`, `RatingsSection`, `FactsSection`, `WishlistPanel`, `LowerSections`. Faithful JSX move (no behavior/markup change); read-only sections derive from `enriched`, interactive ones (gallery/ratings/wishlist) get explicit props + handlers. The duplicated `PLATFORM_CONFIG` was **already removed** in earlier registry work (A1/A2) — page uses `catalogForType`. tsc clean, 29 tests. **Not visually verified** (per standing instruction — user reviews in browser).
- _2026-06-15_ — ✅ **T11, T12, T13 APPROVED** by the user after two rounds of review fixes. Marked ✅ (was ✅*). Phase 3 cards/list + back-nav cache + detail redesign are done. Next: **A3** (split `item/page.tsx` + drop duplicated `PLATFORM_CONFIG`), then cross-cutting polish (T26 mobile · T25+A7 a11y/react-hooks · T27 primitives/states · A5/A6 · D9).
- _2026-06-15_ — **Phase 3 review fixes, round 2 (from user's live review):**
  - **List row height** — rows were changing height with the poster's aspect ratio (portrait movie posters tall, landscape game art short). `ListCard` now **absolutely-fills** the poster (`absolute inset-0 object-cover`) so the image can't drive the row height; rows are uniform, defined by the text/actions.
  - **Discover jump-to-today with a filter** — when a filter narrowed Discover to mostly-past catalog results, `findTodayOrNextDate` returned null (no today-or-future date) so it never scrolled. It now **falls back to the latest date** (the "present" edge) when everything is past, so the timeline still anchors near now.
  - **Library "release" sort** — the library route was **overwriting `releaseDate` with the watched/log date** (`reviewedAt`), so "Release (oldest/newest)" actually sorted by when you rated/logged. `releaseDate` is now the real release date (from merged links); the log date stays available as `reviewedAt`. (Removed the now-unused `unixToDate`.) tsc clean, 29 tests.
- _2026-06-15_ — **Phase 3 review fixes (from user's live review of T11/T12/T13):**
  - **T12** — back-nav now restores **scroll** even with a narrow facet active. Root cause: restore fired when the full list finished loading, before `includeFacets` hydrated; the facet then shrank the list and collapsed the position. `useScrollRestore` now re-applies the target across a ~1.2s window (bailing on real user scroll) so it survives the late facet-hydration re-render. (Type filters worked before only because the list stayed tall.)
  - **T11 cards/list** — card footer type chip removed (was breaking onto a second line at wide widths); **type icon moved into the color-coded bar** (top bar on cards, new left strip on rows). List **poster is now full-row-height, flush against the type-color strip**. Rate UX: **bigger stars**, picker **closes on outside-click** (pointerdown-outside) and on re-click, and the 3 action cells gained a **hover** effect (`hover:brightness-125`).
  - **T13 detail** — the **10-star user scale moved up into the same cluster as the platform/community scores** (description/facts no longer sit between them); **director/developer/publisher rendered as chips** (FacetLink + role prefix); **tags + keywords merged** (same thing) and **combined with modes & platforms into one section, grouped & color-coded by category** (`CATEGORIES`); **top source chips removed**. tsc clean, 29 tests; remaining lint in `item/page.tsx`/`ListCard` is pre-existing A7 (refs-in-render, set-state-in-effect, `Date.now` purity), not introduced here.
- _2026-06-15_ — **Phase 3 review (live):** drove the running app (authed) through **T11/T12/T13**. T11 (cards+list 3-cell toolbar, type-colored borders, score-colored ★, letterboxed game art, skeletons) and T13 (co-located YOU+crowd scores, cast cards w/ TMDB profile photos, category-colored tags) both confirmed good. **T12 had a real back-nav bug:** filters/scroll lost returning from an item → root-caused to a hydrate/save race in `usePersistedState` (ref-based `hydrated`) amplified by React dev Strict-Mode effect double-invoke; same flaw dropped `useScrollRestore`'s listener. **Fixed** (`hydrated`→state, listener no longer gated by the one-time ref) and re-verified live (filter + scroll now survive back-nav). tsc clean, 29 tests.
- _2026-06-14_ — ✅* **T12** (pending review): `usePersistedState`/`useScrollRestore` (sessionStorage) — filters/search/sort survive back-nav on Discover/Library/Wishlist; scroll restored on Library/Wishlist. Calendar-location + U14 month-nav scaling still open.
- _2026-06-14_ — ✅ **D6 + D7** (quick foundation): `librarySignature` now includes a rowid-weighted rating sum (offsetting edits invalidate the cache); migration v4 adds `idx_library_media` + `idx_watchlist_media`. ✅* **T13 detail redesign** (pending review): cast cards w/ TMDB profile photos, your-rating co-located with crowd scores, category-colored tags. Verified live. A3 (file split) still open.
- _2026-06-14_ — ✅* **T11 (cards/list), pending review — v2 per user mockup:** replaced the badge overlays + hover quick-actions with a persistent **3-cell toolbar** (`ActionCells`: Rate · Watched · Wishlist), score-colored ★ + 10-star picker (inline rows / popover cards), type-colored border (top cards / left rows), type icon+label in footer, game-art letterbox, broken-image placeholder. New backend: `toggleWatched` + `clearLibrary` + library `DELETE`. Verified live on Library/Discover/For You incl. star picker. tsc clean, 29 tests. (`QuickActions.tsx` now unused; `ItemBadges` calendar-only.) Earlier v1 (icon badges) superseded.
- _2026-06-14_ — **T18 visual pass:** drove the live app (Discover/Library/Wishlist/Insights/For You/detail, desktop) → added **U14** (month side-nav doesn't scale to multi-decade lists) + **U15** (game landscape art cropped into 2:3 cards & /foryou) and confirmations to IMPROVEMENTS.md Part III. Mobile breakpoint not visually validated.
- _2026-06-14_ — ✅ **T18 (Phase 3 start): UI/UX review** → 13 findings (U1–U13) in IMPROVEMENTS.md Part III. Headlines: quick actions are hover-only (unreachable on touch, U1), source dots are color-only/illegible (U2), type indicator inconsistent (U3), mobile nav + tall sticky bar (U4). Added **T25** (a11y), **T26** (responsive/mobile), **T27** (shared primitives + states); expanded T11/T13 scope. Suggested order: T11 → T13+A3 → T12 → cross-cutting polish. No code changed (review only). Open: optional live-screenshot pass before T11.
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
- _2026-06-14_ — Bug triage ([bugs.md](bugs.md)): "Warriors of the Wind merge" = not a bug (TMDB alt-title). Insights studios = fixed display half (publishers now shown in `InsightsView`) + logged the data-coverage root cause as **D9** (game sync persists list payloads lacking dev/pub; 97% of library games affected). 29 tests green, tsc clean.
- _2026-06-14_ — ✅ **A2** (Phase 1.5): schema setup now implicit in `getDb()` via private `ensureSchema(db)` (guarded by `_initialized`); removed all 24 `initDb()` calls + imports from API routes + `oauthConnect.ts`. `initDb()` kept as a deprecated alias for standalone scripts/tests. tsc clean, 16 tests green. Next: **D4** (migration runner).

---

## QA / navigation / smoketest findings — closed (2026-07-18)

These were logged during the P17 QA sweep, the back-button deep-dive, and the
first `/smoketest` run, and all fixed the same day. Moved here so the active
TASKS.md only lists what's still open.

### QA sweep — closed findings
| Q1 ✅ | 🟠 | UI | NavBar | **FIXED 2026-07-18** (session-aware NavBar: anon gets Discover + "Log in" → generic SignInDialog with returnTo; module-cached /api/auth/me probe). ~~**Nav is not session-aware.**~~ A LOGGED-OUT visitor on a public page (facet / item) sees the full authed nav — Wishlist / Library / Insights / Profile **+ "Log out"** — on both desktop AND mobile. Clicking any bounces to login. Pre-existing (shared with the already-shipped public item pages), but P17 makes it much more visible since facet pages are a public entry point. Fix: session-aware NavBar (public links + "Log in" for anon). |
| Q2 ✅ | 🟠 | UX | Landing | **FIXED 2026-07-18** ("or — Browse without an account →" link to /discover under the login options). ~~**No "browse without an account" path.**~~ Logged-out `/` offers only Trakt/Steam/RAWG login — nothing links to the now-public `/discover` or facet pages. Anonymous visitors who land on `/` can't reach the public catalog. Add a "Browse" / "Explore without signing in" entry. |
| Q4 ✅ | 🟡 | UI | Insights → Taste by Era | **FIXED 2026-07-18** (full 4-digit decade labels). ~~**Ambiguous decade labels.**~~ The x-axis shows two "90s" and two "20s" columns (1890s vs 1990s, 1920s vs 2020s) with no century — indistinguishable. Use 4-digit ('1990s') or century-qualified labels. |
| Q5 ✅ | 🟡 | UI | Settings | **FIXED 2026-07-18** (all-connected → "All available login methods are connected" message). ~~**"Add login method" section is empty**~~ — heading + description ("Connect another account…") render with no buttons beneath when all providers are already connected (+ Letterboxd hidden). Show an "all connected" message or hide the section. |
| Q6 ✅ | 🟡 | UX | Landing / Settings | **FIXED 2026-07-18 (user's call: add it).** "Continue with TMDB" added to AuthOptions (landing + sign-in dialog) — the TMDB callback already fully supported fresh login incl. the H2c return cookie; this was UI-only. **Needs a live TMDB login round-trip to verify** (can't OAuth locally). ~~Login offers Trakt/Steam/RAWG but **not TMDB**~~ |
| Q13 ✅ | 🔵 | UI | 404 | **FIXED 2026-07-18** (branded `app/not-found.tsx`: logo + "Browse the catalog" / "Go home"; covers unknown routes AND every notFound()). ~~Unmatched facets (and any 404) render Next's **default unbranded 404**.~~ |

### Navigation / back-button — closed findings
| N1 ✅ | 🟠 | UX | P17 facet | **FIXED 2026-07-18** (sort → `?sort=` via native replaceState — shareable + SSR reads it on Back; Load-more depth + items stashed in sessionStorage keyed per facet, restored only when the stash's sort matches the SSR'd one; scroll restored via useScrollRestore). Verified: rating+120 items+Portal 2+scroll all survive item→Back. ~~**Facet page loses sort + "Load more" state on Back.**~~ Set Sci-Fi to "Highest rated" + Load more (120 items, Portal 2 first) → open an item → Back ⇒ resets to "Most popular", 60 items, Interstellar. Sort/page are client-only useState, wiped on the re-mount. Discover, by contrast, DOES persist its state (N-note below), so this is an inconsistency in my own code. Fix: persist facet sort/page — reflect sort in a `?sort=` query param (also makes it shareable) and/or usePersistedState. |
| N2 🔶 | 🟠 | UX | Discover / Wishlist / Library | **FIXED for Wishlist + Library 2026-07-18** — two-part root cause: (1) GroupedView's today-scroll re-fired on every mount and beat the restore → new `autoScrollToToday` prop, off when `hasSavedScroll()`; (2) **the router's scroll-to-top on navigate-away fired one last scroll event that saved `0` over the real position** (why useScrollRestore never worked here) → pathname pin in the save listener (usePersistedState.ts). Verified: wishlist scroll 5000 survives item→Back. **Discover browse DONE TOO (2026-07-18, later same day):** browse depth (`pages`/`backPages`) mirrored to sessionStorage; `loadDefault` refetches that depth on mount (feed pages are server-cached + deterministic, capped at 10 pages/section) so the saved scroll lands on real content; today-scroll suppressed when a restore is pending. Verified: 55 items + scrollY 6000 + the exact clicked card restored on Back. **N2 fully closed.** ~~**Browse scroll position lost on Back.**~~ These pages auto-scroll to "today" on every (re)mount (Discover browse lands at scrollY ~9012 of ~14816). So scroll down to a future month → open an item → Back ⇒ you're dumped back at "today", not where you were. (Root of Q3.) Search-results mode is fine (starts at top). Fix: preserve/restore scroll on Back, or only auto-scroll-to-today on first mount, not on history restore. |

### Smoke test — 2026-07-18 (all 6 findings closed same day)
Scope: full local sweep per [smoketest.md](smoketest.md) — logged-in flows (wishlist write round-trip, calendar view, insights, settings, facet overlay), logout, full anonymous surface (landing, discover incl. search, item page + H2c dialog/intent/guard, facets + sort/Load more, gated-page bounce, 404s, robots/sitemap/health), API error-shape probes, mobile viewport. **Overall healthy: zero console errors anywhere, server logs clean (known Steam-CDN 404 noise only).** Known Q/N findings re-confirmed where crossed (Q1, Q2, Q5, Q7, Q9, N3) — not re-logged. ID = `SM#`. Severity: 🟠 fix soon · 🟡 minor · 🔵 nice-to-have.

| ID | Sev | Type | Area | Finding (with repro) |
|----|:--:|:--:|------|----------------------|
| SM1 ✅ | 🟡 | ui/data | Wishlist | **FIXED 2026-07-18** (`rr2:wishlist-toggled` window event from useQuickActions on success; wishlist page listens and drops the row — verified live, row vanishes instantly). ~~**Removed item's row stays until reload.**~~ On `/dashboard`, search an item → click its "On your wishlist — remove" quick action → `DELETE /api/watchlist` returns 200 and the removal persists (gone after reload), but the row keeps rendering as-is with no visual feedback. A user can't tell the remove worked. |
| SM2 ✅ | 🟡 | state | View toggle | **FIXED 2026-07-18 (user's call): view toggle is now PER-PAGE** (`useViewMode(key, …)` → `rr_view_wishlist` / `rr_view_library` / `rr_view_discover`; old global `rr_view_mode` abandoned) **while the media-type filter (Games/Movies/Shows) is now GLOBAL** (one shared `rr_type_filter` key across Wishlist/Library/Discover — Discover's copy inside `rr_discover_filters` is ignored). Verified: Calendar on Wishlist no longer flips Discover; Games toggled on Wishlist filters Discover. ~~View mode is one global key…~~ |
| SM3 ✅ | 🟡 | data | P17 facet sort | **FIXED 2026-07-18 (user's call: Bayesian damping).** `sortPool`'s rating sort now orders by `(v·R + m·C)/(v+m)` with m=50 and C = the pool's well-voted average (no small-pool fallback in the prior — that would let the outliers pull it). Displayed score stays the raw average. Verified: Nolan's Highest rated now leads Dark Knight/Interstellar/Inception; +2 unit tests. ~~**"Highest rated" has no vote-count damping**~~ |
| SM4 ✅ | 🟡 | ui | Item page (game) | **FIXED 2026-07-18** (normalize.ts maps Steam rating-system ids → display labels, `steam_germany`→USK; unknown systems title-cased; lossless guard re-run green — Silksong now "USK 6"). ~~**Raw age-rating enum shown to users**~~: Silksong renders "RATED — STEAM_GERMANY 6". Movies are fine ("FSK 12 · PG"). Map games' rating-body enums to display labels (USK/PEGI/ESRB etc.). |
| SM5 ✅ | 🔵 | ui | Settings | **FIXED 2026-07-18** (the JSX space after `{p.label}` was swallowed in the compiled output — now a template string). ~~Copy typo: "Read-only – **Steamdoesn't** support…"~~ |
| SM6 ✅ | 🔵 | perf | Anon API noise | **FIXED 2026-07-18.** New shared `src/lib/sessionProbe.ts` (cached /api/auth/me probe — 200 `{user:null}` for anon, so probing itself never 401s; `resetSessionProbe()` on login/logout incl. RAWG's in-place login in AuthOptions). Gated: PersonalSection's `/api/detail`, the facet `/api/facet/mine` overlay, Discover's `POST /api/discover/find` + `facet-fetch` (anon search goes straight to the public `GET /api/discover?q=`). NavBar now uses the same probe. Verified anon across item/facet/search: **zero 401s in the network log**. ~~Anonymous pages fire authed API calls that 401 silently~~ |

**Held up well (verified this run):** H2c anon machinery end-to-end locally — anon item page shows the REAL star/wishlist controls, star click opens the in-page sign-in dialog (no redirect), intent stored in localStorage (`fandex.pendingIntent` = `{path, action:{kind:"rate",value:8}}`), login links carry `returnTo`, and the **open-redirect guard verified at the HTTP layer** (`returnTo=//evil.com` and absolute URLs → NO `rr2_oauth_return` cookie; safe path → cookie set). **Wishlist write round-trip** (obscure RAWG-linked game): add → 200 → survives reload → consistent on item page + wishlist page → remove → 200 → gone after reload (net-zero, real RAWG write-back errored nothing). **Logout** works (epoch bump, clean landing redirect, APIs 401 after). **URL hygiene**: wrong slug → 308 canonical; bad/garbage uuid → 404; unknown person → 404; legacy `/insights/facet?kind=…&key=…` → 308 to the public page (`type=` instead of `kind=` falls back to `/insights` — intended). **Gated pages anon** → SSR 200 shell + graceful client bounce to `/`, no data leak, `/api/*` properly 401 without a cookie. **robots.txt** allow/disallow set correct; **sitemap** root-only (expected while noindex); `/api/health` ok. **Facets anon**: bio + sort re-query + Load more 60→120. **Calendar view** renders correctly (current month, releases on dates). **Wishlist empty-search state** ("No results — Clear search") works. Mobile facet page + menu behave (Q1/Q9 re-confirmed, nothing new).

_Side effects of the sweep (local dev): `users.session_epoch` bumped 2→3 by testing logout (old local session cookies invalid — OAuth re-login unaffected); preview-browser `rr_view_mode` left on "card"._

---

## H2 — Data-model hardening (done 2026-07-16/17, all 3 phases A/B/C)
**Goal:** media data is consistent, persistent, and accurately reflects the user's real data + recommendations.

**Audit (2026-07-16)** compared the *intended* data flow against the real schema. Intended: wishlist holds `media_item_id`s → a table maps them to platform ids → the server assembles enriched items from those ids; discover asks providers "what's popular" (platform ids) + the recommender "what does this user like" (`media_item_id`s, empty when logged out), **enriches anything not already enriched**, and the detail page builds from the `media_item_id`.

**🔑 ROOT CAUSE — one fact drives three gaps.** `media_links` stores the **full provider payload** in `raw_data`, not just the id: **~92KB avg per TMDB link, 149.6MB / 4,012 links = ~94% of the entire DB** (local 160MB; live ~249MB). So the server never "assembles from platform ids" — it merges cached blobs (`mergeLinks`) and never calls the platforms at read time. Breakdown: tmdb 1,472 links / 135.5MB · rawg 722 / 8.4MB · steam 576 / 4.4MB · trakt 1,242 / 1.4MB.

**Gaps vs the intended model** (8): ① discover never persists → discover items have **no `media_item_id`** (live `FeedCandidate`s with composite ids) — *this is what forced P13's source-id URL machinery*; ② `/discover` is **UI-gated only** (`discover/page.tsx`: `if (!d.user) router.push("/")`) while `/api/discover` **already supports anonymous** (`getSession()?.userId ?? null`, `annotate()` returns empty user-state, region → `DEFAULT_COUNTRY`) → ~1 line; ③ anonymous sees a sign-in **hook** instead of the real controls; ④ **no login modal / return-url / intent preservation** (`PersonalSection` links to `/` → OAuth lands on `/dashboard`, intent lost); ⑤ assembly-from-blobs (= root cause); ⑥ `media_external_ids` vs `media_links` — **NOT duplication, keep both** (`media_links` = sources we hold data from; `media_external_ids` = the **cross-id matching index**, incl. ids extracted from *inside* other providers' payloads, used by `matcher.ts` to prevent false merges — merging them re-breaks that) → resolution is a comment; ⑦ wishlist keyed **(item, platform)** not just item — `user_item_state` is the source of truth, `user_watchlist`/`user_library` are **derived caches** (`rebuildCaches()`) and *those already are* the one-row-per-item model; the `source` column is what lets a Steam prune remove only Steam's entry ([[trakt-sync-completeness]]) → **KEEP**; ⑧ oversized blobs (= root cause, as a task).

| ID | Status | Task | Est. | Notes |
|----|:--:|------|:--:|------|
| **H2a** | ✅ | **Blob projection** — store a normalized projection at WRITE time instead of the raw payload | ~250k | **DONE 2026-07-16** (`2c4f688` projector+guard, `c62127d` wiring+migration). **raw_data 149.6MB → 35.4MB (-76.3%)**; tmdb 135.5→22.3MB (-83.6%); DB file 160MB → **42.4MB** after VACUUM. `src/lib/sources/project.ts` (`projectRawData` + `PROJECTION_VERSION`), applied at matcher's 4 write sites; **migration 7** adds `media_links.projection_version` + backfills by projecting the STORED blob in place (**no network** — the fat rows already contain everything kept). `ensure{Tmdb,Game}Detail` now key on the version stamp instead of **field-sniffing** (which a projection makes permanently "stale" → would've stampeded TMDB with ~1,472 refetches). VACUUM runs once in `db.ts` after any migration, OUTSIDE the runner (VACUUM can't run in a transaction) — frees 29,116 pages; without it the file stays 159.5MB. Litestream re-replicates the file once. **Guard: `projection.lossless.test.ts`** asserts `normalize(original) === normalize(projected)` over the real catalog (skips w/o data/rr.db) — it caught 4 real losses reading the code did NOT: rawg `background_image_additional` (wrong images on 704/722), tmdb `videos` filtering (**different trailer** on 289 titles — the pick is an order-dependent `find` with an "any YouTube video" last resort), `last_episode_to_air` (null show runtime), `origin_country` (null country). **Accepted:** 2 titles differ on the LEGACY debug-only `streamingProviders` via pickRegion's arbitrary `map[Object.keys(m)[0]]` last resort (only fires when country+US+GB all lack providers; US+GB are curated so the real chain is intact). **Re-run the guard after ANY change to project.ts or normalize.ts.** Old est. ~250k. |
| **H2b** | ✅ | **Discover persists at enrich time** → every item has a uuid → **delete** the source-id URL machinery → ungate `/discover` | ~200k | **DONE + DEPLOYED 2026-07-17** (`693113c` persistence+pool, `9449ecd` deletion+ungate, `37803dc` the upgrade-path fix). **Verified on fandex.org**: anonymous `/api/discover` 80/80 uuids (browse), 38/38 (search), 20/20 (load-more), no `raw` leaked; item page 200 with **no redirect hop**, 85KB SSR, `noindex` intact, no personal-data leak. **A LATE BUG worth remembering — every automated check passed while the feature was broken on a real db:** `CREATE INDEX … ON media_items(browsed)` sat in db.ts's CREATE TABLE block, which runs BEFORE `runMigrations`; on a FRESH db the column exists (all 154 tests, typecheck, lint, build, and the real-DB dry-run green), on an EXISTING one it throws and **aborts ensureSchema before the migration that adds it** → the db never migrates → `/api/discover` returned **22/80 uuids**. Only loading the real app against the real db found it (`schemaUpgrade.test.ts` now pins it; `getDb()` no longer caches a connection whose ensureSchema threw). `/api/discover` writes a row for every item it returns — from the provider LIST payload it already holds (**no network**) — and hands the uuid back as the item's `id`; `src/lib/discoverPersist.ts`. Then **deleted** `parseItemId`, `anyItemHref`, `ID_SOURCES`, `resolvePublicDetail`'s live branch, `persistLive` (create-on-view) + `mayPersist`, and itemUrl's source-id collapse (**−202/+103**). `/discover` ungated (it was UI-gated only; the API always allowed anon). **Scope decision: persist for ANONYMOUS callers too** (incl. search) — that's what allowed the FULL deletion; the write is still bounded by *the providers' catalogs* (we only ever store a payload a provider returned to one of our own queries — a caller picks *which* real titles, never the ids), rate-limited, and ~1KB/row post-H2a. **4 traps, none visible from the plan:** ① **the projection stamp** — `upsertMediaItem` stamped `PROJECTION_VERSION` at every write site, so a list payload would read as a full detail blob and `ensureTmdbDetail` would skip the refetch **forever** (every browsed item's page permanently rendering from ~1KB of list data). Thin writes stamp **0** + are **insert-only** (never degrade a stored blob) → `SourceItem.thin`. ② **the payload's source** — `traktToCandidate` labels candidates `source:"tmdb"` while holding a **Trakt** payload → `RawPayload` carries the provider it came FROM, else wrong projector/normalizer + no cross-id. ③ **`ensure{Tmdb,Game}Detail` never wrote the refresh back** (in-memory only; `tmdbRefreshed` was just a debug flag) → every browsed item would refetch TMDB on **every view, forever**. Now heals once (`storeRefreshed`, guarded on a uuid `mediaItemId`). ④ **the pool** — the recorded trap (IDF over all of `media_items`) was the *small* half: `getCache().vectors` also feeds `find()`/Best-match, Insights and `searchTitles` → **browsed items would appear as if you'd added them**; and `catalogSignature()` counts ALL of `media_items` → **every browse invalidated the cache → full catalog rebuild (parsing every `raw_data`) on the request path**. **Membership is NOT the filter** — `recommendIngest` persists unowned titles *on purpose* ("a real pool to rank, not just the watchlist") → **migration 8** adds `media_items.browsed` (provenance; DEFAULT 0 backfills every existing row correctly, no data pass) and the pool is `browsed = 0 OR id IN user_item_state` — the **union makes promotion automatic**, no flag to flip. **Guards:** `discoverPersist.test.ts` (canonical fields, cross-ids, the stamp, no-degrade, Trakt routing, idempotence) + `discoveryPool.test.ts` (pool in/out, ingest stays, promotion, no-demote, **+ a rebuild tripwire verified to fail when the signature is unscoped**). **Side effect (good):** `media_items` stops mirroring *the user's library* → **substantially dilutes the P13b privacy concern**. |
| **H2c** | ✅ | **Visible controls + login-with-intent** | ~150k | **DONE + DEPLOYED 2026-07-17** (`6afe601`, live-verified on fandex.org). Anonymous now sees the REAL stars + "Mark as watched" + a "+ Add to wishlist" affordance; interacting opens an in-page `SignInDialog`. **Not a literal popup** (agreed): providers are OAuth *redirects* (Trakt round-trips via trakt.tv), popup OAuth is fragile and breaks in the planned **TWA (P14–P16)** → one full-page round-trip instead. **Two same-origin channels carry state across the redirect:** ① **return PATH** rides a short-lived httpOnly cookie mirroring the OAuth nonce (`oauthState.ts`: `setOAuthReturnCookie`/`readOAuthReturn`/`clearOAuthReturn`) — the 4 start routes stash `?returnTo`, the 3 fresh-login callbacks (`oauthConnect.ts` trakt/letterboxd + custom steam/tmdb) honor it **on fresh login only** (linking keeps `/settings?connected=`) and clear it on every exit; **`isSafeReturnPath` is the open-redirect guard** — same-origin absolute paths only (rejects `//host`, schemes, `/\`), unit-tested for every bypass. ② **pending INTENT** rides `localStorage` (`pendingIntent.ts`) — never sent to the server, **path-guarded** + **once-only**, drained by `PersonalSection` exactly once when it first resolves to a signed-in viewer (covers both redirect providers AND the in-place RAWG login). **Notes:** anon wishlist intent is provider-less (`{kind:"wishlist"}`); the drain resolves the concrete provider from real `platforms` data after login (avoids a server-registry import in the client bundle). `SignInDialog` + `page.tsx` share one extracted `components/auth/AuthOptions.tsx` so they can't drift. The drain defers via `queueMicrotask` (the write handlers setState synchronously → cascading-render lint rule; microtask is the real fix). **Guards:** `oauthState.test.ts` (+13 cases: guard bypasses + cookie lifecycle) + `pendingIntent.test.ts` (round-trip, path-guard discard, corrupt/unavailable storage). **Live-verified** non-destructively (forced `/api/detail`→401 + client remount, no logout): real controls render, star-click stashes `{path,action:{kind:"rate",value:8}}`, both OAuth links carry `?returnTo=<item path>`, wishlist stashes `{kind:"wishlist"}`, Esc closes. Real OAuth round-trip not completed (return-cookie + drain are unit-tested). |

**⚠️ ORDER IS LOAD-BEARING: A → B → C.** B multiplies row creation (every browsed popular item persists). At 92KB/item that compounds the bloat; post-projection it's negligible. B-before-A = writing thousands of fat blobs we then have to migrate. C is independent and can interleave, but lands best once clicking a discover item works logged-out (= B).

See [[data-model-gaps-and-plan]], [[trakt-sync-completeness]], [[testing-and-migrations]], [[discovery-insights-rebuild]], [[platform-integration-architecture]], [[public-item-pages-p13]].

## Audit findings archive (D#/A#/U#/P#/S# — all resolved)

### ReleaseRadar — Improvements Document

Shared output of the Phase-1 audits (and later Phase-5 reviews). Each finding is a
proposal to **review and execute together in a future session** — nothing here has
been applied. Findings are id'd (`D#` data, `A#` architecture) like tasks so we can
pick them off individually.

**Severity:** 🔴 High (correctness/scaling risk) · 🟡 Medium (maintainability) · 🟢 Low (polish)
**Effort:** S (<½ day) · M (1–2 sessions) · L (multi-session)

Overall verdict: **the data *model* is a genuine strength** — identity-agnostic
`users` + `user_identities`, canonical `media_items` + per-source `media_links` + a
merge layer, and a now-complete `MediaSource`/`MetadataProvider` adapter split. The
issues below are mostly about *how state is stored within that model* and *a few
monoliths/duplications*, not the core shape.

---

## Part I — Data structure review (T16)

### D1 ✅ DONE (2026-06-14) — Per-source user state is JSON-in-a-column, not queryable rows
_Resolved with D2 in migration v3: `user_item_state(user,item,source,relation,status,rating,review,reviewed_at)` is the normalized truth; `user_library`/`user_watchlist` are caches rebuilt from it on every write. Per-source ratings are now SQL-queryable and the canonical rating can't drift; the library route's bespoke write goes through `recordLibraryRating`, fixing the un-propagated "clear a rating" case. Cache tables kept (expand-then-contract; dropping their JSON columns is a later step)._

Per-platform ratings/status/review live as a JSON blob in `user_library.metadata`
(`{ [source]: { rating, status, review, reviewedAt } }`), and `user_library.rating`
is a **denormalized average cache** that every read path recomputes
(`averageRating(parseRatings(metadata)) ?? row.rating` — see [ratings.ts](src/lib/ratings.ts), [libraryAnalysis.ts](src/lib/libraryAnalysis.ts:66)).
- **Why it matters:** the per-source ratings can't be queried/aggregated in SQL — every
  insight parses JSON in app code; the cache can drift from the blob; "clear a rating"
  is already a known un-propagated case.
- **Proposal:** add a normalized `user_item_state(user_id, media_item_id, source, status,
  rating, review, reviewed_at)` table (one row per source). The canonical `user_library`
  row becomes a thin cache/view derived from it. Aggregations (insights, "you vs crowd")
  move into SQL.
- **Trade-off:** more rows + a migration; for a personal-scale DB the win is consistency
  and queryability, not raw speed. Sequence this **before** T22 (country setting) and the
  Tinder feed (T10), which both want cleaner state queries.

### D2 ✅ DONE (2026-06-14) — `user_watchlist` and `user_library` are near-duplicate structures
_Resolved with D1: the four copy-paste twins now delegate to a single `setSourceState`/`clearSourceState` + `rebuildCaches` pair over `user_item_state`. Public signatures unchanged so callers (routes/ingest/sync/refresh) are untouched._

Both tables are `(id, user_id, media_item_id, platform_sources JSON, …, UNIQUE(user,media))`
and their helpers are copy-paste twins: `upsertWatchlistEntry`/`removeWatchlistSource`
vs `upsertLibraryEntry`/`removeLibrarySource` ([matcher.ts:181-302](src/lib/matcher.ts:181)).
- **Proposal:** either (a) unify into one `user_item(user_id, media_item_id, relation:
  'wishlist'|'library', …)` table, or (b) keep two tables but extract the shared
  `platform_sources` add/remove logic into one helper. (a) pairs naturally with D1.

### D3 🟡 S — Duplicated title-normalization with a hand-maintained invariant
`db.ts` backfills `norm_title` with an **inline** normalizer and a comment that it
"MUST stay in sync with `normalizeName()` in merge.ts" ([db.ts:157](src/lib/db.ts:157)).
Two copies of the same rule = a silent-duplicate-items bug waiting to happen if one drifts.
- **Proposal:** move `normalizeName` into a tiny dependency-free module (e.g.
  `src/lib/normalize.ts`) and import it in both `db.ts` and `merge.ts`. Removes the invariant.

### D4 ✅ DONE (2026-06-14) — No migration framework; schema changes are ad-hoc
_Resolved: `src/lib/migrations.ts` exports an ordered `MIGRATIONS` list + `runMigrations(db)` (each migration in its own transaction, bumps `user_version`). Pure-SQL bodies so the identical list runs both in-process (`getDb()`) and standalone against the live DB (`scripts/migrate.mjs`). user_version 1 stays the inline norm baseline; migrations start at 2._

`initDb()` does `CREATE TABLE IF NOT EXISTS` + a one-off `ALTER` + backfill inline
([db.ts:137-164](src/lib/db.ts:137)). This worked for one column but won't scale to an
evolving schema (and D1/D2 are real schema changes).
- **Proposal:** a minimal versioned runner keyed on `PRAGMA user_version` — an ordered
  list of migration steps applied once. ~30 lines; makes D1/D2/future changes safe and
  ordered.

### D5 ✅ DONE (2026-06-14) — Cross-ids are re-parsed from `raw_data` JSON on every match
_Resolved (migration v2): indexed `media_external_ids(media_item_id, source, external_id)`. `remergeItem` rebuilds an item's ids from its links; `findMatchingItem` does an indexed (namespace,id) lookup + indexed conflict check instead of parse-all-candidates — and now merges across title-spelling differences when a cross-id proves identity. Live backfill (4000 rows) via pure-SQL `json_extract`._

`findMatchingItem` loads every candidate link and `JSON.parse`s its `raw_data` to
recover cross-ids ([matcher.ts:107-116](src/lib/matcher.ts:107)). The match path is the
hot path during sync.
- **Proposal:** persist extracted ids in an indexed `media_external_ids(media_item_id,
  source, external_id)` table (written by `extractCrossIds` at link time). Matching
  becomes an indexed lookup instead of parse-all-candidates; also lets D1's queries join
  cleanly. Pairs with D4.

### D6 🟢 S — `libraryAnalysis` cache signature can miss edits
The analysis cache key is `COUNT, MAX(reviewed_at), SUM(rating)` ([libraryAnalysis.ts:159](src/lib/libraryAnalysis.ts:159)).
Two offsetting rating edits (e.g. 7→8 and 8→7) leave count/sum/max unchanged → stale cache.
- **Proposal:** include `MAX(rowid)`/a content hash, or bump an `updated_at` on every write.
  Low likelihood, easy fix.

### D8 ✅ DONE (with D3) — `normalizeName` strips hyphens without spacing (surfaced by A4 tests)
_Resolved 2026-06-13: normalize rule changed to hyphen→space (apostrophes dropped), centralized in
`src/lib/normalize.ts`, and all `norm_title` rows re-backfilled via a `user_version`-guarded migration.
Remaining edge case (out of scope): purely non-Latin titles (e.g. Cyrillic) still normalize to `""` and
rely on cross-id matching — unchanged from before._

`normalizeName` removes `[^a-z0-9 ]` entirely, so "Spider-Man" → `spiderman` while
"Spider Man" → `spider man` ([merge.ts:949](src/lib/merge.ts:949)). The two don't match, so the
same title formatted differently across sources can split into duplicate canonical items (cross-id
matching saves most real cases, but title+year fallback misses these).
- **Proposal:** replace hyphens/underscores/punctuation with a space before collapsing, so
  punctuation variants normalize equal. Cheap; pairs with D3 (centralizing the normalizer) and
  is guarded by the A4 tests. Re-backfill `norm_title` after changing it (one-off).

### D7 🟢 S — Missing child-FK indexes for cascade/reverse lookups
`user_library`/`user_watchlist` are indexed on `user_id` but not `media_item_id`; same for
the `ON DELETE CASCADE` from `media_items`. Negligible at personal scale, relevant if the
catalog grows. Add `idx_library_media`, `idx_watchlist_media`.

---

## Part II — Software architecture review (T17)

### A1 ✅ DONE (2026-06-14) — `merge.ts` (1006 lines) is a field-oriented switch monolith
_Resolved: per-source normalizers live in `src/lib/sources/normalize.ts` (one `normalizeX(raw,type) → SourceNormalized` per source, in a registry). `merge.ts` is now pure priority/union policy over those partials — no `switch(source)` anywhere. Adding a source = one normalizer + its entry in each field's priority list; zero edits to the merge body. Locked by a 7-snapshot characterization test (full `mergeLinks`/`explainMerge`/`mergeForCanonical` over rich movie/game/show fixtures) proving byte-identical output. Follow-up (A5): co-locate each normalizer with its adapter and fold the priority lists onto `catalog.ts`._

It's ~20 `extractX(source, data)` functions, each a `switch (source)` over all platforms
([merge.ts:37-207+](src/lib/merge.ts:37): extractTitle/Description/ReleaseDate/Poster/Images/
Tags/Platforms/Metacritic/Developer/…). Adding a source = editing *every* switch; the logic
for one platform is smeared across 20 places.
- **Why it matters:** this is the single biggest "not modular" item. The `MetadataProvider`
  registry already normalizes per-id fetches, but `merge.ts` still re-extracts from `raw_data`
  independently, so per-source knowledge lives in two places.
- **Proposal:** invert the axis — each source contributes a `normalize(raw) → Partial<Canonical>`
  (co-located with its adapter/metadata provider); `merge.ts` shrinks to a priority-merge over
  those normalized partials. New source = one normalizer, zero edits to merge. Do this as a
  staged extraction (one field-group at a time), not a big-bang rewrite.

### A2 ✅ DONE (2026-06-14) — `initDb()` is manually called in 24 files
_Resolved: schema setup runs implicitly in `getDb()` (private `ensureSchema`); all 24 manual `initDb()` calls + imports removed. `initDb()` kept as a deprecated alias for standalone scripts/tests._

Every route re-invokes `initDb()` ([24 call sites](src/app/api)); a new route that forgets
it fails at runtime.
- **Proposal:** make initialization implicit — run schema setup once inside `getDb()` (guarded
  by the existing `_initialized` flag) so callers can't forget. Removes 24 redundant calls.

### A3 🟡 M — `item/page.tsx` (790 lines) is a monolithic client component
Largest component in the app; per the platform memo it also **duplicates `PLATFORM_CONFIG`**
that otherwise lives in `watchlistStatus.ts`.
- **Proposal:** split into sections (hero / ratings / facts / credits / sources panels) and
  delete the duplicated config in favour of the registry capability layer. Natural fit for the
  Phase-3 UI/UX review (T18) and the detail-page redesign (T13).

### A4 🟡 M — No automated tests around the riskiest logic (merge/matcher)
The trickiest, highest-blast-radius code (canonical merge, cross-id matching) is covered only
by manual `scripts/*.ts` probes (`test-matcher.ts`, `verify-merge.ts`). The matcher has already
had a false-merge bug.
- **Proposal:** add a lightweight test runner (vitest) with fixtures for `findMatchingItem`
  (distinct same-title works stay separate; same-id merges) and `mergeForCanonical` priority.
  This is the safety net that makes A1 and D1 refactors safe to do.

### A5 🟢 S — Residual per-source string-literal switches outside the adapter layer
The account-driving code is now registry-driven (good), but `switch (source)` still appears in
`merge.ts`, `constants.ts`, `itemUrl.ts`, etc. A1 removes the bulk; the remainder (colors/labels/
url-params) can move onto the `catalog.ts` entries so a source's presentation is declared once.

### A6 🟢 S — Inconsistent error handling across API routes
Routes vary in how they validate auth/inputs and shape errors. Worth a one-pass convention (a
small `withUser(handler)` wrapper that resolves the session + returns 401 uniformly) — also
trims boilerplate. Revisit alongside A2.

---

## Recommended execution order
Foundations first (they de-risk everything else), then the big refactor:

1. **A4** (tests) — safety net before touching merge/matcher.
2. **D3 + A2** (S) — quick, removes two footguns.
3. **D4** (migration runner) — prerequisite for D1/D2/D5.
4. **D1 + D2** (normalized user state) — unblocks T22 / T10 and fixes the rating-cache drift.
5. **D5** (external-ids table) — speeds matching, cleans joins.
6. **A1** (merge.ts inversion) — staged, guarded by A4.
7. **A3 / A5 / A6 / D6 / D7** — fold into Phase-3 UI work and general cleanup.

> Open question for review: D1/D2 imply a real schema migration on `data/rr.db`. Want to do
> these against a DB copy first (as was done for the matcher fix), and keep a `.bak`?

---

## Part III — UI/UX review (T18)

Whole-project UX pass after the Phase-2 search/discovery rebuild. Code/behavior-based
(reading components + known runtime behavior); **not yet validated against live screenshots** —
a visual pass on the running app would add contrast/spacing/overflow findings this misses.
Findings id'd `U#`. Each notes which existing task it feeds (T11 cards · T12 nav-cache · T13
detail · A3 detail-split · A7 react-hooks) or is **NEW**.

**Severity:** 🔴 High (usability/accessibility blocker) · 🟡 Medium · 🟢 Low (polish)

### U1 🔴 — Quick actions (rate / wishlist) are hover-only → invisible on touch/mobile
PosterCard + ListCard reveal the rate bar + wishlist button only on `group-hover`
([PosterCard.tsx:77](src/components/PosterCard.tsx:77), [ListCard.tsx:70](src/components/ListCard.tsx:70)).
Touch devices have no hover, so on mobile/tablet you **cannot rate or wishlist from a card at all** —
the app's core action is unreachable without opening the detail page. Same for the hover tooltip.
- **Proposal:** show a compact always-visible affordance on touch (or a tap-to-reveal action row);
  detect coarse pointer. Feeds **T11**.

### U2 🔴 — Color-only encoding without text alternative (source dots; partial elsewhere)
Wishlist providers render as bare colored dots (`SourceDots`, [ItemBadges.tsx:26](src/components/ItemBadges.tsx:26))
with no label/icon — meaningless to anyone who doesn't memorize the palette, and invisible to
color-blind users. (Rating and type at least carry text.) T11 already wants source color-coding
**removed** from cards; replace with explicit **wishlist (bookmark) + library (owned/watched) icons**
in the corner so state is legible without color. Feeds **T11**.

### U3 🟡 — Type indicator is inconsistent across views
Card shows type only as a 0.5px bottom color **stripe** (no label/icon on the card face;
[PosterCard.tsx:67](src/components/PosterCard.tsx:67)); list row shows a `TypeBadge` text chip;
calendar uses a 1.5px dot. T11 calls for a **type tag + icon** (game/movie/show) with color coding
**consistently** everywhere. No type icons exist yet (only color). Feeds **T11**.

### U4 🔴 — Mobile navigation + tall sticky bar
NavBar is a single flex row of 6 links + Log out ([NavBar.tsx](src/components/NavBar.tsx)) with no
hamburger/overflow → wraps or clips on phones. And the now-unified `SubBar` stacks up to **4 rows**
(type/source chips · facets · year+membership · search+sort+view) — always visible — which on a
small screen eats most of the viewport before any results show.
- **Proposal:** responsive NavBar (collapse to a menu < md); on mobile, collapse SubBar's advanced
  rows behind a "Filters" toggle (keep always-visible on desktop per the T24 decision). NEW (mobile);
  pairs with T11/T12.

### U5 🟡 — Inconsistent loading / empty / error states
Loading is a skeleton on some pages (`ListSkeleton`/`CardSkeleton`) but plain "Loading…" /
`animate-pulse` text on calendar and `/foryou`; empty states are bespoke per page; quick-action
errors from `useQuickActions` aren't surfaced (no toast) while settings has its own inline notice.
- **Proposal:** shared `<EmptyState>` + consistent skeletons + a lightweight global toast for
  rate/wishlist failures. NEW; pairs with T11.

### U6 🟡 — Accessibility: icon-only controls lack labels; weak focus-visible
View toggles (`≡ ⊞ ▦`), sort `select`, clear `×`, the `/foryou` `✕`/`♥`, and the facet popover
toggle are icon/symbol-only; some have `title` but no `aria-label`, and most buttons have no visible
focus ring (only inputs set `focus:border`). Keyboard + screen-reader users are under-served.
- **Proposal:** add `aria-label`s, a global `focus-visible` ring, and ensure tab order. NEW;
  overlaps **A7** (react-hooks errors are in the same components).

### U7 🟡 — Images: native `<img>`, silent failure, no lazy/responsive
All posters use native `<img>` with `onError → display:none` (broken images just vanish, leaving a
blank tile) instead of a placeholder, and aren't `next/image` (no lazy-load/responsive sizing).
Posters are the heaviest content on every grid. (Also the standing `@next/next/no-img-element`
lint warnings.) NEW; pairs with T11/T13.

### U8 🔴 — Detail page density & scattered ratings (T13)
`item/page.tsx` (~790 lines) shows people as plain text rows (now `FacetLink`s, T7), **no profile
pictures**, and the user's rating, per-platform ratings, and crowd scores are in **separate**
sections rather than co-located. Hard to scan vs. TMDB/Letterboxd/IGDB. This is exactly **T13**
(card-view people w/ photos, co-locate user+source rating, reuse Insights tag color-coding) and
**A3** (split the monolith + drop the duplicated `PLATFORM_CONFIG`).

### U9 🟡 — Back-navigation loses state (T12)
Returning from the detail page to Wishlist/Library/Discover loses filters, sort, scroll position,
and the calendar's month (only Taste Match had a sessionStorage cache, now removed). This is **T12**;
it's more visible now that filters/sort/search carry more state. Confirms T12's priority.

### U10 🟢 — Source color-coding still used meaningfully in Settings
Settings uses `SOURCE_COLORS` as provider identity (connect buttons, avatars) — that's legitimate
and should **stay**. So "remove source color-coding" (T11) should be scoped to **item cards/rows**,
not a global purge. Note for T11 scope.

### U11 🟢 — Native `confirm()` for disconnect; no undo
Disconnect uses a blocking native `confirm()` ([settings/page.tsx:61](src/app/settings/page.tsx:61)) —
jarring vs. the app's styled modals (the RAWG connect modal shows the house style). Use an in-app
confirm dialog. NEW (polish).

### U12 🟢 — Low-contrast secondary text
Heavy use of `text-neutral-600`/`-700` on `neutral-950` (e.g. "TBA", day-of-week, dividers) is below
WCAG AA in places. Audit secondary-text contrast. NEW (polish); fold into T11/T13 styling.

### U13 🟢 — No shared Button/Chip primitives → style drift
Button/chip styling (`text-xs px-3 py-1.5 bg-neutral-800 …`) is copy-pasted across ~every page, so
variants already differ subtly. A tiny `<Button>`/`<Chip>` set would lock consistency and shrink the
JSX. NEW; pairs with **A5/A6** cleanup.

### Visual pass (live screenshots, 2026-06-14)
Drove the running app (logged in as a real user) across Discover / Library / Wishlist / Insights /
For You / Item-detail at desktop width. Two NEW findings + confirmations below.
(**Mobile not validated** — the browser resize didn't reflow the captured viewport below the `lg`
breakpoint, so U4's mobile claims remain code-based; worth a real device/devtools check.)

- **U14 🟡 NEW — the month side-nav doesn't scale to long-range lists.** On Library (releases span
  1991→2027) the right-hand month scrubber becomes a tall, cramped single column of ~every month
  (`Nov 91, Jan 94, Jan 95, Feb 96, …` ↓ dozens). It's designed for the ~18-month browse timeline,
  not a multi-decade library. **Proposal:** group the nav by **year (or decade)** when the span is
  large; only go month-granular within a short window. ([GroupedView.tsx](src/components/GroupedView.tsx) `MonthNav`). Feeds T11/T12.
- **U15 🟡 NEW — game cover art (landscape) is forced into the 2:3 portrait card → ugly crops.**
  Movies/shows have true portrait posters, but games use **landscape** Steam/RAWG header art; the
  poster card (and the `/foryou` swipe card) `object-cover` it into a tall frame, slicing the title
  (e.g. "Garry's Mod" → "rry's m"; Worms/Pokémon boxes mis-cropped). **Proposal:** detect art aspect
  (or per-type) and either letterbox games on a blurred bg or use a landscape tile for games. Feeds
  **T11** (+ /foryou).
- **Confirmations:** U2/U3 — cards show a ★rating badge + OWNED/PLAYED status text but **no type
  icon** and no distinct wishlist/library corner icon (status is text-only; source dots only when
  wishlisted). U8 — on the detail page the crowd scores sit by the title while **"Rate & Log" (your
  score) is far down a separate section** (not co-located). The unified filter bar **is** consistent
  across Discover/Library/Wishlist (T24 ✓), and Library/Wishlist now show proper skeletons.
- **Refinements:** the detail page is in **better shape than U8 implied** — it already has score
  badges, facts grid, screenshot strip, trailer; T13's real wins are (a) co-locate your rating with
  crowd scores and (b) people-with-photos for movies/shows. Also confirmed dev/publisher **do**
  appear on the live detail page (so **D9** is strictly about *stored* data for Insights/facets, not
  the detail view). Insights and For You look strong as-is.

### Suggested Phase-3 execution order (from this review)
1. **T11** (cards/list: type tag+icon, drop source color from cards, wishlist/library icons, touch
   actions [U1–U3], image placeholders [U7]) — highest visible payoff.
2. **T13 + A3** (detail redesign + split monolith [U8]) — the other big surface.
3. **T12** (back-nav state cache [U9]).
4. Cross-cutting polish: **U4** (mobile nav/bar), **U5** (states/toasts), **U6 + A7**
   (a11y + react-hooks), **U13/A5/A6** (shared primitives), **U11/U12** (confirm dialog, contrast).

> Open question for review: want me to do a **live visual pass** (drive the running dev server +
> screenshots of each page, desktop + mobile widths) to validate/extend these before executing T11?

---

## Part IV — Productionization readiness review (T19)

Target (confirmed 2026-06-18): **public website first, Android as a PWA/TWA wrapper** of that
same site. Findings are id'd `P#`; nothing here is applied. Same severity/effort legend as above.

**Overall verdict:** the app is a **single-node, single-disk, always-on-Node** application today,
and that's the *only* shape the current code supports. It's a clean fit for one small VPS/container
with a persistent volume — but it is **not** serverless- or multi-instance-ready, and the README's
"Deploy on Vercel" is actively misleading (`better-sqlite3` + a local file won't run there). The
single biggest decision (P1) is *which hosting model you commit to*, because most other findings
branch on it. Nothing here is a code-quality problem — the app runs — it's the gap between "runs on
my machine" and "survives a public, multi-user internet."

### Section A — Website launch

#### P1 🔴 L — SQLite local-file DB is single-node only; pick the hosting model first
`better-sqlite3` is a **synchronous native module** writing to `data/rr.db` on local disk (WAL).
Consequences: (1) **no serverless / edge** (Vercel/Netlify functions can't keep a file handle or a
warm process — rules out the README's suggestion); (2) **no horizontal scaling** — one writer lock,
one disk, so you cannot run two instances against the same data; (3) a **persistent volume** is
mandatory (the file must survive restarts/redeploys). For the expected scale (you + a handful of
users) this is *fine* on one always-on host. Two paths:
- **(a) Commit to single-instance hosting** (Fly.io / Railway / a VPS) with a mounted volume +
  backups (P5). Lowest effort, matches the code as-is. **Recommended for launch.**
- **(b) Migrate to Postgres** for real multi-instance scale. Large: rewrites `db.ts`, every
  `query/get/run` call site, the migration runner, and the in-memory caches (P2). Only worth it if
  you expect real traffic. **Decide P1 before P2/P4/P5/P6** — they all depend on the answer.

#### P2 🔴 M — In-memory module caches assume one long-lived process
~10 module-level `new Map()` caches: per-user **feed cache** (`liveDiscover.ts`, 45-min TTL), taste
**profiles** (`discovery.ts`), TMDB **person/company id** lookups (`discovery.ts`, `facetDetail.ts`),
facet/keyword caches (`tagDiscover.ts`). On one instance these are a *feature*. Problems for prod:
(1) **multi-instance → inconsistent per node** (P1b); (2) **serverless → cold every invocation**, so
the feed re-pays all its TMDB/RAWG detail fetches each time → latency + blows third-party rate
limits; (3) several are **unbounded with no eviction** (`_personIdCache`, `_tmdbCompanyCache`,
`_keywordCache` grow forever) → slow memory creep on a long-lived process. If you stay single-instance
(P1a), just add **bounded eviction/TTL**. If you scale (P1b), move them to **Redis** or drop them.

#### P3 🔴 M — `JWT_SECRET` silently falls back to a hardcoded, source-controlled default
`session.ts`: `process.env.JWT_SECRET || "change-this-in-production-rr2"`. If the env var is missing
in production, **every session is signed with a public secret** → anyone can forge a JWT for any
`userId` and impersonate any account. Must **fail-fast at boot** when unset in production rather than
degrade silently. (Cross-listed to T21 security.)

#### P4 🔴 M — No deployment artifact or documented process model
No Dockerfile, no `output: "standalone"` in `next.config.ts`, no Procfile/CI, and the README is
untouched create-next-app boilerplate. `npm start` (`next start`) needs a **persistent Node process**;
nothing documents the host, how the `data/` volume is mounted, how env is injected, or how the native
`better-sqlite3` binary is rebuilt for the runtime image. Need: a multi-stage **Dockerfile**
(`output: "standalone"`, rebuild better-sqlite3 for the target), a documented host (ties to P1), env
injection, and a real README/runbook replacing the boilerplate.

#### P5 🔴 M — No backup / restore story
All user data is one `data/rr.db` file. The only snapshots are manual `.bak-*` files from migrations
(good discipline — Phase 1.5) but there's **no automated backup, no off-host copy, no tested restore**.
Lost disk = total data loss. Need scheduled backups (e.g. **litestream** streaming to object storage,
or cron `sqlite3 .backup`) + a documented, *tested* restore procedure. Hard dependency on P1's volume.

#### P6 🟡 M — Synchronous in-request sync can exceed platform timeouts
`POST /api/sync` `await`s `syncProviders` (pulls **every** connected provider's full wishlist +
library, ingests + merges) inside the request, and the dashboard auto-fires it when sync is stale.
For large accounts (the D9 backfill saw **700+ game items**) this is many sequential external calls →
the request can blow past proxy/PaaS timeouts (typically 30–60s; serverless far less). Need a
**background job/queue** (or at least a server-side time budget + streamed progress) before public use.

#### P7 🟡 M — No rate limiting / abuse protection
No middleware, no per-IP/per-user throttle. Data routes are `withUser`-gated, but: account creation is
open (any OAuth connect), and the gated routes **proxy third-party APIs with *your* keys**
(`/api/discover?q=`, `/api/search`, `/api/detail/*` all hit TMDB/RAWG/Trakt/IGDB). An abusive client
can **exhaust your third-party quotas and run up cost**. Add rate limiting (middleware or a platform
WAF/edge limit) before exposing it publicly. (Cross-listed to T21.)

#### P8 🟡 M — Third-party fetches have no timeout / retry / circuit-breaker
Adapters call `fetch()` directly — no `AbortSignal.timeout`, no retry/backoff. A slow or hung upstream
blocks the request indefinitely (and via P6, the whole sync). One flaky provider degrades everything.
The discover *feed* tolerates an empty source, but **detail and sync are not isolated** against a
stalled provider. Add per-fetch timeouts + bounded retries + per-source failure isolation.

#### P9 🟡 S — Observability is `console.log` only; no health check, no error tracking
~20 `console.log/error` statements, nothing structured, no Sentry/aggregation, and **no `/api/health`**
(liveness/readiness probe for the host or uptime monitor). A production 500 (the `withUser` catch)
just vanishes into stdout. Add: a health endpoint, an error tracker, and structured request logging.

#### P10 🟡 S — Config read ad-hoc, no boot-time validation
`process.env.X!` / `|| fallback` scattered across modules (`TMDB_API_KEY!`, `RAWG_API_KEY!`, …). A
missing key fails deep inside a request rather than at startup. `.env.example` is solid, but add a
**single validated config module** that throws at boot listing every missing required var (and folds
in P3's fail-fast).

#### P11 🟡 S — Posters are native `<img>` from third-party CDNs (also U7)
`next.config` declares `images.remotePatterns` but **no code uses `next/image`** — every poster is a
raw `<img>` hotlinked to tmdb/rawg/steam CDNs. No optimization/resizing/bandwidth control; a CDN
policy change or outage = broken images app-wide; and it complicates the PWA offline story (P14).
Functional today, so lower priority — but relevant to cost, perf, and the Android wrapper.

#### P12 🟡 S — No SEO / discoverability primitives (website-specific)
No `robots.txt`, no sitemap, no `metadata`/Open Graph (pages are `"use client"` with minimal server
metadata), no canonical URLs. A public website wanting organic traffic / shareable links needs these.

#### P13 🟢 M — Client-only pages + query-param item URLs hurt shareability & first paint
Every page is `"use client"` and fetches on mount; `/item` identity is built into **query params**
client-side. For a public site: no SSR for shareable/crawlable links, weaker SEO, and a loading
spinner on every cold visit. Consider server components + clean route params (`/item/[id]`) for at
least the detail page.

### Section B — Android (PWA / TWA) — depends on the website being live

#### P14 🟡 M — No PWA manifest or service worker → can't wrap as a TWA yet
The standard "website → Play Store" path is a **Trusted Web Activity**, which requires an installable
PWA: a valid web manifest (name, icons 192/512, `theme_color`, `display: standalone`, `start_url`) and
a service worker over HTTPS. **None exist.** This is the entry ticket for the Android target and
confirms the **website-first** sequencing — it's built on top of a live site (P1–P13).

#### P15 🟡 S — Digital Asset Links + stable HTTPS origin required for TWA
Play Store TWA needs `/.well-known/assetlinks.json` binding the Android signing key to the web origin,
plus the site on a fixed HTTPS domain. Trivial to add once the **production domain + signing key**
exist — but a hard dependency on P4's finalized host decision.

#### P16 🟢 M — Verify the OAuth + cookie flow inside the wrapped app
Auth is OAuth redirects + an httpOnly `sameSite=lax` cookie. In a TWA (Chrome Custom Tab) the cookie
usually carries, but: redirect URIs in `.env.example` are hardcoded to `localhost` and must be
re-registered per provider for the production origin; some providers misbehave in webviews; and the
deep-link return / `sameSite` may need attention. Test each provider end-to-end inside a TWA before
shipping.

### Forward-flags to T21 (security)
Surfaced during this review, deferred to the security pass: **P3** (JWT default secret), **P7**
(rate limiting / quota abuse), plus **OAuth `access_token`/`refresh_token` stored apparently
plaintext** in `user_identities`, and the **RAWG password** path (`bcrypt`-hashed at
`api/auth/rawg` — one-way, so worth confirming how RAWG is actually authenticated downstream).

### Recommended execution order (T19)
1. **P1** — decide the hosting model (single-instance vs Postgres). Everything below branches on it.
2. **P3** — JWT fail-fast (tiny, security-critical, do immediately regardless of P1).
3. **P4 + P5** — Dockerfile/`standalone` + documented host + automated backups & tested restore.
4. **P10 + P9** — config validation at boot; health endpoint + error tracking.
5. **P6 + P7 + P8** — background sync, rate limiting, fetch timeouts (operability/cost/abuse).
6. **P2** — cache eviction (single-instance) or shared cache (if P1b).
7. **P11 + P12 + P13** — image strategy, SEO, SSR/clean URLs (website polish).
8. **P14 → P16** — PWA manifest/SW → asset links → TWA auth verification (Android, last).

> This is a review doc — nothing applied. Next Phase-5 task is **T21 (security analysis)**; this
> review's forward-flags feed into it. Suggest reviewing Part IV together before executing any P#.

---

## Part V — Security analysis (T21)

Threat model: **public launch** as a website + Android (PWA/TWA) wrapper, multi-user, internet-exposed,
attacker can hit any endpoint and craft any request. Findings id'd `S#`. Nothing here is applied
(except **P3**, the JWT-secret fail-fast, which was fixed during execution on 2026-06-18). Same
severity/effort legend.

**Overall verdict:** the **fundamentals are sound** — every SQL query is parameterized
(`better-sqlite3`, no string-built SQL → no SQL injection found); no `dangerouslySetInnerHTML`/`eval`
and React auto-escaping keep the XSS surface minimal; Steam OpenID is **properly verified** (a
`check_authentication` round-trip to Steam, not the naive "trust the claimed id" variant);
`/api/auth/me` does **not** leak tokens to the client; the session cookie is `httpOnly` + `sameSite=lax`
+ `secure`-in-prod (lax gives reasonable CSRF protection for the JSON POST routes). The real risks are
**credential handling at rest** (S2/S5), **account-linking not bound to the session** (S1), and the
**missing public-internet hardening** (rate limiting S3, security headers S6, session revocation S4)
that a single-user local app never needed.

### 🔴 High

#### S1 — OAuth/OpenID account-linking is not bound to the session (CSRF / forced linking)
The link target is taken from **attacker-controllable, unauthenticated input**, not the server session:
- Trakt/TMDB/Letterboxd: `state` is base64 **JSON `{userId, ts}`** — *unsigned*, no integrity, and the
  callback (`oauthConnect.ts`) trusts `state.userId` as the account to link the resolved identity to.
  `ts` is never checked (no expiry/replay protection).
- Steam: the callback reads `?link=<userId>` straight from the query string.

There is **no random state nonce tied to a cookie/session**, so the OAuth round-trip can't detect a
forged or replayed callback. Consequences: login-CSRF / **forced account linking** — an identity can be
attached to a `userId` the initiator doesn't own, and the connect flow can be CSRF-triggered against a
logged-in victim. (Mitigating factor: `userId`s are random UUIDs, not enumerable — but the design
should never trust a client-supplied userId for an authz decision.) **Fix:** derive the link target
**only from the server session**, and protect the round-trip with a random `state` nonce stored in a
short-lived httpOnly cookie and verified on callback (drop `userId`/`link` from the URL entirely).

#### S2 — OAuth access/refresh tokens stored plaintext at rest
`user_identities.access_token` / `refresh_token` are written and read in the clear (`oauthConnect.ts`,
`rawg/route.ts`). Combined with the single-file SQLite DB and **no backup encryption** (Part IV P5), any
read of `data/rr.db` (host compromise, leaked backup, stray copy) hands an attacker **full read+write
access to every user's connected Trakt/TMDB/RAWG account**. **Fix:** encrypt tokens at rest with an
app-level AEAD (key from env/KMS, separate from `JWT_SECRET`); decrypt only in memory at use. At minimum,
lock down DB-file perms + encrypt backups.

#### S3 — No rate limiting on auth + API-key-proxying endpoints (= P7)
No throttle anywhere. `/api/auth/rawg` takes **email + password** → unthrottled **credential brute-force /
stuffing**. The `withUser` data routes proxy TMDB/RAWG/Trakt/IGDB with **your** keys
(`/api/discover?q=`, `/api/search`, `/api/detail/*`) → an authenticated abuser can exhaust your
third-party quotas and run up cost. **Fix:** per-IP + per-account rate limits (middleware / platform
WAF), strictest on the password endpoint. Shared with Part IV P7.

### 🟡 Medium

#### S4 — JWT sessions are stateless and unrevocable
30-day expiry; `logout` only clears the cookie; `disconnect` doesn't invalidate sessions. A **stolen
token stays valid for 30 days** with no server-side kill switch. **Fix:** shorter access-token lifetime
+ refresh, or a server-side session/revocation store (a `sessions` table, or a per-user token-version
claim checked on each request).

#### S5 — RAWG stores a bcrypt hash of the user's password — pointless and harmful
`rawg/route.ts` stores `bcrypt(password)` in `metadata`, but it's **never used** — auth uses the `token`
returned by `rawgLogin` (which is itself stored as `access_token`). So the hash is dead weight *and* an
**offline-crackable hash of the user's RAWG password** (commonly reused elsewhere) sitting in the DB.
The UI's "Your password is encrypted before storage" is misleading (the *real* credential, the token, is
plaintext — see S2). **Fix:** **don't store the password or its hash at all**; keep only the token
(encrypted per S2).

#### S6 — No security headers
No middleware / `headers()` config → missing **CSP, HSTS, X-Content-Type-Options,
X-Frame-Options/`frame-ancestors`, Referrer-Policy**. Public-website clickjacking, MIME-sniffing, and
transport-downgrade gaps. **Fix:** set them via `next.config` `headers()` or middleware; CSP must allow
the poster CDN hosts (ties to Part IV P11's `next/image` work).

#### S7 — Missing ownership check on `watchlist` DELETE (authz invariant)
`DELETE /api/watchlist` accepts an arbitrary `mediaItemId` and issues platform-removal calls
(`media_links` for that id) **without verifying the item is on the caller's watchlist** — the local
delete is correctly scoped to `session.userId`, but the provider-side write-back loop runs first on a
caller-supplied id. Impact is bounded to the caller's own linked accounts/tokens, so it's not a
cross-user breach, but it's a missing authz invariant + lets a user act on arbitrary media-item ids.
**Fix:** assert the `mediaItemId` belongs to `session.userId` before any action, and do a quick
**systematic authz pass** confirming every read/write route scopes by `session.userId` (spot-checks so
far — me/library/disconnect/watchlist-local — all do).

#### S8 — No schema validation at the API boundary
Routes use `await req.json()` with ad-hoc presence checks; malformed/wrong-type input becomes a 500 or
type-confusion deep in a handler. **Fix:** validate each route body with a schema (e.g. zod) at the
boundary; reject with 400 + a generic message.

#### S9 — Error-message leakage on `/api/auth/rawg`
Returns the upstream `e.message` (`rawgLogin` failure) verbatim to the client — can expose internal /
third-party detail. (The shared `withUser` path is already generic — this route predates it.) **Fix:**
generic client message, log detail server-side.

### 🟢 Low

#### S10 — Dependency posture
`npm audit` (prod deps): **2 moderate** — PostCSS "XSS via unescaped `</style>` in stringify output",
pulled in transitively by Next's bundled toolchain. Build-time, low runtime risk for this app; the
suggested fix is a **Next downgrade — do NOT apply**. **Fix:** add `npm audit` to CI + Dependabot/Renovate
and adopt a clean Next patch when available.

#### S11 — JWT payload is signed, not encrypted
The session token is readable (base64) by anyone holding it and includes `displayName`. Not currently
sensitive, but **keep the payload minimal** — never add emails/tokens/PII to it.

#### S12 — Stored `posterUrl` is unvalidated and reflected as `<img src>`
`watchlist` POST accepts a client `posterUrl`, stores it, and it's later rendered as an image source.
Browsers don't execute `javascript:` in `img src` and the server never fetches it (no SSRF), so impact
is low — but **validate it's an `https://` URL on an allowed CDN host** (pairs with the S6 CSP `img-src`).

#### S13 — IGDB query built by string interpolation (light escaping)
`searchIgdbGames` builds an Apicalypse query with `search "${title.replace(/["\\]/g," ")}"`; numeric
args are `Math.floor`'d. Low risk, but prefer stricter input sanitization / a query builder for the
non-parameterized IGDB API.

### Confirmed-good (don't re-litigate)
Parameterized SQL throughout (no SQLi); no `dangerouslySetInnerHTML`/`eval` (minimal XSS surface);
Steam OpenID verified via `check_authentication`; `/api/auth/me` returns no tokens; session cookie is
`httpOnly`+`sameSite=lax`+`secure`-in-prod; `disconnect` is `session.userId`-scoped and blocks removing
the last login; **P3 JWT-secret fail-fast fixed 2026-06-18**.

### Recommended execution order (T21)
1. **S2 + S5** — encrypt tokens at rest; stop storing the RAWG password hash. (Credentials first.)
2. **S1** — bind account-linking to the session + add a state nonce. (Auth integrity.)
3. **S3** — rate limiting, strictest on the password endpoint. (= Part IV P7.)
4. **S6 + S4** — security headers; session revocation/short expiry.
5. **S7 + S8** — ownership check + boundary schema validation.
6. **S9 / S10 / S11 / S12 / S13** — polish + dependency hygiene.

> Review doc — nothing applied beyond P3. Suggest reviewing Parts IV + V together, then executing the
> combined go-live work (Phase 6 in [TASKS.md](TASKS.md)) in the recommended order.

## Bug tracker archive (both entries resolved)

### ReleaseRadar — Bug Tracker

This file is the **bug collection** — Claude reads/writes here.

---

## Data Bugs
- ~~Merging wrong movies between databases~~ (Warriors of the Wind, item `17aa124c…`, tmdbId 81) — **NOT A BUG (investigated 2026-06-14).** The item has a single, correct TMDB link (id 81). TMDB itself returns `title: "Warriors of the Wind"` with `original_title: 風の谷のナウシカ` (Nausicaä) and `imdb_id: tt0087544` (Nausicaä) — i.e. one film, with TMDB serving an alternate English title for the configured language. No two movies were merged. → If the localized title is undesirable, that's a TMDB `language`/region concern tied to **T22** (country setting), not the matcher.
- ~~Studio ratings in Insights missing a lot of data (Bethesda Softworks / Fallout 4)~~ — **investigated 2026-06-14; split in two:**
  - **(A) display — FIXED:** Insights "Game studios" column filtered to `role==="developer"` only, so publishers (Bethesda Softworks publishes Fallout 4; dev is Bethesda Game Studios) never showed. [InsightsView.tsx](src/components/insights/InsightsView.tsx) `gameStudios` now includes both `developer` + `publisher` (matches the section subtitle).
  - **(B) data coverage — root cause, → TASKS.md (D9):** only **3% of library games (24/713)** carry any developer/publisher in stored `raw_data`, vs 99% of movies/shows. Game sync persists *list* payloads (Steam owned-games = `appid/name/playtime`; RAWG list lacks `developers/publishers` — those are detail-endpoint-only). Needs the sync/enrich pipeline to fetch+persist game detail (or a backfill). Tracked as **D9**.

## Search Bar Bugs & improvements
> **Triaged 2026-06-14 → TASKS.md.** Consistency + filter pruning + "search on any filter" → **T24**; the sort-options redesign + sort-driven result layout (rating dividers/scrollbar, calendar only for date sorts) → **T8** (rewritten). Both have full spec blocks under the Phase 2 table. No code changed yet.

- Search bar component remains inconsistent:
  - when entering a search query in the discovery version it shows
    - the sort dropdown - sort dropdown not available in wishlist/ library
    - additional filters (in library, year, etc) → these should be always visibile as part of the filter options above (facet filters, type, source)
- some filters can be removed: source filter (tmdb, trakt etc), "Community", Runtime
- the sort options should be adjusted. it should only contain these sort options: 
  - Release date (newest first), 
  - Release date (oldest first)
  - Rating (user rating), 
  - Rating (platform rating): calculates an average score based on data bases (imdb, tmdb, metacritic, etc), 
  - Best Match: validates items in the current list based on how well they match the users preferences (might require a "user preference" analysis if not already existing)
- the sort option should be always available not just after entering a query
- the items results should adjust based on the sort algorithim:
  - release date (newest first): current timeline approach (but reversed)
  - release date (oldest first): current timeline approach
  - rating: replace month scroll bar on the side with a rating scroll bar, replace month dividers with rating dividers (remove calendar view as view option - keep just list and card view)
  - best match: normal scroll bar. best match at the top of the list (remove calendar view as view option - keep just list and card view)
- The search should already start as soon as a filter was applied (remove calendar view as view option - keep just list and card view)


---

## Open decisions
1.

## Changelog
- _2026-06-14_ — Triaged the 2 logged bugs. Bug 1 (Warriors of the Wind) = not a bug (TMDB alt-title; relates to T22). Bug 2 (studios) = display half fixed in InsightsView (publishers now shown); data-coverage half tracked as **D9** in TASKS.md.
- _2026-06-14_ — Triaged the Search Bar section → **T24** (consistency + remove source/Community/Runtime filters + search-on-filter) and **T8** (5-option sort set + new platform-avg & user-rating sorts + sort-driven result layout). Specs in TASKS.md.