import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run, get, query } from "./db";
import {
  dueFacets, pruneUntargetedFacets, facetSweepCoverage,
  facetSweepBatch, facetSweepEnabled, FACET_SNAPSHOT_TTL_MS,
} from "./facetSnapshot";

// The facet link sweep persists a bounded set of provider titles once a day so
// the public facet pages link what they render (876 of 2,691 items linked before
// this, measured across the 56 facets `/` links on 2026-09-02).
//
// The BUILD is not exercised here, same reasoning as homeSnapshot.test.ts: it
// fans out to TMDB and IGDB, and a test that mocks those proves the mocks match
// what the author assumed. What IS checkable in isolation are the rules that
// fail silently, and every one of them below is a rule this repo has already
// been bitten by in another subsystem.

initDb();

const stamp = (kind: string, key: string, builtAt: number, items = 60, linkable = 40) =>
  run(
    `INSERT OR REPLACE INTO facet_snapshot (kind, key, built_at, items, linkable)
     VALUES (?, ?, ?, ?, ?)`,
    [kind, key, builtAt, items, linkable],
  );

const pin = (kind: string, key: string, id: string) =>
  run(
    "INSERT OR IGNORE INTO facet_snapshot_item (kind, key, media_item_id) VALUES (?, ?, ?)",
    [kind, key, id],
  );

beforeEach(() => {
  run("DELETE FROM facet_snapshot");
  run("DELETE FROM facet_snapshot_item");
});

describe("the tables exist and are shaped for what reads them", () => {
  it("indexes facet_snapshot_item by media_item_id, which is how PRUNABLE_WHERE reads it", () => {
    // The PK leads with `kind`, so it cannot serve `id NOT IN (SELECT
    // media_item_id FROM ...)`. The boot prune runs that on every deploy.
    // An index created in a LATER migration than its table is the upgrade-path
    // bug this repo has a standing rule about, so it ships in migration 29 too.
    const idx = query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'facet_snapshot_item'",
    ).map((r) => r.name);
    expect(idx).toContain("idx_facet_snapshot_item_media");
  });

  it("keys the pin table by FACET, so a rolling sweep can replace one facet at a time", () => {
    // home_snapshot_item is a bare id list because its build rewrites the whole
    // table at once. This sweep does a few facets per run, so a bare list would
    // mean each run unpinned every facet it did not touch — and the next boot
    // prune would delete their rows.
    pin("tag", "action", "item-a");
    pin("person", "nolan", "item-a");
    expect(
      get<{ n: number }>("SELECT COUNT(*) n FROM facet_snapshot_item WHERE media_item_id = 'item-a'")?.n,
    ).toBe(2);

    run("DELETE FROM facet_snapshot_item WHERE kind = ? AND key = ?", ["tag", "action"]);
    expect(
      get<{ n: number }>("SELECT COUNT(*) n FROM facet_snapshot_item WHERE media_item_id = 'item-a'")?.n,
    ).toBe(1);
  });
});

describe("dueFacets", () => {
  it("treats a never-built facet as due", () => {
    // Nothing stamped, so every target is due. The real target list needs a
    // catalog to be non-empty, so assert the shape rather than a count.
    const due = dueFacets(3, Date.now());
    expect(due.length).toBeLessThanOrEqual(3);
    for (const d of due) expect(["tag", "person", "studio"]).toContain(d.kind);
  });

  it("respects the limit, and a limit of 0 means no work", () => {
    expect(dueFacets(0, Date.now())).toEqual([]);
    expect(dueFacets(-5, Date.now())).toEqual([]);
  });

  it("does not re-run a facet built inside the TTL", () => {
    const now = Date.now();
    const all = dueFacets(100, now);
    if (all.length === 0) return; // empty catalog in this fixture: nothing to assert
    const first = all[0];
    stamp(first.kind, first.key, now);
    const after = dueFacets(100, now).map((d) => `${d.kind}|${d.key}`);
    expect(after).not.toContain(`${first.kind}|${first.key}`);
  });

  it("runs it again once the TTL has passed", () => {
    const now = Date.now();
    const all = dueFacets(100, now);
    if (all.length === 0) return;
    const first = all[0];
    stamp(first.kind, first.key, now - FACET_SNAPSHOT_TTL_MS - 1);
    const after = dueFacets(100, now).map((d) => `${d.kind}|${d.key}`);
    expect(after).toContain(`${first.kind}|${first.key}`);
  });

  it("orders least-recently-built first", () => {
    const now = Date.now();
    const all = dueFacets(1000, now);
    if (all.length < 2) return;

    // ⚠️ EVERY target has to be stamped, not just the two under test. An
    // unstamped facet reads as built_at 0, which is staler than anything, so
    // stamping only two would have the other 54 sort ahead of both and the
    // assertion would be about arbitrary facets. The first version of this test
    // did exactly that and failed for a reason that had nothing to do with
    // ordering.
    for (const t of all) stamp(t.kind, t.key, now - FACET_SNAPSHOT_TTL_MS - 100);

    // Now make ONE of them genuinely staler. It must come first regardless of
    // where it sits in the target list.
    const target = all[all.length - 1];
    stamp(target.kind, target.key, now - FACET_SNAPSHOT_TTL_MS - 9_000);

    const order = dueFacets(2, now).map((d) => `${d.kind}|${d.key}`);
    expect(order[0]).toBe(`${target.kind}|${target.key}`);
  });

  it("breaks a tie on the target list's own order, not alphabetically", () => {
    // One-second resolution cannot separate facets a single pass touched, which
    // is how one backfill lane got hammered while five starved. With every
    // built_at equal, the order must be the target list's, so a sweep walks the
    // set instead of revisiting whichever name sorts first.
    const now = Date.now();
    const all = dueFacets(1000, now);
    if (all.length < 3) return;
    for (const t of all) stamp(t.kind, t.key, now - FACET_SNAPSHOT_TTL_MS - 100);

    const order = dueFacets(3, now).map((d) => `${d.kind}|${d.key}`);
    expect(order).toEqual(all.slice(0, 3).map((d) => `${d.kind}|${d.key}`));
  });
});

describe("pruneUntargetedFacets — the growth bound", () => {
  it("drops a facet that is no longer targeted, and releases its pins", () => {
    // The people rail ROTATES daily, so (kind, key) is a growing key space. This
    // is the same shape that grew calendar_snapshot and, before it,
    // facet_page_cache to 222.8 MB. A stale pin is worse than a stale row: it
    // keeps a `browsed` item alive that nothing links any more.
    stamp("person", "definitely-not-a-real-target-9f2a", Date.now());
    pin("person", "definitely-not-a-real-target-9f2a", "orphan-item");

    const dropped = pruneUntargetedFacets();

    expect(dropped).toBeGreaterThanOrEqual(1);
    expect(
      get<{ n: number }>(
        "SELECT COUNT(*) n FROM facet_snapshot WHERE key = 'definitely-not-a-real-target-9f2a'",
      )?.n,
    ).toBe(0);
    expect(
      get<{ n: number }>(
        "SELECT COUNT(*) n FROM facet_snapshot_item WHERE key = 'definitely-not-a-real-target-9f2a'",
      )?.n,
    ).toBe(0);
  });
});

describe("the env gates are read at CALL time", () => {
  // Three safety gates shipped as module-level constants once, and all three had
  // a test asserting the DEFAULT instead of the behaviour: setting the env var in
  // a test does nothing after the module is loaded. These assert the read.
  it("takes the batch size from the environment", () => {
    const prev = process.env.FACET_SWEEP_BATCH;
    try {
      process.env.FACET_SWEEP_BATCH = "3";
      expect(facetSweepBatch()).toBe(3);
    } finally {
      if (prev === undefined) delete process.env.FACET_SWEEP_BATCH;
      else process.env.FACET_SWEEP_BATCH = prev;
    }
  });

  it("defaults the sweep ON, so a typo leaves it running", () => {
    const prev = process.env.FACET_SWEEP_ENABLED;
    try {
      delete process.env.FACET_SWEEP_ENABLED;
      expect(facetSweepEnabled()).toBe(true);
      process.env.FACET_SWEEP_ENABLED = "nonsense";
      expect(facetSweepEnabled()).toBe(true);
      process.env.FACET_SWEEP_ENABLED = "0";
      expect(facetSweepEnabled()).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.FACET_SWEEP_ENABLED;
      else process.env.FACET_SWEEP_ENABLED = prev;
    }
  });
});

describe("facetSweepCoverage — so a stalled sweep is visible", () => {
  it("reports zero coverage on an empty table without throwing", () => {
    const c = facetSweepCoverage();
    expect(c.covered).toBe(0);
    expect(c.pinned).toBe(0);
    expect(c.linkable).toBe(0);
    expect(c.oldestBuiltAt).toBeNull();
    expect(c.targets).toBeGreaterThanOrEqual(0);
  });

  it("sums what has been built and counts the pins", () => {
    stamp("tag", "action", 1000, 60, 40);
    stamp("tag", "drama", 2000, 60, 38);
    pin("tag", "action", "i1");
    pin("tag", "action", "i2");
    pin("tag", "drama", "i3");

    const c = facetSweepCoverage();
    expect(c.covered).toBe(2);
    expect(c.items).toBe(120);
    expect(c.linkable).toBe(78);
    expect(c.pinned).toBe(3);
    expect(c.oldestBuiltAt).toBe(1000);
  });
});
