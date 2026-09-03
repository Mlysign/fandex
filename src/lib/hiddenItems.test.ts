import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { initDb, run, get } from "./db";
import { hideItem, unhideItem, isHidden, hiddenItemIds, hiddenCount, withoutHidden } from "./hiddenItems";
import { userScopedTables, buildAccountExport, deleteAccount } from "./account";

// 2026-09-03 (Nils): "hide item: item does not show up as recommendations, only
// when searched for it. Shows should not show up on the progress feed."
//
// Hiding is a per-user DISPLAY preference, and the three things worth pinning
// are the ones that have gone wrong for display preferences in this codebase
// before: it must survive the boot prune, it must be covered by both halves of
// GDPR (erasure AND export), and it must not leak between users.

initDb();

const ME = "u-hide-me";
const OTHER = "u-hide-other";

function addItem(id: string, browsed = 0) {
  run(
    "INSERT OR IGNORE INTO media_items (id, type, title, norm_title, release_date, browsed) VALUES (?, 'movie', ?, ?, '2020-01-01', ?)",
    [id, `Title ${id}`, id, browsed],
  );
}

beforeEach(() => {
  for (const u of [ME, OTHER]) {
    run("DELETE FROM users WHERE id = ?", [u]);
    run("INSERT INTO users (id) VALUES (?)", [u]);
  }
  run("DELETE FROM user_hidden_items");
});

describe("hiding an item", () => {
  it("round-trips, and is idempotent in both directions", () => {
    addItem("h1");
    expect(isHidden(ME, "h1")).toBe(false);

    hideItem(ME, "h1");
    hideItem(ME, "h1");
    expect(isHidden(ME, "h1")).toBe(true);
    expect(hiddenCount(ME)).toBe(1);

    unhideItem(ME, "h1");
    unhideItem(ME, "h1");
    expect(isHidden(ME, "h1")).toBe(false);
    expect(hiddenCount(ME)).toBe(0);
  });

  it("is per user, so hiding never reaches into somebody else's feed", () => {
    addItem("h2");
    hideItem(ME, "h2");
    expect(isHidden(ME, "h2")).toBe(true);
    expect(isHidden(OTHER, "h2")).toBe(false);
    expect(hiddenItemIds(OTHER).size).toBe(0);
  });

  it("filters a feed by the row's id, and leaves an anonymous feed alone", () => {
    addItem("h3");
    addItem("h4");
    hideItem(ME, "h3");
    const feed = [{ id: "h3" }, { id: "h4" }];

    expect(withoutHidden(feed, ME, (r) => r.id).map((r) => r.id)).toEqual(["h4"]);
    // Nobody signed in means nothing hidden: the filter must be a no-op rather
    // than an error, because the browse feed is a public route.
    expect(withoutHidden(feed, null, (r) => r.id)).toHaveLength(2);
  });

  it("keeps a row whose id has not resolved yet", () => {
    // Before persistDiscoverBatch runs, a discover item's id is a provider
    // string like `igdb-402959` and the local uuid does not exist. Such a row
    // must pass through rather than being dropped on a failed match.
    addItem("h5");
    hideItem(ME, "h5");
    const rows = [{ id: null as string | null }, { id: "igdb-402959" }, { id: "h5" }];
    expect(withoutHidden(rows, ME, (r) => r.id).map((r) => r.id)).toEqual([null, "igdb-402959"]);
  });
});

describe("the two halves of GDPR", () => {
  it("is erased with the account, because it carries a user_id", () => {
    // ⚠️ deleteAccount() finds its targets by reading sqlite_master for that
    // literal column name. A hidden-items table named anything else, or keyed by
    // something else, would be silently skipped by erasure.
    expect(userScopedTables()).toContain("user_hidden_items");

    addItem("h6");
    hideItem(ME, "h6");
    hideItem(OTHER, "h6");
    deleteAccount(ME);

    expect(get<{ n: number }>("SELECT COUNT(*) n FROM user_hidden_items WHERE user_id = ?", [ME])?.n).toBe(0);
    // and nothing of the other user's
    expect(get<{ n: number }>("SELECT COUNT(*) n FROM user_hidden_items WHERE user_id = ?", [OTHER])?.n).toBe(1);
  });

  it("appears in the export, which is written by hand and does NOT follow", () => {
    // The asymmetry this pins: erasure is schema-derived and automatic, the
    // export uses explicit column lists. A new user-scoped table is therefore
    // deleted correctly and omitted from the user's own download unless someone
    // adds a block for it.
    addItem("h7");
    hideItem(ME, "h7");
    const out = buildAccountExport(ME);
    expect(out.hidden).toHaveLength(1);
    expect(out.hidden[0].mediaItemId).toBe("h7");
    expect(out.hidden[0].title).toBe("Title h7");
  });
});

describe("surviving the boot prune", () => {
  it("is named in PRUNABLE_WHERE", () => {
    // ⚠️ Without this, hiding a `browsed = 1` title UNDOES ITSELF on the next
    // deploy: the prune deletes the media_items row, ON DELETE CASCADE takes the
    // hidden row with it, and the title walks back into the recommendations. A
    // hidden discover result is exactly the browsed-only shape the prune eats,
    // so this is the common case rather than a corner one.
    const src = readFileSync(join("src", "lib", "dbPrune.ts"), "utf8");
    expect(src).toMatch(/PRUNABLE_WHERE[\s\S]{0,600}user_hidden_items/);
  });

  it("actually protects the row", async () => {
    const { previewPrune } = await import("./dbPrune");
    addItem("h8", 1);
    const before = previewPrune().prunable;
    hideItem(ME, "h8");
    expect(previewPrune().prunable).toBe(before - 1);
  });
});
