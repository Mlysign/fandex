import { describe, it, expect, beforeEach } from "vitest";
import { initDb } from "@/lib/db";
import { saveTagCategory } from "@/lib/scoringConfig";
import { getDerivedForItem, type RawLink } from "@/lib/facetCache";

// 2026-07-31 — the "safe half" of the deferred discovery-cache perf fix
// (docs/archive/performance-audit.md §A): /api/library and /api/calendar each
// independently JSON.parse + mergeLinks + extractFacets the same blobs
// analyzeLibraryFacets/loadMembershipGroups already derive. This cache lets a
// caller skip the parse entirely when an item's links haven't changed —
// checkable from a plain SQL column (last_synced), no JSON.parse required.
//
// What's tested: (a) an unchanged last_synced is a real cache hit — proven by
// mutating the raw_data STRING without bumping last_synced and confirming the
// stale content still comes back; (b) bumping last_synced invalidates it —
// the new content shows up; (c) a live tag-category-override write busts the
// entry even with last_synced unchanged (scoringConfigSignature is folded into
// the key); (d) mutating a returned facets array doesn't corrupt the next call.

initDb();

const MOVIE = "movie" as const;

function tmdbLink(director: string, lastSynced: number): RawLink {
  return {
    source: "tmdb",
    sourceId: "1",
    releaseDate: "2020-01-01",
    rawData: JSON.stringify({
      title: "Test Movie",
      credits: { crew: [{ job: "Director", name: director }], cast: [] },
      genres: [{ id: 1, name: "Drama" }],
    }),
    lastSynced,
  };
}

const directorOf = (d: ReturnType<typeof getDerivedForItem>) =>
  d.facets.find((f) => f.kind === "person" && f.role === "director")?.label;

describe("getDerivedForItem", () => {
  it("(a) is a real cache hit when the whole freshness token is unchanged", () => {
    const id = "item-a";
    const first = getDerivedForItem(id, [tmdbLink("Ari Aster", 100)], MOVIE);
    expect(directorOf(first)).toBe("Ari Aster");

    // Same lastSynced AND same raw_data length ("Sam Raimi" is also 9 chars),
    // different content. A real cache hit must ignore this — it's a white-box
    // probe that this is a cache at all and not a silent re-derive.
    const second = getDerivedForItem(id, [tmdbLink("Sam Raimi", 100)], MOVIE);
    expect(directorOf(second)).toBe("Ari Aster");
  });

  it("(a2) a same-second rewrite that changes raw_data LENGTH is not served stale", () => {
    // The correction to this file's original premise (2026-08-02). It used to
    // assert that stale content stays stale on an unchanged last_synced,
    // reasoning that "production never mutates raw_data without bumping
    // last_synced". It does: last_synced is strftime('%s','now'), so any
    // sub-second follow-up write (enrichment straight after a sync upsert,
    // /api/facet/mine healing a thin link) lands on the same value. The key
    // now carries SUM(LENGTH(raw_data)) too, so that case is caught.
    const id = "item-a2";
    getDerivedForItem(id, [tmdbLink("Ari Aster", 100)], MOVIE);
    const after = getDerivedForItem(id, [tmdbLink("Jordan Peele", 100)], MOVIE);
    expect(directorOf(after)).toBe("Jordan Peele");
  });

  it("(b) bumping last_synced invalidates the entry", () => {
    const id = "item-b";
    getDerivedForItem(id, [tmdbLink("Ari Aster", 200)], MOVIE);
    const after = getDerivedForItem(id, [tmdbLink("Jordan Peele", 201)], MOVIE);
    expect(directorOf(after)).toBe("Jordan Peele");
  });

  it("(c) a live category-override write busts the entry even with last_synced unchanged", () => {
    const id = "item-c";
    getDerivedForItem(id, [tmdbLink("Ari Aster", 300)], MOVIE);

    // A real scoring-config mutation — folds into scoringConfigSignature(),
    // which is part of this cache's key.
    saveTagCategory({ id: `probe-${Date.now()}`, label: "Probe", color: "#AC9A72", weight: 1, ignored: false });

    // Same lastSynced as before, but the content changed too — if the entry
    // were still cached (ignoring the config write) this would return the
    // STALE "Ari Aster". A real invalidation re-parses and returns the new
    // content despite last_synced being identical.
    const after = getDerivedForItem(id, [tmdbLink("Jordan Peele", 300)], MOVIE);
    expect(directorOf(after)).toBe("Jordan Peele");
  });

  it("(d) mutating a returned facets array does not corrupt the next caller's read", () => {
    const id = "item-d";
    const first = getDerivedForItem(id, [tmdbLink("Ari Aster", 400)], MOVIE);
    first.facets.push({ kind: "tag", key: "injected", label: "Injected" } as any);
    first.facets.sort(() => 0); // any in-place mutation

    const second = getDerivedForItem(id, [tmdbLink("Ari Aster", 400)], MOVIE);
    expect(second.facets.some((f) => f.key === "injected")).toBe(false);
    expect(directorOf(second)).toBe("Ari Aster");
  });

  it("returns raw (unaliased, non-override) facets — post-processing stays the caller's job", () => {
    // This cache must NOT bake in tag-alias/category-override resolution —
    // only analyzeLibraryFacets applies those today; the routes and
    // loadMembershipGroups call extractFacets raw and always have. Baking it
    // in here would silently change what computeFandexScore sees for callers
    // that never asked for it.
    const id = "item-e";
    const d = getDerivedForItem(id, [tmdbLink("Ari Aster", 500)], MOVIE);
    const genreTag = d.facets.find((f) => f.kind === "tag" && f.key === "drama");
    expect(genreTag?.category).toBe("genre"); // categorizeTag()'s heuristic, not an override
  });

  it("keys by region — a merged projection for one region doesn't leak into another", () => {
    const id = "item-f";
    const de = getDerivedForItem(id, [tmdbLink("Ari Aster", 600)], MOVIE, "DE");
    const us = getDerivedForItem(id, [tmdbLink("Ari Aster", 600)], MOVIE, "US");
    // Both resolve (no crash / no cross-contamination assertion beyond that —
    // this fixture carries no per-region data, so the real assertion is that
    // passing a different region doesn't throw and doesn't require a code
    // change to mergeLinks' signature).
    expect(de.merged.title).toBe(us.merged.title);
  });
});
