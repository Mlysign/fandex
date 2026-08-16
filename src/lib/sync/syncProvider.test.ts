import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run, query } from "@/lib/db";
import type { MediaSource, PulledItem } from "@/lib/sources/types";
import { syncProvider } from "./index";

// Regression: a FAILED pull must never prune.
//
// syncProvider prunes every local entry whose source_id is absent from the pull,
// which is correct only when the pull is known-complete. Trakt's pulls used to
// `catch { return [] }`, so any transient 500/429/401 produced an empty pull and
// the prune deleted the user's ENTIRE Trakt library — recorded as status=ok.
// These lock in the contract: a throwing pull leaves local state untouched, and
// only a genuine upstream removal prunes.

initDb();

const USER = "u1";

beforeEach(() => {
  run("DELETE FROM media_items");
  run("DELETE FROM users");
  run("DELETE FROM sync_log");
  run("DELETE FROM user_episode_state");
  run("INSERT INTO users (id) VALUES (?)", [USER]);
});

const item = (sourceId: string, title: string): PulledItem => ({
  sourceId,
  title,
  releaseDate: "2025-01-01",
  type: "movie",
  status: "watched",
  rawData: { ids: { trakt: Number(sourceId) }, title },
});

// A minimal Trakt-shaped adapter whose library pull we control per test.
function source(pullLibrary: () => Promise<PulledItem[]>): MediaSource {
  return {
    id: "trakt",
    label: "Trakt",
    color: "#ed1c24",
    mediaTypes: ["movie"],
    capabilities: {
      wishlist: { read: false, write: false },
      library: { read: true },
      rating: { read: true, write: false },
      review: { read: false, write: false },
      status: { write: false },
    },
    async context() {
      return { userId: USER, identity: {}, token: "tok", slug: null };
    },
    pullLibrary,
  } as unknown as MediaSource;
}

const libraryCount = () =>
  query<{ c: number }>(
    "SELECT COUNT(*) c FROM user_item_state WHERE user_id = ? AND source = 'trakt' AND relation = 'library'",
    [USER]
  )[0].c;

describe("syncProvider — a failed pull must not prune", () => {
  it("keeps the whole library when the pull throws", async () => {
    await syncProvider(USER, source(async () => [item("1", "A"), item("2", "B")]));
    expect(libraryCount()).toBe(2);

    // Trakt goes down mid-session.
    const res = await syncProvider(
      USER,
      source(async () => {
        throw new Error("Trakt API error: 500 /sync/watched/movies");
      })
    );

    expect(libraryCount()).toBe(2); // ← the bug deleted both rows here
    const log = query<{ status: string; error: string }>(
      "SELECT status, error FROM sync_log WHERE provider = 'trakt-library' ORDER BY rowid DESC LIMIT 1"
    )[0];
    expect(log.status).toBe("error"); // ← and recorded this as 'ok'
    expect(log.error).toMatch(/500/);
    expect(res.error).toBeUndefined(); // library errors are logged, not fatal to the run
  });

  it("still prunes an item genuinely removed upstream", async () => {
    await syncProvider(USER, source(async () => [item("1", "A"), item("2", "B")]));
    expect(libraryCount()).toBe(2);

    await syncProvider(USER, source(async () => [item("1", "A")]));
    expect(libraryCount()).toBe(1);
  });

  it("prunes to empty when upstream really is empty", async () => {
    await syncProvider(USER, source(async () => [item("1", "A")]));
    await syncProvider(USER, source(async () => []));
    expect(libraryCount()).toBe(0);
  });
});

// ── MB14: the same invariant, one level deeper ───────────────────────────────
//
// Per-episode state rides on this very pull, and reconcileProviderEpisodes treats
// "absent from the pull" as "un-watched upstream" — so a swallowed error would
// wipe a whole watch history rather than a library row. The property under test
// is the one the outage exposes, NOT the happy path: a pull that FAILS must
// leave every episode untouched. That holds only because the reconcile sits
// inside the try, after the pull; move it out and this test goes red.

const show = (sourceId: string, episodes?: { season: number; episode: number }[]): PulledItem => ({
  sourceId,
  title: `Show ${sourceId}`,
  releaseDate: "2024-01-01",
  type: "show",
  status: "watched",
  rawData: { ids: { trakt: Number(sourceId) }, title: `Show ${sourceId}` },
  ...(episodes ? { episodes } : {}),
});

function showSource(pullLibrary: () => Promise<PulledItem[]>, episodesRead = true): MediaSource {
  return {
    id: "trakt",
    label: "Trakt",
    color: "#ed1c24",
    mediaTypes: ["show"],
    capabilities: {
      wishlist: { read: false, write: false },
      library: { read: true },
      rating: { read: true, write: false },
      review: { read: false, write: false },
      status: { write: false },
      episodes: { read: episodesRead, write: false },
    },
    async context() {
      return { userId: USER, identity: {}, token: "tok", slug: null };
    },
    pullLibrary,
  } as unknown as MediaSource;
}

const episodeCount = () =>
  query<{ c: number }>("SELECT COUNT(*) c FROM user_episode_state WHERE user_id = ?", [USER])[0].c;

describe("syncProvider — episode state (MB14)", () => {
  it("ingests per-episode watched state from the library pull", async () => {
    await syncProvider(
      USER,
      showSource(async () => [show("10", [{ season: 1, episode: 1 }, { season: 1, episode: 2 }])]),
    );
    expect(episodeCount()).toBe(2);
  });

  it("keeps every episode when the pull throws", async () => {
    await syncProvider(
      USER,
      showSource(async () => [show("10", [{ season: 1, episode: 1 }, { season: 1, episode: 2 }])]),
    );
    expect(episodeCount()).toBe(2);

    await syncProvider(
      USER,
      showSource(async () => {
        throw new Error("Trakt API error: 500 /sync/watched/shows");
      }),
    );

    expect(episodeCount()).toBe(2); // a swallowed error here erases a watch history
  });

  it("prunes an episode genuinely un-watched upstream", async () => {
    await syncProvider(
      USER,
      showSource(async () => [show("10", [{ season: 1, episode: 1 }, { season: 1, episode: 2 }])]),
    );
    await syncProvider(USER, showSource(async () => [show("10", [{ season: 1, episode: 1 }])]));
    expect(episodeCount()).toBe(1);
  });

  it("leaves episodes alone for a provider that doesn't read them", async () => {
    // Steam's pull says nothing about episodes, so it must not be read as
    // evidence that none are watched. `capabilities.episodes.read` is the gate.
    await syncProvider(
      USER,
      showSource(async () => [show("10", [{ season: 1, episode: 1 }])]),
    );
    await syncProvider(USER, showSource(async () => [show("10")], false));
    expect(episodeCount()).toBe(1);
  });
});
