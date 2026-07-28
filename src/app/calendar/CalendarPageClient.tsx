"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { format, addMonths, parseISO } from "date-fns";
import { CalendarDays, List } from "lucide-react";
import { EnrichedItem, MediaType } from "@/types";
import { buildItemHref } from "@/lib/itemUrl";
import { normalizeName } from "@/lib/normalize";
import { mergeMyStuff } from "@/lib/myStuffMerge";
import { usePersistedState } from "@/lib/usePersistedState";
import CalendarView, { CalendarItem, CalendarMode } from "@/components/CalendarView";
import SubBar from "@/components/SubBar";
import ErrorBoundary from "@/components/ErrorBoundary";
import Spinner from "@/components/ui/Spinner";
import ScopeFilter, { CalendarScope, CALENDAR_SCOPES } from "@/components/ui/ScopeFilter";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";

// The calendar answers "what's coming out", from three independent sources
// (2026-07-28, Nils's brief). It used to be wishlist-only, which meant it could
// only ever show you things you'd already found yourself:
//
//   wishlist — /api/calendar (user_watchlist)
//   library  — /api/library  (user_library), lazily fetched
//   popular  — /api/calendar/popular?month=…, live from the providers, per month
//
// Scope + type are two separate chip rows in the shared SubBar, in the standard
// page order (filters → tabs → search → content); the calendar has no tabs and
// nothing to search, so it renders neither.

const MONTH_KEY = "yyyy-MM";
const monthKeyOf = (d: Date) => format(d, MONTH_KEY);
const nextMonthKey = (key: string) => monthKeyOf(addMonths(parseISO(`${key}-01`), 1));

const DEFAULT_SCOPES: CalendarScope[] = [...CALENDAR_SCOPES];

/** Same shape popularMonth.ts dedupes on, so the two agree on "same title". */
const dedupeKey = (i: { type: string; title: string; releaseDate: string | null }) =>
  `${i.type}|${normalizeName(i.title ?? "")}|${i.releaseDate ?? ""}`;

export default function CalendarPageClient() {
  const router = useRouter();
  const [libraryItems, setLibraryItems] = useState<EnrichedItem[]>([]);
  const [wishlistItems, setWishlistItems] = useState<EnrichedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [mode, setMode] = useState<CalendarMode>("month");

  // SM2's shared type-filter key, so Games-only set on Discover/Library/Home
  // still holds here (it used to be plain useState and reset on every visit).
  const [activeTypes, setActiveTypes] = usePersistedState<MediaType[]>("rr_type_filter", []);
  const [scopes, setScopes] = usePersistedState<CalendarScope[]>("rr_calendar_scopes", DEFAULT_SCOPES);

  const wantsLibrary = scopes.includes("library");
  const wantsWishlist = scopes.includes("wishlist");
  const wantsPopular = scopes.includes("popular");

  // ── Popular, per month ──────────────────────────────────────────
  // /api/library is ~2,000 fully-enriched items and /api/calendar/popular is a
  // live provider fan-out, so neither is fetched until its scope is actually
  // on. `requested` is a ref, not state: it guards against a duplicate in-flight
  // request, which is a concern about THIS render pass, not something the UI
  // reads. A failed month is removed from it so paging back can retry.
  const [popularByMonth, setPopularByMonth] = useState<Record<string, CalendarItem[]>>({});
  const [popularLoading, setPopularLoading] = useState(false);
  const requestedMonths = useRef<Set<string>>(new Set());
  const libraryRequested = useRef(false);

  const loadPopularMonth = useCallback(async (key: string) => {
    if (requestedMonths.current.has(key)) return;
    requestedMonths.current.add(key);
    setPopularLoading(true);
    try {
      const res = await fetch(`/api/calendar/popular?month=${key}`);
      if (!res.ok) throw new Error("popular fetch failed");
      const data = await res.json();
      setPopularByMonth((prev) => ({ ...prev, [key]: data.items ?? [] }));
    } catch {
      requestedMonths.current.delete(key); // let a later visit retry
    } finally {
      setPopularLoading(false);
    }
  }, []);

  const loadLibrary = useCallback(async () => {
    if (libraryRequested.current) return;
    libraryRequested.current = true;
    try {
      const res = await fetch("/api/library");
      if (!res.ok) throw new Error("library fetch failed");
      const data = await res.json();
      setLibraryItems(data.items ?? []);
    } catch {
      libraryRequested.current = false;
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const me = await fetch("/api/auth/me").then((r) => r.json());
      // SM8 (2026-07-27): replace(), never push(). push() leaves THIS gated
      // route in history, so an anon visitor pressing Back re-enters it and
      // gets redirected again — Back appears dead and they can never get
      // back to the page they came from. Same rule at every auth gate and
      // both logout handlers.
      if (!me.user) { router.replace("/"); return; }
      // The wishlist read is unconditional: mergeMyStuff needs it to mark a
      // library item as also-wishlisted, and it's the smaller of the two.
      const res = await fetch("/api/calendar");
      if (!res.ok) throw new Error("calendar fetch failed");
      const data = await res.json();
      setWishlistItems(data.items ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [router]);

  // Fetch-on-mount: the server can't know the session, so the auth-gate + the
  // calendar payload are both resolved client-side. Same justified disable
  // the discover/insights/item-detail islands already use for this pattern.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  // Pull the library in as soon as its scope is on — on mount when it's the
  // stored default, or the moment the user switches it on later. Same
  // fetch-in-an-effect shape (and same justified disable) as `load` above: the
  // set only runs after an await, but the rule can't see through the async
  // call, and there's nowhere else a network fetch could live.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!loading && wantsLibrary) loadLibrary();
  }, [loading, wantsLibrary, loadLibrary]);

  // CalendarView reports the month it's showing (on mount and on every page).
  // Stored as a "yyyy-MM" STRING, not a Date: an identical string lets React
  // bail out of the re-render, where a fresh Date object never compares equal.
  const [visibleMonthKey, setVisibleMonthKey] = useState(() => monthKeyOf(new Date()));
  const onVisibleMonthChange = useCallback((month: Date) => setVisibleMonthKey(monthKeyOf(month)), []);

  // Fetching is driven from an effect over (month, mode, scope) rather than
  // from the callback above, because two of those three change WITHOUT the
  // month changing: switching to the agenda, and switching the Popular scope
  // on. Doing it in the callback meant neither fetched anything until you
  // happened to page to another month.
  //
  // Agenda mode also pulls the next month: it lists forward months on one
  // screen, so with only the current month loaded the future looks empty.
  useEffect(() => {
    if (!wantsPopular) return;
    // Same justified disable as the fetches above — the set happens after an
    // await inside loadPopularMonth, which the rule can't see through.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPopularMonth(visibleMonthKey);
    if (mode === "agenda") loadPopularMonth(nextMonthKey(visibleMonthKey));
  }, [visibleMonthKey, mode, wantsPopular, loadPopularMonth]);

  const toggleType = (t: string) =>
    setActiveTypes((prev) => (prev.includes(t as MediaType) ? prev.filter((x) => x !== t) : [...prev, t as MediaType]));
  const toggleScope = (s: CalendarScope) =>
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  // ── Compose the visible set ─────────────────────────────────────
  const personal = useMemo(() => mergeMyStuff(libraryItems, wishlistItems), [libraryItems, wishlistItems]);

  const scoped = useMemo<CalendarItem[]>(() => {
    const out: CalendarItem[] = [];
    const seenIds = new Set<string>();
    const seenKeys = new Set<string>();

    for (const item of personal) {
      if (!((wantsWishlist && item.inWishlist) || (wantsLibrary && item.inLibrary))) continue;
      out.push(item);
      seenIds.add(item.id);
      seenKeys.add(dedupeKey(item));
    }

    if (wantsPopular) {
      for (const monthItems of Object.values(popularByMonth)) {
        for (const item of monthItems) {
          // A popular item you already track is the SAME item — it's already on
          // screen (with its bookmark/rating) via the personal pass above.
          // Match on uuid first; both sides are persisted rows, so ids line up
          // in the normal case. The title+date key covers the gap where a
          // provider result hasn't been matched to the existing row yet.
          if (seenIds.has(item.id) || seenKeys.has(dedupeKey(item))) continue;
          out.push(item);
          seenIds.add(item.id);
          seenKeys.add(dedupeKey(item));
        }
      }
    }

    return out;
  }, [personal, popularByMonth, wantsWishlist, wantsLibrary, wantsPopular]);

  const filtered = activeTypes.length === 0 ? scoped : scoped.filter((i) => activeTypes.includes(i.type as MediaType));

  const modeToggle = (
    <button
      onClick={() => setMode((m) => (m === "month" ? "agenda" : "month"))}
      className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-surface-elevated border border-border text-text-primary text-label hover:border-border-strong transition-colors duration-fast whitespace-nowrap"
    >
      {mode === "month" ? (
        <><List className="w-3.5 h-3.5" aria-hidden />List</>
      ) : (
        <><CalendarDays className="w-3.5 h-3.5" aria-hidden />Month</>
      )}
    </button>
  );

  const body = () => {
    if (error) return <ErrorState title="Couldn't load your calendar" hint="Check your connection and try again." onRetry={load} />;
    if (loading) return <Spinner label="Loading…" />;
    if (scopes.length === 0) {
      return (
        <EmptyState
          icon={<CalendarDays className="w-5 h-5" aria-hidden />}
          title="No sources selected"
          hint="Turn on Wishlist, Library or Popular above to see releases."
        />
      );
    }
    if (scoped.length === 0) {
      return (
        <EmptyState
          icon={<CalendarDays className="w-5 h-5" aria-hidden />}
          title="Nothing on your calendar yet"
          hint="Add titles to your library or wishlist from Discover, or turn on Popular to see what's coming out this month."
        />
      );
    }
    if (filtered.length === 0) {
      return <EmptyState title="No releases match this filter" hint="Try including another type." />;
    }
    return (
      <ErrorBoundary label="calendar">
        <CalendarView
          items={filtered}
          mode={mode}
          onVisibleMonthChange={onVisibleMonthChange}
          onSelect={(i) => router.push(buildItemHref(i as EnrichedItem))}
        />
      </ErrorBoundary>
    );
  };

  return (
    <div className="min-h-screen">
      {/* Every list page's heading is now visually gone (Nils, 2026-07-28) —
          the filter row IS the header. Keep an sr-only one so the page still
          has a document outline for screen readers and the a11y tree isn't a
          headingless blob. */}
      <h1 className="sr-only">Calendar</h1>

      <SubBar
        activeTypes={activeTypes}
        onToggleType={toggleType}
        filters={<ScopeFilter activeScopes={scopes} onToggleScope={toggleScope} />}
        actions={modeToggle}
        availableViews={[]}
      />

      {/* px-1 on mobile, not px-6: the grid needs the screen width more than it
          needs a margin. See CalendarView's grid comment. */}
      <main className="max-w-6xl mx-auto px-1 md:px-6 py-4 md:py-6 space-y-3 md:space-y-4">
        {popularLoading && !loading && (
          <p className="font-mono text-meta text-text-secondary text-center" role="status">Loading popular releases…</p>
        )}
        {body()}
      </main>
    </div>
  );
}
