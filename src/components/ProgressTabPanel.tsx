"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import EpisodeRow, { EPISODE_ROW_GAP, entryKey } from "@/components/EpisodeRow";
import type { EpisodeRowEntry } from "@/components/EpisodeRow";
import Panel from "@/components/ui/Panel";
import { useToast } from "@/components/ui/Toast";
import { useEpisodeTick } from "@/lib/useEpisodeTick";

// MB16 — the library's Progress tab: the same "next episode per show" list as
// Home's rail, but the full one. Nils: *"this tap should have the same thing —
// list view items of episodes but this one is not limited to 10. it loads more
// and more when scrolling down."*
//
// So: the same <EpisodeRow>, the same tick (useEpisodeTick), no cap, and paging
// on scroll instead of a fixed-height scroller. Everything that decides WHICH
// episode is next stays in lib/upNext.ts — this is a second view of one list,
// not a second list.

const PAGE_SIZE = 20;

export default function ProgressTabPanel() {
  const { toast } = useToast();
  const [entries, setEntries] = useState<EpisodeRowEntry[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);

  // `entries.length` is the offset — deliberately, rather than a page counter.
  // The server re-derives the whole list on every request, so a tick that
  // removed a row shrinks that list too; asking for "everything after what I'm
  // holding" stays correct, while `page * PAGE_SIZE` would skip an episode.
  //
  // Taking `entries` as a dependency gives this a new identity per page, so the
  // observer effect below re-subscribes each time. That is cheap (one
  // disconnect + observe) and it is what keeps the offset honest without a ref
  // — reading a ref during render is both a lint error here and a genuine
  // correctness hazard under StrictMode's double-invocation.
  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    setError(null);
    try {
      const offset = entries.length;
      const res = await fetch(`/api/progress?limit=${PAGE_SIZE}&offset=${offset}`);
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      const page: EpisodeRowEntry[] = data.entries ?? [];
      // Dedupe on the way in. Paging over a list that can shift under you (a
      // tick removes an entry, a sync adds one) can legitimately repeat a row,
      // and a duplicate React key is a rendering bug, not a cosmetic one.
      setEntries((prev) => {
        const seen = new Set(prev.map(entryKey));
        return [...prev, ...page.filter((e) => !seen.has(entryKey(e)))];
      });
      setTotal(typeof data.total === "number" ? data.total : null);
      setHasMore(!!data.hasMore);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load more.");
      // Stop the observer from retrying in a tight loop against a failing
      // endpoint; the retry button below puts the user back in control.
      setHasMore(false);
    } finally {
      setLoading(false);
      setReady(true);
    }
  }, [entries, loading, hasMore]);

  // First page, exactly once. Guarded by a ref rather than an empty dep array:
  // `loadMore`'s identity changes with every page, so `[]` would pin a stale
  // closure, while `[loadMore]` alone would refire on each page. The ref is set
  // INSIDE the effect (never during render), and it survives StrictMode's
  // remount, so development doesn't double-fetch page 0 either.
  //
  // Every setState in loadMore happens after an await, so none runs
  // synchronously in the effect body — the same justified disable the other
  // client islands in this repo carry.
  const started = useRef(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void loadMore();
  }, [loadMore]);

  // Infinite scroll. An IntersectionObserver on a sentinel below the list, not a
  // scroll handler: it fires once when the sentinel comes into view instead of
  // on every scroll frame, and it works the same whether the page or a parent
  // is the scroll container.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      (obs) => { if (obs.some((o) => o.isIntersecting)) void loadMore(); },
      // Start the next page a screenful early so scrolling stays continuous.
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadMore]);

  const { done, leaving, tick } = useEpisodeTick({
    onRemove: (k) => setEntries((list) => list.filter((x) => entryKey(x) !== k)),
    // Deliberately NOT a full reload: re-fetching page 0 would throw away every
    // page already scrolled past and jump the viewport to the top. The removal
    // above is the visible change, and the next page picks up any promotion.
    onRefresh: () => {},
    onError: (m) => toast(m, "error"),
  });

  if (!ready) {
    return (
      <div className="flex flex-col" style={{ gap: EPISODE_ROW_GAP }} aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[76px] rounded-lg border border-border bg-neutral-900/40 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!entries.length) {
    return (
      <Panel className="px-4 py-3.5">
        <p className="text-body-sm text-text-secondary">
          Nothing in progress. Once you&rsquo;ve watched an episode of a show, the next one shows up here.
        </p>
      </Panel>
    );
  }

  return (
    <div>
      {total != null && (
        <p className="font-mono text-meta text-text-secondary mb-3 px-1">
          {total} episode{total === 1 ? "" : "s"} up next
        </p>
      )}

      <div className="flex flex-col" style={{ gap: EPISODE_ROW_GAP }}>
        {entries.map((e) => {
          const k = entryKey(e);
          return (
            <EpisodeRow key={k} entry={e} ticked={done.has(k)} exiting={leaving.has(k)} onTick={(x) => void tick(x)} />
          );
        })}
      </div>

      <div ref={sentinel} className="h-px" aria-hidden />

      {loading && (
        <p className="font-mono text-meta text-text-secondary text-center py-4">Loading more…</p>
      )}

      {/* An explicit control as well as the observer, for three reasons: an
          IntersectionObserver needs a compositor and so never fires in some
          embedded/headless contexts; a keyboard user shouldn't have to simulate
          a scroll to reach the rest of the list; and when the observer does its
          job this is simply the thing it beats you to. */}
      {hasMore && !loading && !error && (
        <div className="text-center py-4">
          <button
            type="button"
            onClick={() => void loadMore()}
            className="tap-44-y text-label text-text-secondary hover:text-text-primary transition-colors duration-fast"
          >
            Load more
          </button>
        </div>
      )}
      {error && (
        <div className="text-center py-4">
          <p className="text-body-sm text-text-secondary mb-2">{error}</p>
          <button
            type="button"
            onClick={() => { setHasMore(true); void loadMore(); }}
            className="tap-44-y text-label text-accent hover:opacity-80 transition-opacity"
          >
            Try again
          </button>
        </div>
      )}
      {!hasMore && !error && entries.length > PAGE_SIZE && (
        <p className="font-mono text-meta text-text-secondary/70 text-center py-4">That&rsquo;s everything.</p>
      )}
    </div>
  );
}
