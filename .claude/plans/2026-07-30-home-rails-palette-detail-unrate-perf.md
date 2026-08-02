# Fandex — Home rails, randomised stats, tag QA, facet palette, item-detail rebuild, unrate/wishlist fixes, perf audit

## Context

Nils reviewed the live app and raised six clusters. Grounding each against the code first, because
four of the six turn out to be different problems than they look like from the outside:

1. **Home's rails don't do what their labels claim.** [api/home/route.ts](../../src/app/api/home/route.ts)
   pulls **page 1 only** of RAWG `-added` + TMDB `discover` movie/tv over an **18-month FUTURE
   window** ([discoverFeed.ts](../../src/lib/discoverFeed.ts) `dateWindow("future")`), then:
   - **Popular** re-sorts that pool by `communityScore` (= `voteAverage × 10`) — so it's
     "best-*rated* unreleased titles", never trending, and page 1 + a fixed sort makes it
     near-identical every day. It cannot match TMDB *Trending* or Trakt *Trending*, which are
     both **released-title, watch-activity** lists. The mockup even names this rail **"Popular
     right now"** ([home.html](../../docs/design/fandex-handoff/04-pages/home.html)).
   - **Upcoming** takes the *same* page-1 pool, filters `releaseDate >= today` and sorts by date
     ascending. It does **not** use the calendar's algorithm, so it has no cross-source
     normalisation and skews to whichever provider has the most near-dated rows.
   - **Recommended for you** = `personalizedFeed()` ([liveDiscover.ts](../../src/lib/liveDiscover.ts)) —
     a wide (5 pages/source, ~200/type) pull of **upcoming** titles, taste-ranked by the *local*
     facet model (not TMDB `/recommendations`, not raw Fandex Score), `.slice(0, 15)` off a
     `score`-desc sort, cached 45 min per `userId:region`. Deterministic top-15 → same faces.
2. **The stats strip is static by construction:** three counters plus `pickBestGenre()`
   ([libraryAnalysis.ts:234](../../src/lib/libraryAnalysis.ts)) — one hard-coded highlight, forever.
3. **Nothing exercises the tag-taxonomy round trip.** Two of the three most recent tag bugs were
   exactly this path (a reassigned tag keeping its old heading; a tag overridden into an
   admin-created category *vanishing* because the display loop iterated the static 9-entry
   `CATEGORIES` const against a live 10-row table). [smoketest.md](../../smoketest.md) has no tag steps.
4. **The palette really is "all over the place": 17 unrelated hues.** 8 in `ROLE_COLORS`
   ([constants.ts:29](../../src/lib/constants.ts)) — pink/purple/indigo/cyan/green/yellow/orange/blue —
   plus 9 in `CATEGORIES` ([tags.ts:24](../../src/lib/tags.ts)), none related to the brand gold `#C8A24B`.
5. **The item-detail mockup is mobile-only** — five 360px frames, no desktop frame
   ([item-detail.html](../../docs/design/fandex-handoff/04-pages/item-detail.html)). The live page is a
   `lg:grid-cols-[minmax(0,420px)_1fr]` split with a 2/3-column facts grid inside the right column
   and a full-width `LowerSections` band underneath — three different rhythms stacked, which is the
   "jagged" web layout. It shares almost no anatomy with the mockup.
6. **Unrate was never wired, not broken.** `StarPicker`
   ([ActionCells.tsx:39](../../src/components/ActionCells.tsx)) types `onPick: (n: number) => void` and
   every star passes `1..10`; `useQuickActions.rate(n: number)` likewise. Meanwhile the *whole
   backend* for it exists and is unused: `IntentAction` already allows `{kind:"rate", value: null}`,
   `PersonalSection.handleRate` takes `number | null`, `/api/library` POST branches on
   `rating === null` → `src.clearRating(...)`, and `recordLibraryRating` nulls the rating while
   keeping `status`. So: no UI path can ever send `null`.
   **And rating an item does not touch the wishlist** — nothing in `/api/library` POST calls
   `clearWatchlist`.

Intended outcome: Home's three rails do what they say and change over time; a rotating stats strip
built from the taste data already in memory; the tag workflow is covered by the smoke plan; one
4-colour gold-family facet palette; an item page that matches its mockup on mobile and has one
consistent rhythm on desktop; unrate works and rating clears the wishlist; and a written,
measured performance audit with the safe wins implemented.

**Decisions taken with Nils (this session):** Popular → real trending incl. released titles ·
counters combined into one strip + 2 daily-rotating highlights · rebuild mobile to the mockup and
derive desktop from it · perf = audit doc + safe wins only.

---

## 1. Home — what the carousels pull

### 1a. `Popular` → real cross-source trending (`Popular right now`)

New fetchers in [discoverFeed.ts](../../src/lib/discoverFeed.ts), each returning `FeedCandidate` exactly
like the existing ones (so `decorateSection`/`persistDiscoverBatch`/`annotateUserState` and
`PosterCard`'s quick actions keep working unchanged):

- `fetchTmdbTrendingMovies(page)` / `fetchTmdbTrendingShows(page)` — `/3/trending/{movie,tv}/week`.
  Same field mapping as `fetchMoviePage`/`fetchShowPage` (`popularity`, `vote_average`,
  `vote_count`, `genre_ids` → `tmdbGenreNames`).
- `fetchTraktTrendingMovies(page)` / `fetchTraktTrendingShows(page)` — `/movies/trending`,
  `/shows/trending` in [sources/trakt.ts](../../src/lib/sources/trakt.ts), mirroring
  `getTraktAnticipatedMovies`. Reuse `traktToCandidate` but **without** the future-window filter
  (trending is mostly released) and set `popularity` from the entry's `watchers` count — Trakt
  trending *does* carry a per-item reach metric, unlike anticipated (which correctly sets `null`).
- `fetchRawgTrendingGames(page)` — `games?dates=<today-60d>,<today>&ordering=-added`; games have no
  trending endpoint, recent-and-most-added is the honest equivalent.

Ranking: reuse the median-of-own-bucket normaliser rather than writing a second one. Rename
`rankPopularMonth` → **`rankCrossSourcePopularity`** in [popularMonth.ts](../../src/lib/popularMonth.ts)
(the logic is already source-generic; only the name says "month"), update the calendar route +
[popularMonth.test.ts](../../src/lib/popularMonth.test.ts), and add a doc line that it now serves two
callers. **Do not** re-balance into per-type quotas — that is an explicit standing decision.

### 1b. `Upcoming` → the calendar's algorithm, shared code not a copy

Extract `candidatesForMonth()` + its 6h `BoundedCache` out of
[api/calendar/popular/route.ts](../../src/app/api/calendar/popular/route.ts) into
**`src/lib/popularMonthFeed.ts`**. Home's Upcoming rail then = `candidatesForMonth(thisMonth)` +
`candidatesForMonth(nextMonth)`, through `upcomingFrom()` ([upcoming.ts](../../src/lib/upcoming.ts) — the
one shared definition of "upcoming", per SM18), re-ranked with `rankCrossSourcePopularity` and
date-sorted for display. Home and `/calendar`'s Popular chip then share one cache and one ranking,
which is what "same algorithm" has to mean to stay true over time.

### 1c. `Recommended for you` → same engine, real rotation

Keep the local taste engine (that *is* the product's differentiator; TMDB `/recommendations` would
throw away the cross-media Fandex model). Add variety:

- `personalizedFeed` already ranks ~54 items (`FINAL_KEEP = 18` × 3 types). Return the full ranked
  list from the cache and let the route pick the rail from a **wider head** (top ~40) using a
  date-seeded deterministic shuffle, so day-to-day the rail differs while strong matches stay
  likely.
- New `src/lib/dailyRotation.ts`: `seedFor(userId, dayISO)` + a tiny mulberry32 PRNG +
  `pickWeighted(items, n, rng)` (rank-weighted so the top of the list is favoured, not uniform).
  One module, reused by 1a, 1c and §2.
- Key the 45-min `_feedCache` unchanged; rotation happens **after** the cache read, so it costs no
  provider calls.

### 1d. Route + caching

[api/home/route.ts](../../src/app/api/home/route.ts) becomes: `trending` / `upcoming` (both public,
region-keyed) + `recommendation` (per-user) + `stats`. Add a `BoundedCache<string, …>` for the two
public rails keyed by `region:dayISO` with a ~30 min TTL — Home is a **public** route, so today it
re-hits three providers on every anonymous view and crawler hit. Keep PR15's session gate:
`persistDiscoverBatch(..., userId)` must stay so an anon view mints no `media_items` rows.

Rail titles in [page.tsx](../../src/app/page.tsx): "Popular right now" (per mockup) / "Upcoming" /
"Recommended for you". `/profile` also consumes `/api/home`
([ProfilePageClient.tsx:72](../../src/app/profile/ProfilePageClient.tsx)) — update its field names too.

---

## 2. Home — randomised stats

**Strip 1 (always):** the mockup's single segmented panel — one bordered panel, three cells with
`border-left` dividers (`.stat3` in [home.html](../../docs/design/fandex-handoff/04-pages/home.html)):
Library · Wishlist · Rated. Replaces today's three separate `StatTile`s. New
`src/components/ui/StatStrip.tsx`; `StatTile` stays for other callers.

**Strips 2 & 3:** two highlight panels (eyebrow + serif value + mono detail line, per the mockup's
best-genre panel), drawn daily via `seedFor(userId, dayISO)` from these generators — all seven of
Nils's examples, every one computable from caches already in memory, **zero new queries and zero
provider calls**:

| Generator | Source |
|---|---|
| Your top `<category>` (e.g. *top setting: Steampunk*) | `facets` where `kind==="tag" && category===c`, max `ba`, `count >= MIN_TAG_COUNT` — `pickBestGenre` generalised to any category |
| Your highest-rated `<role>` (e.g. *Director: Tim Burton*) | `kind==="person" && role===r`, max `ba` |
| Your most-watched `<role>` | same, max `count` |
| Your most-watched `<category>` | tag in category `c`, max `count` |
| Your highest-rated `<tag>` item | needs a new `topItemByFacet: Map<facetId, {id,title,posterUrl,rating}>` on `LibraryFacetAnalysis`, filled **inside the existing per-item facet loop** in `analyzeLibraryFacets` — no extra pass, no extra query |
| *Because you like `<tag>`* → recommendation | `itemsWithFacet({kind:"tag",key})` ([discovery.ts:829](../../src/lib/discovery.ts)) minus `libraryIds`/wishlist, max `computeFandexScore(v.facets, profile)` |
| *Because you like `<person>`* → recommendation | same with `kind:"person"` |

New `src/lib/homeHighlights.ts`: `buildHighlights(userId, dayISO, n = 2)` → `{ eyebrow, value,
detail, href? }[]`. Each generator returns `null` when the library can't support it (too few rated
items, no facet clears `minCount`); the picker draws from whatever is non-null, never repeats a
generator within a day, and falls back to the current best-genre card if fewer than two resolve.
Recommendation highlights link to the item; stat highlights link to the facet page.

*Assumption:* "not in the library" for the two recommendation highlights excludes **library and
wishlist** — a wishlisted title is already known to you, so surfacing it as a discovery would read
as a bug. Easy to relax to library-only if you'd rather.

Unit tests for `buildHighlights` (deterministic given a fixed seed) and `topItemByFacet`.

---

## 3. Tags — smoketest coverage

Add a section **"F. Tag taxonomy round trip"** to [smoketest.md](../../smoketest.md) (the plan file;
findings still go to TASKS.md as `SM#`). Steps, in order, with the assertion for each:

1. `/dev/scoring` → Taxonomy → create a category by **label only** (id is derived — T5); assert it
   appears in the list and in `GET /api/dev/scoring/categories`.
2. `TagTable` → reassign one real tag (e.g. `steampunk`) to it via the inline dropdown.
3. `/tag/steampunk` → the category chip shows the **new** label + colour
   ([PublicFacetView.tsx:262](../../src/components/facet/PublicFacetView.tsx)).
4. An item carrying that tag → the chip lists under the **new** heading, and the inline
   `TagCategoryPicker` on that same chip agrees with the heading. *This is the exact pair that
   disagreed until 2026-07-30 — and the harder half: a tag in an admin-created category must not
   **vanish** (the static-`CATEGORIES` bug); `groupTagsByCategory`'s `FALLBACK_CATEGORY_ID` path.*
5. `/insights` → a panel for the new category appears, containing that tag, **without a server
   restart** (proves `scoringConfigSignature()` busts both `getLibraryFacetAnalysis`'s and
   `buildProfile`'s caches).
6. **Revert:** move the tag back to its original category, delete the new category.
7. **Reverse sweep:** re-check 3/4/5 — chip back under its original heading, no orphan panel on
   Insights, and (the trap) any tag still pointing at the deleted category buckets into *Other*
   rather than disappearing.

---

## 4. Design — one 4-colour facet palette

New tokens in [globals.css](../../src/app/globals.css) (dark + light blocks), all in the gold hue family
around the brand `#C8A24B`:

| Token | Applies to | Value |
|---|---|---|
| `--color-facet-genre` | genre tags | `#C8A24B` (brand gold) |
| `--color-facet-tag` | **every other** tag category | `#B9A06A` (muted sand-gold) |
| `--color-facet-person` | director/creator/writer/cast | `#DDB264` (light warm gold) |
| `--color-facet-company` | developer/publisher/studio/network | `#B08150` (bronze) |

New `src/lib/facetPalette.ts` → `facetColor({ kind, role, category })` returning the CSS var, and
the one place that mapping lives. Then replace every per-category / per-role colour read:

- [insights/FacetSection.tsx](../../src/components/insights/FacetSection.tsx) (`colorOf`, group dots, `StatBar`)
- [item/FandexScoreSection.tsx](../../src/components/item/FandexScoreSection.tsx) (`reasonColor`)
- [discovery/MatchReasons.tsx](../../src/components/discovery/MatchReasons.tsx) (`color`)
- [item/LowerSections.tsx](../../src/components/item/LowerSections.tsx) (the `${g.color}22` chips)
- [facet/PublicFacetView.tsx](../../src/components/facet/PublicFacetView.tsx) (the category chip)

**Note the alpha trick:** those chips build fills as `` `${color}22` `` (hex + alpha suffix), which
breaks on a `var(...)`. Export each colour as **both** a hex constant and a token, and give
`facetPalette.ts` a `facetChipStyle(...)` helper returning `{ background, color }` so no call site
has to know. Verify each colour ≥ 4.5:1 against `#100E0C` for the small chip text (`#B08150` is the
one at risk; lighten to ~`#C08D58` if it fails).

Keep `CATEGORIES[].color` and `tag_category.color` in the DB so nothing breaks, but **display stops
reading them** — and remove the colour `<input type="color">` from
[TaxonomyPanel.tsx](../../src/app/dev/scoring/TaxonomyPanel.tsx)'s create form, showing the derived
class colour instead, so the admin swatch can't imply a per-category colour that no longer exists.
Update `CATEGORIES`/`DEFAULT_TAG_CATEGORIES` seeds + a migration rewriting existing
`tag_category.color` rows to the two tag values, so a fresh DB and an upgraded one agree.

`SOURCE_COLORS` and the three media-type accents (`--color-media-game/movie/show`) are **out of
scope** — different axis, and the tokens file marks them "SHIPPING VALUES — do not retint".

---

## 5. Item detail — rebuild to the mockup

### Mobile (`< lg`) — the mockup's anatomy, in order

1. **Hero** (new `src/components/item/DetailHero.tsx`): full-bleed poster, `aspect-3/4`, bottom
   gradient scrim; overlay top row = back circle (left) + share circle (right); overlay bottom =
   type dot + label eyebrow, serif title (`text-serif-2xl`), mono meta line (`year · runtime ·
   dir. X`). **`Save` stays out of the hero overlay** and remains in the Rate/Save pair below —
   ItemView's SSR guarantee is that nothing above `PersonalSection` may depend on a session, and
   the mockup renders Save in both places anyway. Share = `navigator.share` with a copy-link
   fallback.
2. **Fandex Score panel** — [FandexScoreSection](../../src/components/item/FandexScoreSection.tsx)
   already matches the mockup; unchanged.
3. **Rate it / Save pair** — already matches; unchanged.
4. **★ community line** — `RatingsSection`'s scores row.
5. **Synopsis.**
6. **Cast rail** — restyle `CastCard` to the mockup's `.castav`: 64px **circular** avatar, name,
   character, 74px column (today it's a portrait poster-style card).
7. **Facts as key/value rows** — replace `FactsSection`'s credit chips + `grid-cols-2 sm:grid-cols-3`
   with the mockup's `.fact` row (`border-top`, label left secondary, value right), including
   Director/Studio and a right-aligned Tags row. This is the single biggest source of the ragged
   look at mid widths.
8. **Where to watch** — provider **rows** (logo block, name, "Stream · included") instead of
   today's chip cloud.
9. Trailer / DLC / Tags & details / Links keep their content, restyled to one section rhythm and
   the new eyebrow style.

*Out of scope, as the mockup itself states:* the **More-like-this** rail ("Recommendation logic out
of scope — placeholder rail", 05-DELTA b). Flagged as a follow-up now that `itemsWithFacet` +
`computeFandexScore` could actually feed it cheaply.

### Desktop (`lg+`) — derived, not a second design

Keep two columns, but: gallery column `max-w-[380px]` and `sticky top-…`; right column runs the
**same section order** as mobile with **one** vertical rhythm token; prose capped at `max-w-[68ch]`;
`LowerSections` becomes a full-width band below with section headers matching the right column's.
No 2/3-column facts grid at any width — the fact rows scale.

Files: [ItemView.tsx](../../src/components/item/ItemView.tsx) (composition), new `DetailHero.tsx`,
[FactsSection.tsx](../../src/components/item/FactsSection.tsx), [LowerSections.tsx](../../src/components/item/LowerSections.tsx),
[MediaGallery.tsx](../../src/components/item/MediaGallery.tsx), [primitives.tsx](../../src/components/item/primitives.tsx) (`Fact`).

---

## 6. Features

### 6a. Unrate

- `StarPicker` ([ActionCells.tsx:39](../../src/components/ActionCells.tsx)): widen to
  `onPick: (n: number | null) => void`; clicking the **currently selected** star calls
  `onPick(null)`, with `aria-label="Remove your rating"` on that star and a hover title saying so.
- `useQuickActions.rate(n: number | null)`: optimistic `setRating(null)`, POST `{rating: null}`.
  Leave `status` alone — clearing a rating keeps the item watched/played, which is what
  `recordLibraryRating`'s null branch already does. (`toggleWatched` remains the "remove from
  library entirely" affordance.)
- `PersonalSection.onPickStar`: pass `null` straight through; the anon path stashes
  `{kind:"rate", value:null}` — `IntentAction` **already** permits it, and `handleRate` already
  takes `number | null`. No API change needed.
- **The one real gap:** TMDB and Trakt implement `clearRating`; **RAWG does not**
  ([adapters/rawg.ts](../../src/lib/sources/adapters/rawg.ts) has `pushRating` only, via `/api/reviews`).
  So a cleared **game** rating would be resurrected by the next RAWG pull, which reads
  `user_rating`. Add `deleteRawgReview()` to [sources/rawg.ts](../../src/lib/sources/rawg.ts) +
  `clearRating` on the adapter (find the user's review for the game, `DELETE /api/reviews/{id}`).
  If RAWG's API won't allow it, **do not ship silently** — surface a toast on games and record the
  limitation in `PLATFORMS.md`. Adapter work, so main-loop per AGENTS.md's routing rule.

### 6b. Rating removes the item from the wishlist

A local-only removal is not enough: providers own the wishlist, and `syncProvider` pulls it back.
So extract the existing removal path — provider write-back loop **+** `clearWatchlist` — out of
[api/watchlist/route.ts](../../src/app/api/watchlist/route.ts)'s `DELETE` into
**`src/lib/wishlistRemove.ts`**: `removeFromWishlist(userId, mediaItemId, { source? })`, keeping
S7's ownership check and the "clear the truth table, not the cache" rule
([matcher.ts:377](../../src/lib/matcher.ts)). Then:

- `/api/watchlist` DELETE calls it (behaviour identical).
- `/api/library` POST calls it **after** `recordLibraryRating`, only when `rating != null` and only
  when the item is actually on the user's wishlist. Failures are logged, never fatal — rating must
  succeed even if a provider write-back doesn't.
- Return `wishlistRemoved: true` so `PersonalSection`/`useQuickActions` update the bookmark state
  without a second round trip, and fire the existing `WISHLIST_TOGGLED_EVENT`
  ([useQuickActions.ts:27](../../src/lib/useQuickActions.ts)) so `/wishlist` drops the row live.

Tests: rating an on-wishlist item clears both `user_watchlist` **and** its `user_item_state`
wishlist rows; rating an off-wishlist item is a no-op; `rating: null` does **not** remove.

---

## 7. Tech — performance audit + safe wins

Write **`docs/performance-audit.md`** with measurements, then implement the low-risk items. Already
measured against the real local `data/rr.db`:

| Finding | Evidence |
|---|---|
| **Discovery cache rebuild is the hotspot.** `buildCache()` ([discovery.ts:148](../../src/lib/discovery.ts)) `SELECT`s the whole pool ⟕ `media_links` and `JSON.parse`s every blob **synchronously on the request path** | **4,133 link rows / 39.0 MB of `raw_data`** per rebuild |
| **…and it is invalidated far too often.** `catalogSignature()` counts `POOL_WHERE`, which includes `mi.id IN (SELECT media_item_id FROM user_item_state)` — so **any** wishlist/library/rating write changes the signature → full 39 MB re-parse. Plus a 5-min TTL, the alias signature, and explicit `invalidateDiscoveryCache()` calls | 2,531 pool items / 2,397 `user_item_state` rows |
| **The same blobs are parsed 3× per signed-in request.** `analyzeLibraryFacets` (1,921 items), `getMembershipSignal` (library **+** watchlist, separately), and `buildProfile` each parse independently | `/api/home` signed-in hits all three |
| **`/api/library` returns everything.** ~1,921 items, each fully `mergeLinks`-ed *and* `computeFandexScore`-d, in one JSON response — while `MyStuffView` already renders only the first 300 (SM19/T11) | 1,921 `user_library` rows |
| **`/api/home` has no cache** on a **public** route → 3 provider calls per anonymous view and per crawler hit | see §1d |
| **Memory posture is good** — every module cache is a `BoundedCache` (the 2026-07-21 lesson held); `libraryAnalysis._memberCache` was the last unbounded one and is already fixed. No new leak found by inspection | 25 module caches audited |
| **DB inflation** — local `rr.db` 55.9 MB with a **48.4 MB WAL** (checkpointing is not keeping up); `media_links` = 6,054 rows / 44.8 MB `raw_data` (**7.4 KB average**); 1,879 of 4,405 `media_items` are `browsed`. Prod is ~2.5 GB (memory: `prod-db-size-and-page-cache`) — the open question from that incident is still open | measured |

**Implement (safe):**
1. **Per-item parsed-facet cache** — `BoundedCache<mediaItemId, {sig, facets, merged}>` keyed by the
   item's `MAX(last_synced)`, shared by `buildCache`, `analyzeLibraryFacets`, `getMembershipSignal`
   and `buildProfile`. Turns the 3× parse into 1×, and makes a *rebuild* reuse per-item work
   instead of re-parsing 39 MB.
2. **Split the pool signature** so a membership write no longer forces a full rebuild: keep the
   `browsed = 0` count/`MAX(updated_at)` as the catalog component, and treat newly-acted-on items
   as an **incremental add** to the existing cache rather than an invalidation.
3. **`/api/home` public-rail cache** (§1d).
4. **Slim + paginate `/api/library`** — add `limit`/`offset` and a list projection that drops
   `overview`/`images`/cast-scale fields the card grid never reads; `MyStuffView` already has the
   incremental-render machinery to consume it.
5. **Measure loading times properly** — a small `scripts/perf-probe.mjs` hitting each route twice
   (cold/warm) recording TTFB + payload bytes, so the doc has numbers, not adjectives. Must respect
   the "app imports" rule + `scripts/alias-hooks.mjs` and use `import type` (both are load-bearing
   invariants).

**Deliberately deferred to a separate reviewed pass** (they touch the invariants): WAL/checkpoint
tuning, a persisted facet-projection column, `raw_data` projection shrink, `dbPrune` coverage of
browsed rows, and anything in the sync/pull path.

*Housekeeping, unrelated to prod:* `data/` holds six stale `rr.db.bak*` files, ~950 MB. Local disk
only — I'll flag, not delete.

---

## Verification

Order matters — perf work changes the caches everything else reads.

1. `npm test` (432 tests today) · `npx tsc --noEmit` · `npm run lint` (must stay **0 errors**).
   New tests: `homeHighlights`, `dailyRotation` (fixed seed → fixed output), `topItemByFacet`,
   the trending fetchers' field mapping, `rankCrossSourcePopularity` (renamed suite),
   `wishlistRemove`, unrate (`rating: null` → cleared rating, status kept, wishlist untouched).
2. `npm run build` — **stop the dev server first** (a build over a running `next dev` corrupts
   `.next` and produces 404s that read as product bugs). Confirm the route table is unchanged.
3. **Logged-in browser pass** via `preview_start {name:"dev"}` → `navigate /api/dev/login`
   (never `/api/auth/logout` — it bumps `session_epoch` and kills Nils's own session):
   - `/` — one combined stat strip + 2 highlight panels; three rails with the new titles; verify
     **Popular right now** contains **released** titles and differs from **Upcoming**; hit
     `/api/home` twice and confirm the public rails are cache-served the second time.
   - Rotation: two `dayISO` values (temporarily via a query param on the route) must yield
     different highlights and a different Popular slice — same value must be stable.
   - Item page — screenshot at **375px** against `item-detail.html` frame 1, then at 1280px;
     assert no horizontal overflow and one consistent section rhythm.
   - **Unrate:** rate 7 → reopen the picker → click the 7th star → rating clears, item stays in the
     library, survives reload. Repeat on a **game** and check RAWG (the §6a gap).
   - **Wishlist-on-rate:** wishlist an obscure title → rate it → bookmark clears, `/wishlist` drops
     it live, survives reload, and it's gone from the provider's own list (smoketest step 25's
     read-only provider check).
   - Palette: `javascript_tool` over rendered chips → at most 4 distinct facet colours across
     Insights, an item page and a facet page. (Avoid `token`/`key`/`secret` in probe variable
     names — the harness blocks those reads.)
4. **Run the new smoketest section F end to end**, including the revert + reverse sweep, and log
   anything it finds to TASKS.md as `SM#`.
5. Perf: re-run `scripts/perf-probe.mjs` before/after and put both columns in
   `docs/performance-audit.md`; confirm a library/wishlist write no longer triggers a full
   discovery-cache rebuild (log a one-off timing around `buildCache`).
6. Update [STATUS.md](../../STATUS.md) + [TASKS.md](../../TASKS.md), and memory
   (`calendar-sources-and-layout-order`, `mockup-gap-closeout`, `fandex-score-h5` all touch
   surfaces this changes).

## Risks

- **`persistDiscoverBatch` on trending items** now mints catalog rows for *released* titles Home
  never surfaced before. The thin-write rule holds (insert-only, `browsed=1`, projection version
  `0`) but pool growth should be watched — it's the mechanism that grew the pool to ~676k rows on
  `/discover` once before.
- **Signature-splitting the discovery cache** is the riskiest safe win: get it wrong and a newly
  wishlisted item silently misses the pool until the TTL. Needs an explicit test asserting a
  wishlist write makes the item appear in `find()` results immediately.
- **The facet-palette sweep touches 5 components**; a missed call site leaves one stray hue.
  Enumerate via `grep -rn "ROLE_COLORS\|CATEGORY_COLORS"` and assert the count reaches zero
  outside `facetPalette.ts` and the admin panels.
