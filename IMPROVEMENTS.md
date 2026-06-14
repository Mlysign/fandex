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
