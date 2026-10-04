import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetBreakers } from "@/lib/http";
import { kvSet } from "../src/budget";
import { upsertMediaItem } from "../src/catalog/ingest";
import { exportTables, runExportStep, runTmdbRefreshStep, TMDB_REFRESH_AFTER_DAYS } from "../src/cron";
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
    expect(parts).toHaveLength(3);
    const seen = new Set<string>();
    for (const p of parts) for (const r of await readJson(p)) seen.add(r.path_key);
    expect(seen.size).toBe(2350);
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

  it("keeps the stored data when a refresh fails, and moves the link back in the queue", async () => {
    const { id } = await upsertMediaItem(db, movieItem());
    await age("603", OLD);
    const before = await db.prepare("SELECT raw_data FROM media_links WHERE source_id = '603'").first<{ raw_data: string }>();

    tmdb({ "/3/movie/603": () => new Response("{}", { status: 404 }) });
    expect(await runTmdbRefreshStep(env, NOW)).toEqual({ refreshed: 0, failed: 1 });

    const after = await db.prepare("SELECT raw_data, last_synced FROM media_links WHERE source_id = '603'").first<{ raw_data: string; last_synced: number }>();
    // A failed refresh must never overwrite a stored blob with nothing.
    expect(after!.raw_data).toBe(before!.raw_data);
    expect((await db.prepare("SELECT title FROM media_items WHERE id = ?").bind(id).first<{ title: string }>())!.title).toBe("The Matrix");
    // No longer the oldest, so a title TMDB deleted cannot block the queue.
    expect(after!.last_synced).toBeGreaterThan(OLD);
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
});
