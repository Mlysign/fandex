import { describe, it, expect, vi, afterEach } from "vitest";
import { getSteamAppDetails } from "./steam";

// Regression: getSteamAppDetails must distinguish "the request failed" from
// "Steam has no such item".
//
// The wishlist pull drops any appid with no details, and syncProvider prunes
// whatever a pull omits — so a swallowed batch error used to silently delete
// those ~50 games from the user's Steam wishlist. A failed batch now throws
// (no prune); an appid genuinely absent from a SUCCESSFUL batch is still
// dropped, since that is a real removal (delisted/region-locked).

const ok = (appids: number[]) =>
  new Response(JSON.stringify({ response: { store_items: appids.map((appid) => ({ appid, item_type: 0 })) } }), {
    status: 200,
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getSteamAppDetails", () => {
  it("throws when a batch fails (a partial map would prune the wishlist)", async () => {
    const f = vi.fn().mockResolvedValue(new Response("nope", { status: 503 }));
    vi.stubGlobal("fetch", f);

    await expect(getSteamAppDetails([1, 2, 3])).rejects.toThrow(/503/);
  });

  it("omits an appid that a successful batch simply has no item for", async () => {
    // Steam returns 1 and 3 but not 2 → 2 is genuinely gone, not a failure.
    const f = vi.fn().mockResolvedValue(ok([1, 3]));
    vi.stubGlobal("fetch", f);

    const details = await getSteamAppDetails([1, 2, 3]);

    expect(Object.keys(details)).toEqual(["1", "3"]);
    expect(details[2]).toBeUndefined();
  });
});
