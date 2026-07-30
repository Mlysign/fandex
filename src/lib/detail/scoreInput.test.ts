import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run } from "@/lib/db";
import { mergeLinks } from "@/lib/merge";
import { extractFacets } from "@/lib/facets";
import { linksForScoring, loadLinks } from "./enrich";
import type { MediaLink } from "@/types";

// 2026-07-30 — /api/detail scored the links array it had in hand, which by the
// time it scores is a strictly different set from what the catalog holds:
// ensureTmdbDetail/ensureGameDetail mutate entries IN PLACE, and
// enrichMissingSources PUSHES title-matched sources that are never written to
// the DB. So the detail page's score came from facets no other surface could
// see, and disagreed with Home/Library/facet pages for the same item — visible
// once the raw-sum aggregate stopped dividing facet count back out.
//
// These pin the input, not the arithmetic: the score's own maths is covered by
// fandexScore.test.ts.

initDb();

const ITEM = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  run("DELETE FROM media_items");
});

function seedPersistedMovie() {
  run(
    `INSERT INTO media_items (id, type, title, norm_title) VALUES (?, 'movie', 'Spirited Away', 'spirited away')`,
    [ITEM]
  );
  run(
    `INSERT INTO media_links (id, media_item_id, source, source_id, title, raw_data, projection_version)
     VALUES (?, ?, 'tmdb', '129', 'Spirited Away', ?, 2)`,
    [
      `${ITEM}-tmdb`,
      ITEM,
      JSON.stringify({
        id: 129,
        title: "Spirited Away",
        genres: [{ name: "Animation" }, { name: "Fantasy" }],
        keywords: { keywords: [{ name: "spirit" }, { name: "bathhouse" }] },
      }),
    ]
  );
}

const facetsOf = (links: MediaLink[]) =>
  extractFacets(links, "movie", mergeLinks(links, "movie", "DE"))
    .map((f) => `${f.kind}:${f.key}`)
    .sort();

describe("linksForScoring", () => {
  it("reads the persisted links for a stored item, ignoring in-memory mutation", () => {
    seedPersistedMovie();
    const live = loadLinks(ITEM);

    // Simulate what ensureTmdbDetail does before scoring: mutate rawData in place.
    live[0].rawData = { ...live[0].rawData, genres: [{ name: "Horror" }] };

    const scored = linksForScoring(ITEM, live);
    expect(scored[0].rawData.genres).toEqual([{ name: "Animation" }, { name: "Fantasy" }]);
    expect(facetsOf(scored)).not.toContain("tag:horror");
  });

  it("drops a source enrichMissingSources pushed but never persisted", () => {
    seedPersistedMovie();
    const live = loadLinks(ITEM);

    // enrichMissingSources does exactly this — links.push(toMediaLink(...)) with
    // no DB write. Its facets must not reach the score, or the detail page
    // scores something the catalog cannot.
    live.push({
      id: "in-memory-only",
      mediaItemId: ITEM,
      source: "rawg",
      sourceId: "999",
      title: "Spirited Away",
      releaseDate: null,
      rawData: { id: 999, name: "Spirited Away", tags: [{ name: "Unpersisted Tag" }] },
      lastSynced: null,
      projectionVersion: 2,
    } as MediaLink);

    const scored = linksForScoring(ITEM, live);
    expect(scored.map((l) => l.source)).toEqual(["tmdb"]);
    expect(facetsOf(scored)).not.toContain("tag:unpersisted tag");
  });

  it("produces the same facet set the catalog would, for the same item", () => {
    seedPersistedMovie();
    const live = loadLinks(ITEM);
    live[0].rawData = { ...live[0].rawData, genres: [{ name: "Horror" }] };

    // What a catalog-backed surface sees, vs what /api/detail now scores.
    expect(facetsOf(linksForScoring(ITEM, live))).toEqual(facetsOf(loadLinks(ITEM)));
  });

  it("falls back to the live links for an item with no persisted row", () => {
    const live = loadLinks(ITEM); // empty — nothing seeded
    expect(linksForScoring(null, live)).toBe(live);
  });
});
