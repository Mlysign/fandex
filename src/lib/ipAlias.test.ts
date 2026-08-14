import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run } from "./db";
import type { Facet } from "./facets";
import {
  canonicalIpKey, applyIpFacets, listIpBundles, setIpAlias, deleteIpAlias, deleteIpBundle,
  setItemIpOverride, deleteItemIpOverride, listItemIpOverrides, invalidateIpCaches,
} from "./ipAlias";

// Franchise bundling + per-item corrections (2026-08-14). The bundling half
// mirrors tagAlias.test.ts; the override half is new and is what makes shows
// reachable at all — no provider links a series to a franchise, so an 'add' row
// is the only thing that can.

initDb();

const ip = (key: string, label = key): Facet => ({ kind: "ip", role: "ip", key, label });
const tag = (key: string): Facet => ({ kind: "tag", key, label: key, category: "genre" });

beforeEach(() => {
  run("DELETE FROM ip_alias");
  run("DELETE FROM item_ip_override");
  invalidateIpCaches();
});

describe("ip bundling", () => {
  it("resolves a member spelling to its canonical", () => {
    setIpAlias("metal gear solid", "metal gear");
    expect(canonicalIpKey("metal gear solid")).toBe("metal gear");
    expect(canonicalIpKey("metal gear")).toBe("metal gear");   // canonical maps to itself
    expect(canonicalIpKey("half life")).toBe("half life");     // unbundled passes through
  });

  it("collapses both spellings on one item into a single facet", () => {
    setIpAlias("metal gear solid", "metal gear");
    const out = applyIpFacets([ip("metal gear solid", "Metal Gear Solid"), ip("metal gear", "Metal Gear")]);
    expect(out.filter((f) => f.kind === "ip")).toHaveLength(1);
    expect(out[0].key).toBe("metal gear");
  });

  it("leaves non-ip facets alone", () => {
    setIpAlias("metal gear solid", "metal gear");
    const out = applyIpFacets([tag("action"), ip("metal gear solid"), tag("stealth")]);
    expect(out.map((f) => f.kind)).toEqual(["tag", "ip", "tag"]);
  });

  it("flattens chains on write, so resolution stays one lookup", () => {
    setIpAlias("a", "b");
    setIpAlias("b", "c");
    // a was pointing at b; b now points at c, so a must have been re-pointed too.
    expect(canonicalIpKey("a")).toBe("c");
    expect(canonicalIpKey("b")).toBe("c");
  });

  it("resolves the target's own canonical before writing", () => {
    setIpAlias("b", "c");
    setIpAlias("a", "b"); // b is itself an alias of c
    expect(canonicalIpKey("a")).toBe("c");
  });

  it("rejects a self-alias", () => {
    expect(() => setIpAlias("star wars", "star wars")).toThrow(/itself/);
  });

  it("lists bundles grouped by canonical, and dissolves them", () => {
    setIpAlias("metal gear solid", "metal gear");
    setIpAlias("mgs", "metal gear");
    expect(listIpBundles()).toEqual([{ canonical: "metal gear", members: ["metal gear solid", "mgs"] }]);

    deleteIpAlias("mgs");
    expect(listIpBundles()).toEqual([{ canonical: "metal gear", members: ["metal gear solid"] }]);

    deleteIpBundle("metal gear");
    expect(listIpBundles()).toEqual([]);
    expect(canonicalIpKey("metal gear solid")).toBe("metal gear solid");
  });
});

describe("per-item franchise corrections", () => {
  it("ATTACHES a franchise to an item the providers know nothing about", () => {
    // The shows case: TMDB has no collection concept for series and IGDB covers
    // only games, so nothing links The Mandalorian to Star Wars. Its facet list
    // is genuinely empty of ip facets until an override says otherwise.
    expect(applyIpFacets([tag("action")], "mando")).toHaveLength(1);

    setItemIpOverride("mando", "Star Wars", "add");
    const out = applyIpFacets([tag("action")], "mando");
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ kind: "ip", role: "ip", key: "star wars", label: "Star Wars" });
  });

  it("normalizes an attached label through ipKey, so a hand-typed name lands on the right facet", () => {
    const { ipKey } = setItemIpOverride("x", "Star Wars Collection", "add");
    expect(ipKey).toBe("star wars"); // same key an IGDB "Star Wars" franchise produces
  });

  it("attaches onto the BUNDLE canonical rather than re-creating a split", () => {
    setIpAlias("metal gear solid", "metal gear");
    const { ipKey } = setItemIpOverride("mgs2", "Metal Gear Solid", "add");
    expect(ipKey).toBe("metal gear");
    expect(applyIpFacets([], "mgs2")[0].key).toBe("metal gear");
  });

  it("DETACHES a wrong franchise the provider supplied", () => {
    setItemIpOverride("showX", "x", "remove");
    // "X" the show matched the "X Collection" franchise key by title — wrong.
    expect(applyIpFacets([ip("x", "X Collection")], "showX")).toHaveLength(0);
  });

  it("detaches whichever member spelling the provider used, by matching the canonical", () => {
    setIpAlias("metal gear solid", "metal gear");
    setItemIpOverride("item1", "metal gear", "remove");
    // The provider supplied the MEMBER spelling; the remove was recorded on the
    // canonical. Matching on the raw key would have missed it.
    expect(applyIpFacets([ip("metal gear solid")], "item1")).toHaveLength(0);
  });

  it("an explicit remove wins over an add for the same key", () => {
    setItemIpOverride("item2", "star wars", "add");
    setItemIpOverride("item2", "star wars", "remove"); // same PK — mode is updated
    expect(applyIpFacets([], "item2")).toHaveLength(0);
  });

  it("applies to the named item ONLY", () => {
    setItemIpOverride("mando", "Star Wars", "add");
    expect(applyIpFacets([], "andor")).toHaveLength(0);
    expect(applyIpFacets([], undefined)).toHaveLength(0);
  });

  it("is idempotent — resolving twice is a no-op, which is what makes it safe to call at several layers", () => {
    setIpAlias("metal gear solid", "metal gear");
    setItemIpOverride("i", "Star Wars", "add");
    const once = applyIpFacets([ip("metal gear solid"), tag("action")], "i");
    const twice = applyIpFacets(once, "i");
    expect(twice).toEqual(once);
  });

  it("never duplicates a franchise the provider ALREADY supplied", () => {
    setItemIpOverride("i", "Star Wars", "add");
    expect(applyIpFacets([ip("star wars", "Star Wars Collection")], "i").filter((f) => f.kind === "ip"))
      .toHaveLength(1);
  });

  it("a WIKIDATA write never overwrites a MANUAL one", () => {
    // The correction has to survive the next sweep, or the panel looks like it
    // ignored the click. Detaching Star Wars by hand, then letting Wikidata
    // re-assert it, is the exact sequence that would undo it.
    setItemIpOverride("andor", "Star Wars", "remove", "Star Wars", "manual");
    setItemIpOverride("andor", "Star Wars", "add", "Star Wars", "wikidata");

    const rows = listItemIpOverrides().filter((r) => r.mediaItemId === "andor");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ mode: "remove", source: "manual" });
    expect(applyIpFacets([ip("star wars")], "andor")).toHaveLength(0);
  });

  it("a MANUAL write DOES overwrite a wikidata one, and a sweep may refresh its own", () => {
    setItemIpOverride("item9", "Star Wars", "add", "Star Wars", "wikidata");
    setItemIpOverride("item9", "Star Wars", "remove", "Star Wars", "manual");
    expect(listItemIpOverrides()[0]).toMatchObject({ mode: "remove", source: "manual" });

    setItemIpOverride("item10", "Fallout", "add", "Fallout", "wikidata");
    setItemIpOverride("item10", "Fallout", "add", "Fallout series", "wikidata");
    const w = listItemIpOverrides().filter((r) => r.mediaItemId === "item10");
    expect(w).toHaveLength(1);
    expect(w[0].label).toBe("Fallout series");
  });

  it("defaults to manual provenance when none is given", () => {
    setItemIpOverride("item11", "Star Wars", "add");
    expect(listItemIpOverrides()[0].source).toBe("manual");
  });

  it("lists and deletes overrides", () => {
    setItemIpOverride("i", "Star Wars", "add");
    const rows = listItemIpOverrides();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ mediaItemId: "i", ipKey: "star wars", mode: "add" });

    deleteItemIpOverride("i", "Star Wars");
    expect(listItemIpOverrides()).toHaveLength(0);
  });
});
