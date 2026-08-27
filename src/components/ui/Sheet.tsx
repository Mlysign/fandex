"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// <Sheet> / <Modal> — 03-components.md §12. ONE component: bottom sheet on
// mobile (<768px), centered modal on desktop (≥768px) — same breakpoint
// convention as AppNav. Traps focus, restores it to the invoker on close,
// dismisses on scrim click / Escape. Swipe-down-to-dismiss is not
// implemented (mouse/keyboard + tap-scrim only) — a gesture library isn't in
// the dependency set; revisit in H1.6f polish if it's missed.
//
// Used for: Rate flow, the mobile Discover filter sheet, confirm-remove
// (danger), where-to-watch expand — ConfirmDialog is the first consumer.

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export default function Sheet({ open, onClose, title, children, className = "" }: SheetProps) {
  const [rendered, setRendered] = useState(open);
  const [visible, setVisible] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Mount → next frame flips `visible` so the CSS transition actually runs;
  // unmount is delayed by --transition-duration-slow so the exit transition
  // can play (the 320 below must stay in step with that token).
  useEffect(() => {
    if (open) {
      returnFocusRef.current = document.activeElement as HTMLElement;
      // Mounting-on-open is inherently syncing to an external prop
      // transition, not derivable during render — same justified disable as
      // Tooltip.tsx's layout-measurement effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRendered(true);
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const t = setTimeout(() => setRendered(false), 320);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open || !rendered) return;
    const panel = panelRef.current;
    // A child's `autoFocus` (e.g. the delete-account confirm's input) applies
    // synchronously during commit, before this effect runs — only claim
    // focus for the panel itself if nothing inside it already has it.
    if (panel && !panel.contains(document.activeElement)) panel.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, rendered, onClose]);

  useEffect(() => {
    if (rendered || !returnFocusRef.current) return;
    returnFocusRef.current.focus();
    returnFocusRef.current = null;
  }, [rendered]);

  if (!rendered) return null;

  // ── Why this is a PORTAL (2026-08-27) ────────────────────────────────────
  // Nils: the filter sheet "renders too high and is cut off". It was not a
  // sizing bug. Measured at 375×812: this backdrop is `fixed inset-0` and
  // computed to 170px tall, against 812 for an identical fixed element
  // appended to <body> on the same page.
  //
  // The cause is the SubBar this sheet was rendered inside. `useHideOnScroll`
  // toggles Tailwind's `translate-y-0` / `-translate-y-full`, and in Tailwind
  // v4 those set the standalone CSS `translate` property. **A non-`none`
  // `translate` establishes a containing block for fixed-position descendants
  // even when its value is ZERO**, so the bar trapped every sheet opened from
  // it, retracted or not: `inset: 0` resolved against a 171px bar, and
  // `items-end` then parked the sheet at the bottom of THAT box — near the top
  // of the screen, with 118px of it above the viewport and no scroll to
  // recover it.
  //
  // ⚠️ A `max-height` would have been the wrong fix: it only makes a clipped
  // panel scrollable inside a 170px box, which reads as deliberate.
  // ⚠️ Walking ancestors for `transform` will NOT find this — `transform`
  // reads `none` while `translate` reads `0px`. Check `translate`, `rotate`
  // and `scale` as separate properties.
  //
  // Portalling to <body> puts the sheet outside every such containing block,
  // for this and for every other Sheet consumer (ConfirmDialog, the rate flow,
  // where-to-watch), any of which could be opened from a transformed ancestor
  // tomorrow. `typeof document` guards the server render.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center"
      role="presentation"
    >
      <div
        aria-hidden
        onClick={onClose}
        className={`absolute inset-0 bg-black/60 transition-opacity duration-base ${visible ? "opacity-100" : "opacity-0"}`}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`relative w-full sm:max-w-[480px] sm:mx-4 bg-surface-overlay border border-border
          rounded-t-xl sm:rounded-xl shadow-sheet sm:shadow-lg outline-none
          transition-transform duration-slow ease-decelerate
          ${visible ? "translate-y-0 sm:scale-100" : "translate-y-full sm:translate-y-0 sm:scale-95"}
          ${className}`}
      >
        <div className="sm:hidden flex justify-center pt-2.5 pb-1" aria-hidden>
          <span className="w-9 h-1 rounded-full bg-neutral-600" />
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}
