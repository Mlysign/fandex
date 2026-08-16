import { describe, it, expect } from "vitest";
import { mergeMyStuff, filterByTab, parseTab } from "./myStuffMerge";
import type { EnrichedItem } from "@/types";

// C8 (2026-07-28) — merged Library/Wishlist view's pure logic: an item present
// in both fetches must appear once (deduped by id), and each of the four tabs
// (All/Wishlist/Unrated/Rated) filters correctly.

const base = (over: Partial<EnrichedItem> & { id: string }): EnrichedItem => ({
  type: "movie",
  title: over.id,
  releaseDate: null,
  posterUrl: null,
  backdropUrl: null,
  platformSources: [],
  dates: [],
  images: [],
  tags: [],
  platforms: [],
  description: null,
  tagline: null,
  metacritic: null,
  steamReviewLabel: null,
  communityRatings: [],
  runtimeMinutes: null,
  certification: [],
  status: null,
  collection: null,
  originalLanguage: null,
  country: null,
  rating: null,
  libraryStatus: null,
  ...over,
} as EnrichedItem);

describe("mergeMyStuff", () => {
  it("keeps a library-only item, inLibrary true, inWishlist false", () => {
    const merged = mergeMyStuff([base({ id: "a" })], []);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: "a", inLibrary: true, inWishlist: false });
  });

  it("keeps a wishlist-only item, inWishlist true, inLibrary false", () => {
    const merged = mergeMyStuff([], [base({ id: "b" })]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: "b", inLibrary: false, inWishlist: true });
  });

  it("derives inWishlist from a library item's platformSources", () => {
    const merged = mergeMyStuff([base({ id: "a", platformSources: ["trakt"] })], []);
    expect(merged[0]).toMatchObject({ inLibrary: true, inWishlist: true });
  });

  it("dedupes an item present in BOTH fetches — appears exactly once, both flags true", () => {
    const libItem = base({ id: "c", rating: 8, libraryStatus: "watched" });
    const wishItem = base({ id: "c", rating: 8, libraryStatus: "watched" });
    const merged = mergeMyStuff([libItem], [wishItem]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: "c", inLibrary: true, inWishlist: true, rating: 8 });
  });

  it("a wishlist item that also carries library state (libraryStatus set) but wasn't in the library fetch is still inLibrary", () => {
    // Shouldn't happen in practice (both fetches should agree), but the merge
    // shouldn't crash or silently drop the signal if it does.
    const merged = mergeMyStuff([], [base({ id: "d", libraryStatus: "watched", rating: 6 })]);
    expect(merged[0]).toMatchObject({ inLibrary: true, inWishlist: true });
  });
});

describe("filterByTab", () => {
  const items = mergeMyStuff(
    [
      base({ id: "rated", rating: 9, libraryStatus: "watched" }),
      base({ id: "unrated", rating: null, libraryStatus: "watched" }),
      base({ id: "both", rating: 7, libraryStatus: "watched", platformSources: ["trakt"] }),
    ],
    [base({ id: "wishlist-only" })]
  );

  it("wishlist returns only inWishlist items", () => {
    expect(filterByTab(items, "wishlist").map((i) => i.id).sort()).toEqual(["both", "wishlist-only"]);
  });

  // The tab set went to three on 2026-08-16. "Library" is NOT the old "all":
  // that folded in wishlist-only items, which is what made it a superset
  // rather than a place. This one is what you own/watched/played.
  it("library returns only inLibrary items, excluding wishlist-only", () => {
    expect(filterByTab(items, "library").map((i) => i.id).sort()).toEqual(["both", "rated", "unrated"]);
  });

  // Progress lists EPISODES from /api/progress; MyStuffView branches before
  // this function. Empty fails safe — a future caller that does route it here
  // renders nothing rather than the whole library under an episode heading.
  it("progress matches no ITEMS at all", () => {
    expect(filterByTab(items, "progress")).toEqual([]);
  });
});

describe("parseTab", () => {
  it("accepts each of the three valid values", () => {
    expect(parseTab("wishlist", "library")).toBe("wishlist");
    expect(parseTab("progress", "library")).toBe("progress");
    expect(parseTab("library", "wishlist")).toBe("library");
  });

  // Old links and bookmarks (?tab=all / rated / unrated) must not 500 or render
  // a blank tab — they fall back to the route default like any other unknown.
  it("falls back for a RETIRED tab value", () => {
    expect(parseTab("all", "library")).toBe("library");
    expect(parseTab("rated", "library")).toBe("library");
    expect(parseTab("unrated", "wishlist")).toBe("wishlist");
  });
  it("falls back for undefined", () => {
    expect(parseTab(undefined, "wishlist")).toBe("wishlist");
  });

  it("falls back for an empty string", () => {
    expect(parseTab("", "wishlist")).toBe("wishlist");
  });

  it("falls back for an unknown value", () => {
    expect(parseTab("bogus", "wishlist")).toBe("wishlist");
  });

  it("falls back for null", () => {
    expect(parseTab(null, "library")).toBe("library");
  });
});
