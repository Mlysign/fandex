import { get, query, run, transaction } from "@/lib/db";
import { log, errorFields } from "@/lib/logger";
import { hubGenres } from "@/lib/homeHub";
import { popularPeople } from "@/lib/popularPeople";
import { PEOPLE_RAIL_SIZE } from "@/lib/homeSnapshot";
import { buildPublicFacetDetail } from "@/lib/detail/publicFacetDetail";
import type { LinkableFacetKind } from "@/lib/facetUrl";

// ── The facet link sweep (2026-09-02) ───────────────────────────────────────
//
// A public facet page renders up to 60 titles and links only the ones we
// already hold. Measured on the live catalog: `/person/christopher-nolan`
// linked 13 of 60. That is PR14 working as designed — the thin write is gated
// on a real session, so an anonymous render (every crawler, every logged-out
// visitor) resolves uuids with a plain SELECT and leaves the rest as dead text.
//
// Under-linked, not broken. It is also why the facet pages are deliberately
// kept out of the sitemap: advertising a hub page that dead-ends is worse than
// not advertising it.
//
// This closes it the way `home_snapshot` and `calendar_snapshot` already do:
// persist a BOUNDED set once a day, OFF the request path. Do not be tempted to
// relax PR14 instead — unbounded crawler-driven writes are what grew
// `media_items` to ~676k rows, and this sweep is the shape that was chosen over
// exactly that.
//
// ── Four things about it are load-bearing ──────────────────────────────────
//
// 1. ⚠️ IT DOES NOT GROW THE SITEMAP AND MOVES NO SCORE. The rows land
//    `browsed = 1` with no user state, and POOL_WHERE is
//    `(browsed = 0 OR id IN user_item_state)`, so they sit OUTSIDE the catalog
//    pool by construction: absent from `listPublicItems` (the sitemap), from
//    `discovery.ts`'s scoring vectors and IDF counts, and from the homepage hub.
//    They exist to give a title a uuid and a slug so a facet page can link it.
//    The point is a better hub page, not more thin pages — Search Console on
//    2026-09-02 said 4,089 of 4,090 sitemap URLs were not even crawled, so
//    adding thousands more would be answering a question nobody asked.
//
// 2. ⚠️ THE ROWS MUST SURVIVE THE BOOT PRUNE. They are `browsed = 1` and nobody
//    acts on them, which is exactly `dbPrune`'s predicate. `facet_snapshot_item`
//    exists to be named in `PRUNABLE_WHERE`. Without it the next deploy deletes
//    precisely the rows the facet pages link and the under-linking returns.
//
// 3. ⚠️ A FAILED BUILD MUST NOT CLEAR GOOD PINS. Same rule as the home
//    snapshot: a provider outage during a sweep would otherwise unpin a facet's
//    titles and let the next boot prune delete them. A facet that builds thin or
//    throws is SKIPPED, keeping its previous row and its previous pins.
//
// 4. ⚠️ THE TARGET SET MOVES, SO THE TABLES NEED A SWEEP. Genres are stable but
//    the people rail ROTATES daily, so `(kind, key)` is a growing key space —
//    the same shape that grew `calendar_snapshot` and, before it,
//    `facet_page_cache` to 222.8 MB. `pruneUntargetedFacets` deletes rows for
//    anything no longer targeted, on every run, and a test asserts it.

/** The facets worth spending a provider fan-out on: the ones `/` links. */
export interface FacetTarget {
  kind: LinkableFacetKind;
  key: string;
}

/** How long a facet's persisted links are good for. Daily, like the snapshots. */
export const FACET_SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How many facets one run may build.
 *
 * ⚠️ Read at CALL time, never at module load. Three safety gates shipped as
 * module-level constants once and all three had a test asserting the DEFAULT
 * instead of the behaviour, because setting the env var in a test does nothing
 * after the module is loaded.
 *
 * The default is deliberately small. Each facet is a provider fan-out (a studio
 * page is up to 8 TMDB discover calls), and the whole target set is ~56 facets,
 * so 8 per run covers everything in a day at an hourly cadence while keeping any
 * single run's provider cost near a rounding error against crawler traffic.
 */
export function facetSweepBatch(): number {
  const raw = process.env.FACET_SWEEP_BATCH;
  return raw === undefined || raw === "" ? 8 : Number(raw);
}

/** Unset = ON. A typo must leave the sweep running, same call as IGDB_ENABLED. */
export function facetSweepEnabled(): boolean {
  const v = (process.env.FACET_SWEEP_ENABLED ?? "").trim().toLowerCase();
  return v !== "0" && v !== "false";
}

/**
 * The facets this sweep targets: exactly the ones the homepage links.
 *
 * Not "every indexable facet", which is 1,202 people alone. These are the pages
 * with the most link equity pointing at them and the most crawler traffic
 * reaching them, so they are where a deeper outbound link graph actually pays.
 * Derived from the same two functions `/` renders from, rather than a second
 * list that would drift out of agreement with the page.
 */
export function facetSweepTargets(): FacetTarget[] {
  const tags: FacetTarget[] = hubGenres().map((g) => ({ kind: "tag" as const, key: g.key }));
  const people: FacetTarget[] = popularPeople()
    .slice(0, PEOPLE_RAIL_SIZE)
    .map((p) => ({ kind: "person" as const, key: p.key }));
  return [...tags, ...people];
}

/**
 * The targets due a rebuild, least-recently-built first, capped at `limit`.
 *
 * ⚠️ A facet with NO row sorts first (it has never been built), and ties break
 * on the target list's own order rather than alphabetically. `strftime` and
 * `Date.now()` at second resolution cannot separate facets built in the same
 * pass, which is how one backfill lane got hammered while five starved.
 */
export function dueFacets(limit = facetSweepBatch(), now: number = Date.now()): FacetTarget[] {
  const targets = facetSweepTargets();
  if (targets.length === 0) return [];

  const built = new Map<string, number>();
  for (const r of query<{ kind: string; key: string; built_at: number }>(
    "SELECT kind, key, built_at FROM facet_snapshot",
  )) {
    built.set(`${r.kind}|${r.key}`, r.built_at);
  }

  const due = targets
    .map((t, i) => ({ t, i, at: built.get(`${t.kind}|${t.key}`) ?? 0 }))
    .filter((r) => now - r.at >= FACET_SNAPSHOT_TTL_MS)
    .sort((a, b) => a.at - b.at || a.i - b.i);

  return due.slice(0, Math.max(0, limit)).map((r) => r.t);
}

/**
 * Drop rows for facets that are no longer targeted.
 *
 * The people rail rotates, so yesterday's twenty are not today's. Their pins
 * must be released or the pin table only ever grows and keeps `browsed` rows
 * alive that nothing links any more. Rule 4 in the header.
 */
export function pruneUntargetedFacets(): number {
  const keep = new Set(facetSweepTargets().map((t) => `${t.kind}|${t.key}`));
  const rows = query<{ kind: string; key: string }>("SELECT kind, key FROM facet_snapshot");
  let dropped = 0;
  transaction(() => {
    for (const r of rows) {
      if (keep.has(`${r.kind}|${r.key}`)) continue;
      run("DELETE FROM facet_snapshot_item WHERE kind = ? AND key = ?", [r.kind, r.key]);
      run("DELETE FROM facet_snapshot WHERE kind = ? AND key = ?", [r.kind, r.key]);
      dropped++;
    }
  });
  return dropped;
}

export interface FacetSweepResult {
  built: number;
  skipped: number;
  dropped: number;
  /** Items linked across the facets this run touched, and how many they showed. */
  linkable: number;
  items: number;
}

/**
 * Build the due facets with `persist: true`, pinning what they link.
 *
 * Returns counts rather than payloads: the caller is a background timer and the
 * payloads are already in the facet cache.
 */
export async function sweepFacetLinks(
  limit = facetSweepBatch(),
  now: number = Date.now(),
): Promise<FacetSweepResult> {
  const dropped = pruneUntargetedFacets();
  const due = dueFacets(limit, now);
  let built = 0, skipped = 0, linkable = 0, items = 0;

  for (const target of due) {
    try {
      // `persist: true` is the whole point of the sweep. PR14's gate is
      // untouched: this is a scheduled caller, not a request, exactly as the
      // home snapshot builder persists directly rather than faking a session.
      const payload = await buildPublicFacetDetail(
        { kind: target.kind, key: target.key },
        { persist: true },
      );

      // Rule 3: a thin or failed build keeps the previous row AND the previous
      // pins. `buildPublicFacetDetail` swallows a provider failure and returns
      // whatever pool it has, so an empty payload is the signal to skip.
      if (!payload || payload.items.length === 0) {
        skipped++;
        log.warn("facet_sweep_thin", { kind: target.kind, key: target.key });
        continue;
      }

      const ids = payload.items
        .filter((i) => i.linkable)
        .map((i) => i.id);

      transaction(() => {
        run("DELETE FROM facet_snapshot_item WHERE kind = ? AND key = ?", [target.kind, target.key]);
        for (const id of ids) {
          run(
            "INSERT OR IGNORE INTO facet_snapshot_item (kind, key, media_item_id) VALUES (?, ?, ?)",
            [target.kind, target.key, id],
          );
        }
        run(
          `INSERT OR REPLACE INTO facet_snapshot (kind, key, built_at, items, linkable)
           VALUES (?, ?, ?, ?, ?)`,
          [target.kind, target.key, now, payload.items.length, ids.length],
        );
      });

      built++;
      items += payload.items.length;
      linkable += ids.length;
    } catch (e) {
      skipped++;
      log.error("facet_sweep_failed", { kind: target.kind, key: target.key, ...errorFields(e) });
    }
  }

  if (built > 0 || skipped > 0 || dropped > 0) {
    log.info("facet_sweep_complete", { built, skipped, dropped, items, linkable });
  }
  return { built, skipped, dropped, items, linkable };
}

export interface FacetSweepCoverage {
  targets: number;
  covered: number;
  pinned: number;
  items: number;
  linkable: number;
  oldestBuiltAt: number | null;
}

/**
 * What the sweep has actually achieved, for `/api/health`.
 *
 * `linkable / items` is the number this whole module exists to move. A
 * component that renders nothing must know WHY, and so must an operator: an
 * empty sweep, a failing one and a caught-up one all look the same from
 * outside otherwise.
 */
export function facetSweepCoverage(): FacetSweepCoverage {
  const agg = get<{ n: number; items: number; linkable: number; oldest: number | null }>(
    `SELECT COUNT(*) n, COALESCE(SUM(items), 0) items,
            COALESCE(SUM(linkable), 0) linkable, MIN(built_at) oldest
       FROM facet_snapshot`,
  );
  const pinned = get<{ n: number }>("SELECT COUNT(*) n FROM facet_snapshot_item");
  return {
    targets: facetSweepTargets().length,
    covered: agg?.n ?? 0,
    pinned: pinned?.n ?? 0,
    items: agg?.items ?? 0,
    linkable: agg?.linkable ?? 0,
    oldestBuiltAt: agg?.oldest ?? null,
  };
}
