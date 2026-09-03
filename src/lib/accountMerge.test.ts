import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run, get, query } from "./db";
import { canMerge, mergeAccounts, accountHasUserData, providersFor, mergeConflicts } from "./accountMerge";

// Connecting a provider that already belongs to ANOTHER Fandex account.
//
// The bug this closes: the callback found the existing identity, refreshed that
// other account's tokens, linked nothing, and still redirected to
// `?connected=<provider>` — so the page said "connected successfully" while the
// provider still showed a Connect button.
//
// These cover the decision rules and the data movement, because both are silent
// when wrong: a bad rule shows the wrong message, and a bad move loses a library.

initDb();

const A = "user-established";
const B = "user-fresh";

function mkUser(id: string) {
  run("INSERT OR REPLACE INTO users (id, country) VALUES (?, ?)", [id, "DE"]);
}
function mkIdentity(userId: string, provider: string, providerUserId: string) {
  run(
    `INSERT INTO user_identities (id, user_id, provider, provider_user_id, access_token)
     VALUES (?, ?, ?, ?, '')`,
    [`${provider}-${providerUserId}`, userId, provider, providerUserId],
  );
}
function mkItem(id: string) {
  run(
    "INSERT OR IGNORE INTO media_items (id, type, title, norm_title) VALUES (?, 'movie', ?, ?)",
    [id, id, id],
  );
}
function mkState(userId: string, itemId: string, relation = "library") {
  mkItem(itemId);
  run(
    `INSERT INTO user_item_state (id, user_id, media_item_id, source, relation)
     VALUES (?, ?, ?, 'trakt', ?)`,
    [`${userId}-${itemId}-${relation}`, userId, itemId, relation],
  );
}

beforeEach(() => {
  run("DELETE FROM user_item_state");
  run("DELETE FROM user_episode_state");
  run("DELETE FROM user_identities");
  run("DELETE FROM users");
  mkUser(A);
  mkUser(B);
});

describe("canMerge — the rules, decided before anything is written", () => {
  it("allows folding a fresh account into an established one", () => {
    mkIdentity(A, "google", "g-1");
    mkIdentity(B, "discord", "d-1");
    mkState(A, "film-1");
    expect(canMerge(B, A)).toEqual({ ok: true });
  });

  it("REFUSES when the target already signs in with the same provider", () => {
    // Nils's second rule. Both accounts have a Discord, so the identity being
    // moved has nowhere unambiguous to land.
    mkIdentity(A, "google", "g-1");
    mkIdentity(A, "discord", "d-old");
    mkIdentity(B, "discord", "d-new");
    expect(canMerge(B, A)).toEqual({ ok: false, reason: "provider-taken", provider: "discord" });
  });

  it("ALLOWS it when both hold rows — overlap is resolved, not refused", () => {
    // This used to refuse. Nils: "it should give me a merge form for me to
    // decide and then execute the merge right after." So the only hard refusal
    // left is provider-taken; everything else is a question for the form.
    mkIdentity(A, "google", "g-1");
    mkIdentity(B, "discord", "d-1");
    mkState(A, "film-1");
    mkState(B, "film-2");
    expect(canMerge(B, A)).toEqual({ ok: true });
  });

  it("allows it when only the TARGET has data, which is the common case", () => {
    mkIdentity(A, "google", "g-1");
    mkIdentity(B, "discord", "d-1");
    mkState(A, "film-1");
    expect(accountHasUserData(B)).toBe(false);
    expect(canMerge(B, A)).toEqual({ ok: true });
  });

  it("allows it when only the SOURCE has data", () => {
    // Signed in with the account that has the library, connecting a provider
    // that belongs to an empty older account. Nothing can collide.
    mkIdentity(A, "google", "g-1");
    mkIdentity(B, "discord", "d-1");
    mkState(B, "film-2");
    expect(canMerge(B, A)).toEqual({ ok: true });
  });
});

describe("mergeAccounts — the data actually moves", () => {
  it("moves identities, so the survivor can sign in with both", () => {
    mkIdentity(A, "google", "g-1");
    mkIdentity(B, "discord", "d-1");

    const r = mergeAccounts(B, A, "keep-theirs");

    expect(r.ok).toBe(true);
    expect(providersFor(A).sort()).toEqual(["discord", "google"]);
    expect(providersFor(B)).toEqual([]);
  });

  it("moves library rows and deletes the emptied account", () => {
    mkIdentity(A, "google", "g-1");
    mkIdentity(B, "discord", "d-1");
    mkState(B, "film-2");

    mergeAccounts(B, A, "keep-theirs");

    expect(
      get<{ n: number }>("SELECT COUNT(*) n FROM user_item_state WHERE user_id = ?", [A])?.n,
    ).toBe(1);
    expect(get<{ n: number }>("SELECT COUNT(*) n FROM users WHERE id = ?", [B])?.n).toBe(0);
  });

  it("leaves the SURVIVOR's own rows untouched", () => {
    mkIdentity(A, "google", "g-1");
    mkIdentity(B, "discord", "d-1");
    mkState(A, "film-1");

    mergeAccounts(B, A, "keep-theirs");

    const rows = query<{ media_item_id: string }>(
      "SELECT media_item_id FROM user_item_state WHERE user_id = ?", [A],
    );
    expect(rows.map((r) => r.media_item_id)).toEqual(["film-1"]);
    // And the survivor's preferences survive: the fresh account's defaults must
    // not overwrite settings the person actually chose.
    expect(get<{ country: string }>("SELECT country FROM users WHERE id = ?", [A])?.country).toBe("DE");
  });

  it("writes NOTHING when the merge is refused", () => {
    // The guard runs before the transaction. A refusal that had already moved
    // half the rows would be worse than either outcome.
    mkIdentity(A, "google", "g-1");
    mkIdentity(A, "discord", "d-old");
    mkIdentity(B, "discord", "d-new");
    mkState(B, "film-2");

    const r = mergeAccounts(B, A, "keep-theirs");

    expect(r.ok).toBe(false);
    expect(providersFor(B)).toEqual(["discord"]);
    expect(get<{ n: number }>("SELECT COUNT(*) n FROM users WHERE id = ?", [B])?.n).toBe(1);
    expect(
      get<{ n: number }>("SELECT COUNT(*) n FROM user_item_state WHERE user_id = ?", [B])?.n,
    ).toBe(1);
  });

  it("is a no-op when both ids are the same account", () => {
    mkIdentity(A, "google", "g-1");
    const r = mergeAccounts(A, A, "keep-theirs");
    expect(r).toEqual({ ok: true, movedTables: [] });
    expect(get<{ n: number }>("SELECT COUNT(*) n FROM users WHERE id = ?", [A])?.n).toBe(1);
  });

  it("covers every user-scoped table, not a hand-written list", () => {
    // Schema-derived, like GDPR erasure. A future user-scoped table is covered
    // the moment it exists instead of being stranded on the deleted account.
    mkIdentity(A, "google", "g-1");
    mkIdentity(B, "discord", "d-1");
    mkItem("show-1");
    run(
      `INSERT INTO user_episode_state (user_id, media_item_id, season_number, episode_number, watched_at)
       VALUES (?, 'show-1', 1, 1, 0)`,
      [B],
    );
    run(
      "INSERT INTO sync_log (id, user_id, provider, synced_at, item_count, status) VALUES ('s1', ?, 'trakt', 0, 0, 'ok')",
      [B],
    );

    mergeAccounts(B, A, "keep-theirs");

    expect(
      get<{ n: number }>("SELECT COUNT(*) n FROM user_episode_state WHERE user_id = ?", [A])?.n,
    ).toBe(1);
    expect(get<{ n: number }>("SELECT COUNT(*) n FROM sync_log WHERE user_id = ?", [A])?.n).toBe(1);
  });
});

describe("mergeConflicts — what the form has to show", () => {
  beforeEach(() => {
    mkIdentity(A, "google", "g-1");
    mkIdentity(B, "discord", "d-1");
  });

  it("counts only rows that actually collide on the unique key", () => {
    mkState(A, "shared-film");   // same (item, source, relation) on both
    mkState(B, "shared-film");
    mkState(B, "only-on-b");     // moves with no decision
    mkState(A, "only-on-a");     // never moves; it is already home

    const c = mergeConflicts(B, A);

    expect(c.itemState).toBe(1);
    expect(c.episodeState).toBe(0);
    // B holds 2 rows; 1 collides, so 1 is clean.
    expect(c.cleanRows).toBe(1);
    expect(c.sampleTitles).toEqual(["shared-film"]);
  });

  it("does not count the same title under a DIFFERENT relation as a clash", () => {
    // Wishlisted on one account and in the library on the other is not a
    // conflict: the unique key includes `relation`, so both rows coexist.
    mkState(A, "film-x", "library");
    mkState(B, "film-x", "wishlist");
    expect(mergeConflicts(B, A).itemState).toBe(0);
  });

  it("reports nothing to decide when the accounts do not overlap", () => {
    mkState(A, "film-1");
    mkState(B, "film-2");
    const c = mergeConflicts(B, A);
    expect(c.itemState + c.episodeState).toBe(0);
    expect(c.cleanRows).toBe(1);
  });
});

describe("the resolution decides which copy survives", () => {
  beforeEach(() => {
    mkIdentity(A, "google", "g-1");
    mkIdentity(B, "discord", "d-1");
    // One clash and one clean row on each side.
    mkState(A, "shared-film");
    mkState(B, "shared-film");
    mkState(A, "only-on-a");
    mkState(B, "only-on-b");
  });

  const rowsFor = (u: string) =>
    query<{ id: string; media_item_id: string }>(
      "SELECT id, media_item_id FROM user_item_state WHERE user_id = ? ORDER BY media_item_id", [u],
    );

  it("keep-mine keeps the SIGNED-IN account's copy of the clash", () => {
    mergeAccounts(B, A, "keep-mine");

    const rows = rowsFor(A);
    expect(rows.map((r) => r.media_item_id)).toEqual(["only-on-a", "only-on-b", "shared-film"]);
    // The surviving clash row is B's, identified by the id B's fixture gave it.
    expect(rows.find((r) => r.media_item_id === "shared-film")!.id).toContain(B);
  });

  it("keep-theirs keeps the OTHER account's copy of the clash", () => {
    mergeAccounts(B, A, "keep-theirs");

    const rows = rowsFor(A);
    expect(rows.map((r) => r.media_item_id)).toEqual(["only-on-a", "only-on-b", "shared-film"]);
    expect(rows.find((r) => r.media_item_id === "shared-film")!.id).toContain(A);
  });

  it("moves the non-overlapping rows either way — 'merge where possible'", () => {
    // The half that needs no decision must be identical under both choices.
    mergeAccounts(B, A, "keep-mine");
    expect(rowsFor(A).map((r) => r.media_item_id)).toContain("only-on-b");
    expect(rowsFor(A).map((r) => r.media_item_id)).toContain("only-on-a");
  });

  it("leaves exactly one row per key, so the unique index is intact", () => {
    mergeAccounts(B, A, "keep-theirs");
    const dupes = query<{ n: number }>(
      `SELECT COUNT(*) n FROM user_item_state WHERE user_id = ?
        GROUP BY media_item_id, source, relation HAVING COUNT(*) > 1`, [A],
    );
    expect(dupes).toEqual([]);
  });

  it("deletes the merged-away account under either resolution", () => {
    mergeAccounts(B, A, "keep-mine");
    expect(get<{ n: number }>("SELECT COUNT(*) n FROM users WHERE id = ?", [B])?.n).toBe(0);
  });
});
