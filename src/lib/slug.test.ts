import { describe, it, expect } from "vitest";
import { slugify } from "./slug";

describe("slugify (T5)", () => {
  it("lowercases and joins words with a single hyphen", () => {
    expect(slugify("People & Characters")).toBe("people-characters");
  });

  it("collapses a run of punctuation/whitespace into ONE separator, not one per character", () => {
    expect(slugify("Foo   &&&  Bar")).toBe("foo-bar");
  });

  it("strips leading and trailing separators", () => {
    expect(slugify("  -Leading and trailing-  ")).toBe("leading-and-trailing");
    expect(slugify("!!!Loud!!!")).toBe("loud");
  });

  it("passes an already-valid kebab id through unchanged", () => {
    expect(slugify("already-kebab")).toBe("already-kebab");
  });

  it("handles mixed punctuation, apostrophes and numbers", () => {
    expect(slugify("Sci-Fi / Fantasy (Top 10)")).toBe("sci-fi-fantasy-top-10");
    expect(slugify("Studio's Pick")).toBe("studio-s-pick");
  });

  it("returns an empty string for input with no alphanumerics", () => {
    expect(slugify("&&&")).toBe("");
    expect(slugify("")).toBe("");
  });
});
