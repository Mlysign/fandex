import { beforeEach, describe, expect, it } from "vitest";
import {
  clearIpOverride, clearLabel, clearTagOverride, deleteAlias, deleteBundle, deleteCategory, parseAliases, parseCategory, parseCategoryWeights, parseLabel,
  parseIpOverride, parseScoringConfig, parseTagOverrides, setIpOverride, saveCategory, saveCategoryWeights, saveScoringConfig, setAlias, setLabel, setTagOverrides,
} from "../src/adminScoring";
import { taxonomyJson } from "../src/catalog/read";
import { count, db, wipe } from "./helpers";

beforeEach(wipe);

const CONFIG = {
  roleWeights: { director: 1.5, cast: 0.8 },
  priorStrength: 5, mappingConstantUp: 12, mappingConstantDown: 8,
  topTagsPositive: 6, topTagsNegative: 3, topPeople: 4, topCompanies: 2, topIps: 1,
};

const taxonomy = async () => JSON.parse((await taxonomyJson(db)).body);

describe("the scoring config", () => {
  it("is taken whole or not at all", () => {
    expect(parseScoringConfig(CONFIG)).toEqual(CONFIG);
    expect(() => parseScoringConfig({ ...CONFIG, priorStrength: 0 })).toThrow("above zero");
    expect(() => parseScoringConfig({ ...CONFIG, topPeople: 2.5 })).toThrow("whole number");
    expect(() => parseScoringConfig({ ...CONFIG, roleWeights: { "Robert'); DROP": 1 } })).toThrow("Unknown role");
    expect(() => parseScoringConfig({ ...CONFIG, mappingConstantUp: "12" })).toThrow("must be a number");
    const { topIps: _gone, ...partial } = CONFIG;
    expect(() => parseScoringConfig(partial)).toThrow("topIps");
  });

  it("is what /v1/taxonomy serves after a save, with a version that only goes up", async () => {
    await saveScoringConfig(db, CONFIG);
    expect((await taxonomy()).scoring).toEqual({ config: CONFIG, version: 1 });
    await saveScoringConfig(db, { ...CONFIG, priorStrength: 9 });
    const after = (await taxonomy()).scoring;
    expect(after.version).toBe(2);
    expect(after.config.priorStrength).toBe(9);
    expect(await count("scoring_config")).toBe(1);
  });
});

describe("tag categories", () => {
  const genre = { id: "genre", label: "Genre", color: "#C8A24B", weight: 1, ignored: false };

  it("creates at the end of the list and edits in place", async () => {
    await saveCategory(db, parseCategory(genre));
    await saveCategory(db, parseCategory({ id: "mood", label: "Mood", color: "#5FE39A", weight: 0.5, ignored: false }));
    await saveCategory(db, parseCategory({ ...genre, label: "Genres" }));
    const cats = (await taxonomy()).tagCategories;
    expect(cats.map((c: { id: string; label: string; sortOrder: number }) => [c.id, c.label, c.sortOrder])).toEqual([["genre", "Genres", 0], ["mood", "Mood", 1]]);
  });

  it("refuses an id, a colour or a weight it cannot store", () => {
    expect(() => parseCategory({ ...genre, id: "Not Kebab" })).toThrow("lowercase-kebab");
    expect(() => parseCategory({ ...genre, color: "gold" })).toThrow("#rrggbb");
    expect(() => parseCategory({ ...genre, weight: -1 })).toThrow("negative");
    expect(() => parseCategoryWeights({ updates: [{ id: "genre", weight: 1 }] })).toThrow("ignored");
  });

  it("saves weights without touching a name or a colour", async () => {
    await saveCategory(db, parseCategory(genre));
    await saveCategoryWeights(db, parseCategoryWeights({ updates: [{ id: "genre", weight: 2.5, ignored: true }, { id: "no-such", weight: 1, ignored: false }] }));
    const [cat] = (await taxonomy()).tagCategories;
    expect(cat).toMatchObject({ id: "genre", label: "Genre", color: "#C8A24B", weight: 2.5, ignored: 1 });
    expect(await count("tag_category")).toBe(1);
  });

  it("takes a deleted category's hand-made assignments with it", async () => {
    await saveCategory(db, parseCategory(genre));
    await db.prepare("INSERT INTO tag_category_override (tag_key, category_id) VALUES ('noir', 'genre')").run();
    await deleteCategory(db, "genre");
    expect(await count("tag_category")).toBe(0);
    expect(await count("tag_category_override")).toBe(0);
  });
});

describe("tags", () => {
  const cat = (id: string) => saveCategory(db, parseCategory({ id, label: id, color: "#112233", weight: 1, ignored: false }));

  it("moves many tags into a category at once, and one back out", async () => {
    await cat("mood");
    const { tagKeys, categoryId } = parseTagOverrides({ tagKeys: ["dark", "cozy", "dark"], tagKey: "bleak", categoryId: "mood" });
    expect(await setTagOverrides(db, tagKeys, categoryId)).toBe(3);
    await clearTagOverride(db, "cozy");
    expect((await taxonomy()).tagCategoryOverrides).toEqual([["bleak", "mood"], ["dark", "mood"]]);
  });

  it("refuses a category that does not exist, in words", async () => {
    await expect(setTagOverrides(db, ["dark"], "nowhere")).rejects.toThrow("No such category");
    expect(() => parseTagOverrides({ categoryId: "mood" })).toThrow("tagKey or tagKeys required");
  });

  it("keeps aliases flat: no chain is ever stored", async () => {
    await setAlias(db, "tag_alias", "sci fi", "science fiction");
    // Bundling the canonical into something else re-points its members too.
    await setAlias(db, "tag_alias", "science fiction", "sf");
    expect((await taxonomy()).tagAliases).toEqual([["sci fi", "sf"], ["science fiction", "sf"]]);
    // Aiming at a member lands on that member's canonical.
    await setAlias(db, "tag_alias", "scifi", "sci fi");
    expect((await taxonomy()).tagAliases).toContainEqual(["scifi", "sf"]);
    await expect(setAlias(db, "tag_alias", "sf", "sci fi")).rejects.toThrow("alias of itself");
  });

  it("takes one name out of a bundle, or the whole bundle apart", async () => {
    await setAlias(db, "tag_alias", "a", "x");
    await setAlias(db, "tag_alias", "b", "x");
    await setAlias(db, "ip_alias", "star wars saga", "star wars");
    await deleteAlias(db, "tag_alias", "a");
    expect((await taxonomy()).tagAliases).toEqual([["b", "x"]]);
    await deleteBundle(db, "tag_alias", "x");
    const after = await taxonomy();
    expect(after.tagAliases).toEqual([]);
    // The other table is a different list.
    expect(after.ipAliases).toEqual([["star wars saga", "star wars"]]);
  });

  it("stores a chosen display name trimmed, and forgets it on request", async () => {
    const l = parseLabel({ kind: "tag", key: "sf", label: "  Science Fiction " });
    await setLabel(db, l.kind, l.key, l.label);
    expect((await taxonomy()).facetLabels).toEqual([["tag", "sf", "Science Fiction"]]);
    expect(() => parseLabel({ kind: "tag", key: "sf", label: "   " })).toThrow("cannot be blank");
    expect(() => parseLabel({ kind: "person", key: "x", label: "X" })).toThrow("tag or ip");
    await clearLabel(db, "tag", "sf");
    expect((await taxonomy()).facetLabels).toEqual([]);
    expect(parseAliases({ canonical: "sf", members: ["a"], displayLabel: " SF " }).displayLabel).toBe("SF");
  });
});

describe("franchises", () => {
  const ITEM = "11111111-2222-4333-8444-555555555555";

  it("attaches by name and lands on the bundled franchise", async () => {
    await setAlias(db, "ip_alias", "star wars saga", "star wars");
    // "The Star Wars Saga Collection" peels to "star wars saga", which is bundled into "star wars".
    const o = parseIpOverride({ mediaItemId: ITEM.toUpperCase(), mode: "add", label: "Star Wars Saga Collection" });
    expect(await setIpOverride(db, o)).toEqual({ ipKey: "star wars" });
    expect((await taxonomy()).itemIpOverrides).toEqual([
      { mediaItemId: ITEM, ipKey: "star wars", label: "Star Wars Saga Collection", mode: "add", source: "manual" },
    ]);
  });

  it("turns an attach into a detach in place, and forgets either on request", async () => {
    await setIpOverride(db, parseIpOverride({ mediaItemId: ITEM, mode: "add", label: "Alien" }));
    await setIpOverride(db, parseIpOverride({ mediaItemId: ITEM, mode: "remove", ipKey: "alien", label: "Alien" }));
    expect((await taxonomy()).itemIpOverrides).toMatchObject([{ ipKey: "alien", mode: "remove" }]);
    await clearIpOverride(db, ITEM, "alien");
    expect((await taxonomy()).itemIpOverrides).toEqual([]);
  });

  it("refuses an id that is not an item, a mode it does not know, and an empty name", async () => {
    expect(() => parseIpOverride({ mediaItemId: "x", mode: "add", label: "Alien" })).toThrow("item id");
    expect(() => parseIpOverride({ mediaItemId: ITEM, mode: "replace", label: "Alien" })).toThrow("add or remove");
    await expect(setIpOverride(db, parseIpOverride({ mediaItemId: ITEM, mode: "add", label: "!!!" }))).rejects.toThrow("Empty franchise key");
  });
});
