"use client";

import { useCallback, useEffect, useState } from "react";
import type { AnalyticsSnapshot, DailyPoint } from "@/lib/telemetry";

// The traffic dashboard. Charts are hand-rolled CSS bars, the same call as insights/Histogram.tsx, and for the same reason: a charting
// dependency for four charts is a bundle cost and a supply-chain surface this
// page does not need.

const RANGES = [7, 30, 90] as const;

function num(n: number): string {
  return n.toLocaleString("en-US");
}

/** Progress toward one of H3.8's approved thresholds. */
function Gate({
  label, value, gate, pct, unit, note,
}: {
  label: string; value: number; gate: number; pct: number; unit: string; note: string;
}) {
  const reached = value >= gate;
  return (
    <div className="rounded-xl border border-border bg-surface-elevated p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-label text-text-secondary">{label}</span>
        <span className={`text-xs tabular-nums ${reached ? "text-success" : "text-text-secondary"}`}>
          {pct < 1 && value > 0 ? "<1" : Math.round(pct)}%
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums text-text-primary">{num(value)}</span>
        <span className="text-xs text-text-secondary">/ {num(gate)} {unit}</span>
      </div>
      {/* min-w-0 on the track's parent is not needed here (block, not flex), but
          the fill is width-driven so it can never overflow its own container. */}
      <div className="mt-2 h-1.5 rounded-full bg-surface-inset overflow-hidden">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${Math.max(value > 0 ? 1 : 0, pct)}%`, background: reached ? "var(--color-success)" : "var(--color-accent)" }}
        />
      </div>
      <p className="mt-2 text-[11px] leading-snug text-text-secondary">{note}</p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-elevated px-4 py-3">
      <div className="text-2xl font-semibold tabular-nums text-text-primary">{value}</div>
      <div className="text-xs text-text-secondary mt-0.5">{label}</div>
      {sub && <div className="text-[11px] text-text-secondary mt-0.5">{sub}</div>}
    </div>
  );
}

/**
 * Daily pageviews, anonymous stacked under signed-in. The split is the point of
 * the chart: ads monetize the anonymous half, a subscription monetizes the other.
 */
function DailyChart({ series }: { series: DailyPoint[] }) {
  const max = Math.max(1, ...series.map((d) => d.total));
  const empty = series.every((d) => d.total === 0);

  return (
    <div>
      <div className="flex items-end gap-px h-40" role="img" aria-label="Daily pageviews">
        {series.map((d) => (
          // min-w-0: a flex item defaults to min-width:auto and refuses to shrink
          // below its content, which is how the Insights page overflowed and
          // pushed the fixed mobile nav below the fold (MB7).
          <div key={d.day} className="flex-1 min-w-0 h-full flex flex-col justify-end group relative">
            <div
              className="w-full rounded-t-[2px]"
              style={{ height: `${(d.authed / max) * 100}%`, background: "var(--color-accent)" }}
            />
            <div
              className="w-full"
              style={{ height: `${(d.anon / max) * 100}%`, background: "var(--color-accent-subtle)" }}
            />
            <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10 whitespace-nowrap rounded-md border border-border bg-surface-overlay px-2 py-1 text-[11px] text-text-primary shadow-lg">
              {d.day}: {num(d.total)} ({num(d.authed)} signed in)
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-text-secondary">
        <span>{series[0]?.day}</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: "var(--color-accent)" }} /> signed in
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: "var(--color-accent-subtle)" }} /> anonymous
          </span>
        </span>
        <span>{series[series.length - 1]?.day}</span>
      </div>
      {empty && (
        <p className="mt-2 text-xs text-text-secondary">
          No pageviews recorded in this window. The beacon started collecting on deploy, so
          anything before that is genuinely absent rather than zero.
        </p>
      )}
    </div>
  );
}

/** Horizontal ranked bars, used for both top pages and referrer classes. */
function RankedBars({ rows, emptyNote }: { rows: { label: string; count: number }[]; emptyNote: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  const total = rows.reduce((a, r) => a + r.count, 0);
  if (total === 0) return <p className="text-xs text-text-secondary">{emptyNote}</p>;
  return (
    <ul className="space-y-1.5">
      {rows.filter((r) => r.count > 0).map((r) => (
        <li key={r.label} className="flex items-center gap-3">
          {/* min-w-0 + truncate together: truncate alone does nothing in a flex row. */}
          <span className="min-w-0 flex-1 truncate text-xs text-text-primary font-mono">{r.label}</span>
          <span className="w-28 shrink-0 h-1.5 rounded-full bg-surface-inset overflow-hidden">
            <span className="block h-full rounded-full" style={{ width: `${(r.count / max) * 100}%`, background: "var(--color-accent)" }} />
          </span>
          <span className="w-14 shrink-0 text-right text-xs tabular-nums text-text-secondary">{num(r.count)}</span>
        </li>
      ))}
    </ul>
  );
}

function Panel({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    // min-w-0 is load-bearing, and this was measured overflowing by 2px at 320px
    // before it was added. A GRID item defaults to `min-width: auto` exactly as a
    // flex item does, so the panel refused to shrink below its own content and
    // pushed the page wider than the viewport. That is the MB7 mechanism: the
    // overflow makes Chrome shrink-to-fit, the layout viewport inflates, and the
    // `fixed bottom-0` mobile nav pins itself below the fold.
    <section className="min-w-0 rounded-xl border border-border bg-surface-elevated p-4">
      <h2 className="text-label text-text-secondary mb-3">{title}</h2>
      {children}
      {note && <p className="mt-3 text-[11px] leading-snug text-text-secondary">{note}</p>}
    </section>
  );
}

export default function AnalyticsDashboard() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<AnalyticsSnapshot | null>(null);
  const [error, setError] = useState<{ days: number; message: string } | null>(null);

  // `loading` is DERIVED, not stored: the payload carries the window it answers
  // for, so "the data on screen isn't the range you asked for" is already the
  // pending condition. Storing it would mean a setState synchronously in the
  // effect below (which react-hooks/set-state-in-effect correctly rejects), and
  // it would be a second source of truth for a fact the data already states.
  const stale = !data || data.days !== days;
  const failed = error?.days === days;
  const loading = stale && !failed;

  const load = useCallback(async (d: number) => {
    try {
      const res = await fetch(`/api/dev/analytics?days=${d}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as AnalyticsSnapshot;
      setData(json);
      setError(null);
    } catch (e) {
      setError({ days: d, message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  // Fetch-on-mount and on range change. `load` is async and its first statement
  // is an `await fetch`, so every setState in it happens after a suspension
  // point rather than synchronously in the effect body. That is the same
  // justified disable PersonalSection and MyStuffView carry for this pattern;
  // the rule cannot see through the callback.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(days);
  }, [days, load]);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 space-y-5">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          {/* font-serif + text-serif-lg are real tokens. `text-display` is not. A token-named utility with no matching theme key emits NO rule at
              all and silently falls back to the browser default (AGENTS.md). */}
          <h1 className="font-serif text-serif-lg text-text-primary">Traffic</h1>
          <p className="text-xs text-text-secondary mt-0.5">
            Self-hosted. No third-party analytics, no cookie, no IP stored.
          </p>
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setDays(r)}
              className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                days === r
                  ? "border-accent text-accent bg-accent-subtle"
                  : "border-border text-text-secondary hover:text-text-primary"
              }`}
            >
              {r}d
            </button>
          ))}
        </div>
      </header>

      {/* An empty dashboard must say WHY it is empty (AGENTS.md). These three
          states are distinguishable rather than all rendering as nothing. */}
      {error && (
        <p className="rounded-xl border border-border bg-surface-elevated p-4 text-sm text-danger">
          Could not load telemetry: {error.message}
        </p>
      )}
      {loading && !data && <p className="text-sm text-text-secondary">Loading…</p>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Gate
              label="Ads gate"
              value={data.gates.pageviews30d}
              gate={data.gates.adsGate}
              pct={data.gates.adsPct}
              unit="pageviews / 30d"
              note="Monumetric's stated minimum (H3.8, approved 2026-08-17). Counts real-browser pageviews only, which is the same population an ad network pays for."
            />
            <Gate
              label="Freemium gate"
              value={data.gates.wau}
              gate={data.gates.freemiumGate}
              pct={data.gates.freemiumPct}
              unit="weekly actives"
              note="Signed-in users seen in the last 7 days. 3,500 is what clears TMDB's $149/mo commercial licence with margin at a conservative 3% / €1.50."
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Registered users" value={num(data.users.total)} />
            <Stat label="Daily actives" value={num(data.users.dau)} sub="signed in, last 24h" />
            <Stat label="Weekly actives" value={num(data.users.wau)} sub="signed in, last 7d" />
            <Stat label="Monthly actives" value={num(data.users.mau)} sub="signed in, last 30d" />
          </div>

          <Panel
            title={`Pageviews · last ${data.days} days`}
            note="A client beacon fires this on each route change, so crawlers and no-JS requests are absent by design. Server-rendered crawler traffic belongs in Search Console, not here."
          >
            <DailyChart series={data.series} />
          </Panel>

          <div className="grid gap-3 lg:grid-cols-2">
            <Panel title="Top pages" note="Route templates, not raw URLs. A per-slug key set would grow without bound.">
              <RankedBars
                rows={data.topPages.map((p) => ({ label: p.pathKey, count: p.count }))}
                emptyNote="No pageviews yet in this window."
              />
            </Panel>
            <Panel
              title="How they arrived"
              note="Only the class is stored, never the referring URL. 'internal' is in-app navigation; 'search' is the number that tells you whether the public item and facet pages are working."
            >
              <RankedBars
                rows={data.referrers.map((r) => ({ label: r.refClass, count: r.count }))}
                emptyNote="No referrers recorded yet in this window."
              />
            </Panel>
          </div>

          <Panel title={`Signups · last ${data.days} days`} note="From users.created_at, exact.">
            <DailyChart series={data.users.signups.map((s) => ({ day: s.day, anon: 0, authed: s.count, total: s.count }))} />
          </Panel>

          <p className="text-[11px] text-text-secondary">
            Generated {new Date(data.generatedAt).toISOString().replace("T", " ").slice(0, 19)} UTC.
            Counters are a trend instrument: the beacon endpoint is public, so treat the totals as
            directional rather than auditable.
          </p>
        </>
      )}
    </main>
  );
}
