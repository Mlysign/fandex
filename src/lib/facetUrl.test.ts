import { describe, it, expect } from "vitest";
import {
  publicFacetHref, keyToSlug, slugToKey, keyFor, isFacetPrefix, prefixToKind, FACET_PREFIXES,
} from "./facetUrl";
import { personKey, companyKey, tagKey } from "./facets";

// P17 — the facet slug is NOT cosmetic (unlike the item slug): it IS the identity,
// so it must round-trip to the exact key or the page resolves the wrong facet.

describe("keyToSlug / slugToKey round-trip", () => {
  // The whole design rests on this being lossless for every key normalizer.
  const labels = [
    "Christopher Nolan", "Bong Joon-ho", "Denis Villeneuve",
    "Sci-Fi", "sci fi", "Point & Click",
    "Naughty Dog, Inc.", "A24", "Hidetaka Miyazaki",
    "Spider-Man", "Amélie", "  spaced  out  ",
  ];
  it("key -> slug -> key returns the original key for people", () => {
    for (const l of labels) {
      const k = personKey(l);
      expect(slugToKey(keyToSlug(k))).toBe(k);
    }
  });
  it("key -> slug -> key returns the original key for companies", () => {
    for (const l of labels) {
      const k = companyKey(l);
      expect(slugToKey(keyToSlug(k))).toBe(k);
    }
  });
  it("key -> slug -> key returns the original key for tags", () => {
    for (const l of labels) {
      const k = tagKey(l);
      expect(slugToKey(keyToSlug(k))).toBe(k);
    }
  });
});

describe("keyToSlug", () => {
  it("turns spaces into hyphens", () => {
    expect(keyToSlug("christopher nolan")).toBe("christopher-nolan");
    expect(keyToSlug("sci fi")).toBe("sci-fi");
  });
});

describe("slugToKey", () => {
  it("inverts a slug and is forgiving of case, doubled and stray separators", () => {
    expect(slugToKey("christopher-nolan")).toBe("christopher nolan");
    expect(slugToKey("Christopher--Nolan")).toBe("christopher nolan");
    expect(slugToKey("  naughty-dog  ")).toBe("naughty dog");
  });
  it("decodes percent-escapes and survives a malformed one", () => {
    expect(slugToKey("guillermo%20del-toro")).toBe("guillermo del toro");
    expect(slugToKey("100%-cotton")).toBe("100% cotton"); // lone % is invalid → used as-is
  });
});

describe("publicFacetHref", () => {
  it("routes each kind to its prefix, company -> /studio", () => {
    expect(publicFacetHref({ kind: "person", key: personKey("Christopher Nolan"), label: "Christopher Nolan" }))
      .toBe("/person/christopher-nolan");
    expect(publicFacetHref({ kind: "tag", key: tagKey("Sci-Fi") }))
      .toBe("/tag/sci-fi");
    expect(publicFacetHref({ kind: "company", role: "developer", key: companyKey("Naughty Dog, Inc.") }))
      .toBe("/studio/naughty-dog");
  });
  it("ignores role — every role folds into one combined page", () => {
    const key = personKey("Christopher Nolan");
    expect(publicFacetHref({ kind: "person", role: "director", key }))
      .toBe(publicFacetHref({ kind: "person", role: "writer", key }));
  });
});

describe("keyFor", () => {
  it("picks the matching normalizer per kind", () => {
    expect(keyFor("person", "Christopher Nolan")).toBe(personKey("Christopher Nolan"));
    expect(keyFor("company", "Naughty Dog, Inc.")).toBe(companyKey("Naughty Dog, Inc."));
    expect(keyFor("tag", "Sci-Fi")).toBe(tagKey("Sci-Fi"));
  });
});

describe("prefix guards", () => {
  it("recognizes the three prefixes and nothing else", () => {
    expect(FACET_PREFIXES).toEqual(["person", "tag", "studio"]);
    expect(isFacetPrefix("person")).toBe(true);
    expect(isFacetPrefix("studio")).toBe(true);
    expect(isFacetPrefix("movie")).toBe(false);
    expect(isFacetPrefix("api")).toBe(false);
  });
  it("maps studio back to the company kind", () => {
    expect(prefixToKind("studio")).toBe("company");
    expect(prefixToKind("person")).toBe("person");
    expect(prefixToKind("tag")).toBe("tag");
  });
});
