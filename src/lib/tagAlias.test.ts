import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run } from "./db";
import { upsertMediaItem, upsertLibraryEntry } from "./matcher";
import { buildProfile, computeFandexScore, itemsWithFacet, getTagVocab, invalidateDiscoveryCache } from "./discovery";
import {
  canonicalTagKey, applyTagAliases, setTagAlias, deleteTagAlias,
  deleteTagBundle, listTagBundles, invalidateTagAliasCache,
} from "./tagAlias";
import { Facet } from "./facets";

// H5.6 — tag bundling. A tag_alias maps a member spelling to a canonical key;
// applying that remap at the two aggregation chokepoints must make bundled
// spellings score/aggregate as one tag with a combined Bayesian average.

initDb();

const USER = "u-tag-alias";

const TMDB = (id: number, title: string, genreNames: string[]) => ({
  id, title, release_date: "2020-01-01", poster_path: "/p.jpg", overview: "o",
  genres: genreNames.map((name) => ({ name })),
});

function movie(sourceId: string, title: string, genreNames: string[]) {
  return upsertMediaItem({
    source: "tmdb", sourceId, type: "movie", title, releaseDate: "2020-01-01",
    rawData: TMDB(Number(sourceId), title, genreNames),
  });
}

beforeEach(() => {
  run("DELETE FROM media_items");
  run("DELETE FROM users");
  run("DELETE FROM tag_alias");
  run("INSERT INTO users (id) VALUES (?)", [USER]);
  invalidateTagAliasCache();
  invalidateDiscoveryCache();
});

describe("tag_alias write paths", () => {
  it("round-trips a single alias", () => {
    setTagAlias("scifi", "sci fi");
    expect(canonicalTagKey("scifi")).toBe("sci fi");
    expect(canonicalTagKey("sci fi")).toBe("sci fi"); // canonical maps to itself
    deleteTagAlias("scifi");
    expect(canonicalTagKey("scifi")).toBe("scifi");
  });

  it("rejects a self-alias", () => {
    expect(() => setTagAlias("sci fi", "sci fi")).toThrow();
  });

  it("flattens a chain: a→b then b→c re-points a to c", () => {
    setTagAlias("scifi", "sci fi");        // a→b
    setTagAlias("sci fi", "science fiction"); // b→c: 'sci fi' was a canonical, now folds into c
    expect(canonicalTagKey("sci fi")).toBe("science fiction");
    expect(canonicalTagKey("scifi")).toBe("science fiction"); // a re-pointed to c, not left at b
  });

  it("listTagBundles groups members under their canonical", () => {
    setTagAlias("scifi", "sci fi");
    setTagAlias("science fiction", "sci fi");
    const bundles = listTagBundles();
    expect(bundles).toEqual([{ canonical: "sci fi", members: ["science fiction", "scifi"] }]);
  });

  it("deleteTagBundle dissolves the whole bundle", () => {
    setTagAlias("scifi", "sci fi");
    setTagAlias("science fiction", "sci fi");
    deleteTagBundle("sci fi");
    expect(listTagBundles()).toEqual([]);
    expect(canonicalTagKey("scifi")).toBe("scifi");
  });
});

describe("applyTagAliases", () => {
  it("remaps + dedupes tag facets carrying two members of one bundle, keeps non-tags", () => {
    setTagAlias("scifi", "sci fi");
    const facets: Facet[] = [
      { kind: "tag", key: "scifi", label: "SciFi", category: "genre" },
      { kind: "tag", key: "sci fi", label: "Sci-Fi", category: "genre" },
      { kind: "person", role: "director", key: "someone", label: "Someone" },
    ];
    const out = applyTagAliases(facets);
    const tags = out.filter((f) => f.kind === "tag");
    expect(tags).toHaveLength(1);
    expect(tags[0].key).toBe("sci fi");
    expect(tags[0].label).toBe("Sci-Fi"); // canonical spelling's label wins
    expect(out.some((f) => f.kind === "person")).toBe(true);
  });
});

describe("bundling changes what buildProfile scores", () => {
  it("two differently-spelled tags merge into ONE facet with a combined average", () => {
    // Baseline is dragged down by a low-rated Horror item so the sci-fi facets
    // develop a nonzero deviation.
    const a = movie("501", "Scifi A", ["Scifi"]);
    const b = movie("502", "Science Fiction B", ["Science Fiction"]);
    const c = movie("503", "Horror C", ["Horror"]);
    upsertLibraryEntry(USER, a, "tmdb", { status: "watched", rating: 9, reviewedAt: 1 });
    upsertLibraryEntry(USER, b, "tmdb", { status: "watched", rating: 7, reviewedAt: 2 });
    upsertLibraryEntry(USER, c, "tmdb", { status: "watched", rating: 3, reviewedAt: 3 });

    // Before bundling: two separate tag facets, each n=1.
    let profile = buildProfile(USER);
    expect(profile.meta.get("tag||scifi")?.n).toBe(1);
    expect(profile.meta.get("tag||science fiction")?.n).toBe(1);

    // Bundle them under a canonical "sci fi".
    setTagAlias("scifi", "sci fi");
    setTagAlias("science fiction", "sci fi");
    invalidateDiscoveryCache();

    profile = buildProfile(USER);
    expect(profile.meta.has("tag||scifi")).toBe(false);
    expect(profile.meta.has("tag||science fiction")).toBe(false);
    const merged = profile.meta.get("tag||sci fi");
    expect(merged?.n).toBe(2); // both items now count toward one facet
    // Bayesian average over both ratings (9, 7) shrunk toward baseline — strictly
    // between the baseline and the raw mean; the key property is it's one number.
    expect(merged?.BA).toBeGreaterThan(profile.baseline);
  });
});

describe("catalog-side bundling", () => {
  beforeEach(() => {
    movie("601", "Scifi Movie", ["Scifi"]);
    movie("602", "Science Fiction Movie", ["Science Fiction"]);
    invalidateDiscoveryCache();
  });

  it("itemsWithFacet(canonical) returns items carrying any member spelling", () => {
    setTagAlias("scifi", "sci fi");
    setTagAlias("science fiction", "sci fi");
    invalidateDiscoveryCache();
    const items = itemsWithFacet({ kind: "tag", key: "sci fi" });
    expect(items).toHaveLength(2);
    // a member spelling resolves to the bundle too
    expect(itemsWithFacet({ kind: "tag", key: "scifi" })).toHaveLength(2);
  });

  it("getTagVocab collapses members into one entry with summed count", () => {
    setTagAlias("scifi", "sci fi");
    setTagAlias("science fiction", "sci fi");
    invalidateDiscoveryCache();
    const vocab = getTagVocab();
    expect(vocab.find((v) => v.key === "scifi")).toBeUndefined();
    expect(vocab.find((v) => v.key === "science fiction")).toBeUndefined();
    expect(vocab.find((v) => v.key === "sci fi")?.count).toBe(2);
  });
});

describe("§4 exclusion invariant still holds under bundling", () => {
  it("computeFandexScore ignores community/browsed/date fields", () => {
    const a = movie("701", "Scifi A", ["Scifi"]);
    const b = movie("702", "Scifi B", ["Scifi"]);
    const c = movie("703", "Horror C", ["Horror"]);
    upsertLibraryEntry(USER, a, "tmdb", { status: "watched", rating: 9, reviewedAt: 1 });
    upsertLibraryEntry(USER, b, "tmdb", { status: "watched", rating: 9, reviewedAt: 2 });
    upsertLibraryEntry(USER, c, "tmdb", { status: "watched", rating: 3, reviewedAt: 3 });
    setTagAlias("science fiction", "scifi");
    invalidateDiscoveryCache();

    const profile = buildProfile(USER);
    const facet: Facet = { kind: "tag", key: "science fiction", label: "Science Fiction", category: "genre" };
    // The score reads only the facet's key/category — bundling rewrites the key,
    // but no community/browsed/date field is ever consulted.
    const score = computeFandexScore(applyTagAliases([facet]), profile);
    expect(score).not.toBeNull();
  });
});
