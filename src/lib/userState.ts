import { query } from "@/lib/db";
import type { Source } from "@/types";

// The canonical per-item user-state shown on list / card / calendar items.
// `platformSources` is canonically the WISHLIST providers (so the source dots
// mean the same thing everywhere); library state is separate.
export interface UserState {
  platformSources: Source[];
  onWatchlist: boolean;
  libraryStatus: string | null;
  rating: number | null;
  reviewedAt: number | null;
}

const EMPTY: UserState = { platformSources: [], onWatchlist: false, libraryStatus: null, rating: null, reviewedAt: null };

// Batch-read wishlist + library state for a set of media_item ids (two queries).
export function getUserStateMap(userId: string, mediaItemIds: string[]): Map<string, UserState> {
  const map = new Map<string, UserState>();
  const ids = [...new Set(mediaItemIds.filter(Boolean))];
  if (ids.length === 0) return map;

  const ph = ids.map(() => "?").join(",");
  const watchlist = query<{ media_item_id: string; platform_sources: string }>(
    `SELECT media_item_id, platform_sources FROM user_watchlist WHERE user_id = ? AND media_item_id IN (${ph})`,
    [userId, ...ids]
  );
  const library = query<{ media_item_id: string; status: string | null; rating: number | null; reviewed_at: number | null }>(
    `SELECT media_item_id, status, rating, reviewed_at FROM user_library WHERE user_id = ? AND media_item_id IN (${ph})`,
    [userId, ...ids]
  );

  const wl = new Map<string, Source[]>(watchlist.map((r) => [r.media_item_id, JSON.parse(r.platform_sources ?? "[]") as Source[]]));
  const lib = new Map(library.map((r) => [r.media_item_id, r]));

  for (const id of ids) {
    const sources = wl.get(id) ?? [];
    const l = lib.get(id);
    map.set(id, {
      platformSources: sources,
      onWatchlist: sources.length > 0,
      libraryStatus: l?.status ?? null,
      rating: l?.rating ?? null,
      reviewedAt: l?.reviewed_at ?? null,
    });
  }
  return map;
}

/**
 * The key `resolveMediaIdsBySource` returns its map under. Use it on both sides
 * rather than building the string inline — SM50 added the type segment, and a
 * hand-built key that omits it silently misses every row.
 */
export function sourceRefKey(source: string, sourceId: string | number, type?: string | null): string {
  return `${source}:${sourceId}:${type ?? ""}`;
}

// Resolve live items (e.g. discover) to their canonical media_item id via any of
// their source ids. One batched media_links query; matched by exact
// source + source_id + media type.
//
// SM50 (2026-08-27) — the type is part of the match, because a provider id is
// unique only WITHIN a media type: trakt movie 386 is Being John Malkovich and
// trakt show 386 is SpongeBob SquarePants. Before migration 23 the schema made
// that collision impossible to store (badly — one overwrote the other), so
// matching on source + id alone was accidentally safe. It isn't any more, and
// the callers that resolve a card to an item include the removal endpoints,
// where picking the wrong one takes the wrong title out of somebody's library.
//
// A pair with no `type` still matches on source + id alone and takes the first
// row, which is the old behaviour and the best available answer.
export function resolveMediaIdsBySource(
  pairs: { source: string; sourceId: string; type?: string | null }[],
): Map<string, string> {
  const map = new Map<string, string>(); // sourceRefKey(...) → media_item_id
  const sourceIds = [...new Set(pairs.map((p) => String(p.sourceId)).filter(Boolean))];
  if (sourceIds.length === 0) return map;

  const ph = sourceIds.map(() => "?").join(",");
  const links = query<{ media_item_id: string; source: string; source_id: string; media_type: string }>(
    `SELECT media_item_id, source, source_id, media_type FROM media_links WHERE source_id IN (${ph})`,
    sourceIds
  );
  // Index by the exact source+id so e.g. tmdb 123 ≠ rawg 123, and by type so
  // tmdb movie 387 ≠ tmdb show 387. The untyped index is the fallback for a
  // caller that doesn't know the type; first row wins, as before.
  const byKey = new Map<string, string>();
  const byUntyped = new Map<string, string>();
  for (const l of links) {
    byKey.set(sourceRefKey(l.source, l.source_id, l.media_type), l.media_item_id);
    if (!byUntyped.has(`${l.source}:${l.source_id}`)) byUntyped.set(`${l.source}:${l.source_id}`, l.media_item_id);
  }

  for (const p of pairs) {
    const mid = p.type
      ? byKey.get(sourceRefKey(p.source, p.sourceId, p.type))
      : byUntyped.get(`${p.source}:${p.sourceId}`);
    if (mid) map.set(sourceRefKey(p.source, p.sourceId, p.type), mid);
  }
  return map;
}

// Resolve a single canonical media_item id from a bag of source ids
// ({ tmdb: 123, trakt: 456 }). Used by the removal endpoints so a card that
// doesn't carry the local UUID (discover/feed items) can still be removed.
// Returns the first matching item, or null when none of the ids are known.
// SM50 — `type` is available here only if the caller passes it, and the two
// callers (the library and wishlist DELETEs) receive a body that carries no
// type. So this is the untyped fallback: first row for the id wins. What keeps
// it safe is the S7 ownership gate downstream — a mis-resolution has to ALSO be
// an item already in this user's own list before anything is removed.
export function resolveMediaItemFromIds(
  ids: Record<string, unknown> | null | undefined,
  type?: string | null,
): string | null {
  if (!ids) return null;
  const pairs = Object.entries(ids)
    .filter(([, v]) => v != null)
    .map(([source, sourceId]) => ({ source, sourceId: String(sourceId), type }));
  if (!pairs.length) return null;
  for (const mid of resolveMediaIdsBySource(pairs).values()) return mid;
  return null;
}

export { EMPTY as EMPTY_USER_STATE };
