// The single normalized item shape for the two ubiquitous media components:
// PosterCard (card view) and ListCard (list view). Every list/grid item across
// the app — library, wishlist, discover/Taste Match, facet detail — satisfies
// it (EnrichedItem and the discover/facet item shapes are all assignable).
export interface MediaCardItem {
  id: string;
  type: string;
  title: string;
  releaseDate: string | null;
  posterUrl: string | null;          // portrait box-art (card view)
  backdropUrl?: string | null;       // landscape art (list-row thumbnail); falls back to posterUrl
  platformSources?: string[];   // wishlist providers
  onWatchlist?: boolean;
  dates?: { source: string; date: string }[];
  rating?: number | null;        // personal score (0-10)
  ratings?: { source: string; rating: number }[]; // per-platform breakdown
  libraryStatus?: string | null; // watched | played | owned
  fandexScore?: number | null;   // H5.3 — personalized taste-match (0-100); null/absent → no badge
  // S11 (2026-07-27) — the score's center (baseline*10), so the badge can band
  // strong/typical/weak relative to THIS user rather than a fixed 70/50.
  fandexCenter?: number | null;
  // 2026-07-29 — "signed in, but this item's local row is still too thin to
  // score honestly". Distinct from `fandexScore: null` with this falsy, which
  // means no score is coming at all (anonymous viewer, cold start). The card
  // shows a pending badge and resolves it via usePendingFandexScore.
  fandexPending?: boolean;
  // Q14 (2026-07-19) — context-dependent fields: rendered wherever present, absent
  // on surfaces that don't carry them (no per-surface prop needed).
  communityScore?: number | null; // crowd/platform rating, 0-100 scale; null/absent → no badge
  roles?: string[];               // person-facet pages only: ["Director","Writer"] / ["Actor"]
  // An item that wasn't persisted to a real row has no resolvable item page and
  // no identity to act on — undefined/true means linkable. Was facet-pages-only
  // (rare persist failures); since PR15 (2026-07-22) also routine for /discover
  // results shown to an anonymous viewer, whose session-gated persist is
  // skipped entirely (see discover/route.ts).
  linkable?: boolean;
  // Identity for quick actions (rate / wishlist) without opening the detail page.
  sources?: { source: string; sourceId: string }[];
  ids?: Record<string, string | number>;
  /** The public url address segment (media_items.slug). Optional only because
   *  not every payload carries it yet: publicItemHref falls back to the legacy
   *  uuid url, which 308s. Thread it wherever a card is built. */
  slug?: string | null;
}
