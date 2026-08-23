import { describe, it, expect } from "vitest";
import { franchiseForItem } from "./franchise";
import type { FranchiseOutsider } from "./franchise";
import { ipDisplayLabel } from "@/lib/facets";
import type { Facet } from "@/lib/facets";
import type { DiscoveryVector } from "@/lib/discovery";

// 2026-08-21 — the item page's "More from {franchise}" rail. The properties
// that matter are the ones a reading of the code doesn't give you: the rail is
// NEWEST-FIRST (not ranked), CROSS-MEDIA (not filtered to the item's own
// type), and hidden entirely when the franchise holds nothing but the item
// itself — which is the median case in the real catalog.

function vector(id: string, type: string, releaseDate: string | null, title = id): DiscoveryVector {
  return {
    id, type: type as DiscoveryVector["type"], title, slug: title.toLowerCase(), posterUrl: null, backdropUrl: null,
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
  it("returns every media type, NEWEST first, without the item itself", () => {
    const members = [
      vector("game", "game", "2003-03-01"),
      vector("self", "movie", "1977-05-25"),
      vector("show", "show", "2008-08-15"),
      vector("movie", "movie", "1980-05-21"),
    ];
    const g = franchiseForItem("self", [STAR_WARS], () => members)!;

    expect(g.label).toBe("Star Wars");
    // Newest leftmost (2026-08-23, Nils). A rail is read left to right and
    // rarely scrolled to its end, so oldest-first spent the only slots anyone
    // looks at on the least current titles in the franchise.
    expect(g.items.map((v) => v.id)).toEqual(["show", "game", "movie"]);
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
    expect(g.items.map((v) => v.id)).toEqual(["mgs2", "mgs1"]);
  });

  it("caps a runaway franchise", () => {
    const members = Array.from({ length: 60 }, (_, i) => vector(`m${i}`, "game", `20${String(i).padStart(2, "0")}-01-01`));
    const g = franchiseForItem("self", [STAR_WARS], () => members, 40)!;
    expect(g.items).toHaveLength(40);
  });

  // ── The cap SELECTS by attention; the order is decided separately ─────────
  //
  // Measured 2026-08-23: IGDB franchises average **78 games** and the largest
  // in our catalog ("Star Wars", id 1) holds **394**, against 4.8 for a TMDB
  // collection. So for games the cap is the normal case, not an edge case, and
  // which 40 survive it is most of what the rail actually says.
  //
  // The trap being pinned is AGENTS.md's "a cap applied after a sort is a
  // silent filter" — the same shape that cut every RAWG game genre out of the
  // homepage hub. A date sort followed by a slice answers "which 40" with
  // "whichever end of the timeline", which on 394 members is arbitrary.
  const withVotes = (id: string, date: string | null, votes: number): DiscoveryVector =>
    ({ ...vector(id, "game", date), communityVotes: votes });

  it("fills the capped slots by ATTENTION, not by where a date sort happened to land", () => {
    const members = [
      vector("self", "game", "1995-01-01"),
      withVotes("obscure-new", "2026-01-01", 2),
      withVotes("obscure-old", "1996-01-01", 1),
      withVotes("famous-mid", "2010-01-01", 9000),
    ];
    const g = franchiseForItem("self", [STAR_WARS], () => members, 2)!;
    // The well-known entry survives the cap whichever end of the timeline it
    // sits at. Slicing a date sort would have dropped it for `obscure-new`
    // (newest-first) or `obscure-old` (oldest-first).
    expect(g.items.map((v) => v.id)).toContain("famous-mid");
    expect(g.items).toHaveLength(2);
  });

  it("still DISPLAYS the survivors newest-first, not in attention order", () => {
    const members = [
      vector("self", "game", "1995-01-01"),
      withVotes("newer", "2020-01-01", 10),
      withVotes("older", "2000-01-01", 9000), // most attention, oldest
    ];
    const g = franchiseForItem("self", [STAR_WARS], () => members, 2)!;
    // Both survive the cap, so this isolates the ORDER: recency wins the
    // display even though `older` dominates on votes.
    expect(g.items.map((v) => v.id)).toEqual(["newer", "older"]);
  });

  it("is deterministic when a whole franchise has no votes (most of IGDB)", () => {
    const members = [
      vector("self", "game", "1995-01-01"),
      vector("a", "game", "2001-01-01"),
      vector("b", "game", "2002-01-01"),
      vector("c", "game", "2003-01-01"),
    ];
    const once = franchiseForItem("self", [STAR_WARS], () => members, 2)!;
    const twice = franchiseForItem("self", [STAR_WARS], () => members, 2)!;
    expect(once.items.map((v) => v.id)).toEqual(twice.items.map((v) => v.id));
    // Ties fall back to recency, so the newest two survive rather than an
    // arbitrary pair.
    expect(once.items.map((v) => v.id)).toEqual(["c", "b"]);
  });
});

// ── Titles the provider has and the catalog does not (2026-08-23) ───────────
//
// THE GAP THIS CLOSES, measured on the real catalog that day: **167 of 249
// distinct TMDB collections held exactly ONE title**, so two thirds of films
// carrying a franchise showed no rail at all. Not because the franchise was
// wrong — because `franchiseForItem` only ever looked at our own shelf, while
// `belongs_to_collection.name` had been sitting in the stored payload as a
// LABEL the whole time and nobody ever asked what was in the collection.
//
// `absentForFacet` is injected for the same reason `candidatesForFacet` is:
// this module stays pure, so the merge is testable without a DB or a provider.
describe("franchiseForItem with provider-only members", () => {
  const outsider = (
    sourceId: string, title: string, releaseDate: string | null, popularity: number | null = 0
  ): FranchiseOutsider => ({
    source: "tmdb", sourceId, type: "movie", title, releaseDate, posterUrl: null, popularity,
  });

  const held = (id: string, date: string, sourceId: string, votes = 0): DiscoveryVector => ({
    ...vector(id, "movie", date),
    communityVotes: votes,
    sources: [{ source: "tmdb", sourceId }],
  });

  it("shows a rail for a franchise where the catalog holds ONLY the item itself", () => {
    // The exact 167-of-249 case. Before this the rail was null.
    const self = held("self", "2021-10-22", "438631");
    const g = franchiseForItem("self", [STAR_WARS], () => [self], 40,
      () => [outsider("693134", "Dune: Part Two", "2024-02-27")])!;
    expect(g).not.toBeNull();
    expect(g.entries).toHaveLength(1);
    expect(g.entries[0].kind).toBe("absent");
    expect(g.entries[0].title).toBe("Dune: Part Two");
    // `items` is catalog rows only, so it is legitimately empty here — the rail
    // still renders because `entries` is what it draws from.
    expect(g.items).toHaveLength(0);
  });

  it("dedupes an outsider against a catalog row by (source, sourceId), not by title", () => {
    // A franchise routinely contains a remake sharing a title, and the same
    // film reaches us under different titles per provider, so a title match
    // would be wrong in BOTH directions.
    const g = franchiseForItem("self", [STAR_WARS],
      () => [held("self", "1977-05-25", "11"), held("sibling", "1980-05-21", "1891", 500)], 40,
      () => [outsider("1891", "The Empire Strikes Back", "1980-05-21", 900), outsider("1892", "Return of the Jedi", "1983-05-25", 800)]
    )!;
    // 1891 is already held, so it appears ONCE, as the catalog row.
    expect(g.entries).toHaveLength(2);
    expect(g.entries.filter((e) => e.kind === "absent").map((e) => e.title)).toEqual(["Return of the Jedi"]);
    expect(g.entries.filter((e) => e.kind === "held")).toHaveLength(1);
  });

  it("never offers the VIEWED item back as an absent member of its own franchise", () => {
    const self = held("self", "1977-05-25", "11");
    const g = franchiseForItem("self", [STAR_WARS], () => [self], 40,
      () => [outsider("11", "Star Wars", "1977-05-25"), outsider("1891", "Empire", "1980-05-21")])!;
    expect(g.entries.map((e) => e.title)).toEqual(["Empire"]);
  });

  it("ranks held rows and provider-only titles in ONE pool, not two concatenated lists", () => {
    // The failure being pinned: ranking separately puts every catalog row ahead
    // of every provider row regardless of which title is more notable — the
    // same "a selection must rank by the quantity that matters" mistake the
    // Score's top-N buckets made (AGENTS.md, 2026-08-22).
    const g = franchiseForItem("self", [STAR_WARS],
      () => [held("obscure", "2005-01-01", "999", 3)], 1,
      () => [outsider("1891", "Famous Sequel", "1980-05-21", 9000)]
    )!;
    expect(g.entries).toHaveLength(1);
    expect(g.entries[0].title).toBe("Famous Sequel");
    // And the derived `items` agrees rather than quietly keeping the held row.
    expect(g.items).toHaveLength(0);
  });

  it("still displays the merged rail newest-first", () => {
    const g = franchiseForItem("self", [STAR_WARS],
      () => [held("old", "1999-05-19", "1893", 100)], 40,
      () => [outsider("1894", "Attack of the Clones", "2002-05-16", 100)]
    )!;
    expect(g.entries.map((e) => e.title)).toEqual(["Attack of the Clones", "old"]);
  });

  it("is unchanged when no absentForFacet is supplied at all", () => {
    const g = franchiseForItem("self", [STAR_WARS],
      () => [held("self", "1977-05-25", "11"), held("sibling", "1980-05-21", "1891")], 40)!;
    expect(g.entries).toHaveLength(1);
    expect(g.entries[0].kind).toBe("held");
  });
});
