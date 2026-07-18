"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { EnrichedItem, MediaType } from "@/types";
import { useViewMode } from "@/lib/useViewMode";
import NavBar from "@/components/NavBar";
import SubBar, { SearchBarFacets, ViewMode } from "@/components/SubBar";
import { FacetPill, VocabMatch, SortKey, SORTS, DATE_SORTS, UiFilters, Membership, defaultUiFilters, normalizeSort } from "@/components/discovery/types";
import FilterPanel from "@/components/discovery/FilterPanel";
import { matchesFacets, passesYearMembership } from "@/lib/facetFilter";
import { sortItems, platformRating10 } from "@/lib/sortItems";
import { syncToCompletion } from "@/lib/syncClient";
import { usePersistedState, useScrollRestore, hasSavedScroll } from "@/lib/usePersistedState";
import { buildItemHref } from "@/lib/itemUrl";
import CalendarView from "@/components/CalendarView";
import GroupedView from "@/components/GroupedView";
import ErrorBoundary, { ListSkeleton } from "@/components/ErrorBoundary";
import EmptyState from "@/components/ui/EmptyState";
import Button, { buttonClasses } from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";


export default function LibraryPage() {
  const router = useRouter();
  const [items, setItems] = useState<EnrichedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [view, setView] = useViewMode("rr_view_library", "list", ["list", "card", "calendar"]);
  // Persisted across back-nav (T12).
  // SM2: global type filter — one shared key across Wishlist / Library / Discover.
  const [types, setTypes] = usePersistedState<MediaType[]>("rr_type_filter", []);
  const [search, setSearch] = usePersistedState("rr_library_search", "");
  const [hideRated, setHideRated] = usePersistedState("rr_library_hideRated", false);
  const [includeFacets, setIncludeFacets] = usePersistedState<FacetPill[]>("rr_library_incFacets", []);
  const [excludeFacets, setExcludeFacets] = usePersistedState<FacetPill[]>("rr_library_excFacets", []);
  const [sort, setSort] = usePersistedState<SortKey>("rr_library_sort", "releaseDate", normalizeSort);
  const [yearRange, setYearRange] = usePersistedState<[number, number]>("rr_library_year", defaultUiFilters().yearRange);
  const [membership, setMembership] = usePersistedState<{ library?: Membership; wishlist?: Membership }>("rr_library_membership", {});

  useEffect(() => { init(); }, []);

  async function init() {
    const res = await fetch("/api/auth/me");
    const data = await res.json();
    if (!data.user) { router.push("/"); return; }
    await loadItems();
  }

  async function loadItems() {
    setLoading(true);
    const res = await fetch("/api/library");
    const data = await res.json();
    setItems(data.items ?? []);
    setLoading(false);
  }

  async function sync() {
    setSyncing(true);
    await syncToCompletion("all");
    await loadItems();
    setSyncing(false);
  }

  function toggleFilter<T>(arr: T[], val: T): T[] {
    return arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];
  }

  const searchFacets: SearchBarFacets = {
    include: includeFacets,
    exclude: excludeFacets,
    onAdd: (key, m: VocabMatch) => {
      const pill: FacetPill = { kind: m.kind, role: m.role, key: m.key, label: m.label };
      const setter = key === "include" ? setIncludeFacets : setExcludeFacets;
      setter((arr) => (arr.some((x) => x.kind === pill.kind && x.role === pill.role && x.key === pill.key) ? arr : [...arr, pill]));
    },
    onRemove: (key, i) => {
      const setter = key === "include" ? setIncludeFacets : setExcludeFacets;
      setter((arr) => arr.filter((_, idx) => idx !== i));
    },
  };

  // Year + membership for the shared FilterPanel (rendered in the sticky SubBar).
  const advFilters: UiFilters = { ...defaultUiFilters(), types, includeFacets, excludeFacets, yearRange, membership };
  const patchAdvanced = (patch: Partial<UiFilters>) => {
    if (patch.yearRange) setYearRange(patch.yearRange);
    if (patch.membership) setMembership(patch.membership);
  };

  const q = search.trim().toLowerCase();
  const filtered = items.filter((item) => {
    if (types.length > 0 && !types.includes(item.type)) return false;
    if (hideRated && item.rating != null) return false;
    if (q && !item.title.toLowerCase().includes(q)) return false;
    if (!matchesFacets(item, includeFacets, excludeFacets)) return false;
    if (!passesYearMembership(item, yearRange, membership)) return false;
    return true;
  });
  const sorted = sortItems(filtered, sort);

  const highlightId = q && sorted.length > 0 ? sorted[0].id : null;

  // Sort-driven layout (T8).
  const isDateSort = DATE_SORTS.includes(sort);
  const groupBy: "month" | "rating" | "none" =
    sort === "rating" ? "rating" : sort === "releaseDate" ? "month" : "none";
  const descending = sort === "releaseDate";
  const ratingOf = sort === "rating" ? (i: any) => platformRating10(i) : undefined;
  const availableViews: ViewMode[] = isDateSort ? ["list", "card", "calendar"] : ["list", "card"];
  const effView: ViewMode = !isDateSort && view === "calendar" ? "card" : view;
  useScrollRestore("rr_library_scroll", !loading && sorted.length > 0);
  // N2: sampled once on mount — if a Back-nav restore is pending, don't let
  // GroupedView's today-scroll fight it.
  const [autoToday] = useState(() => !hasSavedScroll("rr_library_scroll"));

  return (
    <div className="min-h-screen">
      <NavBar />

      <SubBar
        activeTypes={types}
        onToggleType={(t) => setTypes((prev) => toggleFilter(prev, t as MediaType))}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search your library…"
        searchFacets={searchFacets}
        hideRated={{ value: hideRated, onChange: setHideRated }}
        sort={{ value: sort, onChange: (v) => setSort(v as SortKey), options: SORTS }}
        advancedFilters={<FilterPanel filters={advFilters} onChange={patchAdvanced} />}
        view={effView}
        onViewChange={setView}
        availableViews={availableViews}
        actions={
          <button
            onClick={sync}
            disabled={syncing}
            className="flex-shrink-0 text-sm px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 rounded-lg disabled:opacity-40 transition-colors border border-neutral-700 whitespace-nowrap"
          >
            {syncing ? "Syncing…" : "Sync"}
          </button>
        }
      />

      <main className="max-w-6xl mx-auto px-6 py-6">
        {loading && effView === "list"     && <ListSkeleton />}
        {loading && effView === "card"     && <Spinner label="Loading…" />}
        {loading && effView === "calendar" && <Spinner label="Loading…" />}

        {!loading && items.length === 0 && (
          <EmptyState
            className="mt-20"
            title="Your library is empty"
            hint="Connect Trakt, Steam, or RAWG and sync to bring in everything you've watched, played, or own — with your personal scores."
            actions={
              <>
                <Link href="/settings" className={buttonClasses("secondary", "md")}>Go to Profile →</Link>
                <Button variant="outline" size="md" onClick={sync} disabled={syncing}>
                  {syncing ? "Syncing…" : "Sync now"}
                </Button>
              </>
            }
          />
        )}

        {!loading && items.length > 0 && sorted.length === 0 && (
          <EmptyState
            title={q ? <>No results for &ldquo;<span className="text-white">{search}</span>&rdquo;</> : "No items match the current filters"}
            actions={q ? <Button variant="ghost" onClick={() => setSearch("")}>Clear search</Button> : undefined}
          />
        )}

        {!loading && sorted.length > 0 && effView !== "calendar" && (
          <ErrorBoundary label="library view">
            <GroupedView
              items={sorted}
              view={effView}
              groupBy={groupBy}
              descending={descending}
              ratingOf={ratingOf}
              onSelect={(i) => router.push(buildItemHref(i as EnrichedItem))}
              highlightId={highlightId}
              autoScrollToToday={autoToday}
            />
          </ErrorBoundary>
        )}

        {!loading && sorted.length > 0 && effView === "calendar" && (
          <ErrorBoundary label="calendar view">
            <CalendarView items={sorted} onSelect={(i) => router.push(buildItemHref(i as EnrichedItem))} />
          </ErrorBoundary>
        )}
      </main>
    </div>
  );
}
