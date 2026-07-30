import { describe, it, expect } from "vitest";
import {
  facetClassOf, facetColorVar, facetChipStyle, tagCategoryHex, FACET_HEX,
} from "./facetPalette";

// 2026-07-30 — four colours for the whole facet taxonomy, replacing 17 hues.
// What matters here is that the mapping is TOTAL (nothing falls through to an
// undefined var, which would render as an invalid CSS value and inherit) and
// that the genre/other-tag split is the only category-level distinction.

describe("facetClassOf", () => {
  it("maps people by kind and by role", () => {
    expect(facetClassOf({ kind: "person", role: "director" })).toBe("person");
    // Insights' per-role groups pass a role with no kind.
    for (const role of ["director", "writer", "creator", "cast"]) {
      expect(facetClassOf({ role })).toBe("person");
    }
  });

  it("maps companies by kind and by role", () => {
    expect(facetClassOf({ kind: "company", role: "studio" })).toBe("company");
    for (const role of ["developer", "publisher", "studio", "network"]) {
      expect(facetClassOf({ role })).toBe("company");
    }
  });

  it("splits genre out of the other tag categories", () => {
    expect(facetClassOf({ kind: "tag", category: "genre" })).toBe("genre");
    for (const category of ["setting", "mood", "theme", "artstyle", "source", "audience", "other", "meta"]) {
      expect(facetClassOf({ kind: "tag", category })).toBe("tag");
    }
  });

  it("puts an ADMIN-CREATED category on the shared tag colour, not undefined", () => {
    // The whole reason the axis is the class and not the category: /dev/scoring
    // can create a category at runtime, so the palette must already have an
    // answer for one it has never seen.
    expect(facetClassOf({ kind: "tag", category: "people-and-characters" })).toBe("tag");
  });

  it("falls back to the neutral tag colour for anything unrecognised", () => {
    expect(facetClassOf({})).toBe("tag");
    expect(facetClassOf({ kind: "tag" })).toBe("tag");
    expect(facetClassOf({ kind: "wat", role: "wat" })).toBe("tag");
    expect(facetClassOf({ role: null, kind: null })).toBe("tag");
  });
});

describe("css output", () => {
  it("always resolves to one of the four declared custom properties", () => {
    const vars = new Set([
      "var(--color-facet-person)", "var(--color-facet-genre)",
      "var(--color-facet-tag)", "var(--color-facet-company)",
    ]);
    for (const f of [
      { kind: "person", role: "cast" }, { kind: "company", role: "network" },
      { kind: "tag", category: "genre" }, { kind: "tag", category: "mood" }, {},
    ]) {
      expect(vars.has(facetColorVar(f))).toBe(true);
    }
  });

  it("builds the chip fill with color-mix, not a hex alpha suffix", () => {
    // The old call sites did `${color}22`, which is precisely what stopped the
    // colours from becoming themeable tokens.
    const style = facetChipStyle({ kind: "tag", category: "genre" });
    expect(style.color).toBe("var(--color-facet-genre)");
    expect(style.background).toBe("color-mix(in srgb, var(--color-facet-genre) 13%, transparent)");
    expect(facetChipStyle({ kind: "tag" }, 12).background).toContain("12%");
  });
});

describe("stored hex", () => {
  it("gives genre its own value and shares one for the rest", () => {
    expect(tagCategoryHex("genre")).toBe(FACET_HEX.genre);
    expect(tagCategoryHex("mood")).toBe(FACET_HEX.tag);
    expect(tagCategoryHex("brand-new")).toBe(FACET_HEX.tag);
  });

  it("is #rrggbb — the tag_category.color schema requires it", () => {
    for (const hex of Object.values(FACET_HEX)) expect(hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});
