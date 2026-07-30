import { describe, it, expect, beforeEach, vi } from "vitest";
import { initDb, run, get, query } from "./db";
import { upsertMediaItem, upsertWatchlistEntry, recordLibraryRating } from "./matcher";
import { removeFromWishlist } from "./wishlistRemove";
import type { MediaType } from "@/types";

// 2026-07-30 — the wishlist removal extracted out of /api/watchlist's DELETE so
// /api/library's POST could reuse it when a rating lands. What's locked in here:
// the S7 ownership gate, that BOTH the cache row and its user_item_state truth
// rows go, and that per-source narrowing still works.
//
// The provider write-back loop is not exercised: these items have no connected
// identity, so `src.context()` returns null and every provider is skipped —
// which is itself the behaviour we want on a token-less account.

initDb();

const USER = "u-wlr";
const OTHER = "u-wlr-other";
let item: string;

beforeEach(() => {
  run("DELETE FROM media_items");
  run("DELETE FROM users");
  run("INSERT INTO users (id) VALUES (?)", [USER]);
  run("INSERT INTO users (id) VALUES (?)", [OTHER]);
  item = upsertMediaItem({
    source: "trakt", sourceId: "700", type: "movie", title: "Collateral", releaseDate: "2004-08-06",
    rawData: { ids: { trakt: 700, tmdb: 8010 }, title: "Collateral" },
  });
});

describe("removeFromWishlist", () => {
  it("clears the cache row AND every per-source truth row", async () => {
    upsertWatchlistEntry(USER, item, "trakt");
    upsertWatchlistEntry(USER, item, "tmdb");

    await expect(removeFromWishlist(USER, item)).resolves.toBe(true);

    expect(get("SELECT 1 FROM user_watchlist WHERE media_item_id=?", [item])).toBeNull();
    expect(query("SELECT 1 FROM user_item_state WHERE relation='wishlist'").length).toBe(0);
  });

  it("narrows to one provider when `source` is given", async () => {
    upsertWatchlistEntry(USER, item, "trakt");
    upsertWatchlistEntry(USER, item, "tmdb");

    await expect(removeFromWishlist(USER, item, { source: "trakt" })).resolves.toBe(true);

    expect(JSON.parse(get<{ platform_sources: string }>(
      "SELECT platform_sources FROM user_watchlist WHERE media_item_id=?", [item]
    )!.platform_sources)).toEqual(["tmdb"]);
  });

  it("is a no-op for an item that isn't on this user's wishlist (S7)", async () => {
    upsertWatchlistEntry(OTHER, item, "trakt");

    await expect(removeFromWishlist(USER, item)).resolves.toBe(false);

    // The other user's entry is untouched.
    expect(get("SELECT 1 FROM user_watchlist WHERE user_id=? AND media_item_id=?", [OTHER, item])).not.toBeNull();
  });

  it("is a no-op when nothing is on the wishlist at all", async () => {
    await expect(removeFromWishlist(USER, item)).resolves.toBe(false);
  });
});

// The rating side of the same feature. /api/library's POST does the write-back
// loop + recordLibraryRating + removeFromWishlist; the route itself needs a
// request/session to drive, so this asserts the composition the route performs.
describe("rating an item takes it off the wishlist", () => {
  it("removes the wishlist entry but keeps the library rating", async () => {
    upsertWatchlistEntry(USER, item, "trakt");
    recordLibraryRating(USER, item, { rating: 8, status: "watched", sources: [], reviewedAt: 1 });
    const removed = await removeFromWishlist(USER, item);

    expect(removed).toBe(true);
    expect(get("SELECT 1 FROM user_watchlist WHERE media_item_id=?", [item])).toBeNull();
    expect(get<{ rating: number }>("SELECT rating FROM user_library WHERE media_item_id=?", [item])!.rating).toBe(8);
  });

  it("clearing a rating (null) keeps the item in the library, unrated, and does NOT touch the wishlist", () => {
    upsertWatchlistEntry(USER, item, "trakt");
    recordLibraryRating(USER, item, { rating: 8, status: "watched", sources: [], reviewedAt: 1 });

    const after = recordLibraryRating(USER, item, { rating: null, status: null, sources: [], reviewedAt: 2 });

    expect(after.rating).toBeNull();
    // Still in the library, still watched — clearing a score is not a removal.
    expect(get<{ status: string }>("SELECT status FROM user_library WHERE media_item_id=?", [item])!.status).toBe("watched");
    // The route only calls removeFromWishlist when `rating != null`, so a clear
    // leaves the wishlist alone.
    expect(get("SELECT 1 FROM user_watchlist WHERE media_item_id=?", [item])).not.toBeNull();
  });
});

// Guard against the reason this helper exists: a local-only removal would be
// undone by the next sync, so the provider write-back must actually be attempted
// for every linked writable provider that has a token.
describe("provider write-back", () => {
  // `pushWishlist` / `context` are optional members of MediaSource, so these are
  // swapped by assignment and restored, rather than vi.spyOn'd (which can't type
  // an optional method without an `as never` that defeats the check).
  async function withStubbedTrakt(
    push: (ctx: unknown, sourceId: string, type: MediaType, add: boolean) => Promise<void>,
    body: () => Promise<void>
  ) {
    const { SOURCES } = await import("./sources/registry");
    const trakt = SOURCES.trakt!;
    const realContext = trakt.context;
    const realPush = trakt.pushWishlist;
    trakt.context = async () => ({ userId: USER, identity: {} as never, token: "t", slug: null });
    trakt.pushWishlist = push;
    try { await body(); } finally {
      trakt.context = realContext;
      trakt.pushWishlist = realPush;
    }
  }

  it("pushes the removal to a linked writable provider before clearing locally", async () => {
    upsertWatchlistEntry(USER, item, "trakt");
    const push = vi.fn().mockResolvedValue(undefined);

    await withStubbedTrakt(push, async () => {
      await removeFromWishlist(USER, item);
    });

    expect(push).toHaveBeenCalledWith(expect.anything(), "700", "movie", false);
    expect(get("SELECT 1 FROM user_watchlist WHERE media_item_id=?", [item])).toBeNull();
  });

  it("still removes locally when a provider write-back throws", async () => {
    upsertWatchlistEntry(USER, item, "trakt");

    await withStubbedTrakt(() => Promise.reject(new Error("trakt down")), async () => {
      await expect(removeFromWishlist(USER, item)).resolves.toBe(true);
    });

    expect(get("SELECT 1 FROM user_watchlist WHERE media_item_id=?", [item])).toBeNull();
  });
});
