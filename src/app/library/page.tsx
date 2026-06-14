"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { EnrichedItem, MediaType } from "@/types";
import { useViewMode } from "@/lib/useViewMode";
import NavBar from "@/components/NavBar";
import SubBar, { SearchBarFacets, ViewMode } from "@/components/SubBar";
import { FacetPill, VocabMatch, SortKey, SORTS, DATE_SORTS, UiFilters, Membership, defaultUiFilters } from "@/components/discovery/types";
import FilterPanel from "@/components/discovery/FilterPanel";
import { matchesFacets, passesYearMembership } from "@/lib/facetFilter";
import { sortItems, platformRating10 } from "@/lib/sortItems";
import { buildItemHref } from "@/lib/itemUrl";
import CalendarView from "@/components/CalendarView";
import GroupedView from "@/components/GroupedView";
import ErrorBoundary, { ListSkeleton, CardSkeleton } from "@/components/ErrorBoundary";

type Filter = { types: MediaType[] };

export default function LibraryPage() {
  const router = useRouter();
  const [items, setItems] = useState<EnrichedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [view, setView] = useViewMode("list", ["list", "card", "calendar"]);
  const [filter, setFilter] = useState<Filter>({ types: [] });
  const [search, setSearch] = useState("");
  const [hideRated, setHideRated] = useState(false);
  const [includeFacets, setIncludeFacets] = useState<FacetPill[]>([]);
  const [excludeFacets, setExcludeFacets] = useState<FacetPill[]>([]);
  const [sort, setSort] = useState<SortKey>("releaseOld");
  const [yearRange, setYearRange] = useState<[number, number]>(defaultUiFilters().yearRange);
  const [membership, setMembership] = useState<{ library?: Membership; wishlist?: Membership }>({});

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
    await fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "all" }) });
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
  const advFilters: UiFilters = { ...defaultUiFilters(), types: filter.types, includeFacets, excludeFacets, yearRange, membership };
  const patchAdvanced = (patch: Partial<UiFilters>) => {
    if (patch.yearRange) setYearRange(patch.yearRange);
    if (patch.membership) setMembership(patch.membership);
  };

  const q = search.trim().toLowerCase();
  const filtered = items.filter((item) => {
    if (filter.types.length > 0 && !filter.types.includes(item.type)) return false;
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
    sort === "userRating" || sort === "platformRating" ? "rating" : sort === "match" ? "none" : "month";
  const descending = sort === "releaseNew";
  const ratingOf =
    sort === "userRating" ? (i: any) => i.rating ?? null
    : sort === "platformRating" ? (i: any) => platformRating10(i)
    : undefined;
  const availableViews: ViewMode[] = isDateSort ? ["list", "card", "calendar"] : ["list", "card"];
  const effView: ViewMode = !isDateSort && view === "calendar" ? "card" : view;

  return (
    <div className="min-h-screen">
      <NavBar />

      <SubBar
        activeTypes={filter.types}
        onToggleType={(t) => setFilter((f) => ({ ...f, types: toggleFilter(f.types, t as MediaType) }))}
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
        {loading && effView === "card"     && <CardSkeleton />}
        {loading && effView === "calendar" && <div className="text-center py-20 text-neutral-500">Loading…</div>}

        {!loading && items.length === 0 && (
          <div className="max-w-md mx-auto mt-20 text-center">
            <p className="text-2xl font-bold mb-2">Your library is empty</p>
            <p className="text-neutral-400 text-sm mb-6">
              Connect Trakt, Letterboxd, Steam, or RAWG and sync to bring in everything you've watched, played, or own — with your personal scores.
            </p>
            <div className="flex gap-3 justify-center">
              <Link href="/settings" className="text-sm px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 transition-colors">Go to Profile →</Link>
              <button onClick={sync} disabled={syncing} className="text-sm px-4 py-2 rounded-lg border border-neutral-700 hover:bg-neutral-800 transition-colors disabled:opacity-40">
                {syncing ? "Syncing…" : "Sync now"}
              </button>
            </div>
          </div>
        )}

        {!loading && items.length > 0 && sorted.length === 0 && (
          <div className="text-center py-16 text-neutral-500">
            {q ? (
              <>
                <p className="mb-2">No results for &ldquo;<span className="text-white">{search}</span>&rdquo;</p>
                <button onClick={() => setSearch("")} className="text-xs text-neutral-400 underline">Clear search</button>
              </>
            ) : (
              <p>No items match the current filters.</p>
            )}
          </div>
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
