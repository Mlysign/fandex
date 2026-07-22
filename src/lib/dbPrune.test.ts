import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run, get } from "./db";
import {
  previewPrune, runPrune, prunableIds, orphanCheck, walDiagnostics,
  startPruneJob, pruneJobState,
} from "./dbPrune";

// PR16 — the prune is the only operation in this repo that deletes production
// rows in bulk, and two of the tables that cascade off media_items hold the
// user's own library and watchlist. These tests exist to make the blast radius
// explicit rather than inferred.

initDb();

const USER = "u-prune";

beforeEach(() => {
  run("DELETE FROM media_items");
  run("DELETE FROM users");
  run("INSERT INTO users (id) VALUES (?)", [USER]);
});

function addItem(id: string, browsed: 0 | 1) {
  run(
    "INSERT INTO media_items (id, type, title, norm_title, browsed) VALUES (?, 'movie', ?, ?, ?)",
    [id, id, id, browsed],
  );
  run(
    `INSERT INTO media_links (id, media_item_id, source, source_id, title, raw_data)
     VALUES (?, ?, 'tmdb', ?, ?, '{}')`,
    [`${id}-link`, id, id, id],
  );
  run(
    "INSERT INTO media_external_ids (media_item_id, source, external_id) VALUES (?, 'tmdb', ?)",
    [id, id],
  );
}
const addState = (id: string, relation = "wishlist") =>
  run(
    "INSERT INTO user_item_state (id, user_id, media_item_id, source, relation) VALUES (?, ?, ?, 'tmdb', ?)",
    [`${id}-st`, USER, id, relation],
  );
const addLibrary = (id: string, rating = 9) =>
  run(
    "INSERT INTO user_library (id, user_id, media_item_id, status, rating, review) VALUES (?, ?, ?, 'watched', ?, 'my private note')",
    [`${id}-lib`, USER, id, rating],
  );
const addWatchlist = (id: string) =>
  run("INSERT INTO user_watchlist (id, user_id, media_item_id) VALUES (?, ?, ?)", [`${id}-wl`, USER, id]);

const count = (sql: string) => get<{ n: number }>(sql)?.n ?? 0;

describe("previewPrune — what is in scope", () => {
  it("targets browsed rows nobody acted on, and leaves the pool alone", () => {
    addItem("pool-item", 0);
    addItem("browsed-orphan", 1);

    const p = previewPrune();
    expect(p.mediaItems).toBe(2);
    expect(p.browsed).toBe(1);
    expect(p.prunable).toBe(1);
    expect(prunableIds()).toEqual(["browsed-orphan"]);
  });

  it("protects a browsed row once the user acts on it (the pool rule's promotion half)", () => {
    addItem("browsed-then-wishlisted", 1);
    addState("browsed-then-wishlisted");

    const p = previewPrune();
    expect(p.prunable).toBe(0);
    expect(p.protectedByUserState).toBe(1);
  });
});

describe("runPrune — cascades reach links, never user rows", () => {
  it("deletes the item and its links + external ids", () => {
    addItem("junk", 1);
    expect(count("SELECT COUNT(*) n FROM media_links")).toBe(1);
    expect(count("SELECT COUNT(*) n FROM media_external_ids")).toBe(1);

    const r = runPrune();

    expect(r.deleted).toBe(1);
    expect(r.remaining).toBe(0);
    expect(count("SELECT COUNT(*) n FROM media_items")).toBe(0);
    // ON DELETE CASCADE only fires with foreign_keys = ON; getDb() sets it, and
    // this is what proves it's actually on rather than assumed.
    expect(count("SELECT COUNT(*) n FROM media_links")).toBe(0);
    expect(count("SELECT COUNT(*) n FROM media_external_ids")).toBe(0);
    expect(orphanCheck()).toEqual({ orphanLinks: 0, orphanExternalIds: 0 });
  });

  it("leaves library and watchlist row counts untouched", () => {
    addItem("owned", 0);
    addLibrary("owned");
    addItem("junk", 1);

    const r = runPrune();

    expect(r.deleted).toBe(1);
    expect(r.libraryRowsAfter).toBe(r.libraryRowsBefore);
    expect(r.watchlistRowsAfter).toBe(r.watchlistRowsBefore);
  });

  // THE test. The plan's original predicate was `browsed = 1 AND id NOT IN
  // user_item_state`. This constructs the exact state where that is wrong — a
  // library row whose item is browsed with NO user_item_state row — and proves
  // the extra clauses save it. If someone ever "simplifies" the predicate back,
  // this fails instead of quietly eating a rating and review.
  it("does NOT delete an item held only by user_library (narrower predicate would have)", () => {
    addItem("library-only", 1);
    addLibrary("library-only", 9.5);

    const p = previewPrune();
    expect(p.wouldHaveLostLibraryRows).toBe(1); // the naive predicate's blast radius
    expect(p.prunable).toBe(0);                 // the safe one spares it
    expect(p.protectedByLibrary).toBe(1);

    const r = runPrune();
    expect(r.deleted).toBe(0);
    expect(count("SELECT COUNT(*) n FROM user_library")).toBe(1);
    expect(get<{ review: string }>("SELECT review FROM user_library")?.review).toBe("my private note");
  });

  it("does NOT delete an item held only by user_watchlist", () => {
    addItem("watchlist-only", 1);
    addWatchlist("watchlist-only");

    const p = previewPrune();
    expect(p.wouldHaveLostWatchlistRows).toBe(1);
    expect(p.prunable).toBe(0);

    expect(runPrune().deleted).toBe(0);
    expect(count("SELECT COUNT(*) n FROM user_watchlist")).toBe(1);
  });

  it("batches through a larger set and reports remaining honestly", () => {
    for (let i = 0; i < 25; i++) addItem(`bulk-${i}`, 1);

    // Deliberately too small a budget to finish in one pass.
    const first = runPrune({ batchSize: 5, budgetMs: 1000 });
    expect(first.deleted).toBeGreaterThan(0);
    expect(first.deleted + first.remaining).toBe(25);

    // Resumable: repeat until drained, exactly as the route instructs.
    let guard = 0;
    while (previewPrune().prunable > 0 && guard++ < 20) runPrune({ batchSize: 5 });
    expect(previewPrune().prunable).toBe(0);
    expect(count("SELECT COUNT(*) n FROM media_items")).toBe(0);
  });

  it("is a no-op on a clean database", () => {
    addItem("pool-item", 0);
    const r = runPrune();
    expect(r.deleted).toBe(0);
    expect(r.batches).toBe(0);
    expect(count("SELECT COUNT(*) n FROM media_items")).toBe(1);
  });
});

describe("startPruneJob — paced background prune", () => {
  const settle = async () => {
    // The job sleeps 1.5s between batches; give it room to drain a small set.
    for (let i = 0; i < 40 && pruneJobState().running; i++) {
      await new Promise((r) => setTimeout(r, 250));
    }
  };

  it("drains the prunable set and leaves the pool alone", async () => {
    addItem("keep-me", 0);
    for (let i = 0; i < 3; i++) addItem(`junk-${i}`, 1);

    startPruneJob({ batchSize: 2 });
    await settle();

    const s = pruneJobState();
    expect(s.running).toBe(false);
    expect(s.deleted).toBe(3);
    expect(s.remaining).toBe(0);
    expect(s.abortedForSafety).toBe(false);
    expect(s.lastError).toBeNull();
    expect(count("SELECT COUNT(*) n FROM media_items")).toBe(1);
  }, 20000);

  it("refuses to start a second job while one is running", async () => {
    for (let i = 0; i < 5; i++) addItem(`junk2-${i}`, 1);
    const first = startPruneJob({ batchSize: 1 });
    const second = startPruneJob({ batchSize: 1 });
    // Same job object, not a second concurrent deleter racing the first.
    expect(first.startedAt).toBe(second.startedAt);
    // MUST drain before the test ends: the job is module-level singleton state,
    // so leaving it running lets it observe the NEXT test's beforeEach wiping
    // the tables — which trips its own user-rows-changed guard and makes an
    // unrelated test fail. (It did, which is at least a good sign for the guard.)
    await settle();
  }, 20000);

  it("never touches an item a user holds, even unattended", async () => {
    addItem("browsed-but-mine", 1);
    addLibrary("browsed-but-mine", 8);
    addItem("really-junk", 1);

    startPruneJob({ batchSize: 5 });
    await settle();

    const s = pruneJobState();
    expect(s.deleted).toBe(1);
    expect(s.abortedForSafety).toBe(false);
    expect(count("SELECT COUNT(*) n FROM user_library")).toBe(1);
    expect(count("SELECT COUNT(*) n FROM media_items")).toBe(1);
  }, 20000);
});

// The test DB is :memory:, which cannot use WAL — so these pin the CONTRACT
// (opt-in probing, shape, derived arithmetic) rather than real WAL numbers,
// which only exist on the file-backed prod database. The probe being opt-in is
// the part that actually matters: it writes, and the dry-run GET must not.
describe("walDiagnostics — checkpoint-stall probe (PR16)", () => {
  it("does NOT run the PASSIVE checkpoint unless explicitly asked", () => {
    const w = walDiagnostics();
    expect(w.busy).toBeNull();
    expect(w.logFrames).toBeNull();
    expect(w.checkpointedFrames).toBeNull();
    expect(w.pendingFrames).toBeNull();
    expect(w.pendingMb).toBeNull();
  });

  it("always reports the pure pragma reads, probe or not", () => {
    const w = walDiagnostics();
    expect(w).toHaveProperty("journalMode");
    expect(w).toHaveProperty("autocheckpoint");
    // The stall hypothesis rests on this being 0 in prod (Litestream disables
    // SQLite's own autocheckpoint); reading it must never silently fail.
    expect(w.autocheckpoint === null || typeof w.autocheckpoint === "number").toBe(true);
  });

  it("derives the pending backlog from the probe rather than guessing", () => {
    const w = walDiagnostics({ probe: true });
    if (w.logFrames == null || w.checkpointedFrames == null) {
      // :memory: has no WAL — the probe legitimately reports nothing.
      expect(w.pendingFrames).toBeNull();
      return;
    }
    expect(w.pendingFrames).toBe(w.logFrames - w.checkpointedFrames);
  });
});
