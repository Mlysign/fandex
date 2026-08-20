"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Bookmark } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { EnrichedItem, MediaType } from "@/types";
import { SOURCE_LABELS } from "@/lib/constants";
import type { SearchBarFacets, ViewMode } from "@/components/SubBar";
import SubBar from "@/components/SubBar";
import type { FacetPill, VocabMatch, SortKey, UiFilters, MembershipFilters} from "@/components/discovery/types";
import { LIBRARY_SORTS, defaultUiFilters, normalizeSort, countActiveAdvanced } from "@/components/discovery/types";
import FilterPanel from "@/components/discovery/FilterPanel";
import { matchesFacets, passesYearMembership } from "@/lib/facetFilter";
import { sortItems, platformRating10 } from "@/lib/sortItems";
import { usePersistedState, useScrollRestore, hasSavedScroll } from "@/lib/usePersistedState";
import { useDebouncedValue } from "@/lib/useDebounced";
import type { WishlistToggledDetail } from "@/lib/useQuickActions";
import { WISHLIST_TOGGLED_EVENT } from "@/lib/useQuickActions";
import { syncToCompletion } from "@/lib/syncClient";
import { buildItemHref } from "@/lib/itemUrl";
import type { MyStuffTab } from "@/lib/myStuffMerge";
import { mergeMyStuff, filterByTab, parseTab } from "@/lib/myStuffMerge";
import GroupedView from "@/components/GroupedView";
import ErrorBoundary from "@/components/ErrorBoundary";
import EmptyState from "@/components/ui/EmptyState";
import Button, { buttonClasses } from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";
import LibraryWishlistTabs, { tabId, TABPANEL_ID } from "@/components/LibraryWishlistTabs";
import ProgressTabPanel from "@/components/ProgressTabPanel";
import SignInDialog from "@/components/auth/SignInDialog";
import { resetSessionProbe } from "@/lib/sessionProbe";

const SYNC_STALE_MS = 24 * 60 * 60 * 1000;
const TAB_LABEL: Record<MyStuffTab, string> = { wishlist: "Wishlist", progress: "Progress", library: "Library" };
// The noun the toolbar counts in. "progress" counts EPISODES, not titles — and
// its count comes from its own panel, so the toolbar's number is suppressed for
// that tab rather than reporting a library total under an episode heading.
// SubBar renders this as `${noun} · ${count}`, so the noun has to read as a
// label, not a phrase — "in library · 1922" is clumsy where "titles · 1922"
// isn't, and the tab is already called Library.
const TAB_NOUN: Record<MyStuffTab, string> = { wishlist: "saved", progress: "episodes", library: "titles" };

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
        <p className="text-text-secondary text-sm">Every game, movie and show you&apos;re waiting for, in one place.</p>
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
// `route` decides the empty-state copy/search-placeholder and is the URL's
// own path (/library or /wishlist); `initialTab` is that route's default tab.
//
// SM21 (2026-07-28) — REVERSES C8's "switching tabs is never navigation"
// call. That made the tab strip pure client state: no URL/heading/count
// change, lost on reload, and Back exited the page entirely instead of
// returning to the previous tab — while /wishlist, a real route, got all of
// that right. The tab now lives in `?tab=`, so <h1>/count both track the
// ACTIVE TAB (not the route), a reload restores it, and Back is a real
// history entry.
function MyStuffContent({ route, initialTab }: { route: "library" | "wishlist"; initialTab: MyStuffTab }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [identities, setIdentities] = useState<any[]>([]);
  const [libraryItems, setLibraryItems] = useState<EnrichedItem[]>([]);
  const [wishlistItems, setWishlistItems] = useState<EnrichedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [autoSyncing, setAutoSyncing] = useState(false);
  /** Auth resolved — gates the item load so it can't race ahead of the session check. */
  const [authChecked, setAuthChecked] = useState(false);
  /** null = session probe still in flight; true = signed out, render the gate. */
  const [anon, setAnon] = useState<boolean | null>(null);
  const [showSignIn, setShowSignIn] = useState(false);
  /** The (large) item payload has been fetched at least once. */
  const [itemsLoaded, setItemsLoaded] = useState(false);
  // The `?tab=` query param IS the state — no local mirror. Deriving it
  // directly (rather than useState+effect) means Back/Forward/reload all just
  // work: each is a normal navigation that changes searchParams, and this
  // recomputes on the next render with no sync effect to keep in step.
  const activeTab = parseTab(searchParams.get("tab"), initialTab);

  function changeTab(tab: MyStuffTab) {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === initialTab) params.delete("tab"); // keep the canonical URL clean at the route's own default
    else params.set("tab", tab);
    const qs = params.toString();
    router.push(`/${route}${qs ? `?${qs}` : ""}`, { scroll: false });
  }

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
    // 2026-08-18 — this used to `router.replace("/")`. Nils: "clicking
    // 'wishlist' did redirect to home instead of asking to sign up." A bounce
    // is the wrong answer for a nav slot that is visible to anonymous visitors
    // and that AppNav renders as a plain link for them: it reads as a broken
    // link, not as a gate, because nothing ever says a sign-in was needed.
    // Unlike the calendar, there is no public half of this page to show —
    // library and wishlist ARE the user's own data — so the whole view becomes
    // a sign-in prompt rather than a partial render.
    if (!data.user) { setAnon(true); return; }
    setAnon(false);
    setIdentities(data.identities ?? []);
    const syncLogs: { last_sync: number }[] = data.syncLogs ?? [];
    const latestSyncMs = syncLogs.length > 0 ? Math.max(...syncLogs.map((l) => l.last_sync * 1000)) : 0;
    if (Date.now() - latestSyncMs > SYNC_STALE_MS && (data.identities ?? []).length > 0) {
      setAutoSyncing(true);
      syncToCompletion("all").finally(() => setAutoSyncing(false));
    }
    setAuthChecked(true);
  }

  // Kicked off once on mount. Declared AFTER init so the reference is not a
  // use-before-declaration — the lint rule that flags it is guarding against a
  // stale binding, which is a real hazard for a function this one calls.
  // Both disables are justified: init's first statement is an `await fetch`, so
  // every setState in it happens after a suspension point rather than
  // synchronously in the effect body — the rule can't see through the call.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { void init(); }, []);

  async function loadItems() {
    setLoading(true);
    try {
      const [libRes, calRes] = await Promise.all([fetch("/api/library"), fetch("/api/calendar")]);
      const libData = await libRes.json();
      const calData = await calRes.json();
      setLibraryItems(libData.items ?? []);
      setWishlistItems(calData.items ?? []);
      setItemsLoaded(true);
    } finally {
      // In a `finally`, because this used to be the last statement of a
      // try-less function: a rejected fetch or a body that failed to parse left
      // `loading` true forever and the page sat on "Loading…" with no error and
      // no way out. The payload here is multi-megabyte, which is exactly the
      // kind of response that fails halfway.
      setLoading(false);
    }
  }

  // MB16 — the item payload is loaded by the effect below, NOT here, so the
  // Progress tab can skip it entirely.
  //
  // It is not a small skip: `/api/library` is ~8.9 MB across 1,922 items on this
  // account, and every render then runs merge/filter/sort memos over all of it.
  // The Progress tab needs none of that — it lists episodes from /api/progress —
  // so before this split, following Home's "See all" meant waiting on a
  // multi-megabyte download and a main-thread stall before a single episode row
  // appeared. Measured in the browser pane: the tab stayed blank for 30 s+ and
  // the renderer stopped responding. Deep-linking to ?tab=progress now costs one
  // small request.
  useEffect(() => {
    if (!authChecked || activeTab === "progress" || itemsLoaded) return;
    // loadItems' own setState calls sit around an `await`, so none of them runs
    // synchronously in this effect body — same justified disable as above.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadItems();
  }, [authChecked, activeTab, itemsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const advancedActiveCount = countActiveAdvanced(advFilters);
  const patchAdvanced = (patch: Partial<UiFilters>) => {
    if (patch.yearRange) setYearRange(patch.yearRange);
    if (patch.membership) setMembership(patch.membership);
  };

  const merged = useMemo(() => mergeMyStuff(libraryItems, wishlistItems), [libraryItems, wishlistItems]);
  const tabItems = useMemo(() => filterByTab(merged, activeTab), [merged, activeTab]);

  // SM19 (2026-07-28): the search box used to re-filter + re-render this
  // (potentially ~2,000-item) list on every keystroke — 237ms for the first
  // character, 1,426ms clearing the box. `search` stays the input's own
  // instant, controlled value; only the filter predicate reads the debounced
  // copy, so typing itself never lags but the expensive re-render does.
  const debouncedSearch = useDebouncedValue(search, 200);
  const q = debouncedSearch.trim().toLowerCase();
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

  // SM19 (2026-07-28): /library's ~2,000-item "All"/"Rated"/"Unrated" tabs are
  // what actually blocked the main thread — Wishlist (here or on its own
  // route) is ~96 items, well under the 300-item first page, so the cap is a
  // no-op there either way. Reuses the SAME "no restore pending" sample as
  // autoScrollToToday above: a Back-nav's saved scroll offset may exceed what
  // 300 items would render, so this session skips the cap entirely rather
  // than fight the restore — the (rare) cost is one full-list render on that
  // one navigation, not on every visit.
  const INCREMENTAL_PAGE = 300;
  const capRender = route === "library" && autoTodaySampled;

  const isBusy = syncing || autoSyncing;

  // ── Signed out ────────────────────────────────────────────────────────────
  // Returned BEFORE the toolbar: every control in it (search your wishlist,
  // sort your library, sync your accounts) addresses data that doesn't exist
  // yet, so rendering the chrome around an empty set would be a page pretending
  // to work. `anon === null` (probe in flight) falls through to the normal
  // loading spinner rather than flashing this.
  if (anon) {
    const noun = route === "library" ? "library" : "wishlist";
    return (
      <div className="min-h-screen">
        <h1 className="sr-only">{TAB_LABEL[activeTab]}</h1>
        <main className="max-w-6xl mx-auto px-6 py-6">
          <EmptyState
            className="mt-20"
            icon={<Bookmark className="w-5 h-5" aria-hidden />}
            title={`Sign in to see your ${noun}`}
            hint="Connect Trakt, Steam, RAWG or TMDB and Fandex brings in everything you've watched, played, saved or own, then tracks what's coming next."
            actions={
              <>
                <Button variant="primary" size="md" onClick={() => setShowSignIn(true)}>Sign in</Button>
                <Link href="/discover" className={buttonClasses("outline", "md")}>Browse without an account →</Link>
              </>
            }
          />
        </main>
        {showSignIn && (
          <SignInDialog
            returnTo={`/${route}`}
            onClose={() => setShowSignIn(false)}
            // RAWG signs in in-place with no redirect, so nothing re-mounts on
            // its own: drop the cached probe and re-run init(), which clears
            // `anon` and lets the item-load effect fire.
            onAuthenticated={() => { resetSessionProbe(); setShowSignIn(false); void init(); }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* 2026-07-28: the visible "Library"/"Wishlist" <h1> + rated/saved count
          row is gone (Nils: "remove all headlines"). The heading survives
          sr-only so the page keeps a document outline. SM21 (2026-07-28):
          both this and the result count below now track the ACTIVE TAB, not
          the route — they used to always report the route's own rated/saved
          totals even while a different tab (with a different, filtered set)
          was showing. */}
      <h1 className="sr-only">{TAB_LABEL[activeTab]}</h1>
      <SubBar
        activeTypes={types}
        onToggleType={(t) => setTypes((prev) => toggleFilter(prev, t as MediaType))}
        tabs={<LibraryWishlistTabs active={activeTab} onChange={changeTab} />}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={route === "library" ? "Search your library…" : "Search your wishlist…"}
        searchFacets={searchFacets}
        sort={{ value: sort, onChange: (v) => setSort(v as SortKey), options: LIBRARY_SORTS }}
        advancedFilters={<FilterPanel filters={advFilters} onChange={patchAdvanced} />}
        advancedActiveCount={advancedActiveCount}
        // Progress counts episodes, and only its own panel knows how many — so
        // suppress the toolbar's number there rather than showing a library
        // total under an episode heading. The panel prints its own count.
        resultCount={loading || activeTab === "progress" ? null : tabItems.length}
        resultNoun={TAB_NOUN[activeTab]}
        view={effView}
        onViewChange={() => {}}
        availableViews={availableViews}
        actions={
          <button
            onClick={sync}
            disabled={isBusy}
            // SM37: the visible pill is 60×34, under the 44px minimum. Height-only
            // expansion (.tap-44-y) is the right variant here — the button is
            // already 60px wide, so only the height was short, and claiming extra
            // WIDTH would push its transparent hit area into the header controls
            // beside it. See globals.css for the two constraints on this class.
            className="tap-44-y flex-shrink-0 text-sm px-3 py-1.5 bg-surface-elevated hover:bg-surface-overlay rounded-lg disabled:opacity-40 transition-colors border border-border-strong text-text-secondary hover:text-text-primary whitespace-nowrap"
          >
            {autoSyncing ? <span className="animate-pulse">Syncing…</span> : syncing ? "Syncing…" : "Sync"}
          </button>
        }
      />

      {/* SM29 — bridges the tab strip's role="tab" buttons to their content,
          which had no role="tabpanel" anywhere. */}
      <main id={TABPANEL_ID} role="tabpanel" aria-labelledby={tabId(activeTab)} className="max-w-6xl mx-auto px-6 py-6">
        {/* MB16 — Progress is the one tab that isn't a filter over `merged`: it
            lists EPISODES from /api/progress, owns its own paging, and shares
            none of the item pipeline above (search, facets, sort and grouping
            all address titles, not episodes). So it returns early rather than
            threading an "is this an episode?" branch through five render
            blocks. The toolbar above stays visible because the tab strip lives
            in it — the filters simply don't apply here, which is why none of
            them are consulted. */}
        {activeTab === "progress" ? (
          <ErrorBoundary label="library progress tab">
            <ProgressTabPanel />
          </ErrorBoundary>
        ) : (
          <>
        {loading && <Spinner label="Loading…" />}

        {!loading && merged.length === 0 && (
          activeTab === "wishlist"
            ? <OnboardingState identities={identities} />
            : (
              <EmptyState
                className="mt-20"
                title="Your library is empty"
                hint="Connect Trakt, Steam or RAWG and sync to bring in everything you've watched, played or own, with your personal scores."
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
              initialCount={capRender ? INCREMENTAL_PAGE : undefined}
              step={capRender ? INCREMENTAL_PAGE : undefined}
            />
          </ErrorBoundary>
        )}
          </>
        )}
      </main>
    </div>
  );
}

// useSearchParams requires a Suspense boundary above it in the app router
// (same pattern as SettingsPageClient) — MyStuffContent does the real work.
export default function MyStuffView({ route, initialTab }: { route: "library" | "wishlist"; initialTab: MyStuffTab }) {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <MyStuffContent route={route} initialTab={initialTab} />
    </Suspense>
  );
}
