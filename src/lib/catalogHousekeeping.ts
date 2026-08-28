import { query, get, run } from "@/lib/db";

// Housekeeping by BYTES — phase 5 of docs/catalog-growth.md.
//
// ── The one idea ────────────────────────────────────────────────────────────
// **70% of the database file is `media_links.raw_data`** (measured: 47.6 MB of
// 67.5 MB, ~7 KB per link). Dropping a blob reclaims almost all of an item's
// disk while the row, its uuid, its stored slug, its title, its poster, the FK
// graph and every user relation survive.
//
// Deleting ROWS is the alternative and it is worse: it is what makes public
// pages start 404ing, and the archive already records "pruned browsed items lose
// their public URLs" as an accepted loss from last time. Evict bytes, keep rows.
//
// ── Why a blob can go at all ────────────────────────────────────────────────
// Since 2026-08-28 the derived projection is stored (`media_item_projection`,
// §15). Everything the catalog surfaces read — facets, the merged projection,
// scores, cards — comes from there, not from `raw_data`. So a blob whose
// projection exists is redundant for every read path except one:
//
// ⚠️ THE PRICE, and it is real. A future `PROJECTION_VERSION` bump cannot
// re-derive an item whose blob is gone; it has to REFETCH it from the provider.
// That is the accepted trade → [[lazy-heal-vs-mass-reprojection]]. It is also
// why this only ever touches items that are already at the CURRENT projection
// version: an item still waiting to be healed would lose the payload it was
// about to be healed from.
//
// ── Why it is careful about what it touches ─────────────────────────────────
// The never-evict list below is not a heuristic. Each clause is something whose
// loss would be visible to a person or a crawler, and the rule is the same one
// dbPrune's predicate follows: name every table one by one, never reason that
// one implies another.

/** Blobs dropped per pass. Bounded like every other background write. */
export const HOUSEKEEPING_BATCH = Number(process.env.HOUSEKEEPING_BATCH) || 200;

/**
 * Start reclaiming above this file size, in MB. Below it, do nothing at all.
 *
 * ⚠️ A SIZE trigger, not an age one, and that is the whole point of "by bytes".
 * There is no benefit to dropping a blob from a small database: it costs a
 * refetch later and saves space nobody needed. The 2 GB tripwire in §3 is the
 * ceiling; this starts work well before it so the reclaim is never a burst.
 */
// Read at CALL time, like the backfill's ceiling and the IGDB kill switch: a
// safety gate you cannot exercise without reloading the module is a safety gate
// nothing tests. (It cost this file five red tests before it was moved.)
export function housekeepingStartMb(): number {
  const raw = process.env.HOUSEKEEPING_START_MB;
  return raw === undefined || raw === "" ? 1200 : Number(raw);
}

/**
 * Never evict a blob from a link whose item:
 *
 *  - any user has acted on (`user_item_state`) or tracked episodes of
 *    (`user_episode_state`) — their rating and history hang off it;
 *  - a daily snapshot links to (`home_snapshot_item`, `calendar_snapshot_item`)
 *    — those are the public pages the highest-authority URLs point at;
 *  - a franchise rail or an IP override names (`franchise_members` is keyed by
 *    ip_key rather than item id, so `item_ip_override` is the one that binds).
 *
 * ⚠️ It also requires the item to be at the CURRENT projection version, so a
 * thin row waiting for the fill job keeps the payload it will be healed from,
 * and requires a stored projection to exist, so nothing is dropped that has not
 * already been derived into the form every read path uses.
 */
const KEEPABLE = `
  ml.media_item_id NOT IN (SELECT media_item_id FROM user_item_state)
  AND ml.media_item_id NOT IN (SELECT media_item_id FROM user_episode_state)
  AND ml.media_item_id NOT IN (SELECT media_item_id FROM home_snapshot_item)
  AND ml.media_item_id NOT IN (SELECT media_item_id FROM calendar_snapshot_item)
  AND ml.media_item_id NOT IN (SELECT media_item_id FROM item_ip_override)
  AND EXISTS (SELECT 1 FROM media_item_projection p WHERE p.media_item_id = ml.media_item_id)
`;

export interface HousekeepingStatus {
  fileMb: number;
  /** Blobs that could be dropped right now without breaking the rules above. */
  evictable: number;
  evictableMb: number;
  /** Blobs held back BY those rules, i.e. what the never-evict list is protecting. */
  protectedBlobs: number;
}

function fileMb(): number {
  const r = get<{ mb: number }>(
    `SELECT (SELECT * FROM pragma_page_count()) * (SELECT * FROM pragma_page_size()) / 1048576.0 AS mb`
  );
  return Math.round((r?.mb ?? 0) * 10) / 10;
}

export function housekeepingStatus(): HousekeepingStatus {
  const ev = get<{ n: number; b: number }>(
    `SELECT COUNT(*) n, COALESCE(SUM(LENGTH(ml.raw_data)), 0) b
       FROM media_links ml
       JOIN media_items mi ON mi.id = ml.media_item_id
      WHERE ml.raw_data IS NOT NULL AND ml.raw_data <> ''
        AND COALESCE(ml.projection_version, 0) > 0
        AND ${KEEPABLE}`
  );
  const total = get<{ n: number }>(
    `SELECT COUNT(*) n FROM media_links WHERE raw_data IS NOT NULL AND raw_data <> ''`
  );
  return {
    fileMb: fileMb(),
    evictable: ev?.n ?? 0,
    evictableMb: Math.round(((ev?.b ?? 0) / 1e6) * 10) / 10,
    protectedBlobs: (total?.n ?? 0) - (ev?.n ?? 0),
  };
}

export interface HousekeepingResult {
  ran: boolean;
  reason?: "under-threshold";
  fileMb: number;
  dropped: number;
  freedMb: number;
}

/**
 * Drop one bounded batch of redundant blobs, oldest-synced first.
 *
 * ⚠️ Oldest first because the blob most likely to be refetched is the newest
 * one: a recently synced item is the one a person is looking at. It is also the
 * order the retention sweep and the fill job walk, so the three jobs do not
 * fight over the same rows.
 *
 * ⚠️ Bounded, on an interval, for the PR16 reason: 546,754 rows deleted in one
 * transaction was 12.8 GB of WAL shipped to S3 and the site went down. Note that
 * an UPDATE that nulls a 7 KB blob is itself WAL, so this is a write job, not a
 * free one → [[prod-incidents]].
 */
export function housekeepingPass(batch = HOUSEKEEPING_BATCH): HousekeepingResult {
  const mb = fileMb();
  if (mb < housekeepingStartMb()) {
    return { ran: false, reason: "under-threshold", fileMb: mb, dropped: 0, freedMb: 0 };
  }
  const rows = query<{ id: string; len: number }>(
    `SELECT ml.id, LENGTH(ml.raw_data) len
       FROM media_links ml
       JOIN media_items mi ON mi.id = ml.media_item_id
      WHERE ml.raw_data IS NOT NULL AND ml.raw_data <> ''
        AND COALESCE(ml.projection_version, 0) > 0
        AND ${KEEPABLE}
      ORDER BY ml.last_synced ASC
      LIMIT ?`,
    [batch]
  );
  if (!rows.length) return { ran: true, fileMb: mb, dropped: 0, freedMb: 0 };

  // '' rather than NULL: `raw_data` is NOT NULL in the schema, and an empty
  // string reads as "we hold no payload" everywhere that checks (the fill job's
  // heal path and getDerivedForItem both treat it as nothing to parse).
  run(
    `UPDATE media_links SET raw_data = '' WHERE id IN (${rows.map(() => "?").join(",")})`,
    rows.map((r) => r.id)
  );
  const freed = rows.reduce((n, r) => n + (r.len ?? 0), 0);
  return { ran: true, fileMb: fileMb(), dropped: rows.length, freedMb: Math.round((freed / 1e6) * 10) / 10 };
}
