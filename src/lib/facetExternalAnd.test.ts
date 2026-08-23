import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// 2026-08-13 — advanced search's DATABASE half, made to behave like the local
// half. Two defects, one screenshot:
//
//   1. Multiple include-facets were **UNIONed** here while `find()` ANDed them.
//      `deckbuilding` + `tower defense` therefore returned 0 local results and
//      69 external ones — StarCraft and Doom 3 on screen under a filter neither
//      of them matches. One filter, two contradictory readings.
//   2. The external candidates carried **no raw payload**, so they could never
//      be persisted. No row → no uuid → nothing for the Fandex Score to attach
//      to and nothing for /api/discover/scores to heal. Every one of those cards
//      fell through to a `/10` community rating in the Fandex slot, which is
//      what made the feature look like it had reverted.
//
// So these pin the two properties the surface lacked: an AND that holds ACROSS
// SOURCES (a game can come back from one provider under one tag and another
// under the other — intersecting on source ids would drop exactly the titles
// that match both), and a candidate set that lands in the catalog so it can be
// scored.
//
// ⚠️ PL3 (2026-08-23) removed RAWG from this surface, and TWO cases went with
// it rather than being rewritten: "keeps only RAWG results that actually carry
// EVERY tag" and "does not apply that filter to a single tag". Both pinned a
// guard that existed because RAWG's comma semantics for genres/tags were OR in
// some places and undocumented in others, so its results had to be re-verified
// against the payload. IGDB and Steam express the conjunction natively, so
// there is no such guard left to protect. The cases were deleted, not ported,
// because porting them would have asserted a behaviour the code no longer has.
// The AND-across-sources property itself is still pinned below.

// facetDetail.ts reads the provider keys at MODULE LOAD (`const RAWG =
// process.env.RAWG_API_KEY`), so a beforeEach stub lands far too late — rawgJson
// would return null before touching the stubbed fetch, and every case here would
// pass vacuously with an empty set.
vi.hoisted(() => {
  process.env.RAWG_API_KEY = "test-key";
  process.env.TMDB_API_KEY = "test-key";
});

const igdbByTag = vi.fn(async (..._a: any[]) => [] as any[]);

vi.mock("@/lib/sources/igdb", async (importOriginal) => ({
  // Partial: IGDB_HOST is read by detail/enrich.ts's breaker check, which this
  // module graph pulls in via liveDiscover → fandexForPage.
  ...(await importOriginal<Record<string, unknown>>()),
  igdbConfigured: () => true,
  discoverIgdbByTags: (...a: any[]) => igdbByTag(...a),
  igdbImageUrl: (id?: string) => (id ? `https://images.igdb.com/${id}.jpg` : null),
  igdbReleaseDate: (g: any) => g.__date ?? null,
}));

// Tag keys resolve to RAWG genre slugs only, so every pull in these tests is a
// single RAWG request per tag — the smallest shape that still exercises AND.
vi.mock("@/lib/sources/tagDiscover", () => ({
  tmdbGenreId: () => null,
  resolveTmdbKeywordId: async () => null,
  rawgGenreSlug: (k: string) => k.replace(/\s+/g, "-"),
  rawgTagSlug: (k: string) => k.replace(/\s+/g, "-"),
}));

import { initDb, run, get } from "@/lib/db";
import { __resetBreakers } from "@/lib/http";
import { buildExternalSets, extTitleKey } from "@/lib/facetDetail";

initDb();

const USER = "u-facet-and";

/** An IGDB game as `discoverIgdbByTags` returns it. `__date` is what the
 *  mocked `igdbReleaseDate` reads. */
const igdbGame = (id: number, name: string, date: string) => ({
  id, name, __date: date, total_rating: 80, total_rating_count: 500,
});

/** Every remaining provider on this path answers empty. TMDB is stubbed out by
 *  the tagDiscover mock (no genre, no keyword), Steam's tag search needs a key
 *  it does not have here, so this only has to keep a stray fetch from escaping. */
function serveNoProviders() {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ results: [] }), { status: 200 })));
}

const tag = (key: string) => ({ kind: "tag", key, label: key });

beforeEach(() => {
  run("DELETE FROM media_links");
  run("DELETE FROM media_items");
  run("DELETE FROM users");
  run("INSERT INTO users (id) VALUES (?)", [USER]);
  __resetBreakers();
  igdbByTag.mockReset();
  igdbByTag.mockResolvedValue([]);

});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("buildExternalSets — tags are ANDed AT THE PROVIDER", () => {
  it("asks the provider for the conjunction, not for one tag at a time", async () => {
    serveNoProviders();
    await buildExternalSets(USER, [tag("deckbuilding"), tag("tower defense")]);

    // IGDB gets both terms in ONE query so its `&` does the work. Asking once
    // per tag and intersecting afterwards is the bug this pins: each pull is a
    // ~40-row sample of a tag with thousands, so two samples intersect to
    // nothing even when matching games plainly exist.
    expect(igdbByTag).toHaveBeenCalledTimes(1);
    expect(igdbByTag.mock.calls[0][0]).toEqual(["deckbuilding", "tower defense"]);
  });

  it("an empty conjunction ANDs to nothing rather than widening", async () => {
    // The provider returns nothing for the conjunction, which is the honest
    // answer for a pair almost nothing carries. The failure this guards against
    // is widening to "either tag" and showing titles that match neither filter.
    serveNoProviders();
    igdbByTag.mockResolvedValue([]);
    expect(await buildExternalSets(USER, [tag("deckbuilding"), tag("tower defense")])).toEqual([]);
  });

  // Still the intersection key for person/company facets, which resolve to ONE
  // entity with a complete set and so are intersected in memory — there is no
  // provider query for "directed by X and produced by Y".
  it("keys on normalized title + year, so a re-spelled title still matches", () => {
    expect(extTitleKey({ title: "Orcs Must Die!", releaseDate: "2011-10-12" }))
      .toBe(extTitleKey({ title: "orcs must die", releaseDate: "2011-12-31" }));
    expect(extTitleKey({ title: "Doom", releaseDate: "1993-12-10" }))
      .not.toBe(extTitleKey({ title: "Doom", releaseDate: "2016-05-13" }));
  });
});

describe("buildExternalSets — candidates land in the catalog so they can be scored", () => {
  it("thin-writes each candidate and returns its uuid, flagged pending", async () => {
    serveNoProviders();
    igdbByTag.mockResolvedValue([igdbGame(42, "Storable Game", "2023-03-03")]);
    // Enough rated signal that a profile exists — without one, nothing is ever
    // pending (there is no score coming for a cold start).
    const { upsertMediaItem, upsertLibraryEntry } = await import("@/lib/matcher");
    for (let i = 1; i <= 4; i++) {
      const id = upsertMediaItem({
        source: "tmdb", sourceId: `700${i}`, type: "movie", title: `Rated ${i}`,
        releaseDate: "2019-01-01",
        rawData: { id: 7000 + i, title: `Rated ${i}`, genres: [{ name: "Drama" }] },
      });
      upsertLibraryEntry(USER, id, "tmdb", { status: "watched", rating: 7, reviewedAt: i });
    }

    const [item] = await buildExternalSets(USER, [tag("deckbuilding")]);

    // A real uuid, not a synthetic `igdb-game-42` — that is what makes the card
    // linkable AND lets /api/discover/scores heal it by media_items.id.
    expect(item.id).toMatch(/^[0-9a-f-]{36}$/);
    const row = get<{ id: string; browsed: number }>("SELECT id, browsed FROM media_items WHERE id = ?", [item.id]);
    expect(row?.browsed).toBe(1);
    // Thin: stamped version 0, so the first heal refetches the real payload.
    const link = get<{ projection_version: number }>(
      "SELECT projection_version FROM media_links WHERE media_item_id = ?", [item.id]
    );
    expect(link?.projection_version).toBe(0);
    // No score yet, but a promise of one — the card shows the shimmer, not a
    // community rating standing in for a taste match.
    expect(item.fandexScore).toBeNull();
    expect(item.fandexPending).toBe(true);
  });

  // THE THIN-WRITE RULE (AGENTS.md): a discover-time write is insert-only and
  // must never overwrite or degrade a real synced/ingested row. Search now
  // writes on a path that previously never did, so this is the invariant most
  // worth pinning here — a search for a tag you own titles under must not
  // downgrade those titles' payloads to list stubs.
  it("never degrades an already-enriched row it happens to rediscover", async () => {
    const { upsertMediaItem } = await import("@/lib/matcher");
    const { PROJECTION_VERSION } = await import("@/lib/sources/project");
    const rich = { id: 42, name: "Storable Game", __date: "2023-03-03", summary: "the full blob" };
    const id = upsertMediaItem({
      source: "igdb", sourceId: "42", type: "game", title: "Storable Game",
      releaseDate: "2023-03-03", rawData: rich,
    });
    run("UPDATE media_links SET projection_version = ? WHERE media_item_id = ?", [PROJECTION_VERSION, id]);

    serveNoProviders();
    igdbByTag.mockResolvedValue([igdbGame(42, "Storable Game", "2023-03-03")]);
    const [item] = await buildExternalSets(USER, [tag("deckbuilding")]);

    expect(item.id).toBe(id); // resolved to the EXISTING row, not a duplicate
    const link = get<{ projection_version: number; raw_data: string }>(
      "SELECT projection_version, raw_data FROM media_links WHERE media_item_id = ?", [id]
    );
    expect(link?.projection_version).toBe(PROJECTION_VERSION); // not reset to 0
    expect(JSON.parse(link!.raw_data).summary).toBe("the full blob");
    expect(get<{ n: number }>("SELECT COUNT(*) n FROM media_items")?.n).toBe(1);
  });
});
