import { MediaType } from "@/types";
import { MediaSource, PulledItem, CrossIds } from "./types";
import { upsertMediaItem, upsertWatchlistEntry, upsertLibraryEntry } from "@/lib/matcher";

// Shared atoms for turning a provider's PulledItem into local DB state. Used by
// BOTH the bulk sync (loop over all items) and the single-item refresh (find one
// item), so the persist + enrich + mark logic lives in exactly one place — this
// is what eliminated the sync/refresh duplication that previously let the same
// bug (RAWG's rating field) exist in two copies.

export function persistPulled(src: MediaSource, item: PulledItem): string {
  return upsertMediaItem({
    source: src.id,
    sourceId: item.sourceId,
    type: (item.type ?? src.mediaTypes[0]) as MediaType,
    title: item.title,
    releaseDate: item.releaseDate ?? null,
    rawData: item.rawData,
  });
}

export async function ingestWishlistItem(userId: string, src: MediaSource, item: PulledItem): Promise<string> {
  const mediaItemId = persistPulled(src, item);
  if (src.enrich) await src.enrich(item, mediaItemId, "wishlist");
  upsertWatchlistEntry(userId, mediaItemId, src.id);
  return mediaItemId;
}

export async function ingestLibraryItem(userId: string, src: MediaSource, item: PulledItem): Promise<string> {
  const mediaItemId = persistPulled(src, item);
  if (src.enrich) await src.enrich(item, mediaItemId, "library");
  upsertLibraryEntry(userId, mediaItemId, src.id, {
    status: item.status ?? undefined,
    rating: item.rating ?? null,
    review: item.review ?? null,
    reviewedAt: item.reviewedAt ?? null,
  });
  return mediaItemId;
}

// Default item matcher: own-id equality. Adapters override via `MediaSource.matches`
// (e.g. Trakt/Letterboxd also match through a TMDB cross-reference).
export function itemMatches(src: MediaSource, item: PulledItem, ids: CrossIds): boolean {
  if (src.matches) return src.matches(item, ids);
  const own = (ids as Record<string, any>)[src.id];
  return own != null && String(item.sourceId) === String(own);
}
