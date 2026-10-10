// The two counts a device asks for when nothing has happened, and what each costs.
//
// D1 bills every row a query touches and stops ALL queries for the rest of the
// UTC day past 5 million. Both of these used to count on every call: 14,899
// rows for the one real account's state and 4,561 for the pool (2026-10-10).
// They are kept now (src/keptCounts.ts), and the statement that changes what a
// count covers drops it in the same batch. These tests hold what makes that
// safe: the numbers are the ones a plain COUNT gives, an unchanged ask reads
// one row, every writer drops what it makes untrue, and a write still reports
// exactly what it did.

// Types `import.meta.glob`, which the last block reads the Worker's source with.
/// <reference types="vite/types/importMeta.d.ts" />
import { beforeEach, describe, expect, it } from "vitest";
import { deleteAccount, disconnectIdentity, mergeAccounts } from "../src/account";
import { kvGet } from "../src/budget";
import { upsertMediaItem } from "../src/catalog/ingest";
import { catalogDeltaJson, parseCursor } from "../src/catalog/read";
import { runExportStep } from "../src/cron";
import {
  DROP_POOL_COUNT_SQL, dropStateCounts, POOL_COUNT_KEY, POOL_RECOUNT_SQL, STATE_COUNTED_SQL, STATE_RECOUNT_SQL, stateCounts,
} from "../src/keptCounts";
import { applyStateWrite, parseStateWrite } from "../src/me";
import { db, env, gameItem, movieItem, showItem, wipe } from "./helpers";

const USER = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER = "bbbbbbbb-0000-4000-8000-000000000002";

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
const another = (i: number) => movieItem({ id: 700 + i, title: `Later ${i}`, belongs_to_collection: null, external_ids: {} });

/** The query this replaced, word for word. Whatever it answers is what a device must be told. */
async function counted(user = USER): Promise<Record<string, number>> {
  const res = await db.prepare(
    `SELECT 'items' k, COUNT(*) n, MAX(updated_at) mx FROM user_item_state WHERE user_id = ?1
     UNION ALL SELECT 'episodes', COUNT(*), MAX(updated_at) FROM user_episode_state WHERE user_id = ?1
     UNION ALL SELECT 'hidden', COUNT(*), MAX(hidden_at) FROM user_hidden_items WHERE user_id = ?1`,
  ).bind(user).all<{ k: string; n: number; mx: number | null }>();
  const out: Record<string, number> = {};
  for (const r of res.results) { out[r.k] = r.n; out[`${r.k}UpdatedAt`] = r.mx ?? 0; }
  return out;
}

const kept = (user = USER) =>
  db.prepare(STATE_COUNTED_SQL).bind(user).first<Record<"items" | "episodes" | "hidden", string | null>>();

/** `n` watched episodes of the show, written straight to the table, so nothing is dropped. */
const episodes = (n: number, user = USER) =>
  db.prepare(
    `INSERT INTO user_episode_state (user_id, media_item_id, season_number, episode_number)
     WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM c WHERE n < ?3)
     SELECT ?1, ?2, n / 100, n % 100 FROM c`,
  ).bind(user, show, n).run();

describe("the state counts", () => {
  it("answer what a plain count answers, through every kind of write", async () => {
    const same = async () => expect(await stateCounts(db, USER)).toEqual(await counted());

    // An account with nothing, in the shape and the key order a device has always been sent.
    expect(JSON.stringify(await stateCounts(db, USER))).toBe(
      '{"items":0,"itemsUpdatedAt":0,"episodes":0,"episodesUpdatedAt":0,"hidden":0,"hiddenUpdatedAt":0}',
    );
    await same();

    await write({
      items: { upsert: [{ mediaItemId: film, source: "trakt", relation: "library", rating: 8 }, { mediaItemId: show, source: "trakt", relation: "library" }] },
      episodes: { upsert: [1, 2, 3].map((e) => ({ mediaItemId: show, season: 1, episode: e })) },
      hidden: { add: [film, game] },
    });
    await same();
    expect(await stateCounts(db, USER)).toMatchObject({ items: 2, episodes: 3, hidden: 2 });

    // An update moves no count, only the newest change: the same number of rows
    // and a different answer. Every row is aged first, so "now" is newer.
    await db.batch([
      db.prepare("UPDATE user_item_state SET updated_at = 1000"),
      db.prepare("UPDATE user_episode_state SET updated_at = 1000"),
      dropStateCounts(db, USER, ["items", "episodes"]),
    ]);
    expect(await stateCounts(db, USER)).toMatchObject({ items: 2, itemsUpdatedAt: 1000, episodes: 3, episodesUpdatedAt: 1000 });
    await write({ items: { upsert: [{ mediaItemId: film, source: "trakt", relation: "library", rating: 3 }] } });
    expect((await stateCounts(db, USER)).itemsUpdatedAt).toBeGreaterThan(1000);
    expect((await stateCounts(db, USER)).episodesUpdatedAt).toBe(1000);
    await same();
    await write({ episodes: { upsert: [{ mediaItemId: show, season: 1, episode: 2, watchedAt: 5 }] } });
    expect((await stateCounts(db, USER)).episodesUpdatedAt).toBeGreaterThan(1000);
    await same();

    await write({ items: { delete: [{ mediaItemId: film, source: "trakt", relation: "library" }] } });
    await same();
    await write({ episodes: { delete: [{ mediaItemId: show, season: 1, episode: 2 }] } });
    await same();
    await write({ hidden: { remove: [film] } });
    await same();
    expect(await stateCounts(db, USER)).toMatchObject({ items: 1, episodes: 2, hidden: 1 });

    // One account's write is not another's change.
    await stateCounts(db, OTHER);
    await write({ hidden: { add: [film] } });
    expect((await kept(OTHER))!.hidden).toBe("0:0");
  });

  it("cost one row when nothing changed, and count once after a change", async () => {
    await episodes(300);
    await write({ items: { upsert: [{ mediaItemId: film, source: "local", relation: "wishlist" }] } });

    // The first ask after a change counts every row, as every ask used to.
    expect(await kept()).toEqual({ items: null, episodes: null, hidden: null });
    const first = await db.prepare(STATE_RECOUNT_SQL).bind(USER).run();
    expect(first.meta.rows_read).toBeGreaterThanOrEqual(301);
    expect(first.meta.rows_written).toBe(1);
    expect(await stateCounts(db, USER)).toEqual(await counted());

    // Every ask after it is the user's own row and nothing else.
    const again = await db.prepare(STATE_COUNTED_SQL).bind(USER).all();
    expect(again.meta.rows_read).toBe(1);
    expect(again.meta.rows_written).toBe(0);
    const plan = await db.prepare(`EXPLAIN QUERY PLAN ${STATE_COUNTED_SQL}`).bind(USER).all<{ detail: string }>();
    expect(plan.results.map((r) => r.detail).join(" | ")).toBe("SEARCH users USING PRIMARY KEY (id=?)");
  });

  it("serve the kept answer and do not count again", async () => {
    await episodes(5);
    expect((await stateCounts(db, USER)).episodes).toBe(5);
    // A marked value, so the answer can only have come from the kept column.
    await db.prepare("UPDATE users SET counted_episodes = '777:9' WHERE id = ?").bind(USER).run();
    expect(await stateCounts(db, USER)).toMatchObject({ episodes: 777, episodesUpdatedAt: 9 });
    // And the next write to that table throws the marked value away.
    await write({ episodes: { upsert: [{ mediaItemId: show, season: 9, episode: 9 }] } });
    expect((await stateCounts(db, USER)).episodes).toBe(6);
  });

  it("count again only the table that was written to", async () => {
    await episodes(300);
    await stateCounts(db, USER);

    await write({ hidden: { add: [film] } });
    expect(await kept()).toMatchObject({ items: "0:0", episodes: expect.stringMatching(/^300:/), hidden: null });
    const res = await db.prepare(STATE_RECOUNT_SQL).bind(USER).run();
    // One hidden row and the user's own. The three hundred episodes are not read.
    expect(res.meta.rows_read).toBeLessThanOrEqual(5);
    expect(await stateCounts(db, USER)).toEqual(await counted());
  });

  it("are dropped for one row write, and for none when there is nothing kept", async () => {
    await stateCounts(db, USER);
    const drop = () => dropStateCounts(db, USER, ["episodes", "hidden"]).run();
    expect((await drop()).meta.rows_written).toBe(1);
    expect(await kept()).toEqual({ items: "0:0", episodes: null, hidden: null });
    // Ticking five episodes in a row with no sync between them pays once.
    const again = await drop();
    expect(again.meta.rows_written).toBe(0);
    expect(again.meta.rows_read).toBeLessThanOrEqual(1);
  });

  it("leave what a write reports exactly as it was", async () => {
    // Both kept counts are in place, so each drop below has a row to change.
    await stateCounts(db, USER);
    await catalogDeltaJson(db, parseCursor(null, null), 50, true);
    expect(await kvGet(db, POOL_COUNT_KEY)).toBe("2");

    const res = await write({
      items: { upsert: [
        { mediaItemId: game, source: "local", relation: "wishlist" },
        { mediaItemId: film, source: "local", relation: "wishlist" },
        { mediaItemId: "00000000-0000-4000-8000-00000000dead", source: "local", relation: "wishlist" },
      ] },
      episodes: { upsert: [1, 2].map((e) => ({ mediaItemId: show, season: 1, episode: e })) },
      hidden: { add: [film] },
    });
    expect(res).toEqual({ ok: true, applied: { itemsUpserted: 2, promoted: 1, episodesUpserted: 2, hidden: 1 }, skipped: 1 });
    await stateCounts(db, USER);
    const gone = await write({
      items: { delete: [{ mediaItemId: film, source: "local", relation: "wishlist" }] },
      episodes: { delete: [{ mediaItemId: show, season: 1, episode: 1 }] },
      hidden: { remove: [film] },
    });
    expect(gone).toEqual({ ok: true, applied: { itemsDeleted: 1, episodesDeleted: 1, unhidden: 1 }, skipped: 0 });
  });

  it("are dropped by disconnecting a provider, by a merge and by erasure", async () => {
    const bothRight = async () => {
      expect(await stateCounts(db, USER)).toEqual(await counted(USER));
      expect(await stateCounts(db, OTHER)).toEqual(await counted(OTHER));
    };
    await write({ items: { upsert: [{ mediaItemId: film, source: "trakt", relation: "library" }, { mediaItemId: show, source: "local", relation: "wishlist" }] } });
    await write({ items: { upsert: [{ mediaItemId: film, source: "trakt", relation: "library", rating: 2 }] }, episodes: { upsert: [{ mediaItemId: show, season: 1, episode: 1 }] }, hidden: { add: [film] } }, OTHER);
    await bothRight();

    // Disconnecting a provider deletes that source's rows.
    await db.batch([
      db.prepare("INSERT INTO user_identities (provider, provider_user_id, user_id) VALUES ('trakt', 't1', ?)").bind(USER),
      db.prepare("INSERT INTO user_identities (provider, provider_user_id, user_id) VALUES ('google', 'g1', ?)").bind(USER),
    ]);
    expect(await disconnectIdentity(db, USER, "trakt")).toMatchObject({ ok: true, removedRows: 1 });
    expect((await stateCounts(db, USER)).items).toBe(1);
    await bothRight();

    // A merge moves one account's rows to the other. The one that receives them
    // was counted a moment ago and must not go on believing that count.
    await write({ items: { upsert: [{ mediaItemId: film, source: "trakt", relation: "library", rating: 9 }] }, episodes: { upsert: [{ mediaItemId: show, season: 2, episode: 2 }] } });
    await bothRight();
    await db.prepare("DELETE FROM user_identities").run();
    // The film is rated on both sides, so one row is a clash and the keeper's survives.
    const merged = await mergeAccounts(db, USER, OTHER, "keep-mine");
    expect(merged).toMatchObject({ ok: true });
    expect(await stateCounts(db, OTHER)).toMatchObject({ items: 2, episodes: 2, hidden: 1 });
    expect(await stateCounts(db, OTHER)).toEqual(await counted(OTHER));

    // Erasure reports the rows it deleted, and a deleted account counts as empty.
    const erased = await deleteAccount(db, OTHER);
    expect(erased.perTable).toMatchObject({ user_item_state: 2, user_episode_state: 2, user_hidden_items: 1 });
    expect(await stateCounts(db, OTHER)).toMatchObject({ items: 0, episodes: 0, hidden: 0 });
  });

  it("stay out of the nightly export", async () => {
    await write({ items: { upsert: [{ mediaItemId: film, source: "local", relation: "wishlist" }] } });
    await stateCounts(db, USER);
    expect((await kept())!.items).toMatch(/^1:/);

    const now = Date.UTC(2026, 9, 4, 1, 0, 0);
    for (let i = 0; i < 40 && !(await runExportStep(env, now)).done; i++) { /* a few chunks a run */ }
    const users = JSON.parse(await (await env.BACKUPS.get("d1/2026-10-04/users-00000000.json"))!.text()) as Record<string, unknown>[];
    expect(users.map((u) => u.id).sort()).toEqual([USER, OTHER]);
    // A restored count would be a count of the rows as they were some other minute.
    for (const u of users) expect(Object.keys(u).filter((k) => k.startsWith("counted_"))).toEqual([]);
  });

  it("read one row for the one real account's size, where they read every row", async () => {
    // 2,482 titles and 12,411 episodes: the account whose counts read 14,899 rows a call.
    await db.prepare(
      `INSERT INTO media_items (id, type, title, browsed)
       WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM c WHERE n < 2482)
       SELECT printf('cccccccc-0000-4000-8000-%012d', n), 'movie', 'Film ' || n, 1 FROM c`,
    ).run();
    await db.prepare(
      `INSERT INTO user_item_state (user_id, media_item_id, source, relation)
       SELECT ?1, id, 'trakt', 'library' FROM media_items WHERE id LIKE 'cccccccc-%'`,
    ).bind(USER).run();
    await episodes(12411);
    await write({ hidden: { add: [film] } });
    try {
      const recount = await db.prepare(STATE_RECOUNT_SQL).bind(USER).run();
      const unchanged = await db.prepare(STATE_COUNTED_SQL).bind(USER).all();
      console.log("state counts, rows read:", { firstAskAfterAChange: recount.meta.rows_read, everyAskAfter: unchanged.meta.rows_read });
      expect(await stateCounts(db, USER)).toMatchObject({ items: 2482, episodes: 12411, hidden: 1 });
      expect(recount.meta.rows_read).toBeGreaterThan(14_000);
      expect(unchanged.meta.rows_read).toBe(1);

      // The usual day: an episode is ticked, then the app looks. Only the episodes are counted again.
      await write({ episodes: { upsert: [{ mediaItemId: show, season: 200, episode: 1 }] } });
      const afterATick = await db.prepare(STATE_RECOUNT_SQL).bind(USER).run();
      console.log("state counts, rows read after one episode is ticked:", afterATick.meta.rows_read);
      expect(afterATick.meta.rows_read).toBeLessThan(12_500);
    } finally {
      // No index leads with media_item_id on these two, so the next test's wipe
      // would look through all of them once for every title it deletes.
      await db.batch([db.prepare("DELETE FROM user_item_state"), db.prepare("DELETE FROM user_episode_state")]);
    }
  });
});

describe("the pool count", () => {
  const sync = async () => JSON.parse(await catalogDeltaJson(db, parseCursor(null, null), 200, true)).poolCount as number;
  const truth = async () => (await db.prepare("SELECT COUNT(*) n FROM media_items WHERE browsed = 0").first<{ n: number }>())!.n;

  it("is the size of the pool through both ways a title enters it", async () => {
    expect(await sync()).toBe(2); // the film and the show; the game is not in the pool
    expect(await kvGet(db, POOL_COUNT_KEY)).toBe("2");

    // A title created straight into the pool.
    await upsertMediaItem(db, another(1));
    expect(await kvGet(db, POOL_COUNT_KEY)).toBeNull();
    expect(await sync()).toBe(3);
    // Somebody acts on a title that was only looked at.
    await write({ items: { upsert: [{ mediaItemId: game, source: "local", relation: "wishlist" }] } });
    expect(await kvGet(db, POOL_COUNT_KEY)).toBeNull();
    expect(await sync()).toBe(4);
    expect(await sync()).toBe(await truth());
  });

  it("is served from the kept number until the pool changes", async () => {
    await sync();
    // A marked value, so the answer can only have come from kv.
    await db.prepare("UPDATE kv SET value = '999' WHERE key = ?").bind(POOL_COUNT_KEY).run();
    expect(await sync()).toBe(999);

    // None of these changes how many titles the pool holds, so none of them counts again:
    // a title nobody acted on, a pool title refreshed from its provider, state written on a
    // pool title, and a title hidden (hiding is not acting on it).
    await upsertMediaItem(db, gameItem({ id: 77, name: "Looked At" }), { browsed: 1 });
    await upsertMediaItem(db, movieItem({ vote_count: 30000 }));
    await write({ items: { upsert: [{ mediaItemId: film, source: "local", relation: "wishlist" }] }, hidden: { add: [game] } });
    expect(await sync()).toBe(999);

    // This one does.
    await write({ items: { upsert: [{ mediaItemId: game, source: "local", relation: "wishlist" }] } });
    expect(await sync()).toBe(3);
  });

  it("is never lower than what a device that just caught up holds", async () => {
    // A device that holds MORE than the number it is given throws its catalog
    // away and downloads it again, and would on every sync while the number
    // stayed low. So after any addition the very next answer has to include it.
    const held = new Set<string>();
    const catchUp = async () => {
      const page = JSON.parse(await catalogDeltaJson(db, parseCursor(null, null), 200, true));
      for (const i of page.items) held.add(i.vector.id);
      return page.poolCount as number;
    };
    expect(await catchUp()).toBe(held.size);
    for (let i = 0; i < 4; i++) {
      await upsertMediaItem(db, another(i));
      expect(await catchUp()).toBe(held.size);
    }
    await write({ items: { upsert: [{ mediaItemId: game, source: "local", relation: "wishlist" }] } });
    expect(await catchUp()).toBe(held.size);
    expect(held.size).toBe(7);
  });

  it("keeps the old number when a create loses its race, because nothing was created", async () => {
    await sync();
    const taken = await db.prepare("SELECT source, source_id, media_type FROM media_links LIMIT 1").first<Record<string, string>>();
    // The batch a create runs, with a link somebody else already holds: it fails whole.
    await expect(db.batch([
      db.prepare("INSERT INTO media_items (id, type, title, browsed) VALUES ('eeeeeeee-0000-4000-8000-000000000001', 'movie', 'Lost', 0)"),
      db.prepare("INSERT INTO media_links (source, source_id, media_type, media_item_id, raw_data) VALUES (?, ?, ?, 'eeeeeeee-0000-4000-8000-000000000001', '{}')")
        .bind(taken!.source, taken!.source_id, taken!.media_type),
      db.prepare(DROP_POOL_COUNT_SQL),
    ])).rejects.toThrow();
    expect(await kvGet(db, POOL_COUNT_KEY)).toBe("2");
  });

  it("counts again once a day whatever happened", async () => {
    await sync();
    // Nothing in the Worker takes a title out of the pool. One deleted by hand is noticed here.
    await db.prepare("DELETE FROM media_items WHERE id = ?").bind(film).run();
    expect(await sync()).toBe(2);
    await db.prepare("UPDATE kv SET expires_at = ? WHERE key = ?").bind(Math.floor(Date.now() / 1000) - 1, POOL_COUNT_KEY).run();
    expect(await sync()).toBe(1);
    const row = await db.prepare("SELECT value, expires_at FROM kv WHERE key = ?").bind(POOL_COUNT_KEY).first<{ value: string; expires_at: number }>();
    expect(row!.value).toBe("1");
    expect(row!.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000) + 86_000);
  });

  it("asks before a promotion with a look-up per title, not a walk through the catalog", async () => {
    // The 2026-10-10 lesson: a query left to the planner read every row of a
    // table on each call. This one runs on every item write, so it is measured.
    const ids: string[] = [];
    for (let i = 0; i < 40; i++) ids.push((await upsertMediaItem(db, another(i), { browsed: i < 30 ? 1 : 0 })).id);
    await sync();
    const pooled = JSON.stringify(ids.slice(30, 33).map((id) => ({ mediaItemId: id })));
    const sql = `${DROP_POOL_COUNT_SQL} AND EXISTS (SELECT 1 FROM media_items WHERE browsed = 1 AND id IN (SELECT j.value ->> 'mediaItemId' FROM json_each(?1) j))`;

    const plan = await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(pooled).all<{ detail: string }>();
    const detail = plan.results.map((r) => r.detail).join(" | ");
    expect(detail).toContain("SEARCH kv USING PRIMARY KEY (key=?)");
    expect(detail).toContain("SEARCH media_items USING PRIMARY KEY (id=?)");
    expect(detail).not.toMatch(/SCAN media_items/);

    // Three titles that are all in the pool already: nothing is dropped, and forty-three are not read.
    const res = await db.prepare(sql).bind(pooled).run();
    expect(res.meta.changes).toBe(0);
    expect(res.meta.rows_read).toBeLessThanOrEqual(10);
    expect(await kvGet(db, POOL_COUNT_KEY)).not.toBeNull();
  });

  it("reads one row for a pool of 4,561, where it read every one", async () => {
    await db.prepare(
      `INSERT INTO media_items (id, type, title, browsed)
       WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM c WHERE n < 4559)
       SELECT printf('dddddddd-0000-4000-8000-%012d', n), 'movie', 'Film ' || n, 0 FROM c`,
    ).run();

    const recount = await db.prepare(POOL_RECOUNT_SQL).bind(POOL_COUNT_KEY, Math.floor(Date.now() / 1000) + 86_400).run();
    const unchanged = await db.prepare("SELECT value, expires_at FROM kv WHERE key = ?").bind(POOL_COUNT_KEY).all();
    console.log("pool count, rows read:", { firstSyncAfterAChange: recount.meta.rows_read, everySyncAfter: unchanged.meta.rows_read });
    expect(recount.meta.rows_read).toBeGreaterThanOrEqual(4561);
    expect(recount.meta.rows_written).toBe(1);
    expect(unchanged.meta.rows_read).toBe(1);
    expect(await sync()).toBe(4561);
  });
});

describe("who has to drop a kept count", () => {
  // The source of every Worker module, as text. A kept count is only right while
  // EVERY statement that changes what it counts drops it, so the statements are
  // listed here. A new one fails this test until somebody has decided what it
  // owes keptCounts.ts and added it to the list.
  const sources = import.meta.glob("../src/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
  const WRITE = "(?:INSERT(?:\\s+OR\\s+\\w+)?\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+";
  const writes = (tables: string): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [file, text] of Object.entries(sources)) {
      const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const n = (code.match(new RegExp(`${WRITE}"?(?:${tables})(?![A-Za-z0-9_])`, "g")) ?? []).length;
      if (n) out[file.replace("../src/", "")] = n;
    }
    return out;
  };

  it("finds the Worker's source at all", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(15);
    expect(sources["../src/me.ts"]).toContain("applyStateWrite");
  });

  it("a user's state is written in two files, by statements that each drop that user's counts", () => {
    expect(writes("user_item_state|user_episode_state|user_hidden_items")).toEqual({
      // The state write: a delete and an upsert for each of the three. One dropStateCounts for the kinds it touched.
      "me.ts": 6,
      // Disconnect (dropStateCounts for items), and the three clash deletes of a merge (dropStateCounts for the survivor).
      "account.ts": 4,
    });
    // Erasure and the merge's move reach every personal table by name. Erasure
    // deletes the user row the counts live on; the move is covered by the merge's drop.
    expect(writes("\\$\\{t\\}")).toEqual({ "account.ts": 2 });
    expect(sources["../src/me.ts"].match(/dropStateCounts\(/g)).toHaveLength(1);
    expect(sources["../src/account.ts"].match(/dropStateCounts\(/g)).toHaveLength(2);
  });

  it("the pool is written in two files, and both ways into it drop its size", () => {
    expect(writes("media_items")).toEqual({
      // The create (drops when the title goes straight into the pool) and the refresh, which never changes `browsed`.
      "catalog/ingest.ts": 2,
      // The promotion. Its drop asks the promotion's own question ahead of it.
      "me.ts": 1,
    });
    expect(sources["../src/catalog/ingest.ts"]).toContain("if (browsed === 0) statements.push(db.prepare(DROP_POOL_COUNT_SQL))");
    expect(sources["../src/me.ts"]).toContain("${DROP_POOL_COUNT_SQL} AND EXISTS (SELECT 1 FROM media_items WHERE ${NOT_YET_IN_POOL})");
    // Nothing takes a title out of the pool. The day somebody writes that, it drops the size too.
    const browsed = Object.entries(sources).filter(([, t]) => /SET[^;`]*\bbrowsed\s*=/.test(t)).map(([f]) => f);
    expect(browsed).toEqual(["../src/me.ts"]);
  });
});

describe("why this is not done with triggers", () => {
  it("D1 counts a trigger's row changes as the statement's own", async () => {
    // A trigger could not be forgotten by a new writer, and was the first design.
    // It cannot be used: the state write tells the client how many rows it
    // applied and skipped from `meta.changes`. If this ever reports 1, a trigger
    // has become possible and the list above can go.
    await db.prepare(
      `CREATE TRIGGER probe_changes AFTER INSERT ON user_hidden_items
       BEGIN UPDATE users SET country = 'DE' WHERE id = NEW.user_id; END`,
    ).run();
    try {
      const res = await db.prepare("INSERT INTO user_hidden_items (user_id, media_item_id) VALUES (?, ?)").bind(USER, film).run();
      expect(res.meta.changes).toBe(2);
    } finally {
      await db.prepare("DROP TRIGGER probe_changes").run();
    }
  });
});
