import { describe, it, expect } from "vitest";
import { tagKey, personKey, companyKey, facetId } from "./facets";

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
