// Removing an item from the wishlist — provider write-back INCLUDED.
//
// Extracted from `/api/watchlist`'s DELETE handler (2026-07-30) because a
// second caller now needs it: rating an item drops it off the wishlist. That
// caller cannot just delete the local rows, for a reason that would have been
// invisible until the next sync — the PROVIDERS own the wishlist, and
// `syncProvider` pulls it back. A local-only removal un-removes itself.
//
// Two rules this carries over from the route, both learned the hard way:
//  • S7 — scope the whole operation to the caller's own data. The write-back
//    loop below acts on every link of `mediaItemId` using the caller's tokens,
//    so it only proceeds when the item is actually on THIS user's wishlist.
//    Not-on-your-wishlist is a no-op, not an error (idempotent).
//  • Local removal goes through matcher's clearWatchlist/removeWatchlistSource,
//    never a raw `DELETE FROM user_watchlist` — the cache table is derived from
//    user_item_state, and deleting only the cache leaves orphaned truth rows
//    (found live 2026-07-19, from exactly that shortcut).

import { get, query } from "@/lib/db";
import { removeWatchlistSource, clearWatchlist } from "@/lib/matcher";
import { log, errorFields } from "@/lib/logger";
import { SOURCES } from "@/lib/sources/registry";
import type { MediaType, Source } from "@/types";

/**
 * Take `mediaItemId` off `userId`'s wishlist, pushing the removal to every
 * linked writable provider first.
 *
 * @param source  Narrow to a single provider (the per-platform toggles). Omit
 *                to clear the item from the wishlist entirely.
 * @returns true when the item was on the wishlist and has been removed;
 *          false when there was nothing to do.
 */
export async function removeFromWishlist(
  userId: string,
  mediaItemId: string,
  opts: { source?: Source | string } = {}
): Promise<boolean> {
  const { source } = opts;

  const owned = get<{ n: number }>(
    "SELECT 1 AS n FROM user_watchlist WHERE user_id = ? AND media_item_id = ? LIMIT 1",
    [userId, mediaItemId]
  );
  if (!owned) return false;

  const mediaItem = get<{ type: string }>("SELECT type FROM media_items WHERE id = ?", [mediaItemId]);
  const itemType = (mediaItem?.type ?? null) as MediaType | null;

  // ── Platform write-back removal via the MediaSource registry ──
  // For each linked, writable provider (optionally narrowed to `source`),
  // remove the item from that platform's wishlist through its adapter. A
  // provider failure is logged and skipped: losing one platform's write-back
  // must not block the local removal (or, for the rating caller, the rating).
  const links = query<{ source: string; source_id: string }>(
    "SELECT source, source_id FROM media_links WHERE media_item_id = ?",
    [mediaItemId]
  );
  for (const link of links) {
    if (source && source !== link.source) continue;
    const src = SOURCES[link.source as Source];
    if (!src || !src.capabilities.wishlist.write) continue;
    try {
      const ctx = await src.context(userId);
      if (!ctx?.token) continue;
      await src.pushWishlist!(ctx, link.source_id, (itemType ?? src.mediaTypes[0]), false);
      log.info("watchlist_writeback", { op: "remove", source: link.source, sourceId: link.source_id, mediaItemId });
    } catch (e) { log.error("watchlist_writeback_failed", { op: "remove", source: link.source, mediaItemId, ...errorFields(e) }); }
  }

  // ── Local removal ──
  if (source) removeWatchlistSource(userId, mediaItemId, source as Source);
  else clearWatchlist(userId, mediaItemId);

  return true;
}
