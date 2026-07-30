import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run } from "./db";
import { upsertMediaItem, upsertLibraryEntry } from "./matcher";
import { buildProfile, computeFandexScore, invalidateDiscoveryCache } from "./discovery";
import { decorateSection } from "./liveDiscover";
import type { Facet } from "./facets";
import { extractFacets } from "./facets";
import type { FeedCandidate } from "./discoverFeed";

// 2026-07-29 — THE FACET-SOURCE INVARIANT.
//
// A provider list payload carries an item's GENRES and nothing else. The
// persisted catalog row carries its credits, keywords and studios. Both were
// being fed to the same scorer on different surfaces, so one item had two
// scores: Spirited Away read 65.8 on the Home rail and 101.5 on its own detail
// page (a 35-point contradiction, and it ran the other way too — Avengers:
// Endgame read 68.4 live vs 60.9 persisted).
//
// It survived review for ten days because it was HARMLESS under the old
// weighted-mean aggregate: dividing by total facet weight normalised the facet
// count back out, so a thin item and a rich one landed in the same
// neighbourhood. T2's raw sum removed that divisor on purpose, which makes
// score magnitude scale with how many facets happen to be loaded — and turned a
// documented approximation (Q15, H5.3) into a user-visible bug.
//
// So this pins the rule the fix establishes: when an item is already in the
// catalog with real facets, the live paths score THOSE, never the list genres.
// A test that only asserted "some number comes back" would have passed
// throughout — these assert the number equals the persisted-facet score AND
// differs from the genres-only one.

initDb();

const USER = "u-facet-source";

// A full TMDB detail payload: genres AND credits AND keywords.
const deepTmdb = (id: number, title: string) => ({
  id, title, release_date: "2020-01-01", poster_path: "/p.jpg", overview: "o",
  genres: [{ name: "Drama" }],
  credits: { crew: [{ job: "Director", name: "Ada Auteur" }], cast: [] },
  keywords: { keywords: [{ id: 1, name: "long take" }] },
});

// What a provider LIST response gives you for the same film — genres only.
const candidateFor = (tmdbId: number, title: string): FeedCandidate => ({
  id: `tmdb:${tmdbId}`, rawId: tmdbId, source: "tmdb", type: "movie", title,
  releaseDate: "2020-01-01", posterUrl: null, ids: { tmdb: tmdbId },
  genreNames: ["Drama"], originalLanguage: "en",
  voteCount: 5000, voteAverage: 8, popularity: 50,
});

beforeEach(() => {
  run("DELETE FROM media_items");
  run("DELETE FROM users");
  run("INSERT INTO users (id) VALUES (?)", [USER]);
  invalidateDiscoveryCache();
});

// Give the profile real signal, and make "Ada Auteur" a strong positive:
// every rated film of hers is a 10 against a library that otherwise sits at 5.
function seedLibraryWithSignal() {
  for (let i = 1; i <= 6; i++) {
    const id = upsertMediaItem({
      source: "tmdb", sourceId: `900${i}`, type: "movie", title: `Filler ${i}`,
      releaseDate: "2019-01-01",
      rawData: { id: 9000 + i, title: `Filler ${i}`, genres: [{ name: "Drama" }], credits: { crew: [], cast: [] } },
    });
    upsertLibraryEntry(USER, id, "tmdb", { status: "watched", rating: 5, reviewedAt: i });
  }
  for (let i = 1; i <= 3; i++) {
    const id = upsertMediaItem({
      source: "tmdb", sourceId: `800${i}`, type: "movie", title: `Ada Film ${i}`,
      releaseDate: "2019-06-01",
      rawData: {
        id: 8000 + i, title: `Ada Film ${i}`, genres: [{ name: "Drama" }],
        credits: { crew: [{ job: "Director", name: "Ada Auteur" }], cast: [] },
      },
    });
    upsertLibraryEntry(USER, id, "tmdb", { status: "watched", rating: 10, reviewedAt: 10 + i });
  }
}

describe("live-feed scoring reads the catalog's facets, not the provider's list payload", () => {
  it("scores an already-ingested item off its persisted credits/keywords, not its genres", () => {
    seedLibraryWithSignal();
    // The item under test: in the catalog, directed by the user's favourite,
    // and deliberately NOT rated (so it's a real recommendation candidate).
    upsertMediaItem({
      source: "tmdb", sourceId: "1234", type: "movie", title: "Ada's Newest",
      releaseDate: "2020-01-01", rawData: deepTmdb(1234, "Ada's Newest"),
    });
    invalidateDiscoveryCache();

    const [decorated] = decorateSection([candidateFor(1234, "Ada's Newest")], USER);
    const profile = buildProfile(USER);

    // What the list payload alone would have produced — the old behaviour.
    const listOnly: Facet[] = [{ kind: "tag", key: "drama", label: "Drama" }];
    const listScore = computeFandexScore(listOnly, profile)?.score ?? null;

    expect(decorated.fandexScore).not.toBeNull();
    expect(decorated.fandexPending).toBe(false);
    // The whole point: the director is worth real points, and the genres-only
    // view cannot see him at all.
    expect(decorated.fandexScore!).toBeGreaterThan((listScore ?? 0) + 1);
  });

  it("matches, to the decimal, what the persisted facets score — the number the detail page shows", () => {
    seedLibraryWithSignal();
    upsertMediaItem({
      source: "tmdb", sourceId: "1234", type: "movie", title: "Ada's Newest",
      releaseDate: "2020-01-01", rawData: deepTmdb(1234, "Ada's Newest"),
    });
    invalidateDiscoveryCache();

    const [decorated] = decorateSection([candidateFor(1234, "Ada's Newest")], USER);

    // Score the persisted links directly — this is the path /api/detail and
    // /api/library take. Both surfaces must land on one number.
    const links = [{
      source: "tmdb" as const, sourceId: "1234", rawData: deepTmdb(1234, "Ada's Newest"),
    }] as unknown as Parameters<typeof extractFacets>[0];
    const persisted = extractFacets(links, "movie", { tags: ["Drama"], keywords: ["long take"] });
    const expected = computeFandexScore(persisted, buildProfile(USER))?.score ?? null;

    expect(decorated.fandexScore).toBeCloseTo(expected!, 1);
  });

  it("leaves an item the catalog has never enriched UNSCORED and flagged, instead of showing a depressed number", () => {
    seedLibraryWithSignal();
    // No catalog row at all for tmdb:5555 — the genuinely-new provider item.
    const [decorated] = decorateSection([candidateFor(5555, "Never Seen")], USER);

    expect(decorated.fandexScore).toBeNull();
    expect(decorated.fandexPending).toBe(true);
  });

  it("never marks anything pending for a signed-out viewer — there is no score coming", () => {
    seedLibraryWithSignal();
    const [decorated] = decorateSection([candidateFor(5555, "Never Seen")], null);

    expect(decorated.fandexScore).toBeNull();
    expect(decorated.fandexPending).toBe(false);
  });
});
