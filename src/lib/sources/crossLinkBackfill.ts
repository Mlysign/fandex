import { query } from "@/lib/db";
import { crossLinkGame, GAME_SOURCES } from "./crossLink";
import type { Source } from "@/types";

// The bulk pass behind both `scripts/backfill-game-crosslinks.ts` and
// `/api/dev/crosslink`. One implementation, because the script runs against a
// local copy and the route runs against PROD — and those two answering
// differently about "what's missing" is exactly the kind of drift that makes a
// backfill impossible to reason about.
//
// Why a bulk pass exists at all: the sync adapters cross-link every item they
// ingest now, but they do it under a small per-pass allowance so a catalog that
// was never backfilled can't turn a routine sync into minutes of title
// searches. That allowance means an existing catalog drains slowly. This drains
// it deliberately instead.

export interface CrossLinkSurvey {
  totalGames: number;
  needing: number;
  missingBySource: Record<string, number>;
  sources: Source[];
}

interface GameRow { id: string; title: string; release_date: string | null; sources: string | null }

// Ordered by ID, not title: it's the cursor below, and it has to be stable and
// unique. Titles are neither.
function gameRows(): GameRow[] {
  return query<GameRow>(
    `SELECT mi.id, mi.title, mi.release_date,
            (SELECT GROUP_CONCAT(ml.source) FROM media_links ml WHERE ml.media_item_id = mi.id) AS sources
       FROM media_items mi
      WHERE mi.type = 'game'
      ORDER BY mi.id`
  );
}

const linkedOf = (r: GameRow) => new Set((r.sources ?? "").split(",").filter(Boolean));

/** Pure counts — safe to call any time, makes no network calls and writes nothing. */
export function surveyGameCrossLinks(sources: readonly Source[] = GAME_SOURCES): CrossLinkSurvey {
  const rows = gameRows();
  const missingBySource: Record<string, number> = {};
  let needing = 0;
  for (const r of rows) {
    const have = linkedOf(r);
    const missing = sources.filter((s) => !have.has(s));
    if (!missing.length) continue;
    needing++;
    for (const s of missing) missingBySource[s] = (missingBySource[s] ?? 0) + 1;
  }
  return { totalGames: rows.length, needing, missingBySource, sources: [...sources] };
}

export interface CrossLinkBatchResult {
  itemsProcessed: number;
  itemsLinked: number;
  addedBySource: Record<string, number>;
  /** Games still to VISIT after this batch. Reaches 0; see the cursor note. */
  remaining: number;
  /** Pass back as `afterId` to continue. Null when the sweep is complete. */
  nextAfterId: string | null;
  /** True when the batch stopped on its wall-clock budget rather than its count. */
  stoppedOnBudget: boolean;
}

/**
 * Cross-link a bounded slice of the catalog and report what's left.
 *
 * Bounded on BOTH counts and wall clock, because each item costs a real title
 * search (~0.6 s): the count keeps a run predictable, the clock keeps it inside
 * one request.
 *
 * ⚠️ Resumed by a CURSOR (`afterId`), not by re-filtering. A title the provider
 * genuinely doesn't have — 232 of this catalog's games simply are not on Steam,
 * mostly console exclusives — stays "missing a link" forever, however many times
 * it's searched. Driving the loop off "what's still missing" would therefore
 * never terminate: every call would re-search the same misses and `remaining`
 * would sit at 232 for good. The cursor advances past hits AND misses alike, so
 * a sweep visits each game once and then finishes.
 */
export async function runCrossLinkBatch(opts: {
  sources?: readonly Source[];
  maxItems?: number;
  budgetMs?: number;
  afterId?: string | null;
  onProgress?: (title: string, added: Source[]) => void;
} = {}): Promise<CrossLinkBatchResult> {
  const sources = opts.sources ?? GAME_SOURCES;
  const maxItems = opts.maxItems ?? 25;
  const deadline = opts.budgetMs != null ? Date.now() + opts.budgetMs : Infinity;
  const afterId = opts.afterId ?? null;

  const pending = gameRows().filter((r) => {
    if (afterId && r.id <= afterId) return false;
    const have = linkedOf(r);
    return sources.some((s) => !have.has(s));
  });

  const addedBySource: Record<string, number> = {};
  let itemsProcessed = 0;
  let itemsLinked = 0;
  let stoppedOnBudget = false;
  let lastId: string | null = null;

  for (const r of pending) {
    if (itemsProcessed >= maxItems) break;
    if (Date.now() >= deadline) { stoppedOnBudget = true; break; }
    itemsProcessed++;
    lastId = r.id;
    const added = await crossLinkGame(r.id, r.title, { sources, releaseDate: r.release_date });
    if (added.length) {
      itemsLinked++;
      for (const s of added) addedBySource[s] = (addedBySource[s] ?? 0) + 1;
    }
    opts.onProgress?.(r.title, added);
  }

  const remaining = Math.max(pending.length - itemsProcessed, 0);
  return {
    itemsProcessed,
    itemsLinked,
    addedBySource,
    remaining,
    nextAfterId: remaining > 0 ? lastId : null,
    stoppedOnBudget,
  };
}
