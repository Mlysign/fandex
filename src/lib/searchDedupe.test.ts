import { describe, it, expect } from "vitest";
import { itemKeys, dedupeWeb } from "./searchDedupe";

// 2026-08-29, reported from the phone: "Lucky is a popular new show on Apple
// TV+ — how come it does not show up in the search?"
//
// It did not show up because it was DELETED on the way to the screen. The
// client's dedupe keyed a title as `t:{title}:{type}` with no year, so the
// first work to claim a name kept it and every other work of that name was
// discarded as a duplicate of it. Two unrelated shows are both called "Lucky"
// (FX, 2003 · Apple TV+, 2026); TMDB returns both.
//
// What made it always the NEW one that lost: /api/discover returns provider
// results through `sortByDate`, which sorts ASCENDING. So the oldest work with
// a given title reaches the dedupe first, claims the key, and every later one —
// including the thing the user actually typed the name of — is dropped. No
// error, no empty state, no "N hidden": the search simply insists the title
// does not exist, while listing four other things called Lucky.
//
// A test over one item per title would have passed throughout. What has to be
// pinned is that two DISTINCT works sharing a title BOTH survive.
const show = (title: string, releaseDate: string, tmdb: number) => ({
  id: `tmdb-show-${tmdb}`, type: "show", title, releaseDate, ids: { tmdb },
});

describe("dedupeWeb — two works may share a title", () => {
  it("keeps both shows called Lucky, oldest-first order and all", () => {
    // The order /api/discover actually delivers: sortByDate, ascending.
    const web = [
      show("Mr. Lucky", "1959-10-24", 4535),
      show("Lucky", "2003-01-14", 2287),
      show("Stay Lucky", "1989-09-05", 33333),
      show("Lucky", "2026-07-10", 900001),
    ];
    const kept = dedupeWeb([], web);
    expect(kept.map((i) => i.id)).toContain("tmdb-show-900001");
    expect(kept).toHaveLength(4);
  });

  it("still collapses the SAME work returned twice by one provider", () => {
    const dupe = show("Lucky", "2026-07-10", 900001);
    expect(dedupeWeb([], [dupe, { ...dupe }])).toHaveLength(1);
  });

  it("still drops an external hit we already hold locally, matched on its id", () => {
    const local = [{ id: "uuid-1", type: "show", title: "Lucky", releaseDate: "2026-07-09", sources: [{ source: "tmdb", sourceId: "900001" }] }];
    // Note the release dates DIFFER by a day (a local row can carry a regional
    // date). The provider id is what catches it — which is exactly why the
    // title key can afford to be strict.
    expect(dedupeWeb(local, [show("Lucky", "2026-07-10", 900001)])).toEqual([]);
  });

  it("does not let a game's title suppress a show's", () => {
    const game = { id: "igdb-1", type: "game", title: "Lucky", releaseDate: "2026-07-10", ids: { igdb: 1 } };
    expect(dedupeWeb([], [game, show("Lucky", "2026-07-10", 900001)])).toHaveLength(2);
  });
});

describe("itemKeys", () => {
  it("carries the year in the title key", () => {
    expect(itemKeys(show("Lucky", "2026-07-10", 900001))).toContain("t:lucky:show:2026");
  });

  it("survives an item with no title, type or date", () => {
    expect(itemKeys({})).toEqual(["t::undefined:"]);
  });
});
