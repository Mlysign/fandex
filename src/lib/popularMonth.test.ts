import { describe, it, expect } from "vitest";
import { rankPopularMonth } from "@/lib/popularMonth";
import type { FeedCandidate } from "@/lib/discoverFeed";
import { monthWindow, isPastWindow } from "@/lib/discoverFeed";

// The calendar's "Popular" scope (2026-07-28). The load-bearing property is
// that the type mix is whatever the month actually looks like — the ranking
// must NOT quietly re-balance into per-type quotas.

let seq = 0;
function candidate(over: Partial<FeedCandidate> = {}): FeedCandidate {
  seq += 1;
  return {
    id: `c-${seq}`, rawId: seq, source: "tmdb", type: "movie",
    title: `Title ${seq}`, releaseDate: "2026-08-14", posterUrl: null,
    ids: {}, genreNames: [], originalLanguage: null,
    voteCount: 0, voteAverage: null, popularity: 1,
    ...over,
  };
}

/** n candidates of one source/type, each with an explicit popularity. */
function bucket(source: string, type: string, popularities: number[], titlePrefix = source): FeedCandidate[] {
  return popularities.map((popularity, i) =>
    candidate({ source, type: type as FeedCandidate["type"], popularity, title: `${titlePrefix} ${i}` })
  );
}

describe("rankPopularMonth — cross-source normalisation", () => {
  it("does not just rank by whichever provider uses bigger numbers", () => {
    // RAWG `added` is an order of magnitude above TMDB `popularity`, but every
    // RAWG game here is dead average for RAWG while one movie is a 10x outlier.
    const games = bucket("rawg", "game", [300, 300, 300, 300, 300, 300], "game");
    const movies = bucket("tmdb", "movie", [150, 15, 15, 15, 15, 15], "movie");

    const top = rankPopularMonth([...games, ...movies], 1);
    expect(top).toHaveLength(1);
    expect(top[0].title).toBe("movie 0");
    expect(top[0].type).toBe("movie");
  });

  it("keeps an uneven type mix instead of balancing it into quotas", () => {
    // A month where movies genuinely dominate: every movie beats its median,
    // every show sits at its own.
    const movies = bucket("tmdb", "movie", [100, 90, 80, 70, 60, 50, 40, 30, 20, 5, 5, 5, 5, 5, 5], "movie");
    const shows = bucket("tmdb", "show", [10, 10, 10, 10, 10, 10], "show");

    const ranked = rankPopularMonth([...movies, ...shows], 10);
    const movieCount = ranked.filter((c) => c.type === "movie").length;

    expect(ranked).toHaveLength(10);
    expect(movieCount).toBeGreaterThan(7); // not forced toward 5/5
  });

  it("scores against the median of the item's OWN source+type bucket", () => {
    // Identical raw popularity (50), but 50 is 5x the games' median and only
    // half the movies' — so the game must outrank the movie.
    const games = bucket("rawg", "game", [50, 10, 10, 10, 10, 10], "game");
    const movies = bucket("tmdb", "movie", [50, 100, 100, 100, 100, 100], "movie");

    const ranked = rankPopularMonth([...games, ...movies], 20);
    const gameIdx = ranked.findIndex((c) => c.title === "game 0");
    const movieIdx = ranked.findIndex((c) => c.title === "movie 0");

    expect(gameIdx).toBeGreaterThanOrEqual(0);
    expect(movieIdx).toBeGreaterThanOrEqual(0);
    expect(gameIdx).toBeLessThan(movieIdx);
  });
});

describe("rankPopularMonth — small buckets", () => {
  it("falls back to provider order when a bucket is under the median threshold", () => {
    // Only 3 shows — a median over 3 samples is noise, so provider order rules.
    const shows = bucket("tmdb", "show", [1, 900, 900], "show");
    const ranked = rankPopularMonth(shows, 10);
    expect(ranked.map((c) => c.title)).toEqual(["show 0", "show 1", "show 2"]);
  });

  it("a small bucket's leader can place, but the bucket cannot flood the month", () => {
    // 3 shows on the rank fallback (1, 1/2, 1/3) against 6 unremarkable movies
    // all sitting at their own median (1.0). The show leader ties/leads, but
    // the movies still take most of the slots.
    const shows = bucket("tmdb", "show", [5, 5, 5], "show");
    const movies = bucket("tmdb", "movie", [20, 20, 20, 20, 20, 20], "movie");

    const ranked = rankPopularMonth([...shows, ...movies], 6);
    expect(ranked.filter((c) => c.type === "show").length).toBeLessThanOrEqual(2);
  });
});

describe("rankPopularMonth — hygiene", () => {
  it("dedupes the same game arriving from RAWG and IGDB, keeping the first seen", () => {
    const rawg = candidate({ source: "rawg", type: "game", title: "Hollow Knight: Silksong", releaseDate: "2026-08-14", popularity: 900 });
    const igdb = candidate({ source: "igdb", type: "game", title: "Hollow  Knight:  Silksong", releaseDate: "2026-08-14", popularity: 900 });

    const ranked = rankPopularMonth([rawg, igdb], 10);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].source).toBe("rawg");
  });

  it("does not dedupe same-title items of different types or dates", () => {
    const movie = candidate({ source: "tmdb", type: "movie", title: "Dune", releaseDate: "2026-08-14" });
    const game = candidate({ source: "rawg", type: "game", title: "Dune", releaseDate: "2026-08-14" });
    const sequel = candidate({ source: "tmdb", type: "movie", title: "Dune", releaseDate: "2026-08-21" });
    expect(rankPopularMonth([movie, game, sequel], 10)).toHaveLength(3);
  });

  it("drops undated items — they cannot be placed on a calendar", () => {
    const dated = candidate({ releaseDate: "2026-08-14" });
    const undated = candidate({ releaseDate: null });
    const ranked = rankPopularMonth([dated, undated], 10);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].releaseDate).toBe("2026-08-14");
  });

  it("keeps an item whose provider reported no popularity number", () => {
    const withPop = bucket("tmdb", "movie", [10, 10, 10, 10, 10], "movie");
    const noPop = candidate({ source: "tmdb", type: "movie", title: "unknown", popularity: null });
    const ranked = rankPopularMonth([...withPop, noPop], 10);
    expect(ranked.map((c) => c.title)).toContain("unknown");
  });

  it("honours the limit and never returns more than asked", () => {
    const many = bucket("tmdb", "movie", Array.from({ length: 40 }, (_, i) => 40 - i), "movie");
    expect(rankPopularMonth(many, 15)).toHaveLength(15);
    expect(rankPopularMonth(many, 0)).toHaveLength(0);
  });

  it("returns an empty list for an empty month", () => {
    expect(rankPopularMonth([], 15)).toEqual([]);
  });
});

describe("monthWindow", () => {
  it("covers the whole month, inclusive of both ends", () => {
    expect(monthWindow("2026-08")).toEqual({ gte: "2026-08-01", lte: "2026-08-31" });
  });

  it("handles the December → January boundary", () => {
    expect(monthWindow("2026-12")).toEqual({ gte: "2026-12-01", lte: "2026-12-31" });
    expect(monthWindow("2027-01")).toEqual({ gte: "2027-01-01", lte: "2027-01-31" });
  });

  it("handles 30-day months and February in both leap and common years", () => {
    expect(monthWindow("2026-04").lte).toBe("2026-04-30");
    expect(monthWindow("2026-02").lte).toBe("2026-02-28");
    expect(monthWindow("2028-02").lte).toBe("2028-02-29"); // leap
    expect(monthWindow("2100-02").lte).toBe("2100-02-28"); // century, not a leap year
  });

  it("rejects a malformed month", () => {
    expect(() => monthWindow("2026-13")).toThrow();
    expect(() => monthWindow("nope")).toThrow();
  });
});

describe("isPastWindow", () => {
  it("is true only once the window has fully elapsed", () => {
    expect(isPastWindow(monthWindow("2000-01"))).toBe(true);
    expect(isPastWindow(monthWindow("2099-01"))).toBe(false);
  });
});
