"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { EnrichedItem, MediaType } from "@/types";
import { SOURCE_LABELS } from "@/lib/constants";
import { useViewMode } from "@/lib/useViewMode";
import SubBar, { ViewMode, SearchBarFacets } from "@/components/SubBar";
import { FacetPill, VocabMatch, SortKey, SORTS, DATE_SORTS, UiFilters, MembershipFilters, defaultUiFilters, normalizeSort } from "@/components/discovery/types";
import FilterPanel from "@/components/discovery/FilterPanel";
import { matchesFacets, passesYearMembership } from "@/lib/facetFilter";
import { sortItems, platformRating10 } from "@/lib/sortItems";
import { usePersistedState, useScrollRestore, hasSavedScroll } from "@/lib/usePersistedState";
import { WISHLIST_TOGGLED_EVENT, WishlistToggledDetail } from "@/lib/useQuickActions";
import { syncToCompletion } from "@/lib/syncClient";
import { buildItemHref } from "@/lib/itemUrl";
import CalendarView from "@/components/CalendarView";
import GroupedView from "@/components/GroupedView";
import ErrorBoundary, { ListSkeleton } from "@/components/ErrorBoundary";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import LibraryWishlistTabs from "@/components/LibraryWishlistTabs";

const SYNC_STALE_MS = 24 * 60 * 60 * 1000;

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

// ── Main page ─────────────────────────────────────────────────────
// H1.6c: moved from /dashboard → /wishlist (the old route 308-redirects here).
// Per D-A this and /library are one "my stuff" surface; the Library ⇄ Wishlist
// tab that unifies them is H1.6e — for now it keeps its own route + content.

export default function WishlistPageClient() {
  const router = useRouter();
  const [identities, setIdentities] = useState<any[]>([]);
  const [items, setItems] = useState<EnrichedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [autoSyncing, setAutoSyncing] = useState(false);
  const [view, setView] = useViewMode("rr_view_wishlist", "list", ["list", "card", "calendar"]);
  // Persisted across back-nav (T12). SM2: the type filter is GLOBAL — one
  // shared key across Wishlist / Library / Discover.
  const [types, setTypes] = usePersistedState<MediaType[]>("rr_type_filter", []);
  const [search, setSearch] = usePersistedState("rr_wishlist_search", "");
  const [includeFacets, setIncludeFacets] = usePersistedState<FacetPill[]>("rr_wishlist_incFacets", []);
  const [excludeFacets, setExcludeFacets] = usePersistedState<FacetPill[]>("rr_wishlist_excFacets", []);
  const [sort, setSort] = usePersistedState<SortKey>("rr_wishlist_sort", "releaseDate", normalizeSort);
  const [yearRange, setYearRange] = usePersistedState<[number, number]>("rr_wishlist_year", defaultUiFilters().yearRange);
  const [membership, setMembership] = usePersistedState<MembershipFilters>("rr_wishlist_membership", {});

  useEffect(() => { init(); }, []);

  // SM1 — a card's quick-action remove used to leave the row on screen until
  // the next reload (the shared hook only flips its own icon). Drop the row
  // the moment the shared hook reports a successful remove.
  useEffect(() => {
    const onToggle = (e: Event) => {
      const { id, onList } = (e as CustomEvent<WishlistToggledDetail>).detail;
      if (!onList) setItems((prev) => prev.filter((i) => i.id !== id));
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
    const res = await fetch("/api/calendar");
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
    if (q && !item.title.toLowerCase().includes(q)) return false;
    if (!matchesFacets(item, includeFacets, excludeFacets)) return false;
    if (!passesYearMembership(item, yearRange, membership)) return false;
    return true;
  });
  const sorted = sortItems(filtered, sort);

  // The item whose id matches the search query (for highlight ring)
  const highlightId = q && sorted.length > 0 ? sorted[0].id : null;

  const isBusy = syncing || autoSyncing;

  // Sort-driven layout (T8): rating sorts group by rating, best-match is flat,
  // date sorts keep the month grouping; calendar view only for date sorts.
  const isDateSort = DATE_SORTS.includes(sort);
  const groupBy: "month" | "rating" | "none" =
    sort === "rating" ? "rating" : sort === "releaseDate" ? "month" : "none";
  const descending = sort === "releaseDate";
  const ratingOf = sort === "rating" ? (i: any) => platformRating10(i) : undefined;
  const availableViews: ViewMode[] = isDateSort ? ["list", "card", "calendar"] : ["list", "card"];
  const effView: ViewMode = !isDateSort && view === "calendar" ? "card" : view;
  useScrollRestore("rr_wishlist_scroll", !loading && sorted.length > 0);
  // N2: sampled once on mount — if a Back-nav restore is pending, don't let
  // GroupedView's today-scroll fight it.
  const [autoToday] = useState(() => !hasSavedScroll("rr_wishlist_scroll"));

  return (
    <div className="min-h-screen">
      <LibraryWishlistTabs active="wishlist" />
      <SubBar
        activeTypes={types}
        onToggleType={(t) => setTypes((prev) => toggleFilter(prev, t as MediaType))}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search your wishlist…"
        searchFacets={searchFacets}
        sort={{ value: sort, onChange: (v) => setSort(v as SortKey), options: SORTS }}
        advancedFilters={<FilterPanel filters={advFilters} onChange={patchAdvanced} />}
        view={effView}
        onViewChange={setView}
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
        {loading && effView === "list"     && <ListSkeleton />}
        {loading && effView === "card"     && <Spinner label="Loading…" />}
        {loading && effView === "calendar" && <Spinner label="Loading…" />}

        {!loading && items.length === 0 && <OnboardingState identities={identities} />}

        {!loading && items.length > 0 && sorted.length === 0 && (
          <EmptyState
            title={<>No results{q ? <> for &ldquo;<span className="text-text-primary">{search}</span>&rdquo;</> : " with these filters"}</>}
            actions={q ? <Button variant="ghost" onClick={() => setSearch("")}>Clear search</Button> : undefined}
          />
        )}

        {!loading && sorted.length > 0 && effView !== "calendar" && (
          <ErrorBoundary label="wishlist view">
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
