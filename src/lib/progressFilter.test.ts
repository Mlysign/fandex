import { describe, it, expect } from "vitest";
import type { ProgressEntry, ProgressFilterState } from "./progressFilter";
import { filterProgressEntries, filterProgressByPlatform, sortProgressEntries } from "./progressFilter";
import { defaultUiFilters } from "@/components/discovery/types";

// The Progress tab's toolbar, over episodes.
//
// The rule under test is the one sentence the tab is built on: **every filter
// applies to the SHOW behind the episode**. Before 2026-08-28 none of them
// applied to anything — MyStuffView returned early for this tab and the search
// box, type chips, sort menu and Filters sheet were all inert.

const base: ProgressEntry = {
  mediaItemId: "m1",
  showTitle: "Severance",
  posterUrl: null,
  season: 1,
  episode: 3,
  episodeTitle: "In Perpetuity",
  airDate: "2022-02-25",
  href: "/show/severance",
  eventAt: 1000,
  type: "show",
  facetIds: [],
  releaseDate: "2022-02-18",
  platforms: [],
  streamingProviders: [],
  communityRatings: [],
  fandexScore: null,
  libraryStatus: null,
  rating: null,
  platformSources: [],
  addedAt: null,
};

const entry = (over: Partial<ProgressEntry>): ProgressEntry => ({ ...base, ...over });

const noFilters: ProgressFilterState = {
  q: "",
  types: [],
  storedTypes: null,
  includeFacets: [],
  excludeFacets: [],
  yearRange: defaultUiFilters().yearRange,
  membership: {},
};
const withFilters = (over: Partial<ProgressFilterState>): ProgressFilterState => ({ ...noFilters, ...over });

const titles = (list: ProgressEntry[]) => list.map((e) => e.showTitle);

describe("the search box", () => {
  const list = [
    entry({ showTitle: "Severance", episodeTitle: "The Grim Barbarity of Optics" }),
    entry({ mediaItemId: "m2", showTitle: "Andor", episodeTitle: "Severance Pay" }),
  ];

  it("matches the show's title", () => {
    expect(titles(filterProgressEntries(list, withFilters({ q: "sever" })))).toEqual(["Severance"]);
  });

  // Deliberate, and the reason it is worth a test: matching episode titles too
  // would quietly turn a search for a show into a search for a phrase, and
  // "pilot" would return twenty unrelated shows.
  it("does NOT match the episode's title", () => {
    expect(titles(filterProgressEntries(list, withFilters({ q: "severance pay" })))).toEqual([]);
  });

  it("passes everything through when empty", () => {
    expect(filterProgressEntries(list, noFilters)).toHaveLength(2);
  });
});

describe("the Filters sheet", () => {
  it("matches a TAG pill against the show's facets", () => {
    const list = [
      entry({ showTitle: "Arcane", facetIds: ["tag||steampunk", "tag||animation"] }),
      entry({ mediaItemId: "m2", showTitle: "Andor", facetIds: ["tag||sci fi"] }),
    ];
    const steampunk = { kind: "tag", key: "steampunk", label: "Steampunk" };
    expect(titles(filterProgressEntries(list, withFilters({ includeFacets: [steampunk] })))).toEqual(["Arcane"]);
    expect(titles(filterProgressEntries(list, withFilters({ excludeFacets: [steampunk] })))).toEqual(["Andor"]);
  });

  // The kind a CLIENT-side derivation structurally cannot do: /api/library and
  // /api/calendar ship `sources[].data` as `{}`, so people, studios and
  // franchises are simply absent from the item it would be handed. This tab was
  // the first to compute the ids server-side; the other two followed on
  // 2026-08-28 and the client-side derivation is now deleted outright.
  // → src/lib/listRouteFacetIds.test.ts
  it("matches a PERSON pill, which needs ids computed server-side", () => {
    const list = [
      entry({ showTitle: "Severance", facetIds: ["person|creator|dan erickson"] }),
      entry({ mediaItemId: "m2", showTitle: "Andor" }),
    ];
    const dan = { kind: "person", role: "creator", key: "dan erickson", label: "Dan Erickson" };
    expect(titles(filterProgressEntries(list, withFilters({ includeFacets: [dan] })))).toEqual(["Severance"]);
  });

  it("ANDs multiple include pills", () => {
    const list = [
      entry({ showTitle: "Both", facetIds: ["tag||drama", "tag||sci fi"] }),
      entry({ mediaItemId: "m2", showTitle: "One", facetIds: ["tag||drama"] }),
    ];
    const pills = [
      { kind: "tag", key: "drama", label: "Drama" },
      { kind: "tag", key: "sci fi", label: "Sci-Fi" },
    ];
    expect(titles(filterProgressEntries(list, withFilters({ includeFacets: pills })))).toEqual(["Both"]);
  });

  it("filters on the SHOW's release year", () => {
    const list = [
      entry({ showTitle: "Old", releaseDate: "1999-01-01" }),
      entry({ mediaItemId: "m2", showTitle: "New", releaseDate: "2022-02-18" }),
    ];
    expect(titles(filterProgressEntries(list, withFilters({ yearRange: [2010, 2027] })))).toEqual(["New"]);
  });

  it("filters on list membership", () => {
    const list = [
      entry({ showTitle: "Rated", rating: 8, libraryStatus: "watched" }),
      entry({ mediaItemId: "m2", showTitle: "Unrated" }),
      entry({ mediaItemId: "m3", showTitle: "Wishlisted", platformSources: ["trakt"] }),
    ];
    expect(titles(filterProgressEntries(list, withFilters({ membership: { rated: "only" } })))).toEqual(["Rated"]);
    expect(titles(filterProgressEntries(list, withFilters({ membership: { rated: "exclude" } })))).toEqual(["Unrated", "Wishlisted"]);
    expect(titles(filterProgressEntries(list, withFilters({ membership: { wishlist: "only" } })))).toEqual(["Wishlisted"]);
  });
});

describe("the platform filter", () => {
  const list = [
    entry({ showTitle: "On Netflix", streamingProviders: [{ name: "Netflix" }] }),
    entry({ mediaItemId: "m2", showTitle: "On Max", streamingProviders: [{ name: "HBO Max" }] }),
    entry({ mediaItemId: "m3", showTitle: "Unknown" }),
  ];

  it("keeps the shows on a selected service", () => {
    expect(titles(filterProgressByPlatform(list, ["s:netflix"]))).toEqual(["On Netflix"]);
  });

  // Inherited from matchesPlatforms, and deliberate there: the question is
  // "what can I watch tonight", and padding the answer with maybes is useless.
  it("drops a show we hold no availability data for", () => {
    expect(titles(filterProgressByPlatform(list, ["s:netflix", "s:hbo-max"]))).toEqual(["On Netflix", "On Max"]);
  });

  // The reason it is a SEPARATE function rather than another line in the filter
  // above: the platform chips count the set they will act on, so a chip reading
  // 2 yields exactly 2. Counting the fully filtered set would delete every
  // unpicked platform's chip the moment you picked one.
  it("is not applied by filterProgressEntries, so the chips can count first", () => {
    expect(filterProgressEntries(list, noFilters)).toHaveLength(3);
  });
});

describe("the type chips", () => {
  // Every entry is a show, so pressing Games empties the list. That is the
  // honest outcome of a control Nils asked to keep for consistency across the
  // three tabs, and the panel says "No episodes match the current filters"
  // rather than looking broken.
  it("empties the list when the account is filtered to another type", () => {
    expect(filterProgressEntries([entry({})], withFilters({ types: ["game"] }))).toHaveLength(0);
    expect(filterProgressEntries([entry({})], withFilters({ types: ["show"] }))).toHaveLength(1);
  });
});

describe("sorting", () => {
  const list = [
    entry({ showTitle: "Older event", eventAt: 100, releaseDate: "2024-01-01" }),
    entry({ mediaItemId: "m2", showTitle: "Newest event", eventAt: 300, releaseDate: "2001-01-01" }),
    entry({ mediaItemId: "m3", showTitle: "Middle event", eventAt: 200, releaseDate: "2015-01-01" }),
  ];

  it("puts the latest event first for 'upNext'", () => {
    expect(titles(sortProgressEntries(list, "upNext"))).toEqual(["Newest event", "Middle event", "Older event"]);
  });

  it("hands the shared keys to sortItems, over the show's own fields", () => {
    expect(titles(sortProgressEntries(list, "releaseDate"))).toEqual(["Older event", "Middle event", "Newest event"]);
  });

  // THE reason "upNext" re-sorts instead of returning the array untouched:
  // sortItems returns a NEW array, so by the time someone switches back the
  // list in hand is in whatever order the last sort left it.
  it("restores the up-next order after another sort has reordered the list", () => {
    const byDate = sortProgressEntries(list, "releaseDate");
    expect(titles(sortProgressEntries(byDate, "upNext"))).toEqual(["Newest event", "Middle event", "Older event"]);
  });

  it("sinks an entry with no dated event rather than floating it to the top", () => {
    const withNull = [...list, entry({ mediaItemId: "m4", showTitle: "No event", eventAt: null })];
    expect(titles(sortProgressEntries(withNull, "upNext")).at(-1)).toBe("No event");
  });
});
