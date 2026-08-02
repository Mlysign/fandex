# Performance audit — 2026-07-30, updated 2026-07-31

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

| Route | Before (2026-07-30) | After list projection | After the shared cache (2026-07-31) |
|---|--:|--:|--:|
| `/api/library` | **38,868 KB** · 942 ms | 7,556 KB · 578 ms | **7,560 KB · ~500 ms** |
| `/api/calendar` | 1,660 KB · 95 ms | **346 KB** · 75 ms | 346 KB · ~85 ms |
| item detail page (DOM) | 1,239 nodes · 2 `/api/detail` · 2 YouTube iframes | 723 nodes · 1 · 1 | unchanged |
| `/api/home` | no cache, 3 provider calls per view | 30 min cache | unchanged, warm ~450–545 ms |

The two fixes stack: the list-projection cut (§1) removed 31 MB of payload that was never the CPU
cost; the shared facet cache (§4, added 2026-07-31) removed the redundant re-parse-and-re-merge work
underneath what's left. `/api/calendar` barely moves on the cache alone — its wishlist (95 rows) was
never big enough for the parse cost to dominate; `/api/library`'s 1,921 rows are where it shows.

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

## 4. The duplicate-parse sites — FIXED (the safe half), 2026-07-31

`/api/library`, `/api/calendar`, `analyzeLibraryFacets` and `loadMembershipGroups` each
independently `JSON.parse`d `raw_data` and called `mergeLinks()` + `extractFacets()` themselves for
the same items, on every request — the duplicate-parse sites, precisely (an earlier draft of this
doc said `buildProfile` parses too — it does **not**, it goes through the cached
`getLibraryFacetAnalysis`):

| site | parsed |
|---|---|
| `libraryAnalysis.ts` (`analyzeLibraryFacets`) | every library item's links |
| `libraryAnalysis.ts` (`loadMembershipGroups`) | called **twice** — library, then watchlist |
| `api/library/route.ts` | the same library rows again, independently |
| `api/calendar/route.ts` | the wishlist rows again, independently |

New `src/lib/facetCache.ts` caches the **derived** `{facets, merged}` per
`(mediaItemId, MAX(last_synced), region, scoringConfigSignature())` — a caller checks freshness from
a plain SQL column (no parse needed) and skips straight to the cached result on a hit. All four
sites above now share it; a repeat `/library` visit with an unchanged library skips the parse
entirely instead of redoing it.

**Cache the derived shapes, never the raw parse** — this was the explicit design constraint, not an
afterthought. Caching parsed `raw_data` objects (rather than these small derived shapes) would trade
a CPU problem for a memory one: parsed JS objects for 30 MB of JSON are several times that on the
heap, on a container with real OOM history (`image-optimizer-native-memory`). `facets`+`merged` for
the whole pool is on the order of a few MB.

Returns **raw** (unaliased, non-override) facets deliberately — only `analyzeLibraryFacets` applied
tag-alias canonicalization + category-override resolution before; the routes and
`loadMembershipGroups` called `extractFacets` raw and always have. Baking that resolution into the
shared cache would have silently changed what `computeFandexScore` sees for callers that never asked
for it — a scoring-behavior change, not a caching one. Every caller keeps its own existing
post-processing (or lack of it) exactly as before.

One small, deliberate, strictly-widening side effect: `getMembershipSignal`'s original-language tally
used to read straight off a link's raw TMDB blob (a trakt-only item with no tmdb link contributed
nothing); it now reads `merged.originalLanguage` (mergeLinks' own tmdb-then-trakt priority), since the
cache doesn't expose raw per-source blobs. Never narrows what worked before.

6 tests cover cache-hit-on-unchanged-freshness, invalidate-on-bump, invalidate-on-live-config-write,
mutation-safety (a caller mutating the returned array can't corrupt the next caller's read),
raw-facets-not-post-processed, and per-region isolation.

## Still open — the harder half, deliberately deferred to a supervised pass

### A. The catalog pool cache is still invalidated far more often than it needs to be

`buildCache()` ([discovery.ts](../src/lib/discovery.ts)) still rebuilds the WHOLE pool — 4,133 link
rows / 39.0 MB of `raw_data` — from scratch on every rebuild, and `catalogSignature()` counts
`POOL_WHERE`, which includes `mi.id IN (SELECT media_item_id FROM user_item_state)`: **any**
wishlist/library/rating write still changes the signature and forces a full pool re-parse, even
though the shared cache above means each individual item's re-derivation is now fast.

**Fix:** split the pool signature — keep `browsed = 0` count/`MAX(updated_at)` as the catalog
component, and treat a newly-acted-on item as an incremental *add* to the existing cache rather than
a full invalidation. Reserved for a supervised pass, not this one: get it wrong and a newly
wishlisted item can silently miss the pool until the next TTL expiry — a failure that's silent, not
loud, which is exactly the class of change this batch's plan excluded from an unattended session.
**The must-have test before it ships:** a wishlist write makes the item appear in `find()` results
*immediately*, not on the next TTL expiry.

### B. DB inflation — the 2.5 GB prod question is still open

| | |
|---|--:|
| local `rr.db` | 55.9 MB |
| local `rr.db-wal` | **48.4 MB** — checkpointing is not keeping up |
| `media_links` | 6,054 rows / 44.8 MB `raw_data` (**7.4 KB avg**) |
| `media_items` | 4,405 rows, **1,879 of them `browsed`** |
| prod `rr.db` | ~2.5 GB (memory: `prod-db-size-and-page-cache`) |

A 48 MB WAL against a 56 MB main file is the thing to look at first. Deferred with the rest of the
schema-adjacent work: a persisted facet-projection column, shrinking the `raw_data` projection, and
`dbPrune` coverage of the browsed tail. **The WAL/checkpoint half is now investigated — see below.**

#### The local WAL, investigated 2026-08-02 (report-only, no change shipped)

**The local WAL is real and larger than the table above shows — 57.2 MB as of this pass, unchanged
since 2026-07-30 18:10 — but it's a dev-process-lifecycle artifact, not a stuck checkpoint or a real
bug.** Investigated against a scratchpad COPY of `data/rr.db` + its `-wal`/`-shm` sidecars; the real
files were never written to.

**Measurements** (via the app's own diagnostic tooling — `walDiagnostics()`/`checkpointTruncate()` in
`src/lib/dbPrune.ts`, built for the 2026-07-22 Litestream-checkpoint-stall incident, reused here rather
than reinvented):
- `page_size` = 4096, so SQLite's default `wal_autocheckpoint` (1000 pages, never overridden by
  `db.ts`'s pragma block — confirmed by reading it: `journal_mode`, `foreign_keys`, `busy_timeout`,
  `synchronous` only) is a **~4.12 MB** threshold.
- The actual WAL was **57,181,512 bytes ≈ 13,879 frames — about 13.9× that threshold.**
- **No node process was running at measurement time** (`tasklist | grep node` — empty), yet the real
  `data/rr.db-wal` sat unchanged at that size for 3+ days. This alone rules out "a live process is
  still writing" — nothing has touched it since whatever session last wrote to it ended.

**The decisive test:** opened a fresh `better-sqlite3` connection, with the app's exact PRAGMA
sequence, against the scratchpad copy of the exact same 57.2 MB WAL bytes. **The WAL was fully
reclaimed to 0 the moment the connection opened** — before any query ran, before any explicit
checkpoint call. A subsequent `PRAGMA wal_checkpoint(PASSIVE)` and `PRAGMA wal_checkpoint(TRUNCATE)`
both confirmed `{busy: 0, log: 0, checkpointed: 0}` — there was nothing left to reclaim, and closing
the connection afterward deleted the `-wal` file entirely (`fs.statSync` on it then threw `ENOENT`).

**Diagnosis: dev artifact, not a real problem, and NOT the 2026-07-22 prod mechanism.** That incident
was Litestream — a separate OS process — setting `wal_autocheckpoint = 0` on its own connection to
take exclusive control of checkpointing, then stalling and holding a read lock that blocked every
other connection's checkpoint progress too (`dbPrune.ts`'s own comment: *"walMb pinned at 60.7 across
12 h... then at 130.3 for 200 s with zero writes"*). Two independent checks rule that mechanism out
here: **(1) Litestream never runs in local dev at all** — it's gated behind `AWS_S3_BUCKET_NAME` in
`docker-entrypoint.sh`, which only executes inside the Docker/Railway container, never under
`npm run dev`; **(2)** the measured `wal_autocheckpoint` read back as SQLite's normal default (1000),
not 0 — nothing forced it off. What's actually happening locally: a `next dev` session's `getDb()`
singleton connection stays open for the whole session, accumulating writes across hours without a
clean shutdown (Ctrl+C / closing the terminal doesn't reliably run `db.close()`), so SQLite never gets
the "last connection closing" signal that would otherwise checkpoint+shrink the file. The WAL just
sits at its session high-water mark between dev sessions — and, as the decisive test showed, gets
fully reclaimed the instant a fresh connection opens.

**Prod-affected: no**, for this specific mechanism — prod's WAL behavior is governed by Litestream
(a materially different, already-diagnosed-and-tooled-for failure mode from the 2026-07-22 incident,
not re-litigated here) rather than a `next dev` process lifecycle that doesn't exist in the Docker
container.

**The precise change, if this were ever worth shipping (it isn't — see below):** none to `db.ts`'s
PRAGMA block; the default `wal_autocheckpoint` is already doing its job correctly. If Nils ever wants
a smaller `data/rr.db-wal` between dev sessions purely for disk/OneDrive-sync-noise reasons, the
already-built tool is `checkpointTruncate()` behind `/api/dev/prune` (same `SCORING_ADMIN_USER_IDS`
gate as `/api/dev/dbsize`) — no new code needed, just run it after stopping the dev server. **Not
recommending this as an action item**: 57 MB of local disk is not a real cost, and the file
self-heals on the next connection regardless.

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
