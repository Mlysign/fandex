import { describe, expect, it } from "vitest";
import { rankedTagNames, steamAppIdOf, STEAM_TAG_COUNT } from "./steam";

describe("Steam's store tags", () => {
  const map = { 19: "Action", 1663: "FPS", 3859: "Multiplayer", 1774: "Shooter" };

  it("names the tags heaviest first, drops ids the list does not know, and never repeats one", () => {
    expect(rankedTagNames([{ tagid: 1663, weight: 1445 }, { tagid: 19, weight: 1612 }, { tagid: 99999, weight: 900 }, { tagid: 3859, weight: 1021 }, { tagid: 19, weight: 5 }], map))
      .toEqual(["Action", "FPS", "Multiplayer"]);
    expect(rankedTagNames(undefined, map)).toEqual([]);
    expect(rankedTagNames("tags", map)).toEqual([]);
  });

  it("keeps at most the twenty a store page shows", () => {
    const many: Record<number, string> = {};
    const tags = Array.from({ length: 30 }, (_, i) => { many[i + 1] = `t${i + 1}`; return { tagid: i + 1, weight: 100 - i }; });
    expect(rankedTagNames(tags, many)).toHaveLength(STEAM_TAG_COUNT);
  });

  it("reads a game's Steam app id off its IGDB websites, and nothing else", () => {
    expect(steamAppIdOf({ websites: [{ url: "https://www.gog.com/game/x" }, { url: "https://store.steampowered.com/app/292030/The_Witcher_3" }] })).toBe(292030);
    expect(steamAppIdOf({ websites: [{ url: "https://steamcommunity.com/app/292030" }] })).toBeNull();
    expect(steamAppIdOf({})).toBeNull();
    expect(steamAppIdOf(null)).toBeNull();
  });
});
