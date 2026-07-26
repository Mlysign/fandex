"use client";
import { useState } from "react";
import { List, LayoutGrid, CalendarDays, SlidersHorizontal, X } from "lucide-react";
import { TYPE_COLORS, SOURCE_COLORS, SOURCE_LABELS, ROLE_LABELS } from "@/lib/constants";
import SearchBar from "@/components/SearchBar";
import FacetAutocomplete from "@/components/discovery/FacetAutocomplete";
import { FacetPill, VocabMatch } from "@/components/discovery/types";
import Chip from "@/components/ui/Chip";
import Sheet from "@/components/ui/Sheet";
import { useMediaQuery } from "@/lib/useMediaQuery";

const VIEW_ICONS = { list: List, card: LayoutGrid, calendar: CalendarDays } as const;

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
    <span className="inline-flex items-center gap-1 text-label px-2 py-1 rounded-full" style={{ background: `${color}24`, color }}>
      {pill.label}{pill.role ? ` (${ROLE_LABELS[pill.role] ?? pill.role})` : ""}
      <button onClick={onRemove} aria-label={`Remove ${pill.label}`} className="opacity-70 hover:opacity-100">×</button>
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
  // On mobile the advanced rows (facets + year/membership) open in a bottom
  // Sheet instead of eating the viewport inline; on md+ they stay
  // always-visible (T24). The toggle only appears when there's something to show.
  //
  // H1.6d: this content (FacetAutocomplete's `q`/`matches`/`open` state, plus
  // FilterPanel) must be rendered in exactly ONE of the two responsive
  // locations at a time, never both — a naive `hidden md:block` copy for
  // desktop alongside a second copy inside the mobile Sheet would mount two
  // independently-stateful instances simultaneously (a real drifting-input
  // bug, not cosmetic). `useMediaQuery` decides which single location
  // renders it; crossing the breakpoint remounts (loses an in-progress
  // search query) rather than ever duplicating.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const hasAdvanced = !!(searchFacets || advancedFilters);
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const advancedContent = hasAdvanced ? (
    <div className="space-y-2.5">
      {searchFacets && (
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-meta text-text-secondary whitespace-nowrap">Must include</span>
            <div className="w-44"><FacetAutocomplete mode="facets" placeholder="tag, person, studio…" accent="#C8A24B" onPick={(m) => searchFacets.onAdd("include", m as VocabMatch)} /></div>
            {searchFacets.include.map((p, i) => <FacetChip key={`i${i}`} pill={p} color="#C8A24B" onRemove={() => searchFacets.onRemove("include", i)} />)}
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-meta text-text-secondary whitespace-nowrap">Must exclude</span>
            <div className="w-44"><FacetAutocomplete mode="facets" placeholder="tag, person, studio…" accent="#E5674C" onPick={(m) => searchFacets.onAdd("exclude", m as VocabMatch)} /></div>
            {searchFacets.exclude.map((p, i) => <FacetChip key={`e${i}`} pill={p} color="#E5674C" onRemove={() => searchFacets.onRemove("exclude", i)} />)}
          </div>
        </div>
      )}
      {advancedFilters}
    </div>
  ) : null;

  // H1.6c: the nav is a bottom bar on mobile (no top chrome), so the filter bar
  // sticks to the very top there; on desktop it sits below the h-14 top nav.
  return (
    /* H1.6f: rows were space-y-2.5 (10px). Once each control claims a 44px
       hit area (.tap-44), a 30px chip reaches 7px past its own box and a 20px
       sort pill reaches 12px — so adjacent rows overlapped by ~11px and the
       lower row silently stole taps from the one above. The gap now clears
       7+12=19px. This is the one visible change from the a11y pass (Nils's
       call, 2026-07-26: pad hit areas, keep the controls' own size, widen
       spacing only where regions actually collide). */
    <div className="sticky top-0 md:top-14 z-20 bg-surface border-b border-border px-6 py-3 space-y-3">
      <div className="max-w-6xl mx-auto space-y-3">

        {/* Row 1 — type + source filters + hide-rated + extras + sort.
            gap-y > gap-x on purpose (H1.6f): this row WRAPS on mobile, so the
            chip line and the sort line become vertical neighbours. With 44px
            hit areas a 30px chip reaches 7px past its box and a 20px sort pill
            12px, so the old uniform gap-2 (8px) let the lines overlap by ~11px
            and steal each other's taps. Horizontal spacing is unchanged. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-5">
          {/* All pill — clears the type filter */}
          <Chip
            active={activeTypes.length === 0}
            onClick={() => activeTypes.length > 0 && activeTypes.forEach(onToggleType)}
          >
            All
          </Chip>

          {availableTypes.map((t) => (
            <Chip
              key={t}
              active={activeTypes.includes(t)}
              color={TYPE_COLORS[t]}
              dot={TYPE_COLORS[t]}
              onClick={() => onToggleType(t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}s
            </Chip>
          ))}

          {availableSources.length > 0 && onToggleSource && (
            <>
              <div className="w-px h-4 bg-border-strong mx-1" />
              {availableSources.map((s) => (
                <Chip
                  key={s}
                  active={activeSources.includes(s)}
                  color={SOURCE_COLORS[s]}
                  dot={SOURCE_COLORS[s]}
                  onClick={() => onToggleSource(s)}
                >
                  {SOURCE_LABELS[s] ?? s}
                </Chip>
              ))}
            </>
          )}

          {hideRated && (
            <>
              <div className="w-px h-4 bg-border-strong mx-1" />
              <Chip
                active={hideRated.value}
                onClick={() => hideRated.onChange(!hideRated.value)}
                title="Hide items you've already rated"
              >
                Hide rated
              </Chip>
            </>
          )}

          {filters && (
            <>
              <div className="w-px h-4 bg-border-strong mx-1" />
              {filters}
            </>
          )}

          {/* Q14 (2026-07-19): sort as separate pill buttons, matching the public
              facet pages — moved out of Row 3's search section (was a <select>
              sitting right next to the search box) so sort reads as its own
              control everywhere, not a search option. */}
          {sort && (
            <>
              <div className="w-px h-4 bg-border-strong mx-1" />
              <div className="flex gap-1" role="group" aria-label="Sort results">
                {sort.options.map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => sort.onChange(k)}
                    aria-pressed={sort.value === k}
                    className={`tap-44 text-label px-2.5 py-1 rounded-md border transition-colors ${
                      sort.value === k ? "border-accent bg-accent-subtle text-accent" : "border-border text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Row 2 & 2.5 — advanced filters (facets + year/membership). Desktop:
            always-visible inline (T24). Mobile: the single instance moves into
            a bottom Sheet instead, opened by the "Filters" toggle below. */}
        {hasAdvanced && isDesktop && advancedContent}

        {/* Row 3 — search + sort + view mode + actions */}
        <div className="flex flex-wrap items-center gap-3">
          <SearchBar value={searchValue} onChange={onSearchChange} placeholder={searchPlaceholder} />

          {hasAdvanced && (
            <button
              onClick={() => setFiltersOpen(true)}
              aria-haspopup="dialog"
              className="tap-44 md:hidden flex-shrink-0 inline-flex items-center gap-1.5 text-label px-3 py-1.5 rounded-lg border border-border-strong text-text-secondary hover:bg-surface-elevated transition-colors"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden />
              Filters
            </button>
          )}

          {/* View mode toggle */}
          <div className="flex bg-surface-elevated border border-border-strong rounded-lg p-0.5 flex-shrink-0" role="group" aria-label="View mode">
            {availableViews.map((v) => {
              const Icon = VIEW_ICONS[v];
              return (
                <button
                  key={v}
                  onClick={() => onViewChange(v)}
                  aria-label={`${v.charAt(0).toUpperCase() + v.slice(1)} view`}
                  aria-pressed={view === v}
                  className={`tap-44-y px-2.5 py-1.5 rounded-md transition-colors ${
                    view === v ? "bg-neutral-750 text-accent" : "text-text-secondary hover:text-text-primary"
                  }`}
                  title={v.charAt(0).toUpperCase() + v.slice(1)}
                >
                  <Icon className="w-3.5 h-3.5" aria-hidden />
                </button>
              );
            })}
          </div>

          {actions}
        </div>
      </div>

      {/* Mobile-only: the single advanced-filters instance, moved here instead
          of rendered a second time — see the isDesktop split above. */}
      {hasAdvanced && !isDesktop && (
        <Sheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters" className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-serif text-serif-md text-text-primary">Filters</h3>
            <button onClick={() => setFiltersOpen(false)} aria-label="Close" className="text-text-secondary hover:text-text-primary">
              <X className="w-4 h-4" aria-hidden />
            </button>
          </div>
          {advancedContent}
        </Sheet>
      )}
    </div>
  );
}
