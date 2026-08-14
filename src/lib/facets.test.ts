import { describe, it, expect } from "vitest";
import { tagKey, personKey, companyKey, ipKey, facetId, extractFacets } from "./facets";

// A person/company key is the PUBLIC URL IDENTITY (facetUrl.ts addresses a facet
// by its key — there is no database row to resolve). So a normalizer that drops
// a letter doesn't produce a slightly-off slug, it produces a URL that hard-404s
// when the page looks the mangled name up against the provider.
//
// The class of bug these cover: NFD/NFKD only decomposes characters that HAVE a
// canonical decomposition. Stroked and ligature letters don't, so the
// `[^a-z0-9]` strip that follows deletes them outright. → translit.ts

describe("personKey", () => {
  it("lowercases and collapses punctuation", () => {
    expect(personKey("Hideo Kojima")).toBe("hideo kojima");
    expect(personKey("Bong Joon-ho")).toBe("bong joon ho");
    expect(personKey("  Denis   Villeneuve  ")).toBe("denis villeneuve");
  });

  it("strips decomposable diacritics (the NFD path)", () => {
    expect(personKey("Amélie Nothomb")).toBe("amelie nothomb");
    expect(personKey("Ang Lee")).toBe("ang lee");
    expect(personKey("Sergio Leone")).toBe("sergio leone");
  });

  it("transliterates stroked/ligature letters instead of deleting them", () => {
    // Each of these previously lost the letter entirely, producing a 404 slug.
    expect(personKey("Lisa Tønne")).toBe("lisa tonne");       // was "lisa t nne"
    expect(personKey("Łukasz Żal")).toBe("lukasz zal");       // was "ukasz zal"
    expect(personKey("Straße")).toBe("strasse");              // was "stra e"
    expect(personKey("Sœur Emmanuelle")).toBe("soeur emmanuelle");
    expect(personKey("Ægir Þór")).toBe("aegir thor");
    expect(personKey("Halldóra Geirharðsdóttir")).toBe("halldora geirhardsdottir");
  });

  it("handles the uppercase forms too", () => {
    expect(personKey("ØYVIND")).toBe("oyvind");
    expect(personKey("ŁUKASZ")).toBe("lukasz");
  });

  it("leaves non-Latin script collapsing to empty, as before", () => {
    expect(personKey("君の名は")).toBe("");
  });
});

describe("companyKey", () => {
  it("inherits personKey's transliteration", () => {
    expect(companyKey("Đại Việt Films")).toBe("dai viet");
    expect(companyKey("Tønne Studios")).toBe("tonne");
  });

  it("peels trailing legal/role tokens from the end only", () => {
    expect(companyKey("Naughty Dog, Inc.")).toBe("naughty dog");
    expect(companyKey("Naughty Dog")).toBe("naughty dog");
    // Never strips down to nothing.
    expect(companyKey("Games")).toBe("games");
  });
});

describe("tagKey", () => {
  // REGRESSION GUARD. Tag keys are PERSISTED — tag_category_override.tag_key and
  // tag_alias.{alias_key,canonical_key} are keyed by them (84 + 4 rows on prod as
  // of 2026-08-07). Transliterating tagKey would silently orphan those rows, so
  // it is deliberately excluded and must stay byte-identical.
  it("collapses separators and lowercases, unchanged", () => {
    expect(tagKey("Sci-Fi")).toBe("sci fi");
    expect(tagKey("Point & Click")).toBe("point & click");
    expect(tagKey("role_playing")).toBe("role playing");
    expect(tagKey("  Open   World ")).toBe("open world");
  });

  it("is NOT transliterated — stroked letters survive verbatim", () => {
    expect(tagKey("Blødt")).toBe("blødt");
    expect(tagKey("Straße")).toBe("straße");
  });
});

describe("facetId", () => {
  it("makes role part of the identity for people", () => {
    expect(facetId({ kind: "person", role: "director", key: "bong joon ho" }))
      .toBe("person|director|bong joon ho");
    expect(facetId({ kind: "tag", key: "sci fi" })).toBe("tag||sci fi");
  });
});

describe("ipKey", () => {
  // THE WHOLE POINT of this normalizer: TMDB suffixes its movie collections
  // while IGDB's game franchises are bare, so without peeling the trailing word
  // the movie and the game land on two different facets and the cross-media
  // franchise signal — the entire reason the ip facet exists — silently
  // doesn't happen. Both real spellings, taken from the live catalog.
  it("folds TMDB's collection suffix onto IGDB's bare franchise name", () => {
    expect(ipKey("Star Wars Collection")).toBe(ipKey("Star Wars"));
    expect(ipKey("Star Wars Collection")).toBe("star wars");
    expect(ipKey("The Chronicles of Narnia Collection")).toBe("the chronicles of narnia");
    expect(ipKey("How to Train Your Dragon Collection")).toBe("how to train your dragon");
  });

  it("peels the other franchise words too", () => {
    expect(ipKey("Alien Anthology")).toBe("alien");
    expect(ipKey("The Dark Knight Trilogy")).toBe("the dark knight");
    expect(ipKey("Marvel Cinematic Universe")).toBe("marvel");
  });

  it("keeps a bare IGDB franchise untouched", () => {
    expect(ipKey("Fallout")).toBe("fallout");
    expect(ipKey("Grand Theft Auto")).toBe("grand theft auto");
    expect(ipKey("S.T.A.L.K.E.R.")).toBe("s t a l k e r");
  });

  it("never strips down to nothing", () => {
    expect(ipKey("Collection")).toBe("collection");
    expect(ipKey("Universe")).toBe("universe");
  });
});

describe("extractFacets — franchise / IP", () => {
  const link = (source: string, rawData: unknown) =>
    ({ id: "", mediaItemId: "m", source, sourceId: "1", title: null, releaseDate: null, rawData, lastSynced: 0 }) as never;

  it("reads a TMDB movie collection and an IGDB franchise onto the SAME facet", () => {
    const movie = extractFacets(
      [link("tmdb", { belongs_to_collection: { id: 10, name: "Star Wars Collection" } })],
      "movie",
      {}
    ).filter((f) => f.kind === "ip");
    const game = extractFacets(
      [link("igdb", { franchises: [{ id: 1, name: "Star Wars" }] })],
      "game",
      {}
    ).filter((f) => f.kind === "ip");

    expect(movie).toHaveLength(1);
    expect(game).toHaveLength(1);
    expect(movie[0].key).toBe("star wars");
    expect(facetId(movie[0])).toBe(facetId(game[0])); // the cross-media join
    expect(movie[0].role).toBe("ip");
    expect(movie[0].label).toBe("Star Wars Collection"); // display keeps the source spelling
  });

  it("emits nothing when neither provider knows a franchise", () => {
    const facets = extractFacets(
      [link("tmdb", { belongs_to_collection: null }), link("igdb", {})],
      "movie",
      {}
    );
    expect(facets.filter((f) => f.kind === "ip")).toHaveLength(0);
  });

  it("dedupes the same franchise arriving from both providers at once", () => {
    const facets = extractFacets(
      [
        link("tmdb", { belongs_to_collection: { id: 10, name: "Star Wars Collection" } }),
        link("igdb", { franchises: [{ name: "Star Wars" }, { name: "Star Wars" }] }),
      ],
      "game",
      {}
    );
    expect(facets.filter((f) => f.kind === "ip")).toHaveLength(1);
  });
});
