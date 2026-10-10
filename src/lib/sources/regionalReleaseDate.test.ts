import { describe, expect, it } from "vitest";
import { mergeLinks, regionalReleaseDate } from "@/lib/merge";
import { pickRegionalReleaseDate } from "@/lib/sources/normalize";
import type { MediaLink } from "@/types";

const d = (date: string, type: number) => ({ release_date: `${date}T00:00:00.000Z`, type });

describe("the one release date shown for a country", () => {
  it("takes the cinema date over an earlier festival premiere", () => {
    // "The Weight" in Germany, as TMDB listed it on 2026-10-10.
    expect(pickRegionalReleaseDate([d("2026-02-17", 1), d("2026-11-19", 3)])).toBe("2026-11-19");
    // Several premieres either side of the cinema run.
    expect(pickRegionalReleaseDate([d("2026-07-02", 1), d("2026-08-20", 3), d("2026-08-22", 1), d("2026-10-02", 4)])).toBe("2026-08-20");
  });

  it("takes the earliest cinema date, limited or wide, as TMDB's regional discover does", () => {
    expect(pickRegionalReleaseDate([d("2026-07-10", 3), d("2026-06-26", 2), d("2026-01-24", 1)])).toBe("2026-06-26");
    expect(pickRegionalReleaseDate([d("2026-08-06", 2), d("2026-07-31", 3)])).toBe("2026-07-31");
    // A re-release decades later does not replace the original run.
    expect(pickRegionalReleaseDate([d("2026-08-27", 2), d("1991-10-24", 3)])).toBe("1991-10-24");
  });

  it("falls back to digital, then a premiere, then whatever is left", () => {
    expect(pickRegionalReleaseDate([d("2026-03-01", 1), d("2026-05-01", 4), d("2026-04-01", 5)])).toBe("2026-05-01");
    expect(pickRegionalReleaseDate([d("2026-04-01", 5), d("2026-03-01", 1)])).toBe("2026-03-01");
    expect(pickRegionalReleaseDate([d("2026-04-01", 6), d("2026-03-15", 5)])).toBe("2026-03-15");
  });

  it("answers null for a country with no dated entry", () => {
    expect(pickRegionalReleaseDate([])).toBeNull();
    expect(pickRegionalReleaseDate([{ release_date: "", type: 3 }, { type: 3 }])).toBeNull();
  });
});

describe("whether a country's date replaces the primary one", () => {
  it("does within three years, and not for a restoration decades later", () => {
    expect(regionalReleaseDate("2026-09-28", "2026-10-01")).toBe("2026-10-01");
    expect(regionalReleaseDate("1985-12-15", "2026-03-05")).toBe("1985-12-15");
  });

  it("uses whichever of the two exists", () => {
    expect(regionalReleaseDate("2026-09-28", null)).toBe("2026-09-28");
    expect(regionalReleaseDate(null, "2026-10-01")).toBe("2026-10-01");
    expect(regionalReleaseDate(null, null)).toBeNull();
  });
});

describe("the merged release date", () => {
  const link = (releaseDates: unknown): MediaLink => ({
    id: "", mediaItemId: "", source: "tmdb", sourceId: "1", title: null, releaseDate: null, lastSynced: 0,
    rawData: { id: 1, title: "Hope", release_date: "2026-07-15", release_dates: { results: releaseDates } },
  });

  it("is the country's cinema date, not its premiere", () => {
    const links = [link([
      { iso_3166_1: "DE", release_dates: [d("2026-09-09", 1), d("2026-10-08", 3)] },
      { iso_3166_1: "US", release_dates: [d("2026-07-20", 1), d("2026-07-24", 3)] },
    ])];
    expect(mergeLinks(links, "movie", "DE").releaseDate).toBe("2026-10-08");
    expect(mergeLinks(links, "movie", "US").releaseDate).toBe("2026-07-24");
    // A country TMDB lists nothing for keeps the primary date.
    expect(mergeLinks(links, "movie", "FR").releaseDate).toBe("2026-07-15");
  });
});
