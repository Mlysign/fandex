import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run } from "./db";
import { upsertMediaItem } from "./matcher";
import { TAG_RULES, ruleFor } from "./taxonomyRules";
import { categorizeTag } from "./tags";
import { getTagCategories, setTagCategoryOverrides } from "./scoringConfig";
import {
  runTaxonomySweep, dismissSuggestion, undismissSuggestion, listDismissed, invalidateSweepCache,
  type TagCategorySuggestion,
} from "./taxonomySuggestions";
import { invalidateDiscoveryCache } from "./discovery";

// The taxonomy sweep (2026-09-03). Nils: "can you do a sweep of all tags and
// franchises? the goal should be to have almost no tag in the 'other' category."
//
// Measured on the real catalog before any of this was written: 5,516 of 6,041
// tags sat in Other, or 91%.

initDb();

beforeEach(() => {
  run("DELETE FROM taxonomy_suggestion_dismissed");
  run("DELETE FROM tag_category_override");
  run("DELETE FROM media_items");
  run("DELETE FROM ip_alias");
  run("DELETE FROM item_ip_override");
  invalidateSweepCache();
  invalidateDiscoveryCache();
});

// ── the rule list itself ──────────────────────────────────────────────────

describe("the rules are internally consistent", () => {
  it("gives every rule a unique id, because a dismissal is keyed on it", () => {
    const ids = TAG_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never lists the same word under two rules", () => {
    // A duplicate is not an error so much as a silent ordering dependency: the
    // word index keeps whichever rule declares it first, so moving a rule up
    // the list would quietly move a tag to a different category.
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const r of TAG_RULES) {
      for (const w of r.words ?? []) {
        const prev = seen.get(w);
        if (prev) dupes.push(`"${w}" is in both ${prev} and ${r.id}`);
        else seen.set(w, r.id);
      }
    }
    expect(dupes).toEqual([]);
  });

  it("has no DEAD words: a word tags.ts already categorizes can never fire", () => {
    // Candidates are tags whose effective category is "other". So a rule word
    // that `categorizeTag` already places is unreachable — it looks like a
    // decision and does nothing. This caught 14 of them on the first run,
    // including four character words that tags.ts files under Theme.
    const dead = (TAG_RULES.flatMap((r) => (r.words ?? []).map((w) => ({ w, r: r.id }))))
      .filter(({ w }) => categorizeTag(w) !== "other")
      .map(({ w, r }) => `"${w}" [${r}] is already ${categorizeTag(w)}`);
    expect(dead).toEqual([]);
  });

  it("declares every category it targets, so a fresh database can accept it", () => {
    // `modes`, `objects-elements` and `people-characters` exist only because
    // somebody made them by hand in the live DB. A rule pointing at an id with
    // no row would write overrides that groupTagsByCategory cannot resolve, and
    // an unresolvable id falls back to "other" — so the accept would look like
    // it silently failed. Every rule must either target a built-in or bring its
    // own category.
    const built = new Set(getTagCategories().map((c) => c.id));
    const orphans = TAG_RULES
      .filter((r) => !built.has(r.category) && r.creates?.id !== r.category)
      .map((r) => `${r.id} -> ${r.category}`);
    expect(orphans).toEqual([]);
  });

  it("routes a representative key to the rule that should claim it", () => {
    expect(ruleFor("steam trading cards")?.id).toBe("store-plumbing");
    expect(ruleFor("pax east 2016")?.id).toBe("event-noise");
    expect(ruleFor("the game awards nominee")?.id).toBe("event-noise");
    expect(ruleFor("deckbuilding")?.id).toBe("mechanics");
    expect(ruleFor("online co op")?.id).toBe("modes");
    expect(ruleFor("helicopter")?.id).toBe("objects");
    expect(ruleFor("philadelphia, pennsylvania")?.id).toBe("setting-extra");
    expect(ruleFor("father son relationship")?.id).toBe("theme-extra");
  });

  it("does not let the place-shape pattern eat a bracketed list", () => {
    // "4x (explore, expand, exploit, and exterminate)" is IGDB's own name for
    // the 4X genre and it has three commas in it. A naive /,/ test on a tag
    // would file it under Setting, which is both wrong and invisible.
    expect(ruleFor("4x (explore, expand, exploit, and exterminate)")?.category).not.toBe("setting");
    expect(ruleFor("boston, massachusetts")?.category).toBe("setting");
  });
});

// ── the sweep ─────────────────────────────────────────────────────────────

function gameWithTags(sourceId: string, title: string, keywords: string[]) {
  return upsertMediaItem({
    source: "igdb", sourceId, type: "game", title, releaseDate: "2020-01-01",
    rawData: { id: Number(sourceId), name: title, keywords: keywords.map((name) => ({ name })) },
  });
}

describe("the sweep", () => {
  it("groups uncategorized tags under the rule that claims them", () => {
    gameWithTags("9001", "Sweep Test One", ["steam trading cards", "deckbuilding", "helicopter"]);
    const report = runTaxonomySweep();
    const cards = report.suggestions.filter((s): s is TagCategorySuggestion => s.kind === "tag-category");
    const byRule = new Map(cards.map((c) => [c.ref, c]));

    expect(byRule.get("store-plumbing")?.tags.map((t) => t.key)).toContain("steam trading cards");
    expect(byRule.get("mechanics")?.tags.map((t) => t.key)).toContain("deckbuilding");
    expect(byRule.get("objects")?.tags.map((t) => t.key)).toContain("helicopter");
    expect(byRule.get("store-plumbing")?.categoryId).toBe("meta");
  });

  it("stops suggesting a tag once it carries an override", () => {
    // This is what makes the queue self-emptying, and why accepted suggestions
    // need no bookkeeping of their own.
    gameWithTags("9002", "Sweep Test Two", ["steam trading cards"]);
    const before = runTaxonomySweep().suggestions
      .filter((s): s is TagCategorySuggestion => s.kind === "tag-category")
      .find((s) => s.ref === "store-plumbing");
    expect(before?.tags.some((t) => t.key === "steam trading cards")).toBe(true);

    setTagCategoryOverrides(["steam trading cards"], "meta");
    invalidateSweepCache();

    const after = runTaxonomySweep().suggestions
      .filter((s): s is TagCategorySuggestion => s.kind === "tag-category")
      .find((s) => s.ref === "store-plumbing");
    expect(after?.tags.some((t) => t.key === "steam trading cards") ?? false).toBe(false);
  });

  it("counts what Other would hold if every tag card were accepted", () => {
    gameWithTags("9003", "Sweep Test Three", ["steam trading cards", "deckbuilding", "zzz unknown tag"]);
    const { stats } = runTaxonomySweep();
    // The unknown tag is claimed by nothing, so it survives the sweep. That
    // difference is the number the whole screen is about.
    expect(stats.otherAfterAccepting).toBe(stats.otherTags - stats.tagsCovered);
    expect(stats.tagsCovered).toBeGreaterThan(0);
    expect(stats.otherAfterAccepting).toBeGreaterThan(0);
  });

  it("uses the category the DB ALREADY has, whichever id it was given", () => {
    // The bug this pins, caught by Nils on 2026-09-03 and not by any test:
    // "you said the categories i created are almost empty. that cant be true."
    //
    // He was right. The three hand-made categories have different ids on every
    // database, because each was typed in by hand — prod calls them `character`
    // / `object` / `mode` and holds 233 of his own overrides there, while the
    // dev copy calls them `people-characters` / `objects-elements` / `modes`.
    // Resolving by the rule's own id would have reported "creates this
    // category" on prod and, on accept, made a SECOND "Character / People"
    // beside his, splitting a year of retagging across two buckets that both
    // look right.
    gameWithTags("9007", "Sweep Test Seven", ["non player character"]);
    const card = () => runTaxonomySweep().suggestions
      .filter((s): s is TagCategorySuggestion => s.kind === "tag-category")
      .find((s) => s.ref === "characters");

    // Neither spelling exists yet, so the rule brings its own.
    expect(card()?.createsCategory).toEqual({ id: "character", label: "Character / People" });

    // Now give the DB the OTHER spelling, the one the rule does not prefer.
    run(
      `INSERT INTO tag_category (id, label, color, weight, ignored, sort_order)
       VALUES ('people-characters','People & Characters','#AC9A72',1,0,21)`
    );
    invalidateSweepCache();
    expect(card()?.categoryId).toBe("people-characters");
    expect(card()?.categoryLabel).toBe("People & Characters");
    expect(card()?.createsCategory).toBeNull();
    run(`DELETE FROM tag_category WHERE id = 'people-characters'`);
    invalidateSweepCache();
  });

  it("proposes a category when one does not exist yet, and stops once it does", () => {
    gameWithTags("9004", "Sweep Test Four", ["deckbuilding"]);
    const mechanics = () => runTaxonomySweep().suggestions
      .filter((s): s is TagCategorySuggestion => s.kind === "tag-category")
      .find((s) => s.ref === "mechanics");

    expect(mechanics()?.createsCategory).toEqual({ id: "mechanics", label: "Mechanics" });

    run(
      `INSERT INTO tag_category (id, label, color, weight, ignored, sort_order) VALUES ('mechanics','Mechanics','#AC9A72',1,0,20)`
    );
    invalidateSweepCache();
    expect(mechanics()?.createsCategory).toBeNull();
    run(`DELETE FROM tag_category WHERE id = 'mechanics'`);
  });
});

// ── dismissals ────────────────────────────────────────────────────────────

describe("denying a suggestion", () => {
  it("keeps it out of the queue, and puts it back on undo", () => {
    gameWithTags("9005", "Sweep Test Five", ["steam trading cards"]);
    const present = () => runTaxonomySweep().suggestions.some((s) => s.ref === "store-plumbing");
    expect(present()).toBe(true);

    dismissSuggestion("tag-category", "store-plumbing");
    expect(present()).toBe(false);
    expect(listDismissed()).toEqual([{ kind: "tag-category", ref: "store-plumbing" }]);

    undismissSuggestion("tag-category", "store-plumbing");
    expect(present()).toBe(true);
  });

  it("invalidates the sweep cache on write, or the denial looks like it failed", () => {
    // The sweep is two whole-catalog scans and is cached for 60s. Without the
    // invalidation inside dismissSuggestion, the card would sit on screen for
    // up to a minute after being denied.
    gameWithTags("9006", "Sweep Test Six", ["steam trading cards"]);
    runTaxonomySweep();                       // populate the cache
    dismissSuggestion("tag-category", "store-plumbing");
    expect(runTaxonomySweep().suggestions.some((s) => s.ref === "store-plumbing")).toBe(false);
  });

  it("is idempotent, so a double click is not an error", () => {
    dismissSuggestion("franchise-merge", "a>b");
    dismissSuggestion("franchise-merge", "a>b");
    expect(listDismissed()).toHaveLength(1);
  });
});
