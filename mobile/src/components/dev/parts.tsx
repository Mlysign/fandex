// The shared parts of the admin dashboards. A port of the site's
// src/components/dev/AnalyticsParts.tsx, size for size.
//
// One difference a phone forces: the site's "i" opened a floating tooltip on
// hover. Here a tap opens the same sentence in the flow under the label, so it
// can never be clipped by the edge of a small screen.
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { EmptyState } from '~/components/kit';
import { Screen } from '~/components/ui';
import { useAuth } from '~/lib/AuthProvider';
import { color, font, radius, type } from '~/theme';

export function num(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * Only an admin sees an admin page. Everybody else gets what an address that
 * does not exist gets, which is also what the Worker answers them.
 */
export function AdminOnly({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.status === 'loading' || (auth.status === 'signedIn' && !auth.profile)) return <Screen wide><View /></Screen>;
  if (!auth.profile?.admin) {
    return (
      <Screen wide>
        <View style={{ padding: 24 }}>
          <EmptyState title="Nothing here" hint="Fandex has no page at this address." />
        </View>
      </Screen>
    );
  }
  return <>{children}</>;
}

export function HintMark({ open, onPress, label }: { open: boolean; onPress: () => void; label: string }) {
  return (
    <Pressable
      onPress={onPress} hitSlop={12} accessibilityRole="button" accessibilityState={{ expanded: open }}
      accessibilityLabel={`What "${label}" means`} style={[styles.hintMark, open && { borderColor: color.accent }]}
    >
      <Text style={styles.hintMarkText}>i</Text>
    </Pressable>
  );
}

export function RangeTabs({ value, options, onChange }: { value: number; options: readonly number[]; onChange: (v: number) => void }) {
  return (
    <View style={styles.tabs}>
      {options.map((r) => {
        const on = value === r;
        return (
          <Pressable key={r} onPress={() => onChange(r)} accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.tab, on && styles.tabOn]}>
            <Text style={[styles.tabText, on && { color: color.accent }]}>{r}d</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Stat({ label, value, sub, hint }: { label: string; value: string; sub?: string; hint?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <View style={styles.statLabel}>
        <Text numberOfLines={1} style={[styles.small, { flexShrink: 1 }]}>{label}</Text>
        {hint ? <HintMark open={open} onPress={() => setOpen((v) => !v)} label={label} /> : null}
      </View>
      {sub ? <Text style={styles.tiny}>{sub}</Text> : null}
      {open && hint ? <Text style={styles.hintText}>{hint}</Text> : null}
    </View>
  );
}

export function Panel({ title, children, note, hint }: { title: string; children: ReactNode; note?: string; hint?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.panel}>
      <View style={styles.panelHead}>
        <Text numberOfLines={1} style={[type.label, { color: color.textSecondary, flexShrink: 1 }]}>{title}</Text>
        {hint ? <HintMark open={open} onPress={() => setOpen((v) => !v)} label={title} /> : null}
      </View>
      {open && hint ? <Text style={[styles.hintText, { marginTop: 0, marginBottom: 12 }]}>{hint}</Text> : null}
      {children}
      {note ? <Text style={[styles.tiny, { marginTop: 12 }]}>{note}</Text> : null}
    </View>
  );
}

export interface SeriesPoint { day: string; a: number; b: number }

/** Two stacked values per day: `b` in the accent, `a` in its subtle tone. */
export function DaySeriesChart({ series, labelA, labelB, emptyNote }: { series: SeriesPoint[]; labelA?: string; labelB?: string; emptyNote?: string }) {
  const [picked, setPicked] = useState<number | null>(null);
  const max = Math.max(1, ...series.map((d) => d.a + d.b));
  const empty = series.every((d) => d.a + d.b === 0);
  const shown = picked != null ? series[picked] : null;
  return (
    <View>
      <View style={styles.chart} accessibilityLabel={`Daily values, ${series.length} days`}>
        {series.map((d, i) => (
          <Pressable key={d.day} onPress={() => setPicked(picked === i ? null : i)} onHoverIn={() => setPicked(i)} onHoverOut={() => setPicked(null)} style={styles.chartDay}>
            <View style={{ height: `${(d.b / max) * 100}%`, backgroundColor: color.accent, borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />
            <View style={{ height: `${(d.a / max) * 100}%`, backgroundColor: color.accentSubtle }} />
          </Pressable>
        ))}
      </View>
      <View style={styles.chartFoot}>
        <Text style={styles.tiny}>{series[0]?.day}</Text>
        {shown ? (
          <Text style={[styles.tiny, { color: color.textPrimary }]} numberOfLines={1}>
            {shown.day}: {num(shown.a + shown.b)}{labelA && labelB ? ` (${num(shown.b)} ${labelB}, ${num(shown.a)} ${labelA})` : ''}
          </Text>
        ) : labelA && labelB ? (
          <View style={styles.legend}>
            <View style={[styles.swatch, { backgroundColor: color.accent }]} /><Text style={styles.tiny}>{labelB}</Text>
            <View style={[styles.swatch, { backgroundColor: color.accentSubtle }]} /><Text style={styles.tiny}>{labelA}</Text>
          </View>
        ) : null}
        <Text style={styles.tiny}>{series[series.length - 1]?.day}</Text>
      </View>
      {empty && emptyNote ? <Text style={[styles.small, { marginTop: 8 }]}>{emptyNote}</Text> : null}
    </View>
  );
}

export function RankedBars({ rows, emptyNote, mono = true }: { rows: { label: string; count: number }[]; emptyNote: string; mono?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (rows.reduce((a, r) => a + r.count, 0) === 0) return <Text style={styles.small}>{emptyNote}</Text>;
  return (
    <View style={{ gap: 6 }}>
      {rows.filter((r) => r.count > 0).map((r) => (
        <View key={r.label} style={styles.barRow}>
          <Text numberOfLines={1} style={[styles.small, { flex: 1, color: color.textPrimary }, mono && { fontFamily: font.mono }]}>{r.label}</Text>
          <View style={styles.barTrack}><View style={[styles.barFill, { width: `${(r.count / max) * 100}%` }]} /></View>
          <Text style={[styles.small, { width: 56, textAlign: 'right' }]}>{num(r.count)}</Text>
        </View>
      ))}
    </View>
  );
}

export type DevPage = 'traffic' | 'users' | 'scoring';
const DEV_LINKS: [DevPage, string, string][] = [['traffic', 'Traffic', '/dev/analytics'], ['users', 'Users', '/dev/users'], ['scoring', 'Scoring', '/dev/scoring']];

export function DashHeader({ title, subtitle, here, children }: { title: string; subtitle: string; here: DevPage; children?: ReactNode }) {
  const router = useRouter();
  return (
    <View style={styles.header}>
      <View style={{ flexShrink: 1, minWidth: 0 }}>
        <View style={styles.headerTop}>
          <Text style={type.serifLg}>{title}</Text>
          <View style={styles.tabs}>
            {DEV_LINKS.map(([key, label, href]) => (
              <Pressable key={key} onPress={() => router.push(href as never)} accessibilityRole="link" style={[styles.tab, here === key && styles.tabOn]}>
                <Text style={[styles.tabText, here === key && { color: color.accent }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <Text style={[styles.small, { marginTop: 2 }]}>{subtitle}</Text>
      </View>
      {children}
    </View>
  );
}

export const devStyles = StyleSheet.create({
  main: { width: '100%', maxWidth: 1024, alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 24, gap: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  small: { fontFamily: font.sans, fontSize: 12, lineHeight: 16, color: color.textSecondary },
  tiny: { fontFamily: font.sans, fontSize: 11, lineHeight: 15, color: color.textSecondary },
});

const styles = StyleSheet.create({
  small: devStyles.small,
  tiny: devStyles.tiny,
  hintMark: {
    width: 14, height: 14, borderRadius: radius.full, borderWidth: 1, borderColor: color.borderStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  hintMarkText: { fontFamily: font.sans, fontSize: 9, lineHeight: 11, color: color.textSecondary },
  hintText: { fontFamily: font.sans, fontSize: 11, lineHeight: 15, color: color.textPrimary, marginTop: 8 },
  tabs: { flexDirection: 'row', gap: 4 },
  tab: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.md, borderWidth: 1, borderColor: color.border },
  tabOn: { borderColor: color.accent, backgroundColor: color.accentSubtle },
  tabText: { fontFamily: font.sans, fontSize: 12, lineHeight: 16, color: color.textSecondary },
  stat: {
    flexGrow: 1, flexBasis: 150, minWidth: 0, paddingHorizontal: 16, paddingVertical: 12,
    borderRadius: radius.lg, borderWidth: 1, borderColor: color.border, backgroundColor: color.surfaceElevated,
  },
  statValue: { fontFamily: font.sansBold, fontSize: 24, lineHeight: 32, color: color.textPrimary },
  statLabel: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  panel: {
    flexGrow: 1, flexBasis: 320, minWidth: 0, padding: 16,
    borderRadius: radius.lg, borderWidth: 1, borderColor: color.border, backgroundColor: color.surfaceElevated,
  },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 1, height: 160 },
  chartDay: { flex: 1, minWidth: 0, height: '100%', justifyContent: 'flex-end' },
  chartFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 6 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  swatch: { width: 8, height: 8, borderRadius: 2 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  barTrack: { width: 96, height: 6, borderRadius: radius.full, backgroundColor: color.surfaceInset, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: radius.full, backgroundColor: color.accent },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  headerTop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
});
