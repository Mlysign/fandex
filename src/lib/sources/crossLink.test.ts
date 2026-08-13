import { describe, it, expect, beforeEach, vi } from "vitest";

// Game cross-linking (2026-08-13) — "a game carries a link to every game catalog
// we speak to", in one place instead of two half-copies.
//
// What it replaced: the RAWG adapter fetched Steam, the Steam adapter fetched
// RAWG, neither touched IGDB, and BOTH opened with `if (kind !== "wishlist")
// return` — so nothing anyone actually PLAYED was ever cross-linked. Measured
// consequence: 473 of 1,090 catalog games had no Steam link, and Steam is the
// tag source (446 tags incl. Deckbuilding / Tower Defense, where RAWG and IGDB
// stop at genre level). A missing link is a poorer Fandex Score and a game a tag
// search cannot find.
//
// So these pin the properties that make it safe to run on EVERY item of EVERY
// sync, which is the change: it must cost nothing when there's nothing to do, it
// must never degrade a stored payload, it must stay inside its allowance, and it
// must never throw — it runs inside ingest, and a throw there reads as a failed
// PULL, which under the prune invariant deletes the user's library.

const searchByTitle = {
  steam: vi.fn(),
  rawg: vi.fn(),
  igdb: vi.fn(),
};

vi.mock("@/lib/metadata/registry", () => ({
  METADATA: {
    steam: { id: "steam", mediaTypes: ["game"], searchByTitle: (...a: any[]) => searchByTitle.steam(...a) },
    rawg: { id: "rawg", mediaTypes: ["game"], searchByTitle: (...a: any[]) => searchByTitle.rawg(...a) },
    igdb: { id: "igdb", mediaTypes: ["game"], configured: () => true, searchByTitle: (...a: any[]) => searchByTitle.igdb(...a) },
  },
  getMetadata: () => undefined,
  metadataForType: () => [],
}));

import { initDb, run, query, get } from "@/lib/db";
import { upsertMediaItem } from "@/lib/matcher";
import { crossLinkGame, crossLinkBudget } from "./crossLink";

initDb();

const hit = (source: string, sourceId: string, extra: any = {}) => ({
  source, sourceId, title: `Found on ${source}`, releaseDate: "2021-01-01",
  rawData: { id: sourceId, name: `Found on ${source}`, ...extra },
});

function seedGame(sourceId = "1", source = "rawg") {
  return upsertMediaItem({
    source: source as any, sourceId, type: "game", title: "Test Game",
    releaseDate: "2021-06-01", rawData: { id: sourceId, name: "Test Game" },
  });
}

const sourcesOf = (id: string) =>
  query<{ source: string }>("SELECT source FROM media_links WHERE media_item_id = ?", [id])
    .map((r) => r.source).sort();

beforeEach(() => {
  run("DELETE FROM media_links");
  run("DELETE FROM media_items");
  for (const k of Object.keys(searchByTitle) as (keyof typeof searchByTitle)[]) {
    searchByTitle[k].mockReset();
    searchByTitle[k].mockResolvedValue(null);
  }
});

describe("crossLinkGame", () => {
  it("adds every missing catalog link, including Steam for a played game", async () => {
    const id = seedGame();
    searchByTitle.steam.mockResolvedValue(hit("steam", "440"));
    searchByTitle.igdb.mockResolvedValue(hit("igdb", "77"));

    const added = await crossLinkGame(id, "Test Game");

    expect(added.sort()).toEqual(["igdb", "steam"]);
    expect(sourcesOf(id)).toEqual(["igdb", "rawg", "steam"]);
  });

  it("costs NOTHING when the links already exist — no search, no write", async () => {
    const id = seedGame();
    for (const s of ["steam", "igdb"]) {
      run(
        `INSERT INTO media_links (id, media_item_id, source, source_id, title, raw_data)
         VALUES (?, ?, ?, '9', 'Test Game', '{}')`,
        [`${id}-${s}`, id, s]
      );
    }

    expect(await crossLinkGame(id, "Test Game")).toEqual([]);
    // The point: an item that's done is one indexed SELECT, which is what makes
    // this safe to run on every item of every sync.
    expect(searchByTitle.steam).not.toHaveBeenCalled();
    expect(searchByTitle.igdb).not.toHaveBeenCalled();
    expect(searchByTitle.rawg).not.toHaveBeenCalled();
  });

  it("never degrades an existing link's stored payload (the thin-write rule)", async () => {
    const id = upsertMediaItem({
      source: "steam", sourceId: "440", type: "game", title: "Test Game",
      releaseDate: "2021-06-01", rawData: { id: "440", name: "Test Game", short_description: "the full blob" },
    });
    searchByTitle.steam.mockResolvedValue(hit("steam", "440")); // would overwrite if called

    await crossLinkGame(id, "Test Game");

    const link = get<{ raw_data: string }>(
      "SELECT raw_data FROM media_links WHERE media_item_id = ? AND source = 'steam'", [id]
    );
    expect(JSON.parse(link!.raw_data).short_description).toBe("the full blob");
  });

  it("stays inside its allowance, so an un-backfilled catalog can't run for minutes", async () => {
    searchByTitle.steam.mockResolvedValue(hit("steam", "1"));
    searchByTitle.igdb.mockResolvedValue(hit("igdb", "1"));
    const budget = crossLinkBudget(3);

    for (let i = 0; i < 5; i++) {
      await crossLinkGame(seedGame(String(100 + i)), "Test Game", { budget });
    }

    // 3 searches spent, then it stops asking — regardless of how many remain.
    const calls = searchByTitle.steam.mock.calls.length + searchByTitle.igdb.mock.calls.length;
    expect(calls).toBe(3);
    expect(budget.remaining).toBe(0);
  });

  it("passes the known year, so a port or remaster doesn't win the match", async () => {
    const id = seedGame();
    await crossLinkGame(id, "Test Game", { releaseDate: "2007-08-21" });

    expect(searchByTitle.steam).toHaveBeenCalledWith("Test Game", "game", { year: 2007 });
  });

  it("SWALLOWS a provider failure — a throw here would read as a failed pull", async () => {
    const id = seedGame();
    searchByTitle.steam.mockRejectedValue(new Error("steam is down"));
    searchByTitle.igdb.mockResolvedValue(hit("igdb", "77"));

    // syncProvider treats a throw as the PULL failing, and the prune invariant
    // then deletes everything that pull didn't return. A best-effort enrichment
    // must never be able to reach that.
    await expect(crossLinkGame(id, "Test Game")).resolves.toEqual(["igdb"]);
    expect(sourcesOf(id)).toEqual(["igdb", "rawg"]);
  });

  it("does nothing for an untitled item rather than searching for an empty string", async () => {
    const id = seedGame();
    expect(await crossLinkGame(id, "   ")).toEqual([]);
    expect(searchByTitle.steam).not.toHaveBeenCalled();
  });
});
