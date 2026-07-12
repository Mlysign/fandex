import { describe, it, expect, vi, afterEach } from "vitest";
import { rateLimit } from "./rateLimit";

// S3/P7: the fixed-window counter must allow up to `limit` per window, block the
// overflow with a retry hint, and reset cleanly once the window elapses.

describe("rateLimit", () => {
  afterEach(() => vi.useRealTimers());

  it("allows up to `limit` requests, then blocks", () => {
    vi.useFakeTimers();
    const key = "test:allow-then-block";
    for (let i = 0; i < 5; i++) {
      expect(rateLimit(key, 5, 1000).allowed).toBe(true);
    }
    const blocked = rateLimit(key, 5, 1000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets after the window elapses", () => {
    vi.useFakeTimers();
    const key = "test:reset";
    rateLimit(key, 2, 1000);
    rateLimit(key, 2, 1000);
    expect(rateLimit(key, 2, 1000).allowed).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(rateLimit(key, 2, 1000).allowed).toBe(true);
  });

  it("tracks keys independently", () => {
    vi.useFakeTimers();
    rateLimit("test:a", 1, 1000);
    expect(rateLimit("test:a", 1, 1000).allowed).toBe(false);
    expect(rateLimit("test:b", 1, 1000).allowed).toBe(true); // different key unaffected
  });

  it("reports decreasing remaining within a window", () => {
    vi.useFakeTimers();
    const key = "test:remaining";
    expect(rateLimit(key, 3, 1000).remaining).toBe(2);
    expect(rateLimit(key, 3, 1000).remaining).toBe(1);
    expect(rateLimit(key, 3, 1000).remaining).toBe(0);
  });
});
