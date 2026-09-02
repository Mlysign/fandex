import { describe, it, expect, vi, afterEach } from "vitest";
import { staleProviders, syncToCompletion, SYNC_STALE_MS, IDENTITY_ONLY_PROVIDERS } from "./syncClient";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(slices: any[]) {
  const calls: any[] = [];
  let i = 0;
  vi.stubGlobal("fetch", async (_url: string, init: any) => {
    calls.push(JSON.parse(init.body));
    const slice = slices[Math.min(i++, slices.length - 1)];
    return { ok: slice.ok !== false, json: async () => slice } as Response;
  });
  return calls;
}

describe("syncToCompletion", () => {
  it("completes in one call when the server reports done immediately", async () => {
    const calls = stubFetch([{ ok: true, results: [], done: true, remaining: [] }]);
    await syncToCompletion("all");
    expect(calls).toEqual([{ provider: "all" }]);
  });

  it("re-invokes with `remaining` until done, then stops", async () => {
    const calls = stubFetch([
      { ok: true, results: [{ provider: "trakt" }], done: false, remaining: ["rawg", "steam"] },
      { ok: true, results: [{ provider: "rawg" }], done: false, remaining: ["steam"] },
      { ok: true, results: [{ provider: "steam" }], done: true, remaining: [] },
    ]);
    const progress: number[] = [];
    await syncToCompletion("all", (s) => progress.push(s.results.length));
    expect(calls).toEqual([
      { provider: "all" },
      { providers: ["rawg", "steam"] },
      { providers: ["steam"] },
    ]);
    expect(progress).toEqual([1, 1, 1]);
  });

  it("bails out on a non-ok response without looping", async () => {
    const calls = stubFetch([{ ok: false }]);
    await syncToCompletion("all");
    expect(calls).toHaveLength(1);
  });

  it("treats an empty `remaining` as done even if the server omits done", async () => {
    const calls = stubFetch([{ ok: true, results: [], remaining: [] }]);
    await syncToCompletion("all");
    expect(calls).toHaveLength(1);
  });

  it("starts from a provider LIST when given one, instead of a fresh full run", async () => {
    const calls = stubFetch([{ ok: true, results: [], done: true, remaining: [] }]);
    await syncToCompletion(["steam", "rawg"]);
    expect(calls).toEqual([{ providers: ["steam", "rawg"] }]);
  });

  it("does nothing at all for an EMPTY list", async () => {
    // /api/sync's providerQueue falls back to the whole registry on an empty
    // `providers`, so a naive pass-through would turn "nothing is due" into a
    // full sync of everything on every visit.
    const calls = stubFetch([{ ok: true, results: [], done: true, remaining: [] }]);
    await syncToCompletion([]);
    expect(calls).toHaveLength(0);
  });
});

// 2026-08-22 — My Stuff used to collapse the whole sync log with
// `Math.max(...)` and re-sync everything only if that ONE timestamp was over a
// day old. The Home progress rail syncs Trakt alone, so from the day it shipped
// (2026-08-16) every Trakt-only run refreshed the clock guarding Steam, RAWG and
// TMDB, and none of them ever synced again. It surfaced as a Steam game staying
// on the wishlist weeks after it was bought.
describe("staleProviders", () => {
  const HOUR = 60 * 60 * 1000;
  const NOW = 1_000_000 * HOUR;
  const secs = (ms: number) => ms / 1000;
  const ident = (...ids: string[]) => ids.map((provider) => ({ provider }));

  it("does NOT let one provider's fresh sync cover another's stale one", () => {
    const logs = [
      { provider: "trakt", last_sync: secs(NOW - HOUR) },
      { provider: "trakt-library", last_sync: secs(NOW - HOUR) },
      { provider: "steam", last_sync: secs(NOW - 20 * 24 * HOUR) },
      { provider: "steam-library", last_sync: secs(NOW - 20 * 24 * HOUR) },
    ];
    expect(staleProviders(ident("trakt", "steam"), logs, NOW)).toEqual(["steam"]);
  });

  it("counts a provider's suffixed rows (`steam-library`) as that provider's own freshness", () => {
    const logs = [{ provider: "steam-library", last_sync: secs(NOW - HOUR) }];
    expect(staleProviders(ident("steam"), logs, NOW)).toEqual([]);
  });

  it("treats a provider that has never synced as stale", () => {
    expect(staleProviders(ident("steam"), [], NOW)).toEqual(["steam"]);
  });

  it("returns nothing when every connected provider is fresh", () => {
    const logs = [
      { provider: "trakt", last_sync: secs(NOW - HOUR) },
      { provider: "steam", last_sync: secs(NOW - HOUR) },
    ];
    expect(staleProviders(ident("trakt", "steam"), logs, NOW)).toEqual([]);
  });

  it("ignores log rows for providers that are no longer connected", () => {
    const logs = [{ provider: "letterboxd", last_sync: secs(NOW - 99 * 24 * HOUR) }];
    expect(staleProviders(ident("trakt"), logs, NOW)).toEqual(["trakt"]);
  });

  it("uses a 24 h window", () => {
    const fresh = [{ provider: "steam", last_sync: secs(NOW - SYNC_STALE_MS + HOUR) }];
    const old = [{ provider: "steam", last_sync: secs(NOW - SYNC_STALE_MS - HOUR) }];
    expect(staleProviders(ident("steam"), fresh, NOW)).toEqual([]);
    expect(staleProviders(ident("steam"), old, NOW)).toEqual(["steam"]);
  });

  // 2026-09-01, added with Google sign-in. An identity-only provider has no
  // library, so it never writes a sync_log row, so "never synced" — which the
  // test above correctly reads as stale for a real provider — would make it due
  // FOREVER. MyStuffView acts on this list directly: it would flip the syncing
  // spinner on and POST /api/sync on every load of /library and /wishlist, for
  // the life of the account, and never log an error, because providerQueue is
  // registry-filtered and quietly answers done on an empty queue.
  describe("identity-only providers", () => {
    it("never reports google as due, even having never synced", () => {
      expect(staleProviders(ident("google"), [], NOW)).toEqual([]);
    });

    it("still reports a real provider that is due alongside it", () => {
      expect(staleProviders(ident("google", "steam"), [], NOW)).toEqual(["steam"]);
    });

    it("leaves a google-only account with an EMPTY list, which syncToCompletion no-ops on", async () => {
      const due = staleProviders(ident("google"), [], NOW);
      expect(due).toEqual([]);
      // The contract that makes the empty list safe: an explicit empty array is
      // "nothing is due", never "sync everything". /api/sync's providerQueue
      // falls back to the FULL registry on an empty `providers`, so sending one
      // would turn this no-op into a full sync of every provider.
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      await syncToCompletion(due);
      expect(fetchSpy).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it("never reports discord as due either (2026-09-02)", () => {
      // The second identity-only provider. Adding a name to `AuthProvider` is
      // HALF the job; without the IDENTITY_ONLY_PROVIDERS entry `staleProviders`
      // reads "no sync_log row" as "overdue", which is right for a provider that
      // CAN sync and permanently wrong for one that cannot — it reads as due
      // forever and fires a doomed sync on every /library load, silently.
      expect(staleProviders(ident("discord"), [], NOW)).toEqual([]);
      expect(staleProviders(ident("discord", "trakt"), [], NOW)).toEqual(["trakt"]);
    });

    it("keeps every identity-only provider out, so a third one cannot be half-added", () => {
      // Asserted as a SET rather than per-name: the failure this guards is
      // somebody adding a provider to the type union and the UI and forgetting
      // this list, which a per-name test cannot see.
      for (const p of IDENTITY_ONLY_PROVIDERS) {
        expect(staleProviders(ident(p), [], NOW)).toEqual([]);
      }
    });
  });
});
