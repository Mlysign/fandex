"use client";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Check } from "lucide-react";
import { TypeIcon } from "@/components/Badges";

// MB16 — the one row used by BOTH episode surfaces: Home's "Up next" scroller
// and the library's Progress tab. Nils's spec, 2026-08-16: *"don't use the
// insight highlight panel as a foundation for the up next items, use the
// calendar list view items instead."*
//
// So the anatomy is <ListCard>'s, not the insight highlight panel's (a Home
// component, removed 2026-08-26). The anatomy gives it the same coloured
// type bar, the same flush full-height media, the same title-over-meta stack in
// a full-width bordered row. Three deliberate departures, all from the spec:
//
//   • the media is the show's POSTER, portrait, not ListCard's landscape
//     backdrop. An episode row is about the show, and the poster is what makes
//     one recognisable at a glance in a dense vertical list.
//   • the trailing action is a CHECKBOX, not <ActionCells>' wishlist toggle.
//     Wishlisting a show you're already midway through is meaningless; the only
//     action this row wants is "seen it".
//   • it is not a <Link> wrapper. The checkbox is a button inside the row, and
//     nesting a button inside an anchor is invalid HTML that browsers resolve
//     unpredictably (a tap can fire both). The TITLE is the link instead, which
//     also keeps the checkbox's 44px target free of navigation.
//
// ── Every row here is UNWATCHED ──────────────────────────────────────────────
// That is the premise of both surfaces, so the box is EMPTY at rest. A check on
// a resting row would read as "already seen", the one thing these lists never
// contain. Ticking is therefore unambiguous, and the caller animates the row out.

export interface EpisodeRowEntry {
  mediaItemId: string;
  showTitle: string;
  posterUrl: string | null;
  season: number;
  episode: number;
  episodeTitle: string | null;
  airDate: string | null;
  href: string;
}

/** The spec's format, verbatim: S.02 E.04. Shared with the old rail's label. */
export const epLabel = (season: number, episode: number) =>
  `S.${String(season).padStart(2, "0")} E.${String(episode).padStart(2, "0")}`;

export const entryKey = (e: { mediaItemId: string; season: number; episode: number }) =>
  `${e.mediaItemId}:${e.season}:${e.episode}`;

/**
 * Row height, exported because Home's scroller sizes itself in whole rows
 * ("roughly 2.5 list view items") and must not guess. Change it here and the
 * scroll section follows.
 */
export const EPISODE_ROW_H = 76;
export const EPISODE_ROW_GAP = 8;

export default function EpisodeRow({
  entry,
  ticked,
  exiting,
  onTick,
}: {
  entry: EpisodeRowEntry;
  /** The check is filled in — the write is in flight or just landed. */
  ticked: boolean;
  /** Ticked AND fading out. Kept separate so the check is seen before the exit. */
  exiting?: boolean;
  onTick: (entry: EpisodeRowEntry) => void;
}) {
  const [imgErr, setImgErr] = useState(false);

  return (
    <div
      style={{ height: EPISODE_ROW_H }}
      className={`flex items-stretch w-full bg-surface-elevated border border-border rounded-lg overflow-hidden transition-all duration-slow ease-accelerate motion-reduce:transition-none ${
        exiting ? "opacity-0 scale-[0.97] pointer-events-none" : "opacity-100 scale-100"
      }`}
    >
      {/* No type accent bar (removed 2026-08-16, Nils). ListCard carries one
          because its list mixes games, movies and shows and the colour is what
          tells them apart. Both episode surfaces are shows and only shows, so
          the bar encoded exactly zero information — it was a purple stripe on
          every row. The poster now sits flush at the leading edge. */}

      {/* Portrait poster, absolutely filled so its aspect ratio can never drive
          the row height — rows stay uniform, which is what lets the Home
          scroller size itself in whole rows. */}
      <div className="relative w-14 flex-shrink-0 bg-neutral-800 overflow-hidden">
        {entry.posterUrl && !imgErr ? (
          <Image
            src={entry.posterUrl}
            alt=""
            fill
            sizes="56px"
            className="object-cover"
            onError={() => setImgErr(true)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <TypeIcon type="show" size={16} className="text-text-muted" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0 px-3 py-2 flex flex-col justify-center gap-1">
        <div className="flex items-center gap-2 min-w-0">
          {/* The episode number as a CHIP, Showly's treatment (Nils, 2026-08-16
              — "make the episode number text a bit more readable"). It was
              `text-micro`, an 8px mono caption, which is the smallest step in
              the scale and unreadable at arm's length on a phone.
              `text-label-lg` (12.5px, weight 600) is ~56% larger, and the
              accent-subtle pill gives it an edge to sit against instead of
              floating above the title. `tabular-nums` keeps S02/S03 the same
              width so a column of rows doesn't shimmer. */}
          <span
            className="shrink-0 inline-flex items-center rounded-md px-1.5 py-1 font-mono text-label-lg tabular-nums"
            style={{ background: "var(--color-accent-subtle)", color: "var(--color-accent)" }}
          >
            {epLabel(entry.season, entry.episode)}
          </span>
          <Link
            href={entry.href}
            className="font-serif text-serif-sm text-text-primary truncate hover:opacity-80 transition-opacity duration-fast"
          >
            {entry.showTitle}
          </Link>
        </div>
        <span className="font-mono text-meta text-text-secondary truncate">
          {entry.episodeTitle || `Episode ${entry.episode}`}
        </span>
      </div>

      <div className="flex items-center pr-2 flex-shrink-0">
        <button
          type="button"
          onClick={() => onTick(entry)}
          disabled={ticked}
          aria-label={`Mark ${entry.showTitle} ${epLabel(entry.season, entry.episode)} watched`}
          className="w-11 h-11 flex items-center justify-center rounded-lg hover:bg-white/[0.05] transition-colors duration-fast"
        >
          {/* The same tick the item page's <EpisodeTracker> draws, so the two
              surfaces agree on what "watched" looks like. */}
          <span
            className={`w-7 h-7 rounded-sm border flex items-center justify-center transition-colors duration-fast ${
              ticked ? "bg-accent border-accent" : "border-border-strong"
            }`}
            aria-hidden
          >
            {ticked && <Check className="w-5 h-5 text-surface" strokeWidth={3} />}
          </span>
        </button>
      </div>
    </div>
  );
}
