import { Source, CommunityRating } from "@/types";

// Per-platform ratings live in user_library.metadata as { [source]: { rating, ... } }.
// The canonical user_library.rating is the AVERAGE across platforms.

export interface RatingBreakdown {
  source: Source;
  rating: number;
}

// Pull per-source ratings out of a user_library.metadata JSON blob.
export function parseRatings(metadataJson: string | null | undefined): RatingBreakdown[] {
  if (!metadataJson) return [];
  let meta: any;
  try { meta = JSON.parse(metadataJson); } catch { return []; }
  const out: RatingBreakdown[] = [];
  for (const [source, detail] of Object.entries(meta ?? {})) {
    const r = (detail as any)?.rating;
    if (typeof r === "number" && r > 0) out.push({ source: source as Source, rating: r });
  }
  return out;
}

// Average of rating values, rounded to one decimal. null when there are none.
export function averageRating(ratings: { rating: number }[]): number | null {
  if (!ratings.length) return null;
  const avg = ratings.reduce((a, b) => a + b.rating, 0) / ratings.length;
  return Math.round(avg * 10) / 10;
}

// Average straight from a metadata blob — used when upserting library rows.
export function averageFromMetadata(metadata: Record<string, any>): number | null {
  const vals = Object.values(metadata)
    .map((d: any) => d?.rating)
    .filter((r: any): r is number => typeof r === "number" && r > 0);
  return averageRating(vals.map((rating) => ({ rating })));
}

// Community scores arrive on heterogeneous scales (outOf 5/10/100). Pick one
// representative — by source priority (audience scores first, critics last) —
// and normalize it to 0-100 so it's comparable to a personal rating (×10).
// Used for the "you vs the crowd" insight and the community-rating filter.
const COMMUNITY_PRIORITY = ["tmdb", "trakt", "letterboxd", "rawg", "steam", "igdb", "metacritic", "igdb-critics"];
export function representativeCommunity(ratings: CommunityRating[] | undefined): number | null {
  if (!ratings?.length) return null;
  const byKey = new Map(ratings.map((r) => [r.source, r]));
  let chosen: CommunityRating | undefined;
  for (const s of COMMUNITY_PRIORITY) {
    const r = byKey.get(s);
    if (r) { chosen = r; break; }
  }
  chosen = chosen ?? ratings[0];
  if (!chosen.outOf) return null;
  return Math.round((chosen.score / chosen.outOf) * 100);
}

// AVERAGE across every database's score, each normalized to 0-100. Used for the
// "Platform rating" sort (T8) — a blended crowd score rather than one source.
export function averageCommunity(ratings: CommunityRating[] | undefined): number | null {
  if (!ratings?.length) return null;
  const vals = ratings.filter((r) => r.outOf).map((r) => (r.score / r.outOf!) * 100);
  if (!vals.length) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}
