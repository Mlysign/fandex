import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run, get } from "./db";
import { upsertMediaItem } from "./matcher";
import { ensureItemSlug, findItemIdBySlug } from "./itemSlug";
import { slugCandidate, pickSlug, publicItemHref } from "./publicUrl";

// 2026-08-21 — the public url moved from `/{type}/{uuid}/{slug}` to
// `/{type}/{slug}`. The uuid is a ROW id and the boot prune deletes browsed-only
// rows on every deploy, so re-opening such a title minted a new row, a new uuid
// and a new url: Nils hit two dead urls for one film in an afternoon.
//
// The claim this file exists to prove is the last test: delete the row, create
// it again, and the url is the SAME. Everything above it is the machinery that
// makes that true.

initDb();

const tmdb = (id: number, title: string) => ({
  id, title, poster_path: "/p.jpg", overview: "o",
  credits: { crew: [], cast: [] }, genres: [{ id: 1, name: "Drama" }],
});

const add = (sourceId: string, title: string, releaseDate: string | null) =>
  upsertMediaItem({
    source: "tmdb", sourceId, type: "movie", title, releaseDate,
    rawData: tmdb(Number(sourceId), title),
  });

const slugOf = (id: string) =>
  get<{ slug: string | null }>("SELECT slug FROM media_items WHERE id = ?", [id])?.slug ?? null;

beforeEach(() => {
  run("DELETE FROM media_items");
});

describe("slugCandidate", () => {
  it("walks base → year → numbered", () => {
    expect(slugCandidate("Dracula", "1992-11-13", 0)).toBe("dracula");
    expect(slugCandidate("Dracula", "1992-11-13", 1)).toBe("dracula-1992");
    expect(slugCandidate("Dracula", "1992-11-13", 2)).toBe("dracula-1992-2");
  });

  it("skips the year step for an item that has no date", () => {
    // An unreleased title with no date announced is exactly the kind of row this
    // whole change is about, so it must not fall off the sequence.
    expect(slugCandidate("Untitled Sequel", null, 0)).toBe("untitled-sequel");
    expect(slugCandidate("Untitled Sequel", null, 1)).toBe("untitled-sequel-1");
  });

  it("is deterministic — the same inputs give the same candidate every time", () => {
    // Load-bearing: a recreated row re-runs this and must land where it was.
    const once = [0, 1, 2].map((n) => slugCandidate("Nosferatu", "2024-12-25", n));
    const twice = [0, 1, 2].map((n) => slugCandidate("Nosferatu", "2024-12-25", n));
    expect(twice).toEqual(once);
  });
});

describe("pickSlug", () => {
  it("takes the bare slug when nothing holds it", () => {
    expect(pickSlug("The Matrix", "1999-03-31", () => false)).toBe("the-matrix");
  });

  it("falls to the year when the bare slug is taken", () => {
    const taken = new Set(["nosferatu"]);
    expect(pickSlug("Nosferatu", "2024-12-25", (s) => taken.has(s))).toBe("nosferatu-2024");
  });

  it("numbers off a same-title-same-year clash rather than colliding", () => {
    const taken = new Set(["dracula", "dracula-2025"]);
    expect(pickSlug("Dracula", "2025-07-30", (s) => taken.has(s))).toBe("dracula-2025-2");
  });
});

describe("assignment on insert", () => {
  it("gives a new item its slug, and resolves back to it", () => {
    const id = add("1", "The Matrix", "1999-03-31");
    expect(slugOf(id)).toBe("the-matrix");
    expect(findItemIdBySlug("movie", "the-matrix")).toBe(id);
  });

  it("gives a remake the year, leaving the first title on the bare slug", () => {
    const first = add("2", "Nosferatu", "1922-02-16");
    const remake = add("3", "Nosferatu", "2024-12-25");
    expect(slugOf(first)).toBe("nosferatu");
    expect(slugOf(remake)).toBe("nosferatu-2024");
  });

  it("is immutable — a retitled item keeps the url it was shared under", () => {
    const id = add("4", "Untitled Marvel Project", "2027-05-01");
    expect(slugOf(id)).toBe("untitled-marvel-project");
    run("UPDATE media_items SET title = ? WHERE id = ?", ["Avengers: Doomsday", id]);
    ensureItemSlug(id);
    expect(slugOf(id)).toBe("untitled-marvel-project");
  });
});

describe("the churn this change exists to stop", () => {
  it("gives a pruned-then-rebrowsed title the SAME url, despite a new row and a new uuid", () => {
    const first = add("5", "Spider-Man: Brand New Day", "2026-07-29");
    const url = publicItemHref({ id: first, type: "movie", title: "Spider-Man: Brand New Day", slug: slugOf(first) });
    expect(url).toBe("/movie/spider-man-brand-new-day");

    // What the boot prune does to a browsed-only row on every deploy.
    run("DELETE FROM media_items WHERE id = ?", [first]);

    // Somebody opens the title again: a brand new row, a brand new uuid.
    const second = add("5", "Spider-Man: Brand New Day", "2026-07-29");
    expect(second).not.toBe(first);

    const again = publicItemHref({ id: second, type: "movie", title: "Spider-Man: Brand New Day", slug: slugOf(second) });
    expect(again).toBe(url);
  });

  it("still emits the legacy uuid url for an item whose slug hasn't been threaded through", () => {
    // Not a fallback we want to rely on, but it must stay correct: that url is a
    // live route and permanently redirects to the slug one.
    expect(publicItemHref({ id: "abc-123", type: "movie", title: "Dune: Part Two" }))
      .toBe("/movie/abc-123/dune-part-two");
  });
});
