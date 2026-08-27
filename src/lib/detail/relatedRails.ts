// The item page's two related rails, as a plain function over the catalog.
//
// WHY THIS EXISTS AS A MODULE (2026-08-23). Both rails used to live only inside
// `/api/detail/similar`, which `RelatedRails.tsx` calls from a `useEffect`. That
// works for a person and not at all for a crawler: measured on prod that day,
// `/movie/dune-part-two` server-rendered **39 internal links — 14 tags, 9
// people, navigation, and not one sibling title.** Every one of the 2,037 item
// pages was a crawl dead-end reachable only through the sitemap, so link equity
// entered the catalog and never moved between titles.
//
// Pulling the viewer-independent half out here lets the PAGE render it on the
// server (real `<a href>` in the first byte) while the route keeps serving the
// per-viewer half to the client island. One implementation, two callers.
//
// ⚠️ THE SPLIT IS DELIBERATE AND IT IS A COST DECISION, not tidiness.
// `buildLocalRails` makes **zero provider calls** — it is pure in-memory reads
// of the catalog pool the Fandex Score already keeps warm. The provider top-up
// (MB11) stays in the route, on the CLIENT path, precisely because the item page
// is crawlable: moving the top-up server-side would put a quota-priced call on
// the most-crawled page type in the catalog, which `docs/scalability.md` §4.2
// names as the single most expensive thing we could do. A crawler gets the
// local rails and nothing else; a person gets the top-up a moment later.
//
// ⚠️ AND SSR-ing THE TOP-UP WOULD NOT EVEN BUY LINKS, which is the part worth
// writing down because the cost argument alone sounds arguable. Measured
// 2026-08-23: 6 of 10 sampled item pages gained 3–14 sibling links from the
// local rails; the 4 that gained none are thin-catalog titles whose similar
// ranking falls under MIN_RAIL. Those are exactly the ones the top-up exists
// for — but the top-up runs `persistDiscoverBatch` with a NULL user on a public
// render, which by the PR15 write gate is read-only (`lookupExistingUuids`), so
// every provider title we do not already hold comes back `linkable: false` and
// renders WITHOUT an href. Server-rendering it would buy a provider call per
// cold item page and approximately zero new links. The 4 zeros are a small
// catalog, not a missing fetch.
//
// ⚠️ NOTHING HERE MAY READ THE SESSION. The page's server HTML is cached and
// viewer-independent by contract (see `[type]/[slug]/page.tsx`). `profile` is
// threaded in as an argument so the ROUTE can score rows for a signed-in
// caller, and the PAGE can pass null and stay cacheable. A `getSession()` call
// in this file would silently make every item page vary per viewer.

import { query } from "@/lib/db";
import {
  getCatalogFacets, getCatalogIdf, itemsWithFacet, computeFandexScore, scoringContext,
  type DiscoveryVector, type Profile,
} from "@/lib/discovery";
import { rankSimilar } from "@/lib/similarItems";
import { franchiseForItem, type FranchiseEntry } from "@/lib/franchise";
import { getFranchiseMembers } from "@/lib/franchiseMembers";
import { applyIpFacets, canonicalIpKey } from "@/lib/ipAlias";
import { getDerivedForItem, type RawLink } from "@/lib/facetCache";
import type { Facet } from "@/lib/facets";
import type { MediaLink, MediaType } from "@/types";

/** How many rows to keep. Matches what the rail can show without pagination. */
export const RAIL_CAP = 12;

/**
 * Below 3, a recommendation rail reads as a bug (an empty-feeling shelf) rather
 * than a deliberately sparse one. The franchise rail is held to a LOWER bar on
 * purpose: it is a complete index, not a suggestion, so "the one other Half-Life
 * game" is a true and useful answer where two loose recommendations are not.
 */
export const MIN_RAIL = 3;

export interface RailItem {
  id: string;
  type: string;
  title: string;
  /** The public url address segment; absent on a provider top-up row that has
   *  no local item yet, which is also non-linkable. */
  slug?: string | null;
  posterUrl: string | null;
  releaseDate: string | null;
  communityScore?: number | null;
  // Typed rather than `unknown` (which is what the route carried until this
  // moved here): PosterCard reads it through MediaCardItem, so `unknown` only
  // deferred the mismatch to a cast at the call site.
  sources?: { source: string; sourceId: string }[];
  fandexScore: number | null;
  fandexCenter: number | null;
  /** False = a top-up title with no local row, so `id` is a provider id. */
  linkable?: boolean;
  /** An explicit destination, overriding the id/slug derivation. Set only on a
   *  franchise member the catalog does not hold: it has no uuid and no slug, so
   *  `publicItemHref` would emit a url that hard-404s. Points at the /r
   *  resolver, which ingests on click. */
  href?: string;
}

export interface LocalRails {
  franchise: { label: string; items: RailItem[] } | null;
  items: RailItem[];
}

/**
 * Canonical, alias-resolved facets for one item.
 *
 * Pool members already have facets ready in the catalog cache. A title nobody
 * has interacted with yet (POOL_WHERE excludes a purely `browsed` row) is not
 * in that cache, so fall back to deriving them straight off its own
 * media_links — one item, cheap, and through the SAME shared cache
 * `facetCache.ts` added for /api/library, so a repeat view costs nothing.
 *
 * ⚠️ `getCatalogFacets` is already alias- and override-resolved (buildEntries
 * does it once per pool build); the facetCache path deliberately is NOT, so a
 * franchise lookup off it would miss every bundled spelling and every
 * hand-attached franchise. Hence the explicit `applyIpFacets` on that branch
 * only. See the warning at the top of ipAlias.ts.
 */
export function resolveItemFacets(id: string, type: MediaType): Facet[] {
  const cached = getCatalogFacets(id);
  if (cached) return cached;

  const rows = query<{ source: string; source_id: string; raw_data: string | null; last_synced: number | null }>(
    "SELECT source, source_id, raw_data, last_synced FROM media_links WHERE media_item_id = ?",
    [id]
  );
  if (rows.length === 0) return [];
  const rawLinks: RawLink[] = rows.map((r) => ({
    source: r.source as MediaLink["source"], sourceId: r.source_id,
    releaseDate: null, rawData: r.raw_data, lastSynced: r.last_synced ?? 0,
  }));
  return applyIpFacets(getDerivedForItem(id, rawLinks, type).facets, id);
}

/**
 * Both rails, from the local catalog only. Zero provider calls.
 *
 * `profile` null → every row scores `fandexScore: null`, which is exactly what
 * an anonymous viewer and the server render both want.
 */
export function buildLocalRails(
  id: string,
  type: MediaType,
  profile: Profile | null,
  facetsIn?: Facet[]
): LocalRails {
  const facets = facetsIn ?? resolveItemFacets(id, type);
  if (!facets.length) return { franchise: null, items: [] };

  const idf = getCatalogIdf();

  // The franchise rail runs BEFORE the similar ranking because it CHANGES it:
  // an ip facet is rare, so it carries a high idf, so franchise siblings rank
  // at the very top of "More like this" — they would render twice on one page,
  // once in each rail, which reads as a bug. So they are dropped from the lower
  // rail, and rankSimilar is asked for enough extra candidates to absorb the
  // drop. That widening is free: its cost is the per-facet candidate SCAN,
  // which is already capped, not the final slice.
  // `absentForFacet` is what makes the rail show a COMPLETE franchise rather
  // than the slice we happen to hold. Measured 2026-08-23: 167 of the catalog's
  // 249 TMDB collections held exactly one title. The rows come from the sweep
  // (/api/dev/franchise-sweep), so this is a local read — the rail still makes
  // zero provider calls, which is the property the whole design hangs on.
  //
  // Aliases resolve HERE, at read time: franchise_members stores the raw
  // ipKey(), because a canonical key persisted in a row goes stale the moment
  // somebody edits a bundle. See franchiseMembers.ts.
  const franchise = franchiseForItem(id, facets, itemsWithFacet, undefined, (f) =>
    getFranchiseMembers(canonicalIpKey(f.key)).map((m) => ({
      source: m.source, sourceId: m.sourceId, type: m.type, title: m.title,
      releaseDate: m.releaseDate, posterUrl: m.posterUrl, popularity: m.popularity,
    }))
  );
  const inFranchise = new Set(franchise?.items.map((v) => v.id) ?? []);
  const ranked = rankSimilar(id, facets, idf, itemsWithFacet, RAIL_CAP + inFranchise.size)
    .filter(({ vector }) => !inFranchise.has(vector.id))
    .slice(0, RAIL_CAP);

  const ctx = scoringContext();
  const toRow = (vector: DiscoveryVector): RailItem => {
    const fx = profile
      ? computeFandexScore(vector.facets, profile, undefined, { mediaItemId: vector.id, ctx })
      : null;
    return {
      id: vector.id, slug: vector.slug, type: vector.type, title: vector.title,
      posterUrl: vector.posterUrl, releaseDate: vector.releaseDate,
      communityScore: vector.communityScore, sources: vector.sources,
      fandexScore: fx?.score ?? null, fandexCenter: fx?.center ?? null,
    };
  };

  // A provider-only member has no catalog row, so it has no uuid, no slug and
  // no Fandex Score. It carries an explicit `href` to the /r resolver instead,
  // which ingests it on click and forwards to the real page — see
  // app/r/[source]/[type]/[id]/page.tsx for why that is a doorway rather than a
  // pre-ingest. `linkable` stays TRUE: the card genuinely goes somewhere.
  const entryToRow = (e: FranchiseEntry): RailItem =>
    e.kind === "held"
      ? toRow(e.vector)
      : {
          id: `${e.outsider.source}:${e.outsider.sourceId}`,
          type: e.outsider.type,
          title: e.outsider.title,
          slug: null,
          posterUrl: e.outsider.posterUrl,
          releaseDate: e.outsider.releaseDate,
          communityScore: null,
          sources: [{ source: e.outsider.source, sourceId: e.outsider.sourceId }],
          href: `/r/${e.outsider.source}/${e.outsider.type}/${e.outsider.sourceId}`,
          linkable: true,
          // Null rather than pending. `fandexPending` means "signed in and the
          // row is too thin to score honestly, so hydrate it" — but there is no
          // row to hydrate here, so the client hook would fire a request that
          // can never resolve. Null is the honest answer: no score is coming.
          fandexScore: null,
          fandexCenter: null,
        };

  return {
    franchise: franchise ? { label: franchise.label, items: franchise.entries.map(entryToRow) } : null,
    items: ranked.map(({ vector }) => toRow(vector)),
  };
}
