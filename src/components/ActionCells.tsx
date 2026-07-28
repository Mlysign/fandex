"use client";
import { useEffect, useRef, useState } from "react";
import { Star, Bookmark } from "lucide-react";
import { useQuickActions, QuickActionItem } from "@/lib/useQuickActions";

// Action toolbar shared by PosterCard + ListCard. Always visible (works on
// touch); each cell is both an indicator and a control. The rate cell opens a
// 10-star picker — inline (to the left) in rows, popover (below) on cards.
//
// LAYOUTS (2026-07-28 — A1 decision, mockup-gap-closeout):
//  - "card" is the design's quick-action bar, `03-components.md §2` verbatim:
//    exactly TWO buttons — a flex:1 "Rate" with a Star glyph + text label, and
//    a fixed 32px Bookmark square. Watched/played is deliberately NOT here
//    (Nils, 2026-07-27) — the mockup never had a third action, and the verb
//    stays reachable from the item detail page.
//  - "row" is now the SAME two-button shape, compacted for the fixed-width
//    cells a row has room for: a fixed-width Rate button (glyph + rating
//    value when rated, no text label) and a fixed Bookmark button. It was
//    three cells (including watched/played) until 2026-07-28, when Calendar's
//    AgendaRow became the only reachable list-shaped surface (ListCard is
//    dead code — all four GroupedView callers hardcode view="card") and
//    picked up this bar in place of its lone BellPlus button. One row shape,
//    not two, so ListCard inherits the right thing if list view ever returns.

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
  const { rating, wishlisted, busy, rate, toggleWishlist } = useQuickActions(item);
  const [picking, setPicking] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const rated = typeof rating === "number" && rating > 0;

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

  // 03-components.md §2's quick-action bar, literally: Rate = Star + "Rate",
  // flex:1; Bookmark = fixed 32px square. Both --radius-sm on the spec's
  // rgb(237 231 220 / 0.06) fill with a 1px border. Rated/wishlisted states
  // fill accent-subtle with an accent label and a FILLED glyph, per §2's
  // "rated" state. The 32px visible size is padded to a 44px tap area.
  const barBtn =
    "tap-44-y flex items-center justify-center gap-1.5 rounded-sm border transition-colors disabled:opacity-50 h-8";

  if (layout === "card") {
    return (
      <div className="relative" onClick={stop} ref={rootRef}>
        <div className="flex gap-1.5">
          <button
            onClick={(e) => { stop(e); setPicking((v) => !v); }}
            title={rated ? `Your rating ${fmt(rating!)}/10` : "Rate"}
            aria-label={rated ? `Your rating ${fmt(rating!)} out of 10 — change rating` : "Rate this"}
            aria-haspopup="true" aria-expanded={picking}
            className={`${barBtn} flex-1 text-label`}
            style={rated
              ? { background: "var(--color-accent-subtle)", borderColor: "var(--color-accent-subtle)", color: "var(--color-accent)" }
              : { background: IDLE, borderColor: "rgb(237 231 220 / 0.07)", color: "var(--color-text-primary)" }}
          >
            <Star className="w-3.5 h-3.5 shrink-0" fill={rated ? "currentColor" : "none"} aria-hidden />
            {rated ? fmt(rating!) : "Rate"}
          </button>
          <button
            onClick={(e) => { stop(e); if (!busy) toggleWishlist(); }}
            disabled={busy}
            title={wishlisted ? "On wishlist" : "Add to wishlist"}
            aria-label={wishlisted ? "On your wishlist — remove" : "Add to wishlist"}
            aria-pressed={wishlisted}
            className={`${barBtn} w-8 shrink-0`}
            style={wishlisted
              ? { background: "var(--color-accent-subtle)", borderColor: "var(--color-accent-subtle)", color: "var(--color-accent)" }
              : { background: IDLE, borderColor: "rgb(237 231 220 / 0.07)", color: "var(--color-text-secondary)" }}
          >
            <Bookmark className="w-3.5 h-3.5" fill={wishlisted ? "currentColor" : "none"} aria-hidden />
          </button>
        </div>
        {picking && (
          <div className="absolute z-30 top-full mt-1 left-1/2 -translate-x-1/2">
            <StarPicker rating={rating} onPick={pick} />
          </div>
        )}
      </div>
    );
  }

  // Row: the same two-button bar as "card" (2026-07-28, A1), just fixed-width
  // instead of flex-1 — a row has a fixed trailing slot, not a full-width
  // footer to fill.
  return (
    <div className="relative" onClick={stop} ref={rootRef}>
      <div className="flex gap-1.5">
        <button
          onClick={(e) => { stop(e); setPicking((v) => !v); }}
          title={rated ? `Your rating ${fmt(rating!)}/10` : "Rate"}
          aria-label={rated ? `Your rating ${fmt(rating!)} out of 10 — change rating` : "Rate this"}
          aria-haspopup="true" aria-expanded={picking}
          className={`${barBtn} w-14 shrink-0`}
          style={rated
            ? { background: "var(--color-accent-subtle)", borderColor: "var(--color-accent-subtle)", color: "var(--color-accent)" }
            : { background: IDLE, borderColor: "rgb(237 231 220 / 0.07)", color: "var(--color-text-primary)" }}
        >
          <Star className="w-3.5 h-3.5 shrink-0" fill={rated ? "currentColor" : "none"} aria-hidden />
          {rated && fmt(rating!)}
        </button>
        <button
          onClick={(e) => { stop(e); if (!busy) toggleWishlist(); }}
          disabled={busy}
          title={wishlisted ? "On wishlist" : "Add to wishlist"}
          aria-label={wishlisted ? "On your wishlist — remove" : "Add to wishlist"}
          aria-pressed={wishlisted}
          className={`${barBtn} w-8 shrink-0`}
          style={wishlisted
            ? { background: "var(--color-accent-subtle)", borderColor: "var(--color-accent-subtle)", color: "var(--color-accent)" }
            : { background: IDLE, borderColor: "rgb(237 231 220 / 0.07)", color: "var(--color-text-secondary)" }}
        >
          <Bookmark className="w-3.5 h-3.5" fill={wishlisted ? "currentColor" : "none"} aria-hidden />
        </button>
      </div>
      {picking && (
        <div className="absolute z-30 top-full mt-1 right-0">
          <StarPicker rating={rating} onPick={pick} />
        </div>
      )}
    </div>
  );
}
