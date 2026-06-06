export type MediaType = "game" | "movie" | "show";
export type Source = "steam" | "rawg" | "tmdb" | "trakt" | "igdb";

export interface MediaItem {
  id: string;
  type: MediaType;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface MediaLink {
  id: string;
  mediaItemId: string;
  source: Source;
  sourceId: string;
  title: string | null;
  releaseDate: string | null;
  rawData: Record<string, any>;
  lastSynced: number;
}

export interface UserIdentity {
  id: string;
  userId: string;
  provider: Source;
  providerUserId: string;
  displayName: string | null;
  avatarUrl: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: number | null;
  metadata: Record<string, any> | null;
}

export interface WatchlistEntry {
  id: string;
  userId: string;
  mediaItemId: string;
  platformSources: Source[];
  addedAt: number;
  notes: string | null;
}

// Enriched item returned to the client
export interface EnrichedItem {
  id: string;
  type: MediaType;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  platformSources: Source[];
  // Per-source dates
  dates: { source: Source; date: string }[];
  // From merge
  images: string[];
  tags: string[];
  platforms: string[];
  description: string | null;
  metacritic: number | null;
  steamReviewLabel: string | null;
  developer: string | null;
  publisher: string | null;
  trailerYoutubeKey: string | null;
  steamTrailerUrl: string | null;
  storeLinks: { name: string; url: string; source: Source }[];
  streamingProviders: { name: string; logoPath: string | null; providerId: number }[];
  links: { label: string; url: string }[];
  // Raw source data for the detail panel
  sources: { source: Source; sourceId: string; data: Record<string, any> }[];
}

export interface SessionUser {
  userId: string;
  identityId: string;
  provider: Source;
  displayName: string | null;
}
