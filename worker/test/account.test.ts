import { beforeEach, describe, expect, it } from "vitest";
import {
  accountFootprint, buildAccountExportJson, declaresUserId, deleteAccount, userScopedTables,
} from "../src/account";
import { upsertMediaItem } from "../src/catalog/ingest";
import { count, db, gameItem, movieItem, showItem, wipe } from "./helpers";

beforeEach(wipe);

/** A user with one row in every personal table, and the ids of what they point at. */
async function seedUser(id: string, googleSub: string) {
  const film = await upsertMediaItem(db, movieItem());
  const show = await upsertMediaItem(db, showItem());
  const game = await upsertMediaItem(db, gameItem());
  await db.batch([
    db.prepare("INSERT INTO users (id, country, platforms, media_types) VALUES (?, 'DE', ?, ?)")
      .bind(id, JSON.stringify(["s:netflix", "p:pc"]), JSON.stringify(["movie", "show"])),
    db.prepare("INSERT INTO user_identities (provider, provider_user_id, user_id, display_name) VALUES ('google', ?, ?, 'Nils')")
      .bind(googleSub, id),
    db.prepare("INSERT INTO user_item_state (user_id, media_item_id, source, relation, status, rating, review) VALUES (?, ?, 'trakt', 'library', 'watched', 9, 'Whoa.')")
      .bind(id, film.id),
    db.prepare("INSERT INTO user_item_state (user_id, media_item_id, source, relation) VALUES (?, ?, 'local', 'wishlist')")
      .bind(id, game.id),
    db.prepare("INSERT INTO user_episode_state (user_id, media_item_id, season_number, episode_number, watched_at, sources) VALUES (?, ?, 1, 1, 1700000000, '[\"trakt\"]')")
      .bind(id, show.id),
    db.prepare("INSERT INTO user_hidden_items (user_id, media_item_id) VALUES (?, ?)").bind(id, game.id),
  ]);
  return { film, show, game };
}

describe("which tables are personal", () => {
  it("reads a user_id column out of a CREATE TABLE statement", () => {
    expect(declaresUserId("CREATE TABLE t (user_id TEXT NOT NULL, x INTEGER)")).toBe(true);
    expect(declaresUserId("CREATE TABLE t (\n  id TEXT,\n  user_id TEXT NOT NULL REFERENCES users(id)\n)")).toBe(true);
    expect(declaresUserId('CREATE TABLE t (id TEXT, "user_id" TEXT)')).toBe(true);
    // A column that merely ENDS in user_id is not one.
    expect(declaresUserId("CREATE TABLE t (provider_user_id TEXT NOT NULL, x TEXT)")).toBe(false);
    // Nor is a mention inside a key clause, or in a comment.
    expect(declaresUserId("CREATE TABLE t (a TEXT, b TEXT, PRIMARY KEY (user_id, a))")).toBe(false);
    expect(declaresUserId("CREATE TABLE t (a TEXT -- keyed by, user_id TEXT\n, b TEXT)")).toBe(false);
  });

  it("finds exactly the personal tables in the real schema", async () => {
    expect(await userScopedTables(db)).toEqual([
      "user_episode_state", "user_hidden_items", "user_identities", "user_item_state",
    ]);
  });

  it("keeps user_id out of every catalog table", async () => {
    // The other half of the rule. A catalog table that grew a user_id column
    // would have its rows deleted by somebody's account erasure.
    const personal = new Set(await userScopedTables(db));
    for (const t of ["media_items", "media_links", "item_doc", "media_external_ids", "show_episodes", "franchise_members", "tag_category_override"]) {
      expect(personal.has(t), t).toBe(false);
    }
  });
});

describe("erasure", () => {
  it("removes everything of one user and nothing of another", async () => {
    const a = "aaaaaaaa-0000-4000-8000-000000000001";
    const b = "bbbbbbbb-0000-4000-8000-000000000002";
    const { film } = await seedUser(a, "g-a");
    await db.batch([
      db.prepare("INSERT INTO users (id) VALUES (?)").bind(b),
      db.prepare("INSERT INTO user_identities (provider, provider_user_id, user_id) VALUES ('google', 'g-b', ?)").bind(b),
      db.prepare("INSERT INTO user_item_state (user_id, media_item_id, source, relation, rating) VALUES (?, ?, 'local', 'library', 6)").bind(b, film.id),
    ]);

    expect(await accountFootprint(db, a)).toMatchObject({
      exists: true, total: 5,
      perTable: { user_identities: 1, user_item_state: 2, user_episode_state: 1, user_hidden_items: 1 },
    });

    const result = await deleteAccount(db, a);
    expect(result).toMatchObject({ total: 5, userRowDeleted: true });

    for (const t of await userScopedTables(db)) expect(await count(t, "user_id = ?", [a]), t).toBe(0);
    expect(await count("users", "id = ?", [a])).toBe(0);
    // The other account is untouched.
    expect(await count("users", "id = ?", [b])).toBe(1);
    expect(await count("user_item_state", "user_id = ?", [b])).toBe(1);
    // And so is the shared catalog: a title staying after an erasure is correct.
    expect(await count("media_items")).toBe(3);
    expect(await count("media_links")).toBe(3);
  });

  it("covers a personal table added after this code was written", async () => {
    // The reason the list is read from the schema. A table nobody told erasure
    // about must still be erased.
    const a = "aaaaaaaa-0000-4000-8000-000000000001";
    await seedUser(a, "g-a");
    await db.prepare("CREATE TABLE user_notes (user_id TEXT NOT NULL, note TEXT)").run();
    try {
      await db.prepare("INSERT INTO user_notes (user_id, note) VALUES (?, 'mine')").bind(a).run();
      await db.prepare("INSERT INTO user_notes (user_id, note) VALUES ('someone-else', 'theirs')").run();

      const result = await deleteAccount(db, a);
      expect(result.perTable.user_notes).toBe(1);
      expect(await count("user_notes")).toBe(1);
    } finally {
      await db.prepare("DROP TABLE user_notes").run();
    }
  });

  it("is a no-op for an account that does not exist", async () => {
    expect(await deleteAccount(db, "nobody")).toMatchObject({ total: 0, userRowDeleted: false });
  });
});

describe("export", () => {
  it("contains everything held about the user, as valid JSON", async () => {
    const a = "aaaaaaaa-0000-4000-8000-000000000001";
    const { film, show, game } = await seedUser(a, "g-a");
    const ex = JSON.parse((await buildAccountExportJson(db, a, new Date("2026-10-04T12:00:00Z")))!);

    expect(ex).toMatchObject({ schemaVersion: 6, service: "fandex", exportedAt: "2026-10-04T12:00:00.000Z" });
    expect(ex.user).toMatchObject({ id: a, country: "DE", platforms: ["s:netflix", "p:pc"], mediaTypes: ["movie", "show"] });
    expect(ex.identities).toEqual([expect.objectContaining({ provider: "google", providerUserId: "g-a", displayName: "Nils" })]);
    expect(ex.itemState).toHaveLength(2);
    expect(ex.itemState).toContainEqual(expect.objectContaining({
      mediaItemId: film.id, title: "The Matrix", type: "movie", source: "trakt", relation: "library",
      status: "watched", rating: 9, review: "Whoa.",
    }));
    expect(ex.episodes).toEqual([expect.objectContaining({ mediaItemId: show.id, season: 1, episode: 1, watchedAt: 1700000000, sources: ["trakt"] })]);
    expect(ex.hidden).toEqual([expect.objectContaining({ mediaItemId: game.id, title: "The Witcher 3: Wild Hunt" })]);
  });

  it("exports only the asking user's rows", async () => {
    const a = "aaaaaaaa-0000-4000-8000-000000000001";
    const { film } = await seedUser(a, "g-a");
    await db.batch([
      db.prepare("INSERT INTO users (id) VALUES ('other')"),
      db.prepare("INSERT INTO user_item_state (user_id, media_item_id, source, relation, review) VALUES ('other', ?, 'local', 'library', 'SOMEONE-ELSES-REVIEW')").bind(film.id),
    ]);
    const text = (await buildAccountExportJson(db, a))!;
    expect(text).not.toContain("SOMEONE-ELSES-REVIEW");
  });

  it("answers null for a user that does not exist, and survives empty tables", async () => {
    expect(await buildAccountExportJson(db, "nobody")).toBeNull();
    await db.prepare("INSERT INTO users (id) VALUES ('empty')").run();
    const ex = JSON.parse((await buildAccountExportJson(db, "empty"))!);
    expect(ex).toMatchObject({ identities: [], itemState: [], episodes: [], hidden: [] });
    expect(ex.user.platforms).toEqual([]);
  });
});
