// Insights — turns the library facet analysis into the payload for the /insights
// page. The full (avg-sorted) facet array is passed straight through; the client
// slices it by kind/role/category, applies the min-count + search, and derives
// the top/bottom + volume-vs-quality views. Only item-level extras that need
// per-item data (overview, histograms, you-vs-crowd, by-era) are computed here.

import { getLibraryFacetAnalysis, FacetStat, RatedItem } from "@/lib/libraryAnalysis";

export interface HistogramBucket { bucket: number; count: number }

export interface DivergenceItem {
  id: string;
  title: string;
  type: string;
  posterUrl: string | null;
  userRating: number;   // 0-10
  community: number;     // 0-100
  delta: number;         // userRating*10 - community (positive = you rate higher)
  sources: { source: string; sourceId: string }[];
}

export interface DecadeStat { decade: number; count: number; avg: number }

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
  items: RatedItem[];   // every rated item — lets the client list a bar's contributors
  extra: {
    divergence: { overRated: DivergenceItem[]; underRated: DivergenceItem[] };
    byDecade: DecadeStat[];
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// Personal ratings are platform-averaged decimals — bucket to the nearest 0.5
// across a fixed 1..10 axis so the histogram x-axis is stable.
function histogram(values: number[], step = 0.5, lo = 1, hi = 10): HistogramBucket[] {
  const counts = new Map<number, number>();
  for (let b = lo; b <= hi + 1e-9; b = round2(b + step)) counts.set(round2(b), 0);
  for (const v of values) {
    const b = Math.min(hi, Math.max(lo, round2(Math.round(v / step) * step)));
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([bucket, count]) => ({ bucket, count }));
}
const round2 = (n: number) => Math.round(n * 100) / 100;

function year(date: string | null): number | null {
  if (!date) return null;
  const m = date.match(/^(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}

export function buildInsights(userId: string): InsightsPayload {
  const a = getLibraryFacetAnalysis(userId);

  // ── You vs the crowd ──
  const withCommunity = a.items.filter((i) => i.community != null) as (RatedItem & { community: number })[];
  const diverged = withCommunity.map((i) => ({
    id: i.id, title: i.title, type: i.type, posterUrl: i.posterUrl,
    userRating: i.rating, community: i.community, delta: round1(i.rating * 10 - i.community),
    sources: i.sources,
  }));
  const overRated = [...diverged].sort((x, y) => y.delta - x.delta).slice(0, 6);
  const underRated = [...diverged].sort((x, y) => x.delta - y.delta).slice(0, 6);

  // ── Taste by era ──
  const decadeMap = new Map<number, { count: number; sum: number }>();
  for (const i of a.items) {
    const y = year(i.releaseDate);
    if (y == null) continue;
    const d = Math.floor(y / 10) * 10;
    const acc = decadeMap.get(d) ?? { count: 0, sum: 0 };
    acc.count++; acc.sum += i.rating;
    decadeMap.set(d, acc);
  }
  const byDecade: DecadeStat[] = [...decadeMap.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([decade, { count, sum }]) => ({ decade, count, avg: round1(sum / count) }));

  // ── Per-type histograms ──
  const byTypeHistogram: Record<string, HistogramBucket[]> = {};
  for (const type of ["game", "movie", "show"]) {
    const vals = a.items.filter((i) => i.type === type).map((i) => i.rating);
    byTypeHistogram[type] = histogram(vals);
  }

  return {
    baseline: round1(a.baseline),
    overview: {
      ratedTotal: a.ratedItemCount,
      libraryTotal: a.libraryItemCount,
      byType: a.byType,
      byStatus: a.byStatus,
      meanRating: a.ratedItemCount ? round1(a.baseline) : null,
    },
    histogram: histogram(a.ratingValues),
    byTypeHistogram,
    facets: a.facets,
    items: a.items,
    extra: { divergence: { overRated, underRated }, byDecade },
  };
}
