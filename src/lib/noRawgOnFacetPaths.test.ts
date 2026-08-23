import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// PL3, 2026-08-23. RAWG makes no metadata calls on the FACET paths any more.
//
// The numbers that decided it (docs/scalability.md §1): a cold `/tag/{genre}`
// page cost 14 provider requests, and **4 of them were RAWG** — the entire
// measured RAWG cost of the app. The homepage cost 0. RAWG's free quota is
// 20,000 requests a month against a paid tier only 2.5x larger, and the thing
// spending it was a crawler walking the person/tag/studio long tail, not people.
// That is why the cut landed here and NOT on the browse feed.
//
// ⚠️ THE BROWSE FEED DELIBERATELY STILL PULLS RAWG, and that is not an oversight.
// `discoverFeedSources.test.ts` pins the two-source games invariant that the
// 2026-08-02 outage bought: a games pull must survive one source being down.
// Browse measured ZERO RAWG calls (it is page-cached), so cutting it would have
// destroyed a real resilience property for no measured saving. Facets are
// crawler-driven and cost everything; browse is user-driven and costs nothing.
// If you are here to "finish the job" by removing RAWG from discoverFeed.ts,
// read that test first.
//
// This guard exists because the same opt-in shape already failed once: the first
// pass of the 401/403 latch marked `src/lib/sources/` and missed facetDetail.ts
// and discoverFeed.ts, which is where a cold facet page's RAWG calls actually
// came from. Prod then took 39 consecutive 401s with the breaker still closed
// while tsc, lint, 935 tests and the build were all green. A re-added call here
// would be just as invisible.
const FACET_PATH_FILES = [
  "src/lib/facetDetail.ts",
  "src/lib/detail/publicFacetDetail.ts",
];

// Any shape that reaches RAWG over the network. `source: "rawg"` is deliberately
// NOT matched: a STORED rawg row still projects through normalize.ts and still
// appears in a pool, which is the whole point of keeping RAWG as a connector.
const RAWG_NETWORK_CALL = [
  /api\.rawg\.io/,
  /\brawgJson\s*\(/,
  /RAWG_API_KEY/,
  /\bfetchGamePage\s*\(/,
  /\bdiscoverRawgByTag\s*\(/,
  /\brawgGenreSlug\s*\(/,
  /\brawgTagSlug\s*\(/,
];

// Comments are stripped before matching. Both scanned files carry incident
// history that NAMES api.rawg.io deliberately, and that history is worth more
// than a simpler regex would be. Only real code should be able to fail this.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("PL3 — the facet paths make no RAWG calls", () => {
  for (const file of FACET_PATH_FILES) {
    it(`${file} reaches RAWG nowhere`, () => {
      // Strip comments first. This file and the two it scans are full of
      // incident history that NAMES api.rawg.io on purpose, and that history is
      // worth more than a simpler regex. Only real code should fail this.
      const text = stripComments(readFileSync(file, "utf8"));
      const hits = RAWG_NETWORK_CALL.filter((re) => re.test(text)).map(String);
      expect(
        hits,
        `${file} calls RAWG again. A cold facet page is crawler-driven, and 4 RAWG ` +
        `requests per page exhausts a 20,000/month quota in ~5,000 views. If games ` +
        `need more coverage on this surface, IGDB and Steam are already wired here.`,
      ).toEqual([]);
    });
  }
});
