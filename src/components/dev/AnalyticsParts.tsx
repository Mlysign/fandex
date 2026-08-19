"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";

// Shared chrome for the two admin dashboards (/dev/analytics, /dev/users).
// One copy on purpose: the repo has been bitten repeatedly by two surfaces that
// render the same thing from two implementations and then drift apart.
//
// Charts are hand-rolled CSS bars, the same call as insights/Histogram.tsx. A
// charting dependency for a handful of bar charts is bundle cost and
// supply-chain surface for no gain.

export function num(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * The "what does this number mean" affordance.
 *
 * Hover alone would be useless on the phone this gets read on, so it toggles on
 * CLICK and additionally opens on hover for a pointer. `title` is deliberately
 * not used: it never appears on touch and is unstyleable.
 *
 * The popover is width-capped against the VIEWPORT, not just the card, because a
 * fixed-width absolute panel near the right edge is its own horizontal-overflow
 * bug, which is the failure mode this codebase keeps re-learning (MB7).
 */
export function Hint({ text, label }: { text: string; label?: string }) {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const open = pinned || hovered;

  // Both open paths go through React state rather than a `group-hover:` class,
  // which looks like needless machinery until you need the clamp below: a
  // CSS-only hover never runs any measurement, so a hover-opened tooltip near the
  // right edge would overflow while a click-opened one did not.
  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!open || !tip) return;
    // Reset before measuring, or successive opens compound the shift.
    tip.style.left = "0px";
    const r = tip.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const M = 8;
    let shift = 0;
    if (r.right > vw - M) shift = vw - M - r.right;
    if (r.left + shift < M) shift = M - r.left;
    // `left`, NOT `transform`. A transform moves the pixels and leaves the layout
    // box where it was, so the tooltip would look correct while the document's
    // scrollWidth still reported the overflow, which is the thing that makes
    // Chrome shrink-to-fit and drops the fixed mobile nav below the fold (MB7).
    // Measured: with translateX the popover fit the viewport and scrollWidth was
    // still 419 on a 320px screen.
    if (shift) tip.style.left = `${Math.round(shift)}px`;
  }, [open, text]);

  useEffect(() => {
    if (!pinned) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setPinned(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinned(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [pinned]);

  return (
    <span
      ref={ref}
      className="relative inline-flex align-middle"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        onClick={() => setPinned((v) => !v)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        aria-expanded={open}
        aria-label={label ? `What "${label}" means` : "What this means"}
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-border-strong text-[9px] leading-none text-text-secondary hover:text-text-primary hover:border-accent transition-colors cursor-pointer"
      >
        i
      </button>
      <span
        ref={tipRef}
        role="tooltip"
        className={`absolute z-30 top-full left-0 mt-1 w-max max-w-[min(17rem,calc(100vw-1rem))] rounded-lg border border-border bg-surface-overlay px-2.5 py-2 text-[11px] leading-snug text-text-primary shadow-lg whitespace-normal text-left font-normal ${
          open ? "block" : "hidden"
        }`}
      >
        {text}
      </span>
    </span>
  );
}

export function RangeTabs({
  value, options, onChange,
}: {
  value: number;
  options: readonly number[];
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex gap-1">
      {options.map((r) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          aria-pressed={value === r}
          className={`px-2.5 py-1 rounded-lg text-xs border transition-colors cursor-pointer ${
            value === r
              ? "border-accent text-accent bg-accent-subtle"
              : "border-border text-text-secondary hover:text-text-primary"
          }`}
        >
          {r}d
        </button>
      ))}
    </div>
  );
}

export function Stat({
  label, value, sub, hint,
}: {
  label: string; value: string; sub?: string; hint?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface-elevated px-4 py-3">
      <div className="text-2xl font-semibold tabular-nums text-text-primary">{value}</div>
      <div className="text-xs text-text-secondary mt-0.5 flex items-center gap-1">
        <span className="min-w-0 truncate">{label}</span>
        {hint && <Hint text={hint} label={label} />}
      </div>
      {sub && <div className="text-[11px] text-text-secondary mt-0.5">{sub}</div>}
    </div>
  );
}

export function Panel({
  title, children, note, hint,
}: {
  title: string; children: React.ReactNode; note?: string; hint?: string;
}) {
  return (
    // min-w-0 is load-bearing, and this was measured overflowing by 2px at 320px
    // before it was added. A GRID item defaults to `min-width: auto` exactly as a
    // flex item does, so the panel refused to shrink below its own content and
    // pushed the page wider than the viewport. That is the MB7 mechanism: the
    // overflow makes Chrome shrink-to-fit, the layout viewport inflates, and the
    // `fixed bottom-0` mobile nav pins itself below the fold.
    <section className="min-w-0 rounded-xl border border-border bg-surface-elevated p-4">
      <h2 className="text-label text-text-secondary mb-3 flex items-center gap-1.5">
        <span className="min-w-0 truncate">{title}</span>
        {hint && <Hint text={hint} label={title} />}
      </h2>
      {children}
      {note && <p className="mt-3 text-[11px] leading-snug text-text-secondary">{note}</p>}
    </section>
  );
}

export interface SeriesPoint {
  day: string;
  /** Lower (subtle) segment of the stacked bar. */
  a: number;
  /** Upper (accent) segment. */
  b: number;
}

/**
 * Daily bars over a date range, optionally stacked into two segments.
 *
 * Zero-filled by the caller, which matters: a gap in the data and a day with no
 * traffic read identically to a person, but a chart that omits empty days draws
 * a flat line straight through an outage.
 */
export function DaySeriesChart({
  series, labelA, labelB, emptyNote,
}: {
  series: SeriesPoint[];
  labelA?: string;
  labelB?: string;
  emptyNote?: string;
}) {
  const max = Math.max(1, ...series.map((d) => d.a + d.b));
  const empty = series.every((d) => d.a + d.b === 0);

  return (
    <div>
      <div className="flex items-end gap-px h-40" role="img" aria-label={`Daily values, ${series.length} days`}>
        {series.map((d) => (
          // min-w-0: a flex item defaults to min-width:auto and refuses to shrink
          // below its own content, which is how the Insights page overflowed and
          // pushed the fixed mobile nav below the fold (MB7).
          <div key={d.day} className="flex-1 min-w-0 h-full flex flex-col justify-end group relative">
            <div className="w-full rounded-t-[2px]" style={{ height: `${(d.b / max) * 100}%`, background: "var(--color-accent)" }} />
            <div className="w-full" style={{ height: `${(d.a / max) * 100}%`, background: "var(--color-accent-subtle)" }} />
            <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-20 whitespace-nowrap rounded-md border border-border bg-surface-overlay px-2 py-1 text-[11px] text-text-primary shadow-lg">
              {d.day}: {num(d.a + d.b)}
              {labelA && labelB ? ` (${num(d.b)} ${labelB}, ${num(d.a)} ${labelA})` : ""}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-text-secondary">
        <span className="shrink-0">{series[0]?.day}</span>
        {labelA && labelB && (
          <span className="flex items-center gap-3 min-w-0">
            <span className="flex items-center gap-1 min-w-0">
              <span className="inline-block w-2 h-2 rounded-sm shrink-0" style={{ background: "var(--color-accent)" }} />
              <span className="truncate">{labelB}</span>
            </span>
            <span className="flex items-center gap-1 min-w-0">
              <span className="inline-block w-2 h-2 rounded-sm shrink-0" style={{ background: "var(--color-accent-subtle)" }} />
              <span className="truncate">{labelA}</span>
            </span>
          </span>
        )}
        <span className="shrink-0">{series[series.length - 1]?.day}</span>
      </div>
      {empty && emptyNote && <p className="mt-2 text-xs text-text-secondary">{emptyNote}</p>}
    </div>
  );
}

/** Horizontal ranked bars. Used for every categorical breakdown on both pages. */
export function RankedBars({
  rows, emptyNote, mono = true,
}: {
  rows: { label: string; count: number }[];
  emptyNote: string;
  mono?: boolean;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  const total = rows.reduce((a, r) => a + r.count, 0);
  if (total === 0) return <p className="text-xs text-text-secondary">{emptyNote}</p>;
  return (
    <ul className="space-y-1.5">
      {rows.filter((r) => r.count > 0).map((r) => (
        <li key={r.label} className="flex items-center gap-3">
          {/* min-w-0 + truncate together: truncate does nothing in a flex row without it. */}
          <span className={`min-w-0 flex-1 truncate text-xs text-text-primary ${mono ? "font-mono" : ""}`}>{r.label}</span>
          <span className="w-20 sm:w-28 shrink-0 h-1.5 rounded-full bg-surface-inset overflow-hidden">
            <span className="block h-full rounded-full" style={{ width: `${(r.count / max) * 100}%`, background: "var(--color-accent)" }} />
          </span>
          <span className="w-14 shrink-0 text-right text-xs tabular-nums text-text-secondary">{num(r.count)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Header shared by both dashboards, including the cross-link between them. */
export function DashHeader({
  title, subtitle, here, children,
}: {
  title: string;
  subtitle: string;
  here: "traffic" | "users";
  children?: React.ReactNode;
}) {
  const linkCls = (active: boolean) =>
    `px-2.5 py-1 rounded-lg text-xs border transition-colors ${
      active ? "border-accent text-accent bg-accent-subtle" : "border-border text-text-secondary hover:text-text-primary"
    }`;
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="font-serif text-serif-lg text-text-primary">{title}</h1>
          <nav className="flex gap-1">
            <Link href="/dev/analytics" className={linkCls(here === "traffic")}>Traffic</Link>
            <Link href="/dev/users" className={linkCls(here === "users")}>Users</Link>
          </nav>
        </div>
        <p className="text-xs text-text-secondary mt-0.5">{subtitle}</p>
      </div>
      {children}
    </header>
  );
}
