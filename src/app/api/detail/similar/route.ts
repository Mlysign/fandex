import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { log, errorFields } from "@/lib/logger";
import { getCatalogFacets, getCatalogIdf, itemsWithFacet, buildProfile, computeFandexScore } from "@/lib/discovery";
import { rankSimilar } from "@/lib/similarItems";
import { getDerivedForItem, type RawLink } from "@/lib/facetCache";
import { fetchTmdbSimilar, fetchIgdbSimilar, type FeedCandidate } from "@/lib/discoverFeed";
import { persistDiscoverBatch } from "@/lib/annotateDiscover";
import { readFacetCache, writeFacetCache } from "@/lib/facetCacheStore";
import type { MediaLink, MediaType } from "@/types";

// "More like this" (2026-07-31, T6) — the item-detail mockup drew this rail and
// marked its logic explicitly out of scope. Cheap now: itemsWithFacet() +
// getCatalogIdf() are pure in-memory reads of the catalog cache that already
// exists for the Fandex Score. See lib/similarItems.ts for the ranking itself.
//
// PUBLIC route (no withUser) — the rail renders for anonymous viewers too,
// same as the rest of the item page; it just skips the Fandex Score column
// when there's no session. Read-only for an ANONYMOUS caller: no
// persistItemFromIds, no catalog writes, so a crawler hitting this can't mint
// media_items rows (the PR15 rule every public route here follows).
//
// ── MB11 (2026-08-14): the provider top-up ──────────────────────────────────
//
// Nils: "Odyssey does not have a 'more like this' section. Many movies don't.
// Every item should have this." The diagnosis was NOT what it looked like —
// this route returned real results for The Odyssey (Troy, Ulysses), and
// SimilarRail hides a rail under three items. So the local catalog was simply
// too thin, and no amount of better local ranking fixes a catalog that holds
// two comparable titles.
//
// The top-up therefore asks the PROVIDER, but only when the local ranking came
// up short, and behind a persisted cache. That order matters and it is a quota
// decision, not a latency one: this is a public surface, and the facet pages
// already taught us that an uncached provider call per cold view is what burns
// a free tier under a crawl sweep. A cache that survives a restart is the part
// that actually helps.
//
// Anonymous callers still write nothing: `persistDiscoverBatch` branches on the
// session and runs the read-only `lookupExistingUuids` for anon, exactly as
// SM38 established — so a provider title we already hold links normally, and a
// genuine first-sighting renders as a non-linkable preview rather than a dead
// link.
const MIN_RAIL = 3;
/** How many rows to keep. Matches what the rail can show without pagination. */
const RAIL_CAP = 12;
/** Provider lists for a fixed title change on the order of months, not hours. */
const TOPUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type RailItem = {
  id: string; type: string; title: string;
  posterUrl: string | null; releaseDate: string | null;
  communityScore?: number | null; sources?: unknown;
  fandexScore: number | null; fandexCenter: number | null;
};

/**
 * Ask the provider for its own "similar" list and shape it like the local rows.
 *
 * Cached on the ITEM, not the viewer: the provider's list is viewer-independent.
 * The per-viewer parts (uuid resolution and the Fandex Score) are applied AFTER
 * the cache read, so two users share one provider call without sharing a score.
 */
async function providerTopUp(
  itemId: string, type: MediaType, have: RailItem[], userId: string | null
): Promise<RailItem[]> {
  const links = query<{ source: string; source_id: string }>(
    "SELECT source, source_id FROM media_links WHERE media_item_id = ?",
    [itemId]
  );
  const bySource = new Map(links.map((l) => [l.source, l.source_id]));

  const cacheKey = `similar:v1:${itemId}`;
  let candidates: FeedCandidate[] | null = null;
  const cached = readFacetCache(cacheKey, TOPUP_TTL_MS);
  if (cached) {
    try { candidates = JSON.parse(cached) as FeedCandidate[]; } catch { candidates = null; }
  }

  if (!candidates) {
    if (type === "game") {
      const igdbId = bySource.get("igdb");
      candidates = igdbId ? await fetchIgdbSimilar(Number(igdbId)) : [];
    } else {
      const tmdbId = bySource.get("tmdb");
      candidates = tmdbId ? await fetchTmdbSimilar(type === "movie" ? "movie" : "show", Number(tmdbId)) : [];
    }
    // Cache even an empty result: an item with no provider id, or a provider
    // that genuinely knows nothing similar, must not re-ask on every view.
    writeFacetCache(cacheKey, JSON.stringify(candidates));
  }
  if (!candidates.length) return [];

  // Never re-offer a title the local ranking already placed, and never the item
  // itself — the provider has no idea what we already showed.
  const seenTitles = new Set(have.map((i) => i.title.toLowerCase()));
  const fresh = candidates.filter((c) => c.title && !seenTitles.has(c.title.toLowerCase()));
  if (!fresh.length) return [];

  const resolved = persistDiscoverBatch(fresh.slice(0, RAIL_CAP - have.length), userId);
  const profile = userId ? buildProfile(userId) : null;

  return resolved.map((c: any): RailItem => {
    // A resolved uuid means we hold the item, so it can be scored against the
    // viewer's profile the same way a local row is. An unresolved one can't be
    // — it has no facets here yet — and gets a null score rather than a guess.
    const isLocal = c.linkable !== false;
    const fx = isLocal && profile
      ? computeFandexScore(getCatalogFacets(c.id) ?? [], profile, undefined, { mediaItemId: c.id })
      : null;
    return {
      id: c.id, type: c.type, title: c.title,
      posterUrl: c.posterUrl ?? null, releaseDate: c.releaseDate ?? null,
      communityScore: c.voteAverage ?? null,
      sources: c.ids ? Object.entries(c.ids).map(([source, sourceId]) => ({ source, sourceId: String(sourceId) })) : [],
      linkable: c.linkable,
      fandexScore: fx?.score ?? null, fandexCenter: fx?.center ?? null,
    } as RailItem;
  });
}

export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    const type = req.nextUrl.searchParams.get("type") as MediaType | null;
    if (!id || !type) return NextResponse.json({ error: "id and type required" }, { status: 400 });

    // Pool members (most rated/wishlisted/library items, plus anything anyone
    // browsed into the pool) already have facets ready in the catalog cache.
    // A title nobody has interacted with yet (POOL_WHERE excludes a purely
    // `browsed` row — see discovery.ts) isn't in that cache, so fall back to
    // deriving its facets fresh, straight off its own media_links — one item,
    // cheap, and it goes through the SAME shared cache facetCache.ts added for
    // /api/library (2026-07-31), so this costs nothing extra on a repeat view.
    let facets = getCatalogFacets(id);
    if (!facets) {
      const rows = query<{ source: string; source_id: string; raw_data: string | null; last_synced: number | null }>(
        "SELECT source, source_id, raw_data, last_synced FROM media_links WHERE media_item_id = ?",
        [id]
      );
      if (rows.length === 0) return NextResponse.json({ items: [] });
      const rawLinks: RawLink[] = rows.map((r) => ({
        source: r.source as MediaLink["source"], sourceId: r.source_id,
        releaseDate: null, rawData: r.raw_data, lastSynced: r.last_synced ?? 0,
      }));
      facets = getDerivedForItem(id, rawLinks, type).facets;
    }
    if (!facets.length) return NextResponse.json({ items: [] });

    const idf = getCatalogIdf();
    const ranked = rankSimilar(id, facets, idf, itemsWithFacet);

    // Fandex Score column: only when signed in. computeFandexScore already
    // returns null for a profile with no signal (cold start / no rated items),
    // so an anonymous or fresh-account viewer gets every item with
    // `fandexScore: null` rather than an error or a fabricated number.
    let userId: string | null = null;
    try { userId = (await getSession())?.userId ?? null; } catch { /* anon */ }
    const profile = userId ? buildProfile(userId) : null;

    // Deliberately NOT annotated with the viewer's own wishlist/rating state
    // (unlike Home's rails) — these are catalog-wide recommendations, not a
    // list the viewer already curated, and the rail stays a read-only "you
    // might also like" strip. Quick actions (rate/wishlist) still work from
    // here — `sources` carries real provider ids for identity resolution.
    const items = ranked.map(({ vector }) => {
      const fx = profile ? computeFandexScore(vector.facets, profile, undefined, { mediaItemId: vector.id }) : null;
      return {
        id: vector.id, type: vector.type, title: vector.title,
        posterUrl: vector.posterUrl, releaseDate: vector.releaseDate,
        communityScore: vector.communityScore, sources: vector.sources,
        fandexScore: fx?.score ?? null, fandexCenter: fx?.center ?? null,
      };
    });

    // MB11 (2026-08-14) — top up from the provider when the local catalog can't
    // field a rail. See the block comment at the top of this file.
    const topped = items.length >= MIN_RAIL
      ? items
      : [...items, ...(await providerTopUp(id, type, items, userId))];

    return NextResponse.json({ items: topped });
  } catch (e: any) {
    log.error("similar_items_error", { ...errorFields(e) });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
