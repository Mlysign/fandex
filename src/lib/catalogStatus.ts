import { retentionStatus } from "@/lib/retention";
import { laneStates, backfillEnabled, backfillMaxItems } from "@/lib/catalogBackfill";
import { housekeepingStatus } from "@/lib/catalogHousekeeping";
import { catalogBrowseEnabled, catalogBrowseMin, catalogWindowCount, catalogBrowseReady } from "@/lib/catalogFeed";
import { itemStatsStatus } from "@/lib/itemStats";
import { get } from "@/lib/db";
import type { MediaType } from "@/types";

// One snapshot of every catalog-growth job, for /api/health.
//
// Four background jobs now write to this database on a timer — retention, the
// fill, the backfill and housekeeping — and each has a state that is invisible
// from outside the process. A background job that reports nothing is
// indistinguishable from one that is not running, and this project has shipped
// that failure twice (the facet-cache sweep ran boot-only for six days; the
// fill job's first pass healed 0 of 10 and looked broken).
//
// ⚠️ Counts and flags only. No titles, no ids, no keys: /api/health is public.

const TYPES: MediaType[] = ["movie", "show", "game"];

export function catalogSnapshot() {
  const items = get<{ n: number }>(`SELECT COUNT(*) n FROM media_items`)?.n ?? 0;
  const browse: Record<string, { future: number; past: number; ready: boolean }> = {};
  for (const t of TYPES) {
    browse[t] = {
      future: catalogWindowCount(t, "future"),
      past: catalogWindowCount(t, "past"),
      // The question a reader actually has: is browse local for this type yet?
      ready: catalogBrowseReady(t, "future"),
    };
  }
  return {
    items,
    // TMDB caps caching at six months and nothing enforced it before today.
    retention: retentionStatus(),
    backfill: {
      enabled: backfillEnabled(),
      maxItems: backfillMaxItems(),
      lanes: laneStates().map((l) => ({ lane: l.lane, page: l.page, exhausted: !!l.exhausted, added: l.added })),
    },
    housekeeping: housekeepingStatus(),
    browse: { enabled: catalogBrowseEnabled(), min: catalogBrowseMin(), windows: browse },
    // Migration 27. `computed` climbing to `total` is the initial fill
    // draining; `stale` is the ongoing refresh queue. Both matter because a
    // catalog-served card with no stats sorts as if nobody had voted for it.
    stats: itemStatsStatus(),
  };
}
