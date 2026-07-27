"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { EnrichedItem, MediaType } from "@/types";
import SubBar, { SearchBarFacets, ViewMode } from "@/components/SubBar";
import { FacetPill, VocabMatch, SortKey, LIBRARY_SORTS, UiFilters, MembershipFilters, defaultUiFilters, normalizeSort } from "@/components/discovery/types";
import FilterPanel from "@/components/discovery/FilterPanel";
import { matchesFacets, passesYearMembership } from "@/lib/facetFilter";
import { sortItems, platformRating10 } from "@/lib/sortItems";
import { syncToCompletion } from "@/lib/syncClient";
import { usePersistedState, useScrollRestore } from "@/lib/usePersistedState";
import { buildItemHref } from "@/lib/itemUrl";
import GroupedView from "@/components/GroupedView";
import ErrorBoundary from "@/components/ErrorBoundary";
import EmptyState from "@/components/ui/EmptyState";
import Button, { buttonClasses } from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import LibraryWishlistTabs from "@/components/LibraryWishlistTabs";


export default function LibraryPageClient() {
  const router = useRouter();
  const [items, setItems] = useState<EnrichedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  // Persisted across back-nav (T12).
  // SM2: global type filter — one shared key across Wishlist / Library / Discover.
  const [types, setTypes] = usePersistedState<MediaType[]>("rr_type_filter", []);
  const [search, setSearch] = usePersistedState("rr_library_search", "");
  const [hideRated, setHideRated] = usePersistedState("rr_library_hideRated", false);
  const [includeFacets, setIncludeFacets] = usePersistedState<FacetPill[]>("rr_library_incFacets", []);
  const [excludeFacets, setExcludeFacets] = usePersistedState<FacetPill[]>("rr_library_excFacets", []);
  // H1.6f (Nils's call, 2026-07-26): Library defaults to "Recently added".
  // Release date is the wrong default for an archive of what you've already
  // watched/played — it interleaves decades and parks unreleased/TBA titles at
  // one end. `normalizeSort`'s fallback is passed explicitly so a stored legacy
  // value that no longer maps lands here too, not on the shared default.
  const [sort, setSort] = usePersistedState<SortKey>("rr_library_sort", "addedAt", (v) => normalizeSort(v, "addedAt"));
  const [yearRange, setYearRange] = usePersistedState<[number, number]>("rr_library_year", defaultUiFilters().yearRange);
  const [membership, setMembership] = usePersistedState<MembershipFilters>("rr_library_membership", {});

  useEffect(() => { init(); }, []);

  async function init() {
    const res = await fetch("/api/auth/me");
    const data = await res.json();
    if (!data.user) { router.replace("/"); return; }
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
  const groupBy: "month" | "rating" | "none" =
    sort === "rating" ? "rating" : sort === "releaseDate" ? "month" : "none";
  const descending = sort === "releaseDate";
  const ratingOf = sort === "rating" ? (i: any) => platformRating10(i) : undefined;
  // 2026-07-27 (Nils): grid-only, matching the mockups and Discover's same
  // 2026-07-27 change — no view switcher on any list page.
  const availableViews: ViewMode[] = ["card"];
  const effView: ViewMode = "card";
  useScrollRestore("rr_library_scroll", !loading && sorted.length > 0);
  const ratedCount = items.filter((i) => i.rating != null).length;

  return (
    <div className="min-h-screen">
      {/* Page title row — 04-pages/library.html: serif "Library" + a mono
          rated count, sitting above the tab switcher. */}
      {!loading && (
        <div className="max-w-6xl mx-auto px-6 pt-6 pb-1 flex items-baseline justify-between">
          <h1 className="font-serif text-serif-lg text-text-primary">Library</h1>
          <span className="font-mono text-meta text-text-secondary">{ratedCount} rated</span>
        </div>
      )}
      <LibraryWishlistTabs active="library" />
      <SubBar
        activeTypes={types}
        onToggleType={(t) => setTypes((prev) => toggleFilter(prev, t as MediaType))}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search your library…"
        searchFacets={searchFacets}
        hideRated={{ value: hideRated, onChange: setHideRated }}
        sort={{ value: sort, onChange: (v) => setSort(v as SortKey), options: LIBRARY_SORTS }}
        advancedFilters={<FilterPanel filters={advFilters} onChange={patchAdvanced} />}
        view={effView}
        onViewChange={() => {}}
        availableViews={availableViews}
        actions={
          <button
            onClick={sync}
            disabled={syncing}
            className="flex-shrink-0 text-sm px-3 py-1.5 bg-surface-elevated hover:bg-surface-overlay rounded-lg disabled:opacity-40 transition-colors border border-border-strong text-text-secondary hover:text-text-primary whitespace-nowrap"
          >
            {syncing ? "Syncing…" : "Sync"}
          </button>
        }
      />

      <main className="max-w-6xl mx-auto px-6 py-6">
        {loading && <Spinner label="Loading…" />}

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
            title={q ? <>No results for &ldquo;<span className="text-text-primary">{search}</span>&rdquo;</> : "No items match the current filters"}
            actions={q ? <Button variant="ghost" onClick={() => setSearch("")}>Clear search</Button> : undefined}
          />
        )}

        {!loading && sorted.length > 0 && (
          <ErrorBoundary label="library view">
            <GroupedView
              items={sorted}
              view={effView}
              groupBy={groupBy}
              descending={descending}
              ratingOf={ratingOf}
              onSelect={(i) => router.push(buildItemHref(i as EnrichedItem))}
              highlightId={highlightId}
              // Q3 (H1.6f): Library never auto-scrolls to today. It's an
              // archive of what you've ALREADY watched/played, so "today or
              // the next release date" is the far unreleased edge of the
              // list — landing there dropped you into a pile of TBA/
              // unreleased games instead of your library. Wishlist keeps the
              // behaviour: it's forward-looking, so "what's next" IS the
              // point of the page. Back-nav scroll restore is unaffected —
              // that's useScrollRestore above, a separate mechanism.
              autoScrollToToday={false}
            />
          </ErrorBoundary>
        )}
      </main>
    </div>
  );
}
