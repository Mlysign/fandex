import { describe, expect, it } from "vitest";
import { normalizeName } from "@/lib/normalize";
import { matchAgainst } from "./matchCore";
import type { ImportRow } from "./parseText";

const row = (title: string, year: number | null, imdbId: string | null = null): ImportRow => ({
  title, year, rating: 8, relation: "library", imdbId, ratedAt: null,
});

function catalog(items: { id: string; title: string; year: number | null }[]) {
  const byTitle = new Map<string, { id: string; year: number | null }[]>();
  for (const it of items) {
    const k = normalizeName(it.title);
    byTitle.set(k, [...(byTitle.get(k) ?? []), { id: it.id, year: it.year }]);
  }
  return byTitle;
}

describe("matchAgainst", () => {
  it("never matches two titles that both normalise to nothing", () => {
    // normalizeName keeps a to z only: both of these are "".
    expect(normalizeName("七人の侍")).toBe("");
    const byTitle = catalog([{ id: "stalker", title: "Сталкер", year: 1979 }]);
    const out = matchAgainst([row("七人の侍", null), row("七人の侍", 1979)], new Map(), byTitle);
    expect(out.rows.map((r) => r.how)).toEqual(["unmatched", "unmatched"]);
    expect(out.matchedLocally).toBe(0);
  });

  it("an IMDb id wins over the title, even where the title would match another row", () => {
    const byTitle = catalog([{ id: "dracula-1931", title: "Dracula", year: 1931 }]);
    const byImdb = new Map([["tt0103874", "dracula-1992"]]);
    const out = matchAgainst([row("Dracula", 1931, "tt0103874")], byImdb, byTitle);
    expect(out.rows[0]).toMatchObject({ mediaItemId: "dracula-1992", how: "imdb-id" });
  });

  it("still matches a Latin title by title and year", () => {
    const byTitle = catalog([{ id: "a", title: "Heat", year: 1995 }]);
    const out = matchAgainst([row("Heat", 1996)], new Map(), byTitle);
    expect(out.rows[0]).toMatchObject({ mediaItemId: "a", how: "title-year" });
  });
});
