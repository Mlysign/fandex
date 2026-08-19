// Persisted (L2) store behind the public facet payload cache.
//
// Why this exists (2026-08-13). The in-process `BoundedCache` in
// `publicFacetDetail.ts` dies with the process and is bounded by heap, while the
// slug surface — every person credited across ~2,000 titles — is far larger than
// any affordable in-memory cache. Under a crawl sweep that means a near-100%
// miss rate, and every miss re-runs the provider fan-out.
//
// What the measurement actually justified (scripts/probe-facet-cost.ts, T1):
// fan-out is 96-99% of a cold render, but the magnitude varies enormously by
// kind — person 64ms, company 159ms, tag 60s while RAWG was returning 522s.
// So this is NOT primarily a latency fix. Its value is:
//   1. THIRD-PARTY QUOTA. RAWG's free tier is 20k req/mo and one tag build can
//      spend 12 calls. A crawl sweep is what burns that, and a cache that
//      survives restarts is what stops it.
//   2. Insulation from provider latency, which is real but episodic.
// Do not re-justify this with "facet pages take 60 seconds" — that reading was
// a dead provider, and blaming steady-state cost for it is the exact error
// AGENTS.md records twice.
//
// ⚠️ WHAT THIS TABLE DID TO PROD (2026-08-19), and why the bounds below exist.
// Shipped with an age cap (24 h) and NO size cap, swept only once per boot at
// 2000 rows. Prod runs for days at a time and the writer is crawler traffic over
// the person/tag/studio long tail, so nothing ever expired in-process and the
// table grew unbounded: **24,953 rows / 222.8 MB, 80.2% of a 331 MB database**
// that had measured 37.7 MB the day before this cache shipped. That file size is
// what the kernel page-caches, and cgroup v2 bills page cache to the container,
// so it re-created the 2026-07-22 memory ramp on Railway's graph. An age cap is
// not a size cap when the write rate is set by somebody else's crawler.
//
// Three bounds now, and the third is the load-bearing one:
//   - age    (sweepFacetCache)        — rows nobody can read any more.
//   - ROWS   (trimFacetCacheToRows)   — the hard ceiling. Age says nothing about
//                                       how many rows fit inside one TTL window.
//   - bytes  (gzip, below)            — MEASURED 2.97-3.86x (mean ~3.5x) over
//                                       four real prod payloads pulled from
//                                       /api/facet, not an assumed ratio. The
//                                       cap therefore buys ~3.5x the slug
//                                       coverage per MB.
// And both run on a TIMER, not only at boot — see src/instrumentation.ts.
//
// Every function here is best-effort by design: a cache is an optimisation, and
// no failure in it may ever fail a page render.
import zlib from "zlib";
import { query, run } from "@/lib/db";
import { log, errorFields } from "@/lib/logger";

/**
 * Rows to keep. 24,953 rows measured 222.8 MB uncompressed (~9.1 KB each), and
 * gzip measured ~3.5x on real payloads, so this ceiling is ~31 MB of table — a
 * bound stated in the unit the incident was measured in, not a round number.
 *
 * Sized against COVERAGE, not just disk: prod accumulated ~4,150 rows/day under
 * crawl, so 12,000 holds roughly the last three days of the slug surface. Note
 * one facet occupies several rows (the key carries page + sort + persist +
 * scoringConfigSignature), so this is well under 12,000 distinct facets.
 */
export const FACET_CACHE_MAX_ROWS = 12_000;

// SQLite is dynamically typed, so a Buffer round-trips through this TEXT column
// as a BLOB without a schema change or a migration. Rows written before
// 2026-08-19 are plain strings and still read correctly — see decode().
function encode(payload: string): Buffer {
  return zlib.gzipSync(Buffer.from(payload, "utf8"));
}

function decode(raw: unknown): string | null {
  if (typeof raw === "string") return raw; // legacy uncompressed row
  if (Buffer.isBuffer(raw)) {
    try {
      return zlib.gunzipSync(raw).toString("utf8");
    } catch {
      return null; // corrupt row reads as a miss, and the sweep collects it
    }
  }
  return null;
}

/** Read a cached payload, or null if absent, expired, or unreadable. Never throws. */
export function readFacetCache(key: string, maxAgeMs: number): string | null {
  try {
    const cutoff = Date.now() - maxAgeMs;
    const rows = query<{ payload: unknown; created_at: number }>(
      `SELECT payload, created_at FROM facet_page_cache WHERE key = ?`,
      [key]
    );
    const row = rows[0];
    if (!row) return null;
    // Compared in JS rather than SQL so a clock change can't make a stale row
    // permanently unreachable-but-present; the sweep below still collects it.
    if (row.created_at < cutoff) return null;
    return decode(row.payload);
  } catch (e) {
    log.warn("facet_cache_read_failed", { key, ...errorFields(e) });
    return null;
  }
}

/** Upsert a payload. Best-effort: a failure here must never fail the render. */
export function writeFacetCache(key: string, payload: string): void {
  try {
    run(
      `INSERT INTO facet_page_cache (key, payload, created_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at`,
      [key, encode(payload), Date.now()]
    );
  } catch (e) {
    log.warn("facet_cache_write_failed", { key, ...errorFields(e) });
  }
}

/**
 * Delete expired rows in a BOUNDED batch and return how many went.
 *
 * Bounded on purpose: this table is written on a request path, and an unbounded
 * DELETE would take the write lock for as long as it takes — with Litestream
 * running as a second connection, long write transactions are what produced the
 * 2026-07-20 `database is locked` wall. Small batches let it interleave.
 */
export function sweepFacetCache(maxAgeMs: number, limit = 500): number {
  try {
    const cutoff = Date.now() - maxAgeMs;
    const res = run(
      `DELETE FROM facet_page_cache WHERE key IN (
         SELECT key FROM facet_page_cache WHERE created_at < ? ORDER BY created_at LIMIT ?
       )`,
      [cutoff, limit]
    );
    return (res as { changes?: number } | undefined)?.changes ?? 0;
  } catch (e) {
    log.warn("facet_cache_sweep_failed", { ...errorFields(e) });
    return 0;
  }
}

/**
 * Drop the oldest rows until at most `maxRows` remain, in a BOUNDED batch.
 * Returns how many went.
 *
 * This is the cap the age sweep cannot provide: inside one 24 h TTL window a
 * crawler can write an unbounded number of rows, all of them "fresh". Eviction
 * is by `created_at` (write time), which the existing
 * idx_facet_page_cache_created covers — deliberately not true LRU, since
 * tracking read time would turn every cache HIT into a write on a request path,
 * which is the shape that grew this table in the first place.
 *
 * `limit` bounds one pass for the same lock reason as sweepFacetCache; the
 * caller runs it on a timer, so a large backlog drains over several passes
 * rather than in one long write transaction.
 */
export function trimFacetCacheToRows(maxRows = FACET_CACHE_MAX_ROWS, limit = 2000): number {
  try {
    const row = query<{ n: number }>(`SELECT COUNT(*) AS n FROM facet_page_cache`)[0];
    const excess = (row?.n ?? 0) - maxRows;
    if (excess <= 0) return 0;
    const res = run(
      `DELETE FROM facet_page_cache WHERE key IN (
         SELECT key FROM facet_page_cache ORDER BY created_at LIMIT ?
       )`,
      [Math.min(excess, limit)]
    );
    return (res as { changes?: number } | undefined)?.changes ?? 0;
  } catch (e) {
    log.warn("facet_cache_trim_failed", { ...errorFields(e) });
    return 0;
  }
}
