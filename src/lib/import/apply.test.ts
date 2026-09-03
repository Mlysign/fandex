import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDb, run, get, query } from "@/lib/db";
import { upsertMediaItem } from "@/lib/matcher";
import { matchLocally } from "./match";
import { applyImport } from "./apply";
import {
  stageImport, readStagedImport, discardStagedImport, sweepStaging, stagingStats,
  StagingFullError, MAX_ROWS_PER_IMPORT, startStagingSweep, stopStagingSweep,
} from "./staging";
import type { ImportRow } from "./parse";

initDb();

const USER = "u-import";

const row = (p: Partial<ImportRow> & { title: string }): ImportRow => ({
  year: null, rating: null, relation: "library", imdbId: null, ratedAt: null, ...p,
});

beforeEach(() => {
  run("DELETE FROM user_item_state");
  run("DELETE FROM media_links");
  run("DELETE FROM media_items");
  run("DELETE FROM import_staging");
  run("DELETE FROM users");
  run("INSERT INTO users (id) VALUES (?)", [USER]);
});

afterEach(() => stopStagingSweep());

/**
 * A catalog row as a real sync would leave it: browsed = 0.
 *
 * ⚠️ The title and release date have to be in `rawData` in the SOURCE's own
 * shape, not just in the top-level fields: upsertMediaItem stores the merge
 * PROJECTION, so a payload without them lands as "Unknown" with a null date and
 * every title match then misses. `seq` keeps (source, source_id) unique, which
 * matters for the ambiguity cases below where two rows share a title.
 */
let seq = 0;
function catalogItem(title: string, year: string, imdb?: string): string {
  const sourceId = `tmdb-${++seq}`;
  const id = upsertMediaItem({
    source: "tmdb", sourceId, type: "movie", title,
    releaseDate: `${year}-01-01`,
    rawData: { id: seq, title, release_date: `${year}-01-01` },
  });
  if (imdb) {
    run(
      `INSERT INTO media_links (id, media_item_id, source, source_id, media_type, raw_data)
       VALUES (?, ?, 'imdb', ?, 'movie', '{}')`,
      [`lnk-${imdb}-${seq}`, id, imdb],
    );
  }
  return id;
}

describe("matchLocally — local first, and never a wrong guess", () => {
  it("matches on the IMDb id when the export carries one", () => {
    const id = catalogItem("Alien", "1979", "tt0078748");
    const out = matchLocally([row({ title: "Totally Different Title", imdbId: "tt0078748" })]);
    expect(out.rows[0].mediaItemId).toBe(id);
    expect(out.rows[0].how).toBe("imdb-id");
  });

  it("matches on title + year within a year either way", () => {
    const id = catalogItem("Alien", "1979");
    // Letterboxd and TMDB disagree by a year on plenty of titles (festival vs
    // wide release), which is why matcher.ts uses ±1 and this agrees with it.
    const out = matchLocally([row({ title: "alien", year: 1980 })]);
    expect(out.rows[0].mediaItemId).toBe(id);
    expect(out.rows[0].how).toBe("title-year");
  });

  it("REFUSES to guess when a title is ambiguous and no year separates them", () => {
    catalogItem("Dracula", "1931");
    catalogItem("Dracula", "1992");
    // 40 of 2,530 titles collide within a type in the real catalog (Dracula,
    // Nosferatu, Godzilla, The Lion King). Sending a rating to the wrong Dracula
    // is worse than reporting one row unmatched, so this stays unmatched.
    const out = matchLocally([row({ title: "Dracula" })]);
    expect(out.rows[0].mediaItemId).toBeNull();
    expect(out.rows[0].how).toBe("unmatched");
  });

  it("still resolves an ambiguous title when the year picks one out", () => {
    catalogItem("Dracula", "1931");
    const id92 = catalogItem("Dracula", "1992");
    const out = matchLocally([row({ title: "Dracula", year: 1992 })]);
    expect(out.rows[0].mediaItemId).toBe(id92);
  });

  it("counts what it could not resolve", () => {
    catalogItem("Alien", "1979");
    const out = matchLocally([row({ title: "Alien", year: 1979 }), row({ title: "Nothing Here" })]);
    expect(out.matchedLocally).toBe(1);
    expect(out.unmatched).toBe(1);
  });
});

describe("applyImport — the write path rules", () => {
  it("writes a rating and marks it watched", async () => {
    const id = catalogItem("Alien", "1979");
    const res = await applyImport(USER, [row({ title: "Alien", year: 1979, rating: 9 })]);

    expect(res.ratings).toBe(1);
    const state = get<{ rating: number; status: string }>(
      "SELECT rating, status FROM user_item_state WHERE user_id = ? AND media_item_id = ? AND relation = 'library'",
      [USER, id],
    );
    expect(state?.rating).toBe(9);
    expect(state?.status).toBe("watched");
  });

  it("writes a watchlist row for an unrated entry", async () => {
    const id = catalogItem("Solaris", "1972");
    const res = await applyImport(USER, [row({ title: "Solaris", year: 1972, relation: "wishlist" })]);
    expect(res.wishlist).toBe(1);
    const n = get<{ n: number }>(
      "SELECT COUNT(*) n FROM user_item_state WHERE user_id = ? AND media_item_id = ? AND relation = 'wishlist'",
      [USER, id],
    )?.n;
    expect(n).toBe(1);
  });

  // THE RULE THAT SURVIVES A DEPLOY. `browsed = 1` is what the boot prune
  // deletes, and it is default ON in prod. An imported library stamped browsed
  // would be cascaded away by the next deploy, which is the kind of data loss
  // that only shows up days later.
  it("never leaves an imported title flagged browsed", async () => {
    const id = catalogItem("Alien", "1979");
    run("UPDATE media_items SET browsed = 0 WHERE id = ?", [id]);
    await applyImport(USER, [row({ title: "Alien", year: 1979, rating: 8 })]);
    expect(get<{ browsed: number }>("SELECT browsed FROM media_items WHERE id = ?", [id])?.browsed).toBe(0);
  });

  it("does not invent catalog rows for titles it could not match", async () => {
    const before = get<{ n: number }>("SELECT COUNT(*) n FROM media_items")?.n;
    const res = await applyImport(USER, [row({ title: "Not In The Catalog", year: 1999, rating: 7 })]);
    expect(get<{ n: number }>("SELECT COUNT(*) n FROM media_items")?.n).toBe(before);
    expect(res.imported).toBe(0);
    expect(res.unmatched).toBe(1);
  });

  it("reports the unmatched titles rather than dropping them quietly", async () => {
    const res = await applyImport(USER, [row({ title: "Ghost Film", year: 1999, rating: 7 })]);
    expect(res.unmatchedTitles).toContain("Ghost Film (1999)");
  });

  it("caps the returned list but keeps the COUNT exact", async () => {
    const many = Array.from({ length: 150 }, (_, i) => row({ title: `Missing ${i}`, year: 2000 + (i % 20) }));
    const res = await applyImport(USER, many);
    expect(res.unmatched).toBe(150);        // exact
    expect(res.unmatchedTitles).toHaveLength(100);  // bounded
  });
});

describe("import staging — bounded three ways, because of facet_page_cache", () => {
  it("round-trips a parsed import through a token", () => {
    const staged = stageImport("letterboxd", [row({ title: "Alien", year: 1979, rating: 9 })]);
    const back = readStagedImport(staged.token);
    expect(back?.source).toBe("letterboxd");
    expect(back?.rows[0].title).toBe("Alien");
  });

  it("returns nothing for an unknown token", () => {
    expect(readStagedImport("nope")).toBeNull();
  });

  it("refuses an import past the per-import row ceiling", () => {
    const huge = Array.from({ length: MAX_ROWS_PER_IMPORT + 1 }, (_, i) => row({ title: `T${i}` }));
    expect(() => stageImport("letterboxd", huge)).toThrow(StagingFullError);
  });

  // Evicting by WRITE time is the whole design. Tracking read time turns every
  // cache hit into a write, which is the shape that grew facet_page_cache to
  // 80% of the database.
  it("expires by write time, and an expired row reads as missing before any sweep", () => {
    const staged = stageImport("letterboxd", [row({ title: "Alien" })]);
    run("UPDATE import_staging SET created_at = created_at - 90000 WHERE token = ?", [staged.token]);
    expect(readStagedImport(staged.token)).toBeNull();
  });

  it("sweeps expired rows in bounded batches", () => {
    // ⚠️ Stage everything BEFORE ageing any of it. stageImport sweeps on write,
    // so ageing each row inside the loop would let the next stageImport collect
    // it and leave only one expired row to find.
    const fresh = stageImport("letterboxd", [row({ title: "Keep" })]);
    const doomed: string[] = [];
    for (let i = 0; i < 5; i++) doomed.push(stageImport("letterboxd", [row({ title: `T${i}` })]).token);
    run(
      `UPDATE import_staging SET created_at = created_at - 90000 WHERE token IN (${doomed.map(() => "?").join(",")})`,
      doomed,
    );

    expect(sweepStaging(2)).toBe(2);          // bounded, not all five at once
    expect(sweepStaging(2)).toBe(2);
    expect(sweepStaging(2)).toBe(1);
    expect(sweepStaging(2)).toBe(0);          // and it converges
    expect(readStagedImport(fresh.token)).not.toBeNull();  // the fresh one survives
    expect(stagingStats().entries).toBe(1);
  });

  it("discards a claimed import so it cannot be applied twice", () => {
    const staged = stageImport("letterboxd", [row({ title: "Alien" })]);
    discardStagedImport(staged.token);
    expect(readStagedImport(staged.token)).toBeNull();
  });

  // A boot-only sweep never runs on a process that stays up for days, which is
  // exactly how facet_page_cache grew unattended.
  it("runs on an interval rather than only at boot, and does not hold the process open", () => {
    startStagingSweep(60_000);
    startStagingSweep(60_000);   // idempotent
    stopStagingSweep();
    expect(true).toBe(true);
  });
});

describe("the imdb pseudo-source, which is what makes an IMDb import cheap", () => {
  it("resolves through the media_links row rather than a new column", () => {
    const id = catalogItem("Alien", "1979", "tt0078748");
    // The lookup rides the EXISTING UNIQUE(source, source_id) index, so no
    // schema was added for it beyond the rows themselves.
    const link = get<{ media_item_id: string }>(
      "SELECT media_item_id FROM media_links WHERE source = 'imdb' AND source_id = ?", ["tt0078748"],
    );
    expect(link?.media_item_id).toBe(id);
    expect(query("SELECT 1 FROM media_links WHERE source = 'imdb'").length).toBe(1);
  });
});
