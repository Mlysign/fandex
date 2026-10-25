import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetBreakers } from "@/lib/http";
import { PROJECTION_VERSION } from "@/lib/sources/project";
import { kvSet } from "../src/budget";
import { DERIVE_VERSION } from "../src/catalog/derive";
import { upsertMediaItem } from "../src/catalog/ingest";
import {
  exportTables, OPENLIBRARY_REFETCH_BEFORE, REDERIVE_GO_KEY, runExportStep, runProjectionRefreshStep, runIgdbCollectionsStep, runOpenLibraryRefetchStep, runRederiveStep, runSteamTagsStep, runTmdbRefreshStep, runWikidataPeopleStep, runUpcomingRefreshStep, TMDB_REFRESH_AFTER_DAYS,
} from "../src/cron";
import { db, env, gameItem, movieItem, tmdbMovie, wipe } from "./helpers";

const DAY = Date.parse("2026-10-04T03:17:00Z");

async function emptyBucket(): Promise<void> {
  const listed = await env.BACKUPS.list();
  if (listed.objects.length) await env.BACKUPS.delete(listed.objects.map((o) => o.key));
}
async function keys(): Promise<string[]> {
  return (await env.BACKUPS.list()).objects.map((o) => o.key).sort();
}
async function readJson(key: string): Promise<any> {
  return JSON.parse(await (await env.BACKUPS.get(key))!.text());
}
/** Run steps until the day's export reports done. */
async function exportAll(now = DAY): Promise<number> {
  let wrote = 0;
  for (let i = 0; i < 40; i++) {
    const step = await runExportStep(env, now);
    wrote += step.wrote;
    if (step.done) return wrote;
  }
  throw new Error("export never finished");
}

beforeEach(async () => {
  await wipe();
  await emptyBucket();
  __resetBreakers();
});
afterEach(() => vi.restoreAllMocks());

describe("the nightly export", () => {
  it("backs up what no provider can give back, and nothing that is not data", async () => {
    const film = await upsertMediaItem(db, movieItem());
    await db.batch([
      db.prepare("INSERT INTO users (id, country) VALUES ('u1', 'DE')"),
      db.prepare("INSERT INTO user_identities (provider, provider_user_id, user_id) VALUES ('google', 'sub-1', 'u1')"),
      db.prepare("INSERT INTO user_item_state (user_id, media_item_id, source, relation, rating) VALUES ('u1', ?, 'local', 'library', 9)").bind(film.id),
      db.prepare("INSERT INTO tag_category (id, label, color) VALUES ('genre', 'Genre', '#fff')"),
      db.prepare("INSERT INTO tag_category_override (tag_key, category_id) VALUES ('sci fi', 'genre')"),
    ]);
    await kvSet(db, "twitch_app_token", JSON.stringify({ token: "SECRET-TWITCH-TOKEN", expiresAt: 9e12 }));

    await exportAll();
    const all = await keys();

    // Personal tables and the hand-made taxonomy are there.
    for (const t of ["users", "user_identities", "user_item_state", "tag_category", "tag_category_override", "media_items", "media_links"]) {
      expect(all.some((k) => k.startsWith(`d1/2026-10-04/${t}-`)), t).toBe(true);
    }
    // The rebuildable and the operational are not.
    for (const t of ["item_doc", "kv", "daily_budget", "franchise_members", "calendar_month", "d1_migrations"]) {
      expect(all.some((k) => k.includes(`/${t}-`)), t).toBe(false);
    }

    expect(await readJson("d1/2026-10-04/user_item_state-00000000.json")).toEqual([
      expect.objectContaining({ user_id: "u1", media_item_id: film.id, rating: 9 }),
    ]);
    // Enough to rebuild identity (which provider id is which item) without the blobs.
    const links = await readJson("d1/2026-10-04/media_links-00000000.json");
    expect(links[0]).toMatchObject({ source: "tmdb", source_id: "603", media_type: "movie", media_item_id: film.id });
    expect(links[0].raw_data).toBeUndefined();

    // The Twitch token is in kv, and kv must never reach a bucket.
    for (const k of all) expect(await (await env.BACKUPS.get(k))!.text()).not.toContain("SECRET-TWITCH-TOKEN");
  });

  it("writes the manifest last, so its presence means the day is complete", async () => {
    for (let i = 0; i < 5; i++) await upsertMediaItem(db, movieItem({ id: 100 + i, title: `Film ${i}`, belongs_to_collection: null }));

    const first = await runExportStep(env, DAY);
    expect(first.done).toBe(false);
    expect(await keys()).not.toContain("d1/2026-10-04/manifest.json");

    await exportAll();
    const manifest = await readJson("d1/2026-10-04/manifest.json");
    expect(manifest).toMatchObject({ day: "2026-10-04" });
    expect(manifest.tables).toEqual(await exportTables(db));
    expect(manifest.rows).toBeGreaterThanOrEqual(10);
  });

  it("does nothing more once the day is done, and starts over the next day", async () => {
    await upsertMediaItem(db, movieItem());
    await exportAll();
    const before = await keys();
    expect(await runExportStep(env, DAY)).toMatchObject({ wrote: 0, done: true });
    expect(await keys()).toEqual(before);

    const tomorrow = DAY + 86_400_000;
    await exportAll(tomorrow);
    expect((await keys()).some((k) => k.startsWith("d1/2026-10-05/"))).toBe(true);
    // Yesterday's export is still there. Nothing here deletes a backup.
    expect((await keys()).filter((k) => k.startsWith("d1/2026-10-04/"))).toEqual(before);
  });

  it("pages a table bigger than one chunk without losing or repeating a row", async () => {
    const rows = Array.from({ length: 2350 }, (_, i) => `('2026-01-01', 'path-${String(i).padStart(5, "0")}', 0, ${i})`);
    for (let i = 0; i < rows.length; i += 500) {
      await db.prepare(`INSERT INTO page_view_daily (day, path_key, authed, count) VALUES ${rows.slice(i, i + 500).join(",")}`).run();
    }
    await exportAll();
    const parts = (await keys()).filter((k) => k.includes("/page_view_daily-"));
    // Named by the rows before them, which is how the restore drill walks them.
    expect(parts.map((k) => k.split("-").pop())).toEqual(["00000000.json", "00001000.json", "00002000.json"]);
    const seen = new Set<string>();
    let total = 0;
    for (const p of parts) for (const r of await readJson(p)) { seen.add(r.path_key); total++; }
    expect(seen.size).toBe(2350);
    expect(total).toBe(2350);
  });

  it("pages by key, so a table costs its own size in rows read and not its square", async () => {
    // A rowid table and a WITHOUT ROWID one with a three-column key, both
    // three chunks long. Paged by OFFSET they read 1,000 + 2,000 + 2,350 each.
    await db.prepare("CREATE TABLE user_notes (user_id TEXT NOT NULL, note TEXT)").run();
    try {
      const notes = Array.from({ length: 2350 }, (_, i) => `('u${i % 7}', 'note ${i}')`);
      const views = Array.from({ length: 2350 }, (_, i) => `('2026-01-0${i % 3 + 1}', 'path-${i % 800}', ${i % 2}, ${i})`);
      for (let i = 0; i < 2350; i += 500) {
        await db.prepare(`INSERT INTO user_notes VALUES ${notes.slice(i, i + 500).join(",")}`).run();
        await db.prepare(`INSERT OR IGNORE INTO page_view_daily (day, path_key, authed, count) VALUES ${views.slice(i, i + 500).join(",")}`).run();
      }
      const viewRows = (await db.prepare("SELECT COUNT(*) n FROM page_view_daily").first<{ n: number }>())!.n;

      let rowsRead = 0;
      for (let i = 0; i < 40; i++) {
        const step = await runExportStep(env, DAY);
        rowsRead += step.rowsRead;
        if (step.done) break;
      }

      for (const [table, rows, field] of [["user_notes", 2350, "note"], ["page_view_daily", viewRows, "count"]] as const) {
        const parts = (await keys()).filter((k) => k.includes(`/${table}-`));
        const got: unknown[] = [];
        for (const p of parts) got.push(...(await readJson(p)).map((r: any) => r[field]));
        expect(got.length, table).toBe(rows);
        expect(new Set(got).size, table).toBe(rows);
      }
      // Every other table here is a few rows, so 4,700 is the floor. Measured 4,720;
      // by OFFSET the same two tables read 10,700.
      expect(rowsRead).toBeLessThan(2350 + viewRows + 100);
    } finally {
      await db.prepare("DROP TABLE user_notes").run();
    }
  });

  it("starts a table again when the saved cursor is the old offset kind", async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => `('2026-01-01', 'p-${String(i).padStart(5, "0")}', 0, ${i})`);
    for (let i = 0; i < rows.length; i += 500) {
      await db.prepare(`INSERT INTO page_view_daily (day, path_key, authed, count) VALUES ${rows.slice(i, i + 500).join(",")}`).run();
    }
    const tables = await exportTables(db);
    await kvSet(db, "export_cursor", JSON.stringify({
      day: "2026-10-04", tables, table: tables.indexOf("page_view_daily"), offset: 1000, done: false, rows: 0,
    }));
    await exportAll();
    const seen = new Set<string>();
    for (const p of (await keys()).filter((k) => k.includes("/page_view_daily-"))) {
      for (const r of await readJson(p)) seen.add(r.path_key);
    }
    expect(seen.size).toBe(1500);
  });

  it("covers a table added after this code was written", async () => {
    await db.prepare("CREATE TABLE user_notes (user_id TEXT NOT NULL, note TEXT)").run();
    try {
      await db.prepare("INSERT INTO user_notes VALUES ('u1', 'remember this')").run();
      await exportAll();
      expect(await readJson("d1/2026-10-04/user_notes-00000000.json")).toEqual([{ user_id: "u1", note: "remember this" }]);
    } finally {
      await db.prepare("DROP TABLE user_notes").run();
    }
  });
});

describe("the TMDB refresh", () => {
  const NOW = Math.floor(DAY / 1000);
  const OLD = NOW - (TMDB_REFRESH_AFTER_DAYS + 5) * 86_400;
  const age = (sourceId: string, at: number) =>
    db.prepare("UPDATE media_links SET last_synced = ? WHERE source = 'tmdb' AND source_id = ?").bind(at, sourceId).run();

  function tmdb(routes: Record<string, () => Response>): string[] {
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push(url);
      for (const [needle, respond] of Object.entries(routes)) if (url.includes(needle)) return respond();
      throw new Error(`unexpected provider call: ${url}`);
    });
    return calls;
  }

  it("refetches a link that is nearly six months old, and leaves a fresh one alone", async () => {
    const old = await upsertMediaItem(db, movieItem());
    await upsertMediaItem(db, movieItem({ id: 604, title: "The Matrix Reloaded", belongs_to_collection: null }));
    await age("603", OLD);

    const calls = tmdb({ "/3/movie/603": () => Response.json(tmdbMovie({ vote_count: 31000 })) });
    expect(await runTmdbRefreshStep(env, NOW)).toEqual({ refreshed: 1, failed: 0 });
    expect(calls).toHaveLength(1);

    const item = await db.prepare("SELECT vote_count FROM media_items WHERE id = ?").bind(old.id).first<{ vote_count: number }>();
    expect(item!.vote_count).toBe(31000);
    const link = await db.prepare("SELECT last_synced FROM media_links WHERE source_id = '603'").first<{ last_synced: number }>();
    expect(link!.last_synced).toBeGreaterThan(OLD);
  });

  it("keeps the stored data and its true age when a refresh fails, and sets the link aside", async () => {
    const { id } = await upsertMediaItem(db, movieItem());
    await age("603", OLD);
    const before = await db.prepare("SELECT raw_data FROM media_links WHERE source_id = '603'").first<{ raw_data: string }>();

    tmdb({ "/3/movie/603": () => new Response("{}", { status: 404 }) });
    expect(await runTmdbRefreshStep(env, NOW)).toEqual({ refreshed: 0, failed: 1 });

    const after = await db.prepare("SELECT raw_data, last_synced FROM media_links WHERE source_id = '603'").first<{ raw_data: string; last_synced: number }>();
    // A failed refresh must never overwrite a stored blob with nothing.
    expect(after!.raw_data).toBe(before!.raw_data);
    expect((await db.prepare("SELECT title FROM media_items WHERE id = ?").bind(id).first<{ title: string }>())!.title).toBe("The Matrix");
    // The copy's age is what TMDB's six-month cap counts from, so it does not
    // move. The link is set aside instead, so a title TMDB deleted cannot block
    // the queue.
    expect(after!.last_synced).toBe(OLD);
    const calls = tmdb({});
    expect(await runTmdbRefreshStep(env, NOW)).toEqual({ refreshed: 0, failed: 0 });
    expect(calls).toEqual([]);
  });

  it("never touches an IGDB link, however old", async () => {
    // IGDB's retention question is open. Refreshing on a timer would be
    // answering it; until it is answered this job leaves games alone.
    await upsertMediaItem(db, gameItem());
    await db.prepare("UPDATE media_links SET last_synced = ? WHERE source = 'igdb'").bind(OLD).run();
    const calls = tmdb({});
    expect(await runTmdbRefreshStep(env, NOW)).toEqual({ refreshed: 0, failed: 0 });
    expect(calls).toEqual([]);
  });

  it("parks itself after finding nothing due, instead of scanning every ten minutes", async () => {
    await upsertMediaItem(db, movieItem());
    tmdb({});
    await runTmdbRefreshStep(env, NOW);
    expect(await db.prepare("SELECT 1 x FROM kv WHERE key = 'tmdb_refresh_idle'").first()).not.toBeNull();

    // Even a link that becomes due is not looked for until the park expires.
    await age("603", OLD);
    expect(await runTmdbRefreshStep(env, NOW)).toEqual({ refreshed: 0, failed: 0 });
    await db.prepare("DELETE FROM kv WHERE key = 'tmdb_refresh_idle'").run();
    tmdb({ "/3/movie/603": () => Response.json(tmdbMovie()) });
    expect(await runTmdbRefreshStep(env, NOW)).toEqual({ refreshed: 1, failed: 0 });
  });

  describe("of titles that are not out yet", () => {
    // NOW is 2026-10-04. Each film is its own title, or the matcher would fold them into one item.
    const film = (id: number, release_date: string | null) =>
      movieItem({ id, title: `Film ${id}`, release_date, belongs_to_collection: null, external_ids: {} });
    const daysAgo = (n: number) => NOW - n * 86_400;
    const answer = (id: number, over: Record<string, unknown> = {}) =>
      () => Response.json(tmdbMovie({ id, title: `Film ${id}`, belongs_to_collection: null, external_ids: {}, ...over }));
    const unpark = () => db.prepare("DELETE FROM kv WHERE key = 'tmdb_upcoming_idle'").run();
    const syncedAt = async (sourceId: string) =>
      (await db.prepare("SELECT last_synced FROM media_links WHERE source = 'tmdb' AND source_id = ?").bind(sourceId).first<{ last_synced: number }>())!.last_synced;

    it("refetches a film coming out soon after a day, and one further out or undated after a week", async () => {
      await upsertMediaItem(db, film(1, "2026-10-30")); // near
      await upsertMediaItem(db, film(2, "2027-07-01")); // far
      await upsertMediaItem(db, film(3, null));         // no date yet
      await upsertMediaItem(db, film(4, "2027-08-01")); // far, and a week old
      for (const id of ["1", "2", "3"]) await age(id, daysAgo(2));
      await age("4", daysAgo(8));

      const calls = tmdb({ "/3/movie/1?": answer(1, { release_date: "2026-10-30" }), "/3/movie/4?": answer(4, { release_date: "2027-08-01" }) });
      expect(await runUpcomingRefreshStep(env, 2, NOW)).toEqual({ refreshed: 2, failed: 0 });
      // The oldest copy first, and neither of the two-day-old far ones.
      expect(calls.map((u) => /movie\/(\d+)/.exec(u)![1])).toEqual(["4", "1"]);

      // A week on, the far and the undated film are due as well.
      await unpark();
      for (const id of ["2", "3"]) await age(id, daysAgo(8));
      tmdb({ "/3/movie/2?": answer(2, { release_date: "2027-07-01" }), "/3/movie/3?": answer(3, { release_date: null }) });
      expect(await runUpcomingRefreshStep(env, 2, NOW)).toEqual({ refreshed: 2, failed: 0 });
    });

    it("carries a date TMDB moved to the item, its vector and the next delta", async () => {
      const { id } = await upsertMediaItem(db, film(1, "2026-12-02"));
      await age("1", daysAgo(3));
      await db.prepare("UPDATE media_items SET updated_at = ? WHERE id = ?").bind(daysAgo(3), id).run();

      tmdb({ "/3/movie/1?": answer(1, { release_date: "2026-12-23" }) });
      expect(await runUpcomingRefreshStep(env, 2, NOW)).toEqual({ refreshed: 1, failed: 0 });

      const item = await db.prepare("SELECT release_date, updated_at FROM media_items WHERE id = ?").bind(id).first<{ release_date: string; updated_at: number }>();
      expect(item!.release_date).toBe("2026-12-23");
      expect(item!.updated_at).toBeGreaterThan(daysAgo(3));
      const doc = await db.prepare("SELECT vector FROM item_doc WHERE media_item_id = ?").bind(id).first<{ vector: string }>();
      expect(JSON.parse(doc!.vector).releaseDate).toBe("2026-12-23");
    });

    it("leaves alone what is out, what nobody acted on, and every game", async () => {
      await upsertMediaItem(db, film(1, "2024-05-01"));                // long out: the retention refresh's business
      await upsertMediaItem(db, film(2, "2026-10-30"), { browsed: 1 }); // opened once, not in the pool
      await upsertMediaItem(db, gameItem());
      await db.prepare("UPDATE media_links SET last_synced = ?").bind(daysAgo(100)).run();

      const calls = tmdb({});
      expect(await runUpcomingRefreshStep(env, 2, NOW)).toEqual({ refreshed: 0, failed: 0 });
      expect(calls).toEqual([]);
      // Nothing due parks the scan, so the next run costs one row read.
      expect(await db.prepare("SELECT 1 x FROM kv WHERE key = 'tmdb_upcoming_idle'").first()).not.toBeNull();
    });

    it("keeps to the fetches the retention refresh left it", async () => {
      for (const id of [1, 2, 3]) await upsertMediaItem(db, film(id, "2026-10-30"));
      await db.prepare("UPDATE media_links SET last_synced = ?").bind(daysAgo(2)).run();

      const none = tmdb({});
      expect(await runUpcomingRefreshStep(env, 0, NOW)).toEqual({ refreshed: 0, failed: 0 });
      expect(none).toEqual([]);

      const calls = tmdb({ "/3/movie/": answer(1, { release_date: "2026-10-30" }) });
      expect(await runUpcomingRefreshStep(env, 1, NOW)).toEqual({ refreshed: 1, failed: 0 });
      expect(calls).toHaveLength(1);
    });

    it("after a failed fetch keeps the copy and its age, skips that title, and stands down for a while", async () => {
      await upsertMediaItem(db, film(1, "2026-10-30"));
      await upsertMediaItem(db, film(2, "2026-11-06"));
      await age("1", daysAgo(50));
      await age("2", daysAgo(2));
      const before = await db.prepare("SELECT raw_data FROM media_links WHERE source_id = '1'").first<{ raw_data: string }>();

      tmdb({ "/3/movie/1?": () => new Response("{}", { status: 404 }), "/3/movie/2?": answer(2, { release_date: "2026-11-06" }) });
      expect(await runUpcomingRefreshStep(env, 1, NOW)).toEqual({ refreshed: 0, failed: 1 });

      // The copy is still 50 days old as far as the six-month cap is concerned.
      expect(await syncedAt("1")).toBe(daysAgo(50));
      expect((await db.prepare("SELECT raw_data FROM media_links WHERE source_id = '1'").first<{ raw_data: string }>())!.raw_data).toBe(before!.raw_data);

      // Stood down: no call at all until the park lifts.
      const quiet = tmdb({});
      expect(await runUpcomingRefreshStep(env, 1, NOW)).toEqual({ refreshed: 0, failed: 0 });
      expect(quiet).toEqual([]);

      // Then the failed title is passed over, so it cannot block the one behind it.
      await unpark();
      const calls = tmdb({ "/3/movie/2?": answer(2, { release_date: "2026-11-06" }) });
      expect(await runUpcomingRefreshStep(env, 1, NOW)).toEqual({ refreshed: 1, failed: 0 });
      expect(calls).toHaveLength(1);

      // And it gets another try once its three days are up.
      await unpark();
      const later = NOW + 4 * 86_400;
      const retry = tmdb({ "/3/movie/1?": answer(1, { release_date: "2026-10-30" }), "/3/movie/2?": answer(2, { release_date: "2026-11-06" }) });
      expect((await runUpcomingRefreshStep(env, 1, later)).refreshed).toBe(1);
      expect(retry[0]).toContain("/3/movie/1?");
    });
  });
});

describe("the books stored before their series was read", () => {
  const NOW = OPENLIBRARY_REFETCH_BEFORE + 3600;
  const BEFORE = OPENLIBRARY_REFETCH_BEFORE - 86_400;
  const WORK = "OL15358691W";
  const book = (over: Record<string, unknown> = {}) => ({
    source: "openlibrary" as const, sourceId: WORK, type: "book" as const, title: "The Way of Kings", releaseDate: "2010-07-09",
    rawData: { id: WORK, key: `/works/${WORK}`, title: "The Way of Kings", author_name: ["Brandon Sanderson"], first_publish_year: 2010, language: ["eng"], ...over },
  });
  const age = (sourceId: string, at: number) =>
    db.prepare("UPDATE media_links SET last_synced = ? WHERE source = 'openlibrary' AND source_id = ?").bind(at, sourceId).run();
  const stored = () => db.prepare("SELECT raw_data, last_synced FROM media_links WHERE source = 'openlibrary' AND source_id = ?").bind(WORK)
    .first<{ raw_data: string; last_synced: number }>();

  function openLibrary(routes: Record<string, () => Response>): string[] {
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push(url);
      for (const [needle, respond] of Object.entries(routes)) if (url.includes(needle)) return respond();
      throw new Error(`unexpected provider call: ${url}`);
    });
    return calls;
  }
  /** Open Library as it answers for The Way of Kings: no series on the search row, the series on the editions. */
  const answers = () => ({
    [`/works/${WORK}/editions.json`]: () => Response.json({ size: 2, entries: [
      { series: ["The Stormlight Archive #1"], languages: [{ key: "/languages/eng" }] },
      { series: ["O Arquivo das Tempestades, I"], languages: [{ key: "/languages/por" }] },
    ] }),
    [`/works/${WORK}.json`]: () => Response.json({ key: `/works/${WORK}`, title: "The Way of Kings", subjects: ["Fantasy"] }),
    "/search.json": () => Response.json({ docs: [book().rawData] }),
  });

  it("fetches a book stored before the fix again, and its series arrives", async () => {
    const { id } = await upsertMediaItem(db, book());
    await age(WORK, BEFORE);
    const calls = openLibrary(answers());

    expect(await runOpenLibraryRefetchStep(env, 2, NOW)).toEqual({ refreshed: 1, failed: 0 });
    expect(calls).toHaveLength(3);
    const after = await stored();
    expect(JSON.parse(after!.raw_data).series_name).toEqual(["The Stormlight Archive"]);
    expect(after!.last_synced).toBeGreaterThanOrEqual(OPENLIBRARY_REFETCH_BEFORE);
    // What the score reads: the franchise facet, derived at write time.
    const doc = await db.prepare("SELECT facets FROM item_doc WHERE media_item_id = ?").bind(id).first<{ facets: string }>();
    expect(doc!.facets).toContain("The Stormlight Archive");
  });

  it("leaves a book fetched after the fix alone, or one that already names its series, takes no slot it is not given, and parks itself when none is due", async () => {
    await upsertMediaItem(db, book());
    await upsertMediaItem(db, { ...book(), sourceId: "OL8479867W", title: "The Name of the Wind", rawData: { ...book().rawData, id: "OL8479867W", key: "/works/OL8479867W", title: "The Name of the Wind", series_name: ["The Kingkiller Chronicle"] } });
    await age("OL8479867W", BEFORE);
    const calls = openLibrary(answers());
    expect(await runOpenLibraryRefetchStep(env, 0, NOW)).toEqual({ refreshed: 0, failed: 0 });
    expect(await runOpenLibraryRefetchStep(env, 2, NOW)).toEqual({ refreshed: 0, failed: 0 });
    expect(calls).toEqual([]);
    expect(await db.prepare("SELECT 1 x FROM kv WHERE key = 'ol_refetch_idle'").first()).not.toBeNull();
  });

  it("keeps the stored data when Open Library has nothing, and does not ask about that book again", async () => {
    await upsertMediaItem(db, book());
    await age(WORK, BEFORE);
    const before = await stored();
    openLibrary({ [`/works/${WORK}.json`]: () => new Response("", { status: 404 }) });

    expect(await runOpenLibraryRefetchStep(env, 2, NOW)).toEqual({ refreshed: 0, failed: 1 });
    const after = await stored();
    expect(after!.raw_data).toBe(before!.raw_data);
    expect(after!.last_synced).toBe(OPENLIBRARY_REFETCH_BEFORE);
    const again = openLibrary(answers());
    expect(await runOpenLibraryRefetchStep(env, 2, NOW)).toEqual({ refreshed: 0, failed: 0 });
    expect(again).toEqual([]);
  });
});

describe("the games stored before their IGDB collections were asked for", () => {
  const cursor = () => db.prepare("SELECT value FROM kv WHERE key = 'igdb_collections_cursor'").first<{ value: string }>();
  const facetsOf = async (id: string) =>
    JSON.parse((await db.prepare("SELECT facets FROM item_doc WHERE media_item_id = ?").bind(id).first<{ facets: string }>())!.facets) as any[];

  function igdb(collections: Record<number, string[] | null>): string[] {
    const bodies: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("id.twitch.tv")) return Response.json({ access_token: "t", expires_in: 5_000_000 });
      if (url.includes("api.igdb.com/v4/games")) {
        bodies.push(String(init?.body ?? ""));
        // IGDB leaves an empty field out, and a game it no longer has out of the answer.
        return Response.json(Object.entries(collections).filter(([, c]) => c !== null)
          .map(([id, c]) => ({ id: Number(id), ...(c!.length ? { collections: c!.map((name) => ({ name })) } : {}) })));
      }
      throw new Error(`unexpected provider call: ${url}`);
    });
    return bodies;
  }

  it("stores each game again with its collections, as the series on its franchise facet", async () => {
    const tieIn = await upsertMediaItem(db, gameItem({ id: 101, name: "Harry Potter and the Chamber of Secrets", franchises: [{ name: "Harry Potter" }] }));
    const legacy = await upsertMediaItem(db, gameItem({ id: 102, name: "Hogwarts Legacy", franchises: [{ name: "Harry Potter" }] }));
    const gone = await upsertMediaItem(db, gameItem({ id: 103, name: "Gone", franchises: [{ name: "Harry Potter" }] }));
    const bodies = igdb({ 101: ["Harry Potter"], 102: [], 103: null });

    expect(await runIgdbCollectionsStep(env, 10)).toEqual({ refreshed: 2, missing: 1 });
    // One call for the whole batch.
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("where id = (101,102,103)");
    expect((await facetsOf(tieIn.id)).find((f) => f.kind === "ip")).toMatchObject({ key: "harry potter", series: ["Harry Potter"] });
    // In no collection is an answer: [] where "not known" is no field at all.
    expect((await facetsOf(legacy.id)).find((f) => f.kind === "ip").series).toEqual([]);
    expect((await facetsOf(gone.id)).find((f) => f.kind === "ip").series).toBeUndefined();
    // The rest of the stored payload survives the merge.
    expect((await facetsOf(tieIn.id)).some((f) => f.kind === "company")).toBe(true);
    expect((await cursor())!.value).toBe("103");
  });

  it("walks in batches from its cursor, then parks for good", async () => {
    await upsertMediaItem(db, gameItem({ id: 201, name: "A" }));
    await upsertMediaItem(db, gameItem({ id: 202, name: "B" }));
    const bodies = igdb({ 201: [], 202: [] });
    expect(await runIgdbCollectionsStep(env, 1)).toEqual({ refreshed: 1, missing: 0 });
    expect(await runIgdbCollectionsStep(env, 1)).toEqual({ refreshed: 1, missing: 0 });
    expect(await runIgdbCollectionsStep(env, 1)).toEqual({ refreshed: 0, missing: 0 });
    expect((await cursor())!.value).toBe("done");
    expect(await runIgdbCollectionsStep(env, 1)).toEqual({ refreshed: 0, missing: 0 });
    expect(bodies).toHaveLength(2);
  });

  it("leaves the cursor where it was when IGDB fails, so the batch is asked again", async () => {
    await upsertMediaItem(db, gameItem({ id: 301, name: "A" }));
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("id.twitch.tv")) return Response.json({ access_token: "t", expires_in: 5_000_000 });
      return new Response("down", { status: 500 });
    });
    await expect(runIgdbCollectionsStep(env, 5)).rejects.toThrow();
    expect(await cursor()).toBeNull();
  });
});

describe("the TMDB links stored under an older projection", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    await wipe();
    __resetBreakers();
  });

  it("refetches each once, so a novelist becomes a writer facet, and parks when none are left", async () => {
    const { id } = await upsertMediaItem(db, movieItem());
    await db.prepare("UPDATE media_links SET projection_version = 3 WHERE source = 'tmdb'").run();
    const withNovel = tmdbMovie({
      credits: { cast: [], crew: [{ id: 3027, name: "Stephen King", job: "Novel" }, { id: 1, name: "Lana Wachowski", job: "Director" }] },
    });
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push(url);
      return Response.json(withNovel);
    });

    expect(await runProjectionRefreshStep(env)).toEqual({ refreshed: 1, failed: 0 });
    const link = await db.prepare("SELECT projection_version, raw_data FROM media_links WHERE source = 'tmdb'").first<{ projection_version: number; raw_data: string }>();
    expect(link!.projection_version).toBe(PROJECTION_VERSION);
    expect(JSON.parse(link!.raw_data).credits.crew.map((c: { job: string }) => c.job)).toContain("Novel");
    const facets = (await db.prepare("SELECT facets FROM item_doc WHERE media_item_id = ?").bind(id).first<{ facets: string }>())!.facets;
    expect(facets).toContain("Stephen King");

    // Nothing left below the version: the walk parks, and asks TMDB nothing more.
    expect(await runProjectionRefreshStep(env)).toEqual({ refreshed: 0, failed: 0 });
    expect(await runProjectionRefreshStep(env)).toEqual({ refreshed: 0, failed: 0 });
    expect(calls).toHaveLength(1);
  });
});

describe("Steam's voted tags onto the pool's games (2026-10-25)", () => {
  const withKey = { ...env, STEAM_API_KEY: "test-steam-key" };
  const cursor = () => db.prepare("SELECT value FROM kv WHERE key = 'steam_tags_cursor'").first<{ value: string }>();
  const facetsOf = async (id: string) =>
    JSON.parse((await db.prepare("SELECT facets FROM item_doc WHERE media_item_id = ?").bind(id).first<{ facets: string }>())!.facets) as any[];
  const steamPage = (appid: number) => ({ websites: [{ type: 13, url: `https://store.steampowered.com/app/${appid}/x` }] });

  /** Steam's two calls: the tag list, and the items asked for with their top tags as (id, weight). */
  function steam(answers: Record<number, number[] | null>): string[] {
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push(url);
      if (url.includes("GetTagList")) return Response.json({ response: { tags: [{ tagid: 19, name: "Action" }, { tagid: 1663, name: "FPS" }, { tagid: 4182, name: "Steampunk" }] } });
      if (url.includes("GetItems")) {
        const asked = JSON.parse(new URL(url).searchParams.get("input_json")!).ids.map((i: { appid: number }) => i.appid) as number[];
        return Response.json({ response: { store_items: asked.filter((a) => answers[a] !== null && answers[a] !== undefined)
          .map((a) => ({ appid: a, name: `App ${a}`, tags: answers[a]!.map((tagid, i) => ({ tagid, weight: 100 - i })) })) } });
      }
      throw new Error(`unexpected provider call: ${url}`);
    });
    return calls;
  }

  it("stores each game again with Steam's tags as its voted tier, in Steam's order, and marks one Steam has none for", async () => {
    const thief = await upsertMediaItem(db, gameItem({ id: 101, name: "Thief", ...steamPage(239160) }));
    const bare = await upsertMediaItem(db, gameItem({ id: 102, name: "Bare", ...steamPage(1) }));
    const gone = await upsertMediaItem(db, gameItem({ id: 103, name: "Gone", ...steamPage(2) }));
    // No Steam page anywhere: not asked.
    await upsertMediaItem(db, gameItem({ id: 104, name: "Console only" }));
    const calls = steam({ 239160: [4182, 19, 1663], 1: [], 2: null });

    expect(await runSteamTagsStep(withKey, 10)).toEqual({ tagged: 1, empty: 1, missing: 1 });
    expect(calls.filter((c) => c.includes("GetItems"))).toHaveLength(1);
    const voted = (await facetsOf(thief.id)).filter((f) => f.kind === "tag" && f.tier === "voted");
    expect(voted.map((f) => [f.label, f.rank])).toEqual([["Steampunk", 1], ["Action", 2], ["FPS", 3]]);
    // The rest of the payload survives the merge, and the answer is written down either way.
    expect((await facetsOf(thief.id)).some((f) => f.kind === "company")).toBe(true);
    for (const id of [bare.id, gone.id]) {
      const raw = JSON.parse((await db.prepare("SELECT raw_data FROM media_links WHERE media_item_id = ? AND source = 'igdb'").bind(id).first<{ raw_data: string }>())!.raw_data);
      expect(raw.steamTags).toEqual([]);
      expect(raw.name).toBeTruthy();
    }
    expect((await cursor())!.value).toBe("103");
    // Nothing left: parks for good, and asks Steam nothing more.
    expect(await runSteamTagsStep(withKey, 10)).toEqual({ tagged: 0, empty: 0, missing: 0 });
    expect((await cursor())!.value).toBe("done");
    expect(await runSteamTagsStep(withKey, 10)).toEqual({ tagged: 0, empty: 0, missing: 0 });
    expect(calls.filter((c) => c.includes("GetItems"))).toHaveLength(1);
  });

  it("reads the app id off a Steam link of the old stack too, and keeps the tag list a week", async () => {
    const { id } = await upsertMediaItem(db, gameItem({ id: 201, name: "Old" }));
    await db.prepare("INSERT INTO media_links (source, source_id, media_type, media_item_id, title, release_date, last_synced, projection_version, raw_data) VALUES ('steam', '440', 'game', ?, 'Old', NULL, 1, 1, '{\"appid\":440}')").bind(id).run();
    const calls = steam({ 440: [19] });
    expect(await runSteamTagsStep(withKey, 10)).toEqual({ tagged: 1, empty: 0, missing: 0 });
    expect((await facetsOf(id)).some((f) => f.kind === "tag" && f.tier === "voted" && f.label === "Action")).toBe(true);
    expect(calls.filter((c) => c.includes("GetTagList"))).toHaveLength(1);
    expect(await db.prepare("SELECT value FROM kv WHERE key = 'steam_tag_map'").first()).not.toBeNull();
  });

  it("does nothing without a key, and leaves the cursor where it was when Steam fails", async () => {
    await upsertMediaItem(db, gameItem({ id: 301, name: "A", ...steamPage(3) }));
    expect(await runSteamTagsStep({ ...env, STEAM_API_KEY: undefined }, 10)).toEqual({ tagged: 0, empty: 0, missing: 0 });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("down", { status: 500 }));
    await expect(runSteamTagsStep(withKey, 10)).rejects.toThrow();
    expect(await cursor()).toBeNull();
  });
});

describe("the pool under an older derive version", () => {
  const cursor = () => db.prepare("SELECT value FROM kv WHERE key = 'rederive_cursor'").first<{ value: string }>();
  const docVersion = async (id: string) => (await db.prepare("SELECT derive_version FROM item_doc WHERE media_item_id = ?").bind(id).first<{ derive_version: number }>())!.derive_version;

  it("waits for the word, then derives every stale pool item again from its links and moves it in the delta", async () => {
    const film = await upsertMediaItem(db, movieItem());
    const game = await upsertMediaItem(db, gameItem());
    const browsed = await upsertMediaItem(db, gameItem({ id: 9, name: "Browsed" }), { browsed: 1 });
    await db.prepare("UPDATE item_doc SET derive_version = 1, facets = '[]'").run();
    await db.prepare("UPDATE media_items SET updated_at = 1000").run();

    // Not asked for: nothing moves, however stale.
    expect(await runRederiveStep(env, 10)).toBeNull();
    expect(await docVersion(film.id)).toBe(1);
    await kvSet(db, REDERIVE_GO_KEY, String(DERIVE_VERSION - 1));
    expect(await runRederiveStep(env, 10)).toBeNull();

    await kvSet(db, REDERIVE_GO_KEY, String(DERIVE_VERSION));
    expect(await runRederiveStep(env, 1)).toEqual({ rederived: 1, skipped: 0 });
    expect(await runRederiveStep(env, 1)).toEqual({ rederived: 1, skipped: 0 });
    expect(await runRederiveStep(env, 1)).toEqual({ rederived: 0, skipped: 0 });
    expect((await cursor())!.value).toBe(`done:${DERIVE_VERSION}`);
    for (const { id } of [film, game]) {
      expect(await docVersion(id)).toBe(DERIVE_VERSION);
      const doc = await db.prepare("SELECT facets FROM item_doc WHERE media_item_id = ?").bind(id).first<{ facets: string }>();
      expect(JSON.parse(doc!.facets).length).toBeGreaterThan(0);
      expect((await db.prepare("SELECT updated_at FROM media_items WHERE id = ?").bind(id).first<{ updated_at: number }>())!.updated_at).toBeGreaterThan(1000);
    }
    // A row nobody acted on heals on its next write, not here.
    expect(await docVersion(browsed.id)).toBe(1);
    expect(await runRederiveStep(env, 10)).toEqual({ rederived: 0, skipped: 0 });
  });
});

describe("a game's people from Wikidata (2026-10-25)", () => {
  const cursor = () => db.prepare("SELECT value FROM kv WHERE key = 'wikidata_people_cursor'").first<{ value: string }>();
  const facetsOf = async (id: string) =>
    JSON.parse((await db.prepare("SELECT facets FROM item_doc WHERE media_item_id = ?").bind(id).first<{ facets: string }>())!.facets) as any[];
  const P = (n: string) => `http://www.wikidata.org/prop/direct/${n}`;
  const row = (key: string, qid: string, prop?: string, label?: string) => ({
    key: { value: key }, item: { value: `http://www.wikidata.org/entity/${qid}` },
    ...(prop ? { prop: { value: P(prop) }, personLabel: { value: label! } } : {}),
  });

  /** Wikidata's SPARQL answer: one binding per (game, property, person), and a game it knows but lists nobody for once, bare. */
  function wikidata(bindings: unknown[]): string[] {
    const queries: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (!url.includes("query.wikidata.org")) throw new Error(`unexpected provider call: ${url}`);
      queries.push(decodeURIComponent(new URL(url).searchParams.get("query")!));
      return Response.json({ results: { bindings } });
    });
    return queries;
  }

  it("stores each game again with its director, designer and writers, joined on the Steam app id or the IGDB slug", async () => {
    const mgs = await upsertMediaItem(db, gameItem({ id: 101, name: "Metal Gear Solid", slug: "metal-gear-solid", steamAppId: 2131630 }));
    const bare = await upsertMediaItem(db, gameItem({ id: 102, name: "Bare", slug: "bare" }));
    const gone = await upsertMediaItem(db, gameItem({ id: 103, name: "Gone", slug: "gone" }));
    const queries = wikidata([
      row("steam:2131630", "Q1", "P57", "Hideo Kojima"), row("steam:2131630", "Q1", "P287", "Hideo Kojima"),
      row("steam:2131630", "Q1", "P50", "Tomokazu Fukushima"), row("steam:2131630", "Q1", "P287", "Q99999"),
      row("igdb:bare", "Q2"),
    ]);

    expect(await runWikidataPeopleStep(env, 10)).toEqual({ known: 2, unknown: 1, people: 3 });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('"2131630"');
    expect(queries[0]).toContain('"metal-gear-solid"');
    const people = (await facetsOf(mgs.id)).filter((f) => f.kind === "person");
    expect(people.map((f) => [f.role, f.label])).toEqual([["director", "Hideo Kojima"], ["creator", "Hideo Kojima"], ["writer", "Tomokazu Fukushima"]]);
    // The rest of the payload survives, and a bare QID is never a person.
    expect((await facetsOf(mgs.id)).some((f) => f.kind === "company")).toBe(true);
    for (const id of [bare.id, gone.id]) {
      const raw = JSON.parse((await db.prepare("SELECT raw_data FROM media_links WHERE media_item_id = ? AND source = 'igdb'").bind(id).first<{ raw_data: string }>())!.raw_data);
      expect(raw.wikidata).toEqual({ qid: id === bare.id ? "Q2" : null, directors: [], designers: [], writers: [] });
      expect((await facetsOf(id)).filter((f) => f.kind === "person")).toEqual([]);
    }
    expect((await cursor())!.value).toBe("103");
    expect(await runWikidataPeopleStep(env, 10)).toEqual({ known: 0, unknown: 0, people: 0 });
    expect((await cursor())!.value).toBe("done");
    expect(queries).toHaveLength(1);
  });

  it("leaves the cursor where it was when Wikidata fails", async () => {
    await upsertMediaItem(db, gameItem({ id: 301, name: "A", slug: "a" }));
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("down", { status: 500 }));
    await expect(runWikidataPeopleStep(env, 5)).rejects.toThrow();
    expect(await cursor()).toBeNull();
  });
});
