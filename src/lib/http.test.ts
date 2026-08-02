import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { httpFetch, ProviderUnavailableError, providerBreakerSnapshot, __resetBreakers } from "./http";

// P8: httpFetch must behave like fetch on success, retry only idempotent
// requests on transient failures, and never retry writes or 429s.
//
// 2026-08-02: plus a per-host circuit breaker and a total-time budget.

const resp = (status: number) => new Response("body", { status });

// Breaker state is module-global and keyed by host — without this, a test that
// drives a host to failure leaves the breaker OPEN for every later test using
// the same host, and they fail in a confusing order-dependent way.
beforeEach(() => {
  __resetBreakers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("httpFetch", () => {
  it("returns the response on success without retrying", async () => {
    const f = vi.fn().mockResolvedValue(resp(200));
    vi.stubGlobal("fetch", f);
    const res = await httpFetch("https://x");
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("retries a GET on 5xx, then succeeds", async () => {
    const f = vi.fn().mockResolvedValueOnce(resp(503)).mockResolvedValueOnce(resp(200));
    vi.stubGlobal("fetch", f);
    const res = await httpFetch("https://x");
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a POST on 5xx (writes must not double-submit)", async () => {
    const f = vi.fn().mockResolvedValue(resp(500));
    vi.stubGlobal("fetch", f);
    const res = await httpFetch("https://x", { method: "POST" });
    expect(res.status).toBe(500);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("retries a GET on 429 (wait-then-retry), then succeeds", async () => {
    const f = vi.fn().mockResolvedValueOnce(resp(429)).mockResolvedValueOnce(resp(200));
    vi.stubGlobal("fetch", f);
    const res = await httpFetch("https://x");
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a 429 on a POST (writes must not double-submit)", async () => {
    const f = vi.fn().mockResolvedValue(resp(429));
    vi.stubGlobal("fetch", f);
    const res = await httpFetch("https://x", { method: "POST" });
    expect(res.status).toBe(429);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("gives up and returns the 429 after exhausting retries", async () => {
    const f = vi.fn().mockResolvedValue(resp(429));
    vi.stubGlobal("fetch", f);
    const res = await httpFetch("https://x");
    expect(res.status).toBe(429);
    expect(f).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("does NOT wait on a Retry-After longer than the cap (best-effort skip)", async () => {
    const f = vi.fn().mockResolvedValue(new Response("body", { status: 429, headers: { "Retry-After": "3600" } }));
    vi.stubGlobal("fetch", f);
    const res = await httpFetch("https://x");
    expect(res.status).toBe(429);
    expect(f).toHaveBeenCalledTimes(1); // 3600s > cap → returned immediately, no retry
  });

  it("retries a GET on network error, then throws after exhausting retries", async () => {
    const f = vi.fn().mockRejectedValue(new Error("network"));
    vi.stubGlobal("fetch", f);
    await expect(httpFetch("https://x", { retries: 2 })).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});

// ── The total-time budget ────────────────────────────────────────────
describe("httpFetch budgetMs", () => {
  it("stops retrying once the budget is spent instead of running the full ladder", async () => {
    // Every attempt hangs until its own abort signal fires. With a 120 ms budget
    // and a 20 s default timeout, the FIRST attempt must be capped to the budget
    // and there must be no second one.
    const f = vi.fn().mockImplementation((_url: string, init: RequestInit) =>
      new Promise((_res, rej) => {
        init.signal?.addEventListener("abort", () => rej(new Error("AbortError")));
      })
    );
    vi.stubGlobal("fetch", f);
    const t0 = Date.now();
    await expect(httpFetch("https://slow.test", { budgetMs: 120 })).rejects.toThrow();
    const elapsed = Date.now() - t0;
    expect(f).toHaveBeenCalledTimes(1);
    // Well under the 3 × 20 s the un-budgeted ladder would have cost.
    expect(elapsed).toBeLessThan(2000);
  });

  it("leaves the un-budgeted path alone (retries as before)", async () => {
    const f = vi.fn().mockResolvedValue(resp(500));
    vi.stubGlobal("fetch", f);
    await httpFetch("https://x");
    expect(f).toHaveBeenCalledTimes(3);
  });
});

// ── The circuit breaker ──────────────────────────────────────────────
describe("provider circuit breaker", () => {
  it("opens after repeated hard failures and then fails fast WITHOUT calling fetch", async () => {
    const f = vi.fn().mockResolvedValue(resp(500));
    vi.stubGlobal("fetch", f);

    // 3 calls × (initial + 2 retries) = 9 fetches, 3 recorded failures.
    for (let i = 0; i < 3; i++) await httpFetch("https://down.test");
    expect(f).toHaveBeenCalledTimes(9);

    f.mockClear();
    await expect(httpFetch("https://down.test")).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(f).not.toHaveBeenCalled(); // the whole point: no network, no 20s wait
  });

  it("is per-host — one dead provider does not take a healthy one down", async () => {
    const f = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(resp(String(url).includes("down") ? 500 : 200))
    );
    vi.stubGlobal("fetch", f);

    for (let i = 0; i < 3; i++) await httpFetch("https://down.test");
    await expect(httpFetch("https://down.test")).rejects.toBeInstanceOf(ProviderUnavailableError);

    const ok = await httpFetch("https://healthy.test");
    expect(ok.status).toBe(200);
  });

  it("does NOT open on 4xx or on a 429 — those are the provider working as designed", async () => {
    const f = vi.fn().mockResolvedValue(new Response("body", { status: 429, headers: { "Retry-After": "3600" } }));
    vi.stubGlobal("fetch", f);
    for (let i = 0; i < 5; i++) await httpFetch("https://ratelimited.test");
    // Still closed: a burst of our own must never take a healthy host offline.
    expect(providerBreakerSnapshot()["ratelimited.test"]).toBeUndefined();
    const res = await httpFetch("https://ratelimited.test");
    expect(res.status).toBe(429);
  });

  it("a success closes an almost-open breaker (failures reset, not accumulated)", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(resp(500)).mockResolvedValueOnce(resp(500)).mockResolvedValueOnce(resp(500)) // call 1 fails
      .mockResolvedValue(resp(200));                                                                      // call 2 succeeds
    vi.stubGlobal("fetch", f);

    await httpFetch("https://flaky.test");                    // 1 failure recorded
    expect((await httpFetch("https://flaky.test")).status).toBe(200); // resets to 0

    // Two more failures would have hit the threshold of 3 had it accumulated.
    f.mockResolvedValue(resp(500));
    await httpFetch("https://flaky.test");
    await httpFetch("https://flaky.test");
    f.mockClear();
    f.mockResolvedValue(resp(200));
    expect((await httpFetch("https://flaky.test")).status).toBe(200);
    expect(f).toHaveBeenCalled(); // not short-circuited
  });

  it("reports open circuits for /api/health, and closes them on recovery", async () => {
    const f = vi.fn().mockResolvedValue(resp(500));
    vi.stubGlobal("fetch", f);
    for (let i = 0; i < 3; i++) await httpFetch("https://sick.test");

    const snap = providerBreakerSnapshot();
    expect(snap["sick.test"]).toBeDefined();
    expect(snap["sick.test"].openForMs).toBeGreaterThan(0);

    __resetBreakers();
    expect(providerBreakerSnapshot()).toEqual({});
  });

  // ── THE PRUNE INVARIANT (AGENTS.md) ────────────────────────────────
  // syncProvider deletes every local entry missing from a *successful* pull, so
  // a failed pull must THROW and never look like "the provider returned
  // nothing". The convenient breaker design — return a synthetic 503 Response —
  // would have been read by every pull adapter's `if (!res.ok) throw` as a
  // normal error (fine), but by any `if (!res.ok) return []` as an empty
  // library (catastrophic). Throwing removes the possibility entirely.
  it("THROWS rather than returning a response when open (never a fake empty result)", async () => {
    const f = vi.fn().mockResolvedValue(resp(500));
    vi.stubGlobal("fetch", f);
    for (let i = 0; i < 3; i++) await httpFetch("https://provider.test");

    const call = httpFetch("https://provider.test");
    await expect(call).rejects.toBeInstanceOf(ProviderUnavailableError);
    // Belt and braces: it must not resolve to anything at all, Response or not.
    await expect(call).rejects.toThrow(/unavailable/i);
  });
});
