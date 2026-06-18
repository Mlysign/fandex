# ReleaseRadar — Improvements Document

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
