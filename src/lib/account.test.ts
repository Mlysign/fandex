import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDb, getDb, run, get, query } from "./db";
import {
  userScopedTables,
  accountFootprint,
  deleteAccount,
  buildAccountExport,
  ACCOUNT_EXPORT_SCHEMA_VERSION,
} from "./account";

// H4.6 / H4.7. Deletion is irreversible and export is a file the user can hand
// to anyone, so the two properties worth pinning are blast radius (nothing of
// ANOTHER user, nothing of the shared catalog) and the leak boundary (no
// credentials in the export, ever).

initDb();

const ME = "u-me";
const OTHER = "u-other";

// A token-shaped string that must never appear in an export.
const SECRET = "enc:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function addItem(id: string) {
  run("INSERT INTO media_items (id, type, title, norm_title, release_date) VALUES (?, 'movie', ?, ?, '2020-01-01')", [
    id,
    `Title ${id}`,
    id,
  ]);
  run(
    `INSERT INTO media_links (id, media_item_id, source, source_id, media_type, title, raw_data)
     VALUES (?, ?, 'tmdb', ?, 'movie', ?, '{}')`,
    [`${id}-link`, id, id, `Title ${id}`],
  );
}

function populate(userId: string, itemId: string, suffix: string) {
  run(
    `INSERT INTO user_identities (id, user_id, provider, provider_user_id, display_name, avatar_url, access_token, refresh_token, metadata)
     VALUES (?, ?, 'trakt', ?, 'Nils', 'https://img/a.png', ?, ?, ?)`,
    [`ident-${suffix}`, userId, `trakt-${suffix}`, SECRET, SECRET, JSON.stringify({ slug: "nils", accessToken: SECRET })],
  );
  // Since migration 16 the library and wishlist rows are not written, they are
  // DERIVED: user_library / user_watchlist are views over user_item_state, so
  // these two inserts produce one row in each view. That is why the seed no
  // longer writes them directly — and why erasure still reaches them despite
  // userScopedTables() not listing them (see the test below).
  run(
    `INSERT INTO user_item_state (id, user_id, media_item_id, source, relation, status, rating, review)
     VALUES (?, ?, ?, 'trakt', 'library', 'watched', 9, 'my private note')`,
    [`st-${suffix}`, userId, itemId],
  );
  run(
    `INSERT INTO user_item_state (id, user_id, media_item_id, source, relation)
     VALUES (?, ?, ?, 'trakt', 'wishlist')`,
    [`stw-${suffix}`, userId, itemId],
  );
  run("INSERT INTO sync_log (id, user_id, provider, item_count, status) VALUES (?, ?, 'trakt', 42, 'ok')", [
    `sl-${suffix}`,
    userId,
  ]);
  // MB14 — per-episode watch history. Personal data like everything else here,
  // so both erasure and the export have to reach it.
  run(
    `INSERT INTO user_episode_state (user_id, media_item_id, season_number, episode_number, watched_at, sources)
     VALUES (?, ?, 2, 5, 1700000000, '["trakt"]')`,
    [userId, itemId],
  );
}

const count = (sql: string, params: unknown[] = []) => get<{ n: number }>(sql, params)?.n ?? 0;

beforeEach(() => {
  run("DELETE FROM users");
  run("DELETE FROM media_items");
  // Explicit: one test below deletes items with foreign_keys OFF, which leaves
  // its links behind for the next test to collide with.
  run("DELETE FROM media_links");
  run("INSERT INTO users (id, country) VALUES (?, 'DE')", [ME]);
  run("INSERT INTO users (id) VALUES (?)", [OTHER]);
  addItem("item-1");
  addItem("item-2");
  populate(ME, "item-1", "me");
  populate(OTHER, "item-2", "other");
});

describe("userScopedTables", () => {
  it("finds every table with a user_id column, and nothing else", () => {
    const tables = userScopedTables();
    for (const t of ["user_identities", "user_item_state", "sync_log", "user_episode_state"]) {
      expect(tables).toContain(t);
    }
    // The shared catalog is not user-scoped — deleting an account must not reach it.
    expect(tables).not.toContain("media_items");
    expect(tables).not.toContain("media_links");
    // Same for the episode CATALOG (MB14): shared metadata, no user_id column.
    expect(tables).not.toContain("show_seasons");
    expect(tables).not.toContain("show_episodes");
    expect(tables).not.toContain("users");
  });

  // The GDPR-critical consequence of migration 16, and the reason it is safe.
  // userScopedTables() scans sqlite_master WHERE type = 'table', so the two
  // views drop out of the erasure target list even though they expose a user_id
  // column. That is correct rather than a leak — they hold no rows of their own,
  // and DELETE FROM a view would throw anyway — but "correct" here rests on a
  // one-word filter in a query, so it gets asserted from both directions: the
  // views are absent from the list, AND the erasure is still complete through
  // them (proved in the deleteAccount block below).
  it("excludes the derived views, which have a user_id column but no rows of their own", () => {
    const tables = userScopedTables();
    expect(tables).not.toContain("user_library");
    expect(tables).not.toContain("user_watchlist");
  });
});

describe("accountFootprint", () => {
  it("counts only the target user's rows", () => {
    const f = accountFootprint(ME);
    expect(f.exists).toBe(true);
    // 2: one library + one wishlist row. These are the rows that USED to be
    // counted a second time as user_library / user_watchlist; the footprint is
    // now the real one rather than the same data tallied three times.
    expect(f.perTable.user_item_state).toBe(2);
    expect(f.perTable.user_identities).toBe(1);
    expect(f.perTable.sync_log).toBe(1);
    expect(f.perTable.user_episode_state).toBe(1);
    expect(f.total).toBe(5);
  });

  it("reports a non-existent user as absent", () => {
    expect(accountFootprint("nobody").exists).toBe(false);
  });
});

describe("deleteAccount", () => {
  it("erases every trace of the account", () => {
    const result = deleteAccount(ME);

    expect(result.userRowDeleted).toBe(true);
    expect(result.total).toBe(5);
    expect(count("SELECT COUNT(*) n FROM users WHERE id = ?", [ME])).toBe(0);
    for (const t of userScopedTables()) {
      expect(count(`SELECT COUNT(*) n FROM "${t}" WHERE user_id = ?`, [ME])).toBe(0);
    }
  });

  // The other half of the migration-16 erasure argument. deleteAccount never
  // names user_library / user_watchlist — they are not in userScopedTables() —
  // so completeness has to be shown through the surfaces a user would actually
  // check, not through the list of tables the code happened to visit. A view
  // that still returned the erased user's ratings would be a live GDPR failure
  // with every other assertion in this file still green.
  it("empties the derived views too, without ever naming them", () => {
    expect(count("SELECT COUNT(*) n FROM user_library WHERE user_id = ?", [ME])).toBe(1);
    expect(count("SELECT COUNT(*) n FROM user_watchlist WHERE user_id = ?", [ME])).toBe(1);

    deleteAccount(ME);

    expect(count("SELECT COUNT(*) n FROM user_library WHERE user_id = ?", [ME])).toBe(0);
    expect(count("SELECT COUNT(*) n FROM user_watchlist WHERE user_id = ?", [ME])).toBe(0);
    expect(count("SELECT COUNT(*) n FROM user_library WHERE review = 'my private note'")).toBe(1); // OTHER's, untouched
  });

  it("leaves the OTHER user completely untouched", () => {
    deleteAccount(ME);

    expect(count("SELECT COUNT(*) n FROM users WHERE id = ?", [OTHER])).toBe(1);
    expect(count("SELECT COUNT(*) n FROM user_library WHERE user_id = ?", [OTHER])).toBe(1);
    expect(count("SELECT COUNT(*) n FROM user_watchlist WHERE user_id = ?", [OTHER])).toBe(1);
    expect(count("SELECT COUNT(*) n FROM user_item_state WHERE user_id = ?", [OTHER])).toBe(2);
    expect(count("SELECT COUNT(*) n FROM user_identities WHERE user_id = ?", [OTHER])).toBe(1);
    expect(count("SELECT COUNT(*) n FROM sync_log WHERE user_id = ?", [OTHER])).toBe(1);
    expect(count("SELECT COUNT(*) n FROM user_episode_state WHERE user_id = ?", [OTHER])).toBe(1);
  });

  it("leaves the shared catalog intact", () => {
    deleteAccount(ME);
    // The user's own library rows are gone, but the titles themselves back other
    // users' libraries and the public pages — deleting them would be a bug.
    expect(count("SELECT COUNT(*) n FROM media_items")).toBe(2);
    expect(count("SELECT COUNT(*) n FROM media_links")).toBe(2);
  });

  it("does not depend on ON DELETE CASCADE (works with foreign_keys OFF)", () => {
    // The cascade is the backstop, not the mechanism. If this ever starts
    // failing, erasure has quietly become pragma-dependent — which is exactly
    // how a standalone script would leave a user's ratings behind.
    const db = getDb();
    db.pragma("foreign_keys = OFF");
    try {
      deleteAccount(ME);
    } finally {
      db.pragma("foreign_keys = ON");
    }
    expect(count("SELECT COUNT(*) n FROM user_library WHERE user_id = ?", [ME])).toBe(0);
    expect(count("SELECT COUNT(*) n FROM user_item_state WHERE user_id = ?", [ME])).toBe(0);
    expect(count("SELECT COUNT(*) n FROM users WHERE id = ?", [ME])).toBe(0);
  });

  it("is a harmless no-op for an account that no longer exists", () => {
    deleteAccount(ME);
    const again = deleteAccount(ME);
    expect(again.total).toBe(0);
    expect(again.userRowDeleted).toBe(false);
  });

  describe("a user-scoped table added later", () => {
    afterEach(() => {
      getDb().exec("DROP TABLE IF EXISTS future_user_thing");
    });

    it("is covered automatically, without editing account.ts", () => {
      // The whole point of deriving the table list from the schema: the next
      // migration to add a user_id column shouldn't be able to silently break
      // GDPR erasure.
      getDb().exec(`
        CREATE TABLE future_user_thing (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          payload TEXT
        )`);
      run("INSERT INTO future_user_thing (id, user_id, payload) VALUES ('f1', ?, 'secret pref')", [ME]);

      const result = deleteAccount(ME);

      expect(result.perTable.future_user_thing).toBe(1);
      expect(count("SELECT COUNT(*) n FROM future_user_thing")).toBe(0);
    });
  });
});

describe("buildAccountExport", () => {
  it("includes the user's own data", () => {
    const exp = buildAccountExport(ME, new Date("2026-07-23T10:00:00Z"));

    expect(exp.schemaVersion).toBe(ACCOUNT_EXPORT_SCHEMA_VERSION);
    expect(exp.exportedAt).toBe("2026-07-23T10:00:00.000Z");
    expect(exp.user).toMatchObject({ id: ME, country: "DE" });
    expect(exp.identities).toHaveLength(1);
    expect(exp.identities[0]).toMatchObject({ provider: "trakt", providerUserId: "trakt-me", displayName: "Nils" });
    expect(exp.library).toHaveLength(1);
    expect(exp.library[0]).toMatchObject({ title: "Title item-1", rating: 9, review: "my private note" });
    expect(exp.watchlist).toHaveLength(1);
    expect(exp.watchlist[0]).toMatchObject({ title: "Title item-1", platformSources: '["trakt"]' });
    // `notes` is vestigial and always null: nothing has written it since
    // migration 3 (0 of 95 rows on the live DB), so the view supplies NULL and
    // the export keeps the column for shape compatibility. The old assertion
    // here wrote 'later' by hand and proved only that the seed could set a
    // column no code path ever sets.
    expect(exp.watchlist[0].notes).toBeNull();
    expect(exp.itemState).toHaveLength(2); // the library row and the wishlist row
    expect(exp.episodes).toHaveLength(1);
    expect(exp.episodes[0]).toMatchObject({
      title: "Title item-1", season: 2, episode: 5, watchedAt: 1700000000,
    });
    expect(exp.syncLog).toHaveLength(1);
    expect(exp.syncLog[0]).toMatchObject({ provider: "trakt", itemCount: 42 });
  });

  it("NEVER exports credentials — not the columns, not via metadata", () => {
    const serialized = JSON.stringify(buildAccountExport(ME));

    // The value itself, wherever it might have travelled from.
    expect(serialized).not.toContain(SECRET);
    // …and the column names, so a future `SELECT *` refactor trips this too.
    for (const key of ["access_token", "refresh_token", "accessToken", "refreshToken", "token_expires_at"]) {
      expect(serialized).not.toContain(key);
    }
    // Benign metadata still comes through — the scrubber is key-targeted, not a
    // blanket drop of the user's own provider data.
    expect(JSON.parse(serialized).identities[0].metadata).toEqual({ slug: "nils" });
  });

  it("contains only the calling user's rows", () => {
    const exp = buildAccountExport(ME);
    const ids = [
      ...exp.library.map((l) => l.mediaItemId),
      ...exp.watchlist.map((w) => w.mediaItemId),
      ...exp.itemState.map((s) => s.mediaItemId),
      ...exp.episodes.map((e) => e.mediaItemId),
    ];
    expect(ids.every((id) => id === "item-1")).toBe(true);
    expect(exp.identities.every((i) => i.providerUserId === "trakt-me")).toBe(true);
  });

  it("survives a library row whose catalog item was pruned away", () => {
    // media_items rows can disappear under a library row only if the pool rule
    // is violated, but the export is a read of last resort — it must not 500.
    getDb().pragma("foreign_keys = OFF");
    try {
      run("DELETE FROM media_items WHERE id = 'item-1'");
    } finally {
      getDb().pragma("foreign_keys = ON");
    }
    const exp = buildAccountExport(ME);
    expect(exp.library).toHaveLength(1);
    expect(exp.library[0].title).toBeNull();
    expect(exp.library[0].rating).toBe(9);
  });

  it("throws for an unknown user rather than returning an empty shell", () => {
    expect(() => buildAccountExport("nobody")).toThrow(/No such user/);
  });
});

describe("post-deletion state", () => {
  it("leaves no orphaned rows pointing at the deleted user", () => {
    deleteAccount(ME);
    for (const t of userScopedTables()) {
      const orphans = query<{ user_id: string }>(
        `SELECT user_id FROM "${t}" WHERE user_id NOT IN (SELECT id FROM users)`,
      );
      expect(orphans).toEqual([]);
    }
  });
});
