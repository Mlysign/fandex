import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDb, run } from "./db";
import { upsertMediaItem } from "./matcher";
import {
  catalogBrowseEnabled, catalogBrowseReady, catalogWindowCount, catalogBrowseMin,
} from "./catalogFeed";

// 2026-08-28, docs/catalog-growth.md phase 2 — serving browse from our own
// database instead of a provider.
//
// ⚠️ The gate is the design, not a guard on it. Measured before the backfill,
// the future window held 59 games, 52 movies and 42 shows, and 128 of those 153
// were rows the provider feed itself wrote while somebody scrolled past.
// Switching browse to the database then would have produced a CIRCULAR feed:
// thinner than the TMDB list it replaced, made of the same data one step
// staler, and it would have looked like it worked.
//
// So this is what has to hold: nothing serves locally until the catalog can
// actually answer, and readiness is measured per (type, window) rather than
// assumed globally, because the lanes fill at different rates.

initDb();

const ORIGINAL = { ...process.env };
const today = new Date();
const inDays = (n: number) => new Date(today.getTime() + n * 86400_000).toISOString().slice(0, 10);

function seed(type: "movie" | "show" | "game", n: number, day: number) {
  for (let i = 0; i < n; i++) {
    upsertMediaItem({
      source: "tmdb", sourceId: `br-${type}-${day}-${i}`, type, title: `Browse ${type} ${day} ${i}`,
      releaseDate: inDays(day),
      rawData: { id: 6_000_000 + day * 1000 + i, title: `Browse ${type} ${day} ${i}`, release_date: inDays(day) },
    });
  }
}

beforeEach(() => {
  run("DELETE FROM media_items");
  process.env.CATALOG_BROWSE = "1";
  delete process.env.CATALOG_BROWSE_MIN;
});

afterEach(() => { process.env = { ...ORIGINAL }; });

describe("catalog browse gate", () => {
  it("is OFF unless switched on, whatever the catalog holds", () => {
    // Serving the database by default is a deliberate act. A catalog that grew
    // past the threshold must not silently change where browse comes from.
    delete process.env.CATALOG_BROWSE;
    seed("movie", 5, 10);
    expect(catalogBrowseEnabled()).toBe(false);
    expect(catalogBrowseReady("movie", "future")).toBe(false);
  });

  it("stays on the provider while the window is thin", () => {
    seed("movie", 5, 10);
    expect(catalogWindowCount("movie", "future")).toBe(5);
    expect(catalogBrowseReady("movie", "future")).toBe(false);
  });

  it("switches over once the window can actually answer", () => {
    process.env.CATALOG_BROWSE_MIN = "10";
    seed("movie", 12, 10);
    expect(catalogBrowseReady("movie", "future")).toBe(true);
  });

  it("decides per TYPE, so a thin lane keeps asking while a full one stops", () => {
    // Games run through two providers and shows through one, so the lanes fill
    // at different rates. A global switch would flip a type that is still thin.
    process.env.CATALOG_BROWSE_MIN = "10";
    seed("movie", 12, 10);
    seed("show", 3, 10);
    expect(catalogBrowseReady("movie", "future")).toBe(true);
    expect(catalogBrowseReady("show", "future")).toBe(false);
  });

  it("decides per WINDOW, so a full future does not speak for the past", () => {
    process.env.CATALOG_BROWSE_MIN = "10";
    seed("movie", 12, 30);    // future
    seed("movie", 2, -30);    // past
    expect(catalogBrowseReady("movie", "future")).toBe(true);
    expect(catalogBrowseReady("movie", "past")).toBe(false);
  });

  it("counts only titles inside the window, not the whole catalog", () => {
    // The browse window is ±550 days. A catalog full of 1990s films says nothing
    // about whether the upcoming timeline can be served locally.
    process.env.CATALOG_BROWSE_MIN = "10";
    seed("movie", 50, 3000);  // far outside the window
    expect(catalogWindowCount("movie", "future")).toBe(0);
    expect(catalogBrowseReady("movie", "future")).toBe(false);
  });

  it("defaults to a threshold worth several pages of scrolling", () => {
    // The failure the gate prevents is a visitor scrolling off the end of a
    // catalog that had just enough rows to switch over.
    expect(catalogBrowseMin()).toBe(200);
  });
});
