import { describe, it, expect } from "vitest";
import {
  MEDIA_TYPES, MEDIA_TYPE_LABELS, isMediaType, sanitizeMediaTypes,
  enabledMediaTypes, isTypeEnabled, visibleTypes, typeIsVisible,
} from "./mediaTypes";

// "Which media types does every list START with" (2026-08-27, semantics reversed
// 2026-09-02). The rules here are the ones that are invisible when they break:
// what an empty stored list means, and whether a filter chip can override the
// setting. It can, and must — the chip row renders every type.

describe("the type list is derived, so a new type cannot be half-added", () => {
  it("lists exactly the keys of the labels record", () => {
    // AGENTS.md: adding a union member "compiles clean while silently doing
    // nothing at the other ~9 enumeration points". Deriving the array from a
    // Record<MediaType, string> moves that failure to compile time. This test
    // is the runtime half of the same guarantee.
    expect(MEDIA_TYPES).toEqual(Object.keys(MEDIA_TYPE_LABELS));
    expect(MEDIA_TYPES).toEqual(["game", "movie", "show"]);
  });

  it("gives every type a label", () => {
    for (const t of MEDIA_TYPES) {
      expect(MEDIA_TYPE_LABELS[t]).toBeTruthy();
    }
  });
});

describe("isMediaType / sanitizeMediaTypes", () => {
  it("accepts the known types and nothing else", () => {
    expect(isMediaType("game")).toBe(true);
    expect(isMediaType("book")).toBe(false);
    expect(isMediaType("")).toBe(false);
    expect(isMediaType(null)).toBe(false);
    // Inherited Object properties must not pass as types.
    expect(isMediaType("toString")).toBe(false);
    expect(isMediaType("constructor")).toBe(false);
  });

  it("drops unknown and duplicate entries and keeps order", () => {
    expect(sanitizeMediaTypes(["show", "book", "show", "game"])).toEqual(["show", "game"]);
    expect(sanitizeMediaTypes("game")).toEqual([]);
    expect(sanitizeMediaTypes(null)).toEqual([]);
  });
});

describe("an empty list means NOT CONFIGURED, never 'uses nothing'", () => {
  it("yields every type for empty, null and undefined", () => {
    // The alternative reading would leave a user staring at an app with every
    // list empty and no way to tell why. Same rule as users.platforms.
    expect(enabledMediaTypes([])).toEqual(MEDIA_TYPES);
    expect(enabledMediaTypes(null)).toEqual(MEDIA_TYPES);
    expect(enabledMediaTypes(undefined)).toEqual(MEDIA_TYPES);
  });

  it("yields every type when the stored value is entirely junk", () => {
    // A half-migrated or hand-edited row degrades to "not configured" rather
    // than to "nothing works".
    expect(enabledMediaTypes(["book", "boardgame"])).toEqual(MEDIA_TYPES);
  });

  it("yields exactly the configured subset otherwise", () => {
    expect(enabledMediaTypes(["movie", "show"])).toEqual(["movie", "show"]);
    expect(isTypeEnabled("game", ["movie", "show"])).toBe(false);
    expect(isTypeEnabled("movie", ["movie", "show"])).toBe(true);
    // Not configured: everything is on.
    expect(isTypeEnabled("game", [])).toBe(true);
  });
});

describe("the setting is a DEFAULT, not a scope", () => {
  // Reversed 2026-09-02. The first version narrowed a chip selection to the
  // enabled set AND hid the disabled type's chip; Nils: "i dont want to hide the
  // games filter here, just set the default to my pref."
  it("resolves an un-narrowed list to the account's default", () => {
    expect(visibleTypes([], ["movie", "show"])).toEqual(["movie", "show"]);
    expect(typeIsVisible("game", [], ["movie", "show"])).toBe(false);
    expect(typeIsVisible("movie", [], ["movie", "show"])).toBe(true);
  });

  it("lets an explicit chip selection OVERRIDE the default, including a type it turns off", () => {
    // The whole point of the reversal. The chip row renders every type, so
    // tapping Games has to show games — otherwise the control lies. The old
    // narrowTypeFilter returned [] here and the list fell back to movies+shows.
    expect(visibleTypes(["game"], ["movie", "show"])).toEqual(["game"]);
    expect(typeIsVisible("game", ["game"], ["movie", "show"])).toBe(true);
    expect(typeIsVisible("movie", ["game"], ["movie", "show"])).toBe(false);
  });

  it("honours a mixed selection exactly, without dropping the disabled half", () => {
    expect(visibleTypes(["game", "movie"], ["movie", "show"])).toEqual(["game", "movie"]);
  });

  it("falls back to every type when nothing is configured", () => {
    expect(visibleTypes([], [])).toEqual(MEDIA_TYPES);
    expect(visibleTypes([], null)).toEqual(MEDIA_TYPES);
  });

  it("treats a selection of only junk as no selection", () => {
    // A hand-edited or half-migrated sessionStorage value degrades to the
    // default rather than to an empty page.
    expect(visibleTypes(["book"], ["movie", "show"])).toEqual(["movie", "show"]);
  });
});
