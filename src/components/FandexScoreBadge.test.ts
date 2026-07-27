import { describe, it, expect } from "vitest";
import { fandexScoreColor } from "./FandexScoreBadge";

// S11 (2026-07-27, fixes SM12) — bands are now `center ± 8`, not a fixed
// 70/50. Colors: strong "#5FE39A", typical "#CFC9BE", weak "#F0A04B".
const STRONG = "#5FE39A", TYPICAL = "#CFC9BE", WEAK = "#F0A04B";

describe("fandexScoreColor — baseline-relative bands (S11)", () => {
  it("bands relative to a non-default center, not the old fixed 70/50", () => {
    // center 67 (this repo's real measured baseline*10): 75/59 are the cutoffs.
    expect(fandexScoreColor(76, 67)).toBe(STRONG);
    expect(fandexScoreColor(75, 67)).toBe(STRONG);   // exactly center+8
    expect(fandexScoreColor(70, 67)).toBe(TYPICAL);  // reads "typical" though < the OLD fixed 70 cutoff
    expect(fandexScoreColor(60, 67)).toBe(TYPICAL);
    expect(fandexScoreColor(59, 67)).toBe(WEAK);      // exactly center-8
    expect(fandexScoreColor(50, 67)).toBe(WEAK);
  });

  it("two users at the same raw score can band differently", () => {
    // A low-baseline user (center 40): 60 is a strong outperformance.
    expect(fandexScoreColor(60, 40)).toBe(STRONG);
    // A high-baseline user (center 80): the same 60 is a clear underperformance.
    expect(fandexScoreColor(60, 80)).toBe(WEAK);
  });

  it("defaults center to 50 when omitted or null (pre-Q19 fixed-center behavior)", () => {
    expect(fandexScoreColor(58)).toBe(STRONG);  // exactly center(50)+8
    expect(fandexScoreColor(57)).toBe(TYPICAL);
    expect(fandexScoreColor(42)).toBe(WEAK);     // exactly center(50)-8
    expect(fandexScoreColor(70, null)).toBe(STRONG);
  });
});
