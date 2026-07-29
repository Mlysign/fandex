// Client-side mirror of the Taste Match API shapes (kept free of server imports).

// BA/n (H5.2 §3.4): the facet's Bayesian average + rated-item count, only
// populated on Fandex Score reasons (not the older Discover match-score ones).
// T10 (2026-07-29): `impact` is the facet's canonical points value (same
// number wherever this tag appears — see discovery.ts's facetImpact()),
// distinct from `contribution` (what actually reached THIS item's score,
// forced to 0 when `capped`).
export interface Reason { kind: string; role?: string; label: string; category?: string; contribution: number; impact?: number | null; BA?: number; n?: number; capped?: boolean }

export interface DiscoverItem {
  id: string;
  type: string;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  communityScore: number | null;
  communityAvg: number | null;
  communityVotes: number;
  platformSources: string[];
  onWatchlist: boolean;
  libraryStatus: string | null;
  rating: number | null;
  sources: { source: string; sourceId: string }[];
  score: number;
  reasons: Reason[];
  fandexScore: number | null;
  fandexCenter: number | null;
  // PR15 (2026-07-22): absent/true means linkable, same convention as
  // MediaCardItem (cardItem.ts). false for an anonymous-viewer result that
  // wasn't persisted to a real row — id is a synthetic composite key
  // (`tmdb-movie-…`), not a uuid, so PosterCard/ListCard must not link it.
  linkable?: boolean;
}

export interface FacetPill { kind: string; role?: string; key: string; label: string }
export interface SeedPill { id: string; title: string; type: string; posterUrl: string | null }

export type Membership = "include" | "exclude" | "only";

// The three membership dimensions the advanced filters expose, each tri-state
// (Any = absent / Only / Hide). `rated` (A2, H1.6c) filters on whether the user
// has a personal rating — distinct from `library` (watched/played/owned).
export interface MembershipFilters { library?: Membership; wishlist?: Membership; rated?: Membership }
export type SortKey = "releaseDate" | "popularity" | "rating" | "fandexScore" | "addedAt";

// The single shared sort option set, used by Discover / Wishlist / Library AND
// mirrored on the facet pages. "Rating" is Bayesian-damped (see ratingsSort.ts);
// "Fandex Score" is personal (logged-in). Unified 2026-07-19.
export const SORTS: [SortKey, string][] = [
  ["releaseDate", "Release date"],
  ["popularity", "Popularity"],
  ["rating", "Rating"],
  ["fandexScore", "Fandex Score"],
];

// H1.6f — "Recently added" is deliberately NOT in the shared SORTS set: it
// sorts on when YOU added the item, which only exists for rows in your own
// library/wishlist. On Discover (a live provider feed) every item would tie at
// null, i.e. a visibly dead option. So it's offered only where the data is
// real, via a per-page option list — SubBar already takes `options` per page.
//
// It is also absent from the server side on purpose: `zSortKey` (schemas.ts)
// and discovery.ts's own SortKey stay at the original four, so the catalog
// `find()` endpoint can never be asked for a sort it has no column for.
// Library sorts client-side through sortItems(), so nothing is sent anywhere.
export const LIBRARY_SORTS: [SortKey, string][] = [["addedAt", "Recently added"], ...SORTS];

// Sorts whose result list is grouped/scrolled by date (calendar view allowed).
export const DATE_SORTS: SortKey[] = ["releaseDate"];

// Map any stored/legacy sort value to a valid SortKey. Old keys (releaseNew,
// platformRating, match, …) linger in sessionStorage across a deploy; anything
// unknown falls back to `fallback`.
export function normalizeSort(v: unknown, fallback: SortKey = "fandexScore"): SortKey {
  const valid: SortKey[] = ["releaseDate", "popularity", "rating", "fandexScore", "addedAt"];
  if (typeof v === "string" && (valid as string[]).includes(v)) return v as SortKey;
  const legacy: Record<string, SortKey> = {
    releaseNew: "releaseDate",
    releaseOld: "releaseDate",
    platformRating: "rating",
    userRating: "fandexScore",
    match: "fandexScore",
  };
  return (typeof v === "string" && legacy[v]) || fallback;
}

export interface FindResult {
  baseline: number;
  total: number;
  profileSummary: { topPositive: Reason[]; topNegative: Reason[] };
  items: DiscoverItem[];
}

export interface VocabMatch { kind: string; role?: string; key: string; label: string; count: number }
export interface TitleMatch { id: string; title: string; type: string; posterUrl: string | null; year: number | null }

// UI filter state. Ranges are stored as raw slider [lo, hi]; the request builder
// only sends a bound when the slider is off its extreme (so full-range never
// excludes items with a null year/community/runtime).
export interface UiFilters {
  types: string[];
  sources: string[];
  yearRange: [number, number];
  commRange: [number, number];
  runtimeRange: [number, number];
  membership: MembershipFilters;
  includeFacets: FacetPill[];
  excludeFacets: FacetPill[];
}

export const YEAR_MIN = 1950;
export const YEAR_MAX = 2027;
export const RUNTIME_MAX = 240;

export function defaultUiFilters(): UiFilters {
  return {
    types: [], sources: [],
    yearRange: [YEAR_MIN, YEAR_MAX], commRange: [0, 100], runtimeRange: [0, RUNTIME_MAX],
    membership: {}, includeFacets: [], excludeFacets: [],
  };
}

// How many of the ADVANCED filters (the ones behind SubBar's Filters trigger)
// are currently narrowing the list. Since 2026-07-28 that panel is collapsed on
// every viewport, so this badge is the only on-screen evidence that a year
// range or a facet is still in effect — without it a filtered list is
// indistinguishable from an unfiltered one. Deliberately excludes `types`,
// which has its own always-visible chip row.
export function countActiveAdvanced(f: Pick<UiFilters, "yearRange" | "membership" | "includeFacets" | "excludeFacets">): number {
  const yearNarrowed = f.yearRange[0] > YEAR_MIN || f.yearRange[1] < YEAR_MAX;
  const memberships = Object.values(f.membership ?? {}).filter(Boolean).length;
  return (yearNarrowed ? 1 : 0) + memberships + f.includeFacets.length + f.excludeFacets.length;
}
