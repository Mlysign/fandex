import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 2026-08-28 — `IGDB_ENABLED=0` must stop IGDB completely, and this is what
// keeps that true.
//
// ── Why the switch exists ───────────────────────────────────────────────────
// The Twitch Developer Services Agreement, which IGDB's own docs name as its
// licence, permits storing copies of their content only with prior written
// authorization or a TWENTY-FOUR HOUR cache. Fandex holds IGDB links
// indefinitely, so on a literal reading it is already outside that. It is not
// clear-cut — IGDB's own API ships webhooks whose only purpose is keeping YOUR
// copy of their data current — which is exactly why this is a switch and not a
// removal. Nils asked partner@igdb.com; the switch is what makes a "no" cheap.
//
// ── Why a test and not just the flag ────────────────────────────────────────
// The flag lives in `igdbConfigured()`, and it only works if EVERY exported
// entry point honours it. Two did not when it was written (`getIgdbGame` and
// `searchIgdbGames` reached `igdbQuery` directly), so the switch would have
// turned into a THROW for the /r/ resolver page instead of a no-op — and a
// future function added without the guard would leak the same way, silently,
// with tsc and lint green. This asserts the property rather than the pattern.

const IGDB_PATH = join(process.cwd(), "src", "lib", "sources", "igdb.ts");

async function loadIgdb() {
  vi.resetModules();
  return import("./sources/igdb");
}

const ORIGINAL = { ...process.env };

beforeEach(() => {
  // The switch is read at call time, but CLIENT_ID/SECRET are module-level, so
  // the module has to be re-imported for credentials to take effect.
  process.env.TWITCH_CLIENT_ID = "test-client";
  process.env.TWITCH_CLIENT_SECRET = "test-secret";
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("IGDB kill switch", () => {
  it("is ON by default, so an unset variable changes nothing", async () => {
    delete process.env.IGDB_ENABLED;
    const { igdbConfigured } = await loadIgdb();
    expect(igdbConfigured()).toBe(true);
  });

  it("stays on for any value that is not an explicit off", async () => {
    // A kill switch must fail in the LOUD direction: a typo leaves the site
    // working rather than silently dropping a third of the catalog's games.
    for (const v of ["1", "true", "TRUE", "yes", "", "  ", "off-ish"]) {
      process.env.IGDB_ENABLED = v;
      const { igdbConfigured } = await loadIgdb();
      expect(igdbConfigured(), `IGDB_ENABLED=${JSON.stringify(v)}`).toBe(true);
    }
  });

  it("turns off for 0 and false, case and whitespace insensitive", async () => {
    for (const v of ["0", "false", "FALSE", " 0 ", " False "]) {
      process.env.IGDB_ENABLED = v;
      const { igdbConfigured } = await loadIgdb();
      expect(igdbConfigured(), `IGDB_ENABLED=${JSON.stringify(v)}`).toBe(false);
    }
  });

  it("makes every async entry point a silent no-op, never a throw", async () => {
    // THE test. Each of these must answer empty WITHOUT reaching the network —
    // a throw would surface as a 500 on whichever page called it.
    process.env.IGDB_ENABLED = "0";
    const igdb = await loadIgdb();

    await expect(igdb.getIgdbGame(1234)).resolves.toBeNull();
    await expect(igdb.searchIgdbGames("hollow knight")).resolves.toEqual([]);
    await expect(igdb.discoverIgdbUpcoming(1767225600, 1798761600, 40, 0, "hypes")).resolves.toEqual([]);
    await expect(igdb.getIgdbSimilarGames(1234)).resolves.toEqual([]);
    await expect(igdb.discoverIgdbByTag("cyberpunk")).resolves.toEqual([]);
    await expect(igdb.discoverIgdbByTags(["cyberpunk", "rpg"])).resolves.toEqual([]);
    await expect(igdb.getIgdbFranchiseGames(99)).resolves.toEqual([]);
  });

  it("makes no network call at all when off", async () => {
    // The point is not just an empty answer: a call that reached IGDB and threw
    // the result away would still be storing nothing but would still be ASKING,
    // which is the half the licence question is about.
    process.env.IGDB_ENABLED = "0";
    const spy = vi.spyOn(globalThis, "fetch");
    const igdb = await loadIgdb();
    await Promise.all([
      igdb.getIgdbGame(1),
      igdb.searchIgdbGames("x"),
      igdb.discoverIgdbUpcoming(1767225600, 1798761600, 10, 0, "hypes"),
      igdb.getIgdbFranchiseGames(1),
    ]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("keeps the pure helpers working, because they touch nothing", async () => {
    // Killing the provider must not break rendering of what is ALREADY stored:
    // these two format data we hold and make no request.
    process.env.IGDB_ENABLED = "0";
    const { igdbImageUrl, igdbReleaseDate } = await loadIgdb();
    expect(igdbImageUrl("abc")).toContain("abc");
    expect(igdbReleaseDate({ first_release_date: 1767225600 })).toBe("2026-01-01");
  });

  it("every exported async function guards, including ones added later", () => {
    // A structural check, because the behavioural one above can only cover the
    // functions that existed when it was written. An `export async function`
    // that reaches igdbQuery without an igdbConfigured() guard is the exact
    // shape that leaked the switch the first time.
    const src = readFileSync(IGDB_PATH, "utf8");
    const bodies = src.split(/\nexport async function /).slice(1);
    const leaky: string[] = [];
    for (const body of bodies) {
      const name = body.slice(0, body.indexOf("(")).trim();
      const fn = body.split("\nexport ")[0];
      const callsApi = /igdbQuery\(/.test(fn);
      const guards = /if \(!igdbConfigured\(\)\) return/.test(fn);
      // A delegating wrapper is fine: its callee guards.
      const delegates = /return (discoverIgdbByTags|getIgdbGame|searchIgdbGames)\(/.test(fn);
      if (callsApi && !guards && !delegates) leaky.push(name);
    }
    expect(leaky, `these reach IGDB without honouring the kill switch: ${leaky.join(", ")}`).toEqual([]);
  });
});
