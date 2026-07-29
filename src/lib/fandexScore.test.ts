import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run } from "./db";
import { upsertMediaItem, upsertLibraryEntry } from "./matcher";
import { buildProfile, computeFandexScore, fandexCenterFor, facetImpact, Profile } from "./discovery";
import { Facet } from "./facets";
import { DEFAULT_SCORING_CONFIG } from "./scoringDefaults";

// S11 (2026-07-27): K was recalibrated 10 -> 25 against a real library (see
// SM13/H5.5); recalibrated again 2026-07-29 for the raw-sum aggregate (T3).
// These tests check the MAPPING FORMULA, not the specific K value, so they
// read the live default rather than hardcoding a magic number that the next
// recalibration would silently break.
const K_UP = DEFAULT_SCORING_CONFIG.mappingConstantUp;
const K_DOWN = DEFAULT_SCORING_CONFIG.mappingConstantDown;

// H5.2 — the Bayesian rescore + the visible Fandex Score aggregate.
//
// buildProfile() is tested against a real seeded library (DB integration —
// catches config-loader/category-lookup wiring bugs). computeFandexScore() is
// tested against a HAND-BUILT Profile (pure aggregation math — the top-N
// selection and the 50+K·rawSum mapping don't need a real library to verify).

initDb();

const USER = "u-fandex-score";

const TMDB = (id: number, title: string, genreNames: string[]) => ({
  id, title, release_date: "2020-01-01", poster_path: "/p.jpg", overview: "o",
  genres: genreNames.map((name) => ({ name })),
});

function movie(sourceId: string, title: string, genreNames: string[]) {
  return upsertMediaItem({
    source: "tmdb", sourceId, type: "movie", title, releaseDate: "2020-01-01",
    rawData: TMDB(Number(sourceId), title, genreNames),
  });
}

beforeEach(() => {
  run("DELETE FROM media_items");
  run("DELETE FROM users");
  run("INSERT INTO users (id) VALUES (?)", [USER]);
});

describe("buildProfile — Bayesian average (H5.2)", () => {
  it("computes BA_f/dev_f matching the textbook shrinkage formula, weighted by the tag category's weight", () => {
    // baseline = (9 + 7 + 3) / 3 = 6.3333...
    const a = movie("101", "Action A", ["Action"]);
    const b = movie("102", "Action B", ["Action"]);
    const c = movie("103", "Horror C", ["Horror"]);
    upsertLibraryEntry(USER, a, "tmdb", { status: "watched", rating: 9, reviewedAt: 1 });
    upsertLibraryEntry(USER, b, "tmdb", { status: "watched", rating: 7, reviewedAt: 2 });
    upsertLibraryEntry(USER, c, "tmdb", { status: "watched", rating: 3, reviewedAt: 3 });

    const profile = buildProfile(USER);
    const baseline = (9 + 7 + 3) / 3;
    expect(profile.baseline).toBeCloseTo(baseline, 6);

    const C = 5; // DEFAULT_SCORING_CONFIG.priorStrength
    const actionId = "tag||action";
    const horrorId = "tag||horror";

    const baAction = (C * baseline + (9 + 7)) / (C + 2);
    const baHorror = (C * baseline + 3) / (C + 1);
    expect(profile.meta.get(actionId)?.BA).toBeCloseTo(baAction, 6);
    expect(profile.meta.get(actionId)?.n).toBe(2);
    expect(profile.w.get(actionId)).toBeCloseTo(baAction - baseline, 6); // classWeight 1 (genre)

    expect(profile.meta.get(horrorId)?.BA).toBeCloseTo(baHorror, 6);
    expect(profile.w.get(horrorId)).toBeCloseTo(baHorror - baseline, 6);
    // Below baseline → a dislike emerges with no special-casing.
    expect(profile.w.get(horrorId)!).toBeLessThan(0);
  });

  it("excludes an ignored tag category (meta) from the profile entirely", () => {
    const a = movie("201", "Sequel Movie", ["Action", "Sequel"]);
    upsertLibraryEntry(USER, a, "tmdb", { status: "watched", rating: 9, reviewedAt: 1 });

    const profile = buildProfile(USER);
    expect(profile.w.has("tag||action")).toBe(true);
    // "Sequel" categorizes as meta (tags.ts META set), seeded ignored/weight 0.
    expect(profile.w.has("tag||sequel")).toBe(false);
    expect(profile.meta.has("tag||sequel")).toBe(false);
  });

  it("hasSignal is false for a user with no rated facets", () => {
    const profile = buildProfile(USER);
    expect(profile.hasSignal).toBe(false);
    expect(profile.w.size).toBe(0);
  });

  it("Q30: a cast member's BA is pulled toward their LEAD-billed rating more than their background one", () => {
    // "Famous Actor" tops the bill (index 0, prominence 1) in a movie rated 9,
    // and is buried at index 7 (prominence CAST_PROMINENCE_FLOOR = 0.4) in a
    // movie rated 3. The weighted BA must land closer to the lead performance's
    // rating than a plain (unweighted) average of 9 and 3 would.
    const castRow = (name: string, i: number) => ({ name, order: i });
    const leadMovie = upsertMediaItem({
      source: "tmdb", sourceId: "301", type: "movie", title: "Lead Movie", releaseDate: "2020-01-01",
      rawData: {
        id: 301, title: "Lead Movie", release_date: "2020-01-01", poster_path: "/p.jpg", overview: "o",
        genres: [], credits: { cast: [castRow("Famous Actor", 0)], crew: [] },
      },
    });
    const cameoMovie = upsertMediaItem({
      source: "tmdb", sourceId: "302", type: "movie", title: "Cameo Movie", releaseDate: "2020-01-01",
      rawData: {
        id: 302, title: "Cameo Movie", release_date: "2020-01-01", poster_path: "/p.jpg", overview: "o",
        genres: [], credits: {
          cast: [...Array(7).keys()].map((i) => castRow(`Filler ${i}`, i)).concat([castRow("Famous Actor", 7)]),
          crew: [],
        },
      },
    });
    upsertLibraryEntry(USER, leadMovie, "tmdb", { status: "watched", rating: 9, reviewedAt: 1 });
    upsertLibraryEntry(USER, cameoMovie, "tmdb", { status: "watched", rating: 3, reviewedAt: 2 });

    const profile = buildProfile(USER);
    const actorId = "person|cast|famous actor";
    const baseline = (9 + 3) / 2;
    const C = 5; // DEFAULT_SCORING_CONFIG.priorStrength
    const weightedSum = 9 * 1 + 3 * 0.4;
    const weightedCount = 1 + 0.4;
    const expectedBA = (C * baseline + weightedSum) / (C + weightedCount);
    const plainBA = (C * baseline + (9 + 3)) / (C + 2);

    expect(profile.meta.get(actorId)?.n).toBe(2); // display count stays plain
    expect(profile.meta.get(actorId)?.BA).toBeCloseTo(expectedBA, 6);
    expect(profile.meta.get(actorId)!.BA!).not.toBeCloseTo(plainBA, 2);
    expect(profile.meta.get(actorId)!.BA!).toBeGreaterThan(plainBA); // pulled toward the lead's 9, not the plain 6
  });
});

describe("computeFandexScore — aggregate (H5.2)", () => {
  const meta = (over: Partial<NonNullable<ReturnType<Profile["meta"]["get"]>>> & { classWeight: number }) =>
    ({ kind: "tag", key: "x", label: "X", ...over });

  it("2026-07-29: raw-sum aggregate mapped via 50 + K·Σ(dev·classWeight) — NOT divided by total weight", () => {
    // Two facets, weight 1 each: dev = +1 and -0.5 → rawSum = 1*1 + (-0.5*1) = 0.5.
    // (The old weighted-MEAN formula would have divided by totalWeight=2, giving
    // weightedDev 0.25 — this pins that the divisor is gone.)
    const facets: Facet[] = [
      { kind: "tag", key: "a", label: "A", category: "genre" },
      { kind: "tag", key: "b", label: "B", category: "genre" },
    ];
    const profile: Profile = {
      w: new Map([["tag||a", 1], ["tag||b", -0.5]]),
      meta: new Map([
        ["tag||a", meta({ key: "a", label: "A", category: "genre", classWeight: 1, BA: 1, n: 4 })],
        ["tag||b", meta({ key: "b", label: "B", category: "genre", classWeight: 1, BA: -0.5, n: 2 })],
      ]),
      baseline: 5,
      hasSignal: true,
      ratedItemCount: 10,
    };
    const result = computeFandexScore(facets, profile);
    expect(result).not.toBeNull();
    const rawSum = 1 * 1 + -0.5 * 1;
    expect(result!.score).toBeCloseTo(Math.round((50 + K_UP * rawSum) * 10) / 10, 6);
    // Reasons carry BA/n through for the expanded breakdown (§3.4).
    const a = result!.reasons.find((r) => r.label === "A")!;
    expect(a.BA).toBe(1);
    expect(a.n).toBe(4);

    // T10: facetImpact() and a COUNTED reason's contribution must be the same
    // number — that's the whole point of a canonical, item-independent impact
    // figure. (impact is ALSO populated on capped reasons, where it diverges
    // from contribution by design — that's covered separately below.)
    for (const r of result!.reasons) {
      const id = r.label === "A" ? "tag||a" : "tag||b";
      expect(r.impact).toBeCloseTo(facetImpact(id, profile)!, 6);
      expect(r.impact).toBeCloseTo(r.contribution, 6);
    }
  });

  it("2026-07-29: facetImpact() is item-independent — same tag, same impact, on two items with totally different other facets", () => {
    const profile: Profile = {
      w: new Map([["tag||shared", 2], ["tag||only-on-x", 5], ["tag||only-on-y", -3]]),
      meta: new Map([
        ["tag||shared", meta({ key: "shared", label: "Shared", category: "genre", classWeight: 1 })],
        ["tag||only-on-x", meta({ key: "only-on-x", label: "OnlyX", category: "genre", classWeight: 1 })],
        ["tag||only-on-y", meta({ key: "only-on-y", label: "OnlyY", category: "genre", classWeight: 1 })],
      ]),
      baseline: 5, hasSignal: true, ratedItemCount: 10,
    };
    const itemX: Facet[] = [
      { kind: "tag", key: "shared", label: "Shared", category: "genre" },
      { kind: "tag", key: "only-on-x", label: "OnlyX", category: "genre" },
    ];
    const itemY: Facet[] = [
      { kind: "tag", key: "shared", label: "Shared", category: "genre" },
      { kind: "tag", key: "only-on-y", label: "OnlyY", category: "genre" },
    ];
    const resultX = computeFandexScore(itemX, profile)!;
    const resultY = computeFandexScore(itemY, profile)!;
    const sharedOnX = resultX.reasons.find((r) => r.label === "Shared")!;
    const sharedOnY = resultY.reasons.find((r) => r.label === "Shared")!;
    // Different items, different OTHER facets, different scores — but the
    // SAME tag's impact is identical on both, and matches the standalone helper.
    expect(resultX.score).not.toBeCloseTo(resultY.score, 1);
    expect(sharedOnX.impact).toBeCloseTo(sharedOnY.impact!, 6);
    expect(sharedOnX.impact).toBeCloseTo(facetImpact("tag||shared", profile)!, 6);
  });

  it("2026-07-29: is deliberately UNBOUNDED — no clamp at 0 or 100 in either direction", () => {
    const positive: Facet[] = [{ kind: "tag", key: "a", label: "A", category: "genre" }];
    const profileUp: Profile = {
      w: new Map([["tag||a", 10]]), // rawSum 10 * K_up (>= 25) far overflows 100
      meta: new Map([["tag||a", meta({ key: "a", label: "A", category: "genre", classWeight: 1 })]]),
      baseline: 5, hasSignal: true, ratedItemCount: 10,
    };
    expect(computeFandexScore(positive, profileUp)!.score).toBeGreaterThan(100);

    const negative: Facet[] = [{ kind: "tag", key: "a", label: "A", category: "genre" }];
    const profileDown: Profile = {
      w: new Map([["tag||a", -10]]), // rawSum -10 * K_down far undershoots 0
      meta: new Map([["tag||a", meta({ key: "a", label: "A", category: "genre", classWeight: 1 })]]),
      baseline: 5, hasSignal: true, ratedItemCount: 10,
    };
    const downResult = computeFandexScore(negative, profileDown)!;
    expect(downResult.score).toBeLessThan(0);
    expect(downResult.score).toBeCloseTo(Math.round((50 + K_DOWN * -10) * 10) / 10, 6);
  });

  it("Q20: center is the user's own baseline×10, and center + Σ contributions == score (additive breakdown)", () => {
    const facets: Facet[] = [
      { kind: "tag", key: "a", label: "A", category: "genre" },
      { kind: "tag", key: "b", label: "B", category: "theme" },
      { kind: "person", key: "c", role: "director", label: "Director C" },
    ];
    const profile: Profile = {
      w: new Map([["tag||a", 1.4], ["tag||b", -0.6], ["person|director|c", 2.1]]),
      meta: new Map([
        ["tag||a", meta({ key: "a", label: "A", category: "genre", classWeight: 1 })],
        ["tag||b", meta({ key: "b", label: "B", category: "theme", classWeight: 1 })],
        ["person|director|c", meta({ key: "c", role: "director", label: "Director C", classWeight: 1.3 })],
      ]),
      baseline: 7.2, hasSignal: true, ratedItemCount: 10,
    };
    const result = computeFandexScore(facets, profile)!;
    expect(result.center).toBeCloseTo(72, 6); // baseline 7.2 × 10, NOT a fixed 50
    const sumContributions = result.reasons.reduce((acc, r) => acc + r.contribution, 0);
    expect(result.center + sumContributions).toBeCloseTo(result.score, 1);
  });

  it("2026-07-29: additivity holds even when the raw sum pushes the score past 100 (no clamp to compensate for)", () => {
    const facets: Facet[] = [
      { kind: "tag", key: "a", label: "A", category: "genre" },
      { kind: "tag", key: "b", label: "B", category: "theme" },
    ];
    const profile: Profile = {
      // baseline 9 (center 90) + a strongly positive rawSum blows well past 100 — unclamped now.
      w: new Map([["tag||a", 8], ["tag||b", 6]]),
      meta: new Map([
        ["tag||a", meta({ key: "a", label: "A", category: "genre", classWeight: 1 })],
        ["tag||b", meta({ key: "b", label: "B", category: "theme", classWeight: 1 })],
      ]),
      baseline: 9, hasSignal: true, ratedItemCount: 10,
    };
    const result = computeFandexScore(facets, profile)!;
    expect(result.score).toBeGreaterThan(100); // NOT clamped
    const sumContributions = result.reasons.reduce((acc, r) => acc + r.contribution, 0);
    expect(result.center + sumContributions).toBeCloseTo(result.score, 1);
  });

  it("2026-07-29: an item with 5 positive genre tags counts all 5 — the per-category cap of 3 used to exclude 2 of them", () => {
    // This is the user's own motivating example for replacing perCategoryCap
    // with a fixed-size top-N selection: "an item with 5 genre tags should
    // count all 5". Default topTagsPositive is 5, so nothing here is capped.
    const devs = [5, 4, 3, 2, 1];
    const w = new Map<string, number>();
    const metaMap = new Map<string, ReturnType<typeof meta>>();
    const facets: Facet[] = [];
    devs.forEach((d, i) => {
      const key = `t${i}`;
      const id = `tag||${key}`;
      w.set(id, d); // classWeight 1
      metaMap.set(id, meta({ key, label: key, category: "genre", classWeight: 1 }));
      facets.push({ kind: "tag", key, label: key, category: "genre" });
    });
    const profile: Profile = { w, meta: metaMap, baseline: 5, hasSignal: true, ratedItemCount: 10 };

    const result = computeFandexScore(facets, profile)!;
    const counted = result.reasons.filter((r) => !r.capped);
    expect(counted.length).toBe(5);
    expect(counted.map((r) => r.label).sort()).toEqual(["t0", "t1", "t2", "t3", "t4"]);
    expect(result.reasons.filter((r) => r.capped).length).toBe(0);

    const rawSum = devs.reduce((a, b) => a + b, 0);
    expect(result.score).toBeCloseTo(Math.round((50 + K_UP * rawSum) * 10) / 10, 6);
  });

  it("2026-07-29: a 300-tag item counts exactly topTagsPositive + topTagsNegative tags, the rest greyed out as capped", () => {
    const POSITIVE_N = DEFAULT_SCORING_CONFIG.topTagsPositive; // 5
    const NEGATIVE_N = DEFAULT_SCORING_CONFIG.topTagsNegative; // 3
    const w = new Map<string, number>();
    const metaMap = new Map<string, ReturnType<typeof meta>>();
    const facets: Facet[] = [];
    // 150 positive-dev tags (p0..p149, dev descending 150..1), 150 negative-dev
    // tags (n0..n149, dev ascending -150..-1, i.e. n0 is the MOST negative).
    for (let i = 0; i < 150; i++) {
      const posKey = `p${i}`, negKey = `n${i}`;
      w.set(`tag||${posKey}`, 150 - i);
      w.set(`tag||${negKey}`, -(150 - i));
      metaMap.set(`tag||${posKey}`, meta({ key: posKey, label: posKey, category: "genre", classWeight: 1 }));
      metaMap.set(`tag||${negKey}`, meta({ key: negKey, label: negKey, category: "genre", classWeight: 1 }));
      facets.push({ kind: "tag", key: posKey, label: posKey, category: "genre" });
      facets.push({ kind: "tag", key: negKey, label: negKey, category: "genre" });
    }
    expect(facets.length).toBe(300);
    const profile: Profile = { w, meta: metaMap, baseline: 5, hasSignal: true, ratedItemCount: 10 };

    const result = computeFandexScore(facets, profile)!;
    const counted = result.reasons.filter((r) => !r.capped);
    expect(counted.length).toBe(POSITIVE_N + NEGATIVE_N);
    // Highest-dev positives: p0..p4 (150..146). Most-negative: n0..n2 (-150..-148).
    expect(counted.map((r) => r.label).sort()).toEqual(
      ["n0", "n1", "n2", "p0", "p1", "p2", "p3", "p4"].sort()
    );
    expect(result.reasons.filter((r) => r.capped).length).toBe(300 - (POSITIVE_N + NEGATIVE_N));

    const sumContributions = result.reasons.reduce((acc, r) => acc + r.contribution, 0);
    expect(result.center + sumContributions).toBeCloseTo(result.score, 1);

    // T10: a capped reason's contribution is forced to 0 (so the additive sum
    // above holds), but its impact is still the tag's REAL standalone worth —
    // "not counted for THIS title" is not "worth nothing".
    const cappedP50 = result.reasons.find((r) => r.label === "p50")!;
    expect(cappedP50.capped).toBe(true);
    expect(cappedP50.contribution).toBe(0);
    expect(cappedP50.impact).toBeCloseTo(facetImpact("tag||p50", profile)!, 6);
    expect(cappedP50.impact).not.toBe(0);
  });

  it("2026-07-29: people and companies each get their OWN top-N selection, independent of the tag selection", () => {
    const facets: Facet[] = [
      { kind: "person", role: "director", key: "d1", label: "Director 1" },
      { kind: "person", role: "director", key: "d2", label: "Director 2" },
      { kind: "person", role: "cast", key: "c1", label: "Cast 1" },
      { kind: "person", role: "cast", key: "c2", label: "Cast 2" }, // 4th person, topPeople default 3 → capped (weakest |dev|)
      { kind: "company", role: "studio", key: "s1", label: "Studio 1" },
      { kind: "company", role: "studio", key: "s2", label: "Studio 2" },
      { kind: "company", role: "studio", key: "s3", label: "Studio 3" }, // 3rd company, topCompanies default 2 → capped
    ];
    const w = new Map([
      ["person|director|d1", 5], ["person|director|d2", 4], ["person|cast|c1", 3], ["person|cast|c2", 1],
      ["company|studio|s1", 5], ["company|studio|s2", 4], ["company|studio|s3", 3],
    ]);
    const metaMap = new Map([
      ["person|director|d1", meta({ key: "d1", role: "director", label: "Director 1", classWeight: 1 })],
      ["person|director|d2", meta({ key: "d2", role: "director", label: "Director 2", classWeight: 1 })],
      ["person|cast|c1", meta({ key: "c1", role: "cast", label: "Cast 1", classWeight: 1 })],
      ["person|cast|c2", meta({ key: "c2", role: "cast", label: "Cast 2", classWeight: 1 })],
      ["company|studio|s1", meta({ key: "s1", role: "studio", label: "Studio 1", classWeight: 1 })],
      ["company|studio|s2", meta({ key: "s2", role: "studio", label: "Studio 2", classWeight: 1 })],
      ["company|studio|s3", meta({ key: "s3", role: "studio", label: "Studio 3", classWeight: 1 })],
    ]);
    const profile: Profile = { w, meta: metaMap, baseline: 5, hasSignal: true, ratedItemCount: 10 };

    const result = computeFandexScore(facets, profile)!;
    const counted = result.reasons.filter((r) => !r.capped).map((r) => r.label).sort();
    expect(counted).toEqual(["Cast 1", "Director 1", "Director 2", "Studio 1", "Studio 2"]);
    const capped = result.reasons.filter((r) => r.capped).map((r) => r.label).sort();
    expect(capped).toEqual(["Cast 2", "Studio 3"]);
  });

  it("Q30: a lead-cast occurrence pulls the score harder than a cameo occurrence of the SAME person", () => {
    // One shared profile: "Lead" has a positive dev (BA above baseline), diluted
    // by a neutral tag (dev 0, classWeight 1) that doesn't move independently.
    // Scored once as billing position 0 (prominence 1) and once as a background
    // cameo (prominence 0.4) — only the CURRENT item's occurrence should differ.
    const profile: Profile = {
      w: new Map([["person|cast|lead", 3], ["tag||neutral", 0]]),
      meta: new Map([
        ["person|cast|lead", meta({ key: "lead", role: "cast", label: "Lead", classWeight: 1, BA: 8, n: 5 })],
        ["tag||neutral", meta({ key: "neutral", label: "Neutral", category: "genre", classWeight: 1, BA: 5, n: 5 })],
      ]),
      baseline: 5, hasSignal: true, ratedItemCount: 10,
    };
    const neutralTag: Facet = { kind: "tag", key: "neutral", label: "Neutral", category: "genre" };
    const asLead = computeFandexScore(
      [{ kind: "person", role: "cast", key: "lead", label: "Lead", prominence: 1 }, neutralTag],
      profile
    )!;
    const asCameo = computeFandexScore(
      [{ kind: "person", role: "cast", key: "lead", label: "Lead", prominence: 0.4 }, neutralTag],
      profile
    )!;
    expect(asLead.score).toBeGreaterThan(asCameo.score);
    // Additivity (Q20) must still hold at both prominence levels.
    const sumLead = asLead.reasons.reduce((acc, r) => acc + r.contribution, 0);
    const sumCameo = asCameo.reasons.reduce((acc, r) => acc + r.contribution, 0);
    expect(asLead.center + sumLead).toBeCloseTo(asLead.score, 1);
    expect(asCameo.center + sumCameo).toBeCloseTo(asCameo.score, 1);
  });

  it("returns null when no facet on the item matches the profile", () => {
    const profile: Profile = { w: new Map([["tag||known", 1]]), meta: new Map([["tag||known", meta({ key: "known", label: "Known", classWeight: 1 })]]), baseline: 5, hasSignal: true, ratedItemCount: 10 };
    const facets: Facet[] = [{ kind: "tag", key: "unknown", label: "Unknown", category: "genre" }];
    expect(computeFandexScore(facets, profile)).toBeNull();
  });

  it("returns null when the profile has no signal at all (cold start)", () => {
    const profile: Profile = { w: new Map(), meta: new Map(), baseline: 0, hasSignal: false, ratedItemCount: 0 };
    expect(computeFandexScore([{ kind: "tag", key: "a", label: "A", category: "genre" }], profile)).toBeNull();
  });

  it("§8 cold-start threshold: returns null below MIN_RATED_FOR_FANDEX_SCORE even with real facet signal", () => {
    // hasSignal is true (a real weighted facet exists) but only 1 rated item
    // backs it — below MIN_RATED_FOR_FANDEX_SCORE (3), so no number is shown
    // rather than one built on a single sample.
    const profile: Profile = {
      w: new Map([["tag||a", 3]]),
      meta: new Map([["tag||a", meta({ key: "a", label: "A", category: "genre", classWeight: 1, BA: 8, n: 1 })]]),
      baseline: 5, hasSignal: true, ratedItemCount: 1,
    };
    expect(computeFandexScore([{ kind: "tag", key: "a", label: "A", category: "genre" }], profile)).toBeNull();
  });
});

describe("§4 hard exclusions — community rating, popularity/browsed, release date never move the score", () => {
  it("identical facets score identically regardless of an item's community/browsed/date fields", () => {
    const profile: Profile = {
      w: new Map([["tag||a", 1]]),
      meta: new Map([["tag||a", { kind: "tag", key: "a", label: "A", category: "genre", classWeight: 1, BA: 1, n: 3 }]]),
      baseline: 5, hasSignal: true, ratedItemCount: 10,
    };
    const facets: Facet[] = [{ kind: "tag", key: "a", label: "A", category: "genre" }];

    // Two DiscoveryVector-shaped items, identical facets, wildly different
    // non-facet fields. computeFandexScore's signature has no parameter for
    // any of these — the exclusion is structural, this pins it as a regression
    // guard against a future change that threads the whole vector in.
    const vectorLowPopularity = { communityScore: 5, communityAvg: 5, browsed: 1, releaseDate: "1990-01-01", facets };
    const vectorHighPopularity = { communityScore: 99, communityAvg: 99, browsed: 0, releaseDate: "2099-01-01", facets };

    const scoreA = computeFandexScore(vectorLowPopularity.facets, profile);
    const scoreB = computeFandexScore(vectorHighPopularity.facets, profile);
    expect(scoreA).toEqual(scoreB);
    expect(scoreA!.score).toBe(computeFandexScore(facets, profile)!.score);
  });
});

describe("fandexCenterFor (S11)", () => {
  const base: Profile = { w: new Map(), meta: new Map(), baseline: 6.7, hasSignal: true, ratedItemCount: 10 };

  it("matches computeFandexScore's own center for an item that DOES share a facet", () => {
    const facets: Facet[] = [{ kind: "tag", key: "a", label: "A", category: "genre" }];
    const profile: Profile = {
      ...base,
      w: new Map([["tag||a", 1]]),
      meta: new Map([["tag||a", { kind: "tag", key: "a", label: "A", category: "genre", classWeight: 1, BA: 1, n: 3 }]]),
    };
    expect(fandexCenterFor(profile)).toBe(computeFandexScore(facets, profile)!.center);
  });

  it("still returns a center when no item shares any facet — unlike computeFandexScore, which returns null", () => {
    expect(computeFandexScore([], base)).toBeNull();
    expect(fandexCenterFor(base)).toBe(67); // baseline 6.7 * 10
  });

  it("returns null under the same cold-start gate computeFandexScore uses", () => {
    expect(fandexCenterFor({ ...base, hasSignal: false })).toBeNull();
    expect(fandexCenterFor({ ...base, ratedItemCount: 0 })).toBeNull();
  });
});
