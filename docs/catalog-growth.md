# Catalog growth: serving Fandex from its own database

**Proposed by Nils 2026-08-27, measured and analysed the same day, execution started the same
evening.** Read this before starting any of it, and before touching `discovery.ts`'s pool.

## Progress

| phase | state |
|---|---|
| **0. Hoist the per-item cache checks out of scoring** | ✅ **DONE 2026-08-27.** 105 → 21 µs/item, **5.1×**, `find()` warm 384–610 ms → 185–206 ms. Verified 2,553 identical scores and 0 different over the real catalog, plus `scoringContext.test.ts`. |
| **1. Enrich what we already store** | ✅ **DONE 2026-08-27.** Discover reads stored availability (§8) and the fill job heals thin rows on a timer (§9). Left over: the same annotation on /api/home and the calendar. |
| **2. Serve anon Discover from the DB** | ✅ **DONE 2026-08-28.** §10 outage fallback, §14 anon search, §18 the browse switch: a (type, window) with enough rows serves from our own DB at **zero provider calls**. `CATALOG_BROWSE=1`, gated on breadth per type. |
| **3. Split the shelf from the scoring pool** | ✅ **DONE 2026-08-27/28.** Scores precomputed (§11), the last two catalog-scaling costs in `find()` removed (§11b), the pass moved OFF the request path (§12), and the memory question re-measured and answered differently than planned (§13). `find()` warm **384–610 → 32 ms**; a warm request's heap **109.6 → 39.9 MB**. The inverted index is NOT built and no longer urgent — see §13. |
| **4. Seeded backfill to 30–50k with tiered refresh** | ✅ **MACHINERY DONE 2026-08-28** (§15, §16, §18). Six lanes with a durable cursor, proven against real providers. `BACKFILL_ENABLED=1` to start. ⚠️ The DATA is weeks of paced calls by design. |
| **5. Housekeeping by bytes** | ✅ **DONE 2026-08-28** (§18). Drops `raw_data` blobs, never rows, above `HOUSEKEEPING_START_MB`. Never-evict list tested clause by clause. |

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

> ⚠️ **THE WHOLE OF §4'S MEMORY ANALYSIS WAS WRONG, MEASURED 2026-08-28 → §13.** It was built on
> `poolWeight()`'s `JSON.stringify` estimate of ONE structure, and both halves of that were off: the
> pool is **13.5 MB of the 109.6 MB** a warm request retained (not the biggest thing — that was
> `facetCache.derived` at 86 MB), and interning the facet strings, lever 1 below, saves **0.4 MB**
> rather than the 1,997 → 200 bytes per item projected here. Levers 1–3 are struck. Read §13 before
> touching any of it. The CPU findings further down (the 100 µs/item decomposition, the
> `scoringContext` hoist) were measured and stand.

**The problem, as it was understood on 2026-08-27.** `_cache.vectors` holds one `DiscoveryVector`
per pool item and every scored request scans it. It is bounded by nothing but catalog size, and
AGENTS.md forbids capping it because truncation silently changes every score. Measured that day:
2,553 items × **2,537 bytes = 6.5 MB**, straight-line at 85k items **216 MB serialised**. That
premise survived one day.

**Where the bytes are** (`poolWeight()` reports the split as of 2026-08-27; ⚠️ serialised, and §13
is why that does not size a fix):

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

1. ~~**Intern the facet strings.**~~ ❌ **STRUCK 2026-08-28, measured.** Interning every live facet
   array — 130,737 occurrences down to 22,341 distinct objects, **5.85× reuse** — saved **0.4 MB**
   of 108. The projection below (1,997 → 150–200 bytes/item) was serialised arithmetic; retained
   heap does not work that way, because the strings are already shared and the objects are small
   next to what actually held the memory. → §13
2. ~~**Stop holding display data in the pool.**~~ ❌ **STRUCK.** The whole pool is 13.5 MB of 109.6;
   the display half of it is a rounding error, and removing it costs a SQLite lookup on every ranked
   page.
3. ~~**Go columnar.**~~ ❌ **STRUCK for memory.** Might still be worth it one day for scan locality;
   it is not a memory fix, and it was the expensive one.
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
2. ✅ **DONE 2026-08-27/28. Precompute per-user scores, then move the pass off the request path.**
   §11 cached one `Float64Array` per (user, profile, pool); §12 stopped the FIRST request after a
   change from paying for it. Post-rating request 397 → 117 ms, and the catalog-scaling half of that
   is now a chunked background job.
3. **Inverted index (facet → item ids).** ⬜ **Not built, and no longer urgent.** Its two jobs were
   to make the recompute incremental and to bound a cold pass; §12's chunked background pass with a
   stale-serve took the pressure off both, since no request waits for either any more. Still the
   right answer if the background pass itself becomes too expensive to run per rating at 50k.
   ⚠️ Check `computeFandexScore`'s non-facet terms before assuming an unmatched item can be skipped
   rather than visited.
4. ~~**The memory levers 1–3 above.**~~ ❌ Struck 2026-08-28 → §13. What replaced them: the facet
   cache had been storing every parsed provider blob, and dropping those took a warm request from
   109.6 MB to 39.9 MB — 4× what all three levers together were projected to save, in a two-line
   change.

Every step here is output-preserving, which makes them testable the strongest way available: same
catalog, same profile, byte-identical scores before and after. `scripts/capture-find.mjs` exists so
that comparison stops being hand-rolled each time. Pool membership (§4 lever 5) remains the only
knob that changes what a score IS.

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

1. ~~**Provider terms at this scale.**~~ **READ 2026-08-28 → §17.** Answer in one line: TMDB caps
   caching at six months (an AGE cap, which a refresh tier satisfies — now enforced, §17b), Steam
   states no limit, and **IGDB is the blocker** (24-hour cache under the Twitch DSA, contradicted by
   its own webhooks product). The non-commercial question is unchanged by scale and belongs to H3.
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

### 11b. …and then the two things that were left

With scoring precomputed, `find()`'s remaining 86 ms was two queries and one loop, both of which
also grew with the catalog. Same treatment:

- **`getUserStateMap` asked two VIEWS with an `IN` list of every pool id.** 23 ms at 2,553 ids
  against 15 ms for the user's whole state fetched in one go — and the user's state is bounded by
  THEIR library (96 wishlist + 1,942 library rows here), not by the catalog. ⚠️ **It would also have
  thrown past ~32k items**: SQLite's default variable limit is 32,766, and the growth plan targets
  30–50k. Above 500 ids it now fetches the whole user; below that it still names them, which stays
  cheaper for a detail page or one batch of cards.
- **The ranking score (`scoreFacets`) is cached alongside the Fandex Score**, on the same key, for
  the unrefined profile only — a seed or a manual pill rewrites the weights per request and takes
  the recompute branch (verified: seeding moves the top score 21.64 → 27.05).
- **`reasons` are built for the RETURNED PAGE only.** They were computed for every item in the pool
  and all but ~60 thrown away, and nothing else reads them — not even the sort.

| `find()` warm, same machine and DB | |
|---|---|
| This morning | 384–610 ms |
| After the phase-0 hoist | 185–206 ms |
| After the precompute + the signature/index fix | 86 ms |
| After the state-map and rank-score fixes | **32 ms** |

**Verified byte-identical**, which matters more than the number: four request shapes (default sort,
date sort, type+year filtered, text query) captured against the committed code and again after,
comparing ids, Fandex scores, ranking scores and every reason label and contribution. **16,502
bytes, identical.**

---

## 12. Phase 3, second half: nothing on the request path scores the catalog (2026-08-28) — SHIPPED

§11 stopped a WARM request from scoring. It did not stop the first request after a change, and at
30–50k items that request is 0.6–1.0 s of BLOCKING CPU on a synchronous in-process database, which
is not a slow request but a stopped server.

`fandexScoresFor()` now **serves the previous numbers and refreshes them in the background**, in
512-item chunks with `setImmediate` between them (~10 ms of CPU each, measured; a timer set to 1 ms
fires four times during a 2,553-item pass). A user with no cached entry at all still scores
synchronously — there is nothing to serve and no honest way to fake it, and it happens once per user
per process.

⚠️ **Staleness is fine, MISALIGNMENT is not**, and that distinction is the whole design. The scores
live in a `Float64Array` indexed by position in the pool's vector array, so if the pool changes and
the array does not, index *i* stops meaning `vectors[i]` and one title renders another title's score
— silently, and plausibly, because both numbers are real. So `poolSig` is tracked separately from
`sig`: `sig` says "these numbers are current", `poolSig` says "index *i* still means `vectors[i]`",
and only the second is a correctness question. When the pool moved, the entry is **remapped** by id
through a Map built from the ids it was computed against (~10 ms at 50k, against ~1 s for a
rescore); an item NEW to the pool gets `NaN`, which the whole stack already reads as "no score yet"
and renders as `fandexPending`.

**And the decomposition moved the target again, twice.**

| the first request after a rating | |
|---|---|
| This morning | 397 ms |
| Fandex scoring's share of it | ~55 ms — the part everyone was looking at |
| `getLibraryFacetAnalysis`'s share | **350 ms** |
| After both | **117 ms** |

`analyzeLibraryFacets` was reading `ml.raw_data` for every library row. It never PARSED it
(`getDerivedForItem` only parses on a miss) but SQLite still had to fetch it: ~7 KB a row, 1,942
items, tens of MB of pages to reach a cache that then ignored them. It takes the same two-pass shape
`buildEntries` took in §A, and derives nothing at all for unrated rows (1,688 of 1,942 here are
rated). **396 → 71 ms warm**, output byte-identical over the whole analysis (8,064,556 bytes).

⚠️ **And then the freshness token turned out never to have worked for 1% of the catalog.** It was
SQL `LENGTH()` against JS `.length`, which count different things — code points and UTF-16 code
units. Any payload with an astral character (an emoji in an overview, a mathematical-alphanumeric
letter in a title) made them disagree, so the peek looked under a key `getDerivedForItem` would
never write: **56 of 7,006 links, 55 items, which had never once hit the facet cache** and were
re-read, re-parsed and re-merged on every pool rebuild and every library analysis. A permanent cache
miss has no symptom — the answer is right every time, it just costs what the cache was built to
save. Both sides are UTF-8 bytes now (`OCTET_LENGTH` / `Buffer.byteLength`), which is also **4–8×
cheaper**: `LENGTH()` on TEXT has to decode the whole string to count characters, and that scan runs
over the pool on every rebuild. Pool pass-1 query **67–84 → 8–12 ms**; `find()` COLD **1,502 → 890
ms**. Pinned by `facetCacheFreshnessToken.test.ts`, which fails against the old code.

**Verified**: `scripts/capture-find.mjs` over five request shapes (default sort, date sort,
type+year filtered, text query, deep offset) — ids, slugs, both scores, the center, `fandexPending`
and every reason label and contribution — **372,500 bytes, identical**. Plus
`discoveryScoreRecompute.test.ts` (stale-serve, remap alignment, the pending flag, `FANDEX_NO_CACHE`)
and a scripted run on a copy of the real DB proving both change paths converge to exactly the
synchronous answer.

## 13. Phase 3's memory question, re-measured — and §4 was wrong (2026-08-28)

`scripts/probe-memory.mjs` measures RETAINED heap (`--expose-gc`, release one structure at a time)
instead of `JSON.stringify` length. It reversed §4 completely.

| what a warm Discover request retained | before | after |
|---|---|---|
| **total** | **109.6 MB** | **39.9 MB** |
| `facetCache.derived` (2,553 entries) | 86.1 MB | 16.4 MB |
| `libraryAnalysis.facets` (1 entry) | 5.3 MB | 5.3 MB |
| the discovery pool | 13.5 MB | 13.5 MB |
| per pool item, all-in | 42.9 KB | 15.6 KB |

**The pool was never the problem.** It is 12% of the total, against §4's claim that it was "the
biggest single thing in memory". And interning — §4's lever 1, the cheap safe one — was measured at
its theoretical best: every live facet array, 130,737 occurrences collapsed to 22,341 distinct
objects, **5.85× reuse**, for **0.4 MB**. The 1,997 → 200 bytes/item projection was serialised
arithmetic about strings that were already shared.

**What was actually there.** `facetCache.ts`'s own header says it must never cache parsed
`raw_data`, in those words, with the OOM history as the reason. It cached all of it: `mergeLinks`
returns `sources[].data` — the entire parsed payload per link — and the cache stored the projection
whole. **19,311 of 25,518 serialised bytes per entry, 76%.** No caller wanted it: `/api/library` and
`/api/calendar` each destructure `sources` off and rebuild it with `data: {}` (the 2026-07-30 audit
caught the same blobs going over the WIRE and never thought to look at the cache), and
`loadMembershipGroups` even documents "raw per-source blobs aren't exposed by the cache", which was
the intent and not the behaviour. `/api/detail`, the one surface that needs them, calls `mergeLinks`
directly. The cached type now says so, so `tsc` is the proof rather than a comment asking callers to
remember.

**Three rules out of this, in descending order of how much they will save someone:**

- **`JSON.stringify` length does not size a memory fix.** It is fine for a growth RATE and it lied
  about both the ranking and the magnitude here. Reach for `probe-memory.mjs`.
- **A cache's biggest entry field is usually something nobody reads.** Two separate audits measured
  `sources[].data` on the wire; neither looked at the process holding the same bytes for weeks.
- **Price a cache's ENTRY before choosing its bound.** `facetCache.derived`'s `max: 6000` was chosen
  when an entry was assumed small; it was 34 KB retained, so the cap was a **~200 MB** ceiling. It
  is ~39 MB now.

⚠️ **The next real blocker for phase 4, found here and NOT fixed.** That 6,000-entry cap is fine at
2,553 pool items and fatal at 50k: `buildEntries` peeks the cache for every pool item, so a 50k pool
would evict what it just wrote and miss on **every** rebuild — a full re-derivation (JSON.parse of
~875 MB of blobs) every time the content signature moves, against ~890 ms for a cold rebuild at
2,553 today. Raising the cap does not help either: 50k × 6.4 KB is ~320 MB of heap. The honest
answer is to stop deriving the pool from blobs at request time at all — **persist the projection**
(a `media_item_projection` row per item, written by the fill/sync jobs) so a rebuild is a table scan
rather than a re-derivation. That is a schema change and a phase-4 decision. Size it before starting
phase 4, not during.

---

## 14. Phase 2, second slice — and why the third one waits for phase 4 (2026-08-28)

Picking phase 2 back up after phase 3 closed turned up a dependency this document
had backwards.

### The browse half is blocked on BREADTH, which is phase 4

Serving anon Discover from the DB by default needs a catalog worth serving. Measured
2026-08-28, the whole browse window:

| direction | game | movie | show | of which `browsed` |
|---|--:|--:|--:|--:|
| future (today → +550d) | 59 | 52 | 42 | **128 of 153** |
| past (−550d → today) | 99 | 110 | 25 | 88 of 234 |

**153 items in the future window, and five sixths of them are rows the provider feed
itself wrote** while somebody scrolled past. Serving that as the default browse would
be a circular feed, thinner than TMDB's upcoming list and made of the same data one
step staler. Phase 4's backfill is the prerequisite, not phase 3's shelf/pool split.

Two more measurements that shrink the case for doing it sooner:

- **Discover has no crawler cost to kill.** `/discover` is in `robots.ts`'s
  `DISALLOW` list and is entirely client-rendered, so no crawler fetches it or
  `/api/discover`. §2's "kills the crawler cost" row belongs to the FACET pages,
  which are a different surface with their own plan (`docs/seo.md`).
- **Anon browse already costs almost nothing.** `discoverFeed`'s `_pageCache` holds
  each page for 15 minutes across every visitor, so the fan-out is ~5 provider calls
  per quarter-hour regardless of traffic.

⚠️ **A cold-facet-page number was attempted and thrown away.** Prod had just
redeployed, and a CONTROL run with no page request at all moved TMDB +9, IGDB +1,
Steam +4 and Trakt +1 in six idle seconds — the whole delta a `/tag/` load appeared
to cause. Boot-time jobs make prod unmeasurable for a while after a deploy. The "a
cold `/tag/` page should now cost 10 calls" figure remains a PREDICTION.

### What did ship: search asks our own catalog first

§1 always said "a text search hits the DB first and falls through to the providers
only when we have no good answer". Half of that was already true and nobody had
noticed the other half was gated: the client calls `/api/discover/find` (our catalog)
for the primary results and `/api/discover?q=` (the providers) for "More from the
databases" — **but `find` was `withUser`**, so a logged-out visitor's search was
answered by the provider fan-out alone. Five uncached calls, two of which (RAWG on
its quota, Letterboxd with no key) 401 on prod every time, to answer a question the
catalog often already held.

`find()` now takes `userId: string | null`. The rule that makes it safe is that every
per-user field is empty **by construction** rather than by filtering: no profile is
built and no state map is fetched, so there is no branch that could return one
visitor another's state. `/api/discover/facets` had been public since 2026-08-18 for
the same reason, but the Discover call site kept its own `authed &&` gate, so the
People and Tags groups stayed invisible for ten more days. → `discoveryAnonSearch.test.ts`

**And the provider search was the last uncached provider boundary in the app**, which
AGENTS.md has required of every other one since August. Now `sharedCache`d for 15
minutes on (type, lowercased query), never caching an empty result. Measured on a
production build: `q=dune` **666 ms cold, 4 ms warm**.

⚠️ **`max: 60`, and the number is measured.** An entry carries each item's `raw`
payload, and `GET /api/dev/dbsize?caches=1` prices one at **51,003 bytes** over five
real queries. The first draft said 150 on a guess of "tens of KB" — a 7.7 MB ceiling
for a cache that mostly serves repeats inside one 15-minute window.

### What "no good answer" cannot mean

The obvious next step — skip the provider call entirely when the catalog answers
well — **does not survive scrutiny, and should not be attempted with a cleverer
heuristic.** Any bar has to decide completeness from our own rows, and a title is a
prefix of its own sequels: an exact match on "Blade Runner" would hide *2049*, and
"Cars" would hide *Cars 3*. The catalog cannot know what it is missing. The local
half is served first and fast; the provider half stays, and the cache is what makes
it cheap.

### Verifying an anonymous surface without logging out

`/api/auth/logout` bumps `session_epoch` and kills Nils's own browser session, and
the session cookie is `httpOnly` so JS cannot clear it. **`127.0.0.1` is a different
cookie jar from `localhost`**, which gives a genuinely anonymous context on the same
server. ⚠️ It must be the **`prod` launch config**: `next dev` rejects `127.0.0.1`
outright (403 on every chunk, HMR websocket refused), so the page never hydrates and
looks exactly like the documented dev-hydration failure.

---

## 15. Phase 4, step 1: the derived projection lives on disk (2026-08-28) — SHIPPED

§13 flagged `facetCache.derived`'s 6,000-entry cap as phase 4's blocker. It is, and
the size of it was measured rather than assumed — by shrinking the cap instead of
growing the catalog, which is the same ratio:

| pool rebuild | |
|---|--:|
| memory-warm | **64–72 ms** |
| memory 2.1× oversubscribed | 368 ms |
| memory 5.1× oversubscribed | 436 ms |
| memory 12.8× oversubscribed | **495 ms** (7.7×, and saturating) |
| cold, nothing cached anywhere | 590 ms |

The penalty saturates because `buildEntries` switches to a bulk read once most
items miss, so a thrashed rebuild simply *is* a cold one. That 590 ms decomposes as
107 ms reading 49 MB of blobs, 148 ms `JSON.parse`-ing them, and mergeLinks +
extractFacets for most of the rest. **A 50k pool sits permanently in the saturated
case: ~10 s of blocking CPU per rebuild**, on the 5-minute TTL plus every content
change.

`media_item_projection` is the same `{facets, merged}` value on a medium that costs
~75× less than RAM. The cap stops mattering:

| pool rebuild, projection table present | |
|---|--:|
| cold, table populated | **175 ms** |
| memory 5.1× oversubscribed | 171 ms |
| memory 12.8× oversubscribed | 171 ms |

**Verified byte-identical** with the table cold and warm: `capture-find.mjs` over
five request shapes (372,500 bytes) and the whole `analyzeLibraryFacets` output
(8,064,556 bytes).

### Three things that are not free choices

- **The key omits `scoringConfigSignature()`**, which the MEMORY key includes. In
  RAM that is a free safety margin (raw facets do not actually depend on the
  config). On disk it would mean every tweak in `/dev/scoring` orphans the whole
  table and rewrites it: at 50k items, ~315 MB of WAL for Litestream to ship, which
  is the shape of the PR16 incident that blew the spend cap. Freshness is
  `(last_synced, raw_len)`, which is what actually determines the value.
- **The DEFAULT region only.** Without that guard the real database stored TWO
  regions after a single session — `DEFAULT_COUNTRY` from the pool, the user's own
  country from `/api/library` and `/api/calendar` — **4,589 rows for a 2,553-item
  catalog**. Regions multiply, and each one is another ~315 MB at phase 4's target.
  Only the pool iterates the whole catalog, and it always uses the default; every
  other caller is bounded by one library or one month, which memory already covers.
- **NOT a `dbPrune` PRUNABLE_WHERE entry, and this is the one place that rule is
  deliberately not followed.** That predicate lists tables whose rows would take a
  USER'S OWN data with them; these are a pure function of `media_links` and cost one
  re-derive. Listing it would make every browsed row unprunable the moment it was
  rendered once, i.e. it would turn the boot prune off. `ON DELETE CASCADE` cleans
  up instead, pinned by a test.

Bounded by ROWS on the existing unref'd 15-minute sweep, in batches (PR16 again),
and with **no TTL at all**: a projection is stale only when its item's links change,
which the freshness token already catches on read. The sweep also clears rows for a
region it no longer persists, so a policy change self-heals instead of leaking.

⚠️ **`scripts/migrate.mjs` does not create this table**, or any other table in
`db.ts`'s CREATE block — it calls `runMigrations` only. Verified against a copy.
Harmless, because every query goes through `getDb()`, which runs that block first.

### ⚠️ What this does NOT finish

At 50k a rebuild is **~3.4 s, down from ~10 s**. Better, and still not a number that
can sit on a request path. The remaining cost is reading and parsing the projections
themselves (~315 MB at 50k) plus building vectors and folding the vocab.

**The next step is to stop rebuilding the pool wholesale.** `getCache()` already
patches membership changes incrementally; a CONTENT change forces a full rebuild
because un-counting a departing item's vocab contribution needs its RAW (pre-alias)
facets, and the pool vector only carries post-alias ones — which is exactly what the
code comment in `getCache()` says. **The projection table now stores those raw
facets**, so the missing input exists. Add a `WHERE updated_at > <last build>` query
for the changed set and the rebuild becomes proportional to what moved, not to the
catalog. That is the step that clears phase 4, and it should come before the backfill
rather than after it.

---

## 16. Phase 4, step 2: a content change patches the pool (2026-08-28) — SHIPPED

§15 stopped the memory cap deciding what a rebuild costs. This stops most rebuilds
happening at all.

Any write that moved `media_items.updated_at` on a pooled row threw the whole pool
away: every sync, every ingest, every heal by the fill job. **It could not be
incremental before, and `getCache()` said why in as many words** — removing an item's
contribution needs its RAW (pre-alias) facets to un-count the vocabulary exactly, and
the pool vector only carries post-alias ones. `_cache.rawFacetsById` now keeps them
(the same `Facet` objects the derivation already produced, so roughly one pointer per
occurrence), which makes `unfoldEntry` an exact inverse of `foldEntry`.

Measured on the real catalog, with `updated_at` spread over real time so a change is
a change rather than "the whole catalog shares one second":

| items changed | pool cost | vs a rebuild |
|---:|---:|---:|
| 1 | **5 ms** | 16.2× cheaper |
| 10 | 5 ms | 16.1× |
| 100 | 9 ms | 10.0× |
| 500 | 25 ms | 3.4× |
| *(full rebuild)* | *87 ms* | |

What remains is a FIXED cost — `sortVocab` + `computeIdf` over the whole vocabulary —
rather than one proportional to the catalog. That is the property that matters at 50k.

### Exactness is the only interesting question

A patched vocabulary that is merely close is not a small bug. `computeIdf` reads those
counts, so every ranking on the site shifts, silently, with nothing to look at. So a
patched pool was compared against a rebuilt one **on the real catalog** — the tag
vocab with counts, every IDF weight to nine decimals, and the full facet arrays of
400 items: **identical, 1.7 MB of comparison**. Plus `discoveryContentPatch.test.ts`,
which diffs the two field by field over eight cases, including:

- a facet only the changed item carried, which must LEAVE the vocab rather than
  linger at count 0 where `computeIdf` still weights it
- a facet two items share when one drops it: 2 → 1, not 0 and not 2
- an item carrying no tags at all (nothing to unfold from `rawTagCounts`)
- a deletion, which still rebuilds — which row went is unknowable from an aggregate,
  because it is gone
- membership and content moving in the same pass

**Every check that could be wrong runs BEFORE anything is mutated**, and a throw from
`unfoldEntry` is caught and answered with a rebuild. A wrong patch costs one rebuild,
never a wrong pool.

### Three things worth not rediscovering

- ⚠️ **The changed set is `updated_at >= prevMx`, not `>`.** `updated_at` is
  `strftime('%s','now')`, so a write in the same second as the previous watermark is
  invisible to `>` — a silently stale vector, which is much worse than the handful of
  idempotent re-derivations the overlap costs. Pinned by a test.
- ⚠️ **`contentSignature` cannot see a re-sync inside its own second at all** (neither
  count nor MAX moves). That predates this work — the old code did not rebuild either
  — and the 5-minute TTL is what covers it. It is also why the tests bump
  `updated_at` by hand: they run in milliseconds, so without it every re-sync is
  invisible and the assertions test nothing.
- ⚠️ **A same-length payload swap defeats the facet cache's freshness token**, which
  is `(last_synced, OCTET_LENGTH)`. Writing this section's tests hit it by accident:
  swapping a genre "Steampunk" for "Cyberpunk" is nine bytes for nine bytes inside one
  second, so the token does not move and the cache correctly serves the old
  derivation. That is the documented limit of a length-not-hash token, and it is worth
  knowing before blaming the code.

### What still rebuilds, and what phase 4 needs next

- **An alias or bundle edit.** A bundle changes what EVERY vector's facets resolve to,
  so there is no changed set smaller than the catalog. Correct as it stands.
- **The 5-minute TTL**, deliberately not refreshed by a patch — it is the backstop
  against any drift no signature here is watching, and a stream of ingests must not be
  able to hold a patched pool open forever. ⚠️ **At 50k this is now the dominant
  remaining cost**: one ~3.4 s rebuild every five minutes, landing on whichever
  request arrives. Before the backfill, decide whether to raise it (the patch path is
  now proven equal to a rebuild, which is the argument for) or to move the rebuild
  itself off the request path the way §12 moved scoring. **Measure it at size first.**

With those two, phase 4's remaining work is the backfill itself: the seeded ingest,
the tiered refresh, and §6's open questions on provider terms at scale — which are a
reading task, not an engineering one, and are still unanswered.

---

## 17. The provider terms, read at last (2026-08-28)

§6 asked whether a large stored derivative is allowed before anyone builds one. Read
2026-08-28, from the primary sources rather than summaries. ⚠️ **Not legal advice, and
the wording matters more than this summary** — the links are there to be read.

| provider | stored-data position | items | verdict for a 30–50k catalog |
|---|---|--:|---|
| **TMDB** | Cache capped at **6 months**; "make derivatives" prohibited; free tier non-commercial | 1,617 | 🟡 **conditional** — see below |
| **IGDB** | Twitch DSA: storing copies needs **prior written authorization**, else a **24-hour** cache | 1,008 | 🟡 **open, running behind a kill switch** (§17c) |
| **Steam** | Terms *contemplate* storage (declare it, name the country); **no retention limit** | 809 | 🟢 fine |
| **RAWG** | non-commercial, 20k/mo | 741 | already dropped from the facet paths (PL3) |

Sources: [TMDB API Terms of Use](https://www.themoviedb.org/api-terms-of-use) §1.C ·
[Twitch Developer Services Agreement](https://legal.twitch.com/legal/developer-agreement/) ·
[Steam Web API Terms](https://steamcommunity.com/dev/apiterms) ·
[IGDB API docs](https://api-docs.igdb.com/)

### TMDB: the cap is on AGE, not size, and that changes everything

The clause forbids caching TMDB information **for longer than six months**. It says
nothing about how many rows you may hold. So a 50k catalog is not the problem; a 50k
catalog nobody re-fetches is. **The terms turn phase 1's vague "tiered refresh" into a
specified one: a hard maximum interval of six months, per row.** At 50k items that is
~275 refreshes a day, against a fill job already pacing 480.

⚠️ **Nothing was enforcing it, and nothing would have.** `healLinks` re-fetches a link
whose PROJECTION VERSION is behind (`isStale`, `detail/enrich.ts`); age is not part of
that test, so once an item heals its `last_synced` never moves again. The catalog was
compliant only by being younger than six months: the oldest tmdb link measured
2026-06-05, so the first silent breach would have landed **around 2026-12-02**.
`lib/retention.ts` fixes that — §17b.

Two clauses stay unresolved and are Nils's call, not an engineering one: **"make
derivatives of TMDB Content"** is vague enough that a projected, facet-extracted
catalog could be read into it, and the free tier is **non-commercial**, which the ads
plan (H3) already collides with independently of anything here.

### IGDB: the licence and the product contradict each other

The Twitch DSA permits storing copies only with prior written authorization or a
**24-hour** cache. Fandex holds 1,008 igdb links indefinitely, so it is already outside
that on a literal reading, before any backfill.

But IGDB's own API ships **webhooks whose only purpose is keeping your copy of their
data current**, its docs open with a paragraph about the accessibility of their data,
and it offers a commercial partnership. A product built to maintain your local mirror
is hard to square with a 24-hour cache limit.

**That contradiction is not resolvable by picking a number, and this project has been
wrong about provider terms twice.** It needs one email to `partner@igdb.com`.
⚠️ Note the standing rule in TASKS.md is about not inviting scrutiny from TMDB and
Trakt *while monetizing on their free tiers*; IGDB is not in it and Fandex is not
monetizing yet, so the calculus differs — but it is still Nils's call to send.

### What this means for the build order

- **Steam-sourced breadth is unblocked today.**
- **TMDB-sourced breadth is unblocked once the refresh guarantee exists**, which it now
  does (§17b). The non-commercial question is unchanged by scale and already tracked
  against H3.
- **IGDB-sourced breadth runs, behind a kill switch** (Nils, 2026-08-28). The question is
  open, not answered, so the decision was to keep going and make a "no" cheap:
  **`IGDB_ENABLED=0`** stops every IGDB call at once, and **`scripts/purge-igdb.mjs`**
  removes what is already stored. → §17c.

## 17b. Retention enforcement (2026-08-28) — SHIPPED

`lib/retention.ts` marks an ageing link's `projection_version` back to 0, which is
exactly the queue `fillCandidates` already selects and `healLinks` already drains. A
contract deadline therefore reuses the existing fetch, pacing, budget and logging path
and adds **one UPDATE**. It runs before the fill on each tick, because a refresh on a
clock outranks an enrichment that is not.

- **Marking degrades nothing.** `raw_data` is untouched, so facets, scores and pages
  read exactly as before; the row is only queued.
- **A one-month LEAD before the cap.** Marking at exactly six months would guarantee a
  breach on any failure. The month is room for the queue to drain, an outage to pass,
  and a title TMDB now 404s to be noticed while it is still legal to hold.
- **`retentionStatus().expired` is logged as an ERROR, not a warning.** It is not a
  threshold, it is a term being breached, and it should be unreachable while the fill
  drains — which is why it is measured rather than assumed.
- ⚠️ **There is deliberately no DELETE fallback.** If a row ever ages out because the
  provider will not serve it, the strict remedy is to drop the cached content — but
  TMDB-derived content includes `media_items.title`, `poster_url` and `release_date`,
  so a literal purge takes the public page with it. That is a data-loss decision for
  Nils, not one to encode from a reading of a contract. The lead time exists so it
  stays hypothetical; `expired > 0` in the logs is the signal that it did not.

## 17c. The IGDB kill switch (2026-08-28) — SHIPPED, and ENABLED

Nils's call: keep going with IGDB while the licence question is open, and make a "no"
cheap to act on rather than waiting for an answer that may take weeks.

**`IGDB_ENABLED=0` stops every IGDB call at once. The default is ON.** Default-on is
deliberate for a KILL switch: a typo in the env var should leave the site working, not
silently drop a third of the catalog's games. The failure direction that matters is the
loud one.

It hangs off `igdbConfigured()`, which this codebase already treats as "IGDB is
optional, no-op cleanly". ⚠️ **Two exported functions did not honour that contract** —
`getIgdbGame` and `searchIgdbGames` reached `igdbQuery` directly — so the switch would
have been a **throw** on the `/r/` resolver page rather than a no-op. Both self-gate now.

`igdbKillSwitch.test.ts` pins the property, not the pattern:

- every async entry point resolves empty rather than throwing
- **`fetch` is never called at all.** Asking is the half the licence question is about,
  not only storing, so a call that reached IGDB and discarded the result would still be
  wrong
- the pure formatters keep working, so data we already hold still renders
- a structural check fails any future `export async function` that reaches `igdbQuery`
  without the guard — the exact shape that leaked the switch the first time

All three behavioural checks were verified to go RED when a guard is removed.

### If the answer is no: `scripts/purge-igdb.mjs`

Flipping the switch stops the flow; it does nothing about what is on disk. That is a
separate, explicit step, because deleting catalog data is not something a config flag
should ever do by itself.

**It deletes LINKS, not items.** Proven on a copy of the real database:

| | |
|---|--:|
| igdb links deleted | 1,008 (5.0 MB of `raw_data`) |
| derived projections deleted | 908 |
| external ids deleted | 1,008 |
| `media_items` surviving | **2,770 (all of them)** |
| `user_item_state` surviving | **2,482 (all of them)** |
| FK violations after | **0**, `integrity_check ok` |

It reports the set that actually matters **before** touching anything: **100 items where
IGDB is the only source**, none of them acted on by a user. Those keep their row, uuid,
slug and title, but lose every provider link, so they have no refresh path left. That
set is the real decision, and its size is not guessable in advance.

⚠️ **Set `IGDB_ENABLED=0` and deploy it before purging.** Purging a running app that
still calls IGDB just refills what you deleted, and burns quota doing it.

⚠️ **A WAL-mode database is the `.db` file PLUS its `-wal`.** Copying only the `.db`
gives a pre-WAL snapshot that reads as a perfectly valid database with stale contents.
It bit this script's own dry run: **1,580 projections reported against the 908 actually
there**, because a recent DELETE was still in the WAL. That is a bad way to decide what
to purge, so the script now says what it is reading.

---

## 18. Phases 4, 2 and 5, completed (2026-08-28)

Everything the plan still needed, minus the weeks of paced provider calls the backfill
deliberately takes. All three are **off by default**, because one grows the database,
one changes where browse comes from, and one deletes bytes.

### Phase 4 — the seeded backfill (`catalogBackfill.ts`)

Six lanes, one per (type, direction), walked page by page from a cursor that survives a
deploy. It reuses the **same fetchers the Discover feed calls**, so there is one
definition of a candidate, one circuit breaker, one page cache, and games stay
dual-source. `BACKFILL_ENABLED=1` to run it; `BACKFILL_MAX_ITEMS` (50,000) is a real
ceiling, not a formality.

**Proven against real providers on a copy**: 2,770 → 2,807 items over three passes,
every lane advancing, cursors persisting, and the future window growing from 51/40/62 to
52/51/73 across movies, shows and games.

⚠️ **Two faults the live run caught that no unit test would have**, both worth keeping:

- **A lane was retired on page 1 with nothing seen.** RAWG is quota-latched, and
  `fetchGamePageAllSources` SWALLOWS a provider failure and answers `[]` — so an empty
  page cannot tell "this window is finished" from "this provider is down". That is the
  same `undefined` vs `[]` confusion the prune invariant exists to prevent, here costing
  a lane that silently never runs again. **Three consecutive empties now**, and any good
  page resets the count.
- **One lane was hammered while five starved.** `last_run` is `strftime('%s','now')`, so
  every lane a pass touches ends up in the same second and the least-recently-run sort
  cannot separate them. Lanes are now tracked within a pass, tie-broken by
  **declaration order** rather than alphabetically, which would have quietly
  re-prioritised the `LANES` list.

### Phase 2 — the browse switch (`catalogFeed.ts`)

Once a (type, window) holds enough stored rows, the anonymous browse and load-more read
the database and cost **zero provider calls**. `CATALOG_BROWSE=1`, threshold
`CATALOG_BROWSE_MIN` (200).

⚠️ **The gate is the design, not a guard on it.** Serving the 153 items the future
window held before the backfill would have produced a circular feed: thinner than the
TMDB list it replaced, made of the same data one step staler, and **it would have looked
like it worked**. Readiness is measured per type and per window because the lanes fill
at different rates.

### Phase 5 — housekeeping by bytes (`catalogHousekeeping.ts`)

70% of the file is `media_links.raw_data`. This drops **blobs, never rows**, so a title
keeps its uuid, slug, public page and every user relation — deleting rows is what makes
public pages 404, which the archive already records as an accepted loss from last time.

A **size** trigger (`HOUSEKEEPING_START_MB`, 1200), not an age one: there is no benefit
to dropping a blob from a small database, and it costs a refetch later. The never-evict
list names every table one by one the way `dbPrune`'s predicate does, and each clause
has its own test: acted on, episodes tracked, in a public snapshot, named by a franchise
override, still waiting to be healed, or never projected.

⚠️ It only touches rows at the CURRENT projection version and with a stored projection.
The blob is redundant **because** the derived form exists (§15); without that, dropping
it loses the data outright until a refetch. The price stands either way: a future
`PROJECTION_VERSION` bump cannot re-derive an item whose blob is gone.

### Also

- **The pool TTL is 5 min → 60 min.** A re-sync of an acted-on browsed row now patches
  instead of rebuilding, so every real change path is patched and the TTL is a pure
  backstop — the last full rebuild left on a request path.
- **`/api/health` reports all four jobs** (`catalog`), because a background job that
  reports nothing is indistinguishable from one that is not running, which this project
  has shipped twice.

### What is left, honestly

**Data, not code.** The backfill is paced at ~2 pages per 30 minutes because 30–50k
titles is 60–120k provider calls and every row is WAL that Litestream ships. Turning
that up is how it becomes the PR16 incident again. Switch it on, leave it for weeks,
and flip `CATALOG_BROWSE=1` when `/api/health`'s `catalog.browse.windows` says a type is
ready. The one thing still worth an answer is IGDB (§17c), and the kill switch is what
makes that answer cheap.
