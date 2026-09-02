import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run } from "./db";
import { upsertMediaItem } from "./matcher";
import { find, invalidateDiscoveryCache } from "./discovery";

// 2026-09-02, Nils's call. Until now `find()` had NO relevance term at all: the
// filter is `title.includes(q)` and everything after it is a global sort. A
// title is a substring of every longer title containing it, so typing a name you
// know exists could bury it under a more famous neighbour on any crowd-shaped
// sort. Searching "Lucky" put *Mr. Lucky* first.
//
// The trade was stated and accepted: an exact match OVERRIDES the selected sort.
// So these tests assert exactly that, in both directions — the exact match wins,
// and everything *below* it is still ordered by the control the user picked.

initDb();

/** Distinct provider ids per fixture, or the matcher merges them into one row. */
let pid = 5000;
function movie(title: string, votes: number, average10: number, year = 2010) {
  const id = pid++;
  return upsertMediaItem({
    source: "tmdb",
    sourceId: String(id),
    type: "movie",
    title,
    releaseDate: `${year}-01-01`,
    rawData: {
      id, title, release_date: `${year}-01-01`, poster_path: "/p.jpg", overview: "o",
      genres: [], vote_count: votes, vote_average: average10,
    },
  });
}

describe("find() puts an exact title match first", () => {
  beforeEach(() => {
    run("DELETE FROM media_links");
    run("DELETE FROM media_items");
    invalidateDiscoveryCache();
  });

  it("beats a more popular title that merely CONTAINS the query", () => {
    // The real case: "Lucky" is a substring of "Mr. Lucky", which has more votes.
    movie("Mr. Lucky", 50_000, 8);
    movie("Lucky", 40, 6);
    invalidateDiscoveryCache();

    const res = find(null, { q: "Lucky", sort: "popularity" });
    expect(res.items.map((i) => i.title)).toEqual(["Lucky", "Mr. Lucky"]);
  });

  it("wins under EVERY sort, which is the accepted trade", () => {
    movie("Lucky Number Slevin", 90_000, 9, 2006);
    movie("Lucky", 5, 4, 2017);
    invalidateDiscoveryCache();

    for (const sort of ["popularity", "rating", "releaseDate", "fandexScore"] as const) {
      const res = find(null, { q: "lucky", sort });
      expect(res.items[0]?.title, `sort=${sort}`).toBe("Lucky");
    }
  });

  it("still orders everything BELOW the exact match by the chosen sort", () => {
    movie("Lucky", 10, 5);
    movie("Lucky Strike", 900, 7);
    movie("Lucky Number Slevin", 90_000, 9);
    invalidateDiscoveryCache();

    const res = find(null, { q: "lucky", sort: "popularity" });
    // Exact first, then the rest by votes descending — not arbitrary order.
    expect(res.items.map((i) => i.title)).toEqual(["Lucky", "Lucky Number Slevin", "Lucky Strike"]);
  });

  it("is case- and whitespace-insensitive", () => {
    movie("WALL-E", 20, 8);
    movie("WALL-E Behind The Scenes", 9000, 7);
    invalidateDiscoveryCache();

    for (const q of ["wall-e", "WALL-E", "  wall-e  "]) {
      expect(find(null, { q, sort: "popularity" }).items[0]?.title, `q=${JSON.stringify(q)}`).toBe("WALL-E");
    }
  });

  it("changes nothing when there is no exact match", () => {
    movie("Lucky Strike", 900, 7);
    movie("Lucky Number Slevin", 90_000, 9);
    invalidateDiscoveryCache();

    const res = find(null, { q: "lucky", sort: "popularity" });
    // Pure popularity order, untouched.
    expect(res.items.map((i) => i.title)).toEqual(["Lucky Number Slevin", "Lucky Strike"]);
  });

  it("changes nothing when there is no query at all", () => {
    movie("Alpha", 10, 5);
    movie("Beta", 900, 7);
    invalidateDiscoveryCache();

    const res = find(null, { sort: "popularity" });
    expect(res.items.map((i) => i.title)).toEqual(["Beta", "Alpha"]);
  });

  it("keeps several works sharing an exact title ordered by the chosen sort", () => {
    // A remake and its original both match exactly; neither is 'more exact', so
    // the selected sort decides between them rather than insertion order.
    movie("Suspiria", 120_000, 8, 1977);
    movie("Suspiria", 300, 7, 2018);
    invalidateDiscoveryCache();

    const res = find(null, { q: "suspiria", sort: "popularity" });
    expect(res.items).toHaveLength(2);
    expect(res.items[0].communityVotes).toBeGreaterThan(res.items[1].communityVotes);
  });
});
