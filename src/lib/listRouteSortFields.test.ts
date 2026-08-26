import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 2026-08-26. `/library` and `/wishlist` are ONE component (MyStuffView) fed by
// TWO routes: /api/library and /api/calendar. Whatever `sortItems` reads has to
// arrive from both, or one half of the shared UI silently stops sorting.
//
// That is what happened to "Recently added", the DEFAULT sort. /api/calendar
// selected `uw.added_at` and put it on its intermediate `item`, then built the
// response object field by field and never copied it across, so every wishlist
// entry reached the client with `addedAt: undefined`. sortItems maps a missing
// timestamp to -Infinity (correct: a null must never look like "just added"),
// so the whole list tied, Array.sort is stable, and the wishlist kept the
// route's own release-date order. A title added seconds ago appeared wherever
// its release year put it, which reads as "the sort control does nothing"
// rather than as a missing field.
//
// Nothing else catches it. Both routes typecheck (`EnrichedItem.addedAt` is
// optional, because a Discover card genuinely has no added-at), lint is clean,
// and the response is a valid, fully populated item in every other respect.
// Only comparing the two routes against the sort's inputs shows the gap.
//
// A source grep rather than a route test on purpose: these handlers are
// `withUser`-wrapped and need a session, a database and provider-shaped rows to
// invoke, and the defect is not in the values — it is a field that was never
// written. Grepping is the shape of the bug.
const ROUTES = {
  "/api/library": "src/app/api/library/route.ts",
  "/api/calendar": "src/app/api/calendar/route.ts",
} as const;

// Fields sortItems() reads that a LIST route is responsible for supplying.
// `releaseDate`, `communityRatings` and `fandexScore` all come from the merged
// projection spread (`...rest`) or are assigned explicitly in both routes;
// `addedAt` is the only one that exists solely on the user-state row, which is
// why it is the one that went missing.
const SORT_FIELDS = ["addedAt"] as const;

describe("the two My Stuff list routes supply every field the shared sort reads", () => {
  for (const [name, path] of Object.entries(ROUTES)) {
    const src = readFileSync(join(process.cwd(), path), "utf8");
    for (const field of SORT_FIELDS) {
      it(`${name} puts ${field} on the enriched item`, () => {
        // Assignment in the RESPONSE object, not merely a local variable: the
        // bug was `addedAt` living on an intermediate object that the response
        // was assembled from by hand.
        expect(src).toMatch(new RegExp(`${field}:\\s*item\\.${field}`));
      });
    }
  }
});
