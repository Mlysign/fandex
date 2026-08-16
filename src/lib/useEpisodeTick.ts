"use client";
import { useCallback, useState } from "react";
import { entryKey } from "@/components/EpisodeRow";
import type { EpisodeRowEntry } from "@/components/EpisodeRow";

// MB16 — the tick, shared by Home's "Up next" scroller and the library's
// Progress tab. Extracted from ProgressRail when the second surface appeared:
// the three-beat choreography below is the feature, and two copies of it would
// have drifted the first time either was touched.
//
// ── The three beats ─────────────────────────────────────────────────────────
// The check fills in (you did that), holds long enough to be seen even when the
// write is instant, then the row animates out and the caller refetches. On a
// refused write the check is TAKEN BACK and the row stays — /api/episodes writes
// locally then pushes, and reports a push failure, so the caller gets to say so
// rather than silently disagreeing with Trakt.

/** Long enough that a local-only write still shows you the check you just made. */
const CONFIRM_HOLD_MS = 260;
/** Matches `duration-slow` on the row, so removal lands as the fade finishes. */
const EXIT_MS = 320;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// globals.css already collapses CSS transitions under prefers-reduced-motion,
// but a JS wait is invisible to that rule — so read the query here too, the same
// way lib/scrollBehavior.ts does for JS-driven smooth scrolling.
function reducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const without = (set: Set<string>, k: string) => {
  const next = new Set(set);
  next.delete(k);
  return next;
};

export interface UseEpisodeTick {
  /** Keys whose check is filled in. */
  done: Set<string>;
  /** Keys ticked AND fading out. */
  leaving: Set<string>;
  /** Mark one episode watched, run the choreography, then drop + refresh. */
  tick: (entry: EpisodeRowEntry) => Promise<void>;
}

export function useEpisodeTick(opts: {
  /** Remove the row locally once its exit finishes. */
  onRemove: (key: string) => void;
  /** Refetch after removal — ticking may promote the next episode of the same show. */
  onRefresh: () => Promise<void> | void;
  /** Surface a failure. */
  onError: (message: string) => void;
}): UseEpisodeTick {
  const { onRemove, onRefresh, onError } = opts;
  const [done, setDone] = useState<Set<string>>(new Set());
  const [leaving, setLeaving] = useState<Set<string>>(new Set());

  const tick = useCallback(
    async (e: EpisodeRowEntry) => {
      const k = entryKey(e);
      // Already in flight — a second tap is a no-op, not a second write.
      if (done.has(k)) return;
      setDone((s) => new Set(s).add(k));

      try {
        const res = await fetch("/api/episodes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mediaItemId: e.mediaItemId,
            watched: true,
            episodes: [{ season: e.season, episode: e.episode }],
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Request failed (${res.status})`);
        }
        const data = await res.json().catch(() => ({}));
        // The local write succeeded even when the Trakt push didn't. Say so
        // rather than letting the two silently disagree — but do NOT roll back,
        // because the episode IS recorded here and the next sync reconciles it.
        if (data?.pushError) onError("Saved here, but Trakt didn't accept it.");
      } catch (err) {
        setDone((s) => without(s, k));
        onError(err instanceof Error ? err.message : "Couldn't save that.");
        return;
      }

      const quick = reducedMotion();
      if (!quick) await sleep(CONFIRM_HOLD_MS);
      setLeaving((s) => new Set(s).add(k));
      if (!quick) await sleep(EXIT_MS);

      // Drop it locally the moment the fade finishes, THEN refetch. The refetch
      // may heal a show's catalog from TMDB, so waiting for it would leave an
      // invisible row holding its space open for as long as that takes.
      onRemove(k);
      setDone((s) => without(s, k));
      setLeaving((s) => without(s, k));

      await onRefresh();
    },
    [done, onRemove, onRefresh, onError],
  );

  return { done, leaving, tick };
}
