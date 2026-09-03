import { run, get, query } from "@/lib/db";
import { sharedCache } from "@/lib/boundedCache";

// "Stop showing me this." (Nils, 2026-09-03.)
//
// A per-user display preference, NOT a membership, and the distinction is the
// whole design. Hiding a title must not change what the catalog holds, what the
// user's library says, or what any provider is told; it changes which of OUR
// feeds are allowed to volunteer it.
//
// ── What hiding does and does not reach ─────────────────────────────────────
//
//   HIDDEN FROM   the Home recommendation rail, the Discover feed, and the
//                 Progress rail (upNext), which are the three surfaces that
//                 CHOOSE things on the viewer's behalf.
//
//   STILL VISIBLE in search, on its own item page, in the library and wishlist,
//                 and on the calendar. Nils's rule, verbatim: "item does not
//                 show up as recommendations. only when searched for it." A
//                 hidden title you go looking for is a title you want to see, so
//                 filtering search would make the feature indistinguishable from
//                 having deleted the row.
//
// ⚠️ It is deliberately NOT a filter inside `find()` for the same reason
// users.platforms and users.media_types are not: those are the display
// preferences that must never reach a sync pull, because "absent from the pull"
// reads as "removed upstream" and DELETES the row. Nothing here goes anywhere
// near a pull, and keeping the filter at the feed boundary is what guarantees
// it never can.

/**
 * Per-user hidden id sets, keyed by user.
 *
 * Read on every feed request and written only by an explicit hide/unhide, so it
 * is heavily read-biased. Through `sharedCache` rather than a module-level Map
 * because Next resolves a module into a different bundle per route kind: a bare
 * `new Map()` here would be per-bundle, so hiding something from the item page
 * (a page bundle) would not be visible to /api/home (a route bundle) until the
 * TTL that never existed expired. That is the same trap that silently broke the
 * circuit breaker for three weeks.
 */
const cache = sharedCache<string, Set<string>>("hiddenItems", { max: 500, ttlMs: 5 * 60_000 });

/** Every media_item this user has hidden. Cached; invalidated by hide/unhide. */
export function hiddenItemIds(userId: string): Set<string> {
  const hit = cache.get(userId);
  if (hit) return hit;
  const rows = query<{ media_item_id: string }>(
    "SELECT media_item_id FROM user_hidden_items WHERE user_id = ?",
    [userId],
  );
  const set = new Set(rows.map((r) => r.media_item_id));
  cache.set(userId, set);
  return set;
}

export function isHidden(userId: string, mediaItemId: string): boolean {
  return hiddenItemIds(userId).has(mediaItemId);
}

export function hideItem(userId: string, mediaItemId: string): void {
  run(
    "INSERT OR IGNORE INTO user_hidden_items (user_id, media_item_id) VALUES (?, ?)",
    [userId, mediaItemId],
  );
  cache.delete(userId);
}

export function unhideItem(userId: string, mediaItemId: string): void {
  run(
    "DELETE FROM user_hidden_items WHERE user_id = ? AND media_item_id = ?",
    [userId, mediaItemId],
  );
  cache.delete(userId);
}

/** For /api/account/export, whose column lists are written by hand. */
export function hiddenItemsForExport(userId: string): { mediaItemId: string; hiddenAt: number }[] {
  return query<{ media_item_id: string; hidden_at: number }>(
    "SELECT media_item_id, hidden_at FROM user_hidden_items WHERE user_id = ? ORDER BY hidden_at DESC",
    [userId],
  ).map((r) => ({ mediaItemId: r.media_item_id, hiddenAt: r.hidden_at }));
}

export function hiddenCount(userId: string): number {
  return get<{ n: number }>(
    "SELECT COUNT(*) n FROM user_hidden_items WHERE user_id = ?",
    [userId],
  )?.n ?? 0;
}

/**
 * Drop the hidden ones out of a feed.
 *
 * Takes the id off each row rather than assuming a field name, because the three
 * feeds this serves carry the local uuid under different keys: the discover feed
 * items are keyed `id` only AFTER persistDiscoverBatch has resolved them, and
 * before that `id` is a provider-scoped string like `igdb-402959`, which is
 * never in this set. Filter AFTER the uuid resolution, never before.
 */
export function withoutHidden<T>(rows: T[], userId: string | null, idOf: (row: T) => string | null | undefined): T[] {
  if (!userId || rows.length === 0) return rows;
  const hidden = hiddenItemIds(userId);
  if (hidden.size === 0) return rows;
  return rows.filter((r) => {
    const id = idOf(r);
    return !id || !hidden.has(id);
  });
}
