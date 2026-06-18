import { MediaType, Source } from "@/types";
import { MediaSource } from "./types";
import { HIDDEN_PROVIDERS } from "./catalog";
import { rawgSource } from "./adapters/rawg";
import { traktSource } from "./adapters/trakt";
import { letterboxdSource } from "./adapters/letterboxd";
import { steamSource } from "./adapters/steam";
import { tmdbSource } from "./adapters/tmdb";

// The single registry every consumer derives from. All four connectable
// platforms are registered; their capabilities + auth + write paths are driven
// through this map instead of per-provider `if` branches. (Bulk pull/enrichment
// sync is still migrating — see each adapter's NOTE.)
export const SOURCES: Partial<Record<Source, MediaSource>> = {
  trakt: traktSource,
  letterboxd: letterboxdSource,
  steam: steamSource,
  rawg: rawgSource,
  tmdb: tmdbSource,
};

export function getSource(id: Source | string): MediaSource | undefined {
  return SOURCES[id as Source];
}

// All registered sources that handle a given media type — the single source of
// truth for "which platforms can hold a wishlist for a movie/show/game".
export function sourcesForType(type: MediaType | string): MediaSource[] {
  return Object.values(SOURCES).filter(
    (s): s is MediaSource => !!s && s.mediaTypes.includes(type as MediaType) && !HIDDEN_PROVIDERS.has(s.id)
  );
}
