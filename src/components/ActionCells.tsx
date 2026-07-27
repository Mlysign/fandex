"use client";
import { useEffect, useRef, useState } from "react";
import { BookmarkIcon, LibraryIcon } from "@/components/Badges";
import { useQuickActions, QuickActionItem } from "@/lib/useQuickActions";

// Persistent 3-cell action toolbar shared by PosterCard + ListCard (T11 mockup):
// Rate · Watched/Played · Wishlist. Always visible (works on touch), each cell is
// both an indicator and a control. The rate cell opens a 10-star picker — inline
// (to the left) in rows, popover (below) on cards.

// Same 7/5 cutoffs as before H1.6b — only the three hexes moved onto the
// design's tokens (success/warning/danger) instead of arbitrary literals.
const ratingColor = (r: number) => (r >= 7 ? "#5FE39A" : r >= 5 ? "#F0A04B" : "#E5674C");
const fmt = (r: number) => (r % 1 === 0 ? r.toFixed(0) : r.toFixed(1));
// N3 wrapped PosterCard/ListCard's root in a real <a> (for middle-click / open-
// in-new-tab). stopPropagation() alone doesn't cancel that ancestor <a>'s
// native "follow the link" default action — that's resolved by walking the DOM
// for the nearest activatable ancestor, independent of JS propagation — so
// nested controls need preventDefault() too, or every click here would also
// navigate to the item page.
const stop = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); };
const IDLE = "rgb(237 231 220 / 0.06)"; // matches the ghost-button hover fill

function StarPicker({ rating, onPick }: { rating: number | null; onPick: (n: number) => void }) {
  const [hover, setHover] = useState(0);
  const shown = hover || rating || 0;
  return (
    <div className="flex items-center gap-0.5 bg-surface-overlay border border-border rounded-lg px-2 py-1.5 shadow-lg" onClick={stop} onMouseLeave={() => setHover(0)}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        // S3 (2026-07-27): height-only (.tap-44-y), not full .tap-44 — 10 stars
        // packed at gap-0.5 (2px) can't each claim 44px of WIDTH without
        // overlapping their neighbours (would need ~22px of clearance per
        // side); same tradeoff H1.6f accepted for SubBar's segmented
        // view-toggle. Width stays the glyph's real size; height reaches 44px.
        <button key={n} onMouseEnter={() => setHover(n)} onClick={(e) => { stop(e); onPick(n); }} title={`${n}/10`} aria-label={`Rate ${n} out of 10`}
          className="tap-44-y text-lg leading-none px-0.5 transition-transform hover:scale-125" style={{ color: shown >= n ? ratingColor(shown) : "var(--color-neutral-600)" }}>★</button>
      ))}
    </div>
  );
}

export default function ActionCells({ item, layout }: { item: QuickActionItem; layout: "row" | "card" }) {
  const { rating, wishlisted, status, busy, rate, toggleWishlist, toggleWatched } = useQuickActions(item);
  const [picking, setPicking] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const rated = typeof rating === "number" && rating > 0;
  const inLibrary = !!status;

  const pick = (n: number) => { rate(n); setPicking(false); };

  // Dismiss the star picker on any click/tap outside the toolbar.
  useEffect(() => {
    if (!picking) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setPicking(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [picking]);

  // S3 (2026-07-27) — 44px minimum tap area, hit-only (visible size unchanged),
  // same `.tap-44`/`.tap-44-y` technique H1.6f used on SubBar. Card cells are
  // `flex-1` and already comfortably wider than 44px in practice (measured:
  // ~50-60px even at 375px viewport / a 2-up grid), so only height (32→44)
  // needs expanding — `.tap-44-y`, matching the width-already-fine case.
  // Row cells are FIXED 36×36, under 44 on both axes, so they need the full
  // `.tap-44` — which is why the row's own gap widens below (see the `gap-2`
  // note): three 44px-wide expansions at the old 4px gap would overlap by 4px
  // and start stealing taps from the neighbour, the exact trap the SubBar
  // comment warns about.
  const tapClass = layout === "card" ? "tap-44-y" : "tap-44";
  const cellSize = layout === "card" ? "flex-1 h-8" : "w-9 h-9 rounded-md";
  const cell = "flex items-center justify-center gap-0.5 text-xs font-bold transition-all hover:brightness-125 disabled:opacity-50 " + tapClass + " " + cellSize + (layout === "card" ? " rounded-md" : "");

  // Rate/Bookmark active states follow 03-components.md §2 literally (flat
  // accent, not the rating's own quality tier — that traffic-light coloring
  // stays in StarPicker's per-star hover only, where it helps you preview
  // what you're about to pick). Watched/library is a distinct STATUS signal
  // (success green), not a personal-preference one, so it keeps its own
  // color rather than collapsing into the same accent as rate/wishlist.
  const rateCell = (
    <button onClick={(e) => { stop(e); setPicking((v) => !v); }} title={rated ? `Your rating ${fmt(rating!)}/10` : "Rate"}
      aria-label={rated ? `Your rating ${fmt(rating!)} out of 10 — change rating` : "Rate this"} aria-haspopup="true" aria-expanded={picking}
      className={cell} style={rated ? { background: "var(--color-accent-subtle)", color: "var(--color-accent)" } : { background: IDLE, color: "var(--color-text-secondary)" }}>
      <span aria-hidden>★{rated ? ` ${fmt(rating!)}` : ""}</span>
    </button>
  );
  const watchedCell = (
    <button onClick={(e) => { stop(e); if (!busy) toggleWatched(); }} disabled={busy}
      title={inLibrary ? `In library — ${status}` : "Mark watched / played"}
      aria-label={inLibrary ? `In your library — ${status}` : "Mark as watched or played"} aria-pressed={inLibrary}
      className={cell} style={inLibrary ? { background: "var(--color-success-subtle)", color: "var(--color-success)" } : { background: IDLE, color: "var(--color-text-secondary)" }}>
      <LibraryIcon size={15} />
    </button>
  );
  const wishlistCell = (
    <button onClick={(e) => { stop(e); if (!busy) toggleWishlist(); }} disabled={busy}
      title={wishlisted ? "On wishlist" : "Add to wishlist"}
      aria-label={wishlisted ? "On your wishlist — remove" : "Add to wishlist"} aria-pressed={wishlisted}
      className={cell} style={wishlisted ? { background: "var(--color-accent-subtle)", color: "var(--color-accent)" } : { background: IDLE, color: "var(--color-text-secondary)" }}>
      <BookmarkIcon size={13} filled={wishlisted} />
    </button>
  );

  if (layout === "card") {
    return (
      <div className="relative" onClick={stop} ref={rootRef}>
        <div className="flex gap-1">{rateCell}{watchedCell}{wishlistCell}</div>
        {picking && (
          <div className="absolute z-30 top-full mt-1 left-1/2 -translate-x-1/2">
            <StarPicker rating={rating} onPick={pick} />
          </div>
        )}
      </div>
    );
  }

  // Row: star picker inline to the left of the cells. gap-2 (not gap-1) — the
  // three cells are fixed 36×36 (under 44 on both axes), so each gets the full
  // `.tap-44`; at the old 4px gap their 44px-wide expansions would overlap by
  // 4px (each cell bleeds (44-36)/2=4px toward its neighbour). 8px is the
  // minimum gap where the two expansions meet edge-to-edge instead of overlapping.
  return (
    <div className="flex items-center gap-2" onClick={stop} ref={rootRef}>
      {picking && <StarPicker rating={rating} onPick={pick} />}
      {rateCell}{watchedCell}{wishlistCell}
    </div>
  );
}
