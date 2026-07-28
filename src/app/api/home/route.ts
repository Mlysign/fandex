import { NextResponse } from "next/server";
import { log, errorFields } from "@/lib/logger";
import { getSession } from "@/lib/session";
import { getUserCountry } from "@/lib/userCountry";
import { DEFAULT_COUNTRY } from "@/lib/countries";
import { get as dbGet } from "@/lib/db";

import { personalizedFeed, decorateSection } from "@/lib/liveDiscover";
import { persistDiscoverBatch, annotateUserState } from "@/lib/annotateDiscover";
import { fetchGamePage, fetchMoviePage, fetchShowPage } from "@/lib/discoverFeed";
import { getLibraryFacetAnalysis, pickBestGenre } from "@/lib/libraryAnalysis";

// H1.6e — Home's three rails (Popular / Upcoming / Fandex Recommendation) plus
// a signed-in stats strip. Reuses the exact discover-feed + persist/annotate
// machinery /api/discover already ships (same shapes, so PosterCard's quick
// actions work identically on Home) rather than inventing a parallel path.
//
// PR15's session-gated persist rule applies here too: Home is a public route,
// so an anonymous view must not mint media_items rows either.
// 2026-07-28: `persist`/`annotate` were a verbatim copy of /api/discover's
// pair; both now come from lib/annotateDiscover.ts. That also closed a real
// gap here — the local `persist` never took `userId`, so despite the comment
// above, an ANONYMOUS Home view did mint media_items rows. It no longer does.
const RAIL_SIZE = 15;
const MIN_TAG_COUNT = 3; // best-genre card: don't crown a tag seen on 1-2 items

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
      stats = {
        libraryTotal: a.libraryItemCount,
        wishlistTotal,
        ratedTotal: a.ratedItemCount,
        bestGenre: pickBestGenre(a.facets, MIN_TAG_COUNT),
      };
    }

    return NextResponse.json({
      popular: annotateUserState(persistDiscoverBatch(popular, userId), userId),
      upcoming: annotateUserState(persistDiscoverBatch(upcoming, userId), userId),
      recommendation: annotateUserState(persistDiscoverBatch(recommendation, userId), userId),
      stats,
    });
  } catch (e: any) {
    log.error("home_error", { ...errorFields(e) });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
