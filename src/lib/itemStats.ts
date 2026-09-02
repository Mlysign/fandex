// Denormalising the crowd stats onto `media_items`, so the catalog feed can be
// sorted by something other than a date.
//
// ── The defect this closes ──────────────────────────────────────────────────
//
// `catalogSectionPage` serves Discover's browse feed from our own rows once a
// window is big enough (CATALOG_BROWSE). It shipped `voteCount: 0` and
// `voteAverage: null` on every one of them, because `media_items` held no such
// column and the real numbers live inside `media_links.raw_data`, behind the
// merge that `catalogFeed.ts` exists to avoid.
//
// `decorateSection` turns those into `communityVotes: 0`, and the client's
// Popularity sort is `votesOf(i) = i.communityVotes ?? 0`. Every catalog row
// ties at zero; `Array.prototype.sort` is stable; so the user sees ARRIVAL order
// under a control labelled "Popularity". That is the 2026-08-29 search bug
// exactly, which put a 1959 show above a 2026 one, and it would have arrived
// silently the moment a browse window crossed CATALOG_BROWSE_MIN.
//
// ── Why the numbers cannot drift from the rest of the app ───────────────────
//
// They are computed by the SAME two pure functions the search path uses, over
// the same `merged.communityRatings`:
//
//     discovery.ts:409   communityVotes(merged.communityRatings)
//                        averageCommunity(merged.communityRatings)
//
// so a catalog-served card and a `find()` card cannot disagree about a title.
// Nothing here re-implements a per-provider mapping, which is the drift this
// repo has been bitten by before (see the slug repair, and the facet-cache
// token). `getDerivedForItem` is the same cache the pool already fills, so a
// refresh pass over items the pool has touched is mostly cache hits.
//
// ── Why a background pass and not the write path ────────────────────────────
//
// The obvious place is `persistDiscoverItems`, and it is the wrong one.
// `lookupExistingUuids` short-circuits every already-known item into a plain
// SELECT precisely so a browse request under crawler traffic does not take a
// write lock (PR13-PR15). Refreshing stats there would put a write back on the
// hot path for every item on every page. So this runs on the timer instead,
// in bounded batches, and costs ZERO provider calls: everything it needs is
// already on disk.
import { query, run } from "@/lib/db";
import { getDerivedForItem, type RawLink } from "@/lib/facetCache";
import { communityVotes } from "@/lib/ratingsSort";
import { averageCommunity } from "@/lib/ratings";
import { log, errorFields } from "@/lib/logger";
import type { MediaType } from "@/types";

/**
 * Rows per pass. Small on purpose: this shares a process with request handling,
 * `better-sqlite3` is synchronous, and there is no deadline to hit. 5,132 rows
 * at 200 a pass clears in about a day of ticks, and after that the queue is
 * only whatever changed.
 */
export const STATS_BATCH = 200;

/**
 * How long a computed figure is trusted. A vote count moves slowly and the
 * inputs only change when a link is re-synced or re-projected, so this is about
 * catching those eventually rather than about freshness in minutes.
 */
export const STATS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Read at CALL time, never at module load. → AGENTS.md, the safety-gate rule. */
export function statsBatchSize(): number {
  const raw = process.env.ITEM_STATS_BATCH;
  const n = raw === undefined || raw === "" ? STATS_BATCH : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : STATS_BATCH;
}

export interface ItemStats {
  voteCount: number;
  /** 0-10, matching FeedCandidate.voteAverage. NOT the 0-100 communityScore. */
  voteAverage: number | null;
}

/**
 * The crowd stats for one item, from links already on disk.
 *
 * `averageCommunity` returns a 0-100 figure (it is `communityAvg`), and
 * `FeedCandidate.voteAverage` is 0-10 because `decorateSection` multiplies it
 * back up for `communityScore`. Storing the 0-100 form would double every
 * rating on the catalog path, so the divide is load-bearing, not cosmetic.
 */
export function statsFromLinks(id: string, type: MediaType, links: RawLink[]): ItemStats {
  const { merged } = getDerivedForItem(id, links, type);
  const avg100 = averageCommunity(merged.communityRatings);
  return {
    voteCount: communityVotes(merged.communityRatings),
    voteAverage: avg100 == null ? null : avg100 / 10,
  };
}

interface Row { id: string; type: MediaType }
interface LinkRow {
  media_item_id: string;
  source: RawLink["source"];
  source_id: string;
  release_date: string | null;
  raw_data: string | null;
  last_synced: number | null;
}

/**
 * One bounded pass: fill the stalest (or never-computed) rows and return how
 * many were written.
 *
 * NULL `stats_at` sorts first, which is what makes the initial fill drain
 * before the refresh cycle starts competing with it.
 *
 * Best-effort by design. This is an optimisation for a sort control; a failure
 * here must never take down a request or a boot.
 */
export function refreshItemStats(limit = statsBatchSize(), now = Date.now()): number {
  try {
    const cutoff = now - STATS_TTL_MS;
    const rows = query<Row>(
      `SELECT id, type FROM media_items
        WHERE stats_at IS NULL OR stats_at < ?
        ORDER BY stats_at IS NOT NULL, stats_at ASC
        LIMIT ?`,
      [cutoff, limit]
    );
    if (!rows.length) return 0;

    // One query for the whole batch's links rather than one per item: the same
    // shape `discovery.ts` uses to build its pool.
    const ids = rows.map((r) => r.id);
    const links = query<LinkRow>(
      `SELECT media_item_id, source, source_id, release_date, raw_data, last_synced
         FROM media_links WHERE media_item_id IN (${ids.map(() => "?").join(",")})`,
      ids
    );
    const byItem = new Map<string, RawLink[]>();
    for (const l of links) {
      const list = byItem.get(l.media_item_id) ?? [];
      list.push({
        source: l.source,
        sourceId: l.source_id,
        releaseDate: l.release_date,
        rawData: l.raw_data,
        lastSynced: l.last_synced ?? 0,
      });
      byItem.set(l.media_item_id, list);
    }

    let written = 0;
    for (const r of rows) {
      // An item with no links has no crowd stats and never will until one
      // arrives. Stamp it anyway, or it sits at the head of the queue forever
      // and starves everything behind it.
      const mine = byItem.get(r.id) ?? [];
      let stats: ItemStats = { voteCount: 0, voteAverage: null };
      if (mine.length) {
        try {
          stats = statsFromLinks(r.id, r.type, mine);
        } catch (e) {
          log.warn("item_stats_derive_failed", { id: r.id, ...errorFields(e) });
        }
      }
      run(
        "UPDATE media_items SET vote_count = ?, vote_average = ?, stats_at = ? WHERE id = ?",
        [stats.voteCount, stats.voteAverage, now, r.id]
      );
      written++;
    }
    return written;
  } catch (e) {
    log.error("item_stats_refresh_failed", { ...errorFields(e) });
    return 0;
  }
}

/** How much of the catalog has usable stats. Reported by /api/health. */
export function itemStatsStatus(now = Date.now()): { total: number; computed: number; stale: number } {
  const row = query<{ total: number; computed: number; stale: number }>(
    `SELECT COUNT(*) total,
            SUM(CASE WHEN stats_at IS NOT NULL THEN 1 ELSE 0 END) computed,
            SUM(CASE WHEN stats_at IS NOT NULL AND stats_at < ? THEN 1 ELSE 0 END) stale
       FROM media_items`,
    [now - STATS_TTL_MS]
  )[0];
  return { total: row?.total ?? 0, computed: row?.computed ?? 0, stale: row?.stale ?? 0 };
}
