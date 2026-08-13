import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

// SM44 (2026-08-13) — THE HEAL LATENCY BUDGET.
//
// This route heals-then-scores serially, up to MAX_IDS items, and every heal is
// a provider call. It had a call-COUNT guard (MAX_IDS) and no time guard at all,
// so while RAWG was down (Cloudflare 522, ~19.8 s × 3 attempts ≈ 60 s per call)
// a 24-game batch measured **66 s** on one half-open probe and ~3 min on a cold
// process. The client's fetch just hangs for all of it, so the Fandex Score
// never paints on a page the user is actively searching with.
//
// What these pin is therefore NOT the happy path — that passed throughout the
// outage — but the two properties it lacked:
//   1. a dead provider costs the request a BUDGET, once, not a retry ladder per
//      item, and a healthy provider behind it in the same batch still heals;
//   2. an id we couldn't heal comes back DEFERRED, never as `scores[id] = null`,
//      because the client caches a null as final and would leave that card
//      permanently score-less until a reload — which would make the latency fix
//      a regression against the very bug it exists to fix.
//
// The providers are mocked (a hanging fetchById is the outage, in one line);
// this is about what the loop does with them.

const USER = "u-scores";

vi.mock("@/lib/session", () => ({
  requireSession: async () => ({ userId: USER, identityId: "i1", provider: "trakt" }),
}));

const tmdbFetchById = vi.fn();
const rawgFetchById = vi.fn();
const igdbFetchById = vi.fn();

vi.mock("@/lib/metadata/registry", () => {
  const METADATA = {
    tmdb: { id: "tmdb", mediaTypes: ["movie", "show"], primary: true, fetchById: (...a: any[]) => tmdbFetchById(...a) },
    rawg: { id: "rawg", mediaTypes: ["game"], fetchById: (...a: any[]) => rawgFetchById(...a) },
    igdb: { id: "igdb", mediaTypes: ["game"], configured: () => true, fetchById: (...a: any[]) => igdbFetchById(...a) },
  };
  return {
    METADATA,
    getMetadata: (id: string) => (METADATA as any)[id],
    metadataForType: (type: string) => Object.values(METADATA).filter((p: any) => p.mediaTypes.includes(type)),
  };
});

import { initDb, run, get } from "@/lib/db";
import { __resetBreakers, ProviderUnavailableError } from "@/lib/http";
import { PROJECTION_VERSION } from "@/lib/sources/project";
import { POST } from "./route";

initDb();

/** A provider that never answers — the outage, minus the 60 s wait. */
const hangs = () => new Promise<never>(() => {});

// Real uuids, because a heal only PERSISTS for one: storeRefreshed guards on
// `UUID_RE.test(mediaItemId)` so the live (no-row) detail paths can't write.
const uuid = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const MOVIE = uuid(9001);

function seed(id: string, type: "game" | "movie") {
  run(
    `INSERT INTO media_items (id, type, title, norm_title, browsed) VALUES (?, ?, ?, ?, 1)`,
    [id, type, id, id]
  );
  const sources = type === "game" ? ["igdb", "rawg"] : ["tmdb"];
  for (const source of sources) {
    run(
      `INSERT INTO media_links (id, media_item_id, source, source_id, title, raw_data, projection_version)
       VALUES (?, ?, ?, ?, ?, '{"name":"seed"}', 0)`,
      [`${id}-${source}`, id, source, `${source}-${id}`, id]
    );
  }
}

const post = (ids: string[]) =>
  POST(
    new NextRequest("http://localhost:3000/api/discover/scores", {
      method: "POST",
      body: JSON.stringify({ ids }),
      headers: { "Content-Type": "application/json" },
    })
  );

beforeEach(() => {
  run("DELETE FROM media_links");
  run("DELETE FROM media_items");
  run("DELETE FROM users");
  run("INSERT INTO users (id) VALUES (?)", [USER]);
  __resetBreakers();
  tmdbFetchById.mockReset();
  rawgFetchById.mockReset();
  igdbFetchById.mockReset();
  // Small enough that a test doesn't sit through the real 10 s budget. The
  // RATIOS are what the assertions rest on (one call may spend at most a
  // quarter of the request), not the absolute values.
  vi.stubEnv("HEAL_BUDGET_MS", "400");
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/discover/scores — heal budget (SM44)", () => {
  it("returns promptly when the game providers hang, instead of one ladder per item", async () => {
    const ids = Array.from({ length: 24 }, (_, i) => uuid(i));
    for (const id of ids) seed(id, "game");
    rawgFetchById.mockImplementation(hangs);
    igdbFetchById.mockImplementation(hangs);

    const t0 = Date.now();
    const res = await post(ids);
    const elapsed = Date.now() - t0;
    const body = await res.json();

    expect(res.status).toBe(200);
    // One per-call timeout each, then IGDB and RAWG are both written off for the
    // rest of the request — NOT 24 × 2 timeouts, and nowhere near 24 ladders.
    expect(elapsed).toBeLessThan(3_000);
    expect(body.deferred).toHaveLength(24);
    // The whole point: not one of them may be a cached-as-final null.
    expect(Object.keys(body.scores)).toHaveLength(0);
  });

  it("still heals a healthy provider's items in the same batch as a dead one", async () => {
    const games = Array.from({ length: 12 }, (_, i) => uuid(i));
    for (const id of games) seed(id, "game");
    seed(MOVIE, "movie"); // deliberately LAST — the dead provider must not starve it
    rawgFetchById.mockImplementation(hangs);
    igdbFetchById.mockImplementation(hangs);
    tmdbFetchById.mockResolvedValue({
      source: "tmdb", sourceId: `tmdb-${MOVIE}`, title: "Healed Movie",
      releaseDate: "2020-01-01", rawData: { id: 1, title: "Healed Movie" },
    });

    const body = await (await post([...games, MOVIE])).json();

    expect(body.deferred).toEqual(games);
    expect(body.scores).toHaveProperty(MOVIE);
    expect(body.deferred).not.toContain(MOVIE);
    // Healed AND persisted, so it never has to be refetched again.
    expect(tmdbFetchById).toHaveBeenCalledTimes(1);
    const link = get<{ projection_version: number }>(
      "SELECT projection_version FROM media_links WHERE media_item_id = ?",
      [MOVIE]
    );
    expect(link?.projection_version).toBe(PROJECTION_VERSION);
  });

  it("defers rather than nulls when the provider throws (an open breaker)", async () => {
    const id = uuid(1);
    seed(id, "game");
    igdbFetchById.mockRejectedValue(new ProviderUnavailableError("api.igdb.com", 30_000));
    rawgFetchById.mockRejectedValue(new ProviderUnavailableError("api.rawg.io", 30_000));

    const body = await (await post([id])).json();

    expect(body.deferred).toEqual([id]);
    expect(body.scores[id]).toBeUndefined();
  });

  // Games are a two-provider medium, so "one source is down" must not mean "no
  // score". Deferring an item that IGDB just healed would swap a 66 s stall for
  // a permanently blank badge — the same complaint in different clothes.
  it("scores a game whose OTHER provider healed, even with one source dead", async () => {
    const id = uuid(3);
    seed(id, "game");
    igdbFetchById.mockResolvedValue({
      source: "igdb", sourceId: `igdb-${id}`, title: "Playable",
      releaseDate: "2024-06-01", rawData: { id: 5, name: "Playable", genres: [{ name: "RPG" }] },
    });
    rawgFetchById.mockImplementation(hangs);

    const body = await (await post([id])).json();

    expect(body.deferred).toEqual([]);
    expect(body.scores).toHaveProperty(id);
    const link = get<{ projection_version: number }>(
      "SELECT projection_version FROM media_links WHERE media_item_id = ? AND source = 'igdb'",
      [id]
    );
    expect(link?.projection_version).toBe(PROJECTION_VERSION);
  });

  it("scores a game whose surviving provider was ALREADY fresh", async () => {
    const id = uuid(4);
    seed(id, "game");
    run("UPDATE media_links SET projection_version = ? WHERE media_item_id = ? AND source = 'igdb'", [
      PROJECTION_VERSION, id,
    ]);
    rawgFetchById.mockImplementation(hangs);

    const body = await (await post([id])).json();

    // Nothing healed this time, but the item was never thin — a dead RAWG is
    // not a reason to withhold a score it already had the data for.
    expect(body.deferred).toEqual([]);
    expect(body.scores).toHaveProperty(id);
    expect(igdbFetchById).not.toHaveBeenCalled();
  });

  it("keeps null FINAL for an item that is genuinely unscoreable", async () => {
    // Nothing stale (already at the current projection version), so no provider
    // is consulted at all — the null is an answer, not a timeout.
    const id = uuid(2);
    run(`INSERT INTO media_items (id, type, title, norm_title, browsed) VALUES (?, 'movie', 'M2', 'm2', 1)`, [id]);
    run(
      `INSERT INTO media_links (id, media_item_id, source, source_id, title, raw_data, projection_version)
       VALUES (?, ?, 'tmdb', 'tmdb-m2', 'M2', '{}', ?)`,
      [`${id}-tmdb`, id, PROJECTION_VERSION]
    );

    const body = await (await post([id])).json();

    expect(body.deferred).toEqual([]);
    expect(body.scores).toHaveProperty(id);
    expect(body.scores[id]).toBeNull();
    expect(tmdbFetchById).not.toHaveBeenCalled();
  });

  it("never lists an id as both deferred and scored", async () => {
    for (const id of [uuid(1), uuid(2)]) seed(id, "game");
    seed(MOVIE, "movie");
    rawgFetchById.mockImplementation(hangs);
    igdbFetchById.mockImplementation(hangs);
    tmdbFetchById.mockResolvedValue({
      source: "tmdb", sourceId: `tmdb-${MOVIE}`, title: "M", releaseDate: null, rawData: { id: 1, title: "M" },
    });

    const body = await (await post([uuid(1), uuid(2), MOVIE])).json();

    expect(body.deferred.length).toBeGreaterThan(0);
    for (const id of body.deferred) expect(Object.keys(body.scores)).not.toContain(id);
  });
});
