import { get as dbGet } from "@/lib/db";
import { resolveMediaIdsBySource, sourceRefKey } from "@/lib/userState";
import type { FeedCandidate } from "@/lib/discoverFeed";
import { fetchTmdbTrending, fetchTraktTrending, fetchTrendingGames } from "@/lib/discoverFeed";
import { candidatesForMonth, monthKey, nextMonthKey } from "@/lib/popularMonthFeed";
import { rankCrossSourcePopularity } from "@/lib/popularMonth";
import { upcomingFrom } from "@/lib/upcoming";

// Home's two PUBLIC rail pools, trending and upcoming, as one shared
// implementation.
//
// Extracted from `/api/home` on 2026-08-26 when the daily snapshot builder
// became a second caller. There is a standing lesson in this repo about exactly
// that moment: the games dual-source pull existed once correctly and three times
// as single-source copies, and nobody noticed until RAWG went down. So this
// moved rather than being re-typed, and `/api/home` now imports it.
//
// ⚠️ NOTHING HERE READS A SESSION and nothing here writes. The pools are
// viewer-independent by construction, which is what lets the snapshot builder
// run them with no visitor at all. Per-user decoration (`decorateSection`,
// `persistDiscoverBatch`, `annotateUserState`) stays at the call sites.

/** How many items a rail shows. */
export const RAIL_SIZE = 15;
/** Rank this deep, show RAIL_SIZE of it — the room the rotation draws from. */
export const POOL_DEPTH = 45;

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
export function dedupeById(cands: FeedCandidate[]): FeedCandidate[] {
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
export function withPosters(cands: FeedCandidate[]): FeedCandidate[] {
  const missing = cands.filter((c) => !c.posterUrl);
  if (missing.length > 0) {
    const pairs: { source: string; sourceId: string; type?: string }[] = [];
    for (const c of missing) {
      for (const [source, sid] of Object.entries(c.ids ?? {})) {
        if (sid != null) pairs.push({ source, sourceId: String(sid), type: c.type });
      }
    }
    const idMap = resolveMediaIdsBySource(pairs);
    for (const c of missing) {
      for (const [source, sid] of Object.entries(c.ids ?? {})) {
        if (sid == null) continue;
        const mid = idMap.get(sourceRefKey(source, String(sid), c.type));
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
export async function trendingPool(region: string): Promise<FeedCandidate[]> {
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
export async function upcomingPool(region: string, now: Date): Promise<FeedCandidate[]> {
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
