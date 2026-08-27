import { describe, it, expect } from "vitest";
import {
  MEDIA_TYPES, MEDIA_TYPE_LABELS, isMediaType, sanitizeMediaTypes,
  enabledMediaTypes, isTypeEnabled, narrowTypeFilter,
} from "./mediaTypes";

// "Which media types do you use Fandex for" (2026-08-27). The rules here are the
// ones that are invisible when they break: what an empty list means, and what
// happens to a filter chip naming a type you have since turned off.

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

describe("narrowTypeFilter — a chip for a type you turned off", () => {
  it("drops a stale chip selection naming a disabled type", () => {
    // Without this, "show me only games" plus "I do not use games" filters every
    // list to nothing, with no visible control to undo it. Same hidden-active-
    // filter trap as the platform chips.
    expect(narrowTypeFilter(["game"], ["movie", "show"])).toEqual([]);
    expect(narrowTypeFilter(["game", "movie"], ["movie", "show"])).toEqual(["movie"]);
  });

  it("leaves a valid selection alone", () => {
    expect(narrowTypeFilter(["movie"], ["movie", "show"])).toEqual(["movie"]);
  });

  it("leaves everything alone when not configured", () => {
    expect(narrowTypeFilter(["game"], [])).toEqual(["game"]);
  });

  it("returns an empty filter as an empty filter, which means 'all enabled types'", () => {
    // [] is how every list surface already spells "no type filter", so this
    // must not be confused with "nothing matches".
    expect(narrowTypeFilter([], ["movie"])).toEqual([]);
  });
});
