"use client";
import { Layers, Gamepad2, Clapperboard, Tv } from "lucide-react";
import { TYPE_COLORS } from "@/lib/constants";
import CollapsibleChips from "@/components/ui/CollapsibleChips";

// <TypeFilter> — 03-components.md §6a. Row of circular 40px icon chips
// (All/Games/Movies/Shows). Replaces SubBar's old text-pill type chips
// (mockup-vs-live gap, resolved 2026-07-27 — Nils's call to match the
// literal mockup anatomy here rather than keep Q14's pill treatment).

const TYPE_ICONS: Record<string, typeof Gamepad2> = {
  game: Gamepad2,
  movie: Clapperboard,
  show: Tv,
};

export interface TypeFilterProps {
  activeTypes: string[];
  onToggleType: (t: string) => void;
  availableTypes?: string[];
}

const INACTIVE_CLASS =
  "border-border-strong text-text-secondary bg-transparent hover:border-neutral-400";

export default function TypeFilter({ activeTypes, onToggleType, availableTypes = ["game", "movie", "show"] }: TypeFilterProps) {
  const allActive = activeTypes.length === 0;

  // SM53 (Nils, 2026-09-02) — collapsed to one chip until tapped, on EVERY page
  // that renders SubBar, not just the calendar. "shrinking the type filter must
  // apply to all pages, not just calendar. consitency is key."
  //
  // This component is rendered from exactly one place (SubBar), which is what
  // makes site-wide a single change rather than five. The summary reflects the
  // current selection: the All icon when nothing is narrowed, the single
  // selected type's own icon and colour when one is, and All plus a count when
  // several are. → components/ui/CollapsibleChips.tsx
  const selected = availableTypes.filter((t) => activeTypes.includes(t));
  const SummaryIcon = selected.length === 1 ? (TYPE_ICONS[selected[0]] ?? Layers) : Layers;
  const summary = (
    <SummaryIcon
      className="w-4 h-4"
      aria-hidden
      style={selected.length === 1 ? { color: TYPE_COLORS[selected[0]] } : undefined}
    />
  );

  return (
    <CollapsibleChips
      summaryIcon={summary}
      label={allActive ? "Filter by type" : `Filter by type (${selected.length} selected)`}
      title="Type"
      activeCount={selected.length}
      isDefault={allActive}
    >
      {chips()}
    </CollapsibleChips>
  );

  function chips() {
  return (
    <div className="flex items-center gap-2" role="group" aria-label="Filter by type">
      <button
        type="button"
        onClick={() => activeTypes.length > 0 && activeTypes.forEach(onToggleType)}
        aria-pressed={allActive}
        aria-label="All types"
        title="All"
        className={`tap-44 w-10 h-10 shrink-0 rounded-full border flex items-center justify-center transition-colors ${allActive ? "" : INACTIVE_CLASS}`}
        style={allActive ? { borderColor: "var(--color-accent)", background: "var(--color-accent)", color: "var(--color-text-on-accent)" } : undefined}
      >
        <Layers className="w-4 h-4" aria-hidden />
      </button>

      {availableTypes.map((t) => {
        const Icon = TYPE_ICONS[t] ?? Layers;
        const active = activeTypes.includes(t);
        const color = TYPE_COLORS[t];
        const label = `${t.charAt(0).toUpperCase()}${t.slice(1)}s`;
        return (
          <button
            key={t}
            type="button"
            onClick={() => onToggleType(t)}
            aria-pressed={active}
            aria-label={label}
            title={label}
            className={`tap-44 w-10 h-10 shrink-0 rounded-full border flex items-center justify-center transition-colors ${active ? "" : INACTIVE_CLASS}`}
            style={active ? { borderColor: color, background: color, color: "var(--color-text-on-media)" } : undefined}
          >
            <Icon className="w-4 h-4" aria-hidden />
          </button>
        );
      })}
    </div>
  );
  }
}
