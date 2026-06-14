"use client";
import { TYPE_COLORS, SOURCE_COLORS, SOURCE_LABELS, ROLE_LABELS } from "@/lib/constants";
import SearchBar from "@/components/SearchBar";
import FacetAutocomplete from "@/components/discovery/FacetAutocomplete";
import { FacetPill, VocabMatch } from "@/components/discovery/types";

export type ViewMode = "list" | "card" | "calendar";

// Must-include / must-exclude facet filters (T6). Lives in SubBar's always-visible
// filter section so it sits next to type/source — no popover, consistent everywhere.
export interface SearchBarFacets {
  include: FacetPill[];
  exclude: FacetPill[];
  onAdd: (key: "include" | "exclude", m: VocabMatch) => void;
  onRemove: (key: "include" | "exclude", index: number) => void;
}

interface SubBarProps {
  // Type filter chips
  activeTypes: string[];
  onToggleType: (t: string) => void;
  availableTypes?: string[];          // defaults to game/movie/show

  // Source filter chips (optional)
  activeSources?: string[];
  onToggleSource?: (s: string) => void;
  availableSources?: string[];

  // Search
  searchValue: string;
  onSearchChange: (val: string) => void;
  searchPlaceholder?: string;
  searchFacets?: SearchBarFacets;     // must-include/exclude (T6) — rendered inline

  // Hide-rated toggle (Library) — a standard, shared control
  hideRated?: { value: boolean; onChange: (v: boolean) => void };

  // Sort (search results, T8)
  sort?: { value: string; onChange: (v: string) => void; options: [string, string][] };

  // Year + membership filters (rendered as an inline sticky row — see FilterPanel)
  advancedFilters?: React.ReactNode;

  // View mode
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  availableViews?: ViewMode[];        // defaults to list/card

  // Extra filter controls appended to the filter row
  filters?: React.ReactNode;

  // Right-side actions (sync button, etc.)
  actions?: React.ReactNode;
}

function FacetChip({ pill, color, onRemove }: { pill: FacetPill; color: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full" style={{ background: `${color}1f`, color }}>
      {pill.label}{pill.role ? ` (${ROLE_LABELS[pill.role] ?? pill.role})` : ""}
      <button onClick={onRemove} className="opacity-70 hover:opacity-100">×</button>
    </span>
  );
}

export default function SubBar({
  activeTypes,
  onToggleType,
  availableTypes = ["game", "movie", "show"],
  activeSources = [],
  onToggleSource,
  availableSources = [],
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search...",
  searchFacets,
  hideRated,
  sort,
  advancedFilters,
  view,
  onViewChange,
  availableViews = ["list", "card"],
  filters,
  actions,
}: SubBarProps) {
  return (
    <div className="sticky top-14 z-20 bg-neutral-950 border-b border-neutral-800/60 px-6 py-3 space-y-2.5">
      <div className="max-w-6xl mx-auto space-y-2.5">

        {/* Row 1 — type + source filters + hide-rated + extras */}
        <div className="flex flex-wrap items-center gap-2">
          {/* All pill — clears the type filter */}
          <button
            onClick={() => activeTypes.length > 0 && activeTypes.forEach(onToggleType)}
            className="text-xs px-3 py-1.5 rounded-full border transition-colors"
            style={{
              borderColor: activeTypes.length === 0 ? "#fff" : "transparent",
              background: activeTypes.length === 0 ? "#ffffff15" : "#1a1a1a",
              color: activeTypes.length === 0 ? "#fff" : "#666",
            }}
          >
            All
          </button>

          {availableTypes.map((t) => (
            <button
              key={t}
              onClick={() => onToggleType(t)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border transition-colors capitalize"
              style={{
                borderColor: activeTypes.includes(t) ? TYPE_COLORS[t] : "transparent",
                background: activeTypes.includes(t) ? `${TYPE_COLORS[t]}15` : "#1a1a1a",
                color: activeTypes.includes(t) ? TYPE_COLORS[t] : "#666",
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: TYPE_COLORS[t] }} />
              {t.charAt(0).toUpperCase() + t.slice(1)}s
            </button>
          ))}

          {availableSources.length > 0 && onToggleSource && (
            <>
              <div className="w-px h-4 bg-neutral-800 mx-1" />
              {availableSources.map((s) => (
                <button
                  key={s}
                  onClick={() => onToggleSource(s)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border transition-colors"
                  style={{
                    borderColor: activeSources.includes(s) ? SOURCE_COLORS[s] : "transparent",
                    background: activeSources.includes(s) ? `${SOURCE_COLORS[s]}15` : "#1a1a1a",
                    color: activeSources.includes(s) ? SOURCE_COLORS[s] : "#666",
                  }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: SOURCE_COLORS[s] }} />
                  {SOURCE_LABELS[s] ?? s}
                </button>
              ))}
            </>
          )}

          {hideRated && (
            <>
              <div className="w-px h-4 bg-neutral-800 mx-1" />
              <button
                onClick={() => hideRated.onChange(!hideRated.value)}
                className="text-xs px-3 py-1.5 rounded-full border transition-colors"
                style={{
                  borderColor: hideRated.value ? "#fff" : "transparent",
                  background: hideRated.value ? "#ffffff15" : "#1a1a1a",
                  color: hideRated.value ? "#fff" : "#666",
                }}
                title="Hide items you've already rated"
              >
                Hide rated
              </button>
            </>
          )}

          {filters && (
            <>
              <div className="w-px h-4 bg-neutral-800 mx-1" />
              {filters}
            </>
          )}
        </div>

        {/* Row 2 — must include / exclude facet filters (always visible) */}
        {searchFacets && (
          <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs text-neutral-500 whitespace-nowrap">Must include</span>
              <div className="w-44"><FacetAutocomplete mode="facets" placeholder="tag, person, studio…" accent="#14532d" onPick={(m) => searchFacets.onAdd("include", m as VocabMatch)} /></div>
              {searchFacets.include.map((p, i) => <FacetChip key={`i${i}`} pill={p} color="#4ade80" onRemove={() => searchFacets.onRemove("include", i)} />)}
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs text-neutral-500 whitespace-nowrap">Must exclude</span>
              <div className="w-44"><FacetAutocomplete mode="facets" placeholder="tag, person, studio…" accent="#7f1d1d" onPick={(m) => searchFacets.onAdd("exclude", m as VocabMatch)} /></div>
              {searchFacets.exclude.map((p, i) => <FacetChip key={`e${i}`} pill={p} color="#f87171" onRemove={() => searchFacets.onRemove("exclude", i)} />)}
            </div>
          </div>
        )}

        {/* Row 2.5 — year + membership (always visible, sticky with the bar) */}
        {advancedFilters}

        {/* Row 3 — search + sort + view mode + actions */}
        <div className="flex items-center gap-3">
          <SearchBar value={searchValue} onChange={onSearchChange} placeholder={searchPlaceholder} />

          {sort && (
            <select
              value={sort.value}
              onChange={(e) => sort.onChange(e.target.value)}
              className="text-xs px-2 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 outline-none flex-shrink-0"
              title="Sort results"
            >
              {sort.options.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          )}

          {/* View mode toggle */}
          <div className="flex bg-neutral-900 border border-neutral-800 rounded-lg p-0.5 flex-shrink-0">
            {availableViews.map((v) => (
              <button
                key={v}
                onClick={() => onViewChange(v)}
                className={`px-2.5 py-1.5 rounded-md transition-colors text-xs capitalize ${
                  view === v ? "bg-neutral-700 text-white" : "text-neutral-500 hover:text-white"
                }`}
                title={v.charAt(0).toUpperCase() + v.slice(1)}
              >
                {v === "list" ? "≡" : v === "card" ? "⊞" : "▦"}
              </button>
            ))}
          </div>

          {actions}
        </div>
      </div>
    </div>
  );
}
