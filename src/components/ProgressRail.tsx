"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import Rail from "@/components/Rail";
import Panel from "@/components/ui/Panel";
import Eyebrow from "@/components/ui/Eyebrow";
import { useToast } from "@/components/ui/Toast";

// Home's progress module (2026-08-16) — a carousel of "the episode you'd watch
// next", one card per show you're in the middle of. Replaces the three counters
// (library / wishlist / rated) that sat above the highlights.
//
// The relevance rules live server-side in lib/upNext.ts; this renders what it
// returns and owns nothing but the tick.
//
// Card anatomy is <HighlightPanel>'s, deliberately: accent mono eyebrow → serif
// headline → mono detail line. Here that maps to episode number → show title →
// episode title, so the module reads as part of the same band it sits in rather
// than a fourth panel style.
//
// ── EVERY card here is UNWATCHED ─────────────────────────────────────────────
// That is the rail's whole premise, so the tick box is EMPTY at rest — no
// check, not even a hover hint. A check on a resting card reads as "already
// seen", which is the one thing this list never contains.
//
// A tick therefore has exactly one meaning, and it plays out in three beats:
// the check fills in (you did that), it holds long enough to be seen even when
// the write is instant, then the card animates out and the list refetches. On a
// refused write the check is taken back and the card stays — /api/episodes
// pushes to Trakt BEFORE writing, so a refusal means nothing was recorded
// anywhere and the episode genuinely is still up next.

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

const entryKey = (e: UpNextEntry) => `${e.mediaItemId}:${e.season}:${e.episode}`;

/** Long enough that a local-only write still shows you the check you just made. */
const CONFIRM_HOLD_MS = 260;
/** Matches `duration-slow` on the card, so removal lands as the fade finishes. */
const EXIT_MS = 320;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// globals.css already collapses CSS transitions under prefers-reduced-motion,
// but a JS wait is invisible to that rule — so read the query here too, the same
// way lib/scrollBehavior.ts does for JS-driven smooth scrolling.
function reducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function ProgressRail() {
  const { toast } = useToast();
  const [entries, setEntries] = useState<UpNextEntry[] | null>(null);
  /** Ticked — the check is filled in. */
  const [done, setDone] = useState<Set<string>>(new Set());
  /** Ticked AND fading out. Kept separate so the check is visible before the exit. */
  const [leaving, setLeaving] = useState<Set<string>>(new Set());

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

  const without = (set: Set<string>, k: string) => {
    const next = new Set(set);
    next.delete(k);
    return next;
  };

  async function markDone(e: UpNextEntry) {
    const k = entryKey(e);
    if (done.has(k)) return; // already in flight — a second tap is a no-op
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
    } catch (err) {
      setDone((s) => without(s, k));
      toast(err instanceof Error ? err.message : "Couldn't save that.", "error");
      return;
    }

    const quick = reducedMotion();
    if (!quick) await sleep(CONFIRM_HOLD_MS);
    setLeaving((s) => new Set(s).add(k));
    if (!quick) await sleep(EXIT_MS);

    // Drop it locally the moment the fade finishes, THEN refetch. /api/progress
    // may heal a show's catalog from TMDB, so waiting for it would leave an
    // invisible card holding its column open for as long as that takes.
    setEntries((list) => (list ?? []).filter((x) => entryKey(x) !== k));
    setDone((s) => without(s, k));
    setLeaving((s) => without(s, k));

    // Refetch rather than stop there: ticking this episode may promote the NEXT
    // one of the same show into the rail, which only the server can decide.
    await load();
  }

  // Nothing to continue is the normal state for a new account, so this renders
  // nothing at all rather than an empty-state panel competing with the rails.
  if (!entries?.length) return null;

  return (
    <Rail title="Up next" colsClass="auto-cols-[15rem]">
      {entries.map((e) => {
        const k = entryKey(e);
        const ticked = done.has(k);
        const exiting = leaving.has(k);
        return (
          /* items-center, not items-start: the tick reads as the card's one
             action, so it sits on the card's vertical centre rather than
             hanging off the first line of text.

             ease-accelerate is the design system's EXIT curve — this only ever
             animates one way, out. */
          <Panel
            key={k}
            className={`flex items-center gap-2 px-4 py-3.5 h-full transition-all duration-slow ease-accelerate motion-reduce:transition-none ${
              exiting ? "opacity-0 scale-90 pointer-events-none" : "opacity-100 scale-100"
            }`}
          >
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
              disabled={ticked}
              aria-label={`Mark ${e.showTitle} ${epLabel(e.season, e.episode)} watched`}
              className="shrink-0 w-11 h-11 -mr-2 flex items-center justify-center rounded-lg hover:bg-white/[0.05] transition-colors"
            >
              {/* Filled accent once ticked — the same "watched" tick the item
                  page's <EpisodeTracker> draws, so the two agree. */}
              <span
                className={`w-7 h-7 rounded-sm border flex items-center justify-center transition-colors duration-fast ${
                  ticked ? "bg-accent border-accent" : "border-border-strong"
                }`}
                aria-hidden
              >
                {ticked && <Check className="w-5 h-5 text-surface" strokeWidth={3} />}
              </span>
            </button>
          </Panel>
        );
      })}
    </Rail>
  );
}
