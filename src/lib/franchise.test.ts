import { describe, it, expect } from "vitest";
import { franchiseForItem } from "./franchise";
import { ipDisplayLabel } from "@/lib/facets";
import type { Facet } from "@/lib/facets";
import type { DiscoveryVector } from "@/lib/discovery";

// 2026-08-21 — the item page's "More from {franchise}" rail. The properties
// that matter are the ones a reading of the code doesn't give you: the rail is
// CHRONOLOGICAL (not ranked), CROSS-MEDIA (not filtered to the item's own
// type), and hidden entirely when the franchise holds nothing but the item
// itself — which is the median case in the real catalog.

function vector(id: string, type: string, releaseDate: string | null, title = id): DiscoveryVector {
  return {
    id, type: type as DiscoveryVector["type"], title, posterUrl: null, backdropUrl: null,
    releaseDate, year: releaseDate ? Number(releaseDate.slice(0, 4)) : null,
    communityScore: null, communityAvg: null, communityVotes: 0,
    runtimeMinutes: null, addedAt: 0, sources: [], facets: [],
  };
}

const ip = (key: string, label: string): Facet => ({ kind: "ip", role: "ip", key, label });
const STAR_WARS = ip("star wars", "Star Wars Collection");

describe("ipDisplayLabel", () => {
  it("peels the franchise words a provider suffixes onto the name", () => {
    expect(ipDisplayLabel("Star Wars Collection")).toBe("Star Wars");
    expect(ipDisplayLabel("The Lord of the Rings Trilogy")).toBe("The Lord of the Rings");
  });

  it("keeps case and punctuation the key throws away", () => {
    // ipKey() would return "yu gi oh" — lowercased, punctuation stripped —
    // which is why the display label can't be derived from it.
    expect(ipDisplayLabel("Yu-Gi-Oh!")).toBe("Yu-Gi-Oh!");
  });

  it("never peels a name down to nothing", () => {
    expect(ipDisplayLabel("Collection")).toBe("Collection");
  });
});

describe("franchiseForItem", () => {
  it("returns every media type, oldest first, without the item itself", () => {
    const members = [
      vector("game", "game", "2003-03-01"),
      vector("self", "movie", "1977-05-25"),
      vector("show", "show", "2008-08-15"),
      vector("movie", "movie", "1980-05-21"),
    ];
    const g = franchiseForItem("self", [STAR_WARS], () => members)!;

    expect(g.label).toBe("Star Wars");
    expect(g.items.map((v) => v.id)).toEqual(["movie", "game", "show"]);
  });

  it("sorts undated (announced, no date yet) entries last", () => {
    const members = [
      vector("tba", "game", null),
      vector("self", "movie", "1977-05-25"),
      vector("old", "movie", "1980-05-21"),
    ];
    const g = franchiseForItem("self", [STAR_WARS], () => members)!;
    expect(g.items.map((v) => v.id)).toEqual(["old", "tba"]);
  });

  it("is null when the item carries no franchise", () => {
    const tag: Facet = { kind: "tag", key: "space", label: "space", category: "genre" };
    expect(franchiseForItem("self", [tag], () => [vector("other", "movie", "2020-01-01")])).toBeNull();
  });

  it("is null when the franchise's only member IS the item — the median case", () => {
    expect(franchiseForItem("self", [STAR_WARS], () => [vector("self", "movie", "1977-05-25")])).toBeNull();
  });

  it("picks the LARGEST franchise rather than unioning two different ones", () => {
    // IGDB's `franchises` is an array, so an item can carry two. Unioning would
    // mislabel the rail: "More from Metal Gear" listing a title that is only in
    // the other franchise.
    const small = ip("metal gear", "Metal Gear");
    const big = ip("metal gear solid", "Metal Gear Solid");
    const byFacet = (f: Facet) =>
      f.key === "metal gear"
        ? [vector("self", "game", "1987-07-13"), vector("mg2", "game", "1990-07-20")]
        : [vector("self", "game", "1987-07-13"), vector("mgs1", "game", "1998-09-03"), vector("mgs2", "game", "2001-11-13")];

    const g = franchiseForItem("self", [small, big], byFacet)!;
    expect(g.label).toBe("Metal Gear Solid");
    expect(g.items.map((v) => v.id)).toEqual(["mgs1", "mgs2"]);
  });

  it("caps a runaway franchise", () => {
    const members = Array.from({ length: 60 }, (_, i) => vector(`m${i}`, "game", `20${String(i).padStart(2, "0")}-01-01`));
    const g = franchiseForItem("self", [STAR_WARS], () => members, 40)!;
    expect(g.items).toHaveLength(40);
  });
});
