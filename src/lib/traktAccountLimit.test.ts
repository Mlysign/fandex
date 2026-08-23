import { describe, it, expect } from "vitest";
import { traktWriteError, TRAKT_ACCOUNT_LIMIT } from "@/lib/sources/trakt";
import { platformWarning } from "@/lib/useQuickActions";

// PL2, 2026-08-23. Trakt caps a free account's watchlist, ratings and lists, and
// answers **420 Account Limit Exceeded** with an `X-Upgrade-URL` header.
//
// The write helpers always threw on a non-ok response, so this was never silent
// down here. It went silent one layer up: /api/watchlist caught the throw,
// logged it, and returned `{ ok: true }` regardless, so past the cap an item
// stopped reaching Trakt while Fandex reported success. And even /api/library,
// which HAS returned `warnings` since H2, had no reader on the client, so both
// routes were reporting into the void.
//
// These pin the two halves that make it visible: 420 becomes a sentence a person
// can act on, and the client turns the wire format into one line.

describe("traktWriteError — an account limit reads as one", () => {
  it("turns 420 into a message naming the cause and the fix", async () => {
    const res = new Response("{}", {
      status: TRAKT_ACCOUNT_LIMIT,
      headers: { "X-Upgrade-URL": "https://trakt.tv/vip" },
    });
    const err = await traktWriteError(res, "adding this film to your watchlist");

    expect(err.message).toContain("at its limit");
    expect(err.message).toContain("adding this film to your watchlist");
    // Trakt's own upgrade URL, not one we invented.
    expect(err.message).toContain("https://trakt.tv/vip");
    // ⚠️ No hardcoded cap. Trakt has published different limits for new members,
    // existing members and VIP and has changed them, so a number here would be
    // wrong for most accounts and would rot with nothing to catch it.
    expect(err.message).not.toMatch(/\b(100|250|500|1000|2000)\b/);
  });

  it("still works when Trakt sends no upgrade header", async () => {
    const err = await traktWriteError(new Response("{}", { status: TRAKT_ACCOUNT_LIMIT }), "saving this rating");
    expect(err.message).toContain("at its limit");
    expect(err.message).not.toContain("undefined");
    expect(err.message).not.toContain("null");
  });

  it("leaves other failures as a plain diagnostic", async () => {
    const err = await traktWriteError(new Response("nope", { status: 502 }), "marking this watched");
    expect(err.message).toContain("502");
    expect(err.message).not.toContain("at its limit");
  });
});

describe("platformWarning — the wire format becomes one readable line", () => {
  it("strips the provider prefix the API uses", () => {
    expect(platformWarning(["trakt: Your Trakt account is at its limit."]))
      .toBe("Your Trakt account is at its limit.");
  });

  it("counts the rest rather than stacking them into a wall", () => {
    expect(platformWarning(["trakt: Full.", "tmdb: Nope.", "rawg: Nope."]))
      .toBe("Full. (+2 more)");
  });

  it("never renders an empty toast", () => {
    expect(platformWarning([])).toBeTruthy();
    expect(platformWarning([""])).toBeTruthy();
  });
});
