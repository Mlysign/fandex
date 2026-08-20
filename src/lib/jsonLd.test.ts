import { describe, it, expect } from "vitest";
import { buildEntityJsonLd, buildItemJsonLd, jsonLdScript } from "./jsonLd";
import type { PublicEnrichedItem } from "@/lib/detail/enrich";
import { BASE_URL } from "@/lib/baseUrl";

// SEO (2026-08-20) — the public item pages shipped with no structured data at
// all. These cover the three shapes plus the two things that would be silently
// wrong: the </script> escape, and aggregateRating never appearing.

const base = (over: Partial<PublicEnrichedItem> & { id: string }): PublicEnrichedItem => ({
  type: "movie",
  title: over.id,
  releaseDate: null,
  posterUrl: null,
  backdropUrl: null,
  dates: [],
  images: [],
  tags: [],
  platforms: [],
  description: null,
  tagline: null,
  metacritic: null,
  steamReviewLabel: null,
  communityRatings: [],
  runtimeMinutes: null,
  certification: [],
  status: null,
  collection: null,
  originalLanguage: null,
  country: null,
  budget: null,
  revenue: null,
  network: null,
  seasonCount: null,
  episodeCount: null,
  nextEpisode: null,
  gameModes: [],
  playtimeHours: null,
  timeToBeat: null,
  dlc: [],
  developer: null,
  publisher: null,
  trailerYoutubeKey: null,
  steamTrailerUrl: null,
  storeLinks: [],
  streamingProviders: [],
  streamingLink: null,
  streamingOfferType: null,
  links: [],
  sources: [],
  ...over,
} as unknown as PublicEnrichedItem);

const URL_ = "https://fandex.org/movie/abc/dune";

describe("buildEntityJsonLd", () => {
  it("emits a Movie with director, cast and an ISO duration", () => {
    const ld = buildEntityJsonLd(
      base({
        id: "dune",
        title: "Dune",
        type: "movie",
        releaseDate: "2021-10-22",
        runtimeMinutes: 155,
        director: "Denis Villeneuve",
        cast: [{ name: "Timothée Chalamet", character: "Paul" }],
        tags: ["Sci-Fi", "Adventure"],
      }),
      URL_,
    );

    expect(ld["@type"]).toBe("Movie");
    expect(ld.name).toBe("Dune");
    expect(ld.url).toBe(URL_);
    expect(ld.datePublished).toBe("2021-10-22");
    expect(ld.duration).toBe("PT155M");
    expect(ld.director).toEqual({ "@type": "Person", name: "Denis Villeneuve" });
    expect(ld.actor).toEqual([{ "@type": "Person", name: "Timothée Chalamet" }]);
    expect(ld.genre).toEqual(["Sci-Fi", "Adventure"]);
  });

  it("emits a TVSeries with creator, season and episode counts", () => {
    const ld = buildEntityJsonLd(
      base({
        id: "severance",
        title: "Severance",
        type: "show",
        director: "Dan Erickson",
        seasonCount: 2,
        episodeCount: 19,
        runtimeMinutes: 50,
        network: "Apple TV+",
      }),
      URL_,
    );

    expect(ld["@type"]).toBe("TVSeries");
    expect(ld.creator).toEqual({ "@type": "Person", name: "Dan Erickson" });
    expect(ld.numberOfSeasons).toBe(2);
    expect(ld.numberOfEpisodes).toBe(19);
    // Per-episode runtime is timeRequired for a series, not duration.
    expect(ld.timeRequired).toBe("PT50M");
    expect(ld.duration).toBeUndefined();
    expect(ld.productionCompany).toEqual({ "@type": "Organization", name: "Apple TV+" });
  });

  it("emits a VideoGame with platforms, publisher and developer", () => {
    const ld = buildEntityJsonLd(
      base({
        id: "hades",
        title: "Hades",
        type: "game",
        platforms: ["PC", "Nintendo Switch"],
        developer: "Supergiant Games",
        publisher: "Supergiant Games",
      }),
      URL_,
    );

    expect(ld["@type"]).toBe("VideoGame");
    expect(ld.gamePlatform).toEqual(["PC", "Nintendo Switch"]);
    expect(ld.author).toEqual({ "@type": "Organization", name: "Supergiant Games" });
    expect(ld.publisher).toEqual({ "@type": "Organization", name: "Supergiant Games" });
  });

  it("NEVER emits aggregateRating, however many community ratings exist", () => {
    const ld = buildEntityJsonLd(
      base({
        id: "x",
        communityRatings: [
          { source: "tmdb", label: "TMDB", score: 8.2, outOf: 10, votes: 12000, url: null },
          { source: "imdb", label: "IMDb", score: 8.0, outOf: 10, votes: 900000, url: null },
        ] as PublicEnrichedItem["communityRatings"],
        metacritic: 74,
      }),
      URL_,
    );
    // Third-party aggregates marked up as our own are a manual-action risk —
    // see the block comment in jsonLd.ts before "fixing" this.
    expect(ld.aggregateRating).toBeUndefined();
    expect(ld.reviewCount).toBeUndefined();
  });

  it("omits fields it has no value for rather than emitting null", () => {
    const ld = buildEntityJsonLd(base({ id: "bare" }), URL_);
    expect(Object.values(ld)).not.toContain(null);
    expect("director" in ld).toBe(false);
    expect("genre" in ld).toBe(false);
    expect("image" in ld).toBe(false);
  });

  it("picks a US certification out of the multi-region union", () => {
    const ld = buildEntityJsonLd(base({ id: "c", certification: ["FSK 16", "PG-13", "12"] }), URL_);
    expect(ld.contentRating).toBe("PG-13");
  });

  it("falls back to the first certification when none is US-shaped", () => {
    const ld = buildEntityJsonLd(base({ id: "c", certification: ["FSK 16", "12"] }), URL_);
    expect(ld.contentRating).toBe("FSK 16");
  });

  it("builds sameAs from the IMDb id and the item's own links", () => {
    const ld = buildEntityJsonLd(
      base({
        id: "s",
        imdbId: "tt1160419",
        links: [{ label: "Wikipedia", url: "https://en.wikipedia.org/wiki/Dune" }],
      }),
      URL_,
    );
    expect(ld.sameAs).toEqual([
      "https://www.imdb.com/title/tt1160419/",
      "https://en.wikipedia.org/wiki/Dune",
    ]);
  });
});

describe("buildItemJsonLd", () => {
  it("routes the breadcrumb through the primary tag's public facet page", () => {
    const [, crumbs] = buildItemJsonLd(base({ id: "d", title: "Dune", tags: ["Sci-Fi"] }), URL_);
    const els = crumbs.itemListElement as { position: number; name: string; item: string }[];
    expect(els).toHaveLength(3);
    expect(els[1]).toMatchObject({ position: 2, name: "Sci-Fi", item: `${BASE_URL}/tag/sci-fi` });
    expect(els[2]).toMatchObject({ position: 3, name: "Dune", item: URL_ });
  });

  it("drops the middle crumb when the item has no tags", () => {
    const [, crumbs] = buildItemJsonLd(base({ id: "d", title: "Dune" }), URL_);
    expect((crumbs.itemListElement as unknown[])).toHaveLength(2);
  });
});

describe("jsonLdScript", () => {
  it("escapes < so a title carrying </script> cannot close the tag", () => {
    const out = jsonLdScript([{ name: "</script><img onerror=alert(1)>" }]);
    expect(out).not.toContain("</script");
    expect(out).not.toContain("<");
    // Still valid JSON, and < parses back to the original character.
    expect(JSON.parse(out).name).toBe("</script><img onerror=alert(1)>");
  });

  it("unwraps a single-node graph instead of emitting a one-element array", () => {
    expect(jsonLdScript([{ "@type": "Movie" }]).startsWith("{")).toBe(true);
    expect(jsonLdScript([{ a: 1 }, { b: 2 }]).startsWith("[")).toBe(true);
  });
});
