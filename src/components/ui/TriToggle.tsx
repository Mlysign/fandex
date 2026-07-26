"use client";

// <TriToggle> — 03-components.md §6c. Two-segment pill used by Discover's
// advanced include/exclude filters (Wishlisted, Already-rated). Purely
// presentational; wired to real tri-state filter state in H1.6d (A2).
// "Any" isn't a segment here — callers represent it as neither pressed, and
// typically add a third "clear" affordance elsewhere (matches the design's
// two-segment pill, not a three-way control).

export type TriState = "include" | "exclude" | null;

export interface TriToggleProps {
  value: TriState;
  onChange: (next: TriState) => void;
  includeLabel?: string;
  excludeLabel?: string;
  /** Accessible name for the whole control, e.g. "Wishlisted". */
  label: string;
  className?: string;
}

export default function TriToggle({
  value,
  onChange,
  includeLabel = "Include",
  excludeLabel = "Exclude",
  label,
  className = "",
}: TriToggleProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`inline-flex items-center rounded-full bg-surface-elevated p-0.5 ${className}`}
    >
      <button
        type="button"
        aria-pressed={value === "include"}
        onClick={() => onChange(value === "include" ? null : "include")}
        className={`text-label px-3 py-1.5 rounded-full transition-colors min-h-[30px] ${
          value === "include" ? "bg-accent text-text-on-accent" : "text-text-secondary hover:text-text-primary"
        }`}
      >
        {includeLabel}
      </button>
      <button
        type="button"
        aria-pressed={value === "exclude"}
        onClick={() => onChange(value === "exclude" ? null : "exclude")}
        className={`text-label px-3 py-1.5 rounded-full transition-colors min-h-[30px] ${
          value === "exclude" ? "bg-danger text-neutral-950" : "text-text-secondary hover:text-text-primary"
        }`}
      >
        {excludeLabel}
      </button>
    </div>
  );
}
