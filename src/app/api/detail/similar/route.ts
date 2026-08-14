import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { log, errorFields } from "@/lib/logger";
import { getCatalogFacets, getCatalogIdf, itemsWithFacet, buildProfile, computeFandexScore } from "@/lib/discovery";
import { rankSimilar } from "@/lib/similarItems";
import { getDerivedForItem, type RawLink } from "@/lib/facetCache";
import type { MediaLink, MediaType } from "@/types";

// "More like this" (2026-07-31, T6) — the item-detail mockup drew this rail and
// marked its logic explicitly out of scope. Cheap now: itemsWithFacet() +
// getCatalogIdf() are pure in-memory reads of the catalog cache that already
// exists for the Fandex Score. See lib/similarItems.ts for the ranking itself.
//
// PUBLIC route (no withUser) — the rail renders for anonymous viewers too,
// same as the rest of the item page; it just skips the Fandex Score column
// when there's no session. Read-only: no persistItemFromIds, no catalog
// writes, so an anonymous crawler hitting this can't mint media_items rows
// (the PR15 rule every public route here follows).
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

    return NextResponse.json({ items });
  } catch (e: any) {
    log.error("similar_items_error", { ...errorFields(e) });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
