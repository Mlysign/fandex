import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run } from "./db";
import { upsertMediaItem } from "./matcher";
import { searchFacets, invalidateDiscoveryCache } from "./discovery";

// SM14 (2026-07-27) — searching "nolan" on Discover showed "Christopher Nolan"
// twice: the vocab keys person facets by kind+role+key (facetId — a director
// and a writer credit are distinct facets on purpose, for idf weighting), but
// facetUrl.ts drops role from the URL ("a person who is both director and
// writer" still resolves to ONE /person/<slug>). searchFacets must merge on
// kind+key before returning pills, or two roles show as two identical links.

initDb();

beforeEach(() => {
  run("DELETE FROM media_items");
  invalidateDiscoveryCache();
});

describe("searchFacets — role merge (SM14)", () => {
  it("merges a person credited as both director and writer into one pill", () => {
    upsertMediaItem({
      source: "tmdb", sourceId: "1", type: "movie", title: "Inception", releaseDate: "2010-01-01",
      rawData: {
        id: 1, title: "Inception", release_date: "2010-01-01", poster_path: "/p.jpg", overview: "o",
        genres: [],
        credits: { cast: [], crew: [{ name: "Christopher Nolan", job: "Director" }, { name: "Christopher Nolan", job: "Writer" }] },
      },
    });
    invalidateDiscoveryCache();

    const matches = searchFacets("nolan", "person");
    const nolanPills = matches.filter((m) => m.key === "christopher nolan");
    expect(nolanPills).toHaveLength(1);
    expect(nolanPills[0].count).toBe(2); // one credit per role, summed
  });

  it("keeps two distinct people with the same name matched separately", () => {
    upsertMediaItem({
      source: "tmdb", sourceId: "2", type: "movie", title: "Two Nolans", releaseDate: "2011-01-01",
      rawData: {
        id: 2, title: "Two Nolans", release_date: "2011-01-01", poster_path: "/p.jpg", overview: "o",
        genres: [],
        credits: {
          cast: [{ name: "Nolan Gerard Funk" }],
          crew: [{ name: "Jonathan Nolan", job: "Writer" }],
        },
      },
    });
    invalidateDiscoveryCache();

    const matches = searchFacets("nolan", "person");
    const keys = matches.map((m) => m.key).sort();
    expect(keys).toEqual(["jonathan nolan", "nolan gerard funk"]);
  });

  it("does not merge across different kinds sharing a key", () => {
    upsertMediaItem({
      source: "tmdb", sourceId: "3", type: "movie", title: "Nolan Studio Film", releaseDate: "2012-01-01",
      rawData: {
        id: 3, title: "Nolan Studio Film", release_date: "2012-01-01", poster_path: "/p.jpg", overview: "o",
        genres: [],
        credits: { cast: [], crew: [{ name: "Christopher Nolan", job: "Director" }] },
        production_companies: [{ name: "Nolan" }],
      },
    });
    invalidateDiscoveryCache();

    const personMatches = searchFacets("nolan", "person");
    const companyMatches = searchFacets("nolan", "company");
    expect(personMatches.some((m) => m.key === "christopher nolan")).toBe(true);
    expect(companyMatches.some((m) => m.kind === "company")).toBe(true);
  });
});
