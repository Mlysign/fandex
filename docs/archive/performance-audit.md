# Performance audit — 2026-07-30 → 2026-08-02 · ✅ CLOSED

> **Every item in this audit is resolved.** §A (the catalog pool rebuild) shipped 2026-08-02 and was
> the last one; §B's prod half moved to PR17's checklist, since it can't be measured while prod is
> down. **Archived — nothing here is open work.** The perf rules that outlived it live in
> `AGENTS.md` and [[perf-audit-2026-07-30]]; the probes (`scripts/perf-probe.mjs`,
> `scripts/probe-pool.mjs`) stay in the repo and are the right starting point for any future pass.

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

---

## ⚠️ Correction (2026-08-02): the 58–60 s Discover load was NEVER this file's §A

The 9th smoke sweep recorded a cold Discover paint of **58–60 s** and attributed it to
§A below ("the catalog pool cache rebuilding 39 MB from scratch"). **That attribution is
wrong.** Measured directly against the real `data/rr.db` (`scripts/probe-pool.mjs`):

| | |
|---|--:|
| full `buildCache()` — the entire §A cost | **~430 ms** |
| — SQL read incl. all 39.1 MB of `raw_data` | 98 ms |
| — `JSON.parse` of every blob | 131 ms |
| — `mergeLinks` + `extractFacets` + vocab/idf | ~200 ms |
| a membership write → promotion visible in `find()` | ~570 ms, and **already immediate** |

§A is a ~0.4 s item. The 58 s was **RAWG being down**: `https://rawg.io/` itself returned
Cloudflare **522** after ~19.8 s on every path, and `http.ts` retried each 5xx twice, so one
call cost `20 + 20 + 20 ≈ 60 s`. `fetchPages` fires 5 RAWG pages under one `Promise.all`,
and `/api/home` reaches RAWG twice — a cold `/api/home` measured **2.2 minutes**.

Note also that §A's stated must-have test ("a wishlist write makes the item appear in
`find()` immediately, not on the next TTL expiry") **already passes today** — verified both
directions (promote and demote) by the probe. The pool signature counts `POOL_WHERE`, so a
membership write does force a full rebuild, but that rebuild is 0.4 s, not a stall. §A
therefore stays open as a genuine-but-small optimisation, not a user-visible problem.

### Fixed instead: per-provider latency isolation (2026-08-02)

We had per-source *failure* isolation (every adapter try/catches) but no per-source
*latency* isolation, so one dead provider stalled every browse request for a minute,
every time, for the whole outage. Three changes, all in the shared HTTP layer:

1. **A per-host circuit breaker** (`src/lib/http.ts`) — 3 consecutive hard failures
   (network error / 5xx; never a 4xx or 429) opens the host for 30 s, doubling to a 5 min
   ceiling while a half-open probe keeps failing. While open, `httpFetch` **throws
   `ProviderUnavailableError` without touching the network**.
2. **A total-time budget** (`budgetMs`) across all attempts, so retries can't outrun it.
   Browse paths pass `BROWSE_BUDGET_MS` (8 s); **sync/pull keeps the old unbounded
   behaviour deliberately** — it runs off the request path and would rather wait.
3. **`bestEffort()` in `discoverFeed.ts`** — the browse fetchers already degraded on a
   returned error status (`if (!res.ok) return []`) but a *throw* went straight past that
   into `fetchPages`' `Promise.all`, rejecting the whole feed. (A latent pre-existing bug:
   a RAWG *timeout* would have 500'd `/api/discover` even before the breaker existed. The
   522s hid it — a 522 is a response, so `!res.ok` caught it.)

**The breaker throws; it never fabricates a Response.** Returning a synthetic 503 would
have needed zero call-site changes — and would have been read as `!res.ok` by the pull
adapters too, turning an outage into an empty library under **the prune invariant**
(AGENTS.md). A test asserts the throw specifically for this reason.

Measured with RAWG still down, cold process each time:

| route | before | after |
|---|--:|--:|
| `/api/home` cold | **2.2 min** | **8.4 s** |
| `/api/home` warm | — | 0.39 s |
| `/api/discover` cold | 58–60 s | 0.14 s (shared caches warmed by home) |

`/api/health` now reports `openProviderCircuits` (host → `{openForMs, failures}`; `{}` when
everything looks healthy) — diagnosing this outage took a manual curl against each provider
in turn, and that answer belongs in the probe we already have.

Home still rendered games throughout the outage: IGDB covers the category when RAWG is
gone, which is the multi-source design working as intended.

---

## ✅ A. The catalog pool rebuild — CLOSED 2026-08-02

**The problem:** `buildCache()` ([discovery.ts](../src/lib/discovery.ts)) rebuilt the WHOLE pool —
4,146 link rows / 39.2 MB of `raw_data` — from scratch on every rebuild, and `catalogSignature()`
counts `POOL_WHERE`, which unions in `user_item_state`: any wishlist/library/rating write changes
pool membership, so it forced a full re-parse.

**Not the fix that was proposed here.** The original plan was to split the signature and treat a
newly-acted-on item as an incremental *add* to the cached pool. That was rejected on review: its
failure mode is an item silently missing from the pool until the TTL expires — which is precisely
why it kept getting deferred. **What shipped instead caches the DERIVATION, not the membership.**
Pool membership is still recomputed from SQL on every single rebuild, so that failure mode does not
exist; only the per-item `JSON.parse` + `mergeLinks` + `extractFacets` is skipped, via the shared
`facetCache` (§4) that four other surfaces already use.

`buildCache()` is now a two-pass read: **pass 1** selects metadata + a freshness token
(`MAX(last_synced)`, `LENGTH(raw_data)`) with no blobs, **pass 2** selects `raw_data` for cache
misses only. A rebuild after a membership write re-derives exactly the one item that changed.

**Measured on the real 2,531-item pool** (`scripts/probe-pool.mjs`, same script both times):

| | before | after |
|---|--:|--:|
| pool rebuild after invalidate | 408 ms | **156 ms** (−62%) |
| membership write → `find()` | 578 ms | **296 ms** (−49%) |
| `find()` cold | 615 ms | **292 ms** (−53%) |
| cold pool build, fresh process | 473 ms | 596 ms |

**The must-have test passes** (it did before too, and still must): a wishlist write puts the item in
`find()` immediately — verified both directions, promote and demote, in `discoveryPool.test.ts` and
against the real DB in the probe.

**Two things found while building it, both worth knowing:**

1. **`scoringConfigSignature()` costs 0.061 ms a call**, and the cache key was recomputing it per
   item — ~307 ms of a cold 2,531-item rebuild, *more than the JSON.parse the cache exists to
   avoid*. It's constant across a rebuild, so it's now computed once and passed down
   (`derivedSignature()`). This was most of the win; the two-pass read alone was a wash.
2. **🐛 `last_synced` alone was never a sufficient freshness token** — a latent correctness bug in
   `facetCache` since it shipped 2026-07-31, on `/api/library`, `/api/calendar`,
   `analyzeLibraryFacets` and `loadMembershipGroups`. `matcher.ts` writes it as
   `strftime('%s','now')`, so **two writes to the same link inside one second are
   indistinguishable** and the cache serves the first one's facets. That is not hypothetical:
   enrichment writes straight after a sync upsert, and `/api/facet/mine` heals thin links before
   scoring. The key now also carries `SUM(LENGTH(raw_data))` — no parse needed, plain SQL
   `LENGTH()` — and `discoveryPoolCache.test.ts` pins it (confirmed non-vacuous: it fails without
   the length component). `facetCache.test.ts`'s case (a) had asserted the *stale* value was
   correct, on the stated premise that "production never mutates raw_data without bumping
   last_synced". It does; that test was corrected.

**The cold path is ~120 ms slower** (one extra metadata pass before the blob read). Accepted
deliberately: it happens once per process, against −280 ms on every membership write, and in the
real app the shared cache is usually already warm from `/api/library` or `/api/calendar` before
Discover is ever hit — the probe's "cold" is an artificial worst case where nothing else has run.

## B. DB inflation — the prod question, now tracked in PR17

| | |
|---|--:|
| local `rr.db` | 55.9 MB |
| local `rr.db-wal` | 48.4 MB → **closed as a dev artifact**, see below |
| `media_links` | 6,054 rows / 44.8 MB `raw_data` (**7.4 KB avg**) |
| `media_items` | 4,405 rows, **1,879 of them `browsed`** |
| prod `rr.db` | ~2.5 GB (memory: [[prod-incidents]]) |

**Both halves of §B are resolved as far as they can be here.** The local WAL is a dev-process
artifact, not a bug (full investigation below). **The prod 2.5 GB question is unanswerable while
prod is down** — every measurement it needs (`/api/dev/dbsize`, `/api/health`'s `cgroupMb`,
Litestream snapshot state) requires a live deployment. It is therefore **no longer tracked as a perf
item**: it is step 1 of PR17's post-outage checklist in `TASKS.md`, which has the expected values
inline. Nothing about it is actionable before Railway resumes.

The schema-adjacent ideas it was bundled with — a persisted facet-projection column, shrinking the
`raw_data` projection, `dbPrune` coverage of the browsed tail — were never scoped or committed to,
and are not open work. §A's fix removed the request-path cost that motivated them; if prod's size
turns out to need attention, PR17's readings are the input for scoping it then.

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

~~`data/` holds six stale `rr.db.bak*` snapshots totalling ~950 MB.~~ **Resolved 2026-08-02
(Nils's call: keep the newest pre-migration one, delete the rest).** `data/` is now **1,061 MB →
319 MB**. Kept: `rr.db.bak-pre-h2b-20260717-081223` (`user_version = 5`, 2,511 items, 1,898 library
rows, `integrity_check: ok`) plus its `-wal`/`-shm` sidecars — the rehearsal scripts copy those
deliberately, since without the `-wal` any un-checkpointed commits are simply missing from the
rehearsal. It's both the newest and the most useful: the live DB is at `user_version = 11`, so this
one exercises the widest upgrade span (5 → 11) against a real production-shaped database, which is
exactly the path [[db-migrations-and-testing]] warns green tests never take.

Deleted (all superseded, each strictly older AND at an equal-or-lower schema version): `rr.db`
(uv 0), `.bak-pre-d8` (uv 0), `.bak-pre-d1d5-20260614` (uv 3), `.bak-pre-d9-20260616` (uv 4),
`.bak-pre-v5-20260616` (uv 5 — same version as the keeper but a month older). `data/backups/`
was left alone: it holds a separate pre-drift-fix snapshot, not part of this set.
