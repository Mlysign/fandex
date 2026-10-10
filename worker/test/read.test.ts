import { beforeEach, describe, expect, it } from "vitest";
import { upsertMediaItem } from "../src/catalog/ingest";
import { DERIVE_VERSION } from "../src/catalog/derive";
import {
  catalogDeltaJson, catalogPlatformsJson, itemDetailJson, parseCursor, parseItemIds, regionalReleaseDatesJson, RELEASE_DATES_MAX,
  RELEASE_DATES_SQL,
  showEpisodesJson, taxonomyJson,
} from "../src/catalog/read";
import { db, gameItem, movieItem, showItem, wipe } from "./helpers";

beforeEach(wipe);

describe("item detail", () => {
  it("serves one item by id and by type + slug, as valid JSON", async () => {
    const { id } = await upsertMediaItem(db, movieItem());

    const byId = JSON.parse((await itemDetailJson(db, { id }))!);
    expect(byId).toMatchObject({ id, type: "movie", slug: "the-matrix", inPool: true, region: "US", deriveVersion: DERIVE_VERSION });
    // The delta names the same rule, which is how the website's build knows a cached title is behind it.
    expect(JSON.parse(await catalogDeltaJson(db, parseCursor(null, null), 10)).deriveVersion).toBe(DERIVE_VERSION);
    expect(byId.vector.title).toBe("The Matrix");
    expect(byId.merged.description).toContain("hacker");
    expect(Array.isArray(byId.facets)).toBe(true);

    const bySlug = JSON.parse((await itemDetailJson(db, { type: "movie", slug: "the-matrix" }))!);
    expect(bySlug.id).toBe(id);
  });

  it("answers null for a title it does not hold, and for the wrong type", async () => {
    await upsertMediaItem(db, movieItem());
    expect(await itemDetailJson(db, { id: "00000000-0000-4000-8000-000000000000" })).toBeNull();
    expect(await itemDetailJson(db, { type: "show", slug: "the-matrix" })).toBeNull();
  });

  it("re-merges for another region, where the release date can differ", async () => {
    const { id } = await upsertMediaItem(db, movieItem({
      release_dates: {
        results: [
          { iso_3166_1: "US", release_dates: [{ release_date: "1999-03-31T00:00:00.000Z", type: 3 }] },
          { iso_3166_1: "DE", release_dates: [{ release_date: "1999-06-17T00:00:00.000Z", type: 3 }] },
        ],
      },
    }));
    const us = JSON.parse((await itemDetailJson(db, { id }, "US"))!);
    const de = JSON.parse((await itemDetailJson(db, { id }, "de"))!);
    expect(us.merged.releaseDate).toBe("1999-03-31");
    expect(de.region).toBe("DE");
    expect(de.merged.releaseDate).toBe("1999-06-17");
    // An unsupported region falls back to the default rather than erroring.
    expect(JSON.parse((await itemDetailJson(db, { id }, "ZZ"))!).region).toBe("US");
  });

  it("reports an on-demand row as outside the pool", async () => {
    const { id } = await upsertMediaItem(db, gameItem(), { browsed: 1 });
    expect(JSON.parse((await itemDetailJson(db, { id }))!).inPool).toBe(false);
  });

  it("re-merges a doc written under an older rule, for the default region too", async () => {
    const { id } = await upsertMediaItem(db, movieItem({ release_dates: { results: [usDates, deDates] } }));
    // What an older version of the merge left behind: a premiere as the US date.
    await db.prepare(
      "UPDATE item_doc SET merged = json_set(merged, '$.releaseDate', '1999-03-24'), derive_version = ? WHERE media_item_id = ?",
    ).bind(DERIVE_VERSION - 1, id).run();
    expect(JSON.parse((await itemDetailJson(db, { id }))!).merged.releaseDate).toBe("1999-03-31");

    // A current doc is served as stored: the default region costs no second query.
    await db.prepare("UPDATE item_doc SET derive_version = ? WHERE media_item_id = ?").bind(DERIVE_VERSION, id).run();
    expect(JSON.parse((await itemDetailJson(db, { id }))!).merged.releaseDate).toBe("1999-03-24");
  });
});

const day = (date: string, type: number) => ({ release_date: `${date}T00:00:00.000Z`, type });
const usDates = { iso_3166_1: "US", release_dates: [day("1999-03-24", 1), day("1999-03-31", 3)] };
const deDates = { iso_3166_1: "DE", release_dates: [day("1999-02-12", 1), day("1999-06-17", 3), day("1999-11-01", 4)] };

describe("release dates for a country", () => {
  it("lists a film whose date there differs, by its cinema date and not its premiere", async () => {
    const film = await upsertMediaItem(db, movieItem({ release_dates: { results: [usDates, deDates] } }));
    const de = JSON.parse(await regionalReleaseDatesJson(db, [film.id], "de"));
    expect(de).toEqual({ region: "DE", dates: { [film.id]: "1999-06-17" } });
    // The item page says the same day: one rule, two answers.
    expect(JSON.parse((await itemDetailJson(db, { id: film.id }, "DE"))!).merged.releaseDate).toBe("1999-06-17");
  });

  it("leaves out a film whose date is the one the device holds, a show, and an id nobody holds", async () => {
    const same = await upsertMediaItem(db, movieItem({ release_dates: { results: [usDates] } }));
    const bare = await upsertMediaItem(db, movieItem({ id: 604, title: "The Matrix Reloaded", release_date: "2003-05-15" }));
    const show = await upsertMediaItem(db, showItem());
    const ids = [same.id, bare.id, show.id, "00000000-0000-4000-8000-000000000000"];
    expect(JSON.parse(await regionalReleaseDatesJson(db, ids, "US")).dates).toEqual({});
    // Germany is not listed for either film, so the one date stands there too.
    expect(JSON.parse(await regionalReleaseDatesJson(db, ids, "DE")).dates).toEqual({});
  });

  it("keeps the original date when the country's entry is a re-release decades later", async () => {
    const film = await upsertMediaItem(db, movieItem({
      release_dates: { results: [{ iso_3166_1: "DE", release_dates: [day("2026-08-27", 2)] }] },
    }));
    expect(JSON.parse(await regionalReleaseDatesJson(db, [film.id], "DE")).dates).toEqual({});
  });

  it("reads a few rows per film asked about, not every TMDB link in the catalog", async () => {
    // D1 bills every row a query touches and stops ALL queries past the day's
    // allowance. Left to the planner, this query walked every TMDB link on each
    // call and spent that allowance in 35 calls (2026-10-10).
    const ids: string[] = [];
    for (let i = 0; i < 40; i++) {
      ids.push((await upsertMediaItem(db, movieItem({ id: 5000 + i, title: `Plan ${i}`, belongs_to_collection: null, external_ids: {} }))).id);
    }
    const asked = JSON.stringify(ids.slice(0, 3));

    const plan = await db.prepare(`EXPLAIN QUERY PLAN ${RELEASE_DATES_SQL}`).bind(asked, "DE").all<{ detail: string }>();
    const detail = plan.results.map((r) => r.detail).join(" | ");
    // From the id list inward: the list, then each item by its key, then its links by the item.
    expect(detail).toMatch(/^SCAN j .*\| SEARCH mi USING PRIMARY KEY \(id=\?\) \| SEARCH l USING INDEX idx_links_item/);

    const res = await db.prepare(RELEASE_DATES_SQL).bind(asked, "DE").all();
    expect(res.results).toHaveLength(3);
    // Forty films are stored and three were asked about. The planner's own order read 200 rows here.
    expect(res.meta.rows_read).toBeLessThanOrEqual(15);
  });

  it("takes only a list of item ids, and not more than the cap", () => {
    const id = "aaaaaaaa-0000-4000-8000-000000000001";
    expect(parseItemIds({ ids: [id, id.toUpperCase()] })).toEqual([id]);
    expect(parseItemIds({ ids: [] })).toBeNull();
    expect(parseItemIds({ ids: ["x'); DROP TABLE kv; --"] })).toBeNull();
    expect(parseItemIds({ ids: Array.from({ length: RELEASE_DATES_MAX + 1 }, () => id) })).toBeNull();
    expect(parseItemIds(null)).toBeNull();
  });
});

describe("the catalog delta", () => {
  async function seed(n: number, at: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const { id } = await upsertMediaItem(db, movieItem({ id: 1000 + i, title: `Film ${i}`, belongs_to_collection: null }));
      ids.push(id);
    }
    await db.prepare("UPDATE media_items SET updated_at = ?").bind(at).run();
    return ids;
  }

  it("pages through the pool without dropping or repeating a row", async () => {
    const ids = await seed(7, 5000);
    const seen: string[] = [];
    let cursor = parseCursor(null, null);
    for (let page = 0; page < 10; page++) {
      const res = JSON.parse(await catalogDeltaJson(db, cursor, 3));
      seen.push(...res.items.map((i: any) => i.vector.id));
      cursor = res.next;
      if (res.done) break;
    }
    // Every row once, even though all seven share ONE updated_at second: the
    // cursor is (updated_at, id), not updated_at alone.
    expect(seen.sort()).toEqual([...ids].sort());
  });

  it("serves only rows changed since the cursor", async () => {
    await seed(3, 5000);
    const caughtUp = JSON.parse(await catalogDeltaJson(db, parseCursor(null, null), 50));
    expect(caughtUp.items).toHaveLength(3);
    expect(caughtUp.done).toBe(true);

    // Nothing changed: an empty page, and the cursor does not move backwards.
    const again = JSON.parse(await catalogDeltaJson(db, caughtUp.next, 50));
    expect(again.items).toHaveLength(0);
    expect(again.next).toEqual(caughtUp.next);

    const changed = await upsertMediaItem(db, movieItem({ id: 1001, title: "Film 1", vote_count: 9, belongs_to_collection: null }));
    const delta = JSON.parse(await catalogDeltaJson(db, caughtUp.next, 50));
    expect(delta.items.map((i: any) => i.vector.id)).toEqual([changed.id]);
  });

  it("hands back a settled cursor when the page reaches the present", async () => {
    // Rows written this very second. A strictly-after cursor could miss a
    // sibling written in the same second, so the cursor steps back instead.
    await upsertMediaItem(db, movieItem());
    const res = JSON.parse(await catalogDeltaJson(db, parseCursor(null, null), 50));
    expect(res.items).toHaveLength(1);
    expect(res.next.after).toBe("");
    expect(res.next.since).toBeLessThan(res.serverTime);
    // And so the next sync re-reads it rather than skipping it.
    const again = JSON.parse(await catalogDeltaJson(db, res.next, 50));
    expect(again.items).toHaveLength(1);
  });

  it("leaves out rows nobody acted on, and counts the pool only when asked", async () => {
    await upsertMediaItem(db, movieItem());
    await upsertMediaItem(db, gameItem(), { browsed: 1 });
    const plain = JSON.parse(await catalogDeltaJson(db, parseCursor(null, null), 50));
    expect(plain.items).toHaveLength(1);
    expect(plain.poolCount).toBeNull();
    const counted = JSON.parse(await catalogDeltaJson(db, parseCursor(null, null), 50, true));
    expect(counted.poolCount).toBe(1);
  });

  it("seeks to the cursor instead of walking the index from the start", async () => {
    // D1 bills every row a query touches. The OR form of this predicate reads
    // the whole pool on every sync; the row-value form must stay a range seek.
    const plan = await db.prepare(
      `EXPLAIN QUERY PLAN
       SELECT mi.id FROM media_items mi JOIN item_doc d ON d.media_item_id = mi.id
        WHERE mi.browsed = 0 AND (mi.updated_at, mi.id) > (?1, ?2)
        ORDER BY mi.updated_at, mi.id LIMIT ?3`,
    ).bind(0, "", 10).all<{ detail: string }>();
    const detail = plan.results.map((r) => r.detail).join(" | ");
    expect(detail).toContain("idx_media_pool_updated");
    expect(detail).toMatch(/\(updated_at,id\)>\(\?,\?\)/);
    expect(detail).not.toContain("TEMP B-TREE");
  });
});

describe("taxonomy", () => {
  it("serves every table the device needs to score, and a stable etag", async () => {
    await db.batch([
      db.prepare("INSERT INTO tag_category (id, label, color, weight, sort_order) VALUES ('genre', 'Genre', '#fff', 1.5, 1)"),
      db.prepare("INSERT INTO tag_category_override (tag_key, category_id) VALUES ('sci fi', 'genre')"),
      db.prepare("INSERT INTO tag_alias (alias_key, canonical_key) VALUES ('scifi', 'sci fi')"),
      db.prepare("INSERT INTO ip_alias (alias_key, canonical_key) VALUES ('metal gear solid', 'metal gear')"),
      db.prepare("INSERT INTO item_ip_override (media_item_id, ip_key, label, mode) VALUES ('x', 'star wars', 'Star Wars', 'add')"),
      db.prepare("INSERT INTO facet_label_override (kind, key, label) VALUES ('tag', 'sci fi', 'Sci-Fi')"),
      db.prepare(`INSERT INTO scoring_config (id, config, version) VALUES (1, '{"priorStrength":5}', 3)`),
    ]);
    const a = await taxonomyJson(db);
    const t = JSON.parse(a.body);
    expect(t.tagCategories).toEqual([{ id: "genre", label: "Genre", color: "#fff", weight: 1.5, ignored: 0, sortOrder: 1 }]);
    expect(t.tagCategoryOverrides).toEqual([["sci fi", "genre"]]);
    expect(t.tagAliases).toEqual([["scifi", "sci fi"]]);
    expect(t.ipAliases).toEqual([["metal gear solid", "metal gear"]]);
    expect(t.itemIpOverrides[0]).toMatchObject({ ipKey: "star wars", mode: "add" });
    expect(t.facetLabels).toEqual([["tag", "sci fi", "Sci-Fi"]]);
    expect(t.scoring).toEqual({ config: { priorStrength: 5 }, version: 3 });

    expect((await taxonomyJson(db)).etag).toBe(a.etag);
    await db.prepare("INSERT INTO tag_alias (alias_key, canonical_key) VALUES ('sf', 'sci fi')").run();
    expect((await taxonomyJson(db)).etag).not.toBe(a.etag);
  });

  it("is valid JSON on an empty database", async () => {
    const t = JSON.parse((await taxonomyJson(db)).body);
    expect(t.tagCategories).toEqual([]);
    expect(t.scoring).toBeNull();
  });
});

describe("episodes", () => {
  it("serves stored seasons and episodes in order", async () => {
    const { id } = await upsertMediaItem(db, showItem());
    await db.batch([
      db.prepare("INSERT INTO show_seasons (media_item_id, season_number, name, episode_count) VALUES (?, 1, 'Season 1', 2)").bind(id),
      db.prepare("INSERT INTO show_episodes (media_item_id, season_number, episode_number, title) VALUES (?, 1, 2, 'Deep Water')").bind(id),
      db.prepare("INSERT INTO show_episodes (media_item_id, season_number, episode_number, title) VALUES (?, 1, 1, 'Deadwood')").bind(id),
    ]);
    const res = JSON.parse((await showEpisodesJson(db, id))!);
    expect(res.item).toEqual({ id, type: "show" });
    expect(res.seasons).toHaveLength(1);
    expect(res.episodes.map((e: any) => e.title)).toEqual(["Deadwood", "Deep Water"]);
  });

  it("answers null for an unknown item, and empty lists for one with nothing stored", async () => {
    expect(await showEpisodesJson(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
    const { id } = await upsertMediaItem(db, showItem());
    expect(JSON.parse((await showEpisodesJson(db, id))!)).toMatchObject({ seasons: [], episodes: [] });
  });
});

describe("where the pool can be played or watched", () => {
  const providers = (name: string) => ({ flatrate: [{ provider_id: 1, provider_name: name, logo_path: "/x.png" }], link: "https://example.test" });

  it("lists a game's platforms and a film's services for the country asked", async () => {
    const game = await upsertMediaItem(db, gameItem());
    const film = await upsertMediaItem(db, movieItem({ "watch/providers": { results: { DE: providers("WOW"), US: providers("Max") } } }));

    const de = JSON.parse((await catalogPlatformsJson(db, "DE"))!);
    expect(de.region).toBe("DE");
    expect(de.games[game.id]).toEqual(["PC (Microsoft Windows)"]);
    expect(de.streaming[film.id]).toEqual(["WOW"]);

    const us = JSON.parse((await catalogPlatformsJson(db, "US"))!);
    expect(us.streaming[film.id]).toEqual(["Max"]);
  });

  it("falls back to the US line-up, and leaves out a title with none", async () => {
    const film = await upsertMediaItem(db, movieItem({ "watch/providers": { results: { US: providers("Max") } } }));
    const bare = await upsertMediaItem(db, movieItem({ id: 604, title: "The Matrix Reloaded" }));
    const de = JSON.parse((await catalogPlatformsJson(db, "DE"))!);
    expect(de.streaming[film.id]).toEqual(["Max"]);
    expect(de.streaming[bare.id]).toBeUndefined();
  });

  it("builds a country once, and asks before building, not before reading back", async () => {
    await upsertMediaItem(db, movieItem({ "watch/providers": { results: { DE: providers("WOW") } } }));
    let asked = 0;
    const gate = async () => { asked++; return true; };
    const first = await catalogPlatformsJson(db, "DE", gate);
    // A title added after the build is not in the kept answer: that is the cache.
    await upsertMediaItem(db, movieItem({ id: 605, title: "Later", "watch/providers": { results: { DE: providers("Netflix") } } }));
    expect(await catalogPlatformsJson(db, "DE", gate)).toBe(first);
    expect(asked).toBe(1);
    // A refusal builds nothing and says so.
    expect(await catalogPlatformsJson(db, "FR", async () => false)).toBeNull();
  });

  it("treats an unknown country as the default one", async () => {
    expect(JSON.parse((await catalogPlatformsJson(db, "ZZ'); DROP TABLE kv; --"))!).region).toBe("US");
  });
});
