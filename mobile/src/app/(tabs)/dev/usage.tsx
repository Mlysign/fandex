// /dev/usage: the usage counters (worker/src/usage.ts, GET /v1/admin/usage).
// Totals per UTC day and nothing else; the three account numbers (media mix,
// first week, new media type) come from rows the accounts already have. Built
// from the Traffic page's parts (components/dev/parts.tsx).
//
// A number with no row behind it shows a dash or "No data yet", never a zero:
// the counters start the day they are switched on.
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { AdminOnly, DashHeader, DaySeriesChart, devStyles, num, Panel, RangeTabs, RankedBars, Stat } from '~/components/dev/parts';
import { Screen } from '~/components/ui';
import { api, type UsageSnapshot } from '~/lib/api';
import { usePageTitle } from '~/lib/pageTitle';
import { byPrefix, multiMedia, perDay, perWeek, retention, share, total } from '~/lib/usageReport';
import { color, font, radius, type } from '~/theme';

const RANGES = [7, 30, 90] as const;
const NO_DATA = 'No data yet.';

function Heading({ children }: { children: string }) {
  return <Text accessibilityRole="header" style={[type.serifSm, { marginTop: 8 }]}>{children}</Text>;
}

/** A small table: a header row, then rows of cells. A null cell is a dash. */
function Table({ head, rows }: { head: string[]; rows: { key: string; cells: (string | number | null)[] }[] }) {
  if (!rows.length) return <Text style={devStyles.small}>{NO_DATA}</Text>;
  return (
    <ScrollView horizontal>
      <View>
        <View style={styles.tr}>
          {head.map((h, i) => <Text key={`${h}${i}`} style={[devStyles.small, styles.cell, i ? styles.num : styles.first]}>{h}</Text>)}
        </View>
        {rows.map((r) => (
          <View key={r.key} style={[styles.tr, styles.trBody]}>
            {r.cells.map((v, i) => (
              <Text key={i} style={[devStyles.small, styles.cell, i ? styles.num : [styles.first, { fontFamily: font.mono }], { color: color.textPrimary }]}>
                {v == null ? '-' : typeof v === 'number' ? num(v) : v}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function Dashboard() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<UsageSnapshot | null>(null);
  const [error, setError] = useState<{ days: number; message: string } | null>(null);
  const failed = error?.days === days;

  const load = useCallback(async (d: number) => {
    try {
      setData(await api.adminUsage(d));
      setError(null);
    } catch (e) {
      setError({ days: d, message: e instanceof Error ? e.message : String(e) });
    }
  }, []);
  useEffect(() => { void load(days); }, [days, load]);

  const c = data?.counters ?? [];
  const deviceDays = total(c, 'app:day');
  const mix = data ? multiMedia(data.mediaMix) : { many: null, all: null };
  const ret = retention(c);
  const daily = perDay(c, 'active');
  const covered = data?.days ?? days;

  return (
    <Screen wide>
      <ScrollView contentContainerStyle={devStyles.main}>
        <DashHeader title="Usage" subtitle="Totals per day. No account, no device and no single event is stored." here="usage">
          <RangeTabs value={days} options={RANGES} onChange={setDays} />
        </DashHeader>

        {failed && error ? (
          <View style={styles.note}><Text style={[devStyles.small, { color: color.danger }]}>Could not load the usage counts: {error.message}</Text></View>
        ) : null}
        {!data && !failed ? <Text style={devStyles.small}>Loading…</Text> : null}

        {data && !data.on ? (
          <View style={styles.note}><Text style={devStyles.small}>Counting is switched off on the server.</Text></View>
        ) : null}

        {data ? (
          <>
            <Heading>The three messages</Heading>
            <View style={devStyles.grid}>
              <Stat
                label="Rated in 2 or more types" value={share(mix.many, mix.all)}
                sub={mix.all != null ? `${num(mix.many ?? 0)} of ${num(mix.all)} accounts with a rating` : NO_DATA}
                hint="Accounts with ratings in at least two media types, of every account with a rating. All time, from the ratings themselves, so the range tabs do not move it."
              />
              <Stat
                label="Device-days with a reminder set" value={share(total(c, 'app:day:reminder'), deviceDays)}
                sub={deviceDays != null ? `of ${num(deviceDays)} device-days · ${covered}d` : NO_DATA}
                hint="Each phone sends 'used today' and 'has a reminder set' at most once a UTC day, with no id. One over the other is the share of phone-days with a reminder."
              />
              <Stat
                label="Device-days that opened Why?" value={share(total(c, 'app:day:why'), deviceDays)}
                sub={deviceDays != null ? `of ${num(deviceDays)} device-days · ${covered}d` : NO_DATA}
                hint="The same once-a-day flags: phone-days on which a Why? sheet was opened, from the item page's seal or a card's long press."
              />
            </View>

            <Heading>Do people stay</Heading>
            <View style={devStyles.grid}>
              <Panel
                title="New accounts with 5 ratings in their first week"
                hint="Per signup week, the last 13 weeks whatever the range: accounts created, and how many saved five ratings within seven days. The newest week is still filling."
              >
                <Table
                  head={['Signup week', 'New', 'Rated 5', 'Share']}
                  rows={data.firstWeek.map((w) => ({ key: w.week, cells: [w.week, w.created, w.rated5, share(w.rated5, w.created)] }))}
                />
              </Panel>
              <Panel title={`Weekly active accounts · ${covered}d`} hint="Accounts seen at least once in each ISO week (wactive, summed over the week's days). The first and last week of the range may be cut short.">
                <Table head={['Week', 'Accounts']} rows={perWeek(c, 'wactive').map((w) => ({ key: w.week, cells: [w.week, w.n] }))} />
              </Panel>
            </View>
            <Panel
              title={`Returning accounts per signup week · ${covered}d`}
              hint="Rows are signup weeks, columns the weeks of the range. A cell is the accounts of that signup week seen in that week. A dash is a week before the signup, or one with no row."
            >
              <Table
                head={['Signup week', ...ret.weeks]}
                rows={ret.rows.map((r) => ({ key: r.signup, cells: [r.signup, ...r.cells] }))}
              />
            </Panel>
            <Panel title={`Daily active accounts · ${covered}d`} hint="Distinct signed-in accounts per UTC day, counted on each account's first request of the day.">
              {daily.length ? <DaySeriesChart series={daily.map((d) => ({ day: d.day, a: 0, b: d.n }))} /> : <Text style={devStyles.small}>{NO_DATA}</Text>}
            </Panel>

            <Heading>What people use</Heading>
            <View style={devStyles.grid}>
              <Panel title={`Screens opened · ${covered}d`} hint="Each time a screen of the Android app is opened. The website is counted on the Traffic page instead.">
                <RankedBars rows={byPrefix(c, 'app:screen:')} emptyNote={NO_DATA} />
              </Panel>
              <Panel title={`Recommended titles opened · ${covered}d`} hint="Titles opened from Home's Recommended for you, by type.">
                <RankedBars rows={byPrefix(c, 'app:rec:')} emptyNote={NO_DATA} />
              </Panel>
              <Panel title={`Reminders · ${covered}d`} hint="set: reminders the phone scheduled. tapped: the app opened from one.">
                <RankedBars rows={byPrefix(c, 'app:reminder:')} emptyNote={NO_DATA} />
              </Panel>
              <Panel title={`First-start steps · ${covered}d`} hint="picker: the types question answered. rated5: the rating step left with five ratings. skipped: left with fewer.">
                <RankedBars rows={byPrefix(c, 'app:first:')} emptyNote={NO_DATA} />
              </Panel>
              <Panel title={`Visit lengths · ${covered}d`} hint="Minutes from the app coming to the front to it going to the background, in four buckets.">
                <RankedBars rows={byPrefix(c, 'app:session:')} emptyNote={NO_DATA} />
              </Panel>
              <Panel title={`Signups per sign-in method · ${covered}d`}>
                <RankedBars rows={byPrefix(c, 'signup:')} emptyNote={NO_DATA} />
              </Panel>
              <Panel title={`Connections · ${covered}d`} hint="A sign-in method added to an account that already existed.">
                <RankedBars rows={byPrefix(c, 'link:')} emptyNote={NO_DATA} />
              </Panel>
              <Panel title={`First entry in a new media type · ${covered}d`} hint="Accounts that added their first title of a type more than a day after signing up, by type. From the rows themselves.">
                <RankedBars rows={data.newMediaType.map((t) => ({ label: t.type, count: t.accounts }))} emptyNote={NO_DATA} />
              </Panel>
            </View>

            <Heading>Server</Heading>
            <View style={devStyles.grid}>
              <Panel title={`Requests per kind · ${covered}d`} hint="Every API request by the kind of route. Health checks, the counters and the admin pages are left out.">
                <RankedBars rows={byPrefix(c, 'req:')} emptyNote={NO_DATA} />
              </Panel>
              <Panel title={`Failures · ${covered}d`} hint="Answers with a 5xx status or a 429, by status.">
                <RankedBars rows={byPrefix(c, 'err:')} emptyNote={NO_DATA} />
              </Panel>
            </View>
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

export default function DevUsageScreen() {
  usePageTitle('Usage');
  return <AdminOnly><Dashboard /></AdminOnly>;
}

const styles = StyleSheet.create({
  note: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: radius.lg, borderWidth: 1, borderColor: color.border, backgroundColor: color.surfaceInset },
  tr: { flexDirection: 'row', paddingVertical: 6 },
  trBody: { borderTopWidth: 1, borderTopColor: color.border },
  cell: { paddingRight: 12 },
  first: { width: 100 },
  num: { width: 76, textAlign: 'right' },
});
