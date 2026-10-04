import { beforeEach, describe, expect, it } from "vitest";
import { upsertMediaItem } from "../src/catalog/ingest";
import {
  applyStateWrite, BadRequest, episodeStateJson, hiddenJson, itemStateJson, MAX_ROWS_PER_WRITE,
  parsePrefs, parseStateWrite, profileJson, stateCounts, writePrefs,
} from "../src/me";
import { count, db, env, gameItem, movieItem, showItem, wipe } from "./helpers";

const USER = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER = "bbbbbbbb-0000-4000-8000-000000000002";
const UNKNOWN_ITEM = "00000000-0000-4000-8000-00000000dead";

let film: string;
let show: string;
let game: string;

beforeEach(async () => {
  await wipe();
  await db.batch([
    db.prepare("INSERT INTO users (id) VALUES (?)").bind(USER),
    db.prepare("INSERT INTO users (id) VALUES (?)").bind(OTHER),
  ]);
  film = (await upsertMediaItem(db, movieItem())).id;
  show = (await upsertMediaItem(db, showItem())).id;
  game = (await upsertMediaItem(db, gameItem(), { browsed: 1 })).id;
});

const write = (body: unknown, user = USER) => applyStateWrite(env, user, parseStateWrite(body));
const items = async (user = USER) =>
  JSON.parse(await itemStateJson(db, user, new URLSearchParams())).rows as Record<string, any>[];

describe("writing item state", () => {
  it("inserts, then replaces the whole row on a second write", async () => {
    const first = await write({ items: { upsert: [{ mediaItemId: film, source: "trakt", relation: "library", status: "watched", rating: 8, addedAt: 1700000000 }] } });
    expect(first).toMatchObject({ ok: true, applied: { itemsUpserted: 1 }, skipped: 0 });
    expect(await items()).toEqual([expect.objectContaining({ mediaItemId: film, source: "trakt", relation: "library", status: "watched", rating: 8, addedAt: 1700000000 })]);

    // The client owns the row for its source and sends it complete. A field it
    // leaves out is a field that is now empty: an explicit null and an absent
    // key both clear, which is how removing a rating reaches the server.
    await write({ items: { upsert: [{ mediaItemId: film, source: "trakt", relation: "library", status: "watched" }] } });
    const [row] = await items();
    expect(row.rating).toBeNull();
    // added_at is the exception: omitted, it keeps the provider's original.
    expect(row.addedAt).toBe(1700000000);
  });

  it("keeps each source's row separate on the same title", async () => {
    await write({ items: { upsert: [
      { mediaItemId: film, source: "trakt", relation: "library", rating: 8 },
      { mediaItemId: film, source: "tmdb", relation: "library", rating: 9 },
      { mediaItemId: film, source: "trakt", relation: "wishlist" },
    ] } });
    expect(await items()).toHaveLength(3);
  });

  it("deletes exactly the rows named, and nobody else's", async () => {
    const row = { mediaItemId: film, source: "trakt", relation: "library" };
    await write({ items: { upsert: [{ ...row, rating: 8 }, { mediaItemId: show, source: "trakt", relation: "library" }] } });
    await write({ items: { upsert: [{ ...row, rating: 3 }] } }, OTHER);

    const res = await write({ items: { delete: [row] } });
    expect(res).toMatchObject({ ok: true, applied: { itemsDeleted: 1 } });
    expect((await items()).map((r) => r.mediaItemId)).toEqual([show]);
    // The same key on another account is untouched.
    expect(await items(OTHER)).toHaveLength(1);
  });

  it("never deletes what a write did not name", async () => {
    // There is no "replace everything from this source" call, on purpose. A
    // client whose pull failed half way sends a short list, and a short list
    // must leave every other row exactly where it is.
    await write({ items: { upsert: [
      { mediaItemId: film, source: "trakt", relation: "library" },
      { mediaItemId: show, source: "trakt", relation: "library" },
    ] } });
    await write({ items: { upsert: [{ mediaItemId: film, source: "trakt", relation: "library", rating: 7 }] } });
    expect(await items()).toHaveLength(2);
  });

  it("skips a row for a title the catalog does not hold, and applies the rest", async () => {
    const res = await write({ items: { upsert: [
      { mediaItemId: film, source: "local", relation: "wishlist" },
      { mediaItemId: UNKNOWN_ITEM, source: "local", relation: "wishlist" },
    ] } });
    expect(res).toMatchObject({ ok: true, applied: { itemsUpserted: 1 }, skipped: 1 });
    expect(await items()).toHaveLength(1);
  });

  it("puts a title in the scoring pool the moment somebody acts on it", async () => {
    await db.prepare("UPDATE media_items SET updated_at = 1000 WHERE id = ?").bind(game).run();
    const before = await db.prepare("SELECT browsed FROM media_items WHERE id = ?").bind(game).first<{ browsed: number }>();
    expect(before!.browsed).toBe(1);

    const res = await write({ items: { upsert: [{ mediaItemId: game, source: "local", relation: "wishlist" }] } });
    expect(res).toMatchObject({ applied: { promoted: 1 } });
    const after = await db.prepare("SELECT browsed, updated_at FROM media_items WHERE id = ?").bind(game).first<{ browsed: number; updated_at: number }>();
    expect(after!.browsed).toBe(0);
    // Bumped, so the next delta sync carries the title to every other device.
    expect(after!.updated_at).toBeGreaterThan(1000);

    // A title already in the pool is not rewritten for nothing.
    const again = await write({ items: { upsert: [{ mediaItemId: film, source: "local", relation: "wishlist" }] } });
    expect(again).toMatchObject({ applied: { promoted: 0 } });
  });
});

describe("writing episodes and hidden titles", () => {
  it("upserts and deletes episodes by their key", async () => {
    await write({ episodes: { upsert: [
      { mediaItemId: show, season: 1, episode: 1, watchedAt: 1700000000, sources: ["trakt"] },
      { mediaItemId: show, season: 1, episode: 2 },
    ] } });
    let rows = JSON.parse(await episodeStateJson(db, USER, new URLSearchParams())).rows;
    expect(rows).toEqual([
      { mediaItemId: show, season: 1, episode: 1, watchedAt: 1700000000, sources: ["trakt"] },
      { mediaItemId: show, season: 1, episode: 2, watchedAt: null, sources: ["local"] },
    ]);

    await write({ episodes: { delete: [{ mediaItemId: show, season: 1, episode: 1 }] } });
    rows = JSON.parse(await episodeStateJson(db, USER, new URLSearchParams())).rows;
    expect(rows.map((r: any) => r.episode)).toEqual([2]);
  });

  it("hides and unhides, idempotently", async () => {
    await write({ hidden: { add: [film, game, film] } });
    await write({ hidden: { add: [film] } });
    expect(JSON.parse(await hiddenJson(db, USER)).rows.map((r: any) => r.mediaItemId).sort()).toEqual([film, game].sort());
    await write({ hidden: { remove: [film] } });
    expect(JSON.parse(await hiddenJson(db, USER)).rows.map((r: any) => r.mediaItemId)).toEqual([game]);
    // Hiding is not acting on a title: it must not pull one into the pool.
    expect((await db.prepare("SELECT browsed FROM media_items WHERE id = ?").bind(game).first<{ browsed: number }>())!.browsed).toBe(1);
  });

  it("applies a mixed write as one unit", async () => {
    const res = await write({
      items: { upsert: [{ mediaItemId: film, source: "trakt", relation: "library", rating: 9 }] },
      episodes: { upsert: [{ mediaItemId: show, season: 1, episode: 1 }] },
      hidden: { add: [game] },
    });
    expect(res).toMatchObject({ ok: true, applied: { itemsUpserted: 1, episodesUpserted: 1, hidden: 1 } });
    expect(await stateCounts(db, USER)).toMatchObject({ items: 1, episodes: 1, hidden: 1 });
  });
});

describe("validation", () => {
  const bad = (body: unknown) => expect(() => parseStateWrite(body)).toThrow(BadRequest);

  it("rejects what it cannot store, whole", () => {
    bad(null);
    bad({});
    bad({ items: { upsert: "nope" } });
    bad({ items: { upsert: [{ mediaItemId: "not-a-uuid", source: "trakt", relation: "library" }] } });
    bad({ items: { upsert: [{ mediaItemId: film, source: "myspace", relation: "library" }] } });
    bad({ items: { upsert: [{ mediaItemId: film, source: "trakt", relation: "owned" }] } });
    bad({ items: { upsert: [{ mediaItemId: film, source: "trakt", relation: "library", rating: 11 }] } });
    bad({ items: { upsert: [{ mediaItemId: film, source: "trakt", relation: "library", rating: "8" }] } });
    bad({ episodes: { upsert: [{ mediaItemId: show, season: -1, episode: 1 }] } });
    bad({ episodes: { upsert: [{ mediaItemId: show, season: 1, episode: 1.5 }] } });
    bad({ episodes: { upsert: [{ mediaItemId: show, season: 1, episode: 1, sources: ["myspace"] }] } });
    bad({ hidden: { add: ["x"] } });
  });

  it("caps a single request", () => {
    const row = { mediaItemId: film, season: 1 };
    const many = Array.from({ length: MAX_ROWS_PER_WRITE + 1 }, (_, i) => ({ ...row, episode: i }));
    bad({ episodes: { upsert: many } });
    expect(() => parseStateWrite({ episodes: { upsert: many.slice(0, MAX_ROWS_PER_WRITE) } })).not.toThrow();
  });

  it("cannot be used to write under another user's id", async () => {
    // The user id is the session's, bound as a parameter. A user_id smuggled
    // into a row is just an unknown key.
    await write({ items: { upsert: [{ mediaItemId: film, source: "local", relation: "wishlist", user_id: OTHER, userId: OTHER }] } });
    expect(await count("user_item_state", "user_id = ?", [USER])).toBe(1);
    expect(await count("user_item_state", "user_id = ?", [OTHER])).toBe(0);
  });
});

describe("the daily write budget", () => {
  it("refuses once the day's allowance is spent, and writes nothing", async () => {
    const tight = { ...env, DAILY_USER_WRITE_CAP: "2" };
    const one = { mediaItemId: film, source: "local", relation: "wishlist" };
    expect(await applyStateWrite(tight, USER, parseStateWrite({ items: { upsert: [one] } }))).toMatchObject({ ok: true });
    const over = await applyStateWrite(tight, USER, parseStateWrite({ hidden: { add: [film, game] } }));
    expect(over).toEqual({ ok: false, reason: "budget" });
    expect(await count("user_hidden_items")).toBe(0);
  });
});

describe("reading state in pages", () => {
  it("walks item state by key, a page at a time", async () => {
    await write({ items: { upsert: [
      { mediaItemId: film, source: "trakt", relation: "library" },
      { mediaItemId: film, source: "tmdb", relation: "library" },
      { mediaItemId: show, source: "trakt", relation: "library" },
    ] } });
    const seen: string[] = [];
    let q = new URLSearchParams({ limit: "2" });
    for (let i = 0; i < 5; i++) {
      const page = JSON.parse(await itemStateJson(db, USER, q));
      for (const r of page.rows) seen.push(`${r.mediaItemId}|${r.source}`);
      if (page.done) break;
      const last = page.rows[page.rows.length - 1];
      q = new URLSearchParams({ limit: "2", afterItem: last.mediaItemId, afterSource: last.source, afterRelation: last.relation });
    }
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
  });

  it("walks episodes by key", async () => {
    await write({ episodes: { upsert: [1, 2, 3, 4, 5].map((e) => ({ mediaItemId: show, season: 1, episode: e })) } });
    const first = JSON.parse(await episodeStateJson(db, USER, new URLSearchParams({ limit: "3" })));
    expect(first.rows.map((r: any) => r.episode)).toEqual([1, 2, 3]);
    expect(first.done).toBe(false);
    const rest = JSON.parse(await episodeStateJson(db, USER, new URLSearchParams({ limit: "3", afterItem: show, afterSeason: "1", afterEpisode: "3" })));
    expect(rest.rows.map((r: any) => r.episode)).toEqual([4, 5]);
    expect(rest.done).toBe(true);
  });
});

describe("profile and preferences", () => {
  it("stores a preference, and reads it back as data rather than as a string", async () => {
    await writePrefs(db, USER, parsePrefs({ country: "de", platforms: ["s:netflix", "p:pc"], mediaTypes: ["movie"] }));
    const p = JSON.parse((await profileJson(db, USER))!);
    expect(p.user).toMatchObject({ id: USER, country: "DE", platforms: ["s:netflix", "p:pc"], mediaTypes: ["movie"] });
  });

  it("leaves an absent key alone and clears a null one", async () => {
    await writePrefs(db, USER, parsePrefs({ country: "DE", mediaTypes: ["movie"] }));
    await writePrefs(db, USER, parsePrefs({ mediaTypes: null }));
    const p = JSON.parse((await profileJson(db, USER))!);
    expect(p.user.country).toBe("DE");
    expect(p.user.mediaTypes).toBeNull();
  });

  it("stores an empty list as not configured, because 'uses nothing' is inexpressible", async () => {
    await writePrefs(db, USER, parsePrefs({ platforms: [], mediaTypes: [] }));
    const row = await db.prepare("SELECT platforms, media_types FROM users WHERE id = ?").bind(USER).first<Record<string, unknown>>();
    expect(row).toEqual({ platforms: null, media_types: null });
  });

  it("rejects an unknown country or media type", () => {
    expect(() => parsePrefs({ country: "Atlantis" })).toThrow(BadRequest);
    expect(() => parsePrefs({ mediaTypes: ["book"] })).toThrow(BadRequest);
    expect(() => parsePrefs({ platforms: "netflix" })).toThrow(BadRequest);
    expect(() => parsePrefs([])).toThrow(BadRequest);
  });

  it("lists the ways the account can sign in, without the provider's user id", async () => {
    await db.prepare("INSERT INTO user_identities (provider, provider_user_id, user_id, display_name) VALUES ('google', 'sub-123456', ?, 'Nils')").bind(USER).run();
    const text = (await profileJson(db, USER))!;
    expect(JSON.parse(text).identities).toEqual([{ provider: "google", displayName: "Nils", avatarUrl: null }]);
    expect(text).not.toContain("sub-123456");
  });
});
