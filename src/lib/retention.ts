import { query, run, get } from "@/lib/db";
import { PROJECTION_VERSION } from "@/lib/sources/project";
import type { Source } from "@/types";

// Provider data retention — the clause nothing in this codebase was enforcing.
//
// ── Why this exists ─────────────────────────────────────────────────────────
// TMDB's API Terms of Use, section 1.C, forbid caching any information obtained
// from TMDB for longer than SIX MONTHS. It is a cap on AGE, not on size, and
// that distinction is the whole design: a stored catalog is fine, a stored
// catalog nobody ever re-fetches is not.
//
// Read 2026-08-28 at https://www.themoviedb.org/api-terms-of-use. Nothing here
// enforced it, and nothing would have: `healLinks` only re-fetches a link whose
// PROJECTION VERSION is behind (`isStale` in detail/enrich.ts), so once an item
// heals, its `last_synced` never moves again. Measured the same day: the oldest
// tmdb link was 2026-06-05, so the first breach would have landed silently
// around 2026-12-05, on an app that had simply not existed for six months yet.
//
// ── How it works, and why it is this small ──────────────────────────────────
// It does not fetch anything. It marks an ageing link's `projection_version`
// back to 0, which is exactly the "needs healing" marker `fillCandidates`
// already selects on and `healLinks` already acts on. So retention reuses the
// entire existing fetch, pacing, budget and logging path, and adds one UPDATE.
//
// ⚠️ Marking does NOT degrade the row. `raw_data` is untouched, so facets,
// scores and pages read exactly as before; the row is simply queued for a
// re-fetch that will reset `last_synced`.
//
// ⚠️ The LEAD is not padding for its own sake. Marking at five months leaves a
// month for the fill job to actually drain the queue, for a provider outage to
// pass, and for a title TMDB now 404s to be noticed while it is still legal to
// hold. Marking at exactly six months would guarantee a breach on any failure.

const MONTH_S = 30 * 24 * 60 * 60;

/**
 * Maximum age we may hold a provider's data, in seconds, per that provider's
 * own terms. A source absent from this map has no stated cap.
 *
 * ⚠️ Each entry is a CONTRACT, not a tuning knob. Raising one needs the
 * provider's terms re-read, not a judgement about what feels safe.
 *
 * - **tmdb: 6 months.** API Terms of Use §1.C, read 2026-08-28.
 * - **igdb: UNRESOLVED, deliberately absent.** The Twitch Developer Services
 *   Agreement (which IGDB's own docs name as its licence) allows storing copies
 *   only with prior written authorization, or a TWENTY-FOUR HOUR cache. Read
 *   2026-08-28 at legal.twitch.com/legal/developer-agreement. That is
 *   unworkable for a catalog and is contradicted by IGDB's own product, which
 *   ships webhooks whose only purpose is keeping YOUR copy of their data
 *   current. The contradiction is not ours to resolve by picking a number:
 *   it needs an answer from partner@igdb.com. Until then this enforces nothing
 *   for igdb, which is the honest state rather than a guessed one.
 * - **steam: no cap.** The Steam Web API Terms contemplate storing Steam Data
 *   (they require telling users about it and naming the country), and state no
 *   retention limit.
 */
export const RETENTION_MAX_AGE_S: Partial<Record<Source, number>> = {
  tmdb: 6 * MONTH_S,
};

/** How far ahead of the cap a link is queued for refresh. See the LEAD note. */
export const RETENTION_LEAD_S = 1 * MONTH_S;

/** Marked per pass. Bounded like every other background write → [[prod-incidents]]. */
export const RETENTION_BATCH = Number(process.env.RETENTION_BATCH) || 200;

export interface RetentionStatus {
  /** Links already past their provider's cap. Should be 0; anything else is a breach. */
  expired: number;
  /** Links inside the lead window, i.e. due for a refresh but not yet late. */
  due: number;
  /** Oldest link age in days, per capped source. */
  oldestDays: Partial<Record<string, number>>;
}

function cappedSources(): { source: Source; maxAge: number }[] {
  return Object.entries(RETENTION_MAX_AGE_S).map(([source, maxAge]) => ({
    source: source as Source, maxAge: maxAge as number,
  }));
}

/**
 * What the retention position actually is, for `/api/health` and for a human.
 *
 * ⚠️ `expired > 0` is not a warning, it is a term being breached. It should be
 * unreachable while the fill job drains, which is exactly why it is reported
 * rather than assumed.
 */
export function retentionStatus(): RetentionStatus {
  const now = Math.floor(Date.now() / 1000);
  const status: RetentionStatus = { expired: 0, due: 0, oldestDays: {} };
  for (const { source, maxAge } of cappedSources()) {
    const r = get<{ expired: number; due: number; oldest: number | null }>(
      `SELECT
         SUM(CASE WHEN last_synced < ? THEN 1 ELSE 0 END) expired,
         SUM(CASE WHEN last_synced < ? THEN 1 ELSE 0 END) due,
         MIN(last_synced) oldest
       FROM media_links WHERE source = ?`,
      [now - maxAge, now - (maxAge - RETENTION_LEAD_S), source]
    );
    status.expired += r?.expired ?? 0;
    status.due += r?.due ?? 0;
    if (r?.oldest) status.oldestDays[source] = Math.floor((now - r.oldest) / 86400);
  }
  return status;
}

/**
 * Queue ageing links for re-fetch by marking them un-projected.
 *
 * Returns what it did, because a background job that reports nothing is
 * indistinguishable from one that is not running.
 *
 * ⚠️ Only marks links that are NOT already queued (`projection_version >=
 * PROJECTION_VERSION`), so repeated passes are idempotent and cannot inflate
 * the fill backlog with the same rows.
 */
export function retentionSweep(batch = RETENTION_BATCH): { marked: number; source: string | null } {
  const now = Math.floor(Date.now() / 1000);
  let marked = 0;
  let lastSource: string | null = null;
  for (const { source, maxAge } of cappedSources()) {
    if (marked >= batch) break;
    const cutoff = now - (maxAge - RETENTION_LEAD_S);
    const rows = query<{ id: string }>(
      `SELECT id FROM media_links
        WHERE source = ? AND last_synced < ? AND COALESCE(projection_version, 0) >= ?
        ORDER BY last_synced ASC
        LIMIT ?`,
      [source, cutoff, PROJECTION_VERSION, batch - marked]
    );
    if (!rows.length) continue;
    run(
      `UPDATE media_links SET projection_version = 0
        WHERE id IN (${rows.map(() => "?").join(",")})`,
      rows.map((r) => r.id)
    );
    marked += rows.length;
    lastSource = source;
  }
  return { marked, source: lastSource };
}
