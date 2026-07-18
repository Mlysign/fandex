import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run } from "./db";
import { upsertMediaItem } from "./matcher";
import { find, invalidateDiscoveryCache } from "./discovery";
import { sortItems } from "./sortItems";
import { communityVotes, bayesRating, ratingPrior } from "./ratingsSort";
import { CommunityRating } from "@/types";

// Unified sort model (2026-07-19): Release date / Popularity / Rating (Bayesian)
// / Fandex Score. These lock the two non-obvious pieces — Bayesian damping (a
// low-vote high rating must not top a well-voted classic) and nulls-last — plus
// find()'s server-side ordering + cold-start fallback.

const R = (source: string, score: number, outOf: number, votes: number | null): CommunityRating =>
  ({ source, label: source, score, outOf, votes });

describe("ratingsSort helpers", () => {
  it("communityVotes sums votes across sources; absent → 0", () => {
    expect(communityVotes([R("tmdb", 8, 10, 100), R("trakt", 7, 10, 50)])).toBe(150);
    expect(communityVotes([R("tmdb", 8, 10, null)])).toBe(0);
    expect(communityVotes(undefined)).toBe(0);
    expect(communityVotes([])).toBe(0);
  });

  it("Bayesian rating: a 1-vote 10 does NOT outrank a 5000-vote 8.5", () => {
    const prior = ratingPrior([
      { score10: 8.5, votes: 5000 },
      { score10: 6.0, votes: 5000 },
      { score10: 10, votes: 1 }, // below the min-votes floor → excluded from prior
    ]);
    const classic = bayesRating(8.5, 5000, prior);
    const outlier = bayesRating(10, 1, prior);
    expect(classic).toBeGreaterThan(outlier);
  });

  it("unrated (null score) sorts last under bayesRating", () => {
    expect(bayesRating(null, 999, 7)).toBe(-1);
  });
});

describe("sortItems (client, Library/Wishlist)", () => {
  const mk = (title: string, opts: { date?: string | null; ratings?: CommunityRating[]; fandex?: number | null }) => ({
    title, releaseDate: opts.date ?? null, communityRatings: opts.ratings, fandexScore: opts.fandex ?? null,
  });

  // Two well-voted anchors (so the Bayesian prior sits BELOW the outlier's raw
  // score) plus a raw-10 low-vote outlier and a no-rating item.
  const items = [
    mk("classic", { date: "2001-01-01", ratings: [R("tmdb", 8.5, 10, 5000)], fandex: 40 }),
    mk("mid", { date: "2010-01-01", ratings: [R("tmdb", 6.0, 10, 5000)], fandex: 55 }),
    mk("outlier", { date: "2025-01-01", ratings: [R("tmdb", 10, 10, 2)], fandex: 90 }),
    mk("none", { date: null, ratings: [], fandex: null }),
  ];

  it("releaseDate → newest first, null dates last", () => {
    expect(sortItems(items, "releaseDate").map((i) => i.title)).toEqual(["outlier", "mid", "classic", "none"]);
  });

  it("popularity → most votes first, zero-vote last", () => {
    expect(sortItems(items, "popularity").map((i) => i.title).at(-1)).toBe("none");
    expect(sortItems(items, "popularity").map((i) => i.title).slice(0, 2).sort()).toEqual(["classic", "mid"]);
  });

  it("rating → Bayesian: the 5000-vote 8.5 tops the 2-vote 10", () => {
    expect(sortItems(items, "rating").map((i) => i.title)[0]).toBe("classic");
  });

  it("fandexScore → highest first, null last", () => {
    expect(sortItems(items, "fandexScore").map((i) => i.title)).toEqual(["outlier", "mid", "classic", "none"]);
  });
});

describe("find() server sort", () => {
  initDb();
  const USER = "u-sortmodel";
  const TMDB = (id: number, title: string, date: string, voteAvg: number, voteCount: number) => ({
    id, title, release_date: date, poster_path: "/p.jpg", overview: "o", vote_average: voteAvg, vote_count: voteCount,
  });
  const mkItem = (id: number, title: string, date: string, voteAvg: number, voteCount: number) =>
    upsertMediaItem({ source: "tmdb", sourceId: String(id), type: "movie", title, releaseDate: date, rawData: TMDB(id, title, date, voteAvg, voteCount) });

  beforeEach(() => {
    run("DELETE FROM media_items");
    run("DELETE FROM users");
    run("INSERT INTO users (id) VALUES (?)", [USER]);
    invalidateDiscoveryCache();
    mkItem(1, "Outlier", "2025-01-01", 10, 1);      // raw 10, 1 vote
    mkItem(2, "Classic", "2001-01-01", 8.5, 5000);  // well-voted
    mkItem(3, "MidClassic", "2010-01-01", 6.0, 5000);
    invalidateDiscoveryCache();
  });

  it("popularity → the 5000-vote titles rank above the 1-vote one", () => {
    const titles = find(USER, { sort: "popularity", limit: 120 }).items.map((i) => i.title);
    expect(titles.at(-1)).toBe("Outlier");
  });

  it("rating (Bayesian) → the well-voted Classic ranks first, not the 1-vote 10", () => {
    const titles = find(USER, { sort: "rating", limit: 120 }).items.map((i) => i.title);
    expect(titles[0]).toBe("Classic");
  });

  it("releaseDate → newest first", () => {
    const titles = find(USER, { sort: "releaseDate", limit: 120 }).items.map((i) => i.title);
    expect(titles[0]).toBe("Outlier"); // 2025
  });

  it("default (fandexScore) with no rated library falls back to Bayesian rating", () => {
    // Cold start: no ratings → fandex unusable → falls back to rating, so the
    // well-voted Classic leads rather than the raw-10 outlier.
    const titles = find(USER, { limit: 120 }).items.map((i) => i.title);
    expect(titles[0]).toBe("Classic");
  });
});
