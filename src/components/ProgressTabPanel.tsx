"use client";
import { useEffect, useRef, useState } from "react";
import EpisodeRow, { EPISODE_ROW_GAP, entryKey } from "@/components/EpisodeRow";
import type { ProgressEntry } from "@/lib/progressFilter";
import EmptyState from "@/components/ui/EmptyState";
import Panel from "@/components/ui/Panel";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useEpisodeTick } from "@/lib/useEpisodeTick";

// MB16 — the library's Progress tab: the same "next episode per show" list as
// Home's rail, but the full one. Nils: *"this tap should have the same thing —
// list view items of episodes but this one is not limited to 10. it loads more
// and more when scrolling down."*
//
// So: the same <EpisodeRow>, the same tick (useEpisodeTick), no cap, and paging
// on scroll. Everything that decides WHICH episode is next stays in
// lib/upNext.ts — this is a second view of one list, not a second list.
//
// ── 2026-08-28: the toolbar's controls reach this tab ───────────────────────
// Nils: *"the advanced filters and search bar dont work on the progress page."*
// They didn't — MyStuffView returned early here and passed nothing, so four
// visible controls were inert. The list, the filtering and the sorting now live
// in MyStuffView beside the other two tabs' pipeline, because the toolbar has to
// count and describe the same set it is filtering ("episodes · 12", "Show 12
// episodes"). What is left here is the rendering: the rows, the tick, and the
// paging — which now pages the RENDER of a list already in hand, not the fetch.
// See lib/progressFilter.ts for the filter rules and lib/upNextFacts.ts for why
// the fetch is unpaged.

const PAGE_SIZE = 20;

export default function ProgressTabPanel({
  entries,
  totalUnfiltered,
  loading,
  error,
  onRetry,
  onRemove,
  /** Reset the render page when the FILTER changes — see the effect below. */
  resetKey,
  searchQuery,
  onClearSearch,
}: {
  /** Already filtered and sorted by the owner. */
  entries: ProgressEntry[];
  /** How many episodes exist before any filter — separates "caught up" from "no match". */
  totalUnfiltered: number;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onRemove: (key: string) => void;
  resetKey: string;
  searchQuery: string;
  onClearSearch: () => void;
}) {
  const { toast } = useToast();
  const [visible, setVisible] = useState(PAGE_SIZE);
  const sentinel = useRef<HTMLDivElement>(null);

  // Back to the first page whenever the filter or sort changes, and NOT when the
  // list merely shrinks. Ticking an episode removes a row; resetting on that
  // would yank someone who had scrolled to row 60 back to row 20 as a reward for
  // marking one watched.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setVisible(PAGE_SIZE); }, [resetKey]);

  // Infinite scroll. An IntersectionObserver on a sentinel below the list, not a
  // scroll handler: it fires once when the sentinel comes into view instead of
  // on every scroll frame, and it works the same whether the page or a parent
  // is the scroll container.
  const hasMore = visible < entries.length;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      (obs) => { if (obs.some((o) => o.isIntersecting)) setVisible((n) => n + PAGE_SIZE); },
      // Start the next page a screenful early so scrolling stays continuous.
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore]);

  const { done, leaving, tick } = useEpisodeTick({
    onRemove,
    // Deliberately NOT a full reload: re-fetching would throw away the scroll
    // position and re-run the whole derivation for one removed row. The removal
    // is the visible change, and the next visit picks up any promotion.
    onRefresh: () => {},
    onError: (m) => toast(m, "error"),
  });

  if (loading && totalUnfiltered === 0 && !error) {
    return (
      <div className="flex flex-col" style={{ gap: EPISODE_ROW_GAP }} aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[76px] rounded-lg border border-border bg-neutral-900/40 animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-body-sm text-text-secondary mb-2">{error}</p>
        <Button variant="ghost" onClick={onRetry}>Try again</Button>
      </div>
    );
  }

  // Nothing to show, and the two reasons read completely differently.
  if (totalUnfiltered === 0) {
    return (
      <Panel className="px-4 py-3.5">
        <p className="text-body-sm text-text-secondary">
          Nothing in progress. Once you&rsquo;ve watched an episode of a show, the next one shows up here.
        </p>
      </Panel>
    );
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        title={
          searchQuery
            ? <>No shows in progress match &ldquo;<span className="text-text-primary">{searchQuery}</span>&rdquo;</>
            : "No episodes match the current filters"
        }
        actions={searchQuery ? <Button variant="ghost" onClick={onClearSearch}>Clear search</Button> : undefined}
      />
    );
  }

  return (
    <div>
      <div className="flex flex-col" style={{ gap: EPISODE_ROW_GAP }}>
        {entries.slice(0, visible).map((e) => {
          const k = entryKey(e);
          return (
            <EpisodeRow key={k} entry={e} ticked={done.has(k)} exiting={leaving.has(k)} onTick={(x) => void tick(x)} />
          );
        })}
      </div>

      <div ref={sentinel} className="h-px" aria-hidden />

      {/* An explicit control as well as the observer, for three reasons: an
          IntersectionObserver needs a compositor and so never fires in some
          embedded/headless contexts; a keyboard user shouldn't have to simulate
          a scroll to reach the rest of the list; and when the observer does its
          job this is simply the thing it beats you to. */}
      {hasMore && (
        <div className="text-center py-4">
          <button
            type="button"
            onClick={() => setVisible((n) => n + PAGE_SIZE)}
            className="tap-44-y text-label text-text-secondary hover:text-text-primary transition-colors duration-fast"
          >
            Load more
          </button>
        </div>
      )}
      {!hasMore && entries.length > PAGE_SIZE && (
        <p className="font-mono text-meta text-text-secondary/70 text-center py-4">That&rsquo;s everything.</p>
      )}
    </div>
  );
}
