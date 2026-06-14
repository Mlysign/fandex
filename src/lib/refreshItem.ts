import { get } from "@/lib/db";
import { removeWatchlistSource, removeLibrarySource } from "@/lib/matcher";
import { sourcesForType } from "@/lib/sources/registry";
import { MediaSource, CrossIds } from "@/lib/sources/types";
import { ingestWishlistItem, ingestLibraryItem, itemMatches } from "@/lib/sources/ingest";

// Known source ids for the item being refreshed. A discover movie carries `tmdb`
// (so Trakt/Letterboxd are matched via TMDB cross-reference); a discover game
// carries `rawg`/`steam` (matched by their own id only).
export interface ItemIds {
  tmdb?: string | null;
  trakt?: string | null;
  letterboxd?: string | null;
  rawg?: string | null;
  steam?: string | null;
}

// Current local watchlist/library sources for the item (to decide removals).
function dbSources(userId: string, mediaItemId: string | null) {
  if (!mediaItemId) return { watchlist: new Set<string>(), library: new Set<string>() };
  const w = get<{ platform_sources: string }>("SELECT platform_sources FROM user_watchlist WHERE user_id = ? AND media_item_id = ?", [userId, mediaItemId]);
  const l = get<{ platform_sources: string }>("SELECT platform_sources FROM user_library  WHERE user_id = ? AND media_item_id = ?", [userId, mediaItemId]);
  return {
    watchlist: new Set<string>(w ? JSON.parse(w.platform_sources ?? "[]") : []),
    library:   new Set<string>(l ? JSON.parse(l.platform_sources ?? "[]") : []),
  };
}

// Can we identify this item for `src` at all? Own-id matchers (RAWG, Steam) need
// their id present; cross-ref matchers (Trakt, Letterboxd) can also use a TMDB id.
// Without any match key we leave the provider's state untouched rather than
// risk removing a link we simply can't verify.
function canMatch(src: MediaSource, ids: CrossIds): boolean {
  const own = (ids as Record<string, any>)[src.id];
  if (own != null) return true;
  return src.matches != null && ids.tmdb != null;
}

// Live-check this single item against every connected provider and update the
// local DB to match. Returns the resolved media_item_id (may be newly created).
// Generic over the MediaSource registry — the same adapter pull + ingest used by
// the bulk sync, so the two can never drift out of sync again.
export async function refreshItemFromProviders(
  userId: string,
  type: string,
  ids: ItemIds,
  mediaItemId: string | null
): Promise<string | null> {
  for (const src of sourcesForType(type)) {
    try {
      mediaItemId = await refreshSource(userId, src, ids as CrossIds, mediaItemId);
    } catch (e) {
      console.error("[refreshItem]", src.id, e);
    }
  }
  return mediaItemId;
}

async function refreshSource(
  userId: string,
  src: MediaSource,
  ids: CrossIds,
  mediaItemId: string | null
): Promise<string | null> {
  if (!canMatch(src, ids)) return mediaItemId;
  const ctx = await src.context(userId);
  if (!ctx) return mediaItemId;

  // Wishlist
  if (src.capabilities.wishlist.read && src.pullWishlist) {
    try {
      const item = (await src.pullWishlist(ctx)).find((i) => itemMatches(src, i, ids));
      if (item) {
        mediaItemId = await ingestWishlistItem(userId, src, item);
      } else if (mediaItemId && dbSources(userId, mediaItemId).watchlist.has(src.id)) {
        removeWatchlistSource(userId, mediaItemId, src.id);
      }
    } catch { /* leave state as-is on error */ }
  }

  // Library
  if (src.capabilities.library.read && src.pullLibrary) {
    try {
      const item = (await src.pullLibrary(ctx)).find((i) => itemMatches(src, i, ids));
      if (item) {
        mediaItemId = await ingestLibraryItem(userId, src, item);
      } else if (mediaItemId && dbSources(userId, mediaItemId).library.has(src.id)) {
        removeLibrarySource(userId, mediaItemId, src.id);
      }
    } catch { /* leave state as-is on error */ }
  }

  return mediaItemId;
}
