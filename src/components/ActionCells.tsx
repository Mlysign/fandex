"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { Star, Bookmark } from "lucide-react";
import type { QuickActionItem } from "@/lib/useQuickActions";
import { useQuickActions } from "@/lib/useQuickActions";
import { probeSession, resetSessionProbe } from "@/lib/sessionProbe";
import SignInDialog from "@/components/auth/SignInDialog";

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

// ── The quick-action button look, in ONE place (2026-08-18) ─────────────────
// Nils: "the rate, save and 'why' buttons dont have any hover behavior (no
// highlight, no cursor swap)." The cursor half was global (see globals.css); the
// highlight half was this.
//
// These buttons had `transition-colors` and no `hover:` anything, and adding one
// would NOT have worked: their fill came from an inline `style={{ background }}`,
// and an inline style beats every stylesheet rule short of `!important`. So the
// colours move into CSS CUSTOM PROPERTIES set inline — the inline style now names
// the values, and ordinary `hover:` utilities do the switching, because
// `bg-[var(--qa-bg)]` and `hover:bg-[var(--qa-bg-hover)]` are two normal rules
// competing on specificity rather than one of them fighting the style attribute.
//
// Shared with PersonalSection's Rate it / Save pair, which is the same control
// at a bigger size and previously carried its own copy of the same two style
// objects — they had already drifted (that copy has no `disabled:` handling).
export const QUICK_BTN_CLASS =
  "flex items-center justify-center gap-1.5 rounded-sm border transition-colors duration-fast " +
  "disabled:opacity-50 disabled:cursor-not-allowed " +
  "bg-[var(--qa-bg)] border-[var(--qa-border)] text-[var(--qa-fg)] " +
  "hover:bg-[var(--qa-bg-hover)] hover:border-[var(--qa-border-hover)] " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]";

/**
 * The four colour vars QUICK_BTN_CLASS reads. `active` = rated / wishlisted,
 * which takes the accent tint; otherwise the neutral idle fill. `mutedIdle`
 * dims the label for the secondary (bookmark) cell, matching what the two
 * layouts did before.
 */
export function quickBtnVars(active: boolean, mutedIdle = false): React.CSSProperties {
  return active
    ? {
        ["--qa-bg" as string]: "var(--color-accent-subtle)",
        ["--qa-bg-hover" as string]: "var(--fill-accent-hover)",
        ["--qa-border" as string]: "var(--color-accent-subtle)",
        ["--qa-border-hover" as string]: "var(--fill-accent-border-hover)",
        ["--qa-fg" as string]: "var(--color-accent)",
      }
    : {
        ["--qa-bg" as string]: "var(--fill-idle)",
        ["--qa-bg-hover" as string]: "var(--fill-idle-hover)",
        ["--qa-border" as string]: "var(--fill-idle-border)",
        ["--qa-border-hover" as string]: "var(--fill-idle-border-hover)",
        ["--qa-fg" as string]: mutedIdle ? "var(--color-text-secondary)" : "var(--color-text-primary)",
      };
}

// `onPick(null)` = REMOVE the rating. Re-clicking the star you're already rated
// at is the toggle-off gesture (2026-07-30): the whole clear-a-rating backend
// already existed and was simply unreachable — `/api/library` POST branches on
// `rating === null` → `clearRating` per provider, `recordLibraryRating` nulls
// the score while KEEPING the watched/played status, and `IntentAction` already
// allowed `{kind:"rate", value:null}`. Every caller here just typed the callback
// as `(n: number)`, so nothing could ever send it.
export function StarPicker({ rating, onPick }: { rating: number | null; onPick: (n: number | null) => void }) {
  const [hover, setHover] = useState(0);
  const shown = hover || rating || 0;
  return (
    <div className="flex items-center gap-0.5 bg-surface-overlay border border-border rounded-lg px-2 py-1.5 shadow-lg" onClick={stop} onMouseLeave={() => setHover(0)}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
        const clears = rating === n;
        return (
          // S3 (2026-07-27): height-only (.tap-44-y), not full .tap-44 — 10 stars
          // packed at gap-0.5 (2px) can't each claim 44px of WIDTH without
          // overlapping their neighbours (would need ~22px of clearance per
          // side); same tradeoff H1.6f accepted for SubBar's segmented
          // view-toggle. Width stays the glyph's real size; height reaches 44px.
          <button key={n} onMouseEnter={() => setHover(n)} onClick={(e) => { stop(e); onPick(clears ? null : n); }}
            title={clears ? "Remove your rating" : `${n}/10`}
            aria-label={clears ? "Remove your rating" : `Rate ${n} out of 10`}
            className="tap-44-y text-lg leading-none px-0.5 transition-transform hover:scale-125" style={{ color: shown >= n ? ratingColor(shown) : "var(--color-neutral-600)" }}>★</button>
        );
      })}
    </div>
  );
}

// Half the picker's rendered width, used to centre it on its trigger and to
// clamp it inside the viewport. The picker is 10 stars at a fixed size, so this
// is stable; measuring it would need a layout pass before the first paint.
const PICKER_W = 230;

export default function ActionCells({
  item, layout, linkable = true,
}: {
  item: QuickActionItem;
  layout: "row" | "card";
  /**
   * False = the card's item has no local `media_items` row (a genuine
   * first-sighting; see annotateDiscover.ts). 2026-08-18 — this used to be
   * decided by the CARD, which simply didn't render this bar at all, and that
   * produced Nils's "some cards on the home page did not have rate and wishlist
   * buttons": on a logged-out Home, whichever titles the providers returned
   * that we'd never persisted rendered as two-thirds of a card next to
   * complete ones, with nothing saying why.
   *
   * The bar's job for a SIGNED-OUT viewer is "prompt sign-in", which needs no
   * item identity at all — so a non-linkable item still gets a full, consistent
   * bar. For a signed-in viewer there is genuinely nothing to write against, so
   * it still renders nothing. Deciding that here rather than in the card keeps
   * the two callers (PosterCard, ListCard) from drifting.
   */
  linkable?: boolean;
}) {
  const { rating, wishlisted, busy, rate, toggleWishlist } = useQuickActions(item);
  const pathname = usePathname();
  // null = probe in flight. Module-cached across every card on the page, so a
  // 54-card grid still costs one /api/auth/me.
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [showSignIn, setShowSignIn] = useState(false);
  useEffect(() => { void probeSession().then(setAuthed); }, []);
  const anon = authed === false;
  const [picking, setPicking] = useState(false);
  // Viewport coords for the portalled picker — null until measured.
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const ratedRaw = typeof rating === "number" && rating > 0;

  const pick = (n: number | null) => { rate(n); setPicking(false); };

  // 2026-08-14 (Nils, mobile testing): "the rate panel is clipped by the
  // carousel border". The picker used to be an `absolute top-full` child of
  // this toolbar, and <Rail>'s scroller is `overflow-x-auto` — which
  // establishes a clipping box on BOTH axes, so a popover hanging below a card
  // inside a rail was cut off no matter how high its z-index. (T13 already hit
  // the same wall once and removed PosterCard's own overflow-hidden; the rail
  // one is not ours to remove — horizontal scrolling is the point.)
  //
  // So the picker now portals to document.body and positions itself from the
  // trigger's viewport rect, exactly like <Tooltip>. Nothing in the ancestor
  // chain can clip it. It closes on scroll rather than tracking the anchor:
  // the anchor lives in a scroller, and a popover that chases a moving card is
  // worse than one that gets out of the way.
  const measure = useCallback(() => {
    const anchor = (layout === "card" ? rootRef.current : triggerRef.current);
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const centred = r.left + r.width / 2 - PICKER_W / 2;
    const left = Math.max(8, Math.min(centred, window.innerWidth - PICKER_W - 8));
    // Flip above the trigger when there isn't room below, so a card near the
    // bottom of the viewport doesn't open its picker off-screen.
    const below = r.bottom + 6;
    const top = below + 44 > window.innerHeight ? Math.max(8, r.top - 50) : below;
    setPickerPos({ top, left });
  }, [layout]);

  // Dismiss the star picker on any click/tap outside the toolbar, or on
  // Escape (SM32: this used to only close on outside click, unlike the item
  // page's "Why?" popover — same pattern as FandexScoreSection). Escape also
  // returns focus to the trigger, so a keyboard user isn't left stranded.
  //
  // The outside test checks the PORTAL too: the picker is no longer a DOM
  // descendant of rootRef, so a plain `rootRef.contains(target)` would treat
  // every click on a star as an outside click and close before the rating
  // landed.
  useEffect(() => {
    if (!picking) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setPicking(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setPicking(false); triggerRef.current?.focus(); }
    };
    const onScroll = () => setPicking(false);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    // Capture phase: the rail's own scroller scrolls, not the window, and a
    // scroll event doesn't bubble.
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [picking]);

  const openPicker = () => { measure(); setPicking(true); };
  const togglePicker = () => { if (picking) setPicking(false); else openPicker(); };

  // The one picker instance, portalled. Rendered by both layouts.
  const pickerPortal =
    picking && pickerPos && typeof document !== "undefined"
      ? createPortal(
          <div ref={popRef} className="fixed z-[9999]" style={{ top: pickerPos.top, left: pickerPos.left }}>
            <StarPicker rating={rating} onPick={pick} />
          </div>,
          document.body,
        )
      : null;

  // ── Anonymous viewer ──────────────────────────────────────────────────────
  // Both buttons become one gesture: open the sign-in dialog. Before this they
  // ran the real write, which 401'd, and the optimistic state reverted behind a
  // "Couldn't save your rating. Please try again." toast — an error message for
  // something that was never going to work and that the viewer could fix
  // immediately if we'd said so.
  //
  // No `stashIntent` here, unlike the item page's PersonalSection: a card is not
  // a page, so there is no path to key the intent to and nothing to resume on
  // after the OAuth round-trip returns you to whatever list you were browsing.
  // Signing in and tapping the (now live) button again is one extra tap and
  // cannot fire against the wrong item.
  const requestSignIn = () => setShowSignIn(true);
  const signInPortal =
    showSignIn && typeof document !== "undefined"
      ? createPortal(
          <SignInDialog
            returnTo={pathname}
            onClose={() => setShowSignIn(false)}
            // RAWG sets the session in place with no navigation; reload so every
            // island on the page (including the other cards' probes) picks it up.
            onAuthenticated={() => { resetSessionProbe(); window.location.reload(); }}
          />,
          document.body,
        )
      : null;

  // Nothing to act on and nothing to offer: a signed-in viewer looking at an
  // item with no local row. Rendered as nothing, exactly as the cards used to do
  // for every viewer. Placed after every hook above so the hook order is stable.
  if (!linkable && !anon) return null;

  const rated = !anon && ratedRaw;
  const onList = !anon && wishlisted;
  const onRate = anon ? requestSignIn : togglePicker;
  const onWishlist = anon ? requestSignIn : () => { if (!busy) toggleWishlist(); };
  const rateTitle = anon ? "Sign in to rate" : rated ? `Your rating ${fmt(rating!)}/10` : "Rate";
  const rateLabel = anon
    ? "Sign in to rate this"
    : rated ? `Your rating ${fmt(rating!)} out of 10 — change rating` : "Rate this";
  const wishTitle = anon ? "Sign in to add to your wishlist" : onList ? "On wishlist" : "Add to wishlist";
  const wishLabel = anon
    ? "Sign in to add this to your wishlist"
    : onList ? "On your wishlist — remove" : "Add to wishlist";

  // 03-components.md §2's quick-action bar, literally: Rate = Star + "Rate",
  // flex:1; Bookmark = fixed 32px square. Both --radius-sm on the spec's
  // rgb(237 231 220 / 0.06) fill with a 1px border. Rated/wishlisted states
  // fill accent-subtle with an accent label and a FILLED glyph, per §2's
  // "rated" state. The 32px visible size is padded to a 44px tap area.
  const barBtn = `tap-44-y h-8 ${QUICK_BTN_CLASS}`;

  if (layout === "card") {
    return (
      <div className="relative" onClick={stop} ref={rootRef}>
        <div className="flex gap-1.5">
          <button
            ref={triggerRef}
            onClick={(e) => { stop(e); onRate(); }}
            title={rateTitle}
            aria-label={rateLabel}
            // A sign-in trigger opens a dialog, not the star popover it has no
            // access to — so it must not claim a popup it doesn't own.
            aria-haspopup={anon ? "dialog" : "true"}
            aria-expanded={anon ? undefined : picking}
            className={`${barBtn} flex-1 text-label`}
            style={quickBtnVars(rated)}
          >
            <Star className="w-3.5 h-3.5 shrink-0" fill={rated ? "currentColor" : "none"} aria-hidden />
            {rated ? fmt(rating!) : "Rate"}
          </button>
          <button
            onClick={(e) => { stop(e); onWishlist(); }}
            disabled={busy && !anon}
            title={wishTitle}
            aria-label={wishLabel}
            aria-pressed={anon ? undefined : onList}
            aria-haspopup={anon ? "dialog" : undefined}
            className={`${barBtn} w-8 shrink-0`}
            style={quickBtnVars(onList, true)}
          >
            <Bookmark className="w-3.5 h-3.5" fill={onList ? "currentColor" : "none"} aria-hidden />
          </button>
        </div>
        {pickerPortal}
        {signInPortal}
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
          ref={triggerRef}
          onClick={(e) => { stop(e); onRate(); }}
          title={rateTitle}
          aria-label={rateLabel}
          aria-haspopup={anon ? "dialog" : "true"}
          aria-expanded={anon ? undefined : picking}
          className={`${barBtn} w-14 shrink-0`}
          style={quickBtnVars(rated)}
        >
          <Star className="w-3.5 h-3.5 shrink-0" fill={rated ? "currentColor" : "none"} aria-hidden />
          {rated && fmt(rating!)}
        </button>
        <button
          onClick={(e) => { stop(e); onWishlist(); }}
          disabled={busy && !anon}
          title={wishTitle}
          aria-label={wishLabel}
          aria-pressed={anon ? undefined : onList}
          aria-haspopup={anon ? "dialog" : undefined}
          className={`${barBtn} w-8 shrink-0`}
          style={quickBtnVars(onList, true)}
        >
          <Bookmark className="w-3.5 h-3.5" fill={onList ? "currentColor" : "none"} aria-hidden />
        </button>
      </div>
      {pickerPortal}
      {signInPortal}
    </div>
  );
}
