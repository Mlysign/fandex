import { describe, it, expect } from "vitest";
import {
  dayISO, seedFor, rngFrom, pickWeighted, rotateRail, rotationSlot, rotateRailFresh,
} from "@/lib/dailyRotation";

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

// 2026-08-14 — "I keep seeing the same items in my recommended carousel."
// The point of rotateRailFresh over rotateRail is that turnover is a GUARANTEE,
// not a probability: two independent weighted draws from a front-loaded ranking
// overlap heavily however good the RNG is, which is exactly why re-seeding
// alone never fixed this. These tests assert the guarantee, not the randomness.
describe("rotationSlot", () => {
  it("advances once per period and is stable within one", () => {
    const a = new Date("2026-08-14T00:00:00Z");
    const b = new Date("2026-08-14T05:59:59Z");
    const c = new Date("2026-08-14T06:00:00Z");
    expect(rotationSlot(b, 4)).toBe(rotationSlot(a, 4));
    expect(rotationSlot(c, 4)).toBe(rotationSlot(a, 4) + 1);
  });

  it("keeps counting across a day boundary, so slot-1 is the real previous period", () => {
    const lastOfDay = new Date("2026-08-14T23:00:00Z");
    const firstOfNext = new Date("2026-08-15T00:00:00Z");
    expect(rotationSlot(firstOfNext, 4)).toBe(rotationSlot(lastOfDay, 4) + 1);
  });
});

describe("rotateRailFresh", () => {
  // 60 deep so a 4-slot cycle over a 15-item rail is actually supportable
  // (14 drawn per slot × 4 = 56 ≤ 59 tail). Home's recommendation pool is ~54.
  const deep = Array.from({ length: 60 }, (_, i) => `deep-${i}`);
  const seedAt = (epoch: number) => seedFor("recommendation", "user-a", epoch);

  it("is stable within a slot", () => {
    const a = rotateRailFresh(deep, 15, seedAt, 100);
    const b = rotateRailFresh(deep, 15, seedAt, 100);
    expect(b).toEqual(a);
  });

  it("shares NOTHING but the pinned spine between slots of one cycle", () => {
    // THE property rotateRail could not offer, and the reason this function
    // exists. With keepTop 1 exactly one item may repeat; everything else must
    // be new. Slots 100-103 are one epoch (cycle 4 → epoch = slot / 4).
    for (const slot of [101, 102, 103]) {
      const prev = rotateRailFresh(deep, 15, seedAt, slot - 1, { keepTop: 1 });
      const next = rotateRailFresh(deep, 15, seedAt, slot, { keepTop: 1 });
      expect(next.filter((i) => prev.includes(i))).toEqual([deep[0]]);
    }
  });

  it("still turns most of the rail over across a cycle boundary", () => {
    // The one transition per cycle where a FRESH hand is dealt (slot 99 → 100
    // crosses epochs), so disjointness can't be structural there — two
    // independent weighted draws will share some items. This is inherent to any
    // periodic reseed and is deliberately accepted rather than papered over:
    // the alternative, excluding the previous epoch's last hand, needs that
    // hand recomputed, which reopens exactly the unbounded recursion the
    // rejected design died on (see dailyRotation.ts). Asserted as a floor so a
    // future change can't quietly regress it to the old ~50% repeat rate.
    const prev = rotateRailFresh(deep, 15, seedAt, 99, { keepTop: 1 });
    const next = rotateRailFresh(deep, 15, seedAt, 100, { keepTop: 1 });
    const shared = next.filter((i) => prev.includes(i));
    expect(shared).toContain(deep[0]);          // the spine, by design
    expect(shared.length).toBeLessThanOrEqual(5); // ≥ 2/3 of the rail is new
  });

  it("covers a wide span of the pool over one cycle, not the same shallow head", () => {
    const seen = new Set<string>();
    for (const slot of [0, 1, 2, 3]) {
      for (const i of rotateRailFresh(deep, 15, seedAt, slot, { keepTop: 1 })) seen.add(i);
    }
    // 4 disjoint hands of 14 + the shared spine.
    expect(seen.size).toBe(4 * 14 + 1);
  });

  it("still pins the top of the ranking", () => {
    for (const slot of [1, 2, 77, 1234]) {
      expect(rotateRailFresh(deep, 15, seedAt, slot, { keepTop: 1 })[0]).toBe(deep[0]);
    }
  });

  it("always fills the rail to size, at every slot", () => {
    for (let slot = 0; slot < 12; slot++) {
      const out = rotateRailFresh(deep, 15, seedAt, slot);
      expect(out).toHaveLength(15);
      expect(new Set(out).size).toBe(15);
    }
  });

  it("shortens the cycle rather than under-filling a shallow pool", () => {
    // 20 deep, 14 drawn per slot: only ONE disjoint hand fits, so the cycle
    // clamps to 1 and every slot still gets a full 15.
    const shallow = deep.slice(0, 20);
    for (const slot of [7, 8, 9]) {
      const out = rotateRailFresh(shallow, 15, seedAt, slot, { keepTop: 1 });
      expect(out).toHaveLength(15);
      expect(new Set(out).size).toBe(15);
    }
  });

  it("returns the whole pool untouched when it's no deeper than the rail", () => {
    const short = deep.slice(0, 10);
    expect(rotateRailFresh(short, 15, seedAt, 3)).toEqual(short);
  });

  it("handles a negative slot without returning a short rail", () => {
    // Only reachable via the dev-only `?slot=` override, but a naive `%` would
    // give a negative share index and silently return an empty hand.
    expect(rotateRailFresh(deep, 15, seedAt, -3)).toHaveLength(15);
  });

  it("gives two users different rotations in the same slot", () => {
    const a = rotateRailFresh(deep, 15, (e) => seedFor("recommendation", "user-a", e), 42);
    const b = rotateRailFresh(deep, 15, (e) => seedFor("recommendation", "user-b", e), 42);
    expect(a).not.toEqual(b);
  });
});
