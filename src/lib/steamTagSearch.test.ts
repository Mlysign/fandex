import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Steam tag search (2026-08-13) — the games-tag source the other three
// providers can't be.
//
// Nils's query, `deckbuilding` + `tower defense`, returns ZERO from TMDB, RAWG
// and IGDB combined: IGDB's keyword vocabulary matched a handful of obscure
// indies and the other two have no such tag at all. Steam has both as
// first-class tags and returns **277** games for the conjunction (Overdungeon,
// ORX, Necronator: Dead Wrong).
//
// ⚠️ THE TRAP THIS FILE EXISTS FOR. The obvious filter key, `filters.tagids`, is
// silently IGNORED by the API: it answers HTTP 200 with the entire catalog —
// 260,878 records — for every query, so three different tag combinations came
// back byte-identical and all three looked like they worked. The filter that
// actually filters is `tagids_must_match`, a list of GROUPS that AND together.
// A regression to the ignored key would not fail loudly anywhere else: the page
// would just quietly fill with the whole store.

vi.hoisted(() => { process.env.STEAM_API_KEY = "test-key"; });

import { searchSteamByTags, steamTagId, __resetSteamTagCache } from "@/lib/sources/steam";

const TAGS = {
  response: {
    tags: [
      { tagid: 1645, name: "Tower Defense" },
      { tagid: 32322, name: "Deckbuilding" },
      { tagid: 1666, name: "Card Game" },
    ],
  },
};

const STORE_ITEM = {
  appid: 1,
  name: "Overdungeon",
  tagids: [1645, 32322],
  release: { steam_release_date: 1_600_000_000 },
  reviews: { summary_filtered: { percent_positive: 90, review_count: 1200 } },
};

let queryUrls: string[] = [];

function serveSteam(items: any[] = [STORE_ITEM]) {
  queryUrls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("GetTagList")) return new Response(JSON.stringify(TAGS), { status: 200 });
    queryUrls.push(u);
    return new Response(JSON.stringify({ response: { store_items: items } }), { status: 200 });
  }));
}

/** The decoded `input_json` of the last Query call. */
const lastInput = () => JSON.parse(decodeURIComponent(queryUrls.at(-1)!.match(/input_json=([^&]+)/)![1]));

beforeEach(() => { __resetSteamTagCache(); serveSteam(); });
afterEach(() => vi.unstubAllGlobals());

describe("searchSteamByTags", () => {
  it("sends tagids_must_match — one AND group per tag — not the ignored filters.tagids", async () => {
    await searchSteamByTags(["Tower Defense", "Deckbuilding"]);

    const filters = lastInput().query.filters;
    // The whole point. `tagids` here is the key that silently returns the store.
    expect(filters.tagids).toBeUndefined();
    expect(filters.tagids_must_match).toEqual([{ tagids: [1645] }, { tagids: [32322] }]);
    expect(filters.type_filters.include_games).toBe(true);
  });

  it("uses sort 2 — measured as the only ordering that surfaces real titles", async () => {
    await searchSteamByTags(["Tower Defense"]);
    // Sorts 0/3/5 lead with untranslated asset flips and 1 is alphabetical; 2
    // returns Overdungeon/ORX/Core Defense. Pinned so a future tweak is a choice.
    expect(lastInput().query.sort).toBe(2);
  });

  it("resolves tag names case-insensitively", async () => {
    expect(await steamTagId("tower defense")).toBe(1645);
    expect(await steamTagId("TOWER DEFENSE")).toBe(1645);
    expect(await steamTagId("Nonexistent Tag")).toBeNull();
  });

  it("returns nothing when a tag is unknown, rather than widening the AND", async () => {
    const out = await searchSteamByTags(["Tower Defense", "Not A Steam Tag"]);

    // Dropping the unresolvable half would answer a DIFFERENT, broader question
    // while still being labelled "tower defense AND …" on screen.
    expect(out).toEqual([]);
    expect(queryUrls).toHaveLength(0); // and doesn't spend a request finding out
  });

  it("attaches resolvedTags, so a row stored from here scores on Steam's vocabulary", async () => {
    const [item] = await searchSteamByTags(["Tower Defense", "Deckbuilding"]);

    // mergeLinks' TAG_SOURCES already includes steam and normalizeSteam reads
    // `resolvedTags`, so this is what makes a Steam-found game scoreable rather
    // than merely findable.
    expect(item.resolvedTags).toEqual(["Tower Defense", "Deckbuilding"]);
  });

  it("degrades to an empty set rather than throwing — it is a browse path", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      String(url).includes("GetTagList")
        ? new Response(JSON.stringify(TAGS), { status: 200 })
        : new Response("upstream is unhappy", { status: 503 })
    ));

    await expect(searchSteamByTags(["Tower Defense"])).resolves.toEqual([]);
  });
});
