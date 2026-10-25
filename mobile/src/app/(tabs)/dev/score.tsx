// /dev/score: the score's goalpost. Every signed-in device sends counts of how
// the match compared with the person's own ratings (lib/ScoreProvider.tsx,
// worker/src/scoreReport.ts); this page sums them over everybody and draws
// the curve, per medium, with the picture of how the score works under it.
// Nils, 2026-10-25: one chart for all users on the backend, not a page per user.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AdminOnly, DashHeader, devStyles, num, Panel, Stat } from '~/components/dev/parts';
import { Screen } from '~/components/ui';
import { api, type ScoreSummary, type ScoreSummaryMedium } from '~/lib/api';
import { LABEL_TEXT } from '~/lib/scoreReasons';
import { usePageTitle } from '~/lib/pageTitle';
import { color, font, radius, type } from '~/theme';

const MEDIA: [string, string][] = [['all', 'All media'], ['movie', 'Films'], ['show', 'Shows'], ['game', 'Games'], ['book', 'Books']];
const LABEL_ORDER = ['safe-bet', 'hidden-gem', 'tryout', 'usual', 'bycatch', 'skip'] as const;
/** Where the picture lives: the website build copies it from public/ (mobile/web/build.mjs). */
const HOW_IT_WORKS = 'https://fandex.org/score-how-it-works.svg';

function Bins({ m, binFrom }: { m: ScoreSummaryMedium; binFrom: number }) {
  const max = Math.max(1, ...m.bins);
  return (
    <View style={styles.bins}>
      {m.bins.map((n, i) => {
        const at = binFrom + i;
        const centre = at >= -1 && at <= 1;
        return (
          <View key={at} style={styles.bin}>
            <Text style={[devStyles.tiny, { textAlign: 'center' }]}>{n ? num(n) : ''}</Text>
            <View style={styles.binTrack}>
              <View style={{ height: `${Math.max(n ? 2 : 0, (n / max) * 100)}%`, backgroundColor: centre ? color.accent : color.neutral600, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
            </View>
            <Text style={[devStyles.tiny, { textAlign: 'center', color: centre ? color.textPrimary : color.textSecondary }]}>{at > 0 ? `+${at}` : String(at)}</Text>
          </View>
        );
      })}
    </View>
  );
}

function Dashboard() {
  const [medium, setMedium] = useState('all');
  const [data, setData] = useState<ScoreSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.adminScore());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const m = useMemo<ScoreSummaryMedium | null>(() => {
    if (!data) return null;
    return medium === 'all' ? data.all : data.media.find((x) => x.medium === medium) ?? { medium, users: 0, rated: 0, bins: data.all.bins.map(() => 0), labels: {} };
  }, [data, medium]);

  const within = (k: number) => {
    if (!m || !m.rated || !data) return null;
    const idx0 = -data.binFrom;
    let n = 0;
    for (let i = idx0 - k; i <= idx0 + k; i++) n += m.bins[i] ?? 0;
    return Math.round((100 * n) / m.bins.reduce((a, b) => a + b, 0));
  };
  const eightShare = m && m.rated ? Object.values(m.labels).reduce((a, v) => a + v.eightPlus, 0) / Math.max(1, Object.values(m.labels).reduce((a, v) => a + v.rated, 0)) : null;

  return (
    <Screen wide>
      <ScrollView contentContainerStyle={devStyles.main}>
        <DashHeader title="Score" subtitle="Every device's counts of how the match fits its owner's own ratings, summed. No title or rating is in them." here="score">
          <View style={styles.tabs}>
            {MEDIA.map(([key, label]) => (
              <Pressable key={key} onPress={() => setMedium(key)} accessibilityRole="button" style={[styles.tab, medium === key && styles.tabOn]}>
                <Text style={[devStyles.small, medium === key && { color: color.accent }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </DashHeader>

        {error ? <View style={styles.note}><Text style={[devStyles.small, { color: color.danger }]}>Could not load the score report: {error}</Text></View> : null}
        {!data && !error ? <Text style={devStyles.small}>Loading…</Text> : null}

        {data && m ? (
          <>
            <View style={devStyles.grid}>
              <Stat label="Users reporting" value={num(m.users)} hint="Accounts whose device has sent a report for this medium since the current score version. A device sends about once a day." />
              <Stat label="Rated titles" value={num(m.rated)} hint="Titles those users rated and the device could score, with the title's own rating left out." />
              <Stat label="Within 1 point" value={within(1) == null ? '-' : `${within(1)}%`} sub="of rating − match ÷ 10" hint="Share of rated titles where the match, read as a rating, landed within one point of what the person gave. Guessing a person's own average lands within one point about 41% of the time, so this number is only good news above that." />
              <Stat label="Within 2 points" value={within(2) == null ? '-' : `${within(2)}%`} hint="The same, two points either way." />
            </View>

            <Panel title="Rating minus match, as a rating" note={`Each bar is how many rated titles landed there. Zero means the match, divided by ten, was the rating given. Score version ${data.version}.`}>
              {m.rated ? <Bins m={m} binFrom={data.binFrom} /> : <Text style={devStyles.small}>No report yet for this medium. A device sends one about a day after it rebuilds its profile.</Text>}
            </Panel>

            <Panel title="What each label meant" note="Per label: how many rated titles got it, and how often those were rated 8 or more against the overall share. This is where the odds line under a label comes from once there are enough reports.">
              {LABEL_ORDER.map((label) => {
                const v = m.labels[label];
                const share = v && v.rated ? v.eightPlus / v.rated : null;
                const lift = share != null && eightShare ? share / eightShare : null;
                return (
                  <View key={label} style={styles.labelRow}>
                    <Text style={[devStyles.small, { width: 110, color: color.textPrimary }]}>{LABEL_TEXT[label]}</Text>
                    <Text style={[devStyles.small, { width: 90 }]}>{v ? num(v.rated) : '0'} rated</Text>
                    <Text style={[devStyles.small, { width: 90 }]}>{share == null ? '-' : `${Math.round(100 * share)}% an 8+`}</Text>
                    <Text style={[devStyles.small, { flex: 1 }, lift != null && lift >= 1.15 && { color: color.success }, lift != null && lift <= 0.85 && { color: color.scoreLow }]}>
                      {lift == null ? '' : `×${lift.toFixed(2)} the usual share`}
                    </Text>
                  </View>
                );
              })}
            </Panel>
          </>
        ) : null}

        <Panel title="How the score works" note="This picture is the score's spec in one page. It changes whenever the score does (public/score-how-it-works.svg).">
          {Platform.OS === 'web' ? (
            <Image source={{ uri: HOW_IT_WORKS }} accessibilityLabel="How your Fandex match works, as one picture" style={styles.picture} resizeMode="contain" />
          ) : (
            <Pressable onPress={() => void Linking.openURL(HOW_IT_WORKS)} accessibilityRole="link" accessibilityLabel="Open the picture of how the score works">
              <Text style={[type.bodySm, { color: color.accent }]}>Open the picture of how the score works</Text>
            </Pressable>
          )}
        </Panel>
      </ScrollView>
    </Screen>
  );
}

export default function ScoreDashboardScreen() {
  usePageTitle('Score · Fandex dev');
  return <AdminOnly><Dashboard /></AdminOnly>;
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tab: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1, borderColor: color.border },
  tabOn: { borderColor: color.accent },
  note: { padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: color.border, backgroundColor: color.surfaceElevated },
  bins: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 200, paddingTop: 4 },
  bin: { flex: 1, height: '100%', justifyContent: 'flex-end', gap: 4 },
  binTrack: { flex: 1, justifyContent: 'flex-end', backgroundColor: color.surfaceInset, borderRadius: 3, overflow: 'hidden' },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: color.border },
  picture: { width: '100%', aspectRatio: 900 / 1560, borderRadius: radius.md },
  mono: { fontFamily: font.mono },
});
