import { get, run, transaction } from "@/lib/db";
import { log, errorFields } from "@/lib/logger";
import { DEFAULT_COUNTRY } from "@/lib/countries";
import { dayISO, seedFor, rotationSlot, rotateRailFresh } from "@/lib/dailyRotation";
import { RAIL_SIZE, trendingPool, upcomingPool } from "@/lib/homeRails";
import { decorateSection } from "@/lib/liveDiscover";
import { persistDiscoverItems } from "@/lib/discoverPersist";
import { slugsForItemIds } from "@/lib/itemSlug";
import { popularPeople } from "@/lib/popularPeople";
import type { PopularPerson } from "@/lib/personRail";
import type { FeedCandidate } from "@/lib/discoverFeed";

// THE DAILY HOME SNAPSHOT: the public half of `/`, built once a day on the
// server and served to every visitor and every crawler out of one table row.
//
// ── WHY (2026-08-26) ────────────────────────────────────────────────────────
//
// Home's rails were a client island calling `/api/home`, and `/api/` is under
// the robots Disallow. Googlebot's renderer honours robots.txt for subresources,
// so this was not a "probably missed". The renderer was BLOCKED from fetching
// the data that would have produced the links. `/` is the highest-authority url
// on the domain and its entire visible content was invisible to search. The
// server-rendered `CatalogHub` at the bottom of the page was carrying the whole
// link graph on its own.
//
// Nils's design, and it solves the cost problem at the same time: one provider
// fan-out per DAY, independent of who is looking, stored in `home_snapshot`;
// every page render is then a single indexed SELECT and a JSON.parse. A crawler
// walking `/` a thousand times causes zero provider calls, where before every
// cold cache entry cost a fan-out.
//
// ── THE THREE RULES THIS FILE EXISTS TO HOLD ────────────────────────────────
//
// 1. ⚠️ NEVER REPLACE A GOOD SNAPSHOT WITH AN EMPTY ONE. If the daily pull
//    fails or comes back thin, yesterday's snapshot stays. This is the prune
//    invariant's shape, one surface over: a swallowed provider error must not be
//    allowed to look like "there is nothing to show". Nils's sketch said "clear
//    the table before the update"; clearing FIRST is precisely what would turn a
//    RAWG outage into an empty homepage, so the write is a single atomic
//    replace AFTER a build that validated.
//
// 2. ⚠️ THE BUILDER WRITES CATALOG ROWS, AND THAT IS DELIBERATE. PR15 gates
//    discover-time persistence on a real session because unbounded
//    crawler-driven writes grew media_items to ~676k rows. This write is the
//    opposite shape: it happens ONCE A DAY, off the request path, for at most
//    RAIL_SIZE × 2 titles, no matter how much traffic arrives. Without it the
//    rails would resolve read-only and most cards would come back
//    `linkable: false`, which would defeat the entire point of the exercise.
//    It calls `persistDiscoverItems` directly rather than passing a fake user to
//    `persistDiscoverBatch`, so the request-path gate keeps its exact shape and
//    nobody can reach this behaviour from a route by flipping a boolean.
//
// 3. ⚠️ THE ROWS IT WRITES MUST SURVIVE THE BOOT PRUNE. They arrive
//    `browsed = 1` and nobody acts on them, so `dbPrune`'s predicate would
//    delete exactly the titles `/` links to on the very next deploy.
//    `home_snapshot_item` exists to be named in `PRUNABLE_WHERE`; it is
//    rewritten with the snapshot, so it pins ~30 rows and releases them the
//    moment they drop off the page.

/** How many faces the "Popular people" rail shows, out of the ranked pool. */
export const PEOPLE_RAIL_SIZE = 20;

/** How long a snapshot is good for. Nils's spec: rebuilt once a day. */
export const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * A snapshot older than this is not served at all.
 *
 * The TTL above says "time to rebuild"; this says "too old to be honest". They
 * differ because rule 1 keeps a stale snapshot alive through an outage, and a
 * homepage still advertising last month's upcoming releases is worse than one
 * that falls back. Seven days is generous on purpose: it covers a provider
 * being down for a long weekend without ever showing a visitor a dead page.
 */
export const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** One rail item, exactly as the page renders it. */
export type SnapshotItem = Omit<FeedCandidate, "raw"> & {
  slug?: string | null;
  linkable?: boolean;
  communityVotes?: number;
  communityScore?: number | null;
  fandexScore?: number | null;
  fandexCenter?: number | null;
  fandexPending?: boolean;
};

export interface HomeSnapshot {
  region: string;
  day: string;
  builtAt: number;
  trending: SnapshotItem[];
  upcoming: SnapshotItem[];
  people: PopularPerson[];
}

interface SnapshotRow { region: string; day: string; built_at: number; payload: string }

/**
 * Read the stored snapshot, or null.
 *
 * ⚠️ This is called on EVERY render of `/`. It must stay one indexed SELECT and
 * a JSON.parse, and it must never fall back to building. A build on a request
 * path is the provider fan-out we just removed, handed to whichever visitor
 * happened to arrive first (in practice, a crawler).
 */
export function readHomeSnapshot(region: string = DEFAULT_COUNTRY): HomeSnapshot | null {
  const row = get<SnapshotRow>(
    "SELECT region, day, built_at, payload FROM home_snapshot WHERE region = ?",
    [region],
  );
  if (!row) return null;
  if (Date.now() - row.built_at > SNAPSHOT_MAX_AGE_MS) return null;

  try {
    const payload = JSON.parse(row.payload) as Pick<HomeSnapshot, "trending" | "upcoming" | "people">;
    return {
      region: row.region,
      day: row.day,
      builtAt: row.built_at,
      trending: payload.trending ?? [],
      upcoming: payload.upcoming ?? [],
      people: payload.people ?? [],
    };
  } catch (e) {
    // A corrupt row reads as "no snapshot", same as facetCacheStore: the next
    // scheduled build replaces it, and the page has its own empty state.
    log.warn("home_snapshot_parse_failed", { ...errorFields(e) });
    return null;
  }
}

/** Whether the stored snapshot is missing or due for a rebuild. */
export function snapshotIsDue(region: string = DEFAULT_COUNTRY, now: Date = new Date()): boolean {
  const row = get<{ day: string; built_at: number }>(
    "SELECT day, built_at FROM home_snapshot WHERE region = ?",
    [region],
  );
  if (!row) return true;
  // Both conditions, not either: the day check makes the rebuild land on a real
  // day boundary (so the rotation and the "upcoming" window agree with the
  // calendar), and the age check catches a process that booted just before
  // midnight and has been up ever since.
  return row.day !== dayISO(now) || Date.now() - row.built_at >= SNAPSHOT_TTL_MS;
}

/**
 * Build a fresh snapshot and store it, replacing the previous one.
 *
 * Returns the snapshot on success, or null when the build was rejected as too
 * thin to publish (see rule 1: the previous snapshot is left untouched).
 */
export async function buildHomeSnapshot(
  region: string = DEFAULT_COUNTRY,
  now: Date = new Date(),
): Promise<HomeSnapshot | null> {
  const day = dayISO(now);
  const slot = rotationSlot(now);

  const [trendingRanked, upcomingRanked] = await Promise.all([
    trendingPool(region),
    upcomingPool(region, now),
  ]);

  // Rotate, THEN decorate: rotation is pure and cheap. `decorateSection(…, null)`
  // is the viewer-independent half: community stats and a null Fandex Score.
  // A signed-in visitor's own score is layered on client-side, exactly like the
  // item page's personal block.
  const trending = decorateSection(
    rotateRailFresh(trendingRanked, RAIL_SIZE, (e) => seedFor("trending", e), slot),
    null,
  );
  const upcoming = decorateSection(
    rotateRailFresh(upcomingRanked, RAIL_SIZE, (e) => seedFor("upcoming", e), slot),
    null,
  ).sort((a, b) => (a.releaseDate ?? "9999").localeCompare(b.releaseDate ?? "9999"));

  // ⚠️ RULE 1. Reject a thin build before it can overwrite a good one. The bar
  // is deliberately low: this is guarding against an outage returning nothing,
  // not policing rail quality. A genuinely empty catalog still publishes an
  // empty snapshot the first time, because then there is no good one to protect.
  const existing = readHomeSnapshot(region);
  if (trending.length === 0 && upcoming.length === 0 && existing) {
    log.warn("home_snapshot_build_thin", {
      region, day,
      keptBuiltAt: existing.builtAt,
      trending: trending.length,
      upcoming: upcoming.length,
    });
    return null;
  }

  // ⚠️ RULE 2. The once-a-day catalog write that makes these cards linkable.
  const persisted = persistRailItems([...trending, ...upcoming]);
  const trendingOut = persisted.slice(0, trending.length);
  const upcomingOut = persisted.slice(trending.length);

  // The people rail is drawn from a pool of POPULAR_PEOPLE_POOL and rotated
  // down to PEOPLE_RAIL_SIZE. Two reasons, and only the first is cosmetic.
  //
  // A 60-card carousel is 60 portraits to download for a row nobody scrolls to
  // the end of. And the ranking barely moves between syncs, so without rotation
  // `/` would point at the same faces indefinitely: the strongest internal link
  // on the site, permanently spent on one fixed set of person pages while the
  // other ~1,140 that clear the index threshold get nothing.
  //
  // Rotated once per DAILY build rather than per rotation slot, because the
  // snapshot is the page: a per-slot rotation would be recomputed four times a
  // day into a row that is only written once.
  const peoplePool = popularPeople(now);
  const people = rotateRailFresh(
    peoplePool, PEOPLE_RAIL_SIZE, (e) => seedFor("people", e), slot,
  );

  const snapshot: HomeSnapshot = {
    region, day, builtAt: Date.now(),
    trending: trendingOut, upcoming: upcomingOut, people,
  };

  // ⚠️ RULE 3 + the atomic replace. One transaction: the item pins and the
  // payload move together, so the prune predicate can never see a row set that
  // disagrees with what the page is about to serve.
  const ids = [...trendingOut, ...upcomingOut]
    .filter((i) => i.linkable !== false)
    .map((i) => i.id);

  transaction(() => {
    run(
      `INSERT OR REPLACE INTO home_snapshot (region, day, built_at, payload)
       VALUES (?, ?, ?, ?)`,
      [region, day, snapshot.builtAt, JSON.stringify({
        trending: snapshot.trending, upcoming: snapshot.upcoming, people: snapshot.people,
      })],
    );
    run("DELETE FROM home_snapshot_item", []);
    for (const id of ids) {
      run("INSERT OR IGNORE INTO home_snapshot_item (media_item_id) VALUES (?)", [id]);
    }
  });

  log.info("home_snapshot_built", {
    region, day,
    trending: snapshot.trending.length,
    upcoming: snapshot.upcoming.length,
    people: snapshot.people.length,
    pinned: ids.length,
  });
  return snapshot;
}

/**
 * Give every rail item a catalog uuid + slug, and strip `raw`.
 *
 * The write half of `persistDiscoverBatch`, inlined here on purpose. See rule 2
 * above. Keeping this out of `annotateDiscover.ts` means no request path can
 * reach an unconditional persist by passing an argument.
 */
function persistRailItems<T extends { id: string; raw?: unknown }>(items: T[]): SnapshotItem[] {
  if (!items.length) return [];
  const idMap = persistDiscoverItems(items as never);
  const slugs = slugsForItemIds([...idMap.values()]);
  return items.map(({ raw: _raw, ...it }) => {
    const uuid = idMap.get(it.id);
    return (uuid
      ? { ...it, id: uuid, slug: slugs.get(uuid) ?? null }
      : { ...it, linkable: false }) as unknown as SnapshotItem;
  });
}
