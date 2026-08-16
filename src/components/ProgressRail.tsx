"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Loader2 } from "lucide-react";
import Rail from "@/components/Rail";
import Panel from "@/components/ui/Panel";
import Eyebrow from "@/components/ui/Eyebrow";
import { useToast } from "@/components/ui/Toast";

// Home's progress module (2026-08-16) — a carousel of "the episode you'd watch
// next", one card per show you're actually in the middle of. Replaces the three
// counters (library / wishlist / rated) that sat above the highlights and said
// the same thing every day.
//
// The relevance rules live server-side in lib/upNext.ts; this renders what it
// returns and owns nothing but the optimistic tick.
//
// Card anatomy is <HighlightPanel>'s, deliberately: accent mono eyebrow → serif
// headline → mono detail line. Here that maps to episode number → show title →
// episode title, so the module reads as part of the same band it sits in rather
// than a fourth panel style.

interface UpNextEntry {
  mediaItemId: string;
  showTitle: string;
  season: number;
  episode: number;
  episodeTitle: string | null;
  href: string;
}

/** The spec's format, verbatim: S.02 E.04. */
const epLabel = (season: number, episode: number) =>
  `S.${String(season).padStart(2, "0")} E.${String(episode).padStart(2, "0")}`;

export default function ProgressRail() {
  const { toast } = useToast();
  const [entries, setEntries] = useState<UpNextEntry[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/progress");
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setEntries(data.entries ?? []);
    } catch {
      // A failed progress fetch costs this module, never the page — Home's
      // rails come from a different request for exactly this reason.
      setEntries([]);
    }
  }, []);

  // Fetch-on-mount: the caller already knows the viewer is signed in, but the
  // per-user payload still has to be resolved client-side. Every setState below
  // happens after an await — the same justified disable the other islands carry.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function markDone(e: UpNextEntry) {
    const key = `${e.mediaItemId}:${e.season}:${e.episode}`;
    const prev = entries;
    // Optimistic: drop the card immediately, restore the whole list if the write
    // is refused. /api/episodes pushes to Trakt before writing, so a refusal
    // means nothing was recorded anywhere and the card genuinely belongs back.
    setEntries((list) => (list ?? []).filter((x) => x !== e));
    setBusy(key);
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
      // Refetch rather than splice: ticking this episode may promote the NEXT
      // one of the same show into the rail, which only the server can decide.
      await load();
    } catch (err) {
      setEntries(prev);
      toast(err instanceof Error ? err.message : "Couldn't save that.", "error");
    } finally {
      setBusy(null);
    }
  }

  // Nothing to continue is the normal state for a new account, so this renders
  // nothing at all rather than an empty-state panel competing with the rails.
  if (!entries?.length) return null;

  return (
    <Rail title="Up next" colsClass="auto-cols-[15rem]">
      {entries.map((e) => {
        const key = `${e.mediaItemId}:${e.season}:${e.episode}`;
        return (
          /* items-center, not items-start: the tick reads as the card's one
             action, so it sits on the card's vertical centre rather than
             hanging off the first line of text. */
          <Panel key={key} className="flex items-center gap-2 px-4 py-3.5 h-full">
            <Link href={e.href} className="min-w-0 flex-1 group">
              <Eyebrow>{epLabel(e.season, e.episode)}</Eyebrow>
              <div className="font-serif text-serif-md text-text-primary mt-1.5 line-clamp-2 transition-opacity group-hover:opacity-80">
                {e.showTitle}
              </div>
              <div className="font-mono text-meta text-text-secondary mt-1.5 line-clamp-1">
                {e.episodeTitle || `Episode ${e.episode}`}
              </div>
            </Link>
            <button
              onClick={() => void markDone(e)}
              disabled={busy === key}
              aria-label={`Mark ${e.showTitle} ${epLabel(e.season, e.episode)} watched`}
              className="group/tick shrink-0 w-11 h-11 -mr-2 flex items-center justify-center rounded-lg hover:bg-white/[0.05] transition-colors disabled:opacity-50"
            >
              {busy === key ? (
                <Loader2 className="w-5 h-5 animate-spin text-text-secondary" aria-hidden />
              ) : (
                /* EMPTY, like <EpisodeTracker>'s unchecked box — every episode
                   here is by definition unwatched, and a check drawn in it
                   would be a third state the item page doesn't have. The
                   section title plus the button's accessible name carry "mark
                   this watched"; the check only ever appears on hover. */
                <span
                  className="w-7 h-7 rounded-sm border border-border-strong flex items-center justify-center"
                  aria-hidden
                >
                  <Check
                    className="w-5 h-5 text-text-secondary opacity-0 group-hover/tick:opacity-100 transition-opacity"
                    strokeWidth={3}
                  />
                </span>
              )}
            </button>
          </Panel>
        );
      })}
    </Rail>
  );
}
