import { describe, it, expect } from "vitest";
import { orchestrateSync, providerQueue } from "./index";

// A clock that returns each supplied value on successive calls (clamping at the
// last), so we can drive orchestrateSync's budget check deterministically.
function seqClock(values: number[]) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

describe("orchestrateSync — budget + resume", () => {
  it("processes the whole queue when the budget is never exceeded", async () => {
    const seen: string[] = [];
    const r = await orchestrateSync(["a", "b", "c"], Infinity, async (id) => {
      seen.push(id);
      return id;
    });
    expect(seen).toEqual(["a", "b", "c"]);
    expect(r).toEqual({ results: ["a", "b", "c"], done: true, remaining: [] });
  });

  it("stops starting providers once the budget is spent and returns the tail", async () => {
    // start=0, after a=50 (<100 → continue), after b=120 (>=100 → stop before c)
    const r = await orchestrateSync(["a", "b", "c", "d"], 100, async (id) => id, seqClock([0, 50, 120]));
    expect(r.done).toBe(false);
    expect(r.results).toEqual(["a", "b"]);
    expect(r.remaining).toEqual(["c", "d"]);
  });

  it("always makes at least one provider of progress, even with a zero budget", async () => {
    const r = await orchestrateSync(["a", "b"], 0, async (id) => id, seqClock([0, 1]));
    expect(r.results).toEqual(["a"]);
    expect(r.done).toBe(false);
    expect(r.remaining).toEqual(["b"]);
  });

  it("reports done when the last provider lands exactly on the budget", async () => {
    // Budget hit after the final item, but i is last → no remaining, done=true.
    const r = await orchestrateSync(["a", "b"], 10, async (id) => id, seqClock([0, 5, 999]));
    expect(r).toEqual({ results: ["a", "b"], done: true, remaining: [] });
  });

  it("handles an empty queue", async () => {
    const r = await orchestrateSync([], 100, async (id) => id);
    expect(r).toEqual({ results: [], done: true, remaining: [] });
  });
});

describe("providerQueue — selection", () => {
  it("returns every registered provider for 'all' / undefined", () => {
    // rawg left this list on 2026-09-02 when it was retired as a data provider.
    expect(providerQueue("all")).toEqual(["trakt", "letterboxd", "steam", "tmdb"]);
    expect(providerQueue()).toEqual(["trakt", "letterboxd", "steam", "tmdb"]);
  });

  it("narrows to a single provider by id", () => {
    expect(providerQueue("steam")).toEqual(["steam"]);
  });

  it("intersects a resume list with the registry, preserving registry order", () => {
    expect(providerQueue("all", ["steam", "trakt", "bogus"])).toEqual(["trakt", "steam"]);
  });

  // 2026-09-02. A retired provider must fall out of the queue rather than drain
  // to an empty sync: a client that still has a rawg identity (and one does)
  // could otherwise resume it forever. `rawg` is a legal `Source` still, because
  // 603 stored links reference it, so "unknown id" would not catch this.
  it("drops a RETIRED provider from a resume list, like any unregistered id", () => {
    expect(providerQueue("all", ["rawg"])).toEqual([]);
    expect(providerQueue("rawg")).toEqual([]);
  });

  it("ignores an empty resume list and falls back to `only`", () => {
    expect(providerQueue("steam", [])).toEqual(["steam"]);
  });

  it("drops unknown provider ids entirely", () => {
    expect(providerQueue(undefined, ["nope"])).toEqual([]);
  });
});
