"use client";
import { useState } from "react";
import { List, LayoutGrid, CalendarDays, SlidersHorizontal, ChevronDown, X } from "lucide-react";
import { SOURCE_COLORS, SOURCE_LABELS, ROLE_LABELS } from "@/lib/constants";
import SearchBar from "@/components/SearchBar";
import FacetAutocomplete from "@/components/discovery/FacetAutocomplete";
import { FacetPill, VocabMatch } from "@/components/discovery/types";
import Chip from "@/components/ui/Chip";
import TypeFilter from "@/components/ui/TypeFilter";
import Menu from "@/components/ui/Menu";
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

  // View mode. Pass a single-entry `availableViews` (or omit both handlers) to
  // hide the toggle entirely — the mockups show a grid on every list page and
  // no view switcher anywhere (2026-07-27 audit).
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  availableViews?: ViewMode[];        // defaults to list/card

  /** Result count for the sort bar's left eyebrow ("TITLES · 128"). */
  resultCount?: number | null;
  /** Noun for that eyebrow; defaults to "titles". */
  resultNoun?: string;

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
  resultCount = null,
  resultNoun = "titles",
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
  // A single available view means there's nothing to switch BETWEEN — render
  // no toggle at all rather than one permanently-pressed button. This is how
  // Discover now opts out entirely (2026-07-27).
  const showViewToggle = availableViews.length > 1;

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

        {/* Search — its own full-width row at the TOP, per the mockup's
            header order (search → filters → sort → grid). It used to sit
            below the chips, sharing a row with the view toggle. */}
        <SearchBar value={searchValue} onChange={onSearchChange} placeholder={searchPlaceholder} />

        {/* Row 1 — type + source filters + hide-rated + extras.
            gap-y > gap-x on purpose (H1.6f): this row WRAPS on mobile, so the
            chip line and the sort line become vertical neighbours. With 44px
            hit areas a 30px chip reaches 7px past its box and a 20px sort pill
            12px, so the old uniform gap-2 (8px) let the lines overlap by ~11px
            and steal each other's taps. Horizontal spacing is unchanged. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-5">
          {/* 03-components.md §6a: circular icon chips, not text pills. */}
          <TypeFilter activeTypes={activeTypes} onToggleType={onToggleType} availableTypes={availableTypes} />

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

          {/* Advanced-filters trigger — a round icon button at the end of the
              chip row (mockup). Mobile only: desktop renders the panel inline
              below, so a trigger there would open nothing new. */}
          {hasAdvanced && (
            <button
              onClick={() => setFiltersOpen(true)}
              aria-haspopup="dialog"
              aria-label="Filters"
              title="Filters"
              className="tap-44 md:hidden ml-auto w-10 h-10 shrink-0 inline-flex items-center justify-center rounded-full border border-border-strong text-text-secondary hover:bg-surface-elevated transition-colors"
            >
              <SlidersHorizontal className="w-4 h-4" aria-hidden />
            </button>
          )}
        </div>

        {/* Advanced filters (facets + year/membership). Desktop:
            always-visible inline (T24). Mobile: the single instance moves into
            a bottom Sheet instead, opened by the "Filters" trigger above. */}
        {hasAdvanced && isDesktop && advancedContent}

        {/* Sort bar — the mockup's `.sortbar`: result count on the left, sort
            control on the right, sitting at the BOTTOM of the static header
            section directly above the grid (2026-07-27, Nils's call: "move
            sort to the top of the grid view"). It used to be a pill row wedged
            between the type chips and the search box. The view toggle (where a
            page still has one) rides along on the right. */}
        {(sort || resultCount != null || showViewToggle) && (
          <div className="flex items-center justify-between gap-3 pt-0.5">
            <span className="font-mono text-micro uppercase tracking-wider text-accent">
              {resultCount != null ? `${resultNoun} · ${resultCount}` : ""}
            </span>

            <div className="flex items-center gap-3 shrink-0">
              {sort && (
                <Menu
                  label="Sort results"
                  align="right"
                  items={sort.options.map(([k, label]) => ({
                    key: k,
                    label,
                    selected: sort.value === k,
                    onSelect: () => sort.onChange(k),
                  }))}
                  trigger={({ onClick, ...triggerProps }) => (
                    <button
                      {...triggerProps}
                      onClick={onClick}
                      className="tap-44-y inline-flex items-center gap-1 font-mono text-meta text-text-secondary hover:text-text-primary transition-colors"
                    >
                      {sort.options.find(([k]) => k === sort.value)?.[1] ?? sort.options[0]?.[1]}
                      <ChevronDown className="w-3.5 h-3.5" aria-hidden />
                    </button>
                  )}
                />
              )}

              {showViewToggle && (
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
              )}

              {actions}
            </div>
          </div>
        )}
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
