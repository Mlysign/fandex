import { beforeEach, describe, expect, it } from "vitest";
import { isAdmin, parseDays, usersSnapshot } from "../src/admin";
import { upsertMediaItem } from "../src/catalog/ingest";
import type { Env } from "../src/env";
import { db, gameItem, movieItem, wipe } from "./helpers";

beforeEach(wipe);

const NOW = new Date("2026-10-10T12:00:00Z");
const nowSec = Math.floor(NOW.getTime() / 1000);

describe("who is an admin", () => {
  const env = (ids?: string) => ({ ADMIN_USER_IDS: ids }) as unknown as Env;

  it("is nobody when the variable is unset or empty", () => {
    expect(isAdmin(env(), "u1")).toBe(false);
    expect(isAdmin(env(""), "u1")).toBe(false);
    expect(isAdmin(env(" , "), "")).toBe(false);
  });

  it("is exactly the listed ids", () => {
    expect(isAdmin(env("u1, u2"), "u2")).toBe(true);
    expect(isAdmin(env("u1, u2"), "u")).toBe(false);
  });
});

describe("the range", () => {
  it("is clamped to 7..365 and defaults to 30", () => {
    expect(parseDays(null)).toBe(30);
    expect(parseDays("nonsense")).toBe(30);
    expect(parseDays("1")).toBe(7);
    expect(parseDays("90")).toBe(90);
    expect(parseDays("9999")).toBe(365);
  });
});

describe("the users snapshot", () => {
  it("counts an item once however many sources brought it", async () => {
    const film = await upsertMediaItem(db, movieItem());
    const game = await upsertMediaItem(db, gameItem());
    await db.batch([
      db.prepare("INSERT INTO users (id, country, created_at, last_seen_at) VALUES ('u1', 'DE', ?, ?)").bind(nowSec - 3600, nowSec - 60),
      db.prepare("INSERT INTO users (id, created_at, last_seen_at) VALUES ('u2', ?, ?)").bind(nowSec - 100 * 86_400, nowSec - 50 * 86_400),
      db.prepare("INSERT INTO user_identities (provider, provider_user_id, user_id) VALUES ('trakt', 't1', 'u1')"),
      db.prepare("INSERT INTO user_identities (provider, provider_user_id, user_id) VALUES ('google', 'g1', 'u1')"),
      // The same film from two sources: one library entry, rated 8 (the mean of 7 and 9).
      db.prepare("INSERT INTO user_item_state (user_id, media_item_id, source, relation, status, rating, added_at) VALUES ('u1', ?, 'trakt', 'library', 'watched', 7, ?)").bind(film.id, nowSec - 120),
      db.prepare("INSERT INTO user_item_state (user_id, media_item_id, source, relation, status, rating, added_at) VALUES ('u1', ?, 'tmdb', 'library', 'watched', 9, ?)").bind(film.id, nowSec - 120),
      db.prepare("INSERT INTO user_item_state (user_id, media_item_id, source, relation, added_at) VALUES ('u1', ?, 'steam', 'wishlist', ?)").bind(game.id, nowSec - 40 * 86_400),
    ]);

    const s = await usersSnapshot(db, 30, NOW);
    expect(s.totals).toEqual({ users: 2, library: 1, wishlist: 1, ignored: 0, rated: 1, meanRating: 8 });
    expect(s.perUserAverages).toEqual({ library: 0.5, wishlist: 0.5, rated: 0.5 });
    expect(s.byType).toEqual([
      { type: "movie", library: 1, wishlist: 0, rated: 1 },
      { type: "game", library: 0, wishlist: 1, rated: 0 },
    ]);
    expect(s.byStatus).toEqual([{ status: "watched", count: 1 }]);
    // Provenance counts rows, so it is higher than the item counts.
    expect(s.bySource.reduce((n, r) => n + r.count, 0)).toBe(3);
    expect(s.providers).toEqual([{ provider: "google", users: 1 }, { provider: "trakt", users: 1 }]);
    expect(s.countries).toEqual(expect.arrayContaining([{ country: "DE", users: 1 }, { country: "(unset)", users: 1 }]));
    expect(s.engagement).toMatchObject({ active1: 1, active7: 1, active30: 1, active90: 2, activeInRange: 1, stickiness: 100 });
    expect(s.collectionSizes.find((b) => b.bucket === "0")?.users).toBe(1);
    expect(s.collectionSizes.find((b) => b.bucket === "1–10")?.users).toBe(1);
    // Thirty days, every one present, and today's holds the sign-up and the two library rows.
    expect(s.signups).toHaveLength(30);
    expect(s.signups.at(-1)).toEqual({ day: "2026-10-10", count: 1 });
    expect(s.writeActivity.at(-1)).toEqual({ day: "2026-10-10", count: 2 });
    expect(s.users[0]).toMatchObject({ id: "u1", library: 1, wishlist: 1, rated: 1, providers: ["google", "trakt"] });
  });

  it("answers for an empty database without dividing by zero", async () => {
    const s = await usersSnapshot(db, 7, NOW);
    expect(s.totals).toEqual({ users: 0, library: 0, wishlist: 0, ignored: 0, rated: 0, meanRating: null });
    expect(s.engagement.stickiness).toBeNull();
    expect(s.signups).toHaveLength(7);
  });
});
