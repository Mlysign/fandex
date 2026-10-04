// The release calendar: one month of popular releases, grouped by day.

import { useRouter } from 'expo-router';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { Chip, Screen, ScreenTitle, StateBlock, T, TitleRow } from '~/components/ui';
import { api, ApiError, type CalendarCard, type CalendarMonth } from '~/lib/api';
import { currentMonth, dayLabel, monthLabel, shiftMonth, todayIso } from '~/lib/dates';
import { deviceRegion } from '~/lib/region';
import { color, space } from '~/theme';

const TYPES: { key: string | null; label: string }[] = [
  { key: null, label: 'All' },
  { key: 'game', label: 'Games' },
  { key: 'movie', label: 'Films' },
  { key: 'show', label: 'Shows' },
];

/** How far the arrows go. The Worker serves two years either side of today. */
const MAX_MONTHS_AWAY = 24;

function describe(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'offline') return 'No connection.';
    if (e.code === 'provider-unavailable') return 'The film and game databases are not answering right now.';
    if (e.code === 'budget-exhausted') return 'The catalog has done all the fetching it can for today.';
    return `The server answered ${e.status}.`;
  }
  return 'Something went wrong loading this month.';
}

export default function CalendarScreen() {
  const router = useRouter();
  const region = useMemo(deviceRegion, []);
  const [month, setMonth] = useState(currentMonth);
  const [type, setType] = useState<string | null>(null);
  const [data, setData] = useState<CalendarMonth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // The month most recently asked for. Tapping the arrow twice starts two
  // requests, and the slower one must not paint over the faster one's month.
  const wanted = useRef(month);

  const load = useCallback(async (m: string, quiet: boolean) => {
    wanted.current = m;
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const res = await api.calendar(m, region);
      if (wanted.current !== m) return;
      setData(res);
    } catch (e) {
      if (wanted.current !== m) return;
      setData(null);
      setError(describe(e));
    } finally {
      if (wanted.current === m) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [region]);

  useEffect(() => {
    void load(month, false);
  }, [month, load]);

  const sections = useMemo(() => {
    // A date outside the month is a re-release carrying its original date. The
    // Worker drops those now; a month it stored earlier may still hold one.
    const inMonth = data?.month ?? '';
    const items = (data?.data.items ?? []).filter((i) => i.releaseDate?.startsWith(inMonth) && (!type || i.type === type));
    const byDay = new Map<string, CalendarCard[]>();
    for (const item of items) {
      const day = item.releaseDate as string;
      const list = byDay.get(day);
      if (list) list.push(item); else byDay.set(day, [item]);
    }
    return [...byDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([day, rows]) => ({ title: day, data: rows }));
  }, [data, type]);

  const here = currentMonth();
  const away = (Number(month.slice(0, 4)) - Number(here.slice(0, 4))) * 12 + (Number(month.slice(5)) - Number(here.slice(5)));
  const today = todayIso();

  return (
    <Screen>
      <ScreenTitle
        eyebrow={`Releases · ${region}`}
        title={monthLabel(month)}
        right={
          <View style={styles.arrows}>
            <Pressable
              onPress={() => setMonth((m) => shiftMonth(m, -1))}
              disabled={away <= -MAX_MONTHS_AWAY}
              accessibilityRole="button"
              accessibilityLabel="Previous month"
              style={styles.arrow}>
              <ChevronLeft color={away <= -MAX_MONTHS_AWAY ? color.textMuted : color.textPrimary} size={22} />
            </Pressable>
            <Pressable
              onPress={() => setMonth((m) => shiftMonth(m, 1))}
              disabled={away >= MAX_MONTHS_AWAY}
              accessibilityRole="button"
              accessibilityLabel="Next month"
              style={styles.arrow}>
              <ChevronRight color={away >= MAX_MONTHS_AWAY ? color.textMuted : color.textPrimary} size={22} />
            </Pressable>
          </View>
        }
      />

      <View style={styles.chips}>
        {TYPES.map((t) => (
          <Chip key={t.label} label={t.label} selected={type === t.key} onPress={() => setType(t.key)} />
        ))}
        {month !== here ? <Chip label="Today" selected={false} onPress={() => setMonth(here)} /> : null}
      </View>

      {loading ? (
        <StateBlock loading />
      ) : error ? (
        <StateBlock title="Could not load this month" detail={error} action={{ label: 'Try again', onPress: () => void load(month, false) }} />
      ) : sections.length === 0 ? (
        <StateBlock
          title="Nothing here"
          detail={type ? 'No releases of this kind are listed for this month. Try another type.' : 'No releases are listed for this month yet.'}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => `${item.source}:${item.type}:${item.sourceId}`}
          stickySectionHeadersEnabled
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={color.accent}
              onRefresh={() => { setRefreshing(true); void load(month, true); }}
            />
          }
          renderSectionHeader={({ section }) => (
            <View style={styles.dayHeader}>
              <T variant="eyebrow" style={section.title === today ? { color: color.accent } : undefined}>
                {section.title === today ? `Today · ${dayLabel(section.title)}` : dayLabel(section.title)}
              </T>
            </View>
          )}
          renderItem={({ item }) => (
            <TitleRow
              title={item.title}
              kind={item.type}
              posterUrl={item.posterUrl}
              meta={item.platforms?.length ? item.platforms.slice(0, 2).join(', ') : item.genres.slice(0, 2).join(', ') || null}
              onPress={() => router.push(`/open/${item.source}/${item.type}/${item.sourceId}`)}
            />
          )}
          ListFooterComponent={
            <View style={styles.footer}>
              {data?.data.partial ? <T variant="caption">One of the databases did not answer, so this month may be missing titles.</T> : null}
              {data?.stale ? <T variant="caption">This month is being refreshed and may be a day behind.</T> : null}
            </View>
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  arrows: { flexDirection: 'row', gap: space.xs },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.md },
  dayHeader: { backgroundColor: color.surface, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xs },
  footer: { padding: space.lg, gap: space.xs },
});
