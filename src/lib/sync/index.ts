import { randomUUID } from "crypto";
import { query, run } from "@/lib/db";
import { MediaSource } from "@/lib/sources/types";
import { SOURCES } from "@/lib/sources/registry";
import { ingestWishlistItem, ingestLibraryItem } from "@/lib/sources/ingest";
import { removeWatchlistSource, removeLibrarySource } from "@/lib/matcher";

// ════════════════════════════════════════════════════════════════════════════
//  Generic sync — pulls every connected provider's wishlist + library through
//  the MediaSource adapter, then upserts / enriches / prunes. This replaces the
//  former hand-written syncTrakt/syncSteam/syncRawg/syncLetterboxd (+ *Library)
//  functions: adding a platform now needs only its adapter, not a sync routine.
// ════════════════════════════════════════════════════════════════════════════

export interface ProviderSyncResult {
  provider: string;
  wishlist: number;
  library: number;
  error?: string;
}

function logSync(userId: string, provider: string, count: number, status: string, error?: string) {
  run(
    "INSERT INTO sync_log (id, user_id, provider, item_count, status, error) VALUES (?, ?, ?, ?, ?, ?)",
    [randomUUID(), userId, provider, count, status, error ?? null]
  );
}

// Remove watchlist/library links for a source whose ids are no longer present.
function pruneWatchlist(userId: string, source: string, syncedIds: Set<string>) {
  const existing = query<{ media_item_id: string; source_id: string }>(
    `SELECT ml.media_item_id, ml.source_id FROM media_links ml
     JOIN user_watchlist uw ON uw.media_item_id = ml.media_item_id
     WHERE uw.user_id = ? AND ml.source = ?`,
    [userId, source]
  );
  for (const e of existing) {
    if (!syncedIds.has(e.source_id)) removeWatchlistSource(userId, e.media_item_id, source as any);
  }
}

function pruneLibrary(userId: string, source: string, syncedIds: Set<string>) {
  const existing = query<{ media_item_id: string; source_id: string }>(
    `SELECT ml.media_item_id, ml.source_id FROM media_links ml
     JOIN user_library ul ON ul.media_item_id = ml.media_item_id
     WHERE ul.user_id = ? AND ml.source = ?`,
    [userId, source]
  );
  for (const e of existing) {
    if (!syncedIds.has(e.source_id)) removeLibrarySource(userId, e.media_item_id, source as any);
  }
}

// Pull + ingest one provider's wishlist and library per its declared capabilities.
export async function syncProvider(userId: string, src: MediaSource): Promise<ProviderSyncResult> {
  const ctx = await src.context(userId);
  if (!ctx) return { provider: src.id, wishlist: 0, library: 0, error: "not connected" };

  let wishlist = 0;
  let library = 0;

  // ── Wishlist ──
  if (src.capabilities.wishlist.read && src.pullWishlist) {
    try {
      const items = await src.pullWishlist(ctx);
      const syncedIds = new Set<string>();
      for (const item of items) {
        await ingestWishlistItem(userId, src, item);
        syncedIds.add(item.sourceId);
      }
      pruneWatchlist(userId, src.id, syncedIds);
      wishlist = syncedIds.size;
      logSync(userId, src.id, wishlist, "ok");
    } catch (e: any) {
      logSync(userId, src.id, wishlist, "error", e.message);
      return { provider: src.id, wishlist, library, error: e.message };
    }
  }

  // ── Library (watched / played / owned, with personal scores) ──
  if (src.capabilities.library.read && src.pullLibrary) {
    try {
      const items = await src.pullLibrary(ctx);
      const syncedIds = new Set<string>();
      for (const item of items) {
        await ingestLibraryItem(userId, src, item);
        syncedIds.add(item.sourceId);
      }
      pruneLibrary(userId, src.id, syncedIds);
      library = syncedIds.size;
      logSync(userId, `${src.id}-library`, library, "ok");
    } catch (e: any) {
      logSync(userId, `${src.id}-library`, library, "error", e.message);
    }
  }

  return { provider: src.id, wishlist, library };
}

// Sync every registered provider (or just one), in registry order.
export async function syncProviders(userId: string, only?: string): Promise<ProviderSyncResult[]> {
  const results: ProviderSyncResult[] = [];
  for (const src of Object.values(SOURCES)) {
    if (!src) continue;
    if (only && only !== "all" && only !== src.id) continue;
    results.push(await syncProvider(userId, src));
  }
  return results;
}
