import { describe, it, expect } from "vitest";
import { histogram, histogramStep } from "@/lib/insights";

// SM27 (2026-07-28): every stored rating comes off a 10-star picker (a plain
// integer), but the histogram always built 19 half-point buckets regardless —
// 9 of them permanently empty, still consuming bar width, contradicting a
// caption that promised "10 integer bars". The step must follow the data.

describe("histogramStep", () => {
  it("picks whole-point buckets when every rating is an integer", () => {
    expect(histogramStep([1, 5, 8, 10])).toBe(1);
  });

  it("picks half-point buckets when any rating carries a fraction", () => {
    expect(histogramStep([1, 5.5, 8])).toBe(0.5);
  });

  it("defaults to half-point buckets for an empty set", () => {
    expect(histogramStep([])).toBe(0.5);
  });
});

describe("histogram", () => {
  it("builds 10 buckets at step 1, covering 1..10", () => {
    const buckets = histogram([1, 1, 5, 10], 1);
    expect(buckets).toHaveLength(10);
    expect(buckets.map((b) => b.bucket)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(buckets.find((b) => b.bucket === 1)?.count).toBe(2);
    expect(buckets.find((b) => b.bucket === 5)?.count).toBe(1);
    expect(buckets.find((b) => b.bucket === 10)?.count).toBe(1);
  });

  it("builds 19 buckets at step 0.5, covering 1..10", () => {
    const buckets = histogram([1, 5.5, 10], 0.5);
    expect(buckets).toHaveLength(19);
    expect(buckets.find((b) => b.bucket === 5.5)?.count).toBe(1);
  });

  it("clamps out-of-range values to the nearest edge bucket", () => {
    const buckets = histogram([0, 11], 1);
    expect(buckets.find((b) => b.bucket === 1)?.count).toBe(1);
    expect(buckets.find((b) => b.bucket === 10)?.count).toBe(1);
  });
});
