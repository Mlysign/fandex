"use client";
import DualRangeSlider from "@/components/DualRangeSlider";
import type { UiFilters, Membership} from "./types";
import { YEAR_MIN, YEAR_MAX } from "./types";

// Year range + membership (library / wishlist). Type lives in SubBar's chips;
// must-include/exclude facets live in SubBar's facet row. Source / Community /
// Runtime filters were removed (T24).

// 3-explicit-button Any/Only/Hide — kept distinct from ui/TriToggle (which
// models Include/Exclude with an IMPLICIT "neither" state per
// 03-components.md §6c): this control shows "Any" as its own clickable
// segment rather than "nothing pressed", which is the established, working
// behavior here — not something this restyle pass should change.
function Tri({ value, onChange }: { value: Membership | undefined; onChange: (v: Membership | undefined) => void }) {
  const opts: [string, Membership | undefined][] = [["Any", undefined], ["Only", "only"], ["Hide", "exclude"]];
  return (
    <div className="flex rounded-lg border border-border-strong overflow-hidden text-label">
      {opts.map(([label, v]) => (
        <button key={label} onClick={() => onChange(v)} className={`px-2 py-1 transition-colors ${value === v ? "bg-accent-subtle text-accent" : "text-text-secondary hover:text-text-primary"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

// Compact inline filter row — rendered inside SubBar (sticky), alongside the type
// and must-include/exclude rows. No outer card, so it stays with the other filters.
export default function FilterPanel({ filters, onChange }: { filters: UiFilters; onChange: (patch: Partial<UiFilters>) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <div className="flex items-center gap-2"><span className="font-mono text-meta text-text-secondary">In library</span><Tri value={filters.membership.library} onChange={(v) => onChange({ membership: { ...filters.membership, library: v } })} /></div>
      <div className="flex items-center gap-2"><span className="font-mono text-meta text-text-secondary">On wishlist</span><Tri value={filters.membership.wishlist} onChange={(v) => onChange({ membership: { ...filters.membership, wishlist: v } })} /></div>
      {/* A2 (H1.6c): the "Already-rated" dimension — same Any/Only/Hide control
          as above (the H1.6d decision kept this over ui/TriToggle). */}
      <div className="flex items-center gap-2"><span className="font-mono text-meta text-text-secondary">Rated</span><Tri value={filters.membership.rated} onChange={(v) => onChange({ membership: { ...filters.membership, rated: v } })} /></div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-meta text-text-secondary">Year</span>
        <span className="font-mono text-meta tabular-nums text-text-secondary w-20">{filters.yearRange[0]}–{filters.yearRange[1]}{filters.yearRange[1] >= YEAR_MAX ? "+" : ""}</span>
        <div className="w-40"><DualRangeSlider min={YEAR_MIN} max={YEAR_MAX} low={filters.yearRange[0]} high={filters.yearRange[1]} onChange={(lo, hi) => onChange({ yearRange: [lo, hi] })} /></div>
      </div>
    </div>
  );
}
