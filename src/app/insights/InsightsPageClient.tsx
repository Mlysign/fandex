"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BarChart3 } from "lucide-react";
import InsightsView from "@/components/insights/InsightsView";
import type { InsightsPayload } from "@/components/insights/types";
import Spinner from "@/components/ui/Spinner";
import EmptyState from "@/components/ui/EmptyState";
import ErrorState from "@/components/ui/ErrorState";
import Eyebrow from "@/components/ui/Eyebrow";

type Status = "loading" | "ready" | "empty" | "error";

export default function InsightsPageClient() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [data, setData] = useState<InsightsPayload | null>(null);

  const init = useCallback(async () => {
    setStatus("loading");
    const me = await fetch("/api/auth/me");
    const meData = await me.json();
    if (!meData.user) { router.replace("/"); return; }
    try {
      const res = await fetch("/api/insights");
      if (!res.ok) throw new Error("request failed");
      const d: InsightsPayload = await res.json();
      if (!d.overview || d.overview.ratedTotal === 0) { setStatus("empty"); return; }
      setData(d);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [router]);

  // Fetch-on-mount: the server can't know the session, so the auth-gate + the
  // insights payload are both resolved client-side. Same justified disable the
  // discover/insights/item-detail islands already use for this pattern.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { init(); }, [init]);

  return (
    <div className="min-h-screen">
      <main className="max-w-6xl mx-auto px-6 py-6">
        {/* Heading — 04-pages/insights.html: eyebrow "YOUR TASTE, IN NUMBERS"
            + a plain serif "Insights", replacing "Library insights" + an
            explanatory sentence (the section headers below already carry
            that context). */}
        <div className="mb-6">
          <Eyebrow>Your taste, in numbers</Eyebrow>
          <h1 className="font-serif text-serif-xl text-text-primary mt-1">Insights</h1>
        </div>

        {status === "loading" && (
          <div className="py-20 flex justify-center"><Spinner label="Analyzing your library…" /></div>
        )}
        {status === "error" && (
          <ErrorState title="Couldn't load your insights" hint="Check your connection and try again." onRetry={init} />
        )}
        {status === "empty" && (
          <EmptyState
            icon={<BarChart3 className="w-5 h-5" aria-hidden />}
            title="No rated items in your library yet"
            hint="Rate a few games, movies or shows, then come back — every chart here is built from your ratings."
            actions={<Link href="/library" className="text-label text-accent hover:underline">Go to Library →</Link>}
          />
        )}
        {status === "ready" && data && <InsightsView data={data} />}
      </main>
    </div>
  );
}
