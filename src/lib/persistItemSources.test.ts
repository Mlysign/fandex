import { describe, it, expect } from "vitest";
import { ID_ORDER } from "./persistItem";
import { zSource } from "./schemas";

// 2026-09-03. Nils: "I can no longer rate games."
//
// `persistItemFromIds` walks `ID_ORDER` and skips any id whose source the list
// does not name. When that was the ONLY id the card carried, it returned null,
// and both callers (POST /api/library, POST /api/watchlist) answer null with
// `400 Could not resolve item`, which the card renders as "Couldn't save your
// rating. Please try again." So an omission here is not a missing link, it is a
// dead quick-action bar on every item that provider is the sole source for.
//
// `igdb` was omitted from the day the list was written. It cost nothing while
// games came from RAWG as well, and became load-bearing the moment RAWG was
// retired (2026-09-02): measured on the real DB the same day this broke, 310 of
// 1,347 games held an igdb id and nothing else, and every one of them was
// unrateable and un-wishlistable.
//
// tsc cannot catch this. `Source[]` is satisfied by a list naming two of six
// members, so the omission is invisible to the type checker, to lint, and to
// every test that mocks a source it does happen to name.
describe("persistItemFromIds source coverage", () => {
  it("names every Source, so no provider's id is silently dropped", () => {
    const missing = zSource.options.filter((s) => !ID_ORDER.includes(s));
    expect(
      missing,
      `Add these to ID_ORDER in persistItem.ts, or rating and wishlisting ` +
        `anything they are the only source for returns 400: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("lists each source once, so precedence is unambiguous", () => {
    expect(ID_ORDER).toHaveLength(new Set(ID_ORDER).size);
  });

  it("puts igdb ahead of steam, the game catalog before the store", () => {
    expect(ID_ORDER.indexOf("igdb")).toBeLessThan(ID_ORDER.indexOf("steam"));
  });
});
