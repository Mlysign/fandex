// /dev/analytics: pageviews, where they came from, and the two thresholds they
// are counted for. A port of the site's src/app/dev/analytics/AnalyticsDashboard.tsx.
// The numbers come from the Worker's /v1/admin/analytics, which answers an admin only.
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { AdminOnly, DashHeader, DaySeriesChart, devStyles, HintMark, num, Panel, RangeTabs, RankedBars, Stat } from '~/components/dev/parts';
import { Screen } from '~/components/ui';
import { api, type AnalyticsSnapshot } from '~/lib/api';
import { color, font, radius, type } from '~/theme';

const RANGES = [7, 30, 90] as const;

function Gate({ label, value, gate, pct, unit, hint, note }: {
  label: string; value: number; gate: number; pct: number; unit: string; hint: string; note: string;
}) {
  const [open, setOpen] = useState(false);
  const reached = value >= gate;
  return (
    <View style={styles.gate}>
      <View style={styles.gateHead}>
        <View style={styles.gateLabel}>
          <Text style={[type.label, { color: color.textSecondary }]}>{label}</Text>
          <HintMark open={open} onPress={() => setOpen((v) => !v)} label={label} />
        </View>
        <Text style={[devStyles.small, reached && { color: color.success }]}>{pct < 1 && value > 0 ? '<1' : Math.round(pct)}%</Text>
      </View>
      {open ? <Text style={[devStyles.tiny, { color: color.textPrimary }]}>{hint}</Text> : null}
      <View style={styles.gateValue}>
        <Text style={styles.big}>{num(value)}</Text>
        <Text style={devStyles.small}>/ {num(gate)} {unit}</Text>
      </View>
      <View style={styles.track}>
        <View style={{ height: '100%', borderRadius: radius.full, width: `${Math.max(value > 0 ? 1 : 0, pct)}%`, backgroundColor: reached ? color.success : color.accent }} />
      </View>
      <Text style={devStyles.tiny}>{note}</Text>
    </View>
  );
}

function Dashboard() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<AnalyticsSnapshot | null>(null);
  const [error, setError] = useState<{ days: number; message: string } | null>(null);
  const stale = !data || data.days !== days;
  const failed = error?.days === days;

  const load = useCallback(async (d: number) => {
    try {
      setData(await api.adminAnalytics(d));
      setError(null);
    } catch (e) {
      setError({ days: d, message: e instanceof Error ? e.message : String(e) });
    }
  }, []);
  useEffect(() => { void load(days); }, [days, load]);

  const pageviews = data ? data.series.reduce((a, p) => a + p.total, 0) : 0;
  const anon = data ? data.series.reduce((a, p) => a + p.anon, 0) : 0;
  const signups = data ? data.users.signups.reduce((a, s) => a + s.count, 0) : 0;
  const anonShare = pageviews > 0 ? Math.round((anon / pageviews) * 100) : null;
  const covered = data ? data.series.length : days;
  const clamped = data ? covered < data.days : false;

  return (
    <Screen wide>
      <ScrollView contentContainerStyle={devStyles.main}>
        <DashHeader title="Traffic" subtitle="Self-hosted. No third-party analytics, no cookie, no IP stored." here="traffic">
          <RangeTabs value={days} options={RANGES} onChange={setDays} />
        </DashHeader>

        {failed && error ? (
          <View style={styles.note}><Text style={[devStyles.small, { color: color.danger }]}>Could not load telemetry: {error.message}</Text></View>
        ) : null}
        {stale && !failed && !data ? <Text style={devStyles.small}>Loading…</Text> : null}

        {data ? (
          <>
            <View style={devStyles.grid}>
              <Gate
                label="Ads gate" value={data.gates.pageviews30d} gate={data.gates.adsGate} pct={data.gates.adsPct} unit="pageviews / 30d"
                hint="Fixed 30-day window, on purpose: the threshold is defined per month, so the range tabs above do not change it. Monumetric's stated minimum, approved as a real trigger on 2026-08-17."
                note="Real-browser pageviews only, and only from days whose counts exclude crawlers, which is the same population an ad network pays for."
              />
              <Gate
                label="Freemium gate" value={data.gates.wau} gate={data.gates.freemiumGate} pct={data.gates.freemiumPct} unit="weekly actives"
                hint="Fixed 7-day window, on purpose: the threshold is defined weekly, so the range tabs above do not change it. Counts signed-in users only, since an anonymous visitor can never convert to a subscription."
                note="3,500 is what clears TMDB's $149/mo commercial licence with margin at a conservative 3% / €1.50."
              />
            </View>

            {clamped || data.gap || data.crawler.since === null ? (
              <View style={styles.note}>
                <Text style={devStyles.tiny}>
                  {clamped
                    ? `Showing ${covered} of the ${data.days} days asked for. Counts before 2026-08-21 are excluded: the crawler filter shipped partway through ${data.excluded.throughDay}, and the ${num(data.excluded.pageviews)} pageviews before it are roughly 80% bot. They are left out of every figure on this page rather than deleted. `
                    : ''}
                  {data.gap
                    ? `Nothing was counted from ${data.gap.from} through ${data.gap.through}: the site had moved and the new counter was not built yet. Those days read as zero and mean "not measured". `
                    : ''}
                  {data.crawler.since === null
                    ? 'No crawler rejections recorded yet: that counter started on deploy, so a zero on an older range means not measured rather than none.'
                    : ''}
                </Text>
              </View>
            ) : null}

            <View style={devStyles.grid}>
              <Stat
                label={`Pageviews · ${covered}d`} value={num(pageviews)} sub={anonShare != null ? `${anonShare}% anonymous` : undefined}
                hint="Every page opened in a real browser during the selected range, signed-in and anonymous together. One person opening five pages counts five times: this is pageviews, not visitors."
              />
              <Stat
                label={`Crawlers blocked · ${covered}d`} value={num(data.crawler.blockedInRange)}
                sub={data.crawler.sharePct != null ? `${data.crawler.sharePct < 1 && data.crawler.blockedInRange > 0 ? '<1' : Math.round(data.crawler.sharePct)}% of beacons` : undefined}
                hint="Beacons rejected by the filter, so this is what the pageview count above is NOT counting. Read it as a pair: a share near zero on a public site means the filter has stopped matching, and a share near 100 means it is eating real visitors. Crawlers that never run JS never reach the beacon at all, so they are absent from both numbers and belong in Search Console."
              />
              <Stat
                label={`Active users · ${days}d`} value={num(data.users.activeInRange)} sub={`of ${num(data.users.total)} registered`}
                hint="Distinct SIGNED-IN accounts seen at least once in the selected range. Anonymous visitors have no identity to count, so they never appear here however much they browse."
              />
              <Stat
                label="Stickiness" value={data.users.mau > 0 ? `${Math.round((data.users.dau / data.users.mau) * 100)}%` : '-'}
                sub={`${num(data.users.dau)} daily / ${num(data.users.mau)} monthly`}
                hint="DAU divided by MAU: of everyone who used Fandex in the last 30 days, the share who used it today. A rough measure of habit. 20% is generally considered strong for a consumer app; fixed windows, so the tabs do not move it."
              />
              <Stat label={`New signups · ${days}d`} value={num(signups)} hint="Accounts created during the selected range, taken from users.created_at. Exact, not sampled." />
              <Stat
                label="Heaviest crawl day" value={data.crawler.busiestDay ? num(data.crawler.busiestDay.count) : '-'} sub={data.crawler.busiestDay?.day ?? 'none in range'}
                hint="The single day in range with the most rejected beacons. A crawl is spiky rather than steady, so one tall day here explains a quiet week better than any average would."
              />
            </View>

            <Panel
              title={`Pageviews · last ${covered} days`}
              hint="The split is the whole point. Ads monetize the anonymous half and a subscription monetizes the signed-in half, so this ratio decides which way to grow before either is built."
              note="A beacon fires this on each page opened in a browser. The Android app is not counted here. A crawler that renders the page and posts like a browser is turned away by the shape of its request and counted beside it; one that never runs JS is invisible to both, and belongs in Search Console."
            >
              <DaySeriesChart
                series={data.series.map((d) => ({ day: d.day, a: d.anon, b: d.authed }))} labelA="anonymous" labelB="signed in"
                emptyNote="No pageviews recorded in this window."
              />
            </Panel>

            <View style={devStyles.grid}>
              <Panel
                title={`Top pages · ${covered}d`}
                hint="Route templates, not raw URLs: every tag page counts under /tag/[slug]. A per-slug key set would grow a row per slug per day, so the template is what keeps the table bounded."
                note="The admin pages are excluded, so looking at this dashboard cannot inflate it."
              >
                <RankedBars rows={data.topPages.map((p) => ({ label: p.pathKey, count: p.count }))} emptyNote="No pageviews yet in this window." />
              </Panel>
              <Panel
                title={`How they arrived · ${covered}d`}
                hint="Only the class is stored, never the referring URL, which can carry someone's search query. 'internal' is in-app navigation; 'direct' means no referrer at all, which also covers most app and bookmark opens."
                note="'search' is the number that tells you whether the public item pages are pulling their weight."
              >
                <RankedBars rows={data.referrers.map((r) => ({ label: r.refClass, count: r.count }))} emptyNote="No referrers recorded yet in this window." />
              </Panel>
            </View>

            <Panel title={`Signups · last ${days} days`} hint="From users.created_at. An account is created the first time someone connects a provider, so this is also the first-connection count.">
              <DaySeriesChart series={data.users.signups.map((s) => ({ day: s.day, a: 0, b: s.count }))} />
            </Panel>

            <Text style={devStyles.tiny}>
              Generated {data.generatedAt.replace('T', ' ').slice(0, 19)} UTC. Counters are a trend instrument: the beacon endpoint is public, so treat
              the totals as directional rather than auditable.
            </Text>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

export default function DevAnalyticsScreen() {
  return <AdminOnly><Dashboard /></AdminOnly>;
}

const styles = StyleSheet.create({
  gate: {
    flexGrow: 1, flexBasis: 320, minWidth: 0, padding: 16, gap: 8,
    borderRadius: radius.lg, borderWidth: 1, borderColor: color.border, backgroundColor: color.surfaceElevated,
  },
  gateHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  gateLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  gateValue: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 6 },
  big: { fontFamily: font.sansBold, fontSize: 24, lineHeight: 32, color: color.textPrimary },
  track: { height: 6, borderRadius: radius.full, backgroundColor: color.surfaceInset, overflow: 'hidden' },
  note: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: radius.lg, borderWidth: 1, borderColor: color.border, backgroundColor: color.surfaceInset },
});
