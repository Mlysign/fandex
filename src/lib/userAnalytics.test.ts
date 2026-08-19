import { describe, it, expect } from "vitest";
import { getDb } from "@/lib/db";
import { userAnalyticsSnapshot } from "@/lib/userAnalytics";

// These run against the freshly-migrated empty test DB, so the point of most of
// them is SHAPE and the handling of empty state, not magnitudes. The one thing
// worth asserting hard is that an empty database produces defined, non-crashing,
// non-misleading output: this page's whole job is to be read when there is
// almost no data, and a divide-by-zero rendered as "0%" would be a lie.

describe("userAnalyticsSnapshot", () => {
  it("returns a complete shape on an empty database", () => {
    const s = userAnalyticsSnapshot(30);
    expect(s.days).toBe(30);
    expect(s.totals.users).toBe(0);
    expect(s.totals.library).toBe(0);
    expect(s.totals.wishlist).toBe(0);
    expect(s.totals.meanRating).toBeNull();
    expect(s.users).toEqual([]);
    expect(s.byType).toEqual([]);
    expect(typeof s.generatedAt).toBe("string");
  });

  it("reports stickiness as null rather than 0% when nobody is active", () => {
    // "Nobody used it" and "everybody who used it churned" are different facts.
    // 0/0 rendered as 0% would state the second while meaning the first.
    expect(userAnalyticsSnapshot(30).engagement.stickiness).toBeNull();
  });

  it("zero-fills both day series to the requested range", () => {
    const s = userAnalyticsSnapshot(14);
    expect(s.signups).toHaveLength(14);
    expect(s.writeActivity).toHaveLength(14);
    expect(s.signedInPageviews).toHaveLength(14);
    expect(s.signups.every((d) => d.count === 0)).toBe(true);
    // Ascending, ending today.
    const days = s.signups.map((d) => d.day);
    expect([...days].sort()).toEqual(days);
    expect(s.signups[13].day).toBe(new Date().toISOString().slice(0, 10));
  });

  it("honours the requested range across every series", () => {
    for (const n of [7, 30, 90]) {
      const s = userAnalyticsSnapshot(n);
      expect(s.days).toBe(n);
      expect(s.signups).toHaveLength(n);
      expect(s.writeActivity).toHaveLength(n);
      expect(s.signedInPageviews).toHaveLength(n);
    }
  });

  it("always returns every collection-size bucket, including empty ones", () => {
    const s = userAnalyticsSnapshot(30);
    expect(s.collectionSizes.map((b) => b.bucket)).toEqual([
      "0", "1–10", "11–50", "51–200", "201–1000", "1000+",
    ]);
    expect(s.collectionSizes.every((b) => b.users === 0)).toBe(true);
  });

  it("counts library items per (user, item), not per source row", () => {
    // The distinction that makes the number mean what a person expects: a title
    // synced from both Steam and RAWG is TWO user_item_state rows and ONE item.
    const db = getDb();
    db.exec(`
      INSERT INTO users (id, created_at, last_seen_at) VALUES ('u1', strftime('%s','now'), strftime('%s','now'));
      INSERT INTO media_items (id, type, title, norm_title, browsed)
        VALUES ('m1', 'game', 'Dup', 'dup', 0);
      INSERT INTO user_item_state (id, user_id, media_item_id, source, relation, status, added_at)
        VALUES ('s1', 'u1', 'm1', 'steam', 'library', 'played', strftime('%s','now'));
      INSERT INTO user_item_state (id, user_id, media_item_id, source, relation, status, added_at)
        VALUES ('s2', 'u1', 'm1', 'rawg', 'library', 'played', strftime('%s','now'));
    `);

    const s = userAnalyticsSnapshot(30);
    expect(s.totals.users).toBe(1);
    expect(s.totals.library).toBe(1);
    // The provenance panel is the one that counts per source, and must total 2.
    expect(s.bySource.reduce((a, r) => a + r.count, 0)).toBe(2);
    expect(s.byType).toEqual([{ type: "game", library: 1, wishlist: 0, rated: 0 }]);
    expect(s.users).toHaveLength(1);
    expect(s.users[0].library).toBe(1);

    db.exec(`DELETE FROM user_item_state; DELETE FROM media_items WHERE id='m1'; DELETE FROM users WHERE id='u1';`);
  });

  it("never exposes a display name or avatar in the per-user rows", () => {
    // Load-bearing: user_identities carries both, and this page has no need for
    // either. Asserting the shape stops a later "just add the name" from
    // quietly turning an audience-sizing page into a roster of real people.
    const db = getDb();
    db.exec(`INSERT INTO users (id, created_at, last_seen_at) VALUES ('u2', strftime('%s','now'), strftime('%s','now'));`);
    const row = userAnalyticsSnapshot(30).users[0];
    expect(Object.keys(row).sort()).toEqual(
      ["createdAt", "id", "lastSeenAt", "library", "providers", "rated", "wishlist"],
    );
    db.exec(`DELETE FROM users WHERE id='u2';`);
  });
});
