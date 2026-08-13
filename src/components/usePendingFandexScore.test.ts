import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  subscribePendingScore,
  hasResolvedScore,
  __resetPendingScoreCache,
  type PendingScore,
} from "./usePendingFandexScore";

// SM44 (2026-08-13) — the CLIENT half of the deferred contract.
//
// /api/discover/scores can now answer three ways, and this module is where two
// of them are easy to confuse:
//   · a score               → paint it;
//   · `scores[id] = null`   → "asked, genuinely no score" — FINAL, stop asking;
//   · `deferred: [id]`      → "couldn't heal in budget" — ask again later.
//
// Collapsing deferred into null is what would make the server-side latency fix a
// regression: the module cache is keyed for the life of the page, so one batch
// unlucky enough to land during a provider outage would leave those cards blank
// until a full reload — the exact "the score is missing while I'm searching"
// complaint the whole change exists to fix.
//
// Driven through subscribePendingScore rather than the hook: the batching and
// backoff are plain module state, and the suite runs in `node` with no renderer.

const ID = "item-1";
const SCORE: PendingScore = { score: 71, center: 62 };

const respond = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  __resetPendingScoreCache();
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  __resetPendingScoreCache();
});

describe("usePendingFandexScore — deferred vs. null", () => {
  it("retries a deferred id on a later flush and resolves it once the provider recovers", async () => {
    fetchMock
      .mockReturnValueOnce(respond({ scores: {}, deferred: [ID], skipped: [] }))
      .mockReturnValueOnce(respond({ scores: { [ID]: SCORE }, deferred: [], skipped: [] }));

    const seen: (PendingScore | null)[] = [];
    subscribePendingScore(ID, (v) => seen.push(v));

    await vi.advanceTimersByTimeAsync(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Still pending: nothing emitted (the card keeps its pending treatment) and
    // — the load-bearing bit — nothing cached, so it is not final.
    expect(seen).toEqual([]);
    expect(hasResolvedScore(ID)).toBe(false);

    await vi.advanceTimersByTimeAsync(5_000); // past the first backoff
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(seen).toEqual([SCORE]);
    expect(hasResolvedScore(ID)).toBe(true);
  });

  it("treats a null as final and never asks again", async () => {
    fetchMock.mockReturnValue(respond({ scores: { [ID]: null }, deferred: [], skipped: [] }));

    const seen: (PendingScore | null)[] = [];
    subscribePendingScore(ID, (v) => seen.push(v));
    await vi.advanceTimersByTimeAsync(200);

    expect(seen).toEqual([null]);
    expect(hasResolvedScore(ID)).toBe(true);

    // A second card mounting with the same id must not re-ask.
    subscribePendingScore(ID, () => {});
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after a bounded number of retries, so an outage isn't a poll loop", async () => {
    fetchMock.mockReturnValue(respond({ scores: {}, deferred: [ID], skipped: [] }));

    const seen: (PendingScore | null)[] = [];
    subscribePendingScore(ID, (v) => seen.push(v));

    await vi.advanceTimersByTimeAsync(120_000);

    // The initial ask plus MAX_RETRIES, then it settles as "no score" — the
    // spinner stops rather than spinning (or polling) forever.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(seen).toEqual([null]);
    expect(hasResolvedScore(ID)).toBe(true);
  });

  it("re-asks for a deferred id when a card re-mounts, without bypassing the backoff", async () => {
    fetchMock.mockReturnValue(respond({ scores: {}, deferred: [ID], skipped: [] }));

    const unsubscribe = subscribePendingScore(ID, () => {});
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Scrolling away and back must not turn the backoff into a request per
    // mount — the id is neither resolved nor waiting, only backing off.
    unsubscribe();
    subscribePendingScore(ID, () => {});
    subscribePendingScore(ID, () => {});
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 5xx but settles a 4xx, which retrying can't fix", async () => {
    fetchMock.mockReturnValue(respond({ error: "Server error" }, 500));
    subscribePendingScore(ID, () => {});
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);

    __resetPendingScoreCache();
    fetchMock.mockClear();
    fetchMock.mockReturnValue(respond({ error: "Unauthorized" }, 401));

    const seen: (PendingScore | null)[] = [];
    subscribePendingScore(ID, (v) => seen.push(v));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([null]);
  });

  it("re-asks for ids the route reported as skipped (over MAX_IDS)", async () => {
    fetchMock
      .mockReturnValueOnce(respond({ scores: {}, deferred: [], skipped: [ID] }))
      .mockReturnValueOnce(respond({ scores: { [ID]: SCORE }, deferred: [], skipped: [] }));

    const seen: (PendingScore | null)[] = [];
    subscribePendingScore(ID, (v) => seen.push(v));

    await vi.advanceTimersByTimeAsync(200);
    expect(hasResolvedScore(ID)).toBe(false);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(seen).toEqual([SCORE]);
  });
});
