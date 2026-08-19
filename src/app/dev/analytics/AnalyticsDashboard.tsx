"use client";

import { useCallback, useEffect, useState } from "react";
import type { AnalyticsSnapshot } from "@/lib/telemetry";
import {
  DashHeader, DaySeriesChart, Hint, Panel, RangeTabs, RankedBars, Stat, num,
} from "@/components/dev/AnalyticsParts";

const RANGES = [7, 30, 90] as const;

/**
 * Progress toward one of H3.8's approved thresholds.
 *
 * These two cards deliberately IGNORE the range tabs, and say so in their hints.
 * "10,000 pageviews per month" and "3,500 weekly actives" are the thresholds as
 * approved on 2026-08-17; re-measuring them over 7 or 90 days would produce a
 * number that looks like the gate and isn't comparable to it.
 */
function Gate({
  label, value, gate, pct, unit, hint, note,
}: {
  label: string; value: number; gate: number; pct: number; unit: string; hint: string; note: string;
}) {
  const reached = value >= gate;
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface-elevated p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-label text-text-secondary flex items-center gap-1.5">
          {label}
          <Hint text={hint} label={label} />
        </span>
        <span className={`text-xs tabular-nums ${reached ? "text-success" : "text-text-secondary"}`}>
          {pct < 1 && value > 0 ? "<1" : Math.round(pct)}%
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-1.5 flex-wrap">
        <span className="text-2xl font-semibold tabular-nums text-text-primary">{num(value)}</span>
        <span className="text-xs text-text-secondary">/ {num(gate)} {unit}</span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-surface-inset overflow-hidden">
        <div
          className="h-full rounded-full transition-[width]"
          style={{
            width: `${Math.max(value > 0 ? 1 : 0, pct)}%`,
            background: reached ? "var(--color-success)" : "var(--color-accent)",
          }}
        />
      </div>
      <p className="mt-2 text-[11px] leading-snug text-text-secondary">{note}</p>
    </div>
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

  // Everything below the gates is scoped to the selected range, computed from
  // the range-scoped payload rather than from a second set of fixed-window
  // queries. That is what makes the tabs actually move these numbers.
  const pageviewsInRange = data ? data.series.reduce((a, p) => a + p.total, 0) : 0;
  const anonInRange = data ? data.series.reduce((a, p) => a + p.anon, 0) : 0;
  const signupsInRange = data ? data.users.signups.reduce((a, s) => a + s.count, 0) : 0;
  const anonShare = pageviewsInRange > 0 ? Math.round((anonInRange / pageviewsInRange) * 100) : null;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 space-y-5">
      <DashHeader
        title="Traffic"
        subtitle="Self-hosted. No third-party analytics, no cookie, no IP stored."
        here="traffic"
      >
        <RangeTabs value={days} options={RANGES} onChange={setDays} />
      </DashHeader>

      {/* An empty dashboard must say WHY it is empty (AGENTS.md). These three
          states are distinguishable rather than all rendering as nothing. */}
      {failed && error && (
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
              hint="Fixed 30-day window, on purpose: the threshold is defined per month, so the range tabs above do not change it. Monumetric's stated minimum, approved as a real trigger on 2026-08-17."
              note="Counts real-browser pageviews only, which is the same population an ad network pays for."
            />
            <Gate
              label="Freemium gate"
              value={data.gates.wau}
              gate={data.gates.freemiumGate}
              pct={data.gates.freemiumPct}
              unit="weekly actives"
              hint="Fixed 7-day window, on purpose: the threshold is defined weekly, so the range tabs above do not change it. Counts signed-in users only, since an anonymous visitor can never convert to a subscription."
              note="3,500 is what clears TMDB's $149/mo commercial licence with margin at a conservative 3% / €1.50."
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat
              label={`Pageviews · ${days}d`}
              value={num(pageviewsInRange)}
              sub={anonShare != null ? `${anonShare}% anonymous` : undefined}
              hint="Every page opened in a real browser during the selected range, signed-in and anonymous together. One person opening five pages counts five times: this is pageviews, not visitors."
            />
            <Stat
              label={`Active users · ${days}d`}
              value={num(data.users.activeInRange)}
              sub={`of ${num(data.users.total)} registered`}
              hint="Distinct SIGNED-IN accounts seen at least once in the selected range. Anonymous visitors have no identity to count, so they never appear here however much they browse."
            />
            <Stat
              label={`New signups · ${days}d`}
              value={num(signupsInRange)}
              hint="Accounts created during the selected range, taken from users.created_at. Exact, not sampled."
            />
            <Stat
              label="Stickiness"
              value={data.users.mau > 0 ? `${Math.round((data.users.dau / data.users.mau) * 100)}%` : "—"}
              sub={`${num(data.users.dau)} daily / ${num(data.users.mau)} monthly`}
              hint="DAU divided by MAU: of everyone who used Fandex in the last 30 days, the share who used it today. A rough measure of habit. 20% is generally considered strong for a consumer app; fixed windows, so the tabs do not move it."
            />
          </div>

          <Panel
            title={`Pageviews · last ${days} days`}
            hint="The split is the whole point. Ads monetize the anonymous half and a subscription monetizes the signed-in half, so this ratio decides which way to grow before either is built."
            note="A client beacon fires this on each route change, so crawlers and no-JS requests are absent by design. Server-rendered crawler traffic belongs in Search Console, not here."
          >
            <DaySeriesChart
              series={data.series.map((d) => ({ day: d.day, a: d.anon, b: d.authed }))}
              labelA="anonymous"
              labelB="signed in"
              emptyNote="No pageviews recorded in this window. The beacon started collecting on deploy, so anything before that is genuinely absent rather than zero."
            />
          </Panel>

          <div className="grid gap-3 lg:grid-cols-2">
            <Panel
              title={`Top pages · ${days}d`}
              hint="Route templates, not raw URLs: every tag page counts under /tag/[slug]. A per-slug key set would grow a row per slug per day, so the template is what keeps the table bounded."
              note="The admin pages are excluded, so looking at this dashboard cannot inflate it."
            >
              <RankedBars
                rows={data.topPages.map((p) => ({ label: p.pathKey, count: p.count }))}
                emptyNote="No pageviews yet in this window."
              />
            </Panel>
            <Panel
              title={`How they arrived · ${days}d`}
              hint="Only the class is stored, never the referring URL, which can carry someone's search query. 'internal' is in-app navigation; 'direct' means no referrer at all, which also covers most app and bookmark opens."
              note="'search' is the number that tells you whether the public item and facet pages are pulling their weight."
            >
              <RankedBars
                rows={data.referrers.map((r) => ({ label: r.refClass, count: r.count }))}
                emptyNote="No referrers recorded yet in this window."
              />
            </Panel>
          </div>

          <Panel
            title={`Signups · last ${days} days`}
            hint="From users.created_at. An account is created the first time someone connects a provider, so this is also the first-connection count."
          >
            <DaySeriesChart series={data.users.signups.map((s) => ({ day: s.day, a: 0, b: s.count }))} />
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
