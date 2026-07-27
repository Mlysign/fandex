"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { EnrichedItem } from "@/types";
import { TYPE_COLORS } from "@/lib/constants";
import { buildItemHref } from "@/lib/itemUrl";
import { usePageTitle } from "@/lib/usePageTitle";
import CalendarView from "@/components/CalendarView";
import ErrorBoundary from "@/components/ErrorBoundary";
import Spinner from "@/components/ui/Spinner";
import Chip from "@/components/ui/Chip";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";

// H1.6c shipped the minimal version (auth-gate → /api/calendar → CalendarView,
// no filtering). H1.6e adds the type-chip row the plan called for — same
// Chip/TYPE_COLORS convention SubBar's type filter already uses elsewhere, so
// this reads as the same control rather than a bespoke one-off. Membership/
// year filters are NOT added here: Calendar shows your whole upcoming
// library+wishlist by design (that's the entire point of the page), so a
// library/wishlist toggle would just be a way to hide your own calendar.

const TYPES: EnrichedItem["type"][] = ["game", "movie", "show"];

export default function CalendarPage() {
  usePageTitle("Calendar");
  const router = useRouter();
  const [items, setItems] = useState<EnrichedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeTypes, setActiveTypes] = useState<string[]>([]);

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
      const res = await fetch("/api/calendar");
      if (!res.ok) throw new Error("calendar fetch failed");
      const data = await res.json();
      setItems(data.items ?? []);
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

  const toggleType = (t: string) =>
    setActiveTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const filtered = activeTypes.length === 0 ? items : items.filter((i) => activeTypes.includes(i.type));

  return (
    <div className="min-h-screen">
      <main className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        {!loading && !error && items.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Chip active={activeTypes.length === 0} onClick={() => activeTypes.length > 0 && setActiveTypes([])}>
              All
            </Chip>
            {TYPES.map((t) => (
              <Chip key={t} active={activeTypes.includes(t)} color={TYPE_COLORS[t]} dot={TYPE_COLORS[t]} onClick={() => toggleType(t)}>
                {t.charAt(0).toUpperCase() + t.slice(1)}s
              </Chip>
            ))}
          </div>
        )}

        {error ? (
          <ErrorState title="Couldn't load your calendar" hint="Check your connection and try again." onRetry={load} />
        ) : loading ? (
          <Spinner label="Loading…" />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="w-5 h-5" aria-hidden />}
            title="Nothing on your calendar yet"
            hint="Add titles to your library or wishlist from Discover and their release dates will show up here."
          />
        ) : filtered.length === 0 ? (
          <EmptyState title="No releases match this filter" hint="Try including another type." />
        ) : (
          <ErrorBoundary label="calendar">
            <CalendarView items={filtered} onSelect={(i) => router.push(buildItemHref(i as EnrichedItem))} />
          </ErrorBoundary>
        )}
      </main>
    </div>
  );
}
