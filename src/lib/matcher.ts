import { randomUUID } from "crypto";
import { query, run, get, transaction } from "./db";
import { normalizeName, extractYear, mergeForCanonical } from "./merge";
import { Source, MediaType } from "@/types";

interface SourceItem {
  source: Source;
  sourceId: string;
  type: MediaType;
  title: string;
  releaseDate: string | null;
  rawData: any;
}

// Find or create a media_item for the given source item
// Returns the media_item_id
export function upsertMediaItem(item: SourceItem): string {
  return transaction(() => {
    // 1. Check if this source already has a link
    const existing = get<{ media_item_id: string }>(
      "SELECT media_item_id FROM media_links WHERE source = ? AND source_id = ?",
      [item.source, item.sourceId]
    );
    if (existing) {
      // Update the raw data
      run(
        "UPDATE media_links SET raw_data = ?, title = ?, release_date = ?, last_synced = strftime('%s','now') WHERE source = ? AND source_id = ?",
        [JSON.stringify(item.rawData), item.title, item.releaseDate, item.source, item.sourceId]
      );
      // Refresh the canonical item
      remergeItem(existing.media_item_id);
      return existing.media_item_id;
    }

    // 2. Try to match an existing media_item by name + type + year proximity
    const mediaItemId = findMatchingItem(item);

    if (mediaItemId) {
      // Link this source to existing item
      run(
        `INSERT INTO media_links (id, media_item_id, source, source_id, title, release_date, raw_data)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), mediaItemId, item.source, item.sourceId, item.title, item.releaseDate, JSON.stringify(item.rawData)]
      );
      remergeItem(mediaItemId);
      return mediaItemId;
    }

    // 3. Create new canonical item
    const newId = randomUUID();
    run(
      `INSERT INTO media_items (id, type, title, release_date, poster_url)
       VALUES (?, ?, ?, ?, ?)`,
      [newId, item.type, item.title, item.releaseDate, null]
    );
    run(
      `INSERT INTO media_links (id, media_item_id, source, source_id, title, release_date, raw_data)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), newId, item.source, item.sourceId, item.title, item.releaseDate, JSON.stringify(item.rawData)]
    );
    remergeItem(newId);
    return newId;
  });
}

function findMatchingItem(item: SourceItem): string | null {
  const normalized = normalizeName(item.title);
  const year = extractYear(item.releaseDate);

  // Only match items of the same type
  const candidates = query<{ id: string; title: string; release_date: string | null }>(
    "SELECT id, title, release_date FROM media_items WHERE type = ?",
    [item.type]
  );

  for (const c of candidates) {
    const candidateNorm = normalizeName(c.title);
    if (candidateNorm !== normalized) continue;

    // Year must be compatible if both have dates
    const candidateYear = extractYear(c.release_date);
    if (year && candidateYear && Math.abs(year - candidateYear) > 1) continue;

    return c.id;
  }
  return null;
}

// Recompute the canonical fields of a media_item from all its links
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
    "UPDATE media_items SET title = ?, release_date = ?, poster_url = ?, updated_at = strftime('%s','now') WHERE id = ?",
    [merged.title, merged.releaseDate, merged.posterUrl, mediaItemId]
  );
}

// Upsert a watchlist entry for a user
export function upsertWatchlistEntry(userId: string, mediaItemId: string, source: Source) {
  const existing = get<{ id: string; platform_sources: string }>(
    "SELECT id, platform_sources FROM user_watchlist WHERE user_id = ? AND media_item_id = ?",
    [userId, mediaItemId]
  );

  if (existing) {
    const sources: Source[] = JSON.parse(existing.platform_sources);
    if (!sources.includes(source)) {
      sources.push(source);
      run(
        "UPDATE user_watchlist SET platform_sources = ? WHERE id = ?",
        [JSON.stringify(sources), existing.id]
      );
    }
  } else {
    run(
      `INSERT INTO user_watchlist (id, user_id, media_item_id, platform_sources)
       VALUES (?, ?, ?, ?)`,
      [randomUUID(), userId, mediaItemId, JSON.stringify([source])]
    );
  }
}

// Remove a source from a watchlist entry, delete if no sources left
export function removeWatchlistSource(userId: string, mediaItemId: string, source: Source) {
  const existing = get<{ id: string; platform_sources: string }>(
    "SELECT id, platform_sources FROM user_watchlist WHERE user_id = ? AND media_item_id = ?",
    [userId, mediaItemId]
  );
  if (!existing) return;

  const sources: Source[] = JSON.parse(existing.platform_sources).filter((s: Source) => s !== source);
  if (sources.length === 0) {
    run("DELETE FROM user_watchlist WHERE id = ?", [existing.id]);
  } else {
    run("UPDATE user_watchlist SET platform_sources = ? WHERE id = ?", [JSON.stringify(sources), existing.id]);
  }
}
