import { describe, it, expect } from "vitest";
import { passesYearMembership } from "@/lib/facetFilter";
import { YEAR_MIN, YEAR_MAX } from "@/components/discovery/types";

// A2 (H1.6c) — the "Already-rated" membership dimension, plus a guard on the
// existing library/wishlist tri-states so the whole predicate stays honest.
const FULL: [number, number] = [YEAR_MIN, YEAR_MAX];

const rated = { releaseDate: "2024-01-01", rating: 8, libraryStatus: "watched", platformSources: [] };
const unrated = { releaseDate: "2024-01-01", rating: null, libraryStatus: null, platformSources: [] };

describe("passesYearMembership — rated dimension (A2)", () => {
  it("Any (undefined) keeps both rated and unrated items", () => {
    expect(passesYearMembership(rated, FULL, {})).toBe(true);
    expect(passesYearMembership(unrated, FULL, {})).toBe(true);
  });

  it('rated "only" keeps rated, drops unrated', () => {
    expect(passesYearMembership(rated, FULL, { rated: "only" })).toBe(true);
    expect(passesYearMembership(unrated, FULL, { rated: "only" })).toBe(false);
  });

  it('rated "exclude" drops rated, keeps unrated (the old hide-rated behaviour)', () => {
    expect(passesYearMembership(rated, FULL, { rated: "exclude" })).toBe(false);
    expect(passesYearMembership(unrated, FULL, { rated: "exclude" })).toBe(true);
  });

  it("rated is independent of library — an unrated-but-in-library item is not 'rated'", () => {
    const ownedUnrated = { releaseDate: "2024-01-01", rating: null, libraryStatus: "owned", platformSources: [] };
    expect(passesYearMembership(ownedUnrated, FULL, { rated: "only" })).toBe(false);
    expect(passesYearMembership(ownedUnrated, FULL, { library: "only" })).toBe(true);
  });

  it("combines with wishlist: rated-only AND wishlist-exclude", () => {
    const ratedOnWishlist = { releaseDate: "2024-01-01", rating: 9, libraryStatus: null, platformSources: ["trakt"] };
    expect(passesYearMembership(ratedOnWishlist, FULL, { rated: "only", wishlist: "exclude" })).toBe(false);
    expect(passesYearMembership(rated, FULL, { rated: "only", wishlist: "exclude" })).toBe(true);
  });
});
