import { upsertMediaItem } from "@/lib/matcher";
import { log, errorFields } from "@/lib/logger";
import type { MediaType, Source } from "@/types";
import { METADATA } from "@/lib/metadata/registry";
import type { MetaLink } from "@/lib/metadata/types";

export interface PersistItemInput {
  type: MediaType;
  title?: string | null;
  releaseDate?: string | null;
  posterUrl?: string | null;
  ids: Record<string, any>;
}

// Order in which provided ids are tried; the first that yields a link becomes the
// returned media_item_id (preserves the legacy precedence).
//
// ⚠️ Every source that can appear in a card's `ids` must be listed here. An id
// this list does not name is silently skipped, and if it was the ONLY id the
// card carried, the whole function returns null, which both callers answer as
// `400 Could not resolve item`, i.e. "Couldn't save your rating".
//
// `igdb` was missing from day one and cost nothing until RAWG was retired
// (2026-09-02). Games are IGDB-only now, so 310 of the 1,347 games in the
// catalog carry an igdb id and nothing else: rating one, or wishlisting it, 400'd.
// It sits where RAWG used to for games, ahead of `steam`, because IGDB is the
// game catalog and Steam is a store with a partial one. RAWG keeps its legacy
// first slot for the 741 items that still hold a rawg id.
//
// Exported so `persistItemSources.test.ts` can hold it to the full `Source`
// union. tsc cannot: `Source[]` is happy with a list that names two of six.
export const ID_ORDER: Source[] = ["rawg", "igdb", "tmdb", "trakt", "steam", "letterboxd"];

// Minimal link for a source whose metadata fetch failed (every registered
// source now has a provider). Mirrors the original per-source rawData.
function minimalLink(source: Source, sourceId: string, input: PersistItemInput): MetaLink {
  const { title, releaseDate, posterUrl, ids } = input;
  const rawData =
    source === "letterboxd" ? { id: sourceId, name: title, releaseYear: releaseDate?.slice(0, 4) ? parseInt(releaseDate.slice(0, 4)) : null }
    : source === "steam"     ? { title, appid: sourceId, ids }
    : source === "trakt"     ? { title, year: releaseDate?.slice(0, 4), ids }
    // IGDB's own payload keys, so the stub is readable by the code that reads a
    // real one: extractCrossIds takes `id` (which is how the cross-id match
    // finds the existing item rather than creating a duplicate), merge.ts takes
    // `name`. Only reached when IGDB is unreachable or kill-switched off; a
    // stored fat payload survives it either way (matcher.ts mergeRawData).
    : source === "igdb"      ? { id: Number(sourceId) || sourceId, name: title }
    : { title, releaseDate, posterUrl, ids };
  return { source, sourceId, title: title ?? "", releaseDate: releaseDate ?? null, rawData };
}

// Fetch + store the canonical media_item for an item identified by its source ids
// (a movie/show/game from discover or search, not yet in the DB). Metadata fetch
// is delegated to the MetadataProvider registry; sources without a provider fall
// back to a minimal stored link. Returns the media_item_id, or null.
export async function persistItemFromIds(input: PersistItemInput): Promise<string | null> {
  const { type, ids } = input;
  let mediaItemId: string | null = null;

  for (const source of ID_ORDER) {
    const rawId = ids[source];
    if (rawId == null) continue;

    let link: MetaLink | null = null;
    const provider = METADATA[source];
    if (provider?.fetchById) {
      try { link = await provider.fetchById(String(rawId), type); }
      catch (e) { log.error("persist_item_fetch_failed", { source, ...errorFields(e) }); }
    }
    if (!link) link = minimalLink(source, String(rawId), input);

    const id = upsertMediaItem({
      source: link.source,
      sourceId: link.sourceId,
      type,
      title: link.title || (input.title ?? ""),
      releaseDate: link.releaseDate ?? input.releaseDate ?? null,
      rawData: link.rawData,
    });
    if (!mediaItemId) mediaItemId = id;
  }

  return mediaItemId;
}
