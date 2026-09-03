import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run } from "./db";
import { setFacetLabel, clearFacetLabel, getFacetLabel, displayLabel, facetLabelSignature } from "./facetLabel";
import { applyTagAliases, setTagAlias } from "./tagAlias";
import { applyIpFacets, setIpAlias } from "./ipAlias";
import type { Facet } from "./facets";

// 2026-09-03. Nils: "when i bundle franchises or tags, i need an option to
// choose which version i want to use as display name on fandex. the other name
// should then never be displayed again on fandex."
//
// The second sentence is the test suite. `tag_alias` and `ip_alias` map a member
// KEY to a canonical KEY and neither maps a LABEL, so `applyTagAliases` rewrote
// the key and kept whatever label arrived on the facet. A bundle therefore
// rendered under whichever spelling the item in front of you happened to carry,
// and the catalog vocab's label was whichever member was folded FIRST, which
// depends on catalog order. Bundling "rpg" into "role playing (rpg)" did not
// stop "RPG" being displayed anywhere.

initDb();

const tag = (key: string, label: string): Facet => ({ kind: "tag", key, label });
const ip = (key: string, label: string): Facet => ({ kind: "ip", role: "ip", key, label });

beforeEach(() => {
  run("DELETE FROM facet_label_override");
  run("DELETE FROM tag_alias");
  run("DELETE FROM ip_alias");
});

describe("choosing which name a tag is shown under", () => {
  it("shows the chosen name whichever member the item carries", () => {
    setTagAlias("rpg", "role playing (rpg)");
    setFacetLabel("tag", "role playing (rpg)", "Role-Playing");

    // The item that carries the ALIAS spelling.
    expect(applyTagAliases([tag("rpg", "RPG")])[0]).toMatchObject({
      key: "role playing (rpg)",
      label: "Role-Playing",
    });
    // …and the item that carries the canonical one. Before this, these two
    // returned different labels for the same tag.
    expect(applyTagAliases([tag("role playing (rpg)", "Role Playing (RPG)")])[0]).toMatchObject({
      key: "role playing (rpg)",
      label: "Role-Playing",
    });
  });

  it("collapses an item carrying BOTH spellings to one chip with the chosen name", () => {
    setTagAlias("rpg", "role playing (rpg)");
    setFacetLabel("tag", "role playing (rpg)", "Role-Playing");

    const out = applyTagAliases([tag("rpg", "RPG"), tag("role playing (rpg)", "Role Playing (RPG)")]);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("Role-Playing");
  });

  it("keeps the old behaviour when no name has been chosen", () => {
    // The canonical's own spelling still wins over a member's, which is what the
    // bundle did before this feature and what an un-named bundle should keep
    // doing. Choosing a name is opt-in.
    setTagAlias("rpg", "role playing (rpg)");
    const out = applyTagAliases([tag("rpg", "RPG"), tag("role playing (rpg)", "Role Playing (RPG)")]);
    expect(out[0].label).toBe("Role Playing (RPG)");
  });

  it("names a tag that is in NO bundle at all", () => {
    // Falls out of keying by (kind, key) rather than by bundle, and it is what
    // the first badly-spelled provider tag will need.
    setFacetLabel("tag", "sci fi", "Science Fiction");
    expect(applyTagAliases([tag("sci fi", "sci-fi")])[0].label).toBe("Science Fiction");
  });

  it("reverts to the provider's spelling when cleared", () => {
    setFacetLabel("tag", "sci fi", "Science Fiction");
    clearFacetLabel("tag", "sci fi");
    expect(getFacetLabel("tag", "sci fi")).toBeNull();
    expect(applyTagAliases([tag("sci fi", "sci-fi")])[0].label).toBe("sci-fi");
  });

  it("refuses a blank name rather than storing one nothing can display", () => {
    expect(() => setFacetLabel("tag", "x", "   ")).toThrow();
  });

  it("trims, so a stray space does not become part of the name", () => {
    setFacetLabel("tag", "x", "  Sci-Fi  ");
    expect(getFacetLabel("tag", "x")).toBe("Sci-Fi");
  });
});

describe("the same for franchises", () => {
  it("shows the chosen name whichever member the item carries", () => {
    setIpAlias("metal gear solid", "metal gear");
    setFacetLabel("ip", "metal gear", "Metal Gear Solid");

    expect(applyIpFacets([ip("metal gear solid", "Metal Gear Solid")])[0]).toMatchObject({
      key: "metal gear",
      label: "Metal Gear Solid",
    });
    expect(applyIpFacets([ip("metal gear", "Metal Gear")])[0].label).toBe("Metal Gear Solid");
  });

  it("is keyed separately from tags, so the two cannot collide", () => {
    setFacetLabel("tag", "x", "Tag Name");
    setFacetLabel("ip", "x", "Franchise Name");
    expect(displayLabel("tag", "x", "fallback")).toBe("Tag Name");
    expect(displayLabel("ip", "x", "fallback")).toBe("Franchise Name");
  });
});

describe("the caches that have to notice", () => {
  it("moves its signature on every write and every clear", () => {
    // ⚠️ This signature is folded into scoringConfigSignature AND into
    // discovery's aliasSig. Without the second one a chosen name would sit in
    // the catalog pool's stale vocab for up to the five-minute TTL and the admin
    // edit would look like it did nothing — exactly the trap the ip signatures
    // hit in 2026-08-21.
    const before = facetLabelSignature();
    setFacetLabel("tag", "x", "One");
    const afterSet = facetLabelSignature();
    expect(afterSet).not.toBe(before);

    clearFacetLabel("tag", "x");
    expect(facetLabelSignature()).not.toBe(afterSet);
  });

  it("is read through by scoringConfigSignature", async () => {
    const { scoringConfigSignature } = await import("./scoringConfig");
    const before = scoringConfigSignature();
    setFacetLabel("tag", "y", "Two");
    expect(scoringConfigSignature()).not.toBe(before);
  });
});
