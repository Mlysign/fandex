"use client";
import { useEffect, useRef, useState } from "react";

// <CollapsibleChips> — a row of chips that is ONE chip until you tap it.
//
// SM53 (Nils, 2026-09-02): "dont shrink but collapse the 3 filters and expand on
// tap (type filters, list filters, view toggle). shrinking the type filter must
// apply to all pages, not just calendar. consitency is key."
//
// ── What it is for ──────────────────────────────────────────────────────────
// At 375x812 the calendar's sticky bar took 175px, 22% of the viewport, on the
// one page whose entire design is a fixed height budget: seven 40px chips
// wrapping to two rows, plus a 38px view-toggle row. Shrinking the chips was
// rejected — they already carry a 44x44 hit area and cutting that is a
// regression, not a saving. Collapsing costs a tap and gives the grid ~110px.
//
// ── Why this is a wrapper and not a prop on each filter ────────────────────
// Because the consistency requirement is the point. `TypeFilter` and
// `ScopeFilter` are deliberate twins (same 40px circular anatomy, same tap-44),
// and the last time they were changed independently they drifted. One wrapper
// means the disclosure behaves identically wherever it appears, and a third
// group can adopt it without re-deciding anything.
//
// ── The rules it has to keep ───────────────────────────────────────────────
// - ONE outcome per tap target. The summary chip is a disclosure and nothing
//   else: it never also applies a filter. Two behaviours on one target is what
//   makes thumb placement decide the outcome. → [[calendar-day-first-and-viewport-fit]]
// - It stays open until DISMISSED, not until the next selection. These groups
//   are multi-select, so closing on every tap would make choosing two things a
//   four-tap job.
// - The summary is `aria-expanded` and the panel keeps its own `role="group"`,
//   so a screen reader gets a disclosure rather than a chip that mutates.
// - Escape closes it, and focus returns to the summary chip. A control you can
//   open with a keyboard and not close with one is a trap.

export interface CollapsibleChipsProps {
  /** The collapsed chip's icon. Reflects the group's CURRENT state. */
  summaryIcon: React.ReactNode;
  /** Accessible name for the collapsed chip, e.g. "Filter by type". */
  label: string;
  /** Short hover title, e.g. "Type". */
  title: string;
  /**
   * How many selections are active. Rendered as the same corner badge the
   * advanced-filters trigger uses, and only when it TELLS you something:
   *
   *   - not at the default (or the badge contradicts the neutral styling — the
   *     calendar's three scopes are all on by default, so a "3" there announced
   *     a narrowing that was not happening);
   *   - and more than one (a single active chip already says so through
   *     `summaryIcon`, so a badge reading "1" beside it is noise).
   */
  activeCount: number;
  /** True when the group is at its default (nothing narrowed). Styles the chip. */
  isDefault: boolean;
  /** The real chips, rendered in place of the summary while open. */
  children: React.ReactNode;
}

const INACTIVE_CLASS =
  "border-border-strong text-text-secondary bg-transparent hover:border-neutral-400";

export default function CollapsibleChips({
  summaryIcon,
  label,
  title,
  activeCount,
  isDefault,
  children,
}: CollapsibleChipsProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLButtonElement>(null);
  // Set when Escape closed the group, so focus goes back to the chip the user
  // opened. An outside CLICK must not steal focus back — they are already
  // somewhere else on purpose.
  const restoreFocus = useRef(false);

  // Dismiss on an outside pointer or Escape. `pointerdown` rather than `click`
  // so a tap that lands on another control closes this group BEFORE that
  // control's own handler runs, instead of leaving two panels open at once.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      restoreFocus.current = true;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // ⚠️ Focus AFTER the collapse has rendered, not inside the Escape handler.
  // The first version called `summaryRef.current?.focus()` there, and the ref is
  // still null at that point because the summary chip does not exist until the
  // state change paints — so Escape closed the group and dropped focus to
  // `<body>`. Measured, not guessed: `document.activeElement` came back null.
  useEffect(() => {
    if (open || !restoreFocus.current) return;
    restoreFocus.current = false;
    summaryRef.current?.focus();
  }, [open]);

  return (
    <div ref={wrapRef} className="flex items-center gap-2">
      {open ? (
        children
      ) : (
        <button
          ref={summaryRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          aria-label={label}
          title={title}
          className={`tap-44 relative w-10 h-10 shrink-0 rounded-full border flex items-center justify-center transition-colors ${
            isDefault ? INACTIVE_CLASS : "border-accent text-accent hover:bg-accent-subtle"
          }`}
        >
          {summaryIcon}
          {!isDefault && activeCount > 1 && (
            <span
              aria-hidden
              className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-accent text-text-on-accent font-mono text-[10px] font-bold leading-4 text-center"
            >
              {activeCount}
            </span>
          )}
        </button>
      )}
    </div>
  );
}
