import { randomUUID } from "crypto";
import { query, run } from "@/lib/db";
import type { MediaSource } from "@/lib/sources/types";
import { SOURCES, getSource } from "@/lib/sources/registry";
import { ingestWishlistItem, ingestLibraryItem } from "@/lib/sources/ingest";
import { removeWatchlistSource, removeLibrarySource } from "@/lib/matcher";
import { crossLinkBudget } from "@/lib/sources/crossLink";
import type { PulledEpisode } from "@/lib/episodes";
import { reconcileProviderEpisodes } from "@/lib/episodes";

// Wall-clock budget for a single sync request (P6). The full ~1,700-item
// Trakt+Steam+TMDB sync in ONE request spiked memory past Railway's 512 MB and
// blocked the request; instead each request now processes whole providers only
// until this budget is spent, then returns the `remaining` provider ids so the
// caller can resume in a fresh request (memory reclaimed between calls). Tunable
// via SYNC_BUDGET_MS; a single provider always runs to completion (≥1 provider
// of progress per request), so this bounds latency without stalling.
export const DEFAULT_SYNC_BUDGET_MS = 25_000;

// Title searches one provider pass may spend giving games their missing catalog
// links. ~30 covers a normal sync (a handful of genuinely new titles, three
// sources each) without letting a never-backfilled catalog run for minutes.
export const MAX_CROSS_LINK_SEARCHES_PER_PASS = 30;

export function syncBudgetMs(): number {
  const raw = Number(process.env.SYNC_BUDGET_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SYNC_BUDGET_MS;
}

// ════════════════════════════════════════════════════════════════════════════
//  Generic sync — pulls every connected provider's wishlist + library through
//  the MediaSource adapter, then upserts / enriches / prunes. This replaces the
//  former hand-written syncTrakt/syncSteam/syncRawg/syncLetterboxd (+ *Library)
//  functions: adding a platform now needs only its adapter, not a sync routine.
// ════════════════════════════════════════════════════════════════════════════

export interface ProviderSyncResult {
  provider: string;
  wishlist: number;
  library: number;
  error?: string;
}

function logSync(userId: string, provider: string, count: number, status: string, error?: string) {
  run(
    "INSERT INTO sync_log (id, user_id, provider, item_count, status, error) VALUES (?, ?, ?, ?, ?, ?)",
    [randomUUID(), userId, provider, count, status, error ?? null]
  );
}

// Remove watchlist/library links for a source whose ids are no longer present.
//
// INVARIANT — a pull that FAILED must throw, never resolve to a partial/empty
// list. These prunes treat "absent from the pull" as "the user removed it
// upstream", so a swallowed error silently deletes everything the failed pull
// didn't return. (This is a real bug we shipped: Trakt's pulls used to
// `catch { return [] }`, which turned any transient 500/429/401 into a full
// wipe of the user's Trakt library — logged as status=ok.) The prunes below run
// only after a pull resolves, and the `catch` in syncProvider returns before
// them, so throwing is what makes an outage a no-op instead of a deletion.
function pruneWatchlist(userId: string, source: string, syncedIds: Set<string>) {
  const existing = query<{ media_item_id: string; source_id: string }>(
    `SELECT ml.media_item_id, ml.source_id FROM media_links ml
     JOIN user_watchlist uw ON uw.media_item_id = ml.media_item_id
     WHERE uw.user_id = ? AND ml.source = ?`,
    [userId, source]
  );
  for (const e of existing) {
    if (!syncedIds.has(e.source_id)) removeWatchlistSource(userId, e.media_item_id, source as any);
  }
}

function pruneLibrary(userId: string, source: string, syncedIds: Set<string>) {
  const existing = query<{ media_item_id: string; source_id: string }>(
    `SELECT ml.media_item_id, ml.source_id FROM media_links ml
     JOIN user_library ul ON ul.media_item_id = ml.media_item_id
     WHERE ul.user_id = ? AND ml.source = ?`,
    [userId, source]
  );
  for (const e of existing) {
    if (!syncedIds.has(e.source_id)) removeLibrarySource(userId, e.media_item_id, source as any);
  }
}

// Pull + ingest one provider's wishlist and library per its declared capabilities.
export async function syncProvider(userId: string, src: MediaSource): Promise<ProviderSyncResult> {
  const ctx = await src.context(userId);
  if (!ctx) return { provider: src.id, wishlist: 0, library: 0, error: "not connected" };

  let wishlist = 0;
  let library = 0;

  // One allowance for this provider's whole pass. Cross-linking a game to the
  // catalogs it's missing (Steam especially — it's the tag source) is per-item
  // and search-based, so an un-backfilled catalog could otherwise turn a routine
  // sync into hundreds of title searches. Items that already have their links
  // cost one indexed SELECT and never touch it, so in steady state this is
  // untouched; `scripts/backfill-game-crosslinks.ts` does the bulk pass.
  const budget = crossLinkBudget(MAX_CROSS_LINK_SEARCHES_PER_PASS);

  // ── Wishlist ──
  if (src.capabilities.wishlist.read && src.pullWishlist) {
    try {
      const items = await src.pullWishlist(ctx);
      const syncedIds = new Set<string>();
      for (const item of items) {
        await ingestWishlistItem(userId, src, item, budget);
        syncedIds.add(item.sourceId);
      }
      pruneWatchlist(userId, src.id, syncedIds);
      wishlist = syncedIds.size;
      logSync(userId, src.id, wishlist, "ok");
    } catch (e: any) {
      logSync(userId, src.id, wishlist, "error", e.message);
      return { provider: src.id, wishlist, library, error: e.message };
    }
  }

  // ── Library (watched / played / owned, with personal scores) ──
  if (src.capabilities.library.read && src.pullLibrary) {
    try {
      const items = await src.pullLibrary(ctx);
      const syncedIds = new Set<string>();
      // MB14 — per-episode state carried by this same pull, collected while we
      // ingest so we already know each item's canonical media_item_id.
      const episodesByItem = new Map<string, PulledEpisode[]>();
      for (const item of items) {
        const mediaItemId = await ingestLibraryItem(userId, src, item, budget);
        syncedIds.add(item.sourceId);
        if (item.episodes) episodesByItem.set(mediaItemId, item.episodes);
      }
      pruneLibrary(userId, src.id, syncedIds);
      // Both of these run ONLY here — after the pull resolved, inside the try.
      // The `catch` below returns before them, so a throwing pull leaves both
      // the library and the episode history untouched. Same invariant, same
      // placement: see pruneWatchlist/pruneLibrary's comment above.
      if (src.capabilities.episodes?.read) {
        const ep = reconcileProviderEpisodes(userId, src.id, episodesByItem);
        // The SHAPE of what the pull carried, not just what we wrote. Three
        // very different failures all end in "0 episodes", and only these
        // counts separate them:
        //   shows=0            the provider reported no watched shows at all
        //                      (e.g. they're in your Trakt COLLECTION but you
        //                      have never marked an episode watched there)
        //   withEpisodes=0     shows came back but carried no seasons array
        //   episodes>0 attached=0  we had it all already
        const showsSeen = items.filter((i) => i.episodes !== undefined).length;
        const withEpisodes = items.filter((i) => i.episodes && i.episodes.length > 0).length;
        const episodesSeen = items.reduce((n, i) => n + (i.episodes?.length ?? 0), 0);
        // Its OWN sync_log row. Without one, "the pull ran but wrote no
        // episodes" and "the pull never carried any episodes" are the same
        // silent nothing — and the module they feed renders nothing either, so
        // there is no other place the difference can surface. `item_count` is
        // the attach count; the shows-with-episodes tally rides in `status`.
        logSync(
          userId,
          `${src.id}-episodes`,
          ep.attached,
          `shows=${showsSeen} withEpisodes=${withEpisodes} episodes=${episodesSeen}` +
            ` attached=${ep.attached} detached=${ep.detached}`,
        );
      }
      library = syncedIds.size;
      logSync(userId, `${src.id}-library`, library, "ok");
    } catch (e: any) {
      logSync(userId, `${src.id}-library`, library, "error", e.message);
    }
  }

  return { provider: src.id, wishlist, library };
}

export interface SyncRunResult {
  results: ProviderSyncResult[];
  done: boolean;       // false → budget spent, more providers remain
  remaining: string[]; // provider ids not yet synced this pass (resume with these)
}

export interface SyncOptions {
  only?: string;        // "all" | a specific provider id | undefined (→ all)
  providers?: string[]; // explicit resume subset (overrides `only` when non-empty)
  budgetMs?: number;    // wall-clock budget; Infinity → drain in one pass
  now?: () => number;   // injectable clock (tests)
}

// The ordered, registry-filtered list of provider ids to sync for this request.
// A client-supplied `providers` resume list is intersected with the registry so
// junk ids can't drive work. Registry order is preserved.
export function providerQueue(only?: string, providers?: string[]): string[] {
  const all = Object.values(SOURCES)
    .filter((s): s is MediaSource => !!s)
    .map((s) => s.id);
  if (providers && providers.length) return all.filter((id) => providers.includes(id));
  if (only && only !== "all") return all.filter((id) => id === only);
  return all;
}

// Pure orchestration (no DB/network) so the budget/resume contract is unit
// testable: process the queue one provider at a time, stop STARTING new
// providers once the budget is spent, but always finish the current provider and
// always make at least one provider of progress. Returns the untouched tail as
// `remaining`.
export async function orchestrateSync<T>(
  queue: string[],
  budgetMs: number,
  processOne: (id: string) => Promise<T>,
  now: () => number = Date.now,
): Promise<{ results: T[]; done: boolean; remaining: string[] }> {
  const start = now();
  const results: T[] = [];
  for (let i = 0; i < queue.length; i++) {
    results.push(await processOne(queue[i]));
    if (now() - start >= budgetMs && i < queue.length - 1) {
      return { results, done: false, remaining: queue.slice(i + 1) };
    }
  }
  return { results, done: true, remaining: [] };
}

// Resumable, time-budgeted sync (P6). Syncs whole providers until the budget is
// spent; the caller re-invokes with `remaining` until `done`.
export async function runSync(userId: string, opts: SyncOptions = {}): Promise<SyncRunResult> {
  const queue = providerQueue(opts.only, opts.providers);
  const budgetMs = opts.budgetMs ?? syncBudgetMs();
  return orchestrateSync(
    queue,
    budgetMs,
    async (id) => {
      const src = getSource(id)!; // queue is registry-filtered, so this is defined
      return syncProvider(userId, src);
    },
    opts.now,
  );
}

// Backward-compatible one-shot: drain every provider in a single pass (no budget).
// For non-HTTP callers that want the whole result set synchronously.
export async function syncProviders(userId: string, only?: string): Promise<ProviderSyncResult[]> {
  const { results } = await runSync(userId, { only, budgetMs: Infinity });
  return results;
}
