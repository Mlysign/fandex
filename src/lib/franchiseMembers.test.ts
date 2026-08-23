import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run, query } from "./db";
import { invalidateIpCaches, setIpAlias } from "./ipAlias";
import {
  replaceFranchiseMembers, getFranchiseMembers, franchiseSweepStats,
  pruneStaleFranchiseMembers, type FranchiseMemberInput,
} from "./franchiseMembers";

// 2026-08-23 — the franchise membership store.
//
// WHAT IT EXISTS FOR: `facets.ts` reads TMDB's `belongs_to_collection.name` and
// IGDB's `franchises[].name` as LABELS, and nothing ever asked what those
// franchises CONTAIN. So the item page's rail could only list catalog rows, and
// measured on the real catalog that day **167 of 249 distinct TMDB collections
// held exactly one title** — two thirds of films with a franchise showed no rail
// at all, while the provider knew the full list the whole time.
//
// The properties pinned below are the ones a reading of the code does not give
// you, and each of them is a way this table could quietly lose data.

const member = (sourceId: string, title: string, over: Partial<FranchiseMemberInput> = {}): FranchiseMemberInput => ({
  source: "tmdb", sourceId, type: "movie", title,
  releaseDate: "2020-01-01", posterUrl: null, popularity: 1,
  ...over,
});

beforeEach(() => {
  initDb();
  run("DELETE FROM franchise_members");
  run("DELETE FROM ip_alias");
  invalidateIpCaches();
});

describe("replaceFranchiseMembers", () => {
  it("stores a membership set and reads it back", () => {
    replaceFranchiseMembers("star wars", "tmdb", [member("11", "A New Hope"), member("1891", "Empire")]);
    const got = getFranchiseMembers("star wars");
    expect(got.map((m) => m.title).sort()).toEqual(["A New Hope", "Empire"]);
  });

  it("REPLACES that set rather than accumulating stale members", () => {
    replaceFranchiseMembers("star wars", "tmdb", [member("11", "A New Hope"), member("999", "Removed Later")]);
    replaceFranchiseMembers("star wars", "tmdb", [member("11", "A New Hope")]);
    expect(getFranchiseMembers("star wars").map((m) => m.sourceId)).toEqual(["11"]);
  });

  it("⚠️ scopes the replace to ONE source, so re-sweeping TMDB cannot wipe the games", () => {
    // The rail is cross-media by design: a franchise can be described by TMDB
    // (films) and IGDB (games) at once. A blanket `DELETE WHERE ip_key = ?`
    // during a TMDB pass would silently empty the games half and leave the rail
    // poorer until the next IGDB pass — with nothing anywhere reporting it.
    replaceFranchiseMembers("star wars", "igdb", [
      member("1", "Jedi: Fallen Order", { source: "igdb", type: "game" }),
    ]);
    replaceFranchiseMembers("star wars", "tmdb", [member("11", "A New Hope")]);

    const got = getFranchiseMembers("star wars");
    expect(got).toHaveLength(2);
    expect(got.map((m) => m.source).sort()).toEqual(["igdb", "tmdb"]);
  });

  it("⚠️ treats an EMPTY set as 'nothing to say', not 'authoritatively empty'", () => {
    // Same corollary as AGENTS.md's prune invariant, one layer out. The
    // fetchers throw rather than return [] on failure, but a caller that
    // catches and passes [] onward must not be able to erase a good membership
    // set. `undefined` and `[]` have to mean different things anywhere a pull
    // carries data.
    replaceFranchiseMembers("star wars", "tmdb", [member("11", "A New Hope")]);
    const written = replaceFranchiseMembers("star wars", "tmdb", []);
    expect(written).toBe(0);
    expect(getFranchiseMembers("star wars")).toHaveLength(1);
  });

  it("skips a member with no id or no title rather than storing a blank card", () => {
    const n = replaceFranchiseMembers("star wars", "tmdb", [
      member("11", "A New Hope"),
      member("", "No Id"),
      member("12", ""),
    ]);
    expect(n).toBe(1);
  });
});

describe("getFranchiseMembers alias resolution", () => {
  it("⚠️ resolves aliases at READ time, so an alias edit takes effect immediately", () => {
    // The table stores the RAW ipKey() on purpose. Aliases and bundles are
    // runtime-editable, so a canonical key persisted in a row goes stale the
    // moment somebody edits a bundle — and silently, because the row is still
    // perfectly valid, it just answers to a name nothing asks for any more.
    // (AGENTS.md flags exactly this trap for tagKey, whose keys ARE persisted.)
    replaceFranchiseMembers("star wars legends", "tmdb", [member("11", "Legends Entry")]);

    // Before the alias exists, the canonical key knows nothing about it.
    expect(getFranchiseMembers("star wars")).toHaveLength(0);

    setIpAlias("star wars legends", "star wars");
    invalidateIpCaches();

    // No re-sweep, no migration, no rewrite of the stored rows.
    expect(getFranchiseMembers("star wars").map((m) => m.title)).toEqual(["Legends Entry"]);
  });

  it("returns [] for an unknown key rather than throwing", () => {
    expect(getFranchiseMembers("nothing here")).toEqual([]);
    expect(getFranchiseMembers("")).toEqual([]);
  });
});

describe("franchiseSweepStats", () => {
  it("counts distinct franchises and total members, so an empty rail can say WHY", () => {
    // AGENTS.md: a component that renders nothing must know why before it
    // ships. "The rail is short" has four unrelated causes — never swept,
    // swept and genuinely small, the sweep failed, or an alias edit orphaned
    // the rows — and this is the only thing that separates them.
    expect(franchiseSweepStats()).toMatchObject({ franchises: 0, members: 0 });

    replaceFranchiseMembers("star wars", "tmdb", [member("11", "A"), member("12", "B")]);
    replaceFranchiseMembers("dune", "tmdb", [member("13", "C")]);

    const s = franchiseSweepStats();
    expect(s.franchises).toBe(2);
    expect(s.members).toBe(3);
    expect(s.newestFetchedAt).toBeGreaterThan(0);
  });
});

describe("pruneStaleFranchiseMembers", () => {
  it("drops rows older than the cutoff and keeps fresh ones", () => {
    replaceFranchiseMembers("old", "tmdb", [member("1", "Old")]);
    replaceFranchiseMembers("new", "tmdb", [member("2", "New")]);
    // Backdate one set well past any plausible refresh window.
    run("UPDATE franchise_members SET fetched_at = 0 WHERE ip_key = 'old'");

    const dropped = pruneStaleFranchiseMembers(60);
    expect(dropped).toBe(1);
    expect(getFranchiseMembers("old")).toHaveLength(0);
    expect(getFranchiseMembers("new")).toHaveLength(1);
  });
});

describe("the table's own shape", () => {
  it("has NO user_id column — it is catalog data, and erasure finds tables by that name", () => {
    // AGENTS.md, both directions: a user-scoped table MUST have a column
    // literally named user_id or GDPR erasure silently skips it, and a CATALOG
    // table must NOT have one or erasure starts deleting shared metadata.
    const cols = query<{ name: string }>("PRAGMA table_info(franchise_members)").map((c) => c.name);
    expect(cols).not.toContain("user_id");
    expect(cols).toContain("ip_key");
  });
});
