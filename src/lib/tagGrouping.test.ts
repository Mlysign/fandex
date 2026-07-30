import { describe, it, expect } from "vitest";
import { groupTagsByCategory, categorizeTag, CATEGORIES } from "./tags";

// 2026-07-30 — the item page's tag chips grouped by categorizeTag() alone, so a
// tag reassigned in /dev/scoring's tag table kept listing under its OLD heading
// (for every viewer) while the inline picker on that same chip showed the new
// one. These pin the two rules that fix it: an override wins, and the display
// order comes from the LIVE category table rather than the static const.

// Mirrors the live tag_category table: the static CATEGORIES const plus an
// admin-created category the const doesn't know about.
const LIVE = [
  ...CATEGORIES.map((c) => ({ id: c.id, label: c.label, color: c.color })),
  { id: "people-characters", label: "People & Characters", color: "#e879f9" },
];

const flat = (groups: ReturnType<typeof groupTagsByCategory>) =>
  groups.flatMap((g) => g.items.map((i) => `${g.id}:${i.key}`));

describe("groupTagsByCategory", () => {
  it("an override wins over categorizeTag()'s heuristic", () => {
    // "role playing (rpg)" is a real override in the live DB → genre.
    expect(categorizeTag("role playing (rpg)")).not.toBe("genre");

    const groups = groupTagsByCategory(
      [{ key: "role playing (rpg)", label: "Role-playing (RPG)" }],
      { "role playing (rpg)": "genre" },
      LIVE,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("genre");
    expect(groups[0].items[0].label).toBe("Role-playing (RPG)");
  });

  it("falls back to the heuristic for a tag with no override", () => {
    const groups = groupTagsByCategory([{ key: "action", label: "Action" }], {}, LIVE);
    expect(groups[0].id).toBe(categorizeTag("action"));
  });

  it("renders a category present in the live table but absent from the static const", () => {
    // The old `for (const c of CATEGORIES)` loop emitted no group for an id it
    // didn't know, so this chip disappeared from the page entirely.
    expect(CATEGORIES.some((c) => c.id === "people-characters")).toBe(false);

    const groups = groupTagsByCategory(
      [{ key: "sherlock holmes", label: "Sherlock Holmes" }],
      { "sherlock holmes": "people-characters" },
      LIVE,
    );

    expect(flat(groups)).toEqual(["people-characters:sherlock holmes"]);
    expect(groups[0].label).toBe("People & Characters");
  });

  it("buckets an override pointing at a deleted category into `other` rather than dropping it", () => {
    const groups = groupTagsByCategory(
      [{ key: "ghosts", label: "Ghosts" }],
      { ghosts: "since-deleted-category" },
      LIVE,
    );
    expect(flat(groups)).toEqual(["other:ghosts"]);
  });

  it("keeps a static category the live table omits, so the admin table can only add", () => {
    const groups = groupTagsByCategory(
      [{ key: "action", label: "Action" }],
      {},
      [{ id: "people-characters", label: "People & Characters", color: "#e879f9" }],
    );
    // "genre" isn't in the live list passed above, but must not swallow the chip.
    expect(flat(groups)).toEqual(["genre:action"]);
  });

  it("follows the live table's order, appending unknown-to-it static categories", () => {
    const groups = groupTagsByCategory(
      [
        { key: "action", label: "Action" },
        { key: "sherlock holmes", label: "Sherlock Holmes" },
      ],
      { "sherlock holmes": "people-characters" },
      [
        { id: "people-characters", label: "People & Characters", color: "#e879f9" },
        { id: "genre", label: "Genre", color: "#4ade80" },
      ],
    );
    expect(groups.map((g) => g.id)).toEqual(["people-characters", "genre"]);
  });

  it("dedupes by key (first label wins) and skips empty keys", () => {
    const groups = groupTagsByCategory(
      [
        { key: "action", label: "Action" },
        { key: "action", label: "ACTION" },
        { key: "", label: "" },
      ],
      {},
      LIVE,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toEqual([{ key: "action", label: "Action" }]);
  });

  it("accepts the override map as a Map as well as a plain object", () => {
    const groups = groupTagsByCategory(
      [{ key: "cyberpunk", label: "Cyberpunk" }],
      new Map([["cyberpunk", "setting"]]),
      LIVE,
    );
    expect(groups[0].id).toBe("setting");
  });

  it("emits no group for a category with no tags", () => {
    const groups = groupTagsByCategory([{ key: "action", label: "Action" }], {}, LIVE);
    expect(groups).toHaveLength(1);
  });
});
