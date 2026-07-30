import { describe, it, expect } from "vitest";
import type { FacetStat } from "@/lib/libraryAnalysis";
import { pickBestGenre } from "@/lib/libraryAnalysis";

// SM11 (2026-07-27) — Home/Profile showed "Your top genre: steam" because the
// original inline pick only checked `kind === "tag"`, which spans the whole
// tag taxonomy (platform/theme/artstyle/meta), not just genres.
function facet(over: Partial<FacetStat>): FacetStat {
  return {
    kind: "tag", key: over.label ?? "x", label: "x",
    count: 5, sum: 0, avg: 0, ba: 0, weightedCount: 5, weightedSum: 0,
    ...over,
  };
}

describe("pickBestGenre", () => {
  it("never crowns a non-genre tag, even with the highest ba", () => {
    const facets = [
      facet({ label: "steam", category: "platform", ba: 9.5 }),
      facet({ label: "Action", category: "genre", ba: 7.0 }),
    ];
    expect(pickBestGenre(facets, 3)?.label).toBe("Action");
  });

  it("picks the highest-ba genre among several", () => {
    const facets = [
      facet({ label: "Action", category: "genre", ba: 6.5 }),
      facet({ label: "Horror", category: "genre", ba: 8.2 }),
      facet({ label: "Drama", category: "genre", ba: 7.1 }),
    ];
    expect(pickBestGenre(facets, 3)?.label).toBe("Horror");
  });

  it("excludes genres seen on fewer than minCount items", () => {
    const facets = [facet({ label: "Horror", category: "genre", ba: 9.9, count: 2 })];
    expect(pickBestGenre(facets, 3)).toBeNull();
  });

  it("ignores non-tag facets (people/studios) entirely", () => {
    const facets = [facet({ kind: "person", label: "Christopher Nolan", category: "genre", ba: 9.9 })];
    expect(pickBestGenre(facets, 3)).toBeNull();
  });

  it("returns null when there is no qualifying genre", () => {
    const facets = [facet({ label: "steam", category: "platform", ba: 9.5 })];
    expect(pickBestGenre(facets, 3)).toBeNull();
  });

  it("rounds ba to one decimal", () => {
    const facets = [facet({ label: "Action", category: "genre", ba: 7.849 })];
    expect(pickBestGenre(facets, 3)?.ba).toBe(7.8);
  });
});
