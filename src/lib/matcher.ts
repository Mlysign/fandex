import { randomUUID } from "crypto";
import { projectRawData, PROJECTION_VERSION } from "./sources/project";
import { query, run, get, transaction } from "./db";
import { normalizeName, extractYear, mergeForCanonical } from "./merge";
import { averageFromMetadata } from "./ratings";
import { ensureItemSlug } from "./itemSlug";
import type { Source, MediaType } from "@/types";

interface SourceItem {
  source: Source;
  sourceId: string;
  type: MediaType;
  title: string;
  releaseDate: string | null;
  rawData: any;
  /**
   * H2b — this payload came from a provider LIST endpoint (a /discover browse or
   * search result), not a detail fetch. Two consequences, both load-bearing:
   *
   *  1. It is stamped `projection_version = 0`, NOT PROJECTION_VERSION. The stamp
   *     means "the shape this row was written in", and a list payload is not the
   *     projected-detail shape — it has no cast, keywords, trailers or watch
   *     providers. Stamping it current would make `ensureTmdbDetail` read it as
   *     fresh and skip the detail fetch, so every browsed item's page would
   *     render permanently from ~1KB of list data. Version 0 = "refetch on first
   *     detail read", which is the staleness path that already exists.
   *  2. It NEVER overwrites an existing link. A thin write is insert-only: if the
   *     link is already stored (possibly with a full detail blob), we return its
   *     media_item_id and touch nothing. Otherwise a browse pass over a title the
   *     user already owns would shallow-merge list junk over the real payload.
   */
  thin?: boolean;
}

// Preserve detail-only fields when a sparser payload re-syncs over a richer one
// (D9). List endpoints (Steam owned-games = appid/name/playtime, RAWG played-list)
// omit `developers`/`publishers`/`screenshots` that a prior detail fetch persisted,
// so a plain overwrite would drop them every sync. Shallow-merge new over old:
// fresh fields win, but keys absent from the new payload are kept.
function mergeRawData(prevJson: string | null | undefined, next: any): any {
  if (!prevJson) return next;
  let prev: any;
  try { prev = JSON.parse(prevJson); } catch { return next; }
  const plain = (v: any) => v && typeof v === "object" && !Array.isArray(v);
  return plain(prev) && plain(next) ? { ...prev, ...next } : next;
}

// Find or create a media_item for the given source item.
// Returns the media_item_id.
export function upsertMediaItem(item: SourceItem): string {
  return transaction(() => {
    // 1. If this exact source link already exists, update its raw data
    const existing = get<{ media_item_id: string; raw_data: string }>(
      "SELECT media_item_id, raw_data FROM media_links WHERE source = ? AND source_id = ?",
      [item.source, item.sourceId]
    );
    if (existing) {
      // A thin (list-payload) write never degrades a stored link — see SourceItem.thin.
      if (item.thin) return existing.media_item_id;
      run(
        "UPDATE media_links SET raw_data = ?, title = ?, release_date = ?, last_synced = strftime('%s','now'), projection_version = ? WHERE source = ? AND source_id = ?",
        // H2a: project AFTER merging, so the merge still sees the stored blob
        // (possibly a fat pre-projection one) and the result is stamped current.
        [JSON.stringify(projectRawData(item.source, mergeRawData(existing.raw_data, item.rawData))),
         item.title, item.releaseDate, PROJECTION_VERSION, item.source, item.sourceId]
      );
      remergeItem(existing.media_item_id);
      return existing.media_item_id;
    }

    // 2. Try to match an existing canonical item by normalized name + type + year
    const mediaItemId = findMatchingItem(item);
    if (mediaItemId) {
      run(
        `INSERT INTO media_links (id, media_item_id, source, source_id, title, release_date, raw_data, projection_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), mediaItemId, item.source, item.sourceId, item.title, item.releaseDate, JSON.stringify(projectRawData(item.source, item.rawData)), linkVersion(item)]
      );
      remergeItem(mediaItemId);
      return mediaItemId;
    }

    // 3. Create a new canonical item.
    //
    // `browsed` (H2b) is set ONLY here, on creation, and only for a thin write —
    // an item nobody has done anything with but see it go by in a /discover feed.
    // Cases 1 and 2 above don't reach this, so a title that's already in the pool
    // can never be demoted to browsed by someone browsing past it. Promotion the
    // other way needs no code: the pool query unions in everything in
    // user_item_state, so wishlisting a browsed item pulls it in immediately.
    const newId = randomUUID();
    run(
      `INSERT INTO media_items (id, type, title, norm_title, release_date, poster_url, browsed)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [newId, item.type, item.title, normalizeName(item.title), item.releaseDate, null, item.thin ? 1 : 0]
    );
    run(
      `INSERT INTO media_links (id, media_item_id, source, source_id, title, release_date, raw_data, projection_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), newId, item.source, item.sourceId, item.title, item.releaseDate, JSON.stringify(projectRawData(item.source, item.rawData)), linkVersion(item)]
    );
    remergeItem(newId);
    // The public url's address segment, assigned once and never again (see
    // itemSlug.ts). AFTER remergeItem deliberately: the insert above wrote the
    // SOURCE's title and the merge may have replaced it with a better one, and
    // the slug should be built from the title the page will show.
    ensureItemSlug(newId);
    return newId;
  });
}

// The projection stamp to store for a new link: current for a detail payload,
// 0 for a list payload so the first detail read refetches it. See SourceItem.thin.
function linkVersion(item: SourceItem): number {
  return item.thin ? 0 : PROJECTION_VERSION;
}

// Cross-reference ids this source item carries (used to tell apart two distinct
// works that share a title/year — e.g. two different "Dracula" movies).
export function extractCrossIds(source: Source, rawData: any): Record<string, string> {
  const ids: Record<string, string> = {};
  if (!rawData) return ids;
  switch (source) {
    case "trakt":
      if (rawData.ids?.trakt != null) ids.trakt = String(rawData.ids.trakt);
      if (rawData.ids?.tmdb != null) ids.tmdb = String(rawData.ids.tmdb);
      break;
    case "tmdb":
      if (rawData.id != null) ids.tmdb = String(rawData.id);
      break;
    case "letterboxd": {
      if (rawData.id != null) ids.letterboxd = String(rawData.id);
      const t = (rawData.links ?? []).find((l: any) => l.type === "tmdb");
      if (t?.id != null) ids.tmdb = String(t.id);
      break;
    }
    case "rawg":  if (rawData.id != null) ids.rawg = String(rawData.id); break;
    case "steam": if (rawData.appid != null) ids.steam = String(rawData.appid); break;
    case "igdb":  if (rawData.id != null) ids.igdb = String(rawData.id); break;
  }
  return ids;
}

function findMatchingItem(item: SourceItem): string | null {
  const normalized = normalizeName(item.title);
  const year = extractYear(item.releaseDate);
  const incomingIds = extractCrossIds(item.source, item.rawData);
  const incomingEntries = Object.entries(incomingIds); // [namespace, id]

  // 1. Definitive cross-id match (D5): any incoming (namespace, id) already mapped
  //    to a media_item of the same type → the same work, even across title spelling
  //    differences. Indexed lookup against media_external_ids, no JSON parsing.
  if (incomingEntries.length) {
    const ors = incomingEntries.map(() => "(e.source = ? AND e.external_id = ?)").join(" OR ");
    const params = [item.type, ...incomingEntries.flat()];
    const hit = query<{ media_item_id: string }>(
      `SELECT DISTINCT e.media_item_id
       FROM media_external_ids e JOIN media_items mi ON mi.id = e.media_item_id
       WHERE mi.type = ? AND (${ors})`,
      params
    );
    if (hit.length) return hit[0].media_item_id;
  }

  // 2. Title + year fallback among same type + norm_title candidates, EXCLUDING any
  //    candidate that carries a conflicting id (same namespace, different id) — that
  //    marks a different work sharing the title. Candidate ids come from the indexed
  //    media_external_ids table (no more parse-all-candidates).
  const candidates = query<{ id: string; release_date: string | null }>(
    "SELECT id, release_date FROM media_items WHERE type = ? AND norm_title = ?",
    [item.type, normalized]
  );

  let titleYearFallback: string | null = null;
  for (const c of candidates) {
    const candidateYear = extractYear(c.release_date);
    const yearOk = !(year && candidateYear && Math.abs(year - candidateYear) > 1);
    if (!yearOk) continue;

    if (incomingEntries.length) {
      const cIds = query<{ source: string; external_id: string }>(
        "SELECT source, external_id FROM media_external_ids WHERE media_item_id = ?",
        [c.id]
      );
      const cmap = new Map(cIds.map((r) => [r.source, r.external_id]));
      const conflict = incomingEntries.some(([ns, id]) => cmap.has(ns) && cmap.get(ns) !== id);
      if (conflict) continue;
    }
    if (!titleYearFallback) titleYearFallback = c.id;
  }
  return titleYearFallback;
}

// Attach a source link to a KNOWN media_item (no title re-matching). Used by the
// adapters' enrich() where we already know which item the link belongs to — this
// is what prevents a cross-enriched link (e.g. TMDB for a Trakt movie) from
// landing on a different item that merely shares the title.
export function linkSourceToItem(mediaItemId: string, item: SourceItem): string {
  return transaction(() => {
    const existing = get<{ media_item_id: string; raw_data: string }>(
      "SELECT media_item_id, raw_data FROM media_links WHERE source = ? AND source_id = ?",
      [item.source, item.sourceId]
    );
    if (existing) {
      run(
        "UPDATE media_links SET raw_data = ?, title = ?, release_date = ?, last_synced = strftime('%s','now'), projection_version = ? WHERE source = ? AND source_id = ?",
        // H2a: project AFTER merging, so the merge still sees the stored blob
        // (possibly a fat pre-projection one) and the result is stamped current.
        [JSON.stringify(projectRawData(item.source, mergeRawData(existing.raw_data, item.rawData))),
         item.title, item.releaseDate, PROJECTION_VERSION, item.source, item.sourceId]
      );
      remergeItem(existing.media_item_id);
      return existing.media_item_id;
    }
    run(
      `INSERT INTO media_links (id, media_item_id, source, source_id, title, release_date, raw_data, projection_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), mediaItemId, item.source, item.sourceId, item.title, item.releaseDate, JSON.stringify(projectRawData(item.source, item.rawData)), PROJECTION_VERSION]
    );
    remergeItem(mediaItemId);
    return mediaItemId;
  });
}

// Recompute canonical fields from all linked sources
function remergeItem(mediaItemId: string) {
  const links = query<{ source: string; raw_data: string }>(
    "SELECT source, raw_data FROM media_links WHERE media_item_id = ?",
    [mediaItemId]
  );
  if (links.length === 0) return;

  const parsed = links.map((l) => ({
    source: l.source as Source,
    data: JSON.parse(l.raw_data),
  }));

  const merged = mergeForCanonical(parsed);
  run(
    "UPDATE media_items SET title = ?, norm_title = ?, release_date = ?, poster_url = ?, updated_at = strftime('%s','now') WHERE id = ?",
    [merged.title, normalizeName(merged.title), merged.releaseDate, merged.posterUrl, mediaItemId]
  );

  // Rebuild the cross-id index (D5) for this item from all its links, so
  // findMatchingItem's indexed lookup always reflects the current links. Cheap
  // (a handful of links) and keeps the table consistent on every sync/enrich.
  run("DELETE FROM media_external_ids WHERE media_item_id = ?", [mediaItemId]);
  for (const l of parsed) {
    for (const [ns, id] of Object.entries(extractCrossIds(l.source, l.data))) {
      run(
        "INSERT OR IGNORE INTO media_external_ids (media_item_id, source, external_id) VALUES (?, ?, ?)",
        [mediaItemId, ns, id]
      );
    }
  }
}

// ── Per-source user state (D1 + D2): user_item_state is the truth ─────────────
// One normalized table holds wishlist + library state, one row per
// (user, item, source, relation). user_watchlist / user_library are VIEWS over
// it (migration 16), so every existing read path keeps working and the canonical
// rating cannot drift from the per-source data — not because something rebuilds
// it, but because there is nothing separate left to drift.

export interface LibraryFields {
  status?: string | null;     // watched | played | owned
  rating?: number | null;     // personal score on a 0-10 scale
  review?: string | null;
  reviewedAt?: number | null; // unix seconds
}

type Relation = "wishlist" | "library" | "ignored";

// Upsert one (user, item, source, relation) row. Provided fields are MERGED over
// the existing row (only keys you pass overwrite), so a partial update never wipes
// a sibling field — and an explicit null DOES clear (e.g. a removed rating).
function setSourceState(
  userId: string, mediaItemId: string, source: string, relation: Relation, fields: LibraryFields = {}
) {
  const existing = get<{
    id: string; status: string | null; rating: number | null; review: string | null; reviewed_at: number | null;
  }>(
    "SELECT id, status, rating, review, reviewed_at FROM user_item_state WHERE user_id = ? AND media_item_id = ? AND source = ? AND relation = ?",
    [userId, mediaItemId, source, relation]
  );
  const merged = {
    status: fields.status !== undefined ? fields.status : (existing?.status ?? null),
    rating: fields.rating !== undefined ? fields.rating : (existing?.rating ?? null),
    review: fields.review !== undefined ? fields.review : (existing?.review ?? null),
    reviewedAt: fields.reviewedAt !== undefined ? fields.reviewedAt : (existing?.reviewed_at ?? null),
  };
  if (existing) {
    run(
      "UPDATE user_item_state SET status = ?, rating = ?, review = ?, reviewed_at = ? WHERE id = ?",
      [merged.status, merged.rating, merged.review, merged.reviewedAt, existing.id]
    );
  } else {
    run(
      `INSERT INTO user_item_state (id, user_id, media_item_id, source, relation, status, rating, review, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), userId, mediaItemId, source, relation, merged.status, merged.rating, merged.review, merged.reviewedAt]
    );
  }
}

function clearSourceState(userId: string, mediaItemId: string, source: string, relation: Relation) {
  run(
    "DELETE FROM user_item_state WHERE user_id = ? AND media_item_id = ? AND source = ? AND relation = ?",
    [userId, mediaItemId, source, relation]
  );
}

// ── rebuildCaches is GONE (migration 16, 2026-08-17) ─────────────────────────
// It used to write a duplicate of user_item_state into user_watchlist and
// user_library after every mutation, deriving the canonical library rating
// (average of per-source ratings), reviewed_at (max) and status/review (from the
// most recently reviewed source) in TypeScript.
//
// Those two names are now VIEWS that compute exactly the same thing in SQL
// (src/lib/cacheViews.ts), so there is nothing left to keep in step: the writes
// below land in user_item_state and every reader sees the derived result on its
// next SELECT. Deleting this function is the point of the migration, not a
// side-effect of it — a cache you must remember to rebuild is a drift bug with a
// delay on it, and this one was audited on every boot for a year to prove it
// hadn't happened.
//
// The write helpers below are unchanged apart from losing their rebuild call.
// Do NOT reintroduce a write against user_watchlist / user_library: SQLite will
// reject it with "cannot modify … because it is a view".

// ── Public write helpers (signatures unchanged; now go through the truth table) ──

export function upsertWatchlistEntry(userId: string, mediaItemId: string, source: Source) {
  setSourceState(userId, mediaItemId, source, "wishlist");
}

export function removeWatchlistSource(userId: string, mediaItemId: string, source: Source) {
  clearSourceState(userId, mediaItemId, source, "wishlist");
}

// Remove an item from the wishlist entirely (clears every per-source wishlist
// row). Mirrors clearLibrary below — used by the "remove whole item" DELETE
// path so it can't bypass user_item_state the way a raw
// `DELETE FROM user_watchlist` would (that left the truth table with an
// orphaned row nothing ever cleaned up: found live 2026-07-19, one row, from
// exactly this shortcut in the old /api/watchlist DELETE handler).
export function clearWatchlist(userId: string, mediaItemId: string) {
  run("DELETE FROM user_item_state WHERE user_id = ? AND media_item_id = ? AND relation = 'wishlist'", [userId, mediaItemId]);
}

export function upsertLibraryEntry(userId: string, mediaItemId: string, source: Source, fields: LibraryFields = {}) {
  setSourceState(userId, mediaItemId, source, "library", fields);
}

export function removeLibrarySource(userId: string, mediaItemId: string, source: Source) {
  clearSourceState(userId, mediaItemId, source, "library");
}

// Fully unlink one source from a user (auth disconnect): clears every wishlist +
// library truth row that source holds across ALL the user's items. Other sources
// on the same items are untouched. Goes through removeWatchlistSource /
// removeLibrarySource rather than raw SQL for the same reason clearWatchlist
// does — and since migration 16 a raw write against user_watchlist/user_library
// is not merely wrong, it is rejected: they are views.
export function disconnectSource(userId: string, source: Source) {
  const wishlistItems = query<{ media_item_id: string }>(
    "SELECT DISTINCT media_item_id FROM user_item_state WHERE user_id = ? AND source = ? AND relation = 'wishlist'",
    [userId, source]
  ).map((r) => r.media_item_id);
  for (const mediaItemId of wishlistItems) removeWatchlistSource(userId, mediaItemId, source);

  const libraryItems = query<{ media_item_id: string }>(
    "SELECT DISTINCT media_item_id FROM user_item_state WHERE user_id = ? AND source = ? AND relation = 'library'",
    [userId, source]
  ).map((r) => r.media_item_id);
  for (const mediaItemId of libraryItems) removeLibrarySource(userId, mediaItemId, source);
}

// ── Ignored (T10 "For You" feed swipe-left) ───────────────────────
// One per-item ignored marker. Uses source 'local' so it's a single row per item.
// The wishlist/library views filter on relation, so an 'ignored' row is invisible
// to both by construction.
export function ignoreItem(userId: string, mediaItemId: string) {
  run(
    "INSERT OR IGNORE INTO user_item_state (id, user_id, media_item_id, source, relation) VALUES (?, ?, ?, 'local', 'ignored')",
    [randomUUID(), userId, mediaItemId]
  );
}

export function unignoreItem(userId: string, mediaItemId: string) {
  run("DELETE FROM user_item_state WHERE user_id = ? AND media_item_id = ? AND relation = 'ignored'", [userId, mediaItemId]);
}

// Remove an item from the library entirely (clears every per-source library row →
// drops status + rating). Used by the card "watched" toggle when turning it off.
export function clearLibrary(userId: string, mediaItemId: string) {
  run("DELETE FROM user_item_state WHERE user_id = ? AND media_item_id = ? AND relation = 'library'", [userId, mediaItemId]);
}

// Record a rating / status from the library route's write-back flow. `sources`
// are the platforms the rating was actually pushed to; empty → a "local" source
// holds it. rating === undefined: status-only update; rating === null: clear the
// rating across all the item's library sources (the fix for the old
// un-propagated "clear a rating" case). Returns the rebuilt canonical view.
export function recordLibraryRating(
  userId: string,
  mediaItemId: string,
  opts: { rating?: number | null; status?: string | null; sources: string[]; reviewedAt: number }
): { rating: number | null; metadata: Record<string, any> } {
  if (opts.rating === null) {
    run(
      "UPDATE user_item_state SET rating = NULL WHERE user_id = ? AND media_item_id = ? AND relation = 'library'",
      [userId, mediaItemId]
    );
  } else if (opts.rating !== undefined) {
    const targets = opts.sources.length ? opts.sources : ["local"];
    for (const s of targets) {
      setSourceState(userId, mediaItemId, s, "library", {
        rating: opts.rating,
        ...(opts.status != null ? { status: opts.status } : {}),
        reviewedAt: opts.reviewedAt,
      });
    }
  } else if (opts.status != null) {
    const existing = query<{ source: string }>(
      "SELECT source FROM user_item_state WHERE user_id = ? AND media_item_id = ? AND relation = 'library'",
      [userId, mediaItemId]
    ).map((r) => r.source);
    const targets = existing.length ? existing : ["local"];
    for (const s of targets) setSourceState(userId, mediaItemId, s, "library", { status: opts.status, reviewedAt: opts.reviewedAt });
  }
  const row = get<{ rating: number | null; metadata: string | null }>(
    "SELECT rating, metadata FROM user_library WHERE user_id = ? AND media_item_id = ?", [userId, mediaItemId]
  );
  return { rating: row?.rating ?? null, metadata: row?.metadata ? JSON.parse(row.metadata) : {} };
}
