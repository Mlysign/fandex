"use client";
import { Plus, Minus } from "lucide-react";

// <TagChip> — 03-components.md §6d. Purely presentational; the Discover
// advanced-filter include/exclude wiring (A2) lands with the filter panel in
// H1.6d. Four states: include (accent fill), exclude (danger outline),
// add (dashed, not yet chosen), plain (navigational, e.g. related tags).

export type TagChipState = "include" | "exclude" | "add" | "plain";

export interface TagChipProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
  state: TagChipState;
  onClick?: () => void;
}

const BASE = "inline-flex items-center gap-1 text-label px-3 py-1.5 rounded-full transition-colors min-h-[30px]";

export default function TagChip({ state, className = "", children, onClick, ...props }: TagChipProps) {
  if (state === "include") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed
        className={`${BASE} bg-accent text-text-on-accent ${className}`}
        {...props}
      >
        <Plus className="w-3 h-3" aria-hidden />
        {children}
      </button>
    );
  }
  if (state === "exclude") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed
        className={`${BASE} border border-danger text-danger ${className}`}
        {...props}
      >
        <Minus className="w-3 h-3" aria-hidden />
        {children}
      </button>
    );
  }
  if (state === "add") {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${BASE} border border-dashed border-border-strong text-text-secondary hover:text-text-primary hover:border-neutral-400 ${className}`}
        {...props}
      >
        <Plus className="w-3 h-3" aria-hidden />
        {children}
      </button>
    );
  }
  // plain — navigational (related tags, etc.)
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${BASE} bg-surface-elevated border border-border text-text-secondary hover:text-text-primary hover:border-border-strong ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
