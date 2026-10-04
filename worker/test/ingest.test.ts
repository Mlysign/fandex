import { beforeEach, describe, expect, it } from "vitest";
import { linkSourceToItem, upsertMediaItem } from "../src/catalog/ingest";
import { count, db, gameItem, movieItem, showItem, wipe } from "./helpers";

// The catalog write path. Each test here is a rule from src/lib/matcher.ts that
// has to survive the move to D1, where there is no transaction to lean on.

beforeEach(wipe);

const itemRow = (id: string) =>
  db.prepare("SELECT * FROM media_items WHERE id = ?").bind(id).first<Record<string, any>>();
const docRow = (id: string) =>
  db.prepare("SELECT * FROM item_doc WHERE media_item_id = ?").bind(id).first<Record<string, any>>();

describe("creating an item", () => {
  it("writes the item, its link, its doc and its cross ids in one go", async () => {
    const res = await upsertMediaItem(db, movieItem());
    expect(res.created).toBe(true);

    const item = await itemRow(res.id);
    expect(item).toMatchObject({
      type: "movie", title: "The Matrix", norm_title: "the matrix", release_date: "1999-03-31",
      slug: "the-matrix", browsed: 0, vote_count: 25000,
    });
    expect(item!.poster_url).toContain("/matrix.jpg");
    // 0-10, not the 0-100 communityAvg. Storing the wrong one doubles every rating.
    expect(item!.vote_average).toBeCloseTo(8.2, 1);

    expect(await count("media_links", "media_item_id = ?", [res.id])).toBe(1);
    const ext = await db.prepare("SELECT source, external_id FROM media_external_ids WHERE media_item_id = ?").bind(res.id).all();
    expect(ext.results).toEqual([{ source: "tmdb", external_id: "603" }]);
  });

  it("stores what a client is served, already serialised", async () => {
    const { id } = await upsertMediaItem(db, movieItem());
    const doc = await docRow(id);

    const vector = JSON.parse(doc!.vector);
    expect(vector).toMatchObject({
      id, type: "movie", title: "The Matrix", slug: "the-matrix", year: 1999,
      communityVotes: 25000, runtimeMinutes: 136,
      sources: [{ source: "tmdb", sourceId: "603" }],
    });
    // The vector is the scalar half. Facets travel beside it, raw.
    expect(vector.facets).toBeUndefined();

    const facets = JSON.parse(doc!.facets) as { kind: string; key: string; role?: string }[];
    const ids = facets.map((f) => `${f.kind}|${f.role ?? ""}|${f.key}`);
    expect(ids).toContain("person|director|lana wachowski");
    expect(ids).toContain("person|cast|keanu reeves");
    expect(ids).toContain("company|studio|warner bros");
    // The franchise words are peeled, which is what joins a film to its games.
    expect(ids).toContain("ip|ip|the matrix");
    expect(ids.some((i) => i.startsWith("tag||"))).toBe(true);

    const merged = JSON.parse(doc!.merged);
    expect(merged.title).toBe("The Matrix");
    // Identity only. The provider blob must never ride along in a served doc.
    expect(merged.sources).toEqual([{ source: "tmdb", sourceId: "603" }]);
  });

  it("marks an on-demand row as outside the pool, and only on create", async () => {
    const browsed = await upsertMediaItem(db, movieItem(), { browsed: 1 });
    expect((await itemRow(browsed.id))!.browsed).toBe(1);

    // A row already in the pool is never demoted by someone resolving it again.
    const pooled = await upsertMediaItem(db, gameItem());
    await upsertMediaItem(db, gameItem({ summary: "changed" }), { browsed: 1 });
    expect((await itemRow(pooled.id))!.browsed).toBe(0);
  });
});

describe("identity", () => {
  it("keeps a film and a show apart when they share a provider id", async () => {
    // TMDB numbers films and shows in separate sequences. 603 is both.
    const film = await upsertMediaItem(db, movieItem());
    const show = await upsertMediaItem(db, showItem());
    expect(show.created).toBe(true);
    expect(show.id).not.toBe(film.id);
    expect((await itemRow(film.id))!.title).toBe("The Matrix");
    expect((await itemRow(show.id))!.title).toBe("Deadwood");
    expect(await count("media_links")).toBe(2);
  });

  it("finds the same link again instead of creating a second item", async () => {
    const first = await upsertMediaItem(db, movieItem());
    const again = await upsertMediaItem(db, movieItem({ vote_count: 26000 }));
    expect(again).toEqual({ id: first.id, created: false });
    expect(await count("media_items")).toBe(1);
    expect((await itemRow(first.id))!.vote_count).toBe(26000);
  });

  it("joins a second source to the item by cross id, whatever the titles say", async () => {
    const tmdb = await upsertMediaItem(db, movieItem());
    const trakt = await upsertMediaItem(db, {
      source: "trakt", sourceId: "481", type: "movie", title: "Matrix, The", releaseDate: "1999-03-31",
      rawData: { title: "Matrix, The", year: 1999, ids: { trakt: 481, tmdb: 603 } },
    });
    expect(trakt).toEqual({ id: tmdb.id, created: false });
    expect(await count("media_links", "media_item_id = ?", [tmdb.id])).toBe(2);
    // TMDB outranks Trakt for the title, so the better one survives the merge.
    expect((await itemRow(tmdb.id))!.title).toBe("The Matrix");
  });

  it("does not fold two different works that share a title and a year", async () => {
    const one = await upsertMediaItem(db, movieItem({ id: 1, title: "Dracula", release_date: "1992-11-13" }));
    const other = await upsertMediaItem(db, movieItem({ id: 2, title: "Dracula", release_date: "1992-06-01" }));
    // Same normalised title, same year, but a conflicting tmdb id: a different work.
    expect(other.created).toBe(true);
    expect(other.id).not.toBe(one.id);
  });

  it("matches on title and year when the ids cannot disagree", async () => {
    const tmdb = await upsertMediaItem(db, movieItem({ belongs_to_collection: null }));
    // A Letterboxd-shaped payload with no tmdb link: nothing conflicts, so the
    // title + year fallback is allowed to find the existing film.
    const lb = await upsertMediaItem(db, {
      source: "letterboxd", sourceId: "abc", type: "movie", title: "The Matrix", releaseDate: "1999-01-01",
      rawData: { id: "abc", name: "The Matrix", releaseYear: 1999 },
    });
    expect(lb.id).toBe(tmdb.id);
  });

  it("creates ONE item when two requests resolve the same new title at once", async () => {
    const results = await Promise.all([
      upsertMediaItem(db, movieItem()),
      upsertMediaItem(db, movieItem()),
      upsertMediaItem(db, movieItem()),
    ]);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    // No orphan left behind by a batch that lost the race.
    expect(await count("media_items")).toBe(1);
    expect(await count("media_links")).toBe(1);
    expect(await count("item_doc")).toBe(1);
  });
});

describe("the thin-write rule", () => {
  it("never degrades a stored link", async () => {
    const full = await upsertMediaItem(db, movieItem());
    const before = await db.prepare("SELECT raw_data, projection_version FROM media_links").first<Record<string, any>>();

    const thin = await upsertMediaItem(db, { ...movieItem({ credits: undefined, keywords: undefined, overview: "" }), thin: true });
    expect(thin).toEqual({ id: full.id, created: false });

    const after = await db.prepare("SELECT raw_data, projection_version FROM media_links").first<Record<string, any>>();
    expect(after).toEqual(before);
  });

  it("stamps a list payload as version 0 so the first detail read refetches it", async () => {
    await upsertMediaItem(db, { ...movieItem(), thin: true });
    const link = await db.prepare("SELECT projection_version FROM media_links").first<{ projection_version: number }>();
    expect(link!.projection_version).toBe(0);
  });
});

describe("slugs", () => {
  it("gives the newcomer the year when a title is taken", async () => {
    const old = await upsertMediaItem(db, movieItem({ id: 10, title: "Nosferatu", release_date: "1922-03-04", belongs_to_collection: null }));
    const remake = await upsertMediaItem(db, movieItem({ id: 11, title: "Nosferatu", release_date: "2024-12-25", belongs_to_collection: null }));
    expect((await itemRow(old.id))!.slug).toBe("nosferatu");
    expect((await itemRow(remake.id))!.slug).toBe("nosferatu-2024");
  });

  it("lets a film and a show share a slug, because the type is in the url", async () => {
    const film = await upsertMediaItem(db, movieItem({ id: 20, title: "Fargo", release_date: "1996-03-08" }));
    const show = await upsertMediaItem(db, showItem({ id: 21, name: "Fargo", first_air_date: "2014-04-15" }));
    expect((await itemRow(film.id))!.slug).toBe("fargo");
    expect((await itemRow(show.id))!.slug).toBe("fargo");
  });

  it("never changes once assigned, even when the provider retitles the work", async () => {
    const { id } = await upsertMediaItem(db, movieItem());
    await upsertMediaItem(db, movieItem({ title: "The Matrix (Remastered)" }));
    const item = await itemRow(id);
    expect(item!.title).toBe("The Matrix (Remastered)");
    expect(item!.slug).toBe("the-matrix");
    expect(JSON.parse((await docRow(id))!.vector).slug).toBe("the-matrix");
  });
});

describe("re-deriving", () => {
  it("bumps updated_at so the delta sync carries the change", async () => {
    const { id } = await upsertMediaItem(db, movieItem());
    await db.prepare("UPDATE media_items SET updated_at = 1000 WHERE id = ?").bind(id).run();
    await upsertMediaItem(db, movieItem({ vote_count: 30000 }));
    expect((await itemRow(id))!.updated_at).toBeGreaterThan(1000);
    expect(JSON.parse((await docRow(id))!.vector).communityVotes).toBe(30000);
  });

  it("keeps detail-only fields when a sparser payload re-syncs over a richer one", async () => {
    const { id } = await upsertMediaItem(db, movieItem());
    // A later payload without credits must not erase the director. The key has
    // to be ABSENT, as it is in a list payload: a key present and undefined is
    // a payload saying "there are none".
    const sparse = movieItem();
    delete sparse.rawData.credits;
    await upsertMediaItem(db, sparse);
    const facets = JSON.parse((await docRow(id))!.facets) as { kind: string; role?: string; key: string }[];
    expect(facets.some((f) => f.kind === "person" && f.role === "director")).toBe(true);
  });

  it("drops a cross id its links no longer carry, and adds a new one", async () => {
    const { id } = await upsertMediaItem(db, movieItem());
    await linkSourceToItem(db, id, {
      source: "trakt", sourceId: "481", type: "movie", title: "The Matrix", releaseDate: "1999-03-31",
      rawData: { title: "The Matrix", ids: { trakt: 481, tmdb: 603 } },
    });
    const ext = await db.prepare("SELECT source, external_id FROM media_external_ids WHERE media_item_id = ? ORDER BY source").bind(id).all();
    expect(ext.results).toEqual([{ source: "tmdb", external_id: "603" }, { source: "trakt", external_id: "481" }]);
  });

  it("attaches a link by the TARGET's type, not the payload's", async () => {
    const { id } = await upsertMediaItem(db, showItem());
    // A mistyped enrich: the payload claims to be a movie, the target is a show.
    await linkSourceToItem(db, id, {
      source: "trakt", sourceId: "9", type: "movie", title: "Deadwood", releaseDate: null,
      rawData: { title: "Deadwood", ids: { trakt: 9 } },
    });
    const link = await db.prepare("SELECT media_type FROM media_links WHERE source = 'trakt'").first<{ media_type: string }>();
    expect(link!.media_type).toBe("show");
  });
});
