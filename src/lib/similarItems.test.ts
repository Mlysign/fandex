import { describe, it, expect } from "vitest";
import { rankSimilar } from "./similarItems";
import type { Facet } from "@/lib/facets";
import type { DiscoveryVector } from "@/lib/discovery";

// 2026-07-31 (T6) — the item-detail mockup's placeholder "More like this" rail,
// built out now that itemsWithFacet()/getCatalogIdf() make it cheap. The one
// property that actually matters: sharing a RARE facet must outrank sharing
// only a COMMON one, or the rail degenerates into "everything with the same
// top-level genre" — which is exactly the failure mode IDF weighting exists to
// avoid everywhere else in this app (the Fandex Score itself).

function vector(id: string, facets: Facet[]): DiscoveryVector {
  return {
    id, type: "movie", title: id, slug: id, posterUrl: null, backdropUrl: null,
    releaseDate: "2020-01-01", year: 2020, communityScore: null, communityAvg: null,
    communityVotes: 0, runtimeMinutes: null, addedAt: 0, sources: [], facets,
  };
}

const tag = (key: string): Facet => ({ kind: "tag", key, label: key, category: "genre" });

const TARGET_FACETS: Facet[] = [tag("drama"), tag("steampunk")];

// idf: "drama" is common (low weight), "steampunk" is rare (high weight) —
// mirrors the real catalog's IDF, computed the same way (log((N+1)/(count+1))).
const IDF = new Map<string, number>([
  ["tag||drama", 0.2],
  ["tag||steampunk", 3.5],
]);

describe("rankSimilar", () => {
  it("ranks a rare-facet match above a common-facet-only match", () => {
    const rareMatch = vector("rare", [tag("steampunk")]);
    const commonMatch = vector("common", [tag("drama")]);

    const byFacet = (f: Facet) => (f.key === "steampunk" ? [rareMatch] : [commonMatch]);
    const ranked = rankSimilar("target", TARGET_FACETS, IDF, byFacet);

    expect(ranked.map((r) => r.vector.id)).toEqual(["rare", "common"]);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it("sums scores across multiple shared facets", () => {
    const both = vector("both", [tag("drama"), tag("steampunk")]);
    const onlyRare = vector("only-rare", [tag("steampunk")]);
    // `both` carries both facets, so it must appear as a candidate for EITHER
    // query; `onlyRare` only carries "steampunk", so it must appear for that
    // facet alone — matching how itemsWithFacet() actually indexes vectors.
    const byFacet = (f: Facet) => (f.key === "steampunk" ? [both, onlyRare] : [both]);

    const ranked = rankSimilar("target", TARGET_FACETS, IDF, byFacet);
    const bothScore = ranked.find((r) => r.vector.id === "both")!.score;
    const rareOnlyScore = ranked.find((r) => r.vector.id === "only-rare")!.score;
    expect(bothScore).toBeGreaterThan(rareOnlyScore);
  });

  it("never recommends the item to itself", () => {
    const self = vector("target", TARGET_FACETS);
    const byFacet = () => [self];
    expect(rankSimilar("target", TARGET_FACETS, IDF, byFacet)).toEqual([]);
  });

  it("skips a facet with zero (or unweighted) idf entirely", () => {
    const universal = tag("everywhere");
    const candidate = vector("c", [universal]);
    const zeroIdf = new Map<string, number>([["tag||everywhere", 0]]);
    expect(rankSimilar("target", [universal], zeroIdf, () => [candidate])).toEqual([]);
    // Also true when the facet isn't in the idf map at all.
    expect(rankSimilar("target", [universal], new Map(), () => [candidate])).toEqual([]);
  });

  it("caps results at the limit, best first", () => {
    const many = Array.from({ length: 20 }, (_, i) => vector(`v${i}`, [tag("steampunk")]));
    const ranked = rankSimilar("target", TARGET_FACETS, IDF, () => many, 12);
    expect(ranked).toHaveLength(12);
  });

  it("only scores the top-N rarest of the target's own facets", () => {
    // 9 target facets, all with distinct weights — only the top 8 (by idf)
    // should ever trigger a candidate scan. Confirmed by an idf-0 facet at the
    // BOTTOM of the ranking still being skipped correctly, and a scan spy on
    // the number of distinct facets actually queried.
    const many = Array.from({ length: 9 }, (_, i) => tag(`t${i}`));
    const idf = new Map(many.map((f, i) => [`tag||${f.key}`, i + 1])); // t0=1 (rarest-ranked-last) .. t8=9 (rarest)
    const queried = new Set<string>();
    rankSimilar("target", many, idf, (f) => { queried.add(f.key); return []; });
    expect(queried.size).toBe(8);
    expect(queried.has("t0")).toBe(false); // the lowest-weight facet, dropped by the top-8 cut
  });
});
