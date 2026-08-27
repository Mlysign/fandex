import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run } from "./db";
import type { Profile } from "./discovery";
import { computeFandexScore, scoringContext } from "./discovery";
import type { Facet } from "./facets";
import { setIpAlias, setItemIpOverride } from "./ipAlias";
import { saveScoringConfig, getScoringConfig } from "./scoringConfig";

// Phase 0 of docs/catalog-growth.md: `computeFandexScore` used to call
// getScoringConfig(), getIpAliases() and getItemIpOverrides() once PER ITEM, and
// each of those runs a signature SELECT to check its own cache. Measured
// 2026-08-27 (scripts/probe-score.mjs): 79% of Fandex Score CPU was that cache
// validation, not scoring. Passing one `ScoringContext` per pass removes it.
//
// The whole claim of that change is "same inputs, fetched once, so the score
// cannot move". This file is that claim, executable. If a future edit makes the
// context path diverge from the per-item path, this fails.

initDb();

const ITEM = "item-ctx-test";

const meta = (o: Partial<{ key: string; label: string; category: string; classWeight: number; BA: number; n: number }>) => ({
  kind: "tag" as const, key: o.key ?? "k", label: o.label ?? "L", category: o.category,
  classWeight: o.classWeight ?? 1, BA: o.BA, n: o.n,
});

const profile: Profile = {
  w: new Map([
    ["tag||action", 1.5],
    ["tag||slow", -0.75],
    ["ip||canon", 2],
  ]),
  meta: new Map([
    ["tag||action", meta({ key: "action", label: "Action", category: "genre", classWeight: 1, BA: 1.5, n: 6 })],
    ["tag||slow", meta({ key: "slow", label: "Slow", category: "mood", classWeight: 0.8, BA: -0.75, n: 3 })],
    ["ip||canon", { kind: "ip" as const, key: "canon", label: "Canon", classWeight: 1.1, BA: 2, n: 2 }],
  ]),
  baseline: 6,
  hasSignal: true,
  ratedItemCount: 12,
};

const facets: Facet[] = [
  { kind: "tag", key: "action", label: "Action", category: "genre" },
  { kind: "tag", key: "slow", label: "Slow", category: "mood" },
  { kind: "ip", key: "aliased", label: "Aliased" },
];

beforeEach(() => {
  run("DELETE FROM ip_alias");
  run("DELETE FROM item_ip_override");
});

/** Both paths, same inputs. The context one is what every scoring loop now uses. */
function bothWays(id: string | null = ITEM) {
  const perItem = computeFandexScore(facets, profile, undefined, { mediaItemId: id });
  const withCtx = computeFandexScore(facets, profile, undefined, { mediaItemId: id, ctx: scoringContext() });
  return { perItem, withCtx };
}

describe("a ScoringContext changes nothing about the score", () => {
  it("matches with no aliases and no overrides", () => {
    const { perItem, withCtx } = bothWays();
    expect(withCtx).toEqual(perItem);
    expect(perItem?.score).toBeTypeOf("number");
  });

  it("matches when an ip alias rewrites a facet key", () => {
    // The alias is the reason applyIpFacets is in the hot path at all: it maps
    // the item's raw franchise key onto the canonical one the profile learned.
    setIpAlias("aliased", "canon");
    const { perItem, withCtx } = bothWays();
    expect(withCtx).toEqual(perItem);
    // And it actually took effect, or this test would pass on two nulls.
    expect(perItem?.reasons.some((r) => r.kind === "ip")).toBe(true);
  });

  it("matches when a per-item override removes a franchise", () => {
    setIpAlias("aliased", "canon");
    setItemIpOverride(ITEM, "canon", "remove", "Canon");
    const { perItem, withCtx } = bothWays();
    expect(withCtx).toEqual(perItem);
    expect(perItem?.reasons.some((r) => r.kind === "ip")).toBe(false);
  });

  it("matches for an item with no id (a live candidate, no override lookup)", () => {
    const { perItem, withCtx } = bothWays(null);
    expect(withCtx).toEqual(perItem);
  });

  it("carries a saved config change into both paths alike", () => {
    const before = computeFandexScore(facets, profile, undefined, { ctx: scoringContext() })!.score;
    saveScoringConfig({ ...getScoringConfig(), mappingConstantUp: getScoringConfig().mappingConstantUp * 2 });
    // A context built AFTER the save sees the save, exactly as a per-item
    // lookup would. What the change trades away is a config edit landing
    // mid-pass, which no scoring pass has ever relied on.
    const { perItem, withCtx } = bothWays(null);
    expect(withCtx).toEqual(perItem);
    expect(withCtx!.score).not.toBe(before);
  });
});
