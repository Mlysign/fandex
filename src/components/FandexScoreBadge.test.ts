import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fandexScoreColor, matchStrength } from "./FandexScoreBadge";

// S11 (2026-07-27, fixes SM12) — bands are `center ± BAND_MARGIN`, not a fixed
// 70/50. BAND_MARGIN re-anchored 8 -> 10 on 2026-07-29 alongside the raw-sum
// aggregate rework (scripts/calibrate-fandex.mjs) — see FandexScoreBadge.tsx.
//
// 2026-09-01: the three colours were the literal hexes "#5FE39A" / "#CFC9BE" /
// "#F0A04B" until today. They are the design tokens now, which is why this file
// also checks globals.css: a `var()` that resolves to nothing is invisible from
// a unit test, and the way to get exactly that here is documented and easy to
// walk into (see the second describe block).
const STRONG = "var(--color-score-high)",
  TYPICAL = "var(--color-score-baseline)",
  WEAK = "var(--color-score-low)";

describe("fandexScoreColor — baseline-relative bands (S11)", () => {
  it("bands relative to a non-default center, not the old fixed 70/50", () => {
    // center 67 (this repo's real measured baseline*10): 77/57 are the cutoffs.
    expect(fandexScoreColor(78, 67)).toBe(STRONG);
    expect(fandexScoreColor(77, 67)).toBe(STRONG);   // exactly center+10
    expect(fandexScoreColor(70, 67)).toBe(TYPICAL);  // reads "typical" though < the OLD fixed 70 cutoff
    expect(fandexScoreColor(60, 67)).toBe(TYPICAL);
    expect(fandexScoreColor(57, 67)).toBe(WEAK);      // exactly center-10
    expect(fandexScoreColor(50, 67)).toBe(WEAK);
  });

  it("two users at the same raw score can band differently", () => {
    // A low-baseline user (center 40): 60 is a strong outperformance.
    expect(fandexScoreColor(60, 40)).toBe(STRONG);
    // A high-baseline user (center 80): the same 60 is a clear underperformance.
    expect(fandexScoreColor(60, 80)).toBe(WEAK);
  });

  it("defaults center to 50 when omitted or null (pre-Q19 fixed-center behavior)", () => {
    expect(fandexScoreColor(60)).toBe(STRONG);  // exactly center(50)+10
    expect(fandexScoreColor(59)).toBe(TYPICAL);
    expect(fandexScoreColor(40)).toBe(WEAK);     // exactly center(50)-10
    expect(fandexScoreColor(70, null)).toBe(STRONG);
  });

  // 2026-07-29: the raw-sum aggregate (computeFandexScore) is deliberately
  // unbounded — no clamp to [0, 100] — so a score of 104 or -3 is a real,
  // expected input, not a bug to guard against. Both functions must keep
  // working (no NaN, no throw, a real band) since the badge no longer shows a
  // "/100" denominator to make an out-of-range number look wrong anyway.
  it("handles scores outside the old [0, 100] range — real inputs since the raw-sum rework", () => {
    expect(fandexScoreColor(104, 67)).toBe(STRONG);
    expect(matchStrength(104, 67)).toBe("strong match");
    expect(fandexScoreColor(-3, 67)).toBe(WEAK);
    expect(matchStrength(-3, 67)).toBe("weak match");
  });
});

// The tokens the three functions above now return. A unit test cannot see a
// custom property fail to resolve, and there is a specific, documented way to
// make these fail to resolve that leaves the build, lint and every other test
// green: putting them back in `@theme`. Tailwind v4 tree-shakes an @theme
// property no utility class names, and the ONLY consumer here is an inline
// `style={{ color }}`. The score would then inherit its parent's colour, on
// every card, tooltip and item page at once.
// → AGENTS.md "Design tokens", [[tailwind-theme-tree-shaking]]
describe("the score ramp's tokens are declared where they survive the build", () => {
  const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8");
  const themeBlock = css.slice(css.indexOf("@theme {"), css.indexOf("\n}", css.indexOf("@theme {")));
  const TOKENS = ["--color-score-high", "--color-score-baseline", "--color-score-low"] as const;

  it("declares all three, so no var() resolves to the empty string", () => {
    for (const token of TOKENS) {
      expect(css, `${token} is not declared anywhere`).toMatch(new RegExp(`^\\s*${token}:`, "m"));
    }
  });

  it("declares none of them inside @theme, where Tailwind would strip them", () => {
    for (const token of TOKENS) {
      expect(themeBlock, `${token} is back inside @theme and will be tree-shaken`).not.toContain(`${token}:`);
    }
  });

  it("gives the light theme its own values, at a specificity that beats the dark ones", () => {
    // `:root` and `[data-theme="light"]` have EQUAL specificity, and the score
    // block sits later in the file, so the light values have to be written as
    // `:root[data-theme="light"]` or dark simply wins. This asserts the shape
    // that makes the light theme work, not merely that light values exist.
    const lightBlock = css.slice(css.lastIndexOf(':root[data-theme="light"] {'));
    for (const token of TOKENS) {
      expect(lightBlock, `${token} has no :root[data-theme="light"] value`).toContain(`${token}:`);
    }
  });
});
