# Catalog growth: serving Fandex from its own database

**Proposed by Nils 2026-08-27, measured and analysed the same day, execution started the same
evening.** Read this before starting any of it, and before touching `discovery.ts`'s pool.

## Progress

| phase | state |
|---|---|
| **0. Hoist the per-item cache checks out of scoring** | ✅ **DONE 2026-08-27.** 105 → 21 µs/item, **5.1×**, `find()` warm 384–610 ms → 185–206 ms. Verified 2,553 identical scores and 0 different over the real catalog, plus `scoringContext.test.ts`. |
| **1. Enrich what we already store** | ✅ **DONE 2026-08-27.** Discover reads stored availability (§8) and the fill job heals thin rows on a timer (§9). Left over: the same annotation on /api/home and the calendar. |
| 2. Serve anon Discover from the DB | 🔵 **first slice done 2026-08-27** (§10): an empty provider section now falls back to stored rows. Serving the DB by DEFAULT still wants phase 3 first. |
| 3. Split the shelf from the scoring pool | 🔵 **half done 2026-08-27** (§11): scores precomputed per (user, profile, pool), and a 63 ms signature query fixed. find() 190 → 86 ms. Memory levers, inverted index and a background recompute still open. |
| 4. Seeded backfill to 30–50k with tiered refresh | ⬜ |
| 5. Housekeeping by bytes | ⬜ |

⚠️ **Re-run `BENCH_DB=<copy> node scripts/probe-score.mjs` after any change to the scoring path.**
Absolute µs vary with machine load (a run with two dev servers up reads ~2× a quiet one); the RATIO
between the two paths it prints is the stable number.

Every number below is measured on `data/rr.db` (2,792 items) or prod `/api/health` unless it says
PROJECTION. Two of them contradict what this project assumed, so re-measure rather than quote.

---

## 1. The idea, in one screen

Today Fandex asks the providers for most of what a visitor sees, while they wait. The change is to
keep our own copy of the catalog and treat the providers as something we sync from on a schedule.

**Three background jobs:**

- **Sync (daily).** Ask TMDB, IGDB and Steam what is new, popular and upcoming. Store those titles
  enriched, streaming availability included.
- **Refresh (continuous, tiered).** Re-check what we already hold, because availability and
  popularity go stale. Hot and upcoming often, old and quiet rarely.
- **Housekeeping (continuous).** Hold the DB under its size limit.

**Two tiers that are currently one thing, and should not be:**

- **The shelf.** Everything ingested. On disk. Serves pages. Disk is ~75× cheaper than RAM
  ([[railway-cost-shape]]), so breadth is cheap here.
- **The scoring pool.** One vector per item, resident in memory, scanned to produce a Fandex Score
  or a "More like this" row. Expensive in both memory and per-request CPU. §4 is entirely about
  keeping this from scaling with the shelf.

Anonymous visitors and crawlers are served from the DB. A text search hits the DB first and falls
through to the providers only when we have no good answer.

⚠️ **Most of this pattern already exists.** `home_snapshot` and `calendar_snapshot` are daily builds
served from SQLite, on an unref'd interval in `instrumentation.ts`, and the homepage already costs
zero provider calls. Their invariants (atomic replace, never clear-then-build, `PRUNABLE_WHERE`
membership, region in the key) apply unchanged to anything added here →
[[home-snapshot-and-crawlable-rails]]. The holdout is Discover browse.

---

## 2. What it buys

| | today | after |
|---|---|---|
| Cold `/tag/` page | 7–10 s, **14 provider calls** | DB read, 0 calls |
| ~5,000 cold facet views | exhausts RAWG's entire monthly quota (`scalability.md` §3.1) | irrelevant |
| A games provider outage | **zero games on Discover** (measured 2026-08-27: RAWG 401-latched, IGDB 9/9 network errors, `/api/discover` returned 20 movies + 20 shows) | slightly stale games |
| Streaming data for the "Available on" filter | 58% of past-window items, 20% of upcoming (`advanced-filters.md` §6c) | whatever we ingested |

The first row is the real prize. Provider cost here scales with **catalog breadth × crawler
appetite, not pageviews**, so moving anon traffic onto the DB attacks the only variable that matters.

---

## 3. Sizing

| measured | |
|---|---|
| Bytes per catalog item | **24.2 KB** (67.5 MB / 2,792 items) |
| Share that is `media_links.raw_data` | **70%** (47.6 MB; ~7 KB per link × 2.5 links/item) |
| Prod today | 106 MB DB, 14 MB WAL, RSS 331 MB, heap 185 MB, cgroup limit 7.6 GB |
| Ingest cost per title | ~2–4 provider calls |

- A **2 GB cap is ~85,000 titles**. At 100/day that is ~2.3 years away, so the cap is a tripwire,
  not a constraint anyone will feel.
- **100/day is too slow to be the point.** A useful anon Discover wants 30–50k titles (0.7–1.2 GB),
  which is a seeded backfill of roughly 60–120k provider calls paced over weeks. Fine for TMDB,
  IGDB and Steam. Impossible for RAWG (20k/month), whose metadata role is already dropped (PL3).

---

## 4. Keeping the Fandex Score off the memory bill

**The problem.** `_cache.vectors` holds one `DiscoveryVector` per pool item and every scored request
scans it. It is bounded by nothing but catalog size, and AGENTS.md forbids capping it because
truncation silently changes every score. Measured today: 2,553 items × **2,537 bytes = 6.5 MB**.
Straight-line at 85k items that is **216 MB serialised**, against prod's entire 185 MB heap, and real
V8 heap runs several times a `JSON.stringify` estimate. PROJECTION, and the honest reading is that
the current representation does not survive this plan.

**Where the bytes are** (`poolWeight()` reports the split as of 2026-08-27):

| per pool item | bytes | share |
|---|---|---|
| `facets` | **1,997** | 79% |
| everything else (title, slug, posters, sources, scalars) | 540 | 21% |
| facet occurrences per item | 24.9 | ~80 bytes each |

Catalog-wide there are 19,799 distinct vocab terms against ~63,600 facet occurrences: **each facet
string is already stored once in the vocab and then copied into every item that carries it.** That
is the whole problem in one sentence, and it gets better with scale, not worse (reuse rises as the
catalog grows).

### The levers, cheapest and safest first

1. **Intern the facet strings.** Replace `{kind, key, label, role, category}` per occurrence with an
   integer id into the vocab we already build. ~80 bytes per occurrence becomes 4–8.
   **PROJECTION: 1,997 → ~150–200 bytes per item.** Changes no score: same facets, same order,
   different spelling in memory.
2. **Stop holding display data in the pool.** Titles, posters and slugs matter for the 20–60 items
   that reach a screen, not for the scan that ranks them. Look them up by id from SQLite after
   ranking. Removes the remaining 540 bytes per item and leaves the pool purely numeric.
3. **Go columnar.** With 1 and 2 done, an item's facets are a slice of one flat `Int32Array`, plus
   per-item scalars in parallel typed arrays. This is where the real heap win is: per-object and
   per-array overhead is what a serialised estimate cannot see. **PROJECTION at 85k items:
   ~2.1M occurrences × 4 bytes ≈ 8.5 MB, plus scalars, plus the vocab dictionary we already keep
   (~160k terms by Heaps' law, ~16 MB). Order 30 MB, and flat in shape rather than growing 80 bytes
   at a time.**
4. **Invert the index, so a request stops scanning everything.** Postings lists (facet → item ids)
   instead of a full scan: union the profile's facets, score only the candidates that share one.
   ⚠️ Correctness hinge worth stating up front: an item sharing NO facet with the profile scores
   exactly the baseline, so it never needs visiting, only listing. Whether that holds depends on
   the non-facet terms in the score (community prior, recency); check `computeFandexScore` before
   assuming it. Same memory as 3, organised by facet instead of by item.
5. **Curate pool membership.** Only items above a quality bar, or acted on, or in a snapshot, join
   the pool. ⚠️ **This is the only lever that changes scores**, because IDF is computed over pool
   membership. It needs a deliberate decision, a stable rule (never a moving window), and a re-tune
   afterwards → [[fandex-score-h5]]. Treat it as the fallback, not the plan.
6. **Move the pool into SQLite.** Last resort. RAM becomes page cache and per-request CPU rises;
   ⚠️ `better-sqlite3` is synchronous and in-process, so a heavy query blocks the event loop for
   every other request.

### ⚠️ MEASURED 2026-08-27: memory is not the wall. CPU is, and it arrives sooner.

`scripts/probe-score.mjs`, dev machine, real DB. **Prod's container is slower, so read these as a
floor, not a ceiling.** Two runs, hence the ranges.

| | measured |
|---|---|
| Per item scored | **99–155 µs**, and strictly linear (checked at 1×, 4× and 20× the pool: 51,060 items scored in one pass) |
| Scoring the whole pool (2,553) | **243–392 ms** |
| `find()` warm, end to end | **384–610 ms**, so scoring is roughly two thirds of a Discover request already |

PROJECTION, straight-line because the measurement is straight-line:

| pool | scoring CPU per scored request |
|---|---|
| 2,553 (today) | 0.25–0.39 s |
| 10,000 | **~1–1.5 s** |
| 30,000 | 2.9–4.6 s |
| 50,000 | **4.8–7.7 s** |
| 85,000 | 8.1–13 s |

`better-sqlite3` is synchronous and in-process, so that time is not "a slow request", it is the
whole server blocked. **The plan in §7 is unshippable as written past roughly 10k items**, which the
memory levers above do nothing about.

### Why an item costs 100 µs, which is the good news

| component | µs/item | share |
|---|---|---|
| `applyIpFacets()` | **91–101** | ~60–67% |
| `getScoringConfig()` | 18–19 | 12–24% |
| the actual arithmetic, sorts and `reasons` | ~30 | ~20% |

`getScoringConfig()`, `getIpAliases()` and `getItemIpOverrides()` each cache their result and run a
cheap signature `SELECT` to check freshness. Each is fine. **`computeFandexScore` calls them once per
ITEM**, so scoring 50k items runs 100k+ signature queries, and ~79% of Fandex Score CPU is cache
validation rather than scoring. Both helpers already accept pre-loaded maps (`applyIpFacets`'s `pre`
parameter, which `buildEntries` uses and the scoring path does not), and `find()` already holds the
profile, so hoisting all three out of the loop is a contained change that cannot alter a score.
**PROJECTION: ~5× less CPU, so 50k items goes from ~5–8 s to ~1–1.6 s.** Still not a request-path
number, which is why it is necessary and not sufficient.

### The rest of the stack, in the order that actually matters

1. ✅ **DONE 2026-08-27. Hoist the three per-item cache checks** out of the scoring loop.
   `scoringContext()` is built once per pass and threaded through the eight loops that score more
   than a handful of items (`find`, library, calendar, facet/mine, discover/scores, detail/similar,
   relatedRails, liveDiscover). **Measured 105.2 → 20.6 µs per item (5.1×)**, `find()` warm from
   384–610 ms down to 185–206 ms, and the projection at 50k items from 4.8–7.7 s to ~1.1 s.
   Verified two ways: `scoringContext.test.ts` (five properties, including an ip alias and a
   per-item override) and the probe scoring the whole real catalog both ways — **2,553 identical,
   0 different**.
   ⚠️ What it trades away: a scoring config or alias edit landing MID-PASS is now seen by the next
   pass instead of the next item. No surface has ever relied on that, and the test pins it.
2. **Precompute per-user scores.** A score changes only when the profile changes (a rating) or the
   item's facets change, so the per-request scan is recomputation of a value that was already known.
   Store one `Float32Array` (or table) per user: 50k items is 200 KB. Per request becomes a sort
   over floats, single-digit ms at any catalog size we are contemplating. The full pass moves off
   the request path to a background job on rating.
3. **Inverted index (facet → item ids).** Two jobs: it makes step 2's recompute incremental (a new
   rating only touches items carrying the affected facets), and it bounds a cold "score everything"
   pass by scoring only candidates that share a facet with the profile. ⚠️ Check
   `computeFandexScore`'s non-facet terms before assuming an unmatched item can be skipped rather
   than visited.
4. **The memory levers 1–3 above.** Still worth doing (columnar layout also speeds the scan through
   cache locality), but they solve the smaller of the two problems.

Levers 1–3 and steps 1–2 are all output-preserving, which makes them testable the strongest way
available: same catalog, same profile, byte-identical scores before and after. Pool membership (§4
lever 5) remains the only knob that changes what a score IS.

---

## 5. Housekeeping: evict bytes, not rows

**70% of the file is `media_links.raw_data`.** Dropping the blob and keeping the item row reclaims
almost all of the space while the URL, the stored slug, the FK graph and every user relation
survive. Deleting rows instead is what makes public pages start 404ing, and the archive already
records "pruned browsed items lose their public URLs" as an accepted loss from last time.

⚠️ The price of dropping a blob: a future `PROJECTION_VERSION` bump cannot re-derive that item
without refetching it → [[lazy-heal-vs-mass-reprojection]].

**Never evict** anything with a user relation (the boot prune already works this way), anything a
snapshot references, anything `franchise_members` / `ip_alias` points at, or anything that has been
in the sitemap recently. **Evict first**: thin `browsed = 1` rows at projection version 0, zero
detail views, released long ago with few votes, no poster and no overview.

⚠️ **Do it continuously in small batches, and never let a backlog build.** Precedent: PR16 pruned
546,754 rows for ~1 hour of sustained CPU and **12.8 GB of WAL churn to S3, which blew the Railway
spend cap and took the site down** (2026-07-22, → [[prod-incidents]]). That is ~24 KB of WAL per row
deleted. Steady state at 100 items/day is 2.4 MB/day, i.e. nothing. The danger is exclusively the
catch-up burst, and **checking Railway usage is an explicit precondition for any bulk operation.**

---

## 6. Open questions, before this is a plan anyone executes

1. **Provider terms at this scale.** TMDB's free tier is **non-commercial**, $149/mo commercial, and
   a large stored derivative is a stronger "we built a database" reading than a cache is. Read the
   caching and storage clauses for TMDB and IGDB before a bulk backfill. This project has been wrong
   about provider terms twice → [[platform-integration-architecture]].
2. **Refresh budget.** The treadmill scales with catalog SIZE, not ingest rate: 85k items at one
   call a month each is 85k calls a month, and every refresh rewrites rows, which is WAL, which
   Litestream ships. Size the tiers deliberately.
3. **Restore drill at the new size.** It is already due at 106 MB. Re-run it at 1–2 GB before
   trusting the backup, and remember any schema SQL must parse on Litestream's SQLite (~3.40).
4. ~~**Scoring at 50k.**~~ Measured 2026-08-27, see §4: **4.8 to 7.7 s of blocking CPU per scored
   request**, which is the finding that reorders this whole plan. Re-run `scripts/probe-score.mjs`
   after phase 0 and after any change to `computeFandexScore`.

---

## 7. Build order

| phase | what | why now |
|---|---|---|
| 0 ✅ | Hoist the three per-item cache checks out of scoring (§4) | Done 2026-08-27, measured 5.1×. See Progress above |
| 1 | Enrich titles we already store, rather than adding rows | Nearly free, and it makes the "Available on" filter work |
| 2 | Serve anon Discover from the DB, extending the snapshot pattern | Kills the crawler cost and the outage-blank-page failure |
| 3 | Split the shelf from the scoring pool (§4 levers 1–3) | Load-bearing: everything after it is cheap, nothing before it is safe |
| 4 | Seeded backfill to 30–50k with tiered refresh | The breadth the anon surfaces actually need |
| 5 | Housekeeping by bytes, with the never-evict list | The size cap, which will not bind for years |

Phases 1 and 2 stand alone and are worth doing whatever happens to the rest.

---

## 8. Phase 1, part one: Discover reads the availability we already hold (2026-08-27) — SHIPPED

The reported symptom was the "Available on" filter counting 0 on every chip
(`advanced-filters.md` §6c). Half of that was a games outage; the other half is that Discover's feed
is built from provider LIST payloads, which carry no watch providers at all. **The data was already
in the database**: 1,536 tmdb links locally hold a `watch/providers` blob.

`lib/availability.ts` reads it, `annotateAvailability()` attaches it to a batch, and `/api/discover`
calls it beside the user-state annotation. **No provider call. No merge. No full-blob parse:** SQL
pulls out the winning region's small object and only that gets `JSON.parse`d.

**Measured after (local dev, real DB):**

| | |
|---|---|
| Query cost | 5 ms for 60 ids, 17 ms for 200, 30 ms for 400, 187 ms for all 2,781 (~0.07 ms/id) |
| Past-window movies now carrying availability | **17 of 20** |
| Default upcoming feed | 4 of 54, which is correct — an unreleased film streams nowhere |
| End to end | picking a chip narrows the list and the sheet's button reads "Show 1 title" |

⚠️ Rules this had to keep, each pinned by `availability.test.ts`:

- **The region fallback must match `mergeLinks`/`pickRegion` exactly** (country → US → GB → first
  key). If they drift, the filter and the item page disagree about the same title.
- **Bucket precedence is flatrate → free → ads → rent → buy**, and a projected row's stored
  `offerType` wins over re-deriving it. Getting this wrong says a film is "on Netflix" when it is
  only rentable.
- **Absent, never `[]`.** An empty array claims "on no service", and `matchesPlatforms` hides
  exactly those.
- **`linkable: false` items are skipped.** Their `id` is still a provider id, so a lookup would
  match nothing at best and the wrong row at worst.

**Not done, and deliberately out of this step:** the daily job that FILLS availability for titles we
hold but have never detail-read, and extending the same annotation to `/api/home` and the calendar.
Those are the rest of phase 1.

---

## 9. Phase 1, part two: the catalog fill job (2026-08-27) — SHIPPED

A row written from a provider list payload is thin: projection version 0, genres and a poster, no
credits, no keywords, no watch providers. Until now those healed **only when somebody opened the
title**, so an item nobody clicks stayed thin forever. `lib/catalogFill.ts` walks the same backlog on
a timer.

**It is not a new fetch path.** It calls the same `healLinks` the detail route does, so there is one
definition of healed and one place that writes. What is new is the ordering and the pacing.

- **Order**: items somebody acted on, then pool items (`browsed = 0`), then everything else by oldest
  sync. Pinned by `catalogFill.test.ts`, because the order is the only judgement in the file.
- **Pacing**: 10 items every 30 minutes, ~480/day, one provider call each. Local backlog was 680
  items, so it drains in about a day and then costs one cheap SELECT per pass.
- **Scheduling**: unref'd interval, after `pruneDone`, and **two minutes after boot rather than at
  boot**.

⚠️ **The boot-delay is a measurement, not caution.** The first scheduled pass reported `healed: 0`
on ten items that heal fine in 600–1,200 ms when run by hand a minute later. Boot is the slowest the
process ever is (cold routes, no Twitch token yet), and under the request path's 2.5 s per-call cap
every item took the `timeout` branch. That branch still persists the late result, so no work was
wasted, but the pass reported zero and looked broken. The fill now uses a **10 s per-call budget**,
because the request-path cap exists for a person waiting on a page and nobody waits for this.

⚠️ **This pacing is for a 680-item backlog, not for phase 4.** When 30–50k titles start arriving
thin, 480/day drains far too slowly, and the right response is to re-derive the numbers against
`docs/scalability.md`, not to turn the dial up and hope.

**Still open in phase 1:** extending `annotateAvailability` to `/api/home` and the calendar, so their
cards can show where a title streams too.

---

## 10. Phase 2, first slice: an outage stops emptying Discover (2026-08-27) — SHIPPED

Not the whole of phase 2. The one brick worth laying immediately, because we were living inside the
failure it fixes: on prod, RAWG latched on its quota 401 and IGDB answered 9 of 9 requests with
network errors, `?section=games` returned `{"items":[]}`, and **the entire games category vanished
from Discover while thousands of games sat in the database.**

`lib/catalogFeed.ts` serves stored rows for a type and window when the provider hands back nothing.
Wired into both places a section can come back empty: the `?section=` load-more branch and the
anonymous browse fan-out, **per section**, so one dead provider cannot take the other two categories
with it.

Decisions worth not re-litigating, each pinned by `catalogFeed.test.ts`:

- **Empty is the only trigger.** A short page is a real answer (the window genuinely holds few
  releases). Topping it up would make one feed out of two sources with one order.
- **Date order, not popularity.** `media_items` holds no popularity signal; votes live inside link
  projections, and reading those is the merge path this file exists to avoid (41 MB for the real
  library). Discover is a timeline, so date order is both the cheapest answer and an honest one.
  Taste ranking still happens downstream, through the same `decorateSection` path.
- **Pool membership is NOT applied.** The pool is a scoring candidate set; this asks "what do we
  have to show", and a `browsed` row we hold is a fine thing to show during an outage.

⚠️ **Found by running the pipeline rather than reading it**: the first version shipped 20 items that
were all `linkable: false` with no slug. Both uuid resolvers skip items without `raw`, and a catalog
row has none — it IS the row. `persistDiscoverBatch` now passes a uuid `id` straight through
(provider ids are composites, so they can never collide). Without that check the fallback would have
replaced an empty category with a full page of cards nobody could click, which is a worse failure
than the one it fixes and would have looked fine in every test that did not click something.

⚠️ **Verification honesty**: the fallback's own logic, shape and pipeline output are covered by
tests and by a scripted run through `decorateSection` → `persistDiscoverBatch` → annotate (every
item linkable, slugged, scored). **The live trigger has NOT been exercised end to end**, because
reproducing it needs both games providers down at once, and locally IGDB is healthy. The prod
symptom that motivated it is recorded in TASKS.md "Needs Nils" #2.

---

## 11. Phase 3, first half: scores are computed once, not per request (2026-08-27) — SHIPPED

`fandexScoresFor()` in `discovery.ts` computes one `Float64Array` of scores per (user, profile,
pool) and `find()` reads it by index. A score only changes when the ratings, the scoring config or
the item's facets change, so recomputing it on every page load was recomputing a known answer.

**And then the measurement moved the target again.** Decomposing `find()` (190 ms warm) turned up
something bigger than the scoring:

| | before | after |
|---|---|---|
| `librarySignature()` | **63 ms** | **1.4 ms** |
| `buildProfile()` (a cache HIT — the time was all signature) | 61 ms | 1.6 ms |
| Fandex scoring inside `find()` | ~60 ms | ~0 (precomputed) |
| **`find()` warm, whole** | **190 ms** | **86 ms** |
| `GET /api/discover` end to end | 198–248 ms | **81–92 ms** |

⚠️ **A cache key was more expensive than the thing it guarded, and it was a VIEW that made it so.**
`librarySignature` asked `user_library` for a COUNT and a MAX. `user_library` is a view over
`user_item_state` built from CTEs with `json_group_array` and two GROUP BYs, so every call
materialised the whole thing: **69 ms**, three times per request, to produce a cache key.

Two changes, both measured on the real DB:

- Sign off the **base table**, not the view. The count differs (the view is one row per item, the
  table one per item-and-source) and that is fine twice over: a signature only has to CHANGE when
  the data changes, and per-source is strictly more sensitive. The value shifts once, so every
  profile recomputes once.
- Add **`idx_links_item_synced ON media_links(media_item_id, last_synced)`** (db.ts). Without a
  covering index, `MAX(last_synced)` fetched every matching row, and a `media_links` row carries
  ~7 KB of `raw_data` — tens of MB of pages read to collect one integer per row. **41.5 → 1.0 ms**,
  42 ms to build, no measurable file growth.

**Verified**: full suite green, and the four scores captured before the change come back identical
(Pan's Labyrinth 83.6, Cars 55.7, Asterix and Cleopatra 65.6, The Twelve Tasks of Asterix 59.2).
`FANDEX_NO_CACHE=1` bypasses the precompute so `scripts/probe-score.mjs` can measure both paths in
one run: **193 ms with, 255 ms without**, at 2,553 items. That gap is the part that scaled with
catalog size, and it is now flat.

**Still open in phase 3**, and the reason it is half and not done: the memory levers (interning,
dropping display data, columnar) and the inverted index. Also unbuilt: moving the recompute itself
to a background job. At 2,553 items it costs ~55 ms on the first request after a rating; at 50k it
would be ~1 s on that one request, which is when it stops being acceptable.
