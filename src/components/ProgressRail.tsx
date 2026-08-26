"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import Panel from "@/components/ui/Panel";
import Skeleton from "@/components/ui/Skeleton";
import Button from "@/components/ui/Button";
import EpisodeRow, { EPISODE_ROW_GAP, EPISODE_ROW_H, entryKey } from "@/components/EpisodeRow";
import type { EpisodeRowEntry } from "@/components/EpisodeRow";
import { useToast } from "@/components/ui/Toast";
import { useEpisodeTick } from "@/lib/useEpisodeTick";
import { syncToCompletion } from "@/lib/syncClient";

// Home's progress module — "the episode you'd watch next", one row per show
// you're in the middle of. Replaced the three counters (library / wishlist /
// rated) that sat above the highlights.
//
// ── 2026-08-16 REBUILD (Nils) ───────────────────────────────────────────────
// The first cut borrowed the insight highlight panel's anatomy in a horizontal
// <Rail>. (That component was Home's, and went when Nils removed the highlights
// on 2026-08-26.)
// Nils: *"don't use the insight highlight panel as a foundation … use the
// calendar list view items instead … render the list item full width and don't
// use a horizontal carousel, use a vertical carousel instead."* So:
//
//   • the row is <EpisodeRow> — <ListCard>'s anatomy, with the show's poster
//     and a checkbox where the wishlist toggle would be.
//   • the scroller is VERTICAL and full width, its own scroll region about
//     2.5 rows tall, so it reads as a peek-and-scroll list rather than a band
//     of cards. The 2.5 is deliberate: a half-row at the fold is what tells you
//     there's more without needing a scrollbar to say so.
//   • "See all" goes to the library's Progress tab, matching every other rail.
//
// The relevance rules stay server-side in lib/upNext.ts; this renders what it
// returns. The tick lives in useEpisodeTick, shared with that tab.

/** Why the rail is empty — see lib/upNext.ts's UpNextStatus. */
interface UpNextStatus {
  episodeProviderConnected: boolean;
  episodeRows: number;
  showsTracked: number;
  showsAwaitingCatalog: number;
  lastEpisodeSync: { at: number | null; count: number | null; status: string | null; error: string | null } | null;
  lastLibrarySync: { at: number | null; count: number | null; status: string | null; error: string | null } | null;
}

/** Where "See all" goes. The tab is a real query param, so it deep-links. */
export const PROGRESS_TAB_HREF = "/library?tab=progress";

/**
 * The scroll region's height, in whole rows plus the gaps between them —
 * "roughly 2.5 list view items". Derived from EpisodeRow's own exported metrics
 * rather than hard-coded, so changing the row height can't silently leave this
 * showing 2.1 or 3.4 rows.
 */
const VISIBLE_ROWS = 2.5;
const SCROLLER_H = Math.round(EPISODE_ROW_H * VISIBLE_ROWS + EPISODE_ROW_GAP * (Math.ceil(VISIBLE_ROWS) - 1));

export default function ProgressRail() {
  const { toast } = useToast();
  const [entries, setEntries] = useState<EpisodeRowEntry[] | null>(null);
  const [status, setStatus] = useState<UpNextStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/progress");
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setEntries(data.entries ?? []);
      setStatus(data.status ?? null);
    } catch {
      // A failed progress fetch costs this module, never the page — Home's
      // rails come from a different request for exactly this reason. `status`
      // stays null, which the empty state below reports as exactly that rather
      // than guessing at a friendlier reason.
      setEntries([]);
      setStatus(null);
    }
  }, []);

  // Fetch-on-mount: the caller already knows the viewer is signed in, but the
  // per-user payload still has to be resolved client-side. Every setState below
  // happens after an await — the same justified disable the other islands carry.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const { done, leaving, tick } = useEpisodeTick({
    onRemove: (k) => setEntries((list) => (list ?? []).filter((x) => entryKey(x) !== k)),
    onRefresh: load,
    onError: (m) => toast(m, "error"),
  });

  async function runSync() {
    setSyncing(true);
    try {
      await syncToCompletion("trakt");
      await load();
    } finally {
      setSyncing(false);
    }
  }

  // Still resolving. This used to `return null`, and that was the other half of
  // the layout shift Nils reported on 2026-08-26: this section sits ABOVE Home's
  // public rails, so occupying no space until the fetch landed meant every
  // signed-in load painted and then shoved the whole page down.
  //
  // ⚠️ The height here is not a guess. It is the header plus SCROLLER_H, the
  // exact box the loaded rail renders into, derived from EpisodeRow's own
  // metrics — so filling it moves nothing. If the loaded layout changes, this
  // has to change with it, which is why both read the same constants.
  //
  // Still not an empty state: `null` was right about not flashing "you're all
  // caught up" at somebody who is not. A skeleton says "loading", which is true.
  if (entries === null) {
    return (
      <section aria-hidden>
        <div className="flex items-center justify-between gap-3 mb-3 px-1">
          <div className="font-serif text-serif-md text-text-primary">Up next</div>
        </div>
        <div style={{ height: SCROLLER_H, gap: EPISODE_ROW_GAP }} className="flex flex-col overflow-hidden">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="shrink-0 rounded-lg" style={{ height: EPISODE_ROW_H }} />
          ))}
        </div>
      </section>
    );
  }

  if (!entries.length) {
    return (
      <section>
        <h2 className="font-serif text-serif-md text-text-primary mb-3 px-1">Up next</h2>
        <Panel className="px-4 py-3.5">
          <p className="text-body-sm text-text-secondary">{emptyReason(status)}</p>
          {emptyDetail(status) && (
            /* The raw counts from the last sync. Deliberately shown: three
               different failures all end in "no episodes", and this is the only
               thing that separates them for someone without a console. */
            <p className="font-mono text-micro text-text-secondary/70 mt-2 break-all">
              {emptyDetail(status)}
            </p>
          )}
          {status?.episodeProviderConnected && (
            <Button variant="secondary" size="sm" pill loading={syncing} onClick={() => void runSync()} className="mt-3">
              {syncing ? "Syncing Trakt…" : "Sync Trakt now"}
            </Button>
          )}
        </Panel>
      </section>
    );
  }

  return (
    <section>
      {/* Header matches <Rail>'s exactly — same serif h2, same "See all" with
          its arrow — because this IS one of Home's rails to the reader, even
          though it scrolls the other way and can't reuse the component. */}
      <div className="flex items-center justify-between gap-3 mb-3 px-1">
        <h2 className="font-serif text-serif-md text-text-primary">Up next</h2>
        <Link
          href={PROGRESS_TAB_HREF}
          className="inline-flex items-center gap-1 text-label text-text-secondary hover:text-text-primary transition-colors shrink-0"
        >
          See all
          <ArrowRight className="w-3.5 h-3.5" aria-hidden />
        </Link>
      </div>

      {/* Its own scroll region, ~2.5 rows tall. `overscroll-contain` stops a
          flick that reaches the end from chaining into the page scroll, which
          on a phone is the difference between a peek-list and a scroll trap. */}
      <div
        style={{ height: SCROLLER_H, gap: EPISODE_ROW_GAP }}
        className="flex flex-col overflow-y-auto overscroll-contain snap-y snap-proximity pr-0.5 [scrollbar-width:thin]"
      >
        {entries.map((e) => {
          const k = entryKey(e);
          return (
            <div key={k} className="snap-start shrink-0">
              <EpisodeRow entry={e} ticked={done.has(k)} exiting={leaving.has(k)} onTick={(x) => void tick(x)} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * The one line that says WHY the rail is empty.
 *
 * It exists because "nothing synced yet", "still fetching episode lists",
 * "you're caught up" and "the Trakt pull is failing" all render as the same
 * blank space — and the first thing that happened after this shipped to prod
 * was exactly that ambiguity (a sync ran, the rail stayed empty, and there was
 * no way to tell which of the four it was from a phone).
 *
 * Ordered most-actionable first, and it never claims success it can't see: a
 * failed library pull is reported as a failure, not as "no data yet".
 */
function emptyReason(status: UpNextStatus | null): string {
  if (!status) return "Couldn't load your progress just now. Reload to try again.";

  const lib = status.lastLibrarySync;
  if (lib?.status && lib.status !== "ok") {
    return `Your last Trakt sync failed, so there's no episode history to show. ${lib.error ?? "No reason was recorded"}.`;
  }

  if (status.episodeRows === 0) {
    if (!status.episodeProviderConnected) {
      return "Connect Trakt, or tick an episode on any show, and the next one you'd watch shows up here.";
    }
    // Trakt IS connected and the library pull didn't fail, yet no episode rows
    // exist. Either no sync has run since episode tracking shipped, or Trakt
    // reports nothing watched.
    return status.lastEpisodeSync
      ? "Your last sync pulled no episode data from Trakt. The counts below say which part came back empty."
      : "No episode history yet. Sync Trakt to pull in what you've watched.";
  }

  if (status.showsAwaitingCatalog > 0) {
    return `Looking up episode lists for ${status.showsAwaitingCatalog} show${
      status.showsAwaitingCatalog === 1 ? "" : "s"
    }. Syncing fills these in.`;
  }

  return `You're caught up on all ${status.showsTracked} show${status.showsTracked === 1 ? "" : "s"} you're tracking.`;
}

/**
 * The raw last-sync counts, shown only when the sentence above can't be
 * specific enough. `shows=0` means Trakt reported no WATCHED shows at all
 * (they may be in your collection or watchlist instead); `withEpisodes=0` with
 * `shows>0` means the response carried no seasons.
 */
function emptyDetail(status: UpNextStatus | null): string | null {
  if (!status || status.episodeRows > 0) return null;
  const s = status.lastEpisodeSync;
  return s?.status ? `last sync · ${s.status}` : null;
}
