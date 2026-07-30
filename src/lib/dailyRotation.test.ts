import { describe, it, expect } from "vitest";
import { dayISO, seedFor, rngFrom, pickWeighted, rotateRail } from "@/lib/dailyRotation";

// 2026-07-30 — Home's rails were `.sort()` + `.slice(0, 15)`, i.e. a fixed prefix
// of a fixed ranking, which is exactly why they looked identical every day
// ("the popular carousels feel like they show the same items everyday").
//
// The two properties that have to hold together, and are easy to break one at a
// time: STABLE within a day (or the rail reshuffles under you on Back, and the
// response can't be cached) and DIFFERENT across days (the actual bug).

const items = Array.from({ length: 40 }, (_, i) => `item-${i}`);

describe("seedFor", () => {
  it("is stable for the same parts", () => {
    expect(seedFor("a", "2026-07-30")).toBe(seedFor("a", "2026-07-30"));
  });

  it("differs for adjacent days", () => {
    expect(seedFor("x", "2026-07-30")).not.toBe(seedFor("x", "2026-07-31"));
  });

  it("differs for userIds one character apart", () => {
    // A naive length+charcode sum collides here, which would give two users the
    // same "personalised" rotation.
    expect(seedFor("user-a", "d")).not.toBe(seedFor("user-b", "d"));
  });

  it("does not collide on part boundaries", () => {
    expect(seedFor("ab", "c")).not.toBe(seedFor("a", "bc"));
  });
});

describe("rngFrom", () => {
  it("is deterministic and stays in [0,1)", () => {
    const a = Array.from({ length: 200 }, rngFrom(1234));
    const b = Array.from({ length: 200 }, rngFrom(1234));
    expect(a).toEqual(b);
    for (const v of a) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("pickWeighted", () => {
  it("returns exactly n distinct items", () => {
    const picked = pickWeighted(items, 15, rngFrom(7));
    expect(picked).toHaveLength(15);
    expect(new Set(picked).size).toBe(15);
  });

  it("returns everything (not a truncation) when n >= length", () => {
    expect(pickWeighted(items, 99, rngFrom(1))).toEqual(items);
  });

  it("favours the front of the ranking without guaranteeing it", () => {
    // Over many draws the top item must appear far more often than the last —
    // a uniform shuffle would bury strong matches and make the rail feel random
    // rather than fresh, which is worse than the bug being fixed.
    let firstHits = 0;
    let lastHits = 0;
    for (let s = 0; s < 300; s++) {
      const picked = pickWeighted(items, 5, rngFrom(s));
      if (picked.includes(items[0])) firstHits++;
      if (picked.includes(items[items.length - 1])) lastHits++;
    }
    expect(firstHits).toBeGreaterThan(lastHits * 2);
    // …but it must not be a fixed prefix: the tail has to surface sometimes.
    expect(lastHits).toBeGreaterThan(0);
  });

  it("handles an empty pool", () => {
    expect(pickWeighted([], 5, rngFrom(1))).toEqual([]);
  });
});

describe("rotateRail", () => {
  it("is stable for one day and different on the next", () => {
    const today = rotateRail(items, 15, seedFor("trending", "2026-07-30"));
    const again = rotateRail(items, 15, seedFor("trending", "2026-07-30"));
    const tomorrow = rotateRail(items, 15, seedFor("trending", "2026-07-31"));

    expect(again).toEqual(today);
    expect(tomorrow).not.toEqual(today);
  });

  it("keeps the top of the ranking as a stable spine", () => {
    // The strongest matches must not vanish on an unlucky draw.
    for (const seed of [1, 2, 3, 99]) {
      expect(rotateRail(items, 15, seed, 3).slice(0, 3)).toEqual(items.slice(0, 3));
    }
  });

  it("returns the whole pool untouched when it's no deeper than the rail", () => {
    const short = items.slice(0, 10);
    expect(rotateRail(short, 15, 42)).toEqual(short);
  });

  it("always fills the rail to size", () => {
    expect(rotateRail(items, 15, 5)).toHaveLength(15);
  });

  it("gives two users different recommendation rotations on the same day", () => {
    const a = rotateRail(items, 15, seedFor("recommendation", "user-a", "2026-07-30"));
    const b = rotateRail(items, 15, seedFor("recommendation", "user-b", "2026-07-30"));
    expect(a).not.toEqual(b);
  });
});

describe("dayISO", () => {
  it("formats UTC YYYY-MM-DD", () => {
    expect(dayISO(new Date("2026-07-30T23:59:00Z"))).toBe("2026-07-30");
  });
});
