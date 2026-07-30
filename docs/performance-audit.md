# Performance audit — 2026-07-30

Measured against the real local `data/rr.db` (1,921 library items · 95 wishlist · 1,635 rated ·
4,405 `media_items` · 6,054 `media_links`), logged in, `next dev` on port 3000. Harness:
`scripts/perf-probe.mjs` (TTFB + payload per route, cold and warm).

```bash
node scripts/perf-probe.mjs --cookie "rr2_session=…"
```

> **Read the warm column, not the cold one.** On a dev server a cold hit is mostly Next's
> per-route compile; it's only useful as "did this route gain a whole new dependency tree".
> Warm is what to compare across a change.

## Headline: the biggest problem was payload, not CPU

| Route | Before | After | Δ |
|---|--:|--:|--:|
| `/api/library` | **38,868 KB** · 942 ms | **7,556 KB** · 578 ms | **−81% bytes**, −39% time |
| `/api/calendar` | 1,660 KB · 95 ms | **346 KB** · 75 ms | **−79% bytes** |
| item detail page (DOM) | 1,239 nodes · 2 `/api/detail` · 2 YouTube iframes | 723 nodes · 1 · 1 | **−42% nodes** |
| `/api/home` | no cache, 3 provider calls per view | 30 min cache | warm 405 ms |

### 1. `/api/library` shipped 30.7 MB of raw provider blobs — FIXED

`enriched.push({ ...merged })` spread `mergeLinks`' output wholesale, and that output includes
`sources: { source, sourceId, data }[]` where **`data` is the complete raw provider payload for
every link of every item**. Per-field totals across the real library:

| field | MB |
|---|--:|
| **`sources`** | **30.7** |
| `cast` | 1.12 |
| `description` | 0.89 |
| `images` | 0.71 |
| `storeLinks` | 0.62 |
| everything else | ~2.5 |
| **total** | **36.5** |

Nothing on the client reads `sources[].data` — `buildItemHref` and the quick actions only need
`{source, sourceId}`. `/api/library` and `/api/calendar` now emit the identity pair with an empty
`data`. `/api/detail` still sends the blobs, deliberately: it's one item and the debug explainer
uses them.

`cast`/`images`/`description` were left in (~2.7 MB): small per item, and several surfaces read them
off this payload. The blobs were the whole problem.

### 2. The item page rendered its entire content tree twice — FIXED

The first cut of the 2026-07-30 detail rebuild used a `lg:hidden` mobile tree plus a
`hidden lg:block` desktop tree. **CSS visibility is not conditional rendering**: both were always
mounted, so the page ran `<PersonalSection>` twice (two `/api/detail` round-trips per view) and
mounted the trailer `<iframe>` twice (two YouTube players loading, one invisible). Now the layout
switches with CSS and the content renders once — 1,239 → 723 DOM nodes.

### 3. `/api/home` had no cache on a public route — FIXED

Home is the one public route that calls providers. Before, every anonymous view and every crawler
hit fired 3 upstream requests. Now a 30 min `BoundedCache` keyed `region:day` holds the ranked
pools; the per-user rail keeps `personalizedFeed`'s existing 45 min cache. Cold 5.2 s (provider
latency, unavoidable) → warm 405 ms.

---

## Measured but NOT fixed — specified for a separate reviewed pass

Both of these are real and quantified. They're deferred because they touch the caches every
surface reads, and getting one subtly wrong fails *silently* (stale facets, or an item missing from
the pool) rather than loudly — the plan reserved that class of change for its own pass.

### A. The discovery cache re-parses 39 MB of JSON on the request path

`buildCache()` ([discovery.ts:148](../src/lib/discovery.ts)) selects the whole pool ⟕ `media_links`
and `JSON.parse`s every blob, synchronously, in the request:

- **4,133 link rows / 39.0 MB of `raw_data`** per rebuild (2,531 pool items)

…and it's invalidated far more often than the catalog actually changes:

- `catalogSignature()` counts `POOL_WHERE`, which includes
  `mi.id IN (SELECT media_item_id FROM user_item_state)` — so **any** wishlist / library / rating
  write changes the signature and forces a full 39 MB re-parse
- plus a 5-minute TTL, `tagAliasSignature()`, and explicit `invalidateDiscoveryCache()` calls

**Fix, in two parts.** (i) A shared `BoundedCache<mediaItemId, {sig, facets, merged}>` keyed on the
item's `MAX(last_synced)` + region, so a rebuild reuses per-item work instead of re-parsing
everything. (ii) Split the pool signature: keep `browsed = 0` count/`MAX(updated_at)` as the catalog
component and treat a newly-acted-on item as an incremental *add* rather than an invalidation.

The duplicate-parse sites, precisely (an earlier draft of this doc said `buildProfile` parses too —
it does **not**, it goes through the cached `getLibraryFacetAnalysis`):

| site | parses |
|---|---|
| `libraryAnalysis.ts:126` (`analyzeLibraryFacets`) | every library item's links |
| `libraryAnalysis.ts:368` (`loadMembershipGroups`) | called **twice** — library, then watchlist |
| `api/library/route.ts:72` | the same library rows again, independently |
| `api/calendar/route.ts:59` | the wishlist rows again, independently |
| `discovery.ts:163` (`buildCache`) | the whole pool — the 39 MB above |

So one signed-in `/library` request parses the library's blobs at least **twice**, and a `/calendar`
request parses the wishlist's twice.

**The trap to test for:** a wishlist write must make the item appear in `find()` results
*immediately*, not on the next TTL expiry. That needs an explicit test before this ships.

**Aliasing hazard on (i):** a shared parsed-`rawData` object is handed to callers that mutate it —
`enrichMissingSources` in `/api/detail` does. Either freeze/clone on read or scope the cache to the
derived `facets`/`merged` rather than the raw parse.

**Memory hazard on (i), and the reason to prefer the derived form:** the parsed JS objects for 30 MB
of `raw_data` are several times that on the heap. Caching them would trade a CPU problem for a memory
one, on a container this project has already had OOM trouble with (see
`image-optimizer-native-memory`). The derived `facets` array is small — order 5 MB for the whole pool.
**Cache facets/merged, never the raw parse.**

### B. DB inflation — the 2.5 GB prod question is still open

| | |
|---|--:|
| local `rr.db` | 55.9 MB |
| local `rr.db-wal` | **48.4 MB** — checkpointing is not keeping up |
| `media_links` | 6,054 rows / 44.8 MB `raw_data` (**7.4 KB avg**) |
| `media_items` | 4,405 rows, **1,879 of them `browsed`** |
| prod `rr.db` | ~2.5 GB (memory: `prod-db-size-and-page-cache`) |

A 48 MB WAL against a 56 MB main file is the thing to look at first. Deferred with the rest of the
schema-adjacent work: WAL/checkpoint tuning, a persisted facet-projection column, shrinking the
`raw_data` projection, and `dbPrune` coverage of the browsed tail.

---

## Memory: no leak found

All 25 module-level caches are `BoundedCache` — the 2026-07-21 lesson (7.5 GB RSS from sharp
decoding full-size RAWG originals, *not* a JS leak) and the P2 sweep both held.
`libraryAnalysis._memberCache` was the last unbounded one and is already capped. `discovery._cache`
is a single large object (2,531 vectors with facets) rather than a growing map, so it's bounded by
construction.

The standing rule from that incident still applies to any future ramp: **`rss` climbing while
`heapUsed` stays flat means stop reading cache code** — it's native memory (image decoding), and
`/api/health` reports the split.

## Housekeeping (local only, not prod)

`data/` holds six stale `rr.db.bak*` snapshots totalling ~950 MB. Flagged, not deleted — several
are pre-migration references the migration tests can rehearse against.
