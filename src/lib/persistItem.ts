import { upsertMediaItem } from "@/lib/matcher";
import { MediaType, Source } from "@/types";
import { METADATA } from "@/lib/metadata/registry";
import { MetaLink } from "@/lib/metadata/types";

export interface PersistItemInput {
  type: MediaType;
  title?: string | null;
  releaseDate?: string | null;
  posterUrl?: string | null;
  ids: Record<string, any>;
}

// Order in which provided ids are tried; the first that yields a link becomes the
// returned media_item_id (preserves the legacy precedence).
const ORDER: Source[] = ["rawg", "tmdb", "trakt", "steam", "letterboxd"];

// Minimal link for a source whose metadata fetch failed (every registered
// source now has a provider). Mirrors the original per-source rawData.
function minimalLink(source: Source, sourceId: string, input: PersistItemInput): MetaLink {
  const { title, releaseDate, posterUrl, ids } = input;
  const rawData =
    source === "letterboxd" ? { id: sourceId, name: title, releaseYear: releaseDate?.slice(0, 4) ? parseInt(releaseDate.slice(0, 4)) : null }
    : source === "steam"     ? { title, appid: sourceId, ids }
    : source === "trakt"     ? { title, year: releaseDate?.slice(0, 4), ids }
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

  for (const source of ORDER) {
    const rawId = ids[source];
    if (rawId == null) continue;

    let link: MetaLink | null = null;
    const provider = METADATA[source];
    if (provider?.fetchById) {
      try { link = await provider.fetchById(String(rawId), type); }
      catch (e) { console.error(`[persistItem] ${source} fetch failed:`, e); }
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
