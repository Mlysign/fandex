import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// PL1, 2026-08-23. OMDb was removed, and this test is what keeps it removed.
//
// The reason is a LICENCE, not a preference, which is exactly why a future
// session would put it back without hesitating: OMDb is the only free source of
// Rotten Tomatoes, IMDb and Metacritic scores for movies and shows, so the
// moment somebody wants those numbers on an item page, adding the key back looks
// like the obvious ten-minute fix. It is not.
//
// omdbapi.com is CC BY-NC 4.0 at EVERY tier. There is no paid commercial tier to
// buy, so it cannot be licensed for a monetized Fandex, only removed. It also
// contributed ZERO to the Fandex Score, which reads facets (tags, people,
// companies, franchise) and is forbidden by its own test from reading ratings.
// So the whole integration was legal exposure with no scoring value.
//
// Nothing else would catch a re-add. It would be one import and one call, tsc
// and lint would pass, the suite would pass, and the item page would look
// BETTER. The failure only ever surfaces as a takedown or a licence dispute
// once ads ship. → docs/letterboxd-import.md is unrelated; the removal decision
// is PLATFORMS.md's metadata table and TASKS.md PL1.
const OMDB_MARKERS = [
  /omdbapi\.com/i,
  /OMDB_API_KEY/,
  /\bapplyOmdbScores\b/,
  /from\s+["'][^"']*sources\/omdb["']/,
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) { out.push(...sourceFiles(p)); continue; }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (p.endsWith(join("lib", "noOmdb.test.ts"))) continue; // this file names them on purpose
    out.push(p);
  }
  return out;
}

describe("OMDb stays removed (CC BY-NC 4.0, PL1)", () => {
  it("no source file references OMDb", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles("src")) {
      const text = readFileSync(file, "utf8");
      for (const marker of OMDB_MARKERS) {
        if (marker.test(text)) offenders.push(`${file} matches ${marker}`);
      }
    }
    expect(
      offenders,
      "OMDb is CC BY-NC 4.0 at every tier and cannot be licensed for commercial use, " +
      "and it contributes nothing to the Fandex Score. If you need RT/IMDb scores, " +
      "the answer is a differently-licensed source, not this one.",
    ).toEqual([]);
  });
});
