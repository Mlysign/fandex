// Client-side mirror of the /api/insights payload shapes. Kept free of any
// server imports so the insights components don't pull in better-sqlite3.

export interface FacetStat {
  kind: "tag" | "person" | "company";
  role?: string;
  key: string;
  label: string;
  category?: string;
  count: number;
  sum: number;
  avg: number;
}

export interface HistogramBucket { bucket: number; count: number }

// A rated library item, sent so the client can list which items sit behind a
// clicked rating-distribution bar or "taste by era" decade. Assignable to
// MediaCardItem, so it renders directly with PosterCard.
export interface InsightItem {
  id: string;
  type: string;
  title: string;
  posterUrl: string | null;
  releaseDate: string | null;
  rating: number;
  community: number | null;
  sources: { source: string; sourceId: string }[];
}

export interface DivergenceItem {
  id: string;
  title: string;
  type: string;
  posterUrl: string | null;
  userRating: number;
  community: number;
  delta: number;
  sources: { source: string; sourceId: string }[];
}

export interface DecadeStat { decade: number; count: number; avg: number }

export interface FacetDetailItem {
  id: string;
  type: string;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  platformSources: string[];
  onWatchlist: boolean;
  libraryStatus: string | null;
  rating: number | null;
  communityScore: number | null;
  sources: { source: string; sourceId: string }[];
}

export interface PersonMeta {
  name: string;
  biography: string | null;
  birthday: string | null;
  deathday: string | null;
  age: number | null;
  placeOfBirth: string | null;
  profileUrl: string | null;
  knownForDepartment: string | null;
  tmdbUrl: string;
}

export interface FacetDetailPayload {
  facet: { kind: string; role?: string; key: string; label: string };
  person: PersonMeta | null;
  scope: "filmography" | "sample" | "catalog";
  stats: {
    userAvg: number | null;
    userCount: number;
    totalCount: number;
    crowdCount: number;
    communityAvg: number | null;
    catalogCommunityAvg: number | null;
    baseline: number;
    delta: number | null;
  };
  items: FacetDetailItem[];
  shown: number;
}

export interface InsightsPayload {
  baseline: number;
  overview: {
    ratedTotal: number;
    libraryTotal: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
    meanRating: number | null;
  };
  histogram: HistogramBucket[];
  byTypeHistogram: Record<string, HistogramBucket[]>;
  facets: FacetStat[];
  items: InsightItem[];
  extra: {
    divergence: { overRated: DivergenceItem[]; underRated: DivergenceItem[] };
    byDecade: DecadeStat[];
  };
}
