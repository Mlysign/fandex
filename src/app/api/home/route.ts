import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { log, errorFields } from "@/lib/logger";
import { getSession } from "@/lib/session";
import { getUserCountry } from "@/lib/userCountry";
import { DEFAULT_COUNTRY } from "@/lib/countries";
import { get as dbGet } from "@/lib/db";
import { resolveMediaIdsBySource } from "@/lib/userState";
import { BoundedCache } from "@/lib/boundedCache";

import { personalizedFeed, decorateSection } from "@/lib/liveDiscover";
import { persistDiscoverBatch, annotateUserState } from "@/lib/annotateDiscover";
import type { FeedCandidate } from "@/lib/discoverFeed";
import {
  fetchTmdbTrending, fetchTraktTrending, fetchTrendingGames,
} from "@/lib/discoverFeed";
import { candidatesForMonth, monthKey, nextMonthKey } from "@/lib/popularMonthFeed";
import { rankCrossSourcePopularity } from "@/lib/popularMonth";
import { upcomingFrom } from "@/lib/upcoming";
import { dayISO, seedFor, rotateRail } from "@/lib/dailyRotation";
import { getLibraryFacetAnalysis } from "@/lib/libraryAnalysis";
import { buildHighlights } from "@/lib/homeHighlights";

// Home's three rails + the signed-in stats strip. Reuses the exact discover-feed
// + persist/annotate machinery /api/discover already ships (same shapes, so
// PosterCard's quick actions work identically on Home) rather than inventing a
// parallel path.
//
// PR15's session-gated persist rule applies here too: Home is a public route, so
// an anonymous view must not mint media_items rows either.
// 2026-07-28: `persist`/`annotate` were a verbatim copy of /api/discover's pair;
// both now come from lib/annotateDiscover.ts. That also closed a real gap here —
// the local `persist` never took `userId`, so despite the comment above, an
// ANONYMOUS Home view did mint media_items rows. It no longer does.
//
// ── 2026-07-30 REWRITE: the rails now do what their labels say ──────────────
// Nils: "the popular carousels feel like they show the same items every day and
// it does not match what I am seeing on TMDB under trends or Trakt under
// trending". Both halves were true, and for one root cause — all three rails
// were built from ONE page-1 pull of the providers' 18-month FUTURE window:
//
//   • popular  sorted that upcoming pool by community vote AVERAGE, making it
//     "best-rated unreleased titles". Trending is a released-title,
//     watch-activity ranking, so it could never agree with TMDB or Trakt.
//   • upcoming re-used the same page-1 pool and date-sorted it, so it had none
//     of the cross-source normalisation the calendar spent a whole batch on.
//   • all three took a fixed prefix of a fixed sort → identical every day.
//
// So: `trending` comes from the providers' real trending endpoints (TMDB
// /trending, Trakt /trending, RAWG recent-most-added); `upcoming` calls the
// calendar's own candidatesForMonth; and every rail is drawn from a DEEPER
// ranked pool via a day-seeded rotation instead of a prefix (lib/dailyRotation).
const RAIL_SIZE = 15;
/** Rank this deep, show RAIL_SIZE of it — the room the rotation draws from. */
const POOL_DEPTH = 45;

// Public rails are viewer-independent, so they cache. Home is the one PUBLIC
// route that hits providers: before this it fired 3 upstream calls on every
// anonymous view and every crawler hit. Keyed by region + day (the rotation is
// per-day, so a stale entry can't leak yesterday's pick into today).
const PUBLIC_TTL_MS = 30 * 60 * 1000;
const _publicCache = new BoundedCache<string, { trending: FeedCandidate[]; upcoming: FeedCandidate[] }>({
  max: 40, ttlMs: PUBLIC_TTL_MS,
});

/**
 * Identity dedupe, run BEFORE the cross-source ranking.
 *
 * rankCrossSourcePopularity dedupes on `type|normalizeName(title)|releaseDate`,
 * which is right for RAWG-vs-IGDB (independent ids, same game) but fails for
 * TMDB-vs-Trakt: both key by the same tmdb id, yet Trakt's `released` and TMDB's
 * `release_date` can differ by a day — and then the title+date key doesn't match
 * and the rail shows the title twice. (Observed on the first live run: Supergirl
 * at 2026-06-26 and 2026-06-24.) Same `id` is the stronger signal, so use it
 * first and let the title+date pass handle the rest.
 *
 * First wins, so pass TMDB before Trakt: the Trakt candidates carry no poster.
 */
function dedupeById(cands: FeedCandidate[]): FeedCandidate[] {
  const seen = new Set<string>();
  const out: FeedCandidate[] = [];
  for (const c of cands) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

/**
 * Fill missing posters from the local catalog, then drop whatever is still
 * blank.
 *
 * Trakt serves no images, so its candidates arrive with `posterUrl: null` and
 * normally get one from TMDB hydration — which the browse feed does but these
 * cheap rail paths do not. On the first live run that put three placeholder
 * letter-tiles (Spider-Man: No Way Home, The Mentalist, Criminal Minds) in the
 * middle of a poster rail. These are popular titles, so the catalog almost
 * always already has the artwork: one batched id→uuid lookup plus one indexed
 * read gets it for free, no provider call.
 *
 * Anything still poster-less is dropped rather than rendered: in a rail whose
 * entire job is visual, a blank tile is worse than one fewer card. The pool is
 * ranked deeper than the rail, so a drop costs nothing.
 */
function withPosters(cands: FeedCandidate[]): FeedCandidate[] {
  const missing = cands.filter((c) => !c.posterUrl);
  if (missing.length > 0) {
    const pairs: { source: string; sourceId: string }[] = [];
    for (const c of missing) {
      for (const [source, sid] of Object.entries(c.ids ?? {})) {
        if (sid != null) pairs.push({ source, sourceId: String(sid) });
      }
    }
    const idMap = resolveMediaIdsBySource(pairs);
    for (const c of missing) {
      for (const [source, sid] of Object.entries(c.ids ?? {})) {
        if (sid == null) continue;
        const mid = idMap.get(`${source}:${String(sid)}`);
        if (!mid) continue;
        const row = dbGet<{ poster_url: string | null }>(
          "SELECT poster_url FROM media_items WHERE id = ?", [mid]
        );
        if (row?.poster_url) { c.posterUrl = row.poster_url; break; }
      }
    }
  }
  return cands.filter((c) => !!c.posterUrl);
}

// ── Trending: what's popular RIGHT NOW, released included ──────────
async function trendingPool(region: string): Promise<FeedCandidate[]> {
  // `.catch` per source: one provider being down costs its own titles, not the
  // whole rail. Two pages of each TMDB endpoint so the pool is deep enough for
  // the rotation to have somewhere to go.
  const [tmdbMovies, tmdbMovies2, tmdbShows, traktMovies, traktShows, games] = await Promise.all([
    fetchTmdbTrending("movie", 1).catch(() => []),
    fetchTmdbTrending("movie", 2).catch(() => []),
    fetchTmdbTrending("show", 1).catch(() => []),
    fetchTraktTrending("movie", 1).catch(() => []),
    fetchTraktTrending("show", 1).catch(() => []),
    // SM36: was fetchRawgTrendingGames — RAWG only. During the 2026-08-02 RAWG
    // outage this returned [], so the rail had zero games and, with the Games
    // type filter on, the entire "Popular right now" section disappeared from
    // Home with no explanation. fetchTrendingGames pulls IGDB alongside it.
    fetchTrendingGames(1).catch(() => []),
  ]);
  void region; // trending isn't region-scoped upstream; kept in the cache key
  // TMDB before Trakt — see dedupeById.
  const merged = dedupeById([
    ...tmdbMovies, ...tmdbMovies2, ...tmdbShows, ...traktMovies, ...traktShows, ...games,
  ]);
  return rankCrossSourcePopularity(withPosters(merged), POOL_DEPTH);
}

// ── Upcoming: the calendar's algorithm, not a lookalike ────────────
async function upcomingPool(region: string, now: Date): Promise<FeedCandidate[]> {
  // THREE months, not one: late in a month "this month" has almost nothing left
  // in the future, which is exactly when the rail looked broken. Every month is
  // 6h-cached and shared with /calendar's Popular chip, so the extra reach costs
  // nothing after the first request.
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const months = [monthKey(now), nextMonthKey(now), nextMonthKey(next)];
  const pools = await Promise.all(months.map((m) => candidatesForMonth(m, region).catch(() => [])));
  // upcomingFrom is the ONE shared definition of upcoming (SM18 — /profile
  // shipped 1954 releases as "coming up" by slicing an unfiltered feed).
  const future = upcomingFrom(withPosters(dedupeById(pools.flat())), now);
  return rankCrossSourcePopularity(future, POOL_DEPTH);
}

export async function GET(req: NextRequest) {
  try {
    let userId: string | null = null;
    try { userId = (await getSession())?.userId ?? null; } catch { /* anon */ }
    const region = userId ? getUserCountry(userId) : DEFAULT_COUNTRY;

    // `?day=YYYY-MM-DD` forces the rotation seed, so a sweep can prove the rails
    // really do rotate (and that they're stable for a given day) without waiting
    // a day. Dev-only: on prod it would be an unbounded cache-key generator.
    const dayParam = process.env.NODE_ENV !== "production" ? req.nextUrl.searchParams.get("day") : null;
    const now = new Date();
    const today = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : dayISO(now);

    const cacheKey = `${region}:${today}`;
    let pools = _publicCache.get(cacheKey);
    if (!pools) {
      const [trending, upcoming] = await Promise.all([trendingPool(region), upcomingPool(region, now)]);
      pools = { trending, upcoming };
      _publicCache.set(cacheKey, pools);
    }

    // Rotate, THEN decorate — rotation is pure and cheap, so it stays outside
    // the cache and the cached pool remains the full ranked depth.
    const trending = decorateSection(rotateRail(pools.trending, RAIL_SIZE, seedFor("trending", today)), userId);
    const upcoming = decorateSection(
      rotateRail(pools.upcoming, RAIL_SIZE, seedFor("upcoming", today)), userId
    ).sort((a, b) => (a.releaseDate ?? "9999").localeCompare(b.releaseDate ?? "9999"));

    let recommendation: Awaited<ReturnType<typeof personalizedFeed>> = [];
    if (userId) {
      // personalizedFeed already ranks ~54 items (FINAL_KEEP × 3 types) and
      // caches them for 45 min — the old code just took the top 15 of that every
      // time. Rotating the SAME cached list costs no provider calls.
      const personalized = await personalizedFeed(userId, region);
      if (personalized) {
        const ranked = [...personalized].sort((a, b) => b.score - a.score);
        recommendation = rotateRail(ranked, RAIL_SIZE, seedFor("recommendation", userId, today));
      }
    }

    let stats: HomeStats | null = null;
    if (userId) {
      const a = getLibraryFacetAnalysis(userId);
      const wishlistTotal = dbGet<{ n: number }>(
        "SELECT COUNT(*) n FROM user_watchlist WHERE user_id = ?", [userId]
      )?.n ?? 0;
      stats = {
        libraryTotal: a.libraryItemCount,
        wishlistTotal,
        ratedTotal: a.ratedItemCount,
        highlights: buildHighlights(userId, today),
      };
    }

    return NextResponse.json({
      trending: annotateUserState(persistDiscoverBatch(trending, userId), userId),
      upcoming: annotateUserState(persistDiscoverBatch(upcoming, userId), userId),
      recommendation: annotateUserState(persistDiscoverBatch(recommendation, userId), userId),
      stats,
    });
  } catch (e: any) {
    log.error("home_error", { ...errorFields(e) });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

interface HomeStats {
  libraryTotal: number;
  wishlistTotal: number;
  ratedTotal: number;
  highlights: ReturnType<typeof buildHighlights>;
}
