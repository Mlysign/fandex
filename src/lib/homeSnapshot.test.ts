import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run, get } from "./db";
import { readHomeSnapshot, snapshotIsDue, SNAPSHOT_MAX_AGE_MS } from "./homeSnapshot";
import { MIN_TITLES } from "./popularPeople";
import { MIN_INDEXABLE_TITLES } from "./detail/publicFacetDetail";
import { DEFAULT_COUNTRY } from "./countries";
import { dayISO } from "./dailyRotation";

// The daily home snapshot is what makes `/` crawlable without a provider call
// per view. These cover the reads and the two rules that are silent when broken:
// a stale snapshot must not be served forever, and a fresh one must not be
// rebuilt on a request path just because the day rolled over unnoticed.
//
// The BUILD itself is not exercised here: it fans out to TMDB, Trakt, IGDB and
// RAWG, and a test that mocks those proves only that the mocks match what the
// test author assumed. This repo has that lesson on file already, from four
// deploys of episode tracking that shipped against an invented Trakt payload.
// The build's two consequences that ARE checkable in isolation live where they
// bite: the prune pin in dbPrune.test.ts, and the index threshold below.

initDb();

const store = (day: string, builtAt: number, payload: object) =>
  run(
    `INSERT OR REPLACE INTO home_snapshot (region, day, built_at, payload) VALUES (?, ?, ?, ?)`,
    [DEFAULT_COUNTRY, day, builtAt, JSON.stringify(payload)],
  );

beforeEach(() => {
  run("DELETE FROM home_snapshot");
  run("DELETE FROM home_snapshot_item");
});

describe("readHomeSnapshot", () => {
  it("returns null when nothing has been built", () => {
    expect(readHomeSnapshot()).toBeNull();
  });

  it("round-trips the three rails", () => {
    store(dayISO(), Date.now(), {
      trending: [{ id: "a", title: "A" }],
      upcoming: [{ id: "b", title: "B" }],
      people: [{ key: "nolan", name: "Christopher Nolan" }],
    });
    const s = readHomeSnapshot();
    expect(s?.trending).toHaveLength(1);
    expect(s?.upcoming).toHaveLength(1);
    expect(s?.people[0]?.name).toBe("Christopher Nolan");
  });

  it("refuses a snapshot past the maximum age", () => {
    // The TTL says "rebuild me"; this says "too old to be honest". They differ
    // because a failed build deliberately keeps the previous snapshot alive, and
    // without a hard ceiling one outage could leave `/` advertising last
    // month's releases indefinitely.
    store("2020-01-01", Date.now() - SNAPSHOT_MAX_AGE_MS - 1000, {
      trending: [{ id: "a" }], upcoming: [], people: [],
    });
    expect(readHomeSnapshot()).toBeNull();
  });

  it("treats a corrupt payload as no snapshot, never as a throw", () => {
    // `/` renders this on every request. A JSON.parse throwing here would be a
    // 500 on the homepage, which is a far worse outcome than an empty state.
    run(
      `INSERT OR REPLACE INTO home_snapshot (region, day, built_at, payload) VALUES (?, ?, ?, ?)`,
      [DEFAULT_COUNTRY, dayISO(), Date.now(), "{not json"],
    );
    expect(readHomeSnapshot()).toBeNull();
  });

  it("reads only its own region", () => {
    store(dayISO(), Date.now(), { trending: [{ id: "a" }], upcoming: [], people: [] });
    expect(readHomeSnapshot("ZZ")).toBeNull();
    expect(readHomeSnapshot()).not.toBeNull();
  });
});

describe("snapshotIsDue", () => {
  it("is due when there is no snapshot", () => {
    expect(snapshotIsDue()).toBe(true);
  });

  it("is not due for a snapshot built today", () => {
    store(dayISO(), Date.now(), { trending: [], upcoming: [], people: [] });
    expect(snapshotIsDue()).toBe(false);
  });

  it("is due once the stored day is no longer today", () => {
    // A process that boots at 23:59 and stays up must notice the rollover. The
    // day check, not the age check, is what catches that: the age check alone
    // would hold yesterday's page until 23:59 the next night.
    store("2020-01-01", Date.now(), { trending: [], upcoming: [], people: [] });
    expect(snapshotIsDue()).toBe(true);
  });
});

describe("the home page's own writes stay bounded", () => {
  it("keeps exactly one snapshot row per region however often it is stored", () => {
    // The PRIMARY KEY is the bound. This table is written off a schedule and
    // read on the busiest page in the app, which is the pair of properties that
    // grew facet_page_cache to 222.8 MB; an INSERT OR REPLACE on a single key
    // cannot accumulate, so there is no sweep to forget to schedule.
    for (let i = 0; i < 50; i++) {
      store(dayISO(), Date.now(), { trending: [], upcoming: [], people: [] });
    }
    expect(get<{ n: number }>("SELECT COUNT(*) n FROM home_snapshot")?.n).toBe(1);
  });
});

describe("the people rail only links pages Google is allowed to keep", () => {
  it("uses the same title threshold the facet page noindexes below", () => {
    // `/person/{slug}` is `noindex, follow` under MIN_INDEXABLE_TITLES, and the
    // entire point of the rail is to feed link equity from the highest-authority
    // url on the domain into person pages. Linking a person under the threshold
    // spends it on a page we have told Google to drop.
    //
    // popularPeople.ts mirrors the constant rather than importing it, because
    // importing publicFacetDetail pulls the whole provider fan-out into a module
    // that must stay a plain local read. This is the assertion that keeps the
    // copy honest.
    expect(MIN_TITLES).toBe(MIN_INDEXABLE_TITLES);
  });
});
