// Everything a client is served about an item, computed once from its links.
//
// On Railway this was a cache in front of a derivation: `media_item_projection`
// held {facets, merged} and was rebuilt lazily on a read. Here it runs at WRITE
// time and the result is the stored row (`item_doc`), because a Worker request
// gets 10 ms of CPU and a read that has to parse provider blobs and merge them
// is exactly the work that budget cannot carry.
//
// Nothing below re-implements a rule. The merge, the facet extraction and the
// crowd-score maths are the site's own modules, imported, so an item reads the
// same in the app as it did on fandex.org.

import { mergeLinks, mergeForCanonical, extractYear } from "@/lib/merge";
import { extractFacets, type Facet } from "@/lib/facets";
import { representativeCommunity, averageCommunity } from "@/lib/ratings";
import { communityVotes } from "@/lib/ratingsSort";
import { DEFAULT_COUNTRY } from "@/lib/countries";
import type { EnrichedItem, MediaLink, MediaType, Source } from "@/types";

/**
 * Bump when the SHAPE of a stored doc changes (a field added to the vector, a
 * different merge rule). A doc stamped with an older number is corrected in
 * two ways: the item read re-merges it from the stored blobs on the way out
 * (catalog/read.ts), and the next write of the item re-derives and re-stamps it.
 * ⚠️ Nothing re-derives a stale row on a timer, so a bump that changes the
 * VECTOR or the facets reaches a device only as rows are refreshed.
 *
 * 2 (2026-10-10): a country's release date is its cinema date, not the earliest
 * of any kind. Only `merged.releaseDate` of a film moves.
 */
export const DERIVE_VERSION = 2;

/** One media_links row as the write path holds it: the blob already parsed. */
export interface ParsedLink {
  source: Source;
  sourceId: string;
  releaseDate: string | null;
  lastSynced: number;
  data: any;
}

/** The merged item without the provider blobs. Same shape facetCache stored. */
export type DerivedMerged = Omit<EnrichedItem, "id" | "type" | "platformSources" | "sources"> & {
  sources: { source: Source; sourceId: string }[];
};

/**
 * The scalar half of the site's DiscoveryVector. The facets travel beside it,
 * RAW: tag and franchise aliases are applied on the device from the taxonomy
 * tables, exactly as discovery.ts applied them at pool-build time. Baking them
 * in here would mean re-deriving the whole catalog whenever a tag is renamed.
 */
export interface ItemVector {
  id: string;
  type: MediaType;
  title: string;
  slug: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  releaseDate: string | null;
  year: number | null;
  communityScore: number | null;
  communityAvg: number | null;
  communityVotes: number;
  runtimeMinutes: number | null;
  addedAt: number;
  sources: { source: string; sourceId: string }[];
}

export interface DerivedItem {
  /** What media_items carries: the canonical title, date and poster. */
  canonical: { title: string; releaseDate: string | null; posterUrl: string | null };
  facets: Facet[];
  merged: DerivedMerged;
  /** Summed crowd votes, the site's "popularity". */
  voteCount: number;
  /** 0-10. NOT the 0-100 communityAvg; see itemStats.ts for why the divide matters. */
  voteAverage: number | null;
  /** Everything but id, slug and addedAt, which the caller owns. */
  vectorBase: Omit<ItemVector, "id" | "slug" | "addedAt">;
}

export function deriveItem(type: MediaType, links: ParsedLink[], region: string = DEFAULT_COUNTRY): DerivedItem {
  const mediaLinks: MediaLink[] = links.map((l) => ({
    id: "",
    mediaItemId: "",
    source: l.source,
    sourceId: l.sourceId,
    title: null,
    releaseDate: l.releaseDate,
    rawData: l.data ?? {},
    lastSynced: l.lastSynced,
  }));

  const full = mergeLinks(mediaLinks, type, region);
  const facets = extractFacets(mediaLinks, type, full);
  const merged: DerivedMerged = {
    ...full,
    sources: full.sources.map((s) => ({ source: s.source, sourceId: s.sourceId })),
  };

  // media_items holds the region-INDEPENDENT canonical fields, the same three
  // remergeItem wrote. `merged.releaseDate` may be a regional date; the row's is not.
  const canonical = mergeForCanonical(links.map((l) => ({ source: l.source, data: l.data ?? {} })));

  const avg100 = averageCommunity(merged.communityRatings);
  const releaseDate = canonical.releaseDate ?? merged.releaseDate;

  return {
    canonical,
    facets,
    merged,
    voteCount: communityVotes(merged.communityRatings),
    voteAverage: avg100 == null ? null : avg100 / 10,
    vectorBase: {
      type,
      title: canonical.title ?? merged.title,
      posterUrl: canonical.posterUrl ?? merged.posterUrl,
      backdropUrl: merged.backdropUrl,
      releaseDate,
      year: extractYear(releaseDate),
      communityScore: representativeCommunity(merged.communityRatings),
      communityAvg: avg100,
      communityVotes: communityVotes(merged.communityRatings),
      runtimeMinutes: merged.runtimeMinutes,
      sources: links.map((l) => ({ source: l.source, sourceId: l.sourceId })),
    },
  };
}

export function buildVector(
  d: DerivedItem,
  row: { id: string; slug: string | null; createdAt: number },
): ItemVector {
  return { id: row.id, slug: row.slug, addedAt: row.createdAt, ...d.vectorBase };
}
