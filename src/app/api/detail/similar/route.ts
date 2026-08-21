import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { log, errorFields } from "@/lib/logger";
import { getCatalogFacets, getCatalogIdf, itemsWithFacet, buildProfile, computeFandexScore } from "@/lib/discovery";
import { rankSimilar } from "@/lib/similarItems";
import { franchiseForItem } from "@/lib/franchise";
import { applyIpFacets } from "@/lib/ipAlias";
import { getDerivedForItem, type RawLink } from "@/lib/facetCache";
import { fetchTmdbSimilar, fetchIgdbSimilar, type FeedCandidate } from "@/lib/discoverFeed";
import { persistDiscoverBatch } from "@/lib/annotateDiscover";
import { getUserStateMap } from "@/lib/userState";
import { readFacetCache, writeFacetCache } from "@/lib/facetCacheStore";
import type { DiscoveryVector } from "@/lib/discovery";
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
  /** False = a top-up title with no local row, so `id` is a provider id. */
  linkable?: boolean;
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

/**
 * Attach the viewer's own rating / wishlist / library state to the rail.
 *
 * This rail shipped WITHOUT it, on the reasoning that catalog-wide
 * recommendations are not a list the viewer curated. That was wrong in the way
 * that matters: <ActionCells> reads `rating` / `onWatchlist` to decide whether
 * its two buttons render as indicators or as prompts, so a title the viewer
 * rated 9 showed a blank "Rate" button here while the same card on Home showed
 * the 9 (Nils, 2026-08-21). Rating from the rail then read as a fresh rating
 * rather than a change to an existing one.
 *
 * Two DB reads keyed on ids we already hold — no provider calls, so it costs
 * the crawl-facing side of this route nothing (an anonymous caller returns
 * before the queries). Only linkable rows are looked up: a top-up title we
 * have never persisted carries a PROVIDER id in `id`, not a uuid, and asking
 * user_library about it would be a guaranteed miss.
 */
function attachUserState<T extends { id: string; linkable?: boolean }>(items: T[], userId: string | null) {
  if (!userId || !items.length) return items;
  const state = getUserStateMap(userId, items.filter((i) => i.linkable !== false).map((i) => i.id));
  return items.map((it) => {
    const st = state.get(it.id);
    return {
      ...it,
      platformSources: st?.platformSources ?? [],
      onWatchlist: st?.onWatchlist ?? false,
      libraryStatus: st?.libraryStatus ?? null,
      rating: st?.rating ?? null,
    };
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
      if (rows.length === 0) return NextResponse.json({ franchise: null, items: [] });
      const rawLinks: RawLink[] = rows.map((r) => ({
        source: r.source as MediaLink["source"], sourceId: r.source_id,
        releaseDate: null, rawData: r.raw_data, lastSynced: r.last_synced ?? 0,
      }));
      // getCatalogFacets is already alias- and override-resolved (buildEntries
      // does it once per pool build); the facetCache path deliberately is NOT,
      // so a franchise lookup off it would miss every bundled spelling and every
      // hand-attached franchise. See the warning at the top of ipAlias.ts.
      facets = applyIpFacets(getDerivedForItem(id, rawLinks, type).facets, id);
    }
    if (!facets.length) return NextResponse.json({ franchise: null, items: [] });

    const idf = getCatalogIdf();

    // ── The franchise rail (2026-08-21) ─────────────────────────────────────
    // Nils: "now that we have franchise data, can we add another carousel
    // before the 'more like this' carousel that shows all entries of that
    // franchise from all media types?"
    //
    // It runs BEFORE the similar ranking because it CHANGES it: an ip facet is
    // rare, so it carries a high idf, so franchise siblings rank at the very
    // top of "More like this" — they would render twice on one page, once in
    // each rail, which reads as a bug. So they're dropped from the lower rail,
    // and rankSimilar is asked for enough extra candidates to absorb the drop.
    // That widening is free: its cost is the per-facet candidate SCAN, which is
    // already capped, not the final slice.
    //
    // Zero provider calls, deliberately. Everything here is an in-memory read
    // of the catalog pool that the Fandex Score already keeps warm, and the
    // item page is a public, crawlable surface — the one place a per-view
    // provider call turns into a burnt free tier (docs/scalability.md). Asking
    // TMDB for the rest of a collection would give a more complete rail; it is
    // not worth putting a quota-priced call on this path to get it.
    const franchise = franchiseForItem(id, facets, itemsWithFacet);
    const inFranchise = new Set(franchise?.items.map((v) => v.id) ?? []);
    const ranked = rankSimilar(id, facets, idf, itemsWithFacet, RAIL_CAP + inFranchise.size)
      .filter(({ vector }) => !inFranchise.has(vector.id))
      .slice(0, RAIL_CAP);

    // Fandex Score column: only when signed in. computeFandexScore already
    // returns null for a profile with no signal (cold start / no rated items),
    // so an anonymous or fresh-account viewer gets every item with
    // `fandexScore: null` rather than an error or a fabricated number.
    let userId: string | null = null;
    try { userId = (await getSession())?.userId ?? null; } catch { /* anon */ }
    const profile = userId ? buildProfile(userId) : null;

    // Every row carries the viewer's own rating / wishlist state — see
    // attachUserState() below.
    const toRow = (vector: DiscoveryVector): RailItem => {
      const fx = profile ? computeFandexScore(vector.facets, profile, undefined, { mediaItemId: vector.id }) : null;
      return {
        id: vector.id, type: vector.type, title: vector.title,
        posterUrl: vector.posterUrl, releaseDate: vector.releaseDate,
        communityScore: vector.communityScore, sources: vector.sources,
        fandexScore: fx?.score ?? null, fandexCenter: fx?.center ?? null,
      };
    };
    const items = ranked.map(({ vector }) => toRow(vector));
    const franchiseItems = franchise?.items.map(toRow) ?? [];

    // MB11 (2026-08-14) — top up from the provider when the local catalog can't
    // field a rail. See the block comment at the top of this file.
    // The top-up sees BOTH rails, so the provider can't re-offer a title the
    // franchise rail is already showing.
    const topped = items.length >= MIN_RAIL
      ? items
      : [...items, ...(await providerTopUp(id, type, [...franchiseItems, ...items], userId))];

    // ONE user-state pass over both rails — two queries, not four.
    const annotated = attachUserState([...franchiseItems, ...topped], userId);
    return NextResponse.json({
      franchise: franchise ? { label: franchise.label, items: annotated.slice(0, franchiseItems.length) } : null,
      items: annotated.slice(franchiseItems.length),
    });
  } catch (e: any) {
    log.error("similar_items_error", { ...errorFields(e) });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
