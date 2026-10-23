# Optimization plan (2026-08-23)

Whole-project sweep: code read, prod driven in a browser, every number below
measured on fandex.org rather than reasoned about. Ranked by leverage.

> ## ✅ ALL SIX ITEMS ARE DONE (2026-08-23, same day)
>
> `8518b77` · `25a3d96` · `9255b1f` · `742fdbe`. §2 below is kept as the record
> of what each one was and why it was worth doing, not as open work. What is
> still open is the short list in §5 at the bottom.
>
> The headline results: **`/api/discover` 930 ms → 95 ms** and 20 TMDB calls per
> 10 browse requests → **0**; item pages went from **zero** server-rendered links
> to any other item page to **3–14** on most; and the franchise rail now shows
> what a franchise actually contains rather than the slice we happened to hold.

**Companion docs.** `docs/scalability.md` holds the per-surface provider-cost
model and is still correct; this file extends its §4 list with three levers it
did not have. `docs/seo.md` holds the crawl picture. Neither is superseded.

---

## 0. The baseline, measured

Prod, 2026-08-23, container at 13.7 h uptime unless noted.

| Surface | Before | After today's fixes |
|---|--:|--:|
| `/api/discover` **warm** | **930 ms** | **95 ms** |
| `/api/discover` cold | 955 ms | 1,636 ms (once per 15 min) |
| `/api/home` warm | 37 ms | 40 ms |
| `/api/calendar/popular` | 25 ms | 25 ms |
| `/calendar/2026-09` cold | 1,058 ms | 92 ms |
| `/studio/a24` cold | 999 ms | 95 ms |
| `/` (homepage) | 137 ms | 160 ms |
| `/tag/horror` warm | 169 ms | 174 ms |
| TMDB calls per 10 `/api/discover` | **20** | **0** |

Client-side, homepage: TTFB 36 ms, DOM interactive 183 ms, load 341 ms, 909 DOM
nodes, 19 resources, 288 KB. The shell is fast. What was slow was the data
behind it.

Container: rss 396 MB, heapTotal 260 MB, heapUsed 238 MB, cgroup 503 MB against
a **7,629 MB limit**. Memory is nowhere near a ceiling. DB 81.3 MB, WAL 340.8 MB.

Provider volume over 13.7 h, projected per month: TMDB **158,257**, IGDB 9,341,
Trakt 2,242, Steam 1,441, with RAWG, OMDb and Letterboxd latched off at 401. For
contrast, `docs/scalability.md` §1a measured TMDB at 2,793,323/month before the
401 latch shipped, so the latch alone already cut provider traffic about 17x.

---

## 1. Shipped today (`8518b77`)

**1.1 The browse page cache.** `discoverFeed.ts` was the only provider boundary
in the app with no cache, while `popularMonthFeed`, `homeHub` and the facet
pages all had one. `/api/discover` measured 930 ms warm and 955 ms cold, which is
the signature of running the full provider fan-out on every single request.

Cached at the page primitive rather than per route, because the same "TMDB
movies, future, page 1, US" page is wanted by three different callers: the
anonymous browse, every signed-in user's personalized feed rebuild, and the
calendar's popular chip. One entry now serves all three. Pinned to `globalThis`,
for the reason `http.ts`'s breakers are. A failed fetch is never cached, so a
provider outage is not pinned in place for the TTL.

Verified in prod: ten `/api/discover` requests, **zero** TMDB calls. The cold
`/calendar/{month}` and `/studio/{slug}` pages got faster as a side effect,
because they share the same primitives.

**1.2 Whole-project build tracing.** `fs.statSync(dbPath)` in `dbPrune.ts` made
Turbopack give up on static analysis and trace the entire project into
`.next/standalone`. Its own warning: "all source files (including the public
folder) deployed as part of the server code". `dbPrune.ts` is reached from
`instrumentation.ts`, which every route loads. Fixed with `turbopackIgnore`. It
costs a fatter image and a slower Railway deploy, never a failure, which is why
it sat there.

**1.3 Deleted `/api/search`.** Zero callers. 180 lines of a second, diverged
search implementation, still deployed and reachable. It pulled games from RAWG
only, a live violation of the two-source games invariant, so with RAWG's quota
gone it would have returned no games at all.

---

## 2. The six items, ranked by leverage. ALL SHIPPED 2026-08-23

### 2.1 Item pages link to zero other item pages (highest value)

`/movie/dune-part-two` server-renders **39 internal links: 14 tags, 9 people, and
navigation. Not one sibling title.** The franchise and "More like this" rails do
exist and do render for anonymous humans, but `RelatedRails.tsx` fetches them in
a `useEffect`, so they are absent from the HTML a crawler reads.

Two consequences. Google reaches all 2,037 item pages only through the sitemap
and never through in-content links, so the catalog is 2,037 crawl dead-ends and
link equity never flows between titles. And a visitor arriving from a search
result gets no server-rendered path deeper into the catalog.

The data is already local. `similarItems.ts` and `franchise.ts` are pure
functions over the catalog pool, and `/api/detail/similar` is already a public
route. Move the two rails into the server component. **Zero new provider calls**,
since the franchise path makes none by design.

This is the single highest-value item here, and it is not a performance change.

### 2.2 Franchises are two-thirds empty, and completing them costs ~421 calls once

The thing you asked about. Measured on the catalog:

- **249** distinct TMDB collections, of which **167 (67%) hold exactly one
  catalog title**, so most films with a franchise show no rail at all.
- **172** distinct IGDB franchises.
- Star Wars: we hold 9 of TMDB's 12. Terminator: 5 of 6.

The cause is precise. `facets.ts:243` reads `belongs_to_collection.name` as a
**label**, and nothing anywhere calls TMDB `/collection/{id}`. IGDB is the same:
the query asks for `franchises.name` and never for the franchise's game list. So
a franchise rail can only ever list titles that already happen to be in the
catalog, and `franchise.ts`'s own header is honest that coverage is thin.

**Do not fetch on the request path.** `docs/scalability.md` §4.2 is right that
lowering provider calls on crawlable pages is worth more than everything else,
and a per-render collection fetch pushes that number the wrong way.

Proposed instead: a `franchise_members` table filled by a **background sweep**,
in the shape of the existing crosslink sweeps. Walk the distinct `ip` facet keys
once, call TMDB `/collection/{id}` and the IGDB franchise endpoint, and store
`(ip_key, source, source_id, title, release_date, poster_url, in_catalog)`.
Refresh monthly. The page reads the table and makes **zero provider calls**.

Cost: **about 421 calls, once**, against 158,257 TMDB calls in a month. That is
0.16% of one month's budget to make every franchise complete. Neither provider
is RAWG, so the exhausted quota is not a constraint here.

Two design notes. A member we do not hold should render as a non-linkable card.
There is precedent: `persistDiscoverBatch` already marks `linkable: false`. That
way the rail stops understating a franchise without minting catalog rows on a
crawlable page, which would break the PR15 anon write gate. Second, shows still
cannot join a film collection, because neither provider models that, so
`item_ip_override` stays the manual escape hatch.

### 2.3 IGDB is failing a third of its calls, and it is currently the only games source

`api.igdb.com`: **64 network errors out of 175 requests**, plus 230 further calls
blocked by the breaker those failures opened. `docs/scalability.md` §1a recorded
the same shape earlier and worse, at 190 of 232.

IGDB's documented limit is **4 requests per second**. `liveDiscover` fans out
`PAGES_PER_SOURCE` pages under one `Promise.all`, and several surfaces can do
that concurrently, so we routinely exceed it. With RAWG's quota exhausted, IGDB
is the sole games metadata source, which makes this a **catalog completeness**
problem and not only a latency one.

Fix: a small per-host concurrency gate in `http.ts`, a semaphore of 4 for IGDB,
rather than more retries. **Measure first.** Today's page cache already cut IGDB
volume substantially, so re-read the counters after a day of traffic before
adding machinery. Do not skip that step; this repo has mis-sized a resource
problem twice by acting on a spot sample.

### 2.4 Twelve percent of the catalog is on a stale projection

`PROJECTION_VERSION` is 3. Of 5,250 `media_links` rows: 4,632 at v3, 532 at v1,
78 at v0, 8 at v2. So **618 rows (12%)** are projected with two-versions-old
⚠️ **That 12% was the LOCAL database. Prod reads 2.4%** (measured 2026-08-23, see
§5.2). The finding below still stands as a description of the mechanism; the
number does not. Nothing about it warrants a sweep.
logic. Those feed facets, which feed the Fandex Score, which feeds discovery
ranking.

The lazy self-heal only fires when someone opens an item's detail page, so the
long tail of never-opened titles stays stale indefinitely. Nothing measures this.
It is not in `/api/health`, and every test is green.

The cheapest useful move is **visibility before action**: add the version
histogram to `/api/health` or `/api/dev/dbsize`, then decide between a slow
background re-projection sweep and leaving it alone. See
`[[lazy-heal-vs-mass-reprojection]]` for why a version bump does not
automatically deserve a heavy migration.

### 2.5 Reclaim 340 MB of volume

`dbFilesMb` reports the DB at **81.3 MB** and the WAL at **340.8 MB**. The WAL is
four times the database.

This is **not** a repeat of the 2026-08-17 Litestream incident. Migration 19 is
plain SQL with no 3.44+ syntax, and `shadowWalMb` grew from 0.1 to 2.5 across
today's deploy, which means Litestream is actively replicating. The 340 MB is the
high-water mark left by the `VACUUM` that `db.ts` runs after a migration applies.
A VACUUM rewrites the whole database through the WAL, and the file keeps its peak
size while its contents are recycled.

It still occupies 340 MB of Railway volume for nothing. A
`wal_checkpoint(TRUNCATE)` reclaims it. Worth adding as an explicit step right
after the post-migration VACUUM, which is exactly where the WAL is at its worst.

Note the distinction the old incident earned: a WAL that will not truncate is a
symptom worth chasing. This one is a high-water mark, and the shadow WAL is the
evidence that separates the two cases.

### 2.6 Pin the remaining module-level caches, after measuring

`docs/scalability.md` §3.4 flags roughly 20 module-level `BoundedCache`s that may
be duplicated per Next bundle. Still true today: `/api/home`'s `_publicCache` is
a bare module-scope `new BoundedCache`. If they are duplicated, retained memory
is a multiple of the budgeted figure and hit rates are below assumption.

The advice is unchanged: **measure whether they are actually duplicated before
pinning them.** The one cache added today is already pinned, so it is not part
of this.

---

## 3. Standing items this sweep did not change

- **RAWG's metadata role.** Quota exhausted, latched off, and its $149/mo tier is
  only 2.5x the free quota. `docs/scalability.md` §4.3 already says to decide
  this. Today's cache reduces RAWG browse volume, which buys time rather than
  making the decision.
- **OMDb must be removed before ads, not paid for.** CC BY-NC 4.0. It contributes
  nothing to the Score.
- **The franchise rail top-up needed your yes** (`TASKS.md` item 4). §2.2 above
  is that proposal, costed.
- **The restore drill is still due**, and has been since migration 19.
  Replicating is verified. Restorable is not. Those are different claims.

## 4. What not to do

- **Do not add a provider call to a crawlable page** without pricing it in
  cold-facet-page units first. This is the constraint every item above respects.
- **Do not treat the 340 MB WAL as a Litestream fault.** It was that once. It is
  not that now, and the evidence is in §2.5.
- **Do not cache an empty provider response** anywhere. Today's cache stores only
  non-empty pages, deliberately.
- **The image pipeline needs nothing.** The custom CDN loader, the 31-day cache
  TTL, webp-only and the trimmed device sizes are all correct, and keeping sharp
  out of the process is what ended the 7.5 GB RSS ramp. The one open question
  there is an LCP hint: all 30 homepage posters are `loading="lazy"`, including
  the first one. Small, and worth doing when someone is already in
  `PosterCard.tsx`.

---

## 5. What is still open after all six

Short, and none of it is a leftover from §2.

1. ✅ **Cache and pool weights are measured** (2026-08-23, `docs/scalability.md` §6).
   `GET /api/dev/dbsize?caches=1` samples them. The result inverted the
   assumption: the discovery pool, the one thing that cannot be capped, is
   **5.2 MB**, while `facetCache.derived` is **33 MB** and the three big caches
   are authorised to reach **~188 MB**. Not urgent (2.5% of the ceiling), but
   catalog growth now has a known slope of **2.6 MB per 1,000 items**.

   ⏸️ **The IGDB gate is still unmeasured.** `queuedTotal: 0, maxInFlight: 1`
   after 13 minutes and one request is evidence of no traffic, not of a
   pointless gate. Re-read it after a real crawler sweep.

2. ✅ **Projection staleness: no sweep needed.** Prod reads **2.4%** (94 rows at
   v0, 13 at v1, 4,406 at v3), not the 12% quoted in §2.4. That figure came from
   the LOCAL database, which is a different and staler catalog. Now visible in
   `/api/dev/dbsize` either way.

3. **The 340 MB WAL is NOT reclaimable in prod, and that is the right answer.**
   Attempted and measured, rather than assumed. `POST /api/dev/prune
   {"action":"wal-truncate"}` returned `busy: 1` with the file unchanged at
   340.8 MB, because `docker-entrypoint.sh` runs `litestream replicate -exec
   "node server.js"` so Litestream attaches BEFORE node and holds a read lock
   that TRUNCATE cannot take. The `db.ts` checkpoint added in 2.5 is therefore
   a no-op in prod; it is kept because it works locally, in tests, and on the
   no-backup path.

   Making it work would mean checkpointing in the entrypoint before Litestream
   starts. Weighed and rejected: 340 MB on a 4,614 MB volume with 4,174 MB free,
   priced at ~$0.155/GB-month, is about **five cents a month**. It is not a
   memory cost either, since the file is one frame of data plus untouched empty
   space that the kernel never caches (`fileMb` stayed at 81–113 MB).

   ⚠️ And it is emphatically NOT the 2026-08-17 stall, which looked identical
   from outside. The wal-probe showed `logFrames: 1, pendingMb: 0` and
   `shadowWalMb` moved 0.1 → 5 MB across the deploy: Litestream is replicating,
   the WAL is simply large and empty.

4. **The restore drill is still due**, and has been since migration 19.
   Replicating is verified. Restorable is not. Different claims.

5. **Re-run the franchise sweep monthly.** `POST /api/dev/franchise-sweep`
   treats anything swept more than 30 days ago as due, so re-running it is
   idempotent and cheap: it only re-asks what has aged out.

6. **RAWG's metadata role** and **removing OMDb before ads** are unchanged from
   §3. Neither was in scope here.
