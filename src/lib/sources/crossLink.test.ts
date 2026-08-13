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
import { runCrossLinkBatch } from "./crossLinkBackfill";

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

  // A (source, source_id) pair is unique across the whole catalog, so when two
  // rows title-match the same store page the link stays with whoever had it and
  // ours gains nothing. Reporting that as success made the first real backfill
  // claim 249 links while creating 241 rows — a discrepancy that would have read
  // as "done" while 8 games stayed unlinked and got re-searched every sweep.
  it("does NOT claim a link that another catalog row already owns", async () => {
    const owner = seedGame("first");
    const other = seedGame("second");
    searchByTitle.steam.mockResolvedValue(hit("steam", "440"));

    expect(await crossLinkGame(owner, "Test Game")).toEqual(["steam"]);
    expect(await crossLinkGame(other, "Test Game")).toEqual([]); // honest: it got nothing

    expect(sourcesOf(owner)).toContain("steam");
    expect(sourcesOf(other)).not.toContain("steam");
  });
});

// The bulk pass, which /api/dev/crosslink drives one request at a time against
// prod. Its termination is the whole game — see the cursor note below.
describe("runCrossLinkBatch — the resumable sweep", () => {
  const seedMany = (n: number) =>
    Array.from({ length: n }, (_, i) => seedGame(String(500 + i)));

  it("bounds a batch by maxItems and hands back a cursor", async () => {
    seedMany(5);
    searchByTitle.steam.mockResolvedValue(hit("steam", "440"));

    const first = await runCrossLinkBatch({ sources: ["steam"], maxItems: 2 });

    expect(first.itemsProcessed).toBe(2);
    expect(first.remaining).toBe(3);
    expect(first.nextAfterId).toBeTruthy();
  });

  // ⚠️ THE ONE THAT MATTERS. 232 of the real catalog's games simply are not on
  // Steam — console exclusives, mostly — so they stay "missing a Steam link"
  // however many times they're searched. A sweep driven off "what's still
  // missing" would re-search those forever and `remaining` would never fall
  // below 232. The cursor is what makes it terminate.
  it("TERMINATES even when no provider ever matches", async () => {
    seedMany(5);
    for (const k of Object.keys(searchByTitle) as (keyof typeof searchByTitle)[]) {
      searchByTitle[k].mockResolvedValue(null); // nothing is findable anywhere
    }

    let afterId: string | null = null;
    let batches = 0;
    let visited = 0;
    for (;;) {
      const r: Awaited<ReturnType<typeof runCrossLinkBatch>> =
        await runCrossLinkBatch({ sources: ["steam"], maxItems: 2, afterId });
      visited += r.itemsProcessed;
      afterId = r.nextAfterId;
      if (++batches > 10) throw new Error("sweep did not terminate");
      if (!afterId) break;
    }

    expect(visited).toBe(5);   // each game visited exactly once…
    expect(batches).toBe(3);   // …across 2 + 2 + 1
  });

  it("resumes from the cursor without revisiting or skipping", async () => {
    const ids = seedMany(6).sort();
    // A DISTINCT appid per game — a (source, source_id) pair is unique, so
    // reusing one would silently give only the first game a link.
    let n = 0;
    searchByTitle.steam.mockImplementation(async () => hit("steam", String(900 + n++)));
    const seen: string[] = [];

    let afterId: string | null = null;
    for (let i = 0; i < 3; i++) {
      const r: Awaited<ReturnType<typeof runCrossLinkBatch>> = await runCrossLinkBatch({
        sources: ["steam"], maxItems: 2, afterId,
        onProgress: (title) => seen.push(title),
      });
      afterId = r.nextAfterId;
    }

    expect(seen).toHaveLength(6);
    // Every game linked exactly once — no duplicates from a re-walked cursor.
    for (const id of ids) expect(sourcesOf(id)).toContain("steam");
  });

  it("stops on the wall-clock budget and still reports a usable cursor", async () => {
    seedMany(4);
    searchByTitle.steam.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 60));
      return hit("steam", "440");
    });

    const r = await runCrossLinkBatch({ sources: ["steam"], maxItems: 100, budgetMs: 80 });

    expect(r.stoppedOnBudget).toBe(true);
    expect(r.itemsProcessed).toBeLessThan(4);
    expect(r.nextAfterId).toBeTruthy();
  });
});
