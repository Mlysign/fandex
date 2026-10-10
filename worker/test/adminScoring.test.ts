import { beforeEach, describe, expect, it } from "vitest";
import {
  deleteCategory, parseCategory, parseCategoryWeights, parseScoringConfig, saveCategory, saveCategoryWeights, saveScoringConfig,
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
