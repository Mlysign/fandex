import { query } from "@/lib/db";
import { log, errorFields } from "@/lib/logger";
import { PROJECTION_VERSION } from "@/lib/sources/project";
import { loadLinks, healLinks, createHealBudget } from "@/lib/detail/enrich";
import type { MediaType } from "@/types";

// Catalog fill — the background half of docs/catalog-growth.md phase 1.
//
// ── What it is ──────────────────────────────────────────────────────────────
// A row written from a provider LIST payload is thin: `persistDiscoverItems`
// stamps projection version 0, and the item carries genres and a poster but no
// credits, no keywords and no watch providers. Today those rows heal only when
// somebody opens the title (`healLinks` on the detail path), so an item nobody
// clicks stays thin forever — and thin is exactly what makes the "Available on"
// filter, the Fandex Score and every facet page weaker than they could be.
//
// This walks the same backlog on a timer instead of waiting for a visitor. It
// is deliberately NOT a new fetch path: it calls the SAME `healLinks` the detail
// route does, so there is one definition of "healed" and one place that writes.
//
// ── Why it is paced this conservatively ─────────────────────────────────────
// Measured 2026-08-27 on the local DB: 312 stale tmdb links on movie/show items
// and 93 items with no watch-providers blob at all, so the backlog drains in
// about a day at these settings and then the query costs a few ms and does
// nothing. The default is 10 items every 30 minutes = **480 items/day**, one
// TMDB call each, against a provider whose free tier has no monthly ceiling.
//
// ⚠️ It is not paced for the phase-4 backfill. When 30–50k titles start
// arriving thin, this rate drains ~500/day and the numbers need re-deciding
// against `docs/scalability.md`, not just turned up.
//
// ⚠️ Every write here is WAL that Litestream ships. 480 rows/day is ~12 MB/day,
// which is nothing; 20,000 would not be. The batch cap is the thing keeping
// that true → [[prod-incidents]].

/** How many items one pass may heal. Small on purpose: see the pacing note. */
export const FILL_BATCH = Number(process.env.CATALOG_FILL_BATCH) || 10;
/** Wall-clock ceiling for one pass, so a slow provider can't run into the next. */
export const FILL_BUDGET_MS = Number(process.env.CATALOG_FILL_BUDGET_MS) || 60_000;
/**
 * Per-call ceiling, and deliberately 4× the request path's `DEFAULT_HEAL_CALL_MS`.
 *
 * ⚠️ Measured 2026-08-27: the first pass after boot reported `healed: 0` on ten
 * items that heal fine (600–1,200 ms each) when run by hand. The request-path
 * budget exists because a person is waiting for a page; nobody is waiting for
 * this, and a cold process still has to fetch a Twitch token and compile the
 * route before the first IGDB call lands. Under the tighter cap every item took
 * the `timeout` branch — where the write still lands late, so the work was not
 * wasted, but the pass reports zero and looks broken.
 */
export const FILL_CALL_MS = Number(process.env.CATALOG_FILL_CALL_MS) || 10_000;
/** How often the scheduler wakes up. */
export const FILL_INTERVAL_MS = Number(process.env.CATALOG_FILL_INTERVAL_MS) || 30 * 60 * 1000;
/**
 * How long after boot the first pass runs. Boot is the slowest the process ever
 * is — caches cold, routes uncompiled, provider tokens unfetched — and nothing
 * about this job is urgent.
 */
export const FILL_START_DELAY_MS = Number(process.env.CATALOG_FILL_START_MS) || 2 * 60 * 1000;

interface Candidate { id: string; type: MediaType }

/**
 * The next items worth healing, most useful first.
 *
 * Order, and each step is a decision:
 *  1. items somebody has acted on (library, wishlist, rating) — a thin row in
 *     your own library is the most visible kind of thin row;
 *  2. then pool items (`browsed = 0`), because those are what the catalog
 *     surfaces and the Fandex Score actually rank;
 *  3. then everything else, oldest sync first, so nothing starves.
 *
 * ⚠️ Ordering by `last_synced` rather than by a "tried and failed" marker means
 * a permanently unhealable row (the provider 404s it) is retried every pass
 * until something else is staler. `healLinks` treats that as a settled "miss"
 * and costs one call, so the waste is bounded and visible in the log line
 * below; if the backlog ever stops draining, THAT is the thing to look at.
 */
export function fillCandidates(limit: number): Candidate[] {
  return query<Candidate>(
    `SELECT i.id AS id, i.type AS type
       FROM media_items i
       JOIN media_links l ON l.media_item_id = i.id
      WHERE COALESCE(l.projection_version, 0) < ?
        AND l.source IN ('tmdb', 'igdb', 'rawg')
      GROUP BY i.id
      ORDER BY
        (SELECT COUNT(*) FROM user_item_state s WHERE s.media_item_id = i.id) DESC,
        COALESCE(i.browsed, 0) ASC,
        MIN(COALESCE(l.last_synced, 0)) ASC
      LIMIT ?`,
    [PROJECTION_VERSION, limit]
  );
}

export interface FillResult { considered: number; healed: number; skipped: number }

/**
 * Heal one batch. Returns what happened so the caller can log it — a background
 * job that reports nothing is indistinguishable from one that is not running.
 */
export async function fillCatalogBatch(
  limit = FILL_BATCH,
  budgetMs = FILL_BUDGET_MS
): Promise<FillResult> {
  const candidates = fillCandidates(limit);
  const out: FillResult = { considered: candidates.length, healed: 0, skipped: 0 };
  if (!candidates.length) return out;

  // ONE budget for the whole batch, which is what makes a dead provider cost a
  // single call rather than one per item: `healLinks` records the host in
  // `budget.down` and every later item skips it.
  const budget = createHealBudget(budgetMs, FILL_CALL_MS);
  for (const c of candidates) {
    if (Date.now() >= budget.deadlineAt) { out.skipped++; continue; }
    try {
      const links = loadLinks(c.id);
      if (!links.length) { out.skipped++; continue; }
      const res = await healLinks(links, c.type, budget);
      if (res.healed) out.healed++;
      else out.skipped++;
    } catch (e) {
      out.skipped++;
      log.error("catalog_fill_item_failed", { mediaItemId: c.id, ...errorFields(e) });
    }
  }
  return out;
}

/** True when there is nothing left to heal — the normal steady state. */
export function fillBacklog(): number {
  return (
    query<{ n: number }>(
      `SELECT COUNT(DISTINCT i.id) AS n
         FROM media_items i
         JOIN media_links l ON l.media_item_id = i.id
        WHERE COALESCE(l.projection_version, 0) < ?
          AND l.source IN ('tmdb', 'igdb', 'rawg')`,
      [PROJECTION_VERSION]
    )[0]?.n ?? 0
  );
}
