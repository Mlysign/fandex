import { MediaType, Source } from "@/types";

// ── MetadataProvider contract ─────────────────────────────────────────────────
//
// Parallel to MediaSource, but for CONTENT metadata rather than account state.
// A MediaSource models "this user's wishlist/library/ratings on a platform they
// logged into"; a MetadataProvider models "fetch this item's public metadata
// from a catalog by id or title". The two registries are deliberately separate:
// metadata sources include TMDB (and could include OMDB), which are not user
// accounts at all and have no wishlist/login.
//
// Used by: persistItemFromIds (create an item from ids), the /api/detail resolver
// (build + cross-enrich an item's links), and each MediaSource adapter's
// enrich() hook (cross-link to a sibling catalog).

// A normalized metadata link — everything needed to upsert a media_links row.
export interface MetaLink {
  source: Source;
  sourceId: string;
  title: string;
  releaseDate: string | null;
  rawData: any;
}

export interface MetadataProvider {
  id: Source;
  mediaTypes: MediaType[];
  // The canonical primary catalog for its types (TMDB). Primary providers are
  // fetched by id but never guessed by title during cross-enrichment.
  primary?: boolean;

  // Whether the provider has the credentials it needs (env keys). Providers
  // that silently no-op when unconfigured (IGDB) implement this so callers can
  // distinguish "not configured" from "no match found".
  configured?(): boolean;

  // Fetch full metadata for a known id. Null on miss.
  fetchById?(sourceId: string, type: MediaType): Promise<MetaLink | null>;
  // Find the best match for a title (exact normalized name, else first result).
  searchByTitle?(title: string, type: MediaType, opts?: { year?: number | null }): Promise<MetaLink | null>;
}
