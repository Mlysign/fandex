import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run, get, query } from "./db";
import { canMerge, mergeAccounts, accountHasUserData, providersFor } from "./accountMerge";

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

  it("REFUSES when both accounts hold library rows", () => {
    // Not in the original spec, deliberately: the spec assumes the signed-in
    // account is the throwaway one. When both are real, a merge has to pick a
    // winner per clash, and silently discarding ratings is worse than refusing.
    mkIdentity(A, "google", "g-1");
    mkIdentity(B, "discord", "d-1");
    mkState(A, "film-1");
    mkState(B, "film-2");
    expect(canMerge(B, A)).toEqual({ ok: false, reason: "both-have-data" });
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

    const r = mergeAccounts(B, A);

    expect(r.ok).toBe(true);
    expect(providersFor(A).sort()).toEqual(["discord", "google"]);
    expect(providersFor(B)).toEqual([]);
  });

  it("moves library rows and deletes the emptied account", () => {
    mkIdentity(A, "google", "g-1");
    mkIdentity(B, "discord", "d-1");
    mkState(B, "film-2");

    mergeAccounts(B, A);

    expect(
      get<{ n: number }>("SELECT COUNT(*) n FROM user_item_state WHERE user_id = ?", [A])?.n,
    ).toBe(1);
    expect(get<{ n: number }>("SELECT COUNT(*) n FROM users WHERE id = ?", [B])?.n).toBe(0);
  });

  it("leaves the SURVIVOR's own rows untouched", () => {
    mkIdentity(A, "google", "g-1");
    mkIdentity(B, "discord", "d-1");
    mkState(A, "film-1");

    mergeAccounts(B, A);

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

    const r = mergeAccounts(B, A);

    expect(r.ok).toBe(false);
    expect(providersFor(B)).toEqual(["discord"]);
    expect(get<{ n: number }>("SELECT COUNT(*) n FROM users WHERE id = ?", [B])?.n).toBe(1);
    expect(
      get<{ n: number }>("SELECT COUNT(*) n FROM user_item_state WHERE user_id = ?", [B])?.n,
    ).toBe(1);
  });

  it("is a no-op when both ids are the same account", () => {
    mkIdentity(A, "google", "g-1");
    const r = mergeAccounts(A, A);
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

    mergeAccounts(B, A);

    expect(
      get<{ n: number }>("SELECT COUNT(*) n FROM user_episode_state WHERE user_id = ?", [A])?.n,
    ).toBe(1);
    expect(get<{ n: number }>("SELECT COUNT(*) n FROM sync_log WHERE user_id = ?", [A])?.n).toBe(1);
  });
});
