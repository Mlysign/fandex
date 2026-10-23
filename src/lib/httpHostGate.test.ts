import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { httpFetch, __resetBreakers, __resetHostGates, hostGateSnapshot } from "./http";

// 2026-08-23 — THE PER-HOST CONCURRENCY GATE.
//
// A different failure from the circuit breaker, and the breaker cannot fix it:
// this is OUR request rate being too high for a provider, not the provider
// being down. IGDB documents a hard **4 requests per second**; `liveDiscover`
// fans out PAGES_PER_SOURCE pages under one Promise.all, several surfaces can
// do that at once, and the franchise sweep adds more. Measured on prod: **64
// network errors out of 175 IGDB requests**, and an earlier reading of 190 of
// 232 (docs/scalability.md §1a).
//
// It is a CATALOG COMPLETENESS problem, not a latency one — RAWG's monthly
// quota is exhausted, so IGDB is the only games metadata source left.
//
// What these assert is the property the fix is FOR: that no more than `limit`
// requests are ever in flight at once. Counting concurrency is something the
// test environment can actually observe, unlike "did the provider like our
// rate", which is the kind of claim this repo has been burned asserting.

const IGDB = "https://api.igdb.com/v4/games";
const UNGATED = "https://api.themoviedb.org/3/movie/1";

beforeEach(() => {
  __resetBreakers();
  __resetHostGates();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A fetch stub that records how many calls overlap. */
function trackingFetch(delayMs = 20) {
  let inFlight = 0;
  let peak = 0;
  const fn = vi.fn(async () => {
    inFlight++;
    if (inFlight > peak) peak = inFlight;
    await new Promise((r) => setTimeout(r, delayMs));
    inFlight--;
    return new Response("{}", { status: 200 });
  });
  return { fn, peak: () => peak };
}

describe("per-host concurrency gate", () => {
  it("never lets more than 4 IGDB requests be in flight at once", async () => {
    const t = trackingFetch();
    vi.stubGlobal("fetch", t.fn);

    await Promise.all(Array.from({ length: 20 }, () => httpFetch(IGDB, { method: "POST", body: "x" })));

    // The regression this prevents: 20 concurrent requests against a documented
    // 4/s limit, which is how 190-of-232 network errors happen.
    expect(t.peak()).toBeLessThanOrEqual(4);
    expect(t.fn).toHaveBeenCalledTimes(20);
  });

  it("still runs ALL of them — the gate paces, it does not drop", async () => {
    const t = trackingFetch(5);
    vi.stubGlobal("fetch", t.fn);
    const results = await Promise.all(Array.from({ length: 12 }, () => httpFetch(IGDB, { method: "POST", body: "x" })));
    expect(results).toHaveLength(12);
    expect(results.every((r) => r.status === 200)).toBe(true);
  });

  it("does NOT gate a host with no published limit", async () => {
    const t = trackingFetch();
    vi.stubGlobal("fetch", t.fn);
    await Promise.all(Array.from({ length: 10 }, () => httpFetch(UNGATED)));
    // TMDB has no documented per-second cap we are near, and gating it would
    // slow every browse path for nothing.
    expect(t.peak()).toBeGreaterThan(4);
  });

  it("⚠️ releases the slot when a request THROWS, or the gate leaks permits forever", async () => {
    // A leaked permit is unrecoverable without a restart: the gate runs one
    // short for the life of the process, and at limit 4 that is a 25%
    // throughput cut that nothing reports.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("boom"); }));
    await Promise.all(
      Array.from({ length: 8 }, () =>
        httpFetch(IGDB, { method: "POST", body: "x", retries: 0 }).catch(() => null))
    );

    // Every permit is back.
    const t = trackingFetch(5);
    vi.stubGlobal("fetch", t.fn);
    __resetBreakers(); // the failures above opened it; that is a separate mechanism
    await Promise.all(Array.from({ length: 4 }, () => httpFetch(IGDB, { method: "POST", body: "x" })));
    expect(t.fn).toHaveBeenCalledTimes(4);
    expect(hostGateSnapshot()["api.igdb.com"].inFlight).toBe(0);
  });

  // A Worker isolate can drop a request without running its `finally`, so a
  // slot must expire on its own or four dropped calls stop IGDB for good.
  it("reaps a slot whose request never finished, and a late release does not overfill the gate", async () => {
    vi.useFakeTimers();
    try {
      const hung: ((r: Response) => void)[] = [];
      const f = vi.fn(() => new Promise<Response>((r) => hung.push(r)));
      vi.stubGlobal("fetch", f);
      const opts = { method: "POST", body: "x", timeoutMs: 1_000 };
      for (let i = 0; i < 4; i++) void httpFetch(IGDB, opts).catch(() => null);
      await vi.advanceTimersByTimeAsync(0);
      expect(hostGateSnapshot()["api.igdb.com"].inFlight).toBe(4);

      f.mockImplementation(async () => new Response("{}", { status: 200 }));
      const fifth = httpFetch(IGDB, opts);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(f).toHaveBeenCalledTimes(4); // still queued: nothing has expired yet

      await vi.advanceTimersByTimeAsync(30_000); // past the 30 s floor
      expect((await fifth).status).toBe(200);

      // The dropped calls come back after all. Their slots were already reaped,
      // so handing them on again would put the gate over its limit.
      for (const r of hung) r(new Response("{}", { status: 200 }));
      await vi.advanceTimersByTimeAsync(0);
      const snap = hostGateSnapshot()["api.igdb.com"];
      expect(snap.inFlight).toBe(0);
      expect(snap.maxInFlight).toBeLessThanOrEqual(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up waiting for a slot once the caller's budget is spent", async () => {
    vi.useFakeTimers();
    try {
      const f = vi.fn(() => new Promise<Response>(() => {}));
      vi.stubGlobal("fetch", f);
      for (let i = 0; i < 4; i++) void httpFetch(IGDB, { method: "POST", body: "x" }).catch(() => null);
      await vi.advanceTimersByTimeAsync(0);

      const late = httpFetch(IGDB, { method: "POST", body: "x", budgetMs: 500 });
      const settled = expect(late).rejects.toThrow(/slot/);
      await vi.advanceTimersByTimeAsync(600);
      await settled;
      expect(f).toHaveBeenCalledTimes(4);
      expect(hostGateSnapshot()["api.igdb.com"].queued).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports whether the gate actually BOUND, so the next reading can settle it", async () => {
    const t = trackingFetch(10);
    vi.stubGlobal("fetch", t.fn);
    await Promise.all(Array.from({ length: 9 }, () => httpFetch(IGDB, { method: "POST", body: "x" })));

    const snap = hostGateSnapshot()["api.igdb.com"];
    expect(snap.limit).toBe(4);
    expect(snap.maxInFlight).toBeLessThanOrEqual(4);
    // 9 requests against 4 permits means 5 had to wait. queuedTotal: 0 in prod
    // would mean concurrency was never the problem.
    expect(snap.queuedTotal).toBeGreaterThan(0);
    expect(snap.inFlight).toBe(0);
  });
});
