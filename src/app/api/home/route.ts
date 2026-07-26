import { NextResponse } from "next/server";
import { log, errorFields } from "@/lib/logger";
import { getSession } from "@/lib/session";
import { getUserStateMap, resolveMediaIdsBySource } from "@/lib/userState";
import { getUserCountry } from "@/lib/userCountry";
import { DEFAULT_COUNTRY } from "@/lib/countries";
import { get as dbGet } from "@/lib/db";

import { personalizedFeed, decorateSection } from "@/lib/liveDiscover";
import { persistDiscoverItems } from "@/lib/discoverPersist";
import { fetchGamePage, fetchMoviePage, fetchShowPage } from "@/lib/discoverFeed";
import { getLibraryFacetAnalysis } from "@/lib/libraryAnalysis";

// H1.6e — Home's three rails (Popular / Upcoming / Fandex Recommendation) plus
// a signed-in stats strip. Reuses the exact discover-feed + persist/annotate
// machinery /api/discover already ships (same shapes, so PosterCard's quick
// actions work identically on Home) rather than inventing a parallel path.
//
// PR15's session-gated persist rule applies here too: Home is a public route,
// so an anonymous view must not mint media_items rows either.
const RAIL_SIZE = 15;
const MIN_TAG_COUNT = 3; // best-genre card: don't crown a tag seen on 1-2 items

function persist(items: any[]) {
  const idMap = items.length ? persistDiscoverItems(items) : new Map<string, string>();
  return items.map(({ raw, ...it }) => {
    const uuid = idMap.get(it.id);
    return uuid ? { ...it, id: uuid } : { ...it, linkable: false };
  });
}

function annotate(items: any[], userId: string | null) {
  if (!userId) return items.map((it) => ({ ...it, platformSources: [], onWatchlist: false, libraryStatus: null, rating: null }));

  const pairs: { source: string; sourceId: string }[] = [];
  for (const it of items) {
    for (const [source, sid] of Object.entries(it.ids ?? {})) {
      if (sid != null) pairs.push({ source, sourceId: String(sid) });
    }
  }
  const idMap = resolveMediaIdsBySource(pairs);
  const stateMap = getUserStateMap(userId, [...new Set(idMap.values())]);

  return items.map((it) => {
    let mediaItemId: string | undefined;
    for (const [source, sid] of Object.entries(it.ids ?? {})) {
      if (sid == null) continue;
      const mid = idMap.get(`${source}:${sid}`);
      if (mid) { mediaItemId = mid; break; }
    }
    const st = mediaItemId ? stateMap.get(mediaItemId) : undefined;
    return {
      ...it,
      platformSources: st?.platformSources ?? [],
      onWatchlist: st?.onWatchlist ?? false,
      libraryStatus: st?.libraryStatus ?? null,
      rating: st?.rating ?? null,
    };
  });
}

export async function GET() {
  try {
    let userId: string | null = null;
    try { userId = (await getSession())?.userId ?? null; } catch { /* anon */ }
    const region = userId ? getUserCountry(userId) : DEFAULT_COUNTRY;

    const [games, movies, shows] = await Promise.all([
      fetchGamePage(1, "future"),
      fetchMoviePage(1, "future", region),
      fetchShowPage(1, "future"),
    ]);
    const pool = decorateSection([...games, ...movies, ...shows], userId);

    const popular = [...pool]
      .sort((a, b) => (b.communityScore ?? -1) - (a.communityScore ?? -1) || b.communityVotes - a.communityVotes)
      .slice(0, RAIL_SIZE);

    const today = new Date().toISOString().slice(0, 10);
    const upcoming = pool
      .filter((it) => it.releaseDate && it.releaseDate >= today)
      .sort((a, b) => a.releaseDate!.localeCompare(b.releaseDate!))
      .slice(0, RAIL_SIZE);

    let recommendation: any[] = [];
    if (userId) {
      const personalized = await personalizedFeed(userId, region);
      if (personalized) recommendation = [...personalized].sort((a, b) => b.score - a.score).slice(0, RAIL_SIZE);
    }

    let stats: {
      libraryTotal: number; wishlistTotal: number; ratedTotal: number;
      bestGenre: { label: string; ba: number } | null;
    } | null = null;
    if (userId) {
      const a = getLibraryFacetAnalysis(userId);
      const wishlistTotal = dbGet<{ n: number }>(
        "SELECT COUNT(*) n FROM user_watchlist WHERE user_id = ?", [userId]
      )?.n ?? 0;
      const bestTag = a.facets
        .filter((f) => f.kind === "tag" && f.count >= MIN_TAG_COUNT)
        .sort((x, y) => y.ba - x.ba)[0] ?? null;
      stats = {
        libraryTotal: a.libraryItemCount,
        wishlistTotal,
        ratedTotal: a.ratedItemCount,
        bestGenre: bestTag ? { label: bestTag.label, ba: Math.round(bestTag.ba * 10) / 10 } : null,
      };
    }

    return NextResponse.json({
      popular: annotate(persist(popular), userId),
      upcoming: annotate(persist(upcoming), userId),
      recommendation: annotate(persist(recommendation), userId),
      stats,
    });
  } catch (e: any) {
    log.error("home_error", { ...errorFields(e) });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
