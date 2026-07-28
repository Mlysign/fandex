import { describe, it, expect } from "vitest";
import { upcomingFrom } from "@/lib/upcoming";

describe("upcomingFrom", () => {
  const now = new Date("2026-07-28T12:00:00Z");

  it("keeps an item dated today", () => {
    const items = [{ id: "a", releaseDate: "2026-07-28" }];
    expect(upcomingFrom(items, now)).toEqual(items);
  });

  it("drops an item dated yesterday", () => {
    const items = [{ id: "a", releaseDate: "2026-07-27" }];
    expect(upcomingFrom(items, now)).toEqual([]);
  });

  it("drops an undated item", () => {
    const items = [{ id: "a", releaseDate: null }];
    expect(upcomingFrom(items, now)).toEqual([]);
  });

  it("keeps a future item", () => {
    const items = [{ id: "a", releaseDate: "2026-08-01" }];
    expect(upcomingFrom(items, now)).toEqual(items);
  });

  it("preserves input order rather than re-sorting", () => {
    const items = [
      { id: "later", releaseDate: "2026-09-01" },
      { id: "sooner", releaseDate: "2026-08-01" },
    ];
    expect(upcomingFrom(items, now).map((i) => i.id)).toEqual(["later", "sooner"]);
  });

  it("filters a mixed list, dropping past and undated while keeping order", () => {
    const items = [
      { id: "ancient", releaseDate: "1954-04-26" },
      { id: "today", releaseDate: "2026-07-28" },
      { id: "tba", releaseDate: null },
      { id: "future", releaseDate: "2027-01-01" },
    ];
    expect(upcomingFrom(items, now).map((i) => i.id)).toEqual(["today", "future"]);
  });
});
