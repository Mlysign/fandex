import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run, get, query } from "./db";
import {
  markEpisodes, unmarkEpisodes, loadWatched, watchedCounts,
  reconcileProviderEpisodes, type PulledEpisode,
} from "./episodes";

// MB14. The catalog half is a lazy TMDB fetch and is exercised through the route;
// what needs pinning HERE is the personal half, because its failure mode is
// silent loss of a user's watch history.
//
// Two properties carry all the risk:
//   1. `sources` is per-provider, so a provider prune must only ever remove what
//      that provider is responsible for — a purely local tick survives it.
//   2. reconcile treats absence as removal, which is correct ONLY after a
//      complete pull. syncProvider's placement is what guarantees that (pinned
//      in sync/syncProvider.test.ts); here we pin that the reconcile itself does
//      what that placement assumes.

initDb();

const USER = "u-ep";
const OTHER = "u-other";
const SHOW = "show-1";
const SHOW2 = "show-2";

beforeEach(() => {
  run("DELETE FROM user_episode_state");
  run("DELETE FROM media_items");
  run("DELETE FROM users");
  for (const u of [USER, OTHER]) run("INSERT INTO users (id) VALUES (?)", [u]);
  for (const s of [SHOW, SHOW2]) {
    run("INSERT INTO media_items (id, type, title, norm_title) VALUES (?, 'show', ?, ?)", [s, s, s]);
  }
});

const ep = (season: number, episode: number, watchedAt?: number): PulledEpisode => ({
  season, episode, watchedAt: watchedAt ?? null,
});

const sourcesOf = (season: number, episode: number, item = SHOW, user = USER) =>
  JSON.parse(
    get<{ sources: string }>(
      `SELECT sources FROM user_episode_state
        WHERE user_id = ? AND media_item_id = ? AND season_number = ? AND episode_number = ?`,
      [user, item, season, episode],
    )?.sources ?? "null",
  );

describe("markEpisodes / unmarkEpisodes", () => {
  it("marks a batch and counts it per season", () => {
    markEpisodes(USER, SHOW, [ep(1, 1), ep(1, 2), ep(2, 1)]);
    expect(watchedCounts(USER, SHOW)).toEqual({ 1: 2, 2: 1 });
    expect(loadWatched(USER, SHOW, 1).map((w) => w.episode)).toEqual([1, 2]);
  });

  it("records ['local'] when nothing was pushed, and the pushed providers when it was", () => {
    markEpisodes(USER, SHOW, [ep(1, 1)]);
    expect(sourcesOf(1, 1)).toEqual(["local"]);

    markEpisodes(USER, SHOW, [ep(1, 2)], { sources: ["trakt"] });
    expect(sourcesOf(1, 2)).toEqual(["trakt"]);
  });

  it("is idempotent — re-marking unions sources and keeps the first watched_at", () => {
    markEpisodes(USER, SHOW, [ep(1, 1)], { sources: ["local"], watchedAt: 1000 });
    markEpisodes(USER, SHOW, [ep(1, 1)], { sources: ["trakt"], watchedAt: 2000 });

    expect(sourcesOf(1, 1).sort()).toEqual(["local", "trakt"]);
    expect(loadWatched(USER, SHOW, 1)[0].watchedAt).toBe(1000);
    expect(watchedCounts(USER, SHOW)).toEqual({ 1: 1 });
  });

  it("un-marking removes the row outright", () => {
    markEpisodes(USER, SHOW, [ep(1, 1), ep(1, 2)]);
    expect(unmarkEpisodes(USER, SHOW, [ep(1, 1)])).toBe(1);
    expect(watchedCounts(USER, SHOW)).toEqual({ 1: 1 });
  });

  it("never touches another user's rows", () => {
    markEpisodes(OTHER, SHOW, [ep(1, 1)]);
    markEpisodes(USER, SHOW, [ep(1, 1)]);
    unmarkEpisodes(USER, SHOW, [ep(1, 1)]);
    expect(watchedCounts(OTHER, SHOW)).toEqual({ 1: 1 });
  });
});

describe("reconcileProviderEpisodes", () => {
  it("attaches what the provider reports, including episodes we've never seen", () => {
    const res = reconcileProviderEpisodes(USER, "trakt", new Map([[SHOW, [ep(1, 1, 500), ep(1, 2)]]]));
    expect(res.attached).toBe(2);
    expect(watchedCounts(USER, SHOW)).toEqual({ 1: 2 });
    expect(sourcesOf(1, 1)).toEqual(["trakt"]);
    expect(loadWatched(USER, SHOW, 1)[0].watchedAt).toBe(500);
  });

  it("adds the provider to a row we already had locally, without losing 'local'", () => {
    markEpisodes(USER, SHOW, [ep(1, 1)]);
    reconcileProviderEpisodes(USER, "trakt", new Map([[SHOW, [ep(1, 1)]]]));
    expect(sourcesOf(1, 1).sort()).toEqual(["local", "trakt"]);
  });

  it("detaches an episode the provider no longer reports", () => {
    reconcileProviderEpisodes(USER, "trakt", new Map([[SHOW, [ep(1, 1), ep(1, 2)]]]));
    const res = reconcileProviderEpisodes(USER, "trakt", new Map([[SHOW, [ep(1, 1)]]]));
    expect(res.detached).toBe(1);
    expect(watchedCounts(USER, SHOW)).toEqual({ 1: 1 });
  });

  it("a purely LOCAL tick survives a provider prune", () => {
    // The whole reason `sources` is an array. Trakt has never heard of 1x9, so
    // its pull saying "not watched" is not evidence about a mark we only hold here.
    markEpisodes(USER, SHOW, [ep(1, 9)]);
    reconcileProviderEpisodes(USER, "trakt", new Map([[SHOW, []]]));
    expect(watchedCounts(USER, SHOW)).toEqual({ 1: 1 });
    expect(sourcesOf(1, 9)).toEqual(["local"]);
  });

  it("a shared row loses only the pruned provider, not the row", () => {
    markEpisodes(USER, SHOW, [ep(1, 1)], { sources: ["local", "trakt"] });
    reconcileProviderEpisodes(USER, "trakt", new Map([[SHOW, []]]));
    expect(sourcesOf(1, 1)).toEqual(["local"]);
  });

  it("prunes a show that dropped out of the pull entirely", () => {
    reconcileProviderEpisodes(USER, "trakt", new Map([[SHOW, [ep(1, 1)]], [SHOW2, [ep(1, 1)]]]));
    expect(watchedCounts(USER, SHOW2)).toEqual({ 1: 1 });

    reconcileProviderEpisodes(USER, "trakt", new Map([[SHOW, [ep(1, 1)]]]));
    expect(watchedCounts(USER, SHOW2)).toEqual({});
    expect(watchedCounts(USER, SHOW)).toEqual({ 1: 1 });
  });

  it("is scoped to one user", () => {
    markEpisodes(OTHER, SHOW, [ep(1, 1)], { sources: ["trakt"] });
    reconcileProviderEpisodes(USER, "trakt", new Map());
    expect(watchedCounts(OTHER, SHOW)).toEqual({ 1: 1 });
  });

  it("an empty map with no matching source is a no-op, not a wipe", () => {
    markEpisodes(USER, SHOW, [ep(1, 1)], { sources: ["local"] });
    const res = reconcileProviderEpisodes(USER, "tmdb", new Map());
    expect(res).toEqual({ attached: 0, detached: 0 });
    expect(watchedCounts(USER, SHOW)).toEqual({ 1: 1 });
  });
});

describe("schema guarantees the rest of the app depends on", () => {
  it("names the owning column user_id, so GDPR erasure finds it", () => {
    // deleteAccount() reads sqlite_master for a column literally named user_id.
    // Rename it and erasure silently skips this table with every test green.
    const cols = query<{ name: string }>("PRAGMA table_info(user_episode_state)");
    expect(cols.map((c) => c.name)).toContain("user_id");
  });

  it("keeps the catalog tables free of a user_id, so erasure can't delete them", () => {
    for (const t of ["show_seasons", "show_episodes"]) {
      const cols = query<{ name: string }>(`PRAGMA table_info(${t})`);
      expect(cols.map((c) => c.name)).not.toContain("user_id");
    }
  });
});
