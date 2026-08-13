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
// Every function here is best-effort by design: a cache is an optimisation, and
// no failure in it may ever fail a page render.
import { query, run } from "@/lib/db";
import { log, errorFields } from "@/lib/logger";

/** Read a cached payload, or null if absent, expired, or unreadable. Never throws. */
export function readFacetCache(key: string, maxAgeMs: number): string | null {
  try {
    const cutoff = Date.now() - maxAgeMs;
    const rows = query<{ payload: string; created_at: number }>(
      `SELECT payload, created_at FROM facet_page_cache WHERE key = ?`,
      [key]
    );
    const row = rows[0];
    if (!row) return null;
    // Compared in JS rather than SQL so a clock change can't make a stale row
    // permanently unreachable-but-present; the sweep below still collects it.
    if (row.created_at < cutoff) return null;
    return row.payload;
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
      [key, payload, Date.now()]
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
