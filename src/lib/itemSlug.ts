// Assigning the public url's address segment. The pure half (slugCandidate /
// pickSlug) lives in publicUrl.ts, which has no DB import so the migration's
// backfill and the standalone runner can use it; this is the runtime half.

import { get, query, run } from "@/lib/db";
import { pickSlug } from "@/lib/publicUrl";

/**
 * Give an item its slug if it doesn't have one, and return it.
 *
 * Called once, right after a media_items row is created (matcher.ts), AFTER
 * remergeItem — the insert writes the source's title and the merge may replace
 * it with a better one, and the slug should be built from the title the page
 * will actually show.
 *
 * IMMUTABLE after that: an item that already has a slug keeps it, whatever
 * happens to its title later. A url that moves when a provider retitles a film
 * is a url nobody can share, and every move costs a redirect and a re-crawl.
 *
 * Idempotent, so it is safe to call on a path that may or may not have created
 * the row. Returns null only for an id that isn't there.
 */
export function ensureItemSlug(mediaItemId: string): string | null {
  const row = get<{ type: string; title: string; release_date: string | null; slug: string | null }>(
    "SELECT type, title, release_date, slug FROM media_items WHERE id = ?",
    [mediaItemId]
  );
  if (!row) return null;
  if (row.slug) return row.slug;

  // Excluding this row's own id matters: without it a retry after a partial
  // failure would see its own slug as taken and walk to the next candidate.
  const isTaken = (candidate: string) =>
    !!get<{ x: number }>(
      "SELECT 1 x FROM media_items WHERE type = ? AND slug = ? AND id <> ?",
      [row.type, candidate, mediaItemId]
    );

  // The year is the collision tie-break, so it is worth looking harder for one.
  // media_items.release_date is written by remergeItem from the MERGED links, and
  // a thin first write (a list payload with no date in the blob) leaves it null
  // while the link row itself has the date. Without this fallback the second
  // Nosferatu becomes `nosferatu-1` instead of `nosferatu-2024`.
  const date = row.release_date ?? get<{ d: string | null }>(
    "SELECT MIN(release_date) d FROM media_links WHERE media_item_id = ? AND release_date IS NOT NULL",
    [mediaItemId]
  )?.d ?? null;

  const slug = pickSlug(row.title, date, isTaken);
  run("UPDATE media_items SET slug = ? WHERE id = ?", [slug, mediaItemId]);
  return slug;
}

/**
 * id -> slug for a batch of items. One query.
 *
 * The live-provider paths (discover, home, the public facet pages) build their
 * items from a provider payload and only learn the local uuid afterwards, from
 * persistDiscoverItems/lookupExistingUuids. Without this they would link through
 * the legacy uuid url and eat a 308 on every card click.
 */
export function slugsForItemIds(ids: string[]): Map<string, string> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const ph = unique.map(() => "?").join(",");
  const rows = query<{ id: string; slug: string | null }>(
    `SELECT id, slug FROM media_items WHERE id IN (${ph})`,
    unique
  );
  const map = new Map<string, string>();
  for (const r of rows) if (r.slug) map.set(r.id, r.slug);
  return map;
}

/** The item a `/{type}/{slug}` url addresses, or null. */
export function findItemIdBySlug(type: string, slug: string): string | null {
  const row = get<{ id: string }>(
    "SELECT id FROM media_items WHERE type = ? AND slug = ?",
    [type, slug]
  );
  return row?.id ?? null;
}
