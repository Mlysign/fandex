"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { EnrichedItem, MediaType } from "@/types";
import { SOURCE_LABELS } from "@/lib/constants";
import SubBar, { SearchBarFacets, ViewMode } from "@/components/SubBar";
import { FacetPill, VocabMatch, SortKey, LIBRARY_SORTS, UiFilters, MembershipFilters, defaultUiFilters, normalizeSort } from "@/components/discovery/types";
import FilterPanel from "@/components/discovery/FilterPanel";
import { matchesFacets, passesYearMembership } from "@/lib/facetFilter";
import { sortItems, platformRating10 } from "@/lib/sortItems";
import { usePersistedState, useScrollRestore, hasSavedScroll } from "@/lib/usePersistedState";
import { WISHLIST_TOGGLED_EVENT, WishlistToggledDetail } from "@/lib/useQuickActions";
import { syncToCompletion } from "@/lib/syncClient";
import { buildItemHref } from "@/lib/itemUrl";
import { mergeMyStuff, filterByTab, MyStuffTab } from "@/lib/myStuffMerge";
import GroupedView from "@/components/GroupedView";
import ErrorBoundary from "@/components/ErrorBoundary";
import EmptyState from "@/components/ui/EmptyState";
import Button, { buttonClasses } from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import LibraryWishlistTabs from "@/components/LibraryWishlistTabs";

const SYNC_STALE_MS = 24 * 60 * 60 * 1000;
const TAB_LABEL: Record<MyStuffTab, string> = { all: "All", wishlist: "Wishlist", unrated: "Unrated", rated: "Rated" };

// usePersistedState's `normalize` param must be a STABLE reference (its own
// hydrate effect is keyed on it) — a fresh arrow every render re-runs that
// effect on every render and clobbers each edit with the stored value a beat
// later. Bind the "addedAt" fallback once, at module scope, not inline.
const normalizeSortAddedAt = (v: unknown) => normalizeSort(v, "addedAt");

// ── First-run onboarding checklist (distinct from the shared <EmptyState>) ──
function OnboardingState({ identities }: { identities: any[] }) {
  const connectedProviders = new Set(identities.map((i: any) => i.provider));
  const hasAny = connectedProviders.size > 0;

  const steps = [
    {
      label: "Connect an account",
      done: hasAny,
      action: <Link href="/settings" className="text-xs px-3 py-1.5 rounded-lg bg-surface-elevated hover:bg-surface-overlay text-text-secondary hover:text-text-primary transition-colors">Go to Profile →</Link>,
      detail: hasAny
        ? `Connected: ${[...connectedProviders].map((p) => SOURCE_LABELS[p] ?? p).join(", ")}`
        : "Link Steam, Trakt, or RAWG to import your lists automatically.",
    },
    {
      label: "Add items from Discover",
      done: false,
      action: <Link href="/discover" className="text-xs px-3 py-1.5 rounded-lg bg-surface-elevated hover:bg-surface-overlay text-text-secondary hover:text-text-primary transition-colors">Go to Discover →</Link>,
      detail: "Browse upcoming releases and add them to your wishlist.",
    },
    {
      label: "Your release calendar is ready",
      done: false,
      action: null,
      detail: "Upcoming releases appear here sorted by date, in list, card, or calendar view.",
    },
  ];

  return (
    <div className="max-w-md mx-auto mt-16 px-4">
      <div className="text-center mb-10">
        <p className="font-serif text-serif-lg text-text-primary mb-2">Welcome to Fandex</p>
        <p className="text-text-secondary text-sm">Track every game, movie, and show you&apos;re waiting for — in one place.</p>
      </div>
      <div className="space-y-3">
        {steps.map((step, i) => (
          <div
            key={i}
            className="flex gap-4 p-4 rounded-xl border"
            style={{
              borderColor: step.done ? "var(--color-success-subtle)" : "var(--color-border)",
              background: step.done ? "var(--color-success-subtle)" : "var(--color-surface-elevated)",
            }}
          >
            <div
              className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold mt-0.5"
              style={{ background: step.done ? "var(--color-success)" : "var(--color-neutral-700)", color: step.done ? "var(--color-neutral-950)" : "var(--color-text-secondary)" }}
            >
              {step.done ? "✓" : i + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-3 mb-1">
                <p className={`text-sm font-medium ${step.done ? "text-text-secondary" : "text-text-primary"}`}>{step.label}</p>
                {step.action}
              </div>
              <p className="text-xs text-text-secondary leading-relaxed">{step.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────
// C8 (2026-07-28) — Library and Wishlist merged into one shared component.
// `route` decides which page's <h1>/count/empty-state/search-placeholder
// shows (it does NOT change when the user switches tabs — Back always
// restores the route's own framing, not a stale in-page tab). `initialTab`
// seeds the four-tab strip's local state; switching tabs is never navigation.
export default function MyStuffView({ route, initialTab }: { route: "library" | "wishlist"; initialTab: MyStuffTab }) {
  const router = useRouter();
  const [identities, setIdentities] = useState<any[]>([]);
  const [libraryItems, setLibraryItems] = useState<EnrichedItem[]>([]);
  const [wishlistItems, setWishlistItems] = useState<EnrichedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [autoSyncing, setAutoSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState<MyStuffTab>(initialTab);

  // Persisted across back-nav (T12). SM2: the type filter is GLOBAL — one
  // shared key across Discover / this merged view. Everything else collapses
  // the two pages' separate `rr_library_*`/`rr_wishlist_*` keys into one
  // shared `rr_mystuff_*` set (2026-07-28) — the tab now does the job the two
  // routes' separate filter state used to.
  const [types, setTypes] = usePersistedState<MediaType[]>("rr_type_filter", []);
  const [search, setSearch] = usePersistedState("rr_mystuff_search", "");
  const [includeFacets, setIncludeFacets] = usePersistedState<FacetPill[]>("rr_mystuff_incFacets", []);
  const [excludeFacets, setExcludeFacets] = usePersistedState<FacetPill[]>("rr_mystuff_excFacets", []);
  const [sort, setSort] = usePersistedState<SortKey>("rr_mystuff_sort", "addedAt", normalizeSortAddedAt);
  const [yearRange, setYearRange] = usePersistedState<[number, number]>("rr_mystuff_year", defaultUiFilters().yearRange);
  const [membership, setMembership] = usePersistedState<MembershipFilters>("rr_mystuff_membership", {});

  useEffect(() => { init(); }, []);

  // SM1 — a card's quick-action remove used to leave the row on screen until
  // the next reload (the shared hook only flips its own icon). Drop wishlist
  // membership from state the moment the shared hook reports a successful
  // remove — an item that's ALSO in the library stays visible (just loses
  // `inWishlist`), matching mergeMyStuff's derivation.
  useEffect(() => {
    const onToggle = (e: Event) => {
      const { id, onList } = (e as CustomEvent<WishlistToggledDetail>).detail;
      if (!onList) setWishlistItems((prev) => prev.filter((i) => i.id !== id));
    };
    window.addEventListener(WISHLIST_TOGGLED_EVENT, onToggle);
    return () => window.removeEventListener(WISHLIST_TOGGLED_EVENT, onToggle);
  }, []);

  async function init() {
    const res = await fetch("/api/auth/me");
    const data = await res.json();
    if (!data.user) { router.replace("/"); return; }
    setIdentities(data.identities ?? []);
    const syncLogs: { last_sync: number }[] = data.syncLogs ?? [];
    const latestSyncMs = syncLogs.length > 0 ? Math.max(...syncLogs.map((l) => l.last_sync * 1000)) : 0;
    if (Date.now() - latestSyncMs > SYNC_STALE_MS && (data.identities ?? []).length > 0) {
      setAutoSyncing(true);
      syncToCompletion("all").finally(() => setAutoSyncing(false));
    }
    await loadItems();
  }

  async function loadItems() {
    setLoading(true);
    const [libRes, calRes] = await Promise.all([fetch("/api/library"), fetch("/api/calendar")]);
    const libData = await libRes.json();
    const calData = await calRes.json();
    setLibraryItems(libData.items ?? []);
    setWishlistItems(calData.items ?? []);
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

  const advFilters: UiFilters = { ...defaultUiFilters(), types, includeFacets, excludeFacets, yearRange, membership };
  const patchAdvanced = (patch: Partial<UiFilters>) => {
    if (patch.yearRange) setYearRange(patch.yearRange);
    if (patch.membership) setMembership(patch.membership);
  };

  const merged = useMemo(() => mergeMyStuff(libraryItems, wishlistItems), [libraryItems, wishlistItems]);
  const tabItems = useMemo(() => filterByTab(merged, activeTab), [merged, activeTab]);

  const q = search.trim().toLowerCase();
  const filtered = tabItems.filter((item) => {
    if (types.length > 0 && !types.includes(item.type)) return false;
    if (q && !item.title.toLowerCase().includes(q)) return false;
    if (!matchesFacets(item, includeFacets, excludeFacets)) return false;
    if (!passesYearMembership(item, yearRange, membership)) return false;
    return true;
  });
  const sorted = sortItems(filtered, sort);

  const highlightId = q && sorted.length > 0 ? sorted[0].id : null;

  const groupBy: "month" | "rating" | "none" =
    sort === "rating" ? "rating" : sort === "releaseDate" ? "month" : "none";
  const descending = sort === "releaseDate";
  const ratingOf = sort === "rating" ? (i: any) => platformRating10(i) : undefined;
  const availableViews: ViewMode[] = ["card"];
  const effView: ViewMode = "card";
  useScrollRestore("rr_mystuff_scroll", !loading && sorted.length > 0);
  // N2: sampled once on mount — if a Back-nav restore is pending, don't let
  // GroupedView's today-scroll fight it. Q3/C8: Library must never
  // auto-scroll to today, so this only ever applies on the Wishlist tab with
  // a release-date sort (the forward-looking case "what's next" is about).
  const [autoTodaySampled] = useState(() => !hasSavedScroll("rr_mystuff_scroll"));
  const autoScrollToToday = activeTab === "wishlist" && sort === "releaseDate" && autoTodaySampled;

  const isBusy = syncing || autoSyncing;
  const ratedCount = merged.filter((i) => i.rating != null).length;
  const savedCount = merged.filter((i) => i.inWishlist).length;

  return (
    <div className="min-h-screen">
      {/* Page title row — each route keeps its own heading + count, tied to
          the ROUTE (not the active tab), same as before the merge. */}
      {!loading && (
        <div className="max-w-6xl mx-auto px-6 pt-6 pb-1 flex items-baseline justify-between">
          <h1 className="font-serif text-serif-lg text-text-primary">{route === "library" ? "Library" : "Wishlist"}</h1>
          <span className="font-mono text-meta text-text-secondary">
            {route === "library" ? `${ratedCount} rated` : `${savedCount} saved`}
          </span>
        </div>
      )}
      <LibraryWishlistTabs active={activeTab} onChange={setActiveTab} />
      <SubBar
        activeTypes={types}
        onToggleType={(t) => setTypes((prev) => toggleFilter(prev, t as MediaType))}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={route === "library" ? "Search your library…" : "Search your wishlist…"}
        searchFacets={searchFacets}
        sort={{ value: sort, onChange: (v) => setSort(v as SortKey), options: LIBRARY_SORTS }}
        advancedFilters={<FilterPanel filters={advFilters} onChange={patchAdvanced} />}
        view={effView}
        onViewChange={() => {}}
        availableViews={availableViews}
        actions={
          <button
            onClick={sync}
            disabled={isBusy}
            className="flex-shrink-0 text-sm px-3 py-1.5 bg-surface-elevated hover:bg-surface-overlay rounded-lg disabled:opacity-40 transition-colors border border-border-strong text-text-secondary hover:text-text-primary whitespace-nowrap"
          >
            {autoSyncing ? <span className="animate-pulse">Syncing…</span> : syncing ? "Syncing…" : "Sync"}
          </button>
        }
      />

      <main className="max-w-6xl mx-auto px-6 py-6">
        {loading && <Spinner label="Loading…" />}

        {!loading && merged.length === 0 && (
          activeTab === "wishlist"
            ? <OnboardingState identities={identities} />
            : (
              <EmptyState
                className="mt-20"
                title="Your library is empty"
                hint="Connect Trakt, Steam, or RAWG and sync to bring in everything you've watched, played, or own — with your personal scores."
                actions={
                  <>
                    <Link href="/settings" className={buttonClasses("secondary", "md")}>Go to Profile →</Link>
                    <Button variant="outline" size="md" onClick={sync} disabled={isBusy}>
                      {isBusy ? "Syncing…" : "Sync now"}
                    </Button>
                  </>
                }
              />
            )
        )}

        {!loading && merged.length > 0 && sorted.length === 0 && (
          <EmptyState
            title={
              q
                ? <>No results for &ldquo;<span className="text-text-primary">{search}</span>&rdquo;</>
                : tabItems.length === 0
                  ? `Nothing in ${TAB_LABEL[activeTab]} yet`
                  : "No items match the current filters"
            }
            actions={q ? <Button variant="ghost" onClick={() => setSearch("")}>Clear search</Button> : undefined}
          />
        )}

        {!loading && sorted.length > 0 && (
          <ErrorBoundary label="library/wishlist view">
            <GroupedView
              items={sorted}
              view={effView}
              groupBy={groupBy}
              descending={descending}
              ratingOf={ratingOf}
              onSelect={(i) => router.push(buildItemHref(i as EnrichedItem))}
              highlightId={highlightId}
              autoScrollToToday={autoScrollToToday}
            />
          </ErrorBoundary>
        )}
      </main>
    </div>
  );
}
