// Shared per-item derived-data cache — the SAFE HALF of the discovery cache's
// deferred perf fix (docs/archive/performance-audit.md §A, 2026-07-30).
//
// THE PROBLEM: `/api/library` and `/api/calendar` each independently SELECT
// their media_links rows, JSON.parse every raw_data blob, and call
// mergeLinks() + extractFacets() themselves — the exact same derivation
// `analyzeLibraryFacets` (library stats/Insights) and `loadMembershipGroups`
// (the live-discover taste signal) ALSO do for the same items. Those two
// already have their own per-user RESULT caches (`getLibraryFacetAnalysis`,
// `getMembershipSignal`), but neither the routes' own item-building loop nor a
// same-library re-render is helped by that: a route hits the DB, parses every
// blob and re-derives facets/merged on every single request, cache hit or not.
//
// THE FIX: cache the DERIVED {facets, merged} per item, keyed on freshness a
// caller can check WITHOUT parsing anything (MAX(last_synced) is a plain SQL
// column). A caller builds `RawLink[]` straight off its SQL rows — raw_data
// stays an unparsed string — and only pays the JSON.parse + mergeLinks +
// extractFacets cost on an actual cache miss.
//
// WHY THE DERIVED SHAPE, NEVER THE PARSED raw_data: caching the parsed JS
// objects (rather than these small derived shapes) would trade a CPU problem
// for a memory one — 30 MB of raw_data parses into several times that on the
// heap, on a container with real OOM history (memory: image-optimizer-native-
// memory). facets+merged for the whole pool is on the order of a few MB.
//
// WHAT'S DELIBERATELY *NOT* CACHED HERE: tag-alias canonicalization and
// category-override resolution. Only `analyzeLibraryFacets` applies those
// today (`applyTagAliases` + `tagOverrides.get(f.key) ?? f.category`); the
// routes and `loadMembershipGroups` call `extractFacets` raw and always have.
// Baking alias/override resolution into this cache would silently change what
// the routes' `computeFandexScore` sees — a scoring-behavior change, not a
// caching one, and out of this fix's scope. So `facets` here are always RAW
// `extractFacets` output; every caller keeps applying its own existing
// post-processing (or none) on top, exactly as before this cache existed.
//
// WIRED INTO discovery.ts's `buildCache` since 2026-08-02 (§A closed) — via
// `peekDerived` below, which is what makes the two-pass read possible: pass 1
// reads metadata + last_synced only, and `raw_data` is SELECTed in pass 2 for
// cache MISSES alone. Note what that does NOT do: pool membership is still
// recomputed from SQL on every rebuild. The originally-proposed fix was to
// treat a membership write as an incremental add to the cached pool, whose
// failure mode is an item silently missing from the pool until the TTL expires;
// caching the DERIVATION instead gets the same saving with no such mode.

import { query, run, get } from "@/lib/db";
import { sharedCache } from "@/lib/boundedCache";
import { mergeLinks } from "@/lib/merge";
import { extractFacets, type Facet } from "@/lib/facets";
import { scoringConfigSignature } from "@/lib/scoringConfig";
import { DEFAULT_COUNTRY } from "@/lib/countries";
import type { EnrichedItem, MediaLink, MediaType } from "@/types";

/** The region-aware projection every caller already builds via mergeLinks(). */
export type MergedItem = Omit<EnrichedItem, "id" | "type" | "platformSources">;

/**
 * The projection as THIS CACHE stores it: `sources` carries identity only.
 *
 * ⚠️ `EnrichedItem.sources[].data` is the whole parsed provider blob, and the
 * header above says in as many words that this cache must never hold those.
 * `mergeLinks` puts them straight back (`merge.ts`: `data: l.rawData`), so from
 * the day it was written this cache stored every parsed blob it derived from.
 * Measured 2026-08-28 on the real catalog: **19,311 of 25,518 serialised bytes
 * per entry — 76%** — and `facetCache.derived` was 86 MB of the 110 MB a warm
 * Discover request retains, the single largest thing in the process.
 *
 * No caller wanted them. `/api/library` and `/api/calendar` each destructure
 * `sources` off and rebuild it with `data: {}` (the 2026-07-30 audit, which
 * caught the same blobs going over the WIRE and never looked at the cache);
 * `buildEntries`, `analyzeLibraryFacets` and `loadMembershipGroups` read
 * scalars only — the last one even documents "raw per-source blobs aren't
 * exposed by the cache", which was the intent and not the behaviour. The one
 * surface that does need them, `/api/detail`, calls `mergeLinks` directly and
 * never touches this cache.
 *
 * So the type says what the cache holds, rather than promising a field whose
 * contents a caller must remember to throw away.
 */
export type DerivedMerged = Omit<MergedItem, "sources"> & {
  sources: { source: MediaLink["source"]; sourceId: string }[];
};

export interface Derived {
  facets: Facet[];
  merged: DerivedMerged;
}

/**
 * One media_links row, UNPARSED. Callers build this straight off their SQL
 * rows — `rawData` stays a JSON string — so the parse can be skipped entirely
 * on a cache hit. Mirrors the shape every call site already selects.
 */
export interface RawLink {
  source: MediaLink["source"];
  sourceId: string;
  releaseDate: string | null;
  rawData: string | null;
  lastSynced: number;
}

// Capped like its sibling per-item caches (liveDiscover.ts's `_facetCache`,
// discovery.ts's `_personIdCache`) — a few thousand entries covers the pool
// (~2,500 items) across a couple of regions with headroom, without growing
// unbounded across many users/regions over the long-lived process (P2).
const _cache = sharedCache<string, Derived>("facetCache.derived", { max: 6000 });

// scoringConfigSignature() already folds tagAliasSignature() + the category/
// override signatures in (scoringConfig.ts) — including it here costs nothing
// (a config change just turns entries over a little earlier than strictly
// necessary, since RAW facets don't actually depend on it) and keeps this
// cache honest if a future caller ever does bake alias/override resolution in.
//
// `last_synced` alone is NOT a sufficient freshness token: matcher.ts writes it
// as strftime('%s','now'), so two writes to the same link inside one second are
// indistinguishable — and sub-second follow-up writes are a real pattern here
// (enrichment writes straight after a sync upsert; /api/facet/mine heals thin
// links before scoring). A key made of last_synced alone hands back the FIRST
// write's derivation until the caller's own TTL expires. Proven reproducible in
// discoveryPoolCache.test.ts, which fails without the length component.
//
// So the token is (MAX(last_synced), SUM(OCTET_LENGTH(raw_data))). Length is
// not a hash, but it needs no JSON.parse, and two payloads that differ in
// content essentially always differ in byte length when one is an enrichment of
// the other. A true content hash would mean reading every blob in pass 1, which
// is the exact cost this cache exists to avoid.
//
// ⚠️ **BYTES, on BOTH sides, and this is not a style choice.** It was SQL
// `LENGTH()` against JS `.length` until 2026-08-28, and those are different
// quantities: SQLite counts CODE POINTS in a TEXT value, JavaScript counts
// UTF-16 CODE UNITS. Any payload carrying an astral character (an emoji, a
// mathematical-alphanumeric letter) makes them disagree, so the peek looked
// under a key `getDerivedForItem` would never write — measured on the real DB:
// **56 of 7,006 links, 55 items, which had NEVER hit this cache** and were
// re-parsed and re-merged on every pool rebuild and every library analysis
// since it was written. Nothing surfaced it: a permanent miss is invisible
// except as time.
//
// The second reason is cost, and it is the larger one. `LENGTH()` on a TEXT
// value has to decode the whole string to count characters; `OCTET_LENGTH()`
// reads the stored byte count out of the record header. Measured over the pool
// (6,747 rows): **67–84 ms against 8–12 ms**, and that scan runs on every
// rebuild, so it grows with the catalog. `Buffer.byteLength(s, "utf8")` is the
// exact JS counterpart (5,000 of 5,000 agree with OCTET_LENGTH on real rows).
//
// ⚠️ Changing the token changed every key ONCE, so the first pass after the
// deploy re-derives the catalog. That is a one-off, and it is the same trade
// librarySignature's base-table move made.
function keyFor(mediaItemId: string, maxLastSynced: number, rawLen: number, region: string, sig: string): string {
  return `${mediaItemId}:${maxLastSynced}:${rawLen}:${region}:${sig}`;
}

/**
 * The config component of the cache key, for callers doing a BATCH of lookups.
 *
 * It's identical for every item in one pass, but it isn't free: measured at
 * 0.061 ms a call, and discovery.ts's pool rebuild does one peek + (on a miss)
 * one set per item, so recomputing it per item cost ~307 ms of a cold 2,531-item
 * rebuild — more than the JSON.parse it was there to help avoid. Batch callers
 * compute it once and pass it to `peekDerived`/`getDerivedForItem`; single-item
 * callers can keep omitting it.
 */
export function derivedSignature(): string {
  return scoringConfigSignature();
}

/**
 * Cache lookup WITHOUT the raw links — the whole point being that the caller
 * hasn't read `raw_data` yet and wants to know whether it has to.
 *
 * Both freshness inputs come from plain SQL aggregates over the item's links —
 * `MAX(ml.last_synced)` and `SUM(OCTET_LENGTH(ml.raw_data))` — so a caller builds the
 * key from a metadata-only SELECT. On a hit it never touches `raw_data`; on a
 * miss it SELECTs raw_data for just that item and calls `getDerivedForItem`.
 *
 * Returns a fresh copy of `facets` on a hit, same as `getDerivedForItem`.
 */
export function peekDerived(
  mediaItemId: string,
  maxLastSynced: number,
  rawLen: number,
  region: string = DEFAULT_COUNTRY,
  sig: string = scoringConfigSignature()
): Derived | undefined {
  const hit = _cache.get(keyFor(mediaItemId, maxLastSynced, rawLen, region, sig));
  if (hit) return { facets: [...hit.facets], merged: hit.merged };
  return peekDerivedBatch([{ id: mediaItemId, maxLastSynced, rawLen }], region, sig).get(mediaItemId);
}

// ── The disk half (2026-08-28) ───────────────────────────────────────────────
//
// `media_item_projection` is this cache's L2 — same value, no 6,000-entry cap,
// on a medium that costs ~75× less than RAM. See its comment in db.ts for why it
// exists and why its key deliberately omits the scoring signature.
//
// ⚠️ BATCHED, not per item. A pool rebuild peeks for every pool item; at 50k
// that is 50k prepared statements (~0.5 s) where one chunked read is a single
// scan. `peekDerived` above routes through the same path with a batch of one,
// so there is one definition of "is it on disk" rather than two.
const PROJECTION_CHUNK = 400;

/**
 * Only the DEFAULT region is persisted, and the reasoning is the whole point of
 * the table rather than a limitation of it.
 *
 * This exists for ONE caller: `buildEntries`, which iterates the entire catalog
 * on every pool rebuild and always uses the default region. Every other caller
 * is bounded by a single user's library or one calendar month, which the 6,000
 * entries of memory already cover, and each has its own result cache on top.
 *
 * ⚠️ Measured 2026-08-28, which is why this guard exists at all: without it the
 * real database stored **two** regions after one session (`DEFAULT_COUNTRY` from
 * the pool, the user's own country from /api/library and /api/calendar) —
 * 4,589 rows for a 2,553-item catalog. Regions multiply, and at the 30–50k
 * phase 4 targets each one is another ~315 MB against a 2 GB tripwire.
 *
 * The `region` column stays in the schema so widening this is a policy change
 * and not a migration.
 */
const PROJECTION_REGION = DEFAULT_COUNTRY;
const persistable = (region: string) => region === PROJECTION_REGION;

interface ProjectionRow {
  media_item_id: string; last_synced: number; raw_len: number; facets: string; merged: string;
}

/** Freshness a caller already has from its metadata-only SELECT. */
export interface PeekRef { id: string; maxLastSynced: number; rawLen: number }

/**
 * Memory first, then disk, for a whole batch. Anything found on disk is promoted
 * into the memory cache, so a second pass in the same process pays neither.
 *
 * ⚠️ A row whose `(last_synced, raw_len)` no longer match is IGNORED, not
 * deleted here: the caller is about to re-derive and overwrite it, and deleting
 * on a read path would turn every stale hit into a write.
 */
export function peekDerivedBatch(
  refs: PeekRef[],
  region: string = DEFAULT_COUNTRY,
  sig: string = scoringConfigSignature()
): Map<string, Derived> {
  const out = new Map<string, Derived>();
  const misses: PeekRef[] = [];
  for (const r of refs) {
    const hit = _cache.get(keyFor(r.id, r.maxLastSynced, r.rawLen, region, sig));
    if (hit) out.set(r.id, { facets: [...hit.facets], merged: hit.merged });
    else misses.push(r);
  }
  // A non-default region is never written, so it is never worth a query.
  if (!misses.length || !persistable(region)) return out;

  const wanted = new Map(misses.map((m) => [m.id, m]));
  for (let i = 0; i < misses.length; i += PROJECTION_CHUNK) {
    const chunk = misses.slice(i, i + PROJECTION_CHUNK);
    const rows = query<ProjectionRow>(
      `SELECT media_item_id, last_synced, raw_len, facets, merged
         FROM media_item_projection
        WHERE region = ? AND media_item_id IN (${chunk.map(() => "?").join(",")})`,
      [region, ...chunk.map((c) => c.id)]
    );
    for (const row of rows) {
      const want = wanted.get(row.media_item_id);
      if (!want || row.last_synced !== want.maxLastSynced || row.raw_len !== want.rawLen) continue;
      let derived: Derived;
      try {
        derived = { facets: JSON.parse(row.facets), merged: JSON.parse(row.merged) };
      } catch {
        // A corrupt row is a cache miss, never a thrown request. The caller
        // re-derives and overwrites it.
        continue;
      }
      _cache.set(keyFor(row.media_item_id, row.last_synced, row.raw_len, region, sig), derived);
      out.set(row.media_item_id, { facets: [...derived.facets], merged: derived.merged });
    }
  }
  return out;
}

/**
 * Write-through. Called on the derive path only, so it runs exactly as often as
 * a real derivation does.
 *
 * ⚠️ Never throws. This is a cache write on a request path; a failure here must
 * cost the next reader one re-derive, not the current reader their page.
 */
function writeProjection(
  mediaItemId: string, region: string, lastSynced: number, rawLen: number, derived: Derived
): void {
  if (!persistable(region)) return;
  try {
    run(
      `INSERT INTO media_item_projection
         (media_item_id, region, last_synced, raw_len, facets, merged, written_at)
       VALUES (?, ?, ?, ?, ?, ?, strftime('%s','now'))
       ON CONFLICT(media_item_id, region) DO UPDATE SET
         last_synced = excluded.last_synced, raw_len = excluded.raw_len,
         facets = excluded.facets, merged = excluded.merged,
         written_at = excluded.written_at`,
      [mediaItemId, region, lastSynced, rawLen, JSON.stringify(derived.facets), JSON.stringify(derived.merged)]
    );
  } catch { /* a cache write must never fail a request */ }
}

/**
 * Facets + the region-aware merged projection for one item, backed by the
 * shared cache.
 *
 * Returns a FRESH COPY of the `facets` array on every call — never the stored
 * array reference — so a caller that sorts/filters/mutates it in place can't
 * corrupt the next caller's read. (The `Facet` objects themselves are shared;
 * nothing in the codebase mutates a `Facet`'s fields in place.)
 */
export function getDerivedForItem(
  mediaItemId: string,
  rawLinks: RawLink[],
  type: MediaType,
  region: string = DEFAULT_COUNTRY,
  sig: string = scoringConfigSignature()
): Derived {
  const maxLastSynced = rawLinks.reduce((m, l) => Math.max(m, l.lastSynced), 0);
  // UTF-8 BYTES, and it must stay byte-for-byte the same quantity the SQL
  // `SUM(OCTET_LENGTH(raw_data))` a peeking caller computes. See keyFor()'s
  // header for why it is bytes and not `.length`.
  //
  // Costs ~1.2 µs per link (6 ms per 5,000, measured), against the ~35 µs
  // JSON.parse on the very next line — this only ever runs on a miss.
  const rawLen = rawLinks.reduce((n, l) => n + (l.rawData ? Buffer.byteLength(l.rawData, "utf8") : 0), 0);
  const key = keyFor(mediaItemId, maxLastSynced, rawLen, region, sig);

  const hit = _cache.get(key);
  if (hit) return { facets: [...hit.facets], merged: hit.merged };

  // L2 before the blobs: a stored projection is ~6.3 KB against ~17.5 KB of
  // raw_data for the same item, and it skips mergeLinks + extractFacets outright.
  const stored = peekDerivedBatch([{ id: mediaItemId, maxLastSynced, rawLen }], region, sig).get(mediaItemId);
  if (stored) return stored;

  const links: MediaLink[] = rawLinks.map((l) => ({
    id: "", mediaItemId, source: l.source, sourceId: l.sourceId,
    title: null, releaseDate: l.releaseDate,
    rawData: l.rawData ? JSON.parse(l.rawData) : {}, lastSynced: l.lastSynced,
  }));

  const full = mergeLinks(links, type, region);
  // `extractFacets` gets the FULL projection — it is derived from the same
  // links either way, and narrowing what it sees would be a behaviour change.
  const facets = extractFacets(links, type, full);
  // Drop the parsed blobs before anything stores this. See DerivedMerged.
  const merged: DerivedMerged = {
    ...full,
    sources: full.sources.map((s) => ({ source: s.source, sourceId: s.sourceId })),
  };

  _cache.set(key, { facets, merged });
  writeProjection(mediaItemId, region, maxLastSynced, rawLen, { facets, merged });
  return { facets: [...facets], merged };
}

// ── Holding the projection table to a size (2026-08-28) ──────────────────────
//
// The invariant this satisfies: any table written on a REQUEST path needs a row
// or byte ceiling, not just a TTL, run on an unref'd interval in bounded
// batches, evicting by WRITE time. An age cap is not a size cap, and a crawler
// keeps every row inside a TTL window while the table grows all day.
//
// ⚠️ There is no TTL here at all, on purpose. A projection is not stale until
// its item's links change, and `(last_synced, raw_len)` already detects that on
// read. Age would evict rows that are perfectly good.
//
// ⚠️ The ceiling is ROWS, and it is generous by design: this table is the reason
// a pool rebuild does not re-derive, so evicting a row the pool wants next
// minute is the failure mode to avoid. At the measured ~6.3 KB a row, 120k rows
// is ~750 MB against a 2 GB tripwire, which covers the 30-50k catalog phase 4
// targets across a couple of regions.
//
// ⚠️ Deleting rows does not shrink the file; db.ts VACUUMs after any migration
// applies, so this rarely needs acting on. And it deletes in bounded batches
// because PR16 pruned 546,754 rows for 12.8 GB of WAL churn to S3 and blew the
// Railway spend cap — the danger is exclusively the catch-up burst.
const PROJECTION_MAX_ROWS = 120_000;
const PROJECTION_SWEEP_BATCH = 2_000;

export function sweepProjections(
  maxRows = PROJECTION_MAX_ROWS,
  batch = PROJECTION_SWEEP_BATCH
): { rows: number; deleted: number } {
  // Rows for a region this no longer persists are dead weight: nothing reads
  // them, so no size ceiling would ever reach them. Cleared first, in the same
  // bounded batch, so a policy change self-heals instead of leaking forever.
  const stale = run(
    `DELETE FROM media_item_projection WHERE rowid IN (
       SELECT rowid FROM media_item_projection WHERE region <> ? LIMIT ?
     )`,
    [PROJECTION_REGION, batch]
  ).changes;
  const rows = get<{ n: number }>(`SELECT COUNT(*) n FROM media_item_projection`)?.n ?? 0;
  if (rows <= maxRows) return { rows, deleted: stale };
  const over = Math.min(rows - maxRows, batch);
  run(
    `DELETE FROM media_item_projection WHERE rowid IN (
       SELECT rowid FROM media_item_projection ORDER BY written_at ASC LIMIT ?
     )`,
    [over]
  );
  return { rows, deleted: stale + over };
}
