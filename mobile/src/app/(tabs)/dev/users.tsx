// /dev/users: who is registered, what they collected, how recently they used
// it. A port of the site's src/app/dev/users/UsersDashboard.tsx. The numbers
// come from the Worker's /v1/admin/users, which answers an admin only.
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { AdminOnly, DashHeader, DaySeriesChart, devStyles, num, Panel, RangeTabs, RankedBars, Stat } from '~/components/dev/parts';
import { Screen } from '~/components/ui';
import { api, type UsersSnapshot } from '~/lib/api';
import { color, font, radius } from '~/theme';

const RANGES = [7, 30, 90] as const;

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function ago(ts: number | null): string {
  if (!ts) return 'never';
  const days = Math.floor(Date.now() / 1000 - ts) / 86_400;
  if (days < 1) return 'today';
  if (days < 2) return 'yesterday';
  if (days < 30) return `${Math.floor(days)}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function Dashboard() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<UsersSnapshot | null>(null);
  const [error, setError] = useState<{ days: number; message: string } | null>(null);
  const stale = !data || data.days !== days;
  const failed = error?.days === days;

  const load = useCallback(async (d: number) => {
    try {
      setData(await api.adminUsers(d));
      setError(null);
    } catch (e) {
      setError({ days: d, message: e instanceof Error ? e.message : String(e) });
    }
  }, []);
  useEffect(() => { void load(days); }, [days, load]);

  const signupsInRange = data ? data.signups.reduce((a, s) => a + s.count, 0) : 0;
  const writesInRange = data ? data.writeActivity.reduce((a, s) => a + s.count, 0) : 0;
  const typeMax = data ? Math.max(1, ...data.byType.map((x) => x.library + x.wishlist)) : 1;

  return (
    <Screen wide>
      <ScrollView contentContainerStyle={devStyles.main}>
        <DashHeader title="Users" subtitle="Who is registered, what they have collected, and how recently they used it." here="users">
          <RangeTabs value={days} options={RANGES} onChange={setDays} />
        </DashHeader>

        {failed && error ? (
          <View style={styles.error}><Text style={[devStyles.small, { color: color.danger }]}>Could not load user analytics: {error.message}</Text></View>
        ) : null}
        {stale && !failed && !data ? <Text style={devStyles.small}>Loading…</Text> : null}

        {data ? (
          <>
            <View style={devStyles.grid}>
              <Stat
                label="Registered users" value={num(data.totals.users)}
                sub={data.engagement.neverSeen > 0 ? `${num(data.engagement.neverSeen)} never seen` : undefined}
                hint="Every account that exists, all time. An account is created the first time someone connects a provider, so this is also the number of people who completed a sign-in at least once. Not affected by the range tabs."
              />
              <Stat
                label={`Active · ${days}d`} value={num(data.engagement.activeInRange)}
                sub={`${data.totals.users ? Math.round((data.engagement.activeInRange / data.totals.users) * 100) : 0}% of all users`}
                hint="Accounts seen at least once in the selected range, from users.last_seen_at (stamped once per user per day on any signed-in request). Someone who only reads still counts here; someone browsing logged out does not."
              />
              <Stat label={`New · ${days}d`} value={num(signupsInRange)} hint="Accounts created inside the selected range, from users.created_at." />
              <Stat
                label="Stickiness" value={data.engagement.stickiness != null ? `${Math.round(data.engagement.stickiness)}%` : '-'}
                sub={`${num(data.engagement.active1)} daily / ${num(data.engagement.active30)} monthly`}
                hint="DAU divided by MAU: of everyone active in the last 30 days, the share active today. The usual habit measure. Fixed windows, so the range tabs do not move it. Shows a dash rather than 0% when nobody was active at all, because those are different facts."
              />
            </View>

            <Panel
              title="How recently people used the app"
              hint="Recency buckets, not frequency. users.last_seen_at is a single timestamp rather than a visit history, so the schema genuinely cannot say how MANY days somebody visited. These buckets and the activity chart below are the honest substitutes. Buckets are cumulative: everyone in '1 day' is also in '7 days'."
            >
              <RankedBars
                mono={false} emptyNote="No users yet."
                rows={[
                  { label: 'Last 1 day', count: data.engagement.active1 },
                  { label: 'Last 7 days', count: data.engagement.active7 },
                  { label: 'Last 30 days', count: data.engagement.active30 },
                  { label: 'Last 90 days', count: data.engagement.active90 },
                  { label: 'Never seen', count: data.engagement.neverSeen },
                ]}
              />
            </Panel>

            <View style={devStyles.grid}>
              <Stat
                label="Items in libraries" value={num(data.totals.library)} sub={`${data.perUserAverages.library} per user`}
                hint="Distinct (user, item) pairs across every library. A title synced from both Steam and Trakt counts once here, even though it is two rows in the underlying state table."
              />
              <Stat
                label="Items wishlisted" value={num(data.totals.wishlist)} sub={`${data.perUserAverages.wishlist} per user`}
                hint="Distinct (user, item) pairs on wishlists. Wishlist and library are mutually exclusive: rating something moves it out of the wishlist."
              />
              <Stat
                label="Ratings given" value={num(data.totals.rated)}
                sub={data.totals.meanRating != null ? `mean ${data.totals.meanRating.toFixed(2)} / 10` : undefined}
                hint="Library entries carrying a rating. The mean is across all users and all media types, on the 0 to 10 scale Fandex stores internally."
              />
              <Stat
                label={`Actions · ${days}d`} value={num(writesInRange)}
                hint="Adds plus ratings inside the selected range, the only per-event history the schema keeps. It measures deliberate use rather than visits, so a heavy reading session with no changes scores zero."
              />
            </View>

            <View style={devStyles.grid}>
              <Panel title="Collections by media type" hint="Library and wishlist entries grouped by the item's media type. Useful for deciding which side of the catalog is actually carrying the product.">
                <View style={{ gap: 10 }}>
                  {data.byType.map((t) => (
                    <View key={t.type}>
                      <View style={styles.typeHead}>
                        <Text style={[devStyles.small, { color: color.textPrimary, textTransform: 'capitalize' }]}>{t.type}</Text>
                        <Text style={devStyles.small}>{num(t.library)} logged · {num(t.wishlist)} wished · {num(t.rated)} rated</Text>
                      </View>
                      <View style={styles.typeTrack}>
                        <View style={{ width: `${(t.library / typeMax) * 100}%`, backgroundColor: color.accent }} />
                        <View style={{ width: `${(t.wishlist / typeMax) * 100}%`, backgroundColor: color.accentSubtle }} />
                      </View>
                    </View>
                  ))}
                </View>
              </Panel>
              <Panel title="Library entries by status" hint="The status on a library entry: watched, played, owned, or none where a provider gave us the item without one.">
                <RankedBars mono={false} rows={data.byStatus.map((s) => ({ label: s.status, count: s.count }))} emptyNote="No library entries yet." />
              </Panel>
              <Panel title="Where the data came from" hint="Provenance of the underlying state rows, so this counts per (user, item, source) and totals higher than the item counts above. 'local' means added inside Fandex rather than synced from a connected service.">
                <RankedBars rows={data.bySource.map((s) => ({ label: s.source, count: s.count }))} emptyNote="No state rows yet." />
              </Panel>
              <Panel title="Connected providers" hint="How many distinct users have each service connected. One person can connect several, so these add up to more than the user count.">
                <RankedBars rows={data.providers.map((p) => ({ label: p.provider, count: p.users }))} emptyNote="No providers connected yet." />
              </Panel>
              <Panel title="Library size distribution" hint="How many users fall into each library-size band. The '0' bucket is the one to watch: accounts that signed in but never synced or added anything are the clearest onboarding drop-off the schema can show.">
                <RankedBars mono={false} rows={data.collectionSizes.map((c) => ({ label: c.bucket, count: c.users }))} emptyNote="No users yet." />
              </Panel>
              <Panel title="Users by country" hint="From the region setting on the account, which drives release dates and streaming availability. '(unset)' means the user never chose one.">
                <RankedBars rows={data.countries.map((c) => ({ label: c.country, count: c.users }))} emptyNote="No users yet." />
              </Panel>
            </View>

            <Panel title={`Actions per day · last ${days} days`} hint="Adds and ratings, by day, from added_at and reviewed_at. A bulk provider sync lands as one large spike on the day it ran, so read the shape rather than individual days.">
              <DaySeriesChart series={data.writeActivity.map((w) => ({ day: w.day, a: 0, b: w.count }))} emptyNote="No adds or ratings recorded in this window." />
            </Panel>

            <Panel title={`Signed-in pageviews · last ${days} days`} hint="The signed-in half of the traffic dashboard's chart. Nothing has counted a pageview since the site moved on 2026-10-04, so this ends there.">
              <DaySeriesChart series={data.signedInPageviews.map((p) => ({ day: p.day, a: 0, b: p.count }))} emptyNote="No signed-in pageviews recorded in this window." />
            </Panel>

            <Panel title="Per user" hint="One row per account. Deliberately shows a truncated id rather than the display name or avatar the provider gave us: this table exists to size an audience, and names are other people's personal data that nothing here needs.">
              <ScrollView horizontal>
                <View>
                  <View style={styles.tr}>
                    {['User', 'Library', 'Wishlist', 'Rated', 'Providers', 'Last seen', 'Joined'].map((h, i) => (
                      <Text key={h} style={[devStyles.small, styles.cell, COLS[i]]}>{h}</Text>
                    ))}
                  </View>
                  {data.users.map((u) => (
                    <View key={u.id} style={[styles.tr, styles.trBody]}>
                      <Text style={[devStyles.small, styles.cell, COLS[0], { fontFamily: font.mono, color: color.textPrimary }]}>{shortId(u.id)}</Text>
                      <Text style={[devStyles.small, styles.cell, COLS[1], { color: color.textPrimary }]}>{num(u.library)}</Text>
                      <Text style={[devStyles.small, styles.cell, COLS[2]]}>{num(u.wishlist)}</Text>
                      <Text style={[devStyles.small, styles.cell, COLS[3]]}>{num(u.rated)}</Text>
                      <Text style={[devStyles.small, styles.cell, COLS[4]]}>{u.providers.join(', ') || '-'}</Text>
                      <Text style={[devStyles.small, styles.cell, COLS[5]]}>{ago(u.lastSeenAt)}</Text>
                      <Text style={[devStyles.small, styles.cell, COLS[6]]}>{ago(u.createdAt)}</Text>
                    </View>
                  ))}
                </View>
              </ScrollView>
            </Panel>

            <Text style={devStyles.tiny}>
              Generated {data.generatedAt.replace('T', ' ').slice(0, 19)} UTC. Every number here is read from rows that already exist. This page stores nothing.
            </Text>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

export default function DevUsersScreen() {
  return <AdminOnly><Dashboard /></AdminOnly>;
}

const COLS = [
  { width: 130 }, { width: 70, textAlign: 'right' as const }, { width: 70, textAlign: 'right' as const },
  { width: 60, textAlign: 'right' as const }, { width: 170 }, { width: 90 }, { width: 80 },
];

const styles = StyleSheet.create({
  error: { padding: 16, borderRadius: radius.lg, borderWidth: 1, borderColor: color.border, backgroundColor: color.surfaceElevated },
  typeHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  typeTrack: { flexDirection: 'row', height: 6, marginTop: 4, borderRadius: radius.full, backgroundColor: color.surfaceInset, overflow: 'hidden' },
  tr: { flexDirection: 'row', paddingVertical: 6 },
  trBody: { borderTopWidth: 1, borderTopColor: color.border },
  cell: { paddingRight: 12 },
});
