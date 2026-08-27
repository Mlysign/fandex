"use client";
import { useState } from "react";
import { List, LayoutGrid, CalendarDays, SlidersHorizontal, ChevronDown, X } from "lucide-react";
import { ROLE_LABELS } from "@/lib/constants";
import SearchBar from "@/components/SearchBar";
import FacetAutocomplete from "@/components/discovery/FacetAutocomplete";
import type { FacetPill, VocabMatch } from "@/components/discovery/types";
import Chip from "@/components/ui/Chip";
import TypeFilter from "@/components/ui/TypeFilter";
import Menu from "@/components/ui/Menu";
import Sheet from "@/components/ui/Sheet";
import Button from "@/components/ui/Button";
import FilterSection from "@/components/discovery/FilterSection";
import { useHideOnScroll } from "@/lib/useHideOnScroll";

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

  /** Tab strip (Library/Wishlist). Sits between the chips and the search box. */
  tabs?: React.ReactNode;

  // Search. OMIT `onSearchChange` to render no search box at all — Home and
  // Calendar are list pages with nothing to search within (2026-07-28).
  searchValue?: string;
  onSearchChange?: (val: string) => void;
  searchPlaceholder?: string;
  searchFacets?: SearchBarFacets;     // must-include/exclude (T6)

  // Hide-rated toggle (Library) — a standard, shared control
  hideRated?: { value: boolean; onChange: (v: boolean) => void };

  // Sort (search results, T8)
  sort?: { value: string; onChange: (v: string) => void; options: [string, string][] };

  // Year + membership filters — rendered inside the Filters sheet (see FilterPanel)
  advancedFilters?: React.ReactNode;
  /**
   * How many advanced filters are currently narrowing the results. Shown as a
   * badge on the Filters trigger. Required in spirit whenever `advancedFilters`
   * is passed: the panel is collapsed by default now, so without this a user
   * cannot tell a filtered list from an unfiltered one.
   */
  advancedActiveCount?: number;
  /** Clears every advanced filter. Omit to render no Reset control (MyStuffView had none). */
  onResetFilters?: () => void;

  // View mode. Pass a single-entry `availableViews` (or omit both handlers) to
  // hide the toggle entirely — the mockups show a grid on every list page and
  // no view switcher anywhere (2026-07-27 audit).
  view?: ViewMode;
  onViewChange?: (v: ViewMode) => void;
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
  tabs,
  searchValue = "",
  onSearchChange,
  searchPlaceholder = "Search...",
  searchFacets,
  hideRated,
  sort,
  advancedFilters,
  advancedActiveCount = 0,
  onResetFilters,
  view = "card",
  onViewChange,
  availableViews = ["list", "card"],
  resultCount = null,
  resultNoun = "titles",
  filters,
  actions,
}: SubBarProps) {
  // The advanced rows (facets + year/membership) live behind a "Filters"
  // trigger and open in <Sheet> — a bottom sheet on mobile, a centered modal on
  // desktop, which Sheet already handles itself.
  //
  // 2026-07-28 (Nils's call: "collapse the advanced filters on mobile and web"):
  // desktop used to render this content inline and permanently expanded, mobile
  // in the sheet, with `useMediaQuery` picking exactly one so the two couldn't
  // mount simultaneously and drift (H1.6d — a real bug, not cosmetic). There is
  // now only one location at any width, so that invariant holds by construction
  // and crossing the 768px breakpoint no longer remounts the panel or discards
  // an in-progress facet query.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // 2026-08-14 (Nils, mobile testing): "I want to scroll away the top header
  // section, but as soon as I scroll up I want it back immediately — don't make
  // me scroll all the way to the top." See lib/useHideOnScroll.ts for the rule.
  // Suppressed while the Filters sheet is open: the sheet's scroll would
  // otherwise retract the very trigger the user came from.
  const scrolledAway = useHideOnScroll();
  const hidden = scrolledAway && !filtersOpen;
  const hasAdvanced = !!(searchFacets || advancedFilters);
  const showSearch = !!onSearchChange;
  // A single available view means there's nothing to switch BETWEEN — render
  // no toggle at all rather than one permanently-pressed button. This is how
  // Discover now opts out entirely (2026-07-27).
  const showViewToggle = availableViews.length > 1 && !!onViewChange;

  // The sheet body: one sectioned column, Option A of the 2026-08-27 mockups.
  // Each label is its own eyebrow above a full-width control, which is what
  // stops the wrapping Nils reported — the old layout put six controls in one
  // flex row and the membership toggles broke the line on every viewport.
  const advancedContent = hasAdvanced ? (
    <div className="flex flex-col gap-4">
      {searchFacets && (
        <>
          <FilterSection label="Must include">
            <FacetAutocomplete mode="facets" placeholder="tag, person, studio…" accent="#C8A24B" onPick={(m) => searchFacets.onAdd("include", m as VocabMatch)} />
            {searchFacets.include.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {searchFacets.include.map((p, i) => <FacetChip key={`i${i}`} pill={p} color="#C8A24B" onRemove={() => searchFacets.onRemove("include", i)} />)}
              </div>
            )}
          </FilterSection>
          <FilterSection label="Must exclude">
            <FacetAutocomplete mode="facets" placeholder="tag, person, studio…" accent="#E5674C" onPick={(m) => searchFacets.onAdd("exclude", m as VocabMatch)} />
            {searchFacets.exclude.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {searchFacets.exclude.map((p, i) => <FacetChip key={`e${i}`} pill={p} color="#E5674C" onRemove={() => searchFacets.onRemove("exclude", i)} />)}
              </div>
            )}
          </FilterSection>
        </>
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
    /* The retract is a transform, not a height/display change: the bar keeps
       its box in the flow either way, so nothing below it reflows as it comes
       and goes. `will-change` is deliberately absent — this animates at most
       twice per scroll gesture, and promoting a full-width bar to its own layer
       for that costs more than it saves. motion-reduce drops the transition but
       NOT the behaviour: the header still gets out of the way, it just snaps. */
    <div
      className={`sticky top-0 md:top-14 z-20 bg-surface border-b border-border px-6 py-3 space-y-3 transition-transform duration-base motion-reduce:transition-none ${
        hidden ? "-translate-y-full" : "translate-y-0"
      }`}
    >
      <div className="max-w-6xl mx-auto space-y-3">

        {/* THE ORDER OF THIS BLOCK IS THE SPEC (Nils, 2026-07-28), and it is
            the same on every page that uses SubBar:
              1. media type filters   2. tabs   3. search   4. sort → content
            Search used to sit at the top; the type chips are now the first
            thing on every list page, and pages that pass no `onSearchChange`
            (Home, Calendar) simply have no search row. Don't reorder these
            without changing all four pages at once — the whole point is that
            they no longer drift apart. */}

        {/* Row 1 — type + source filters + hide-rated + extras.
            gap-y > gap-x on purpose (H1.6f): this row WRAPS on mobile, so the
            chip line and the sort line become vertical neighbours. With 44px
            hit areas a 30px chip reaches 7px past its box and a 20px sort pill
            12px, so the old uniform gap-2 (8px) let the lines overlap by ~11px
            and steal each other's taps. Horizontal spacing is unchanged. */}
        <div className="flex items-start gap-x-2">
          {/* Chips wrap in THEIR OWN flex-wrap container, separate from the
              Filters trigger below (2026-07-27, SM17 fix): the trigger used
              to be `ml-auto` inside this same wrapping row, which pushes an
              element to the end of whichever line it lands on — fine when
              everything fits one line (Discover/Wishlist's 4 base chips),
              but on a page with one more chip (Library's "Hide rated") the
              row wraps and the trigger strands alone on its own line, well
              below the chips, with the row's intentional gap-y-5 gap above
              it. Splitting the trigger into a sibling that never wraps keeps
              it pinned top-right of the chip block regardless of how many
              lines the chips take. */}
          <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-2 gap-y-5">
            {/* 03-components.md §6a: circular icon chips, not text pills. */}
            <TypeFilter activeTypes={activeTypes} onToggleType={onToggleType} availableTypes={availableTypes} />

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

            {/* Divider + extras wrap together as ONE flex item, and the divider
                itself is desktop-only. Left as loose siblings they break apart
                at 375px and the divider dangles at the end of the type-chip
                line (Calendar's scope chips push the row to 7 chips); kept on
                mobile inside the group it just leads the second line, which
                looks equally like a stray mark. Below md the line break is the
                separation. */}
            {filters && (
              <div className="flex items-center gap-x-2">
                <div className="hidden md:block w-px h-4 bg-border-strong mx-1" />
                {filters}
              </div>
            )}
          </div>

          {/* Advanced-filters trigger — a round icon button at the end of the
              chip row. Shown at EVERY width since 2026-07-28; the panel is
              collapsed everywhere now. The count badge is what keeps that
              honest: with the panel shut, it's the only signal that a year
              range or a facet is still narrowing the list. */}
          {hasAdvanced && (
            <button
              onClick={() => setFiltersOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={filtersOpen}
              aria-label={advancedActiveCount > 0 ? `Filters (${advancedActiveCount} active)` : "Filters"}
              title="Filters"
              className={`tap-44 relative w-10 h-10 shrink-0 inline-flex items-center justify-center rounded-full border transition-colors ${
                advancedActiveCount > 0
                  ? "border-accent text-accent hover:bg-accent-subtle"
                  : "border-border-strong text-text-secondary hover:bg-surface-elevated"
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" aria-hidden />
              {advancedActiveCount > 0 && (
                <span
                  aria-hidden
                  className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-accent text-text-on-accent font-mono text-[10px] font-bold leading-4 text-center"
                >
                  {advancedActiveCount}
                </span>
              )}
            </button>
          )}
        </div>

        {/* Row 2 — tabs (Library/Wishlist only). Between the chips and the
            search box, per the shared order above. */}
        {tabs}

        {/* Row 3 — search, full width. Absent entirely on pages that pass no
            `onSearchChange`. */}
        {showSearch && (
          <SearchBar value={searchValue} onChange={onSearchChange} placeholder={searchPlaceholder} />
        )}

        {/* Sort bar — the mockup's `.sortbar`: result count on the left, sort
            control on the right, sitting at the BOTTOM of the static header
            section directly above the grid (2026-07-27, Nils's call: "move
            sort to the top of the grid view"). It used to be a pill row wedged
            between the type chips and the search box. The view toggle (where a
            page still has one) rides along on the right. */}
        {/* `actions` counts toward showing this row: Calendar passes only a
            Month/List toggle here and would otherwise render nothing. */}
        {(sort || resultCount != null || showViewToggle || actions) && (
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
                        onClick={() => onViewChange?.(v)}
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

      {/* The single advanced-filters instance, at every width. Sheet renders
          itself as a bottom sheet under 768px and a centered modal above it. */}
      {hasAdvanced && (
        <Sheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters">
          {/* Header / body / footer, with only the BODY scrolling. The sheet is
              capped at 85svh so a long platform list can never push the "Show N"
              action off-screen — svh, not vh, because mobile Safari's vh counts
              the collapsed toolbar and would hide it anyway.
              ⚠️ The panel used to render clipped ABOVE the viewport; that was a
              containing-block bug, not a height one, and Sheet portals to <body>
              now. See the note in ui/Sheet.tsx before touching this. */}
          <div className="flex flex-col max-h-[85svh]">
            <div className="flex items-center gap-3 px-5 pt-3 pb-3.5 border-b border-border">
              <h3 className="font-serif text-serif-md text-text-primary">Filters</h3>
              {advancedActiveCount > 0 && (
                <span className="font-mono text-meta leading-none px-1.5 py-1 rounded-full bg-accent text-text-on-accent tabular-nums">
                  {advancedActiveCount}
                </span>
              )}
              <div className="flex-1" />
              {/* Reset is only rendered when there is something to reset — a
                  permanently-present "Reset all" on an untouched panel is a
                  control that does nothing, which is the same complaint as an
                  auth gate that disappears. */}
              {onResetFilters && advancedActiveCount > 0 && (
                <button
                  onClick={onResetFilters}
                  className="min-h-11 px-2.5 text-label text-accent hover:text-accent-hover transition-colors"
                >
                  Reset all
                </button>
              )}
              <button
                onClick={() => setFiltersOpen(false)}
                aria-label="Close"
                className="w-11 h-11 -mr-2.5 flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
              >
                <X className="w-4.5 h-4.5" aria-hidden />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4">
              {advancedContent}
            </div>

            <div className="px-5 pt-3 pb-5 border-t border-border">
              <Button variant="primary" size="lg" pill onClick={() => setFiltersOpen(false)} className="w-full">
                {/* Singular when there is one of them. A filter that narrows to a
                    single match is exactly when this button gets read carefully,
                    and "Show 1 titles" is the moment it looks unfinished. The
                    noun is a prop, so trim its plural rather than guessing one. */}
                {resultCount == null
                  ? "Show results"
                  : `Show ${resultCount.toLocaleString()} ${resultCount === 1 ? resultNoun.replace(/s$/, "") : resultNoun}`}
              </Button>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}
