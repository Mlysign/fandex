import { describe, it, expect } from "vitest";
import { initialVisibleCount, growVisibleCount } from "@/lib/incrementalList";

describe("initialVisibleCount", () => {
  it("returns the full total when it's below initialCount", () => {
    expect(initialVisibleCount(50, 300)).toBe(50);
  });

  it("caps at initialCount for a larger total", () => {
    expect(initialVisibleCount(2014, 300)).toBe(300);
  });

  it("handles an empty list", () => {
    expect(initialVisibleCount(0, 300)).toBe(0);
  });
});

describe("growVisibleCount", () => {
  it("grows by step", () => {
    expect(growVisibleCount(300, 2014, 300)).toBe(600);
  });

  it("never exceeds the total", () => {
    expect(growVisibleCount(1900, 2014, 300)).toBe(2014);
  });

  it("is a no-op once already at the total", () => {
    expect(growVisibleCount(2014, 2014, 300)).toBe(2014);
  });
});
