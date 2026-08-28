import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run, query } from "./db";
import { upsertMediaItem } from "./matcher";
import { getDerivedForItem, peekDerived, derivedSignature, type RawLink } from "./facetCache";
import type { MediaLink } from "@/types";

// 2026-08-28 — the facet cache's freshness token is (MAX(last_synced),
// SUM(OCTET_LENGTH(raw_data))), and the ONLY thing that makes it work is that
// SQL and JavaScript compute the same number for the same payload.
//
// They did not. It was SQL `LENGTH()` against JS `.length` from the day the
// two-pass read was written, and those count different things: SQLite counts
// CODE POINTS in a TEXT value, JavaScript counts UTF-16 CODE UNITS. Every
// payload carrying an astral character — an emoji in an overview, a
// mathematical-alphanumeric letter in a title — made them disagree by one per
// character, so `peekDerived` looked under a key `getDerivedForItem` would
// never write. Measured on the real database: **56 of 7,006 links, 55 items,
// which had never once hit this cache** and were re-read, re-parsed and
// re-merged on every pool rebuild and every library analysis.
//
// Nothing caught it because a permanent cache miss has no symptom. The result
// is correct every time; it just costs what the cache was built to save.
//
// So this file asserts the agreement itself, against real SQL, rather than
// asserting the derivation (facetCache.test.ts already does that).

initDb();

const MOVIE = "movie" as const;

// An overview with an emoji and a mathematical-alphanumeric run, which is the
// real shape: tmdb:1101383 carries 🦖🍿, tmdb:1423191 carries 𝚃𝚑𝚒𝚗𝚐𝚜.
const ASTRAL = "A 🦖 movie about 𝚃𝚑𝚒𝚗𝚐𝚜 🍿";

const payload = (overview: string) => ({
  id: 1, title: "Astral", release_date: "2025-01-01", overview,
  credits: { crew: [{ job: "Director", name: "Greta Gerwig" }], cast: [] },
  genres: [{ id: 1, name: "Drama" }],
});

interface LinkRow { source: string; source_id: string; release_date: string | null; raw_data: string; last_synced: number; sql_len: number }

/** Exactly what a peeking caller's pass-1 SELECT reads, and nothing more. */
function readLinks(mediaItemId: string) {
  const rows = query<LinkRow>(
    `SELECT source, source_id, release_date, raw_data, last_synced,
            OCTET_LENGTH(raw_data) AS sql_len
       FROM media_links WHERE media_item_id = ?`,
    [mediaItemId]
  );
  const rawLinks: RawLink[] = rows.map((r) => ({
    source: r.source as MediaLink["source"], sourceId: r.source_id,
    releaseDate: r.release_date, rawData: r.raw_data, lastSynced: r.last_synced ?? 0,
  }));
  return {
    rawLinks,
    maxSynced: rows.reduce((m, r) => Math.max(m, r.last_synced ?? 0), 0),
    sqlLen: rows.reduce((n, r) => n + (r.sql_len ?? 0), 0),
    rows,
  };
}

beforeEach(() => {
  run("DELETE FROM media_items");
});

describe("facet cache freshness token — SQL and JS must agree", () => {
  it("hits the cache for a payload carrying astral characters", () => {
    const id = upsertMediaItem({
      source: "tmdb", sourceId: "900", type: MOVIE, title: "Astral",
      releaseDate: "2025-01-01", rawData: payload(ASTRAL),
    });
    const { rawLinks, maxSynced, sqlLen } = readLinks(id);
    const sig = derivedSignature();

    // Cold: nothing derived yet, so the peek must miss and the caller pays.
    expect(peekDerived(id, maxSynced, sqlLen, undefined, sig)).toBeUndefined();
    getDerivedForItem(id, rawLinks, MOVIE, undefined, sig);

    // Warm: THE assertion. The key SQL builds has to be the key JS wrote under.
    const hit = peekDerived(id, maxSynced, sqlLen, undefined, sig);
    expect(hit).toBeDefined();
    expect(hit!.facets.find((f) => f.role === "director")?.label).toBe("Greta Gerwig");
  });

  it("hits the cache for a plain ASCII payload too", () => {
    // The control. This one passed before the fix as well, which is exactly why
    // the bug survived: the common case was always fine.
    const id = upsertMediaItem({
      source: "tmdb", sourceId: "901", type: MOVIE, title: "Plain",
      releaseDate: "2025-01-01", rawData: payload("A movie about things"),
    });
    const { rawLinks, maxSynced, sqlLen } = readLinks(id);
    const sig = derivedSignature();
    getDerivedForItem(id, rawLinks, MOVIE, undefined, sig);
    expect(peekDerived(id, maxSynced, sqlLen, undefined, sig)).toBeDefined();
  });

  it("OCTET_LENGTH equals Buffer.byteLength, and LENGTH does not", () => {
    // The mechanism, stated directly, so a future "tidy this back to LENGTH()"
    // has to argue with a red test rather than with a comment.
    const id = upsertMediaItem({
      source: "tmdb", sourceId: "902", type: MOVIE, title: "Astral",
      releaseDate: "2025-01-01", rawData: payload(ASTRAL),
    });
    const r = query<{ raw_data: string; chars: number; bytes: number }>(
      `SELECT raw_data, LENGTH(raw_data) AS chars, OCTET_LENGTH(raw_data) AS bytes
         FROM media_links WHERE media_item_id = ?`, [id]
    )[0];
    expect(r.bytes).toBe(Buffer.byteLength(r.raw_data, "utf8"));
    expect(r.chars).not.toBe(r.raw_data.length);
  });

  it("still notices a same-second rewrite, which is what the length is FOR", () => {
    // last_synced is strftime('%s','now'), so two writes inside one second are
    // indistinguishable by it alone. The byte count is the half that catches
    // them, and it has to keep doing that after the change.
    const id = upsertMediaItem({
      source: "tmdb", sourceId: "903", type: MOVIE, title: "Astral",
      releaseDate: "2025-01-01", rawData: payload(ASTRAL),
    });
    const sig = derivedSignature();
    const first = readLinks(id);
    getDerivedForItem(id, first.rawLinks, MOVIE, undefined, sig);

    run(
      `UPDATE media_links SET raw_data = ? WHERE media_item_id = ?`,
      [JSON.stringify({ ...payload(`${ASTRAL} and more 🎬`), credits: { crew: [{ job: "Director", name: "Ari Aster" }], cast: [] } }), id]
    );
    const second = readLinks(id);
    expect(second.maxSynced).toBe(first.maxSynced); // same second, by construction
    expect(peekDerived(id, second.maxSynced, second.sqlLen, undefined, sig)).toBeUndefined();
    expect(getDerivedForItem(id, second.rawLinks, MOVIE, undefined, sig)
      .facets.find((f) => f.role === "director")?.label).toBe("Ari Aster");
  });
});
