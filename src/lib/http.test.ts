import { describe, it, expect, vi, afterEach } from "vitest";
import { httpFetch } from "./http";

// P8: httpFetch must behave like fetch on success, retry only idempotent
// requests on transient failures, and never retry writes or 429s.

const resp = (status: number) => new Response("body", { status });

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
