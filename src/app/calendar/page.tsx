"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { EnrichedItem } from "@/types";
import { buildItemHref } from "@/lib/itemUrl";
import { usePageTitle } from "@/lib/usePageTitle";
import CalendarView from "@/components/CalendarView";
import ErrorBoundary from "@/components/ErrorBoundary";
import Spinner from "@/components/ui/Spinner";

// H1.6c — new top-level /calendar route. The calendar used to exist only as a
// view mode inside Wishlist/Library; the IA restructure promotes it to its own
// destination in the nav. This is the minimal version: the user's upcoming
// wishlist + library releases (the same /api/calendar payload the wishlist
// page uses) rendered in CalendarView, which carries its own Month ⇄ Agenda
// toggle (H1.6d). Richer filtering/type-chips land in H1.6e.

export default function CalendarPage() {
  usePageTitle("Calendar");
  const router = useRouter();
  const [items, setItems] = useState<EnrichedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const me = await fetch("/api/auth/me").then((r) => r.json());
      if (!me.user) { router.push("/"); return; }
      const data = await fetch("/api/calendar").then((r) => r.json());
      setItems(data.items ?? []);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen">
      <main className="max-w-6xl mx-auto px-6 py-6">
        {loading ? (
          <Spinner label="Loading…" />
        ) : (
          <ErrorBoundary label="calendar">
            <CalendarView items={items} onSelect={(i) => router.push(buildItemHref(i as EnrichedItem))} />
          </ErrorBoundary>
        )}
      </main>
    </div>
  );
}
