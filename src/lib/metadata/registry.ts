import { MediaType, Source } from "@/types";
import { MetadataProvider } from "./types";
import { tmdbMetadata } from "./providers/tmdb";
import { rawgMetadata } from "./providers/rawg";
import { steamMetadata } from "./providers/steam";
import { letterboxdMetadata } from "./providers/letterboxd";
import { igdbMetadata } from "./providers/igdb";
import { traktMetadata } from "./providers/trakt";

// The metadata-source registry, parallel to SOURCES (the account registry).
// Includes TMDB, which is not a user account — that's exactly why this is a
// separate registry from MediaSource.
export const METADATA: Partial<Record<Source, MetadataProvider>> = {
  tmdb: tmdbMetadata,
  trakt: traktMetadata,
  rawg: rawgMetadata,
  steam: steamMetadata,
  letterboxd: letterboxdMetadata,
  igdb: igdbMetadata,
};

export function getMetadata(id: Source | string): MetadataProvider | undefined {
  return METADATA[id as Source];
}

export function metadataForType(type: MediaType | string): MetadataProvider[] {
  return Object.values(METADATA).filter(
    (p): p is MetadataProvider => !!p && p.mediaTypes.includes(type as MediaType)
  );
}
