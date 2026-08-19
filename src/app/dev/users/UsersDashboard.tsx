"use client";

import { useCallback, useEffect, useState } from "react";
import type { UserAnalyticsSnapshot } from "@/lib/userAnalytics";
import {
  DashHeader, DaySeriesChart, Panel, RangeTabs, RankedBars, Stat, num,
} from "@/components/dev/AnalyticsParts";

const RANGES = [7, 30, 90] as const;

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function ago(ts: number | null): string {
  if (!ts) return "never";
  const days = Math.floor(Date.now() / 1000 - ts) / 86_400;
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 30) return `${Math.floor(days)}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export default function UsersDashboard() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<UserAnalyticsSnapshot | null>(null);
  const [error, setError] = useState<{ days: number; message: string } | null>(null);

  // Derived rather than stored, for the same reason as the traffic dashboard:
  // the payload carries the window it answers for.
  const stale = !data || data.days !== days;
  const failed = error?.days === days;
  const loading = stale && !failed;

  const load = useCallback(async (d: number) => {
    try {
      const res = await fetch(`/api/dev/users?days=${d}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as UserAnalyticsSnapshot);
      setError(null);
    } catch (e) {
      setError({ days: d, message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  // `load`'s first statement is an `await fetch`, so its setState calls happen
  // after a suspension point rather than synchronously in the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(days);
  }, [days, load]);

  const signupsInRange = data ? data.signups.reduce((a, s) => a + s.count, 0) : 0;
  const writesInRange = data ? data.writeActivity.reduce((a, s) => a + s.count, 0) : 0;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 space-y-5">
      <DashHeader
        title="Users"
        subtitle="Who is registered, what they have collected, and how recently they used it."
        here="users"
      >
        <RangeTabs value={days} options={RANGES} onChange={setDays} />
      </DashHeader>

      {failed && error && (
        <p className="rounded-xl border border-border bg-surface-elevated p-4 text-sm text-danger">
          Could not load user analytics: {error.message}
        </p>
      )}
      {loading && !data && <p className="text-sm text-text-secondary">Loading…</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat
              label="Registered users"
              value={num(data.totals.users)}
              sub={data.engagement.neverSeen > 0 ? `${num(data.engagement.neverSeen)} never seen` : undefined}
              hint="Every account that exists, all time. An account is created the first time someone connects a provider, so this is also the number of people who completed a sign-in at least once. Not affected by the range tabs."
            />
            <Stat
              label={`Active · ${days}d`}
              value={num(data.engagement.activeInRange)}
              sub={`${data.totals.users ? Math.round((data.engagement.activeInRange / data.totals.users) * 100) : 0}% of all users`}
              hint="Accounts seen at least once in the selected range, from users.last_seen_at (stamped once per user per day on any signed-in request). Someone who only reads still counts here; someone browsing logged out does not."
            />
            <Stat
              label={`New · ${days}d`}
              value={num(signupsInRange)}
              hint="Accounts created inside the selected range, from users.created_at."
            />
            <Stat
              label="Stickiness"
              value={data.engagement.stickiness != null ? `${Math.round(data.engagement.stickiness)}%` : "—"}
              sub={`${num(data.engagement.active1)} daily / ${num(data.engagement.active30)} monthly`}
              hint="DAU divided by MAU: of everyone active in the last 30 days, the share active today. The usual habit measure. Fixed windows, so the range tabs do not move it. Shows a dash rather than 0% when nobody was active at all, because those are different facts."
            />
          </div>

          <Panel
            title="How recently people used the app"
            hint="Recency buckets, not frequency. users.last_seen_at is a single timestamp rather than a visit history, so the schema genuinely cannot say how MANY days somebody visited. These buckets and the activity chart below are the honest substitutes. Buckets are cumulative: everyone in '1 day' is also in '7 days'."
          >
            <RankedBars
              mono={false}
              rows={[
                { label: "Last 1 day", count: data.engagement.active1 },
                { label: "Last 7 days", count: data.engagement.active7 },
                { label: "Last 30 days", count: data.engagement.active30 },
                { label: "Last 90 days", count: data.engagement.active90 },
                { label: "Never seen", count: data.engagement.neverSeen },
              ]}
              emptyNote="No users yet."
            />
          </Panel>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat
              label="Items in libraries"
              value={num(data.totals.library)}
              sub={`${data.perUserAverages.library} per user`}
              hint="Distinct (user, item) pairs across every library. A title synced from both Steam and RAWG counts once here, even though it is two rows in the underlying state table."
            />
            <Stat
              label="Items wishlisted"
              value={num(data.totals.wishlist)}
              sub={`${data.perUserAverages.wishlist} per user`}
              hint="Distinct (user, item) pairs on wishlists. Wishlist and library are mutually exclusive: rating something moves it out of the wishlist."
            />
            <Stat
              label="Ratings given"
              value={num(data.totals.rated)}
              sub={data.totals.meanRating != null ? `mean ${data.totals.meanRating.toFixed(2)} / 10` : undefined}
              hint="Library entries carrying a rating. The mean is across all users and all media types, on the 0 to 10 scale Fandex stores internally."
            />
            <Stat
              label={`Actions · ${days}d`}
              value={num(writesInRange)}
              hint="Adds plus ratings inside the selected range, the only per-event history the schema keeps. It measures deliberate use rather than visits, so a heavy reading session with no changes scores zero."
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Panel
              title="Collections by media type"
              hint="Library and wishlist entries grouped by the item's media type. Useful for deciding which side of the catalog is actually carrying the product."
            >
              <ul className="space-y-2.5">
                {data.byType.map((t) => {
                  const max = Math.max(1, ...data.byType.map((x) => x.library + x.wishlist));
                  const total = t.library + t.wishlist;
                  return (
                    <li key={t.type} className="min-w-0">
                      <div className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate text-text-primary capitalize">{t.type}</span>
                        <span className="shrink-0 tabular-nums text-text-secondary">
                          {num(t.library)} logged · {num(t.wishlist)} wished · {num(t.rated)} rated
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-surface-inset overflow-hidden flex">
                        <span className="block h-full" style={{ width: `${(t.library / max) * 100}%`, background: "var(--color-accent)" }} />
                        <span className="block h-full" style={{ width: `${(t.wishlist / max) * 100}%`, background: "var(--color-accent-subtle)" }} />
                      </div>
                      <div className="sr-only">{total} total</div>
                    </li>
                  );
                })}
              </ul>
            </Panel>

            <Panel
              title="Library entries by status"
              hint="The status on a library entry: watched, played, owned, or none where a provider gave us the item without one."
            >
              <RankedBars
                mono={false}
                rows={data.byStatus.map((s) => ({ label: s.status, count: s.count }))}
                emptyNote="No library entries yet."
              />
            </Panel>

            <Panel
              title="Where the data came from"
              hint="Provenance of the underlying state rows, so this counts per (user, item, source) and totals higher than the item counts above. 'local' means added inside Fandex rather than synced from a connected service."
            >
              <RankedBars
                rows={data.bySource.map((s) => ({ label: s.source, count: s.count }))}
                emptyNote="No state rows yet."
              />
            </Panel>

            <Panel
              title="Connected providers"
              hint="How many distinct users have each service connected. One person can connect several, so these add up to more than the user count."
            >
              <RankedBars
                rows={data.providers.map((p) => ({ label: p.provider, count: p.users }))}
                emptyNote="No providers connected yet."
              />
            </Panel>

            <Panel
              title="Library size distribution"
              hint="How many users fall into each library-size band. The '0' bucket is the one to watch: accounts that signed in but never synced or added anything are the clearest onboarding drop-off the schema can show."
            >
              <RankedBars
                mono={false}
                rows={data.collectionSizes.map((c) => ({ label: c.bucket, count: c.users }))}
                emptyNote="No users yet."
              />
            </Panel>

            <Panel
              title="Users by country"
              hint="From the region setting on the account, which drives release dates and streaming availability. '(unset)' means the user never chose one."
            >
              <RankedBars
                rows={data.countries.map((c) => ({ label: c.country, count: c.users }))}
                emptyNote="No users yet."
              />
            </Panel>
          </div>

          <Panel
            title={`Actions per day · last ${days} days`}
            hint="Adds and ratings, by day, from added_at and reviewed_at. A bulk provider sync lands as one large spike on the day it ran, so read the shape rather than individual days."
          >
            <DaySeriesChart
              series={data.writeActivity.map((w) => ({ day: w.day, a: 0, b: w.count }))}
              emptyNote="No adds or ratings recorded in this window."
            />
          </Panel>

          <Panel
            title={`Signed-in pageviews · last ${days} days`}
            hint="The signed-in half of the traffic dashboard's chart, repeated here because it is the only view-based measure of use that exists. It begins at the deploy that added the beacon, so earlier days are blank rather than zero."
          >
            <DaySeriesChart
              series={data.signedInPageviews.map((p) => ({ day: p.day, a: 0, b: p.count }))}
              emptyNote="No signed-in pageviews recorded in this window."
            />
          </Panel>

          <Panel
            title="Per user"
            hint="One row per account. Deliberately shows a truncated id rather than the display name or avatar the provider gave us: this table exists to size an audience, and names are other people's personal data that nothing here needs."
          >
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-text-secondary text-left">
                    <th className="font-normal py-1 pr-3">User</th>
                    <th className="font-normal py-1 pr-3 text-right tabular-nums">Library</th>
                    <th className="font-normal py-1 pr-3 text-right tabular-nums">Wishlist</th>
                    <th className="font-normal py-1 pr-3 text-right tabular-nums">Rated</th>
                    <th className="font-normal py-1 pr-3">Providers</th>
                    <th className="font-normal py-1 pr-3 whitespace-nowrap">Last seen</th>
                    <th className="font-normal py-1 whitespace-nowrap">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((u) => (
                    <tr key={u.id} className="border-t border-border">
                      <td className="py-1.5 pr-3 font-mono text-text-primary whitespace-nowrap">{shortId(u.id)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-text-primary">{num(u.library)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-text-secondary">{num(u.wishlist)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-text-secondary">{num(u.rated)}</td>
                      <td className="py-1.5 pr-3 text-text-secondary">{u.providers.join(", ") || "—"}</td>
                      <td className="py-1.5 pr-3 text-text-secondary whitespace-nowrap">{ago(u.lastSeenAt)}</td>
                      <td className="py-1.5 text-text-secondary whitespace-nowrap">{ago(u.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <p className="text-[11px] text-text-secondary">
            Generated {new Date(data.generatedAt).toISOString().replace("T", " ").slice(0, 19)} UTC.
            Every number here is read from rows that already exist. This page stores nothing.
          </p>
        </>
      )}
    </main>
  );
}
