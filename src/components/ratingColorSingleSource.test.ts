import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { ratingColor } from "./QuickActions";

// 2026-09-02. The 0-10 user rating's colour was written TWICE, with identical
// 7/5 cutoffs and different palettes: `ActionCells.tsx` on the brand's
// success/warning/danger, `QuickActions.tsx` on stock Tailwind green-400 /
// amber-500 / red-500. Both render on the same card, so the same 8/10 showed up
// in two different greens depending on which control you looked at.
//
// Nothing failed. Two plausible colours are indistinguishable from one correct
// one unless you put them side by side, which is exactly why this is pinned by a
// test rather than left to review.
//
// Same defect the Fandex Score ramp had a day earlier: a value defined next to
// each consumer instead of once. → components/FandexScoreBadge.test.ts

const COMPONENTS = join(__dirname);

describe("the 0-10 rating colour has ONE definition", () => {
  it("returns design tokens, not literal hexes", () => {
    // A hex here means somebody re-inlined the palette, which is how the light
    // theme got stranded on dark values last time.
    for (const r of [9, 7, 6, 5, 3, 0]) {
      expect(ratingColor(r)).toMatch(/^var\(--color-(success|warning|danger)\)$/);
    }
  });

  it("keeps its 7 / 5 cutoffs", () => {
    expect(ratingColor(7)).toBe("var(--color-success)");
    expect(ratingColor(6.9)).toBe("var(--color-warning)");
    expect(ratingColor(5)).toBe("var(--color-warning)");
    expect(ratingColor(4.9)).toBe("var(--color-danger)");
  });

  it("is not re-declared anywhere else under components/", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith(".test.ts")) continue;
        if (full.endsWith(join("components", "QuickActions.tsx"))) continue; // the one home
        const src = readFileSync(full, "utf8");
        // A local `const ratingColor =` / `function ratingColor(`. An IMPORT of
        // the shared one is the whole point and must not trip this.
        if (/(?:const|function)\s+ratingColor\b/.test(src)) offenders.push(full);
      }
    };
    walk(COMPONENTS);
    expect(offenders, `ratingColor re-declared in: ${offenders.join(", ")}`).toEqual([]);
  });
});
