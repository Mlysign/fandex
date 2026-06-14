"use client";
import DualRangeSlider from "@/components/DualRangeSlider";
import { UiFilters, Membership, YEAR_MIN, YEAR_MAX } from "./types";

// Year range + membership (library / wishlist). Type lives in SubBar's chips;
// must-include/exclude facets live in SubBar's facet row. Source / Community /
// Runtime filters were removed (T24).

function Tri({ value, onChange }: { value: Membership | undefined; onChange: (v: Membership | undefined) => void }) {
  const opts: [string, Membership | undefined][] = [["Any", undefined], ["Only", "only"], ["Hide", "exclude"]];
  return (
    <div className="flex rounded-lg border border-neutral-800 overflow-hidden text-xs">
      {opts.map(([label, v]) => (
        <button key={label} onClick={() => onChange(v)} className={`px-2 py-1 ${value === v ? "bg-neutral-700 text-white" : "text-neutral-500 hover:text-white"}`}>
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
      <div className="flex items-center gap-2"><span className="text-xs text-neutral-500">In library</span><Tri value={filters.membership.library} onChange={(v) => onChange({ membership: { ...filters.membership, library: v } })} /></div>
      <div className="flex items-center gap-2"><span className="text-xs text-neutral-500">On wishlist</span><Tri value={filters.membership.wishlist} onChange={(v) => onChange({ membership: { ...filters.membership, wishlist: v } })} /></div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-neutral-500">Year</span>
        <span className="text-xs tabular-nums text-neutral-400 w-20">{filters.yearRange[0]}–{filters.yearRange[1]}{filters.yearRange[1] >= YEAR_MAX ? "+" : ""}</span>
        <div className="w-40"><DualRangeSlider min={YEAR_MIN} max={YEAR_MAX} low={filters.yearRange[0]} high={filters.yearRange[1]} onChange={(lo, hi) => onChange({ yearRange: [lo, hi] })} /></div>
      </div>
    </div>
  );
}
