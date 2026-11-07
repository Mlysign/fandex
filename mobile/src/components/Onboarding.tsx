// The first-run questions of a new account (Nils, 2026-11-07). The sign-in that
// made the account lands on Home (app/(tabs)/_layout.tsx), and two windows open
// over it, one after the other:
//
//   1. Which types do you follow? Saved as the account's default types, the
//      same setting as Settings' "Default types". All of them start on.
//   2. Rate five titles you know: the most popular titles of those types, in a
//      grid that loads more as it scrolls. Five ratings give the Fandex Score
//      something to work from. It can be skipped, and an account that already
//      holds five ratings (a Trakt history) is not asked.
//
// Only while the app runs: a restart before the end does not ask again. The
// account keeps whatever was answered.

import { useSQLiteContext } from 'expo-sqlite';
import { Star } from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MEDIA_TYPE_LABELS } from '@/lib/mediaTypes';
import { StarPicker } from '~/components/feel';
import { Img } from '~/components/Img';
import { Button } from '~/components/kit';
import { useToast } from '~/components/Toast';
import { toggled } from '~/lib/a11y';
import type { MediaType } from '~/lib/api';
import type { CatalogRow } from '~/lib/db';
import { useAuth } from '~/lib/AuthProvider';
import { cardFromCatalog, useCardActions, useCardStates, type CardItem } from '~/lib/cards';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import { todayIso } from '~/lib/dates';
import { useOfferedTypes } from '~/lib/features';
import { haptics } from '~/lib/feel';
import { cursorAfter, interleave, ratedCount, ratingPicksPage, type PickCursor } from '~/lib/ratingPicks';
import { useTypeFilter } from '~/lib/typeFilter';
import { TYPE_ICONS } from '~/lib/typeIcons';
import { breakpoint, color, radius, space, type } from '~/theme';

/** How many ratings the score is set up with. */
const GOAL = 5;

export function Onboarding() {
  const auth = useAuth();
  const db = useSQLiteContext();
  const [step, setStep] = useState<'types' | 'rate'>('types');
  const [types, setTypes] = useState<MediaType[]>([]);
  const { onboarding, endOnboarding } = auth;
  useEffect(() => { if (onboarding) setStep('types'); }, [onboarding]);

  const typesDone = useCallback(async (picked: MediaType[]) => {
    setTypes(picked);
    // A Trakt history may already hold the ratings the score needs.
    if ((await ratedCount(db).catch(() => 0)) >= GOAL) endOnboarding();
    else setStep('rate');
  }, [db, endOnboarding]);

  if (!onboarding || auth.status !== 'signedIn') return null;
  return step === 'types'
    ? <TypesStep onDone={typesDone} onClose={endOnboarding} />
    : <RateStep types={types} onDone={endOnboarding} />;
}

// ── The window ───────────────────────────────────────────────────────────────

/** A window over Home. `tall` fills a phone's screen, for the grid. */
function Frame({ tall, label, onClose, children }: { tall?: boolean; label: string; onClose: () => void; children: ReactNode }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const phone = width < breakpoint.md;
  const fill = tall && phone;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={[styles.backdrop, fill && { padding: 0 }]}>
        <View
          accessibilityViewIsModal accessibilityLabel={label}
          style={[
            styles.panel,
            tall ? styles.panelTall : styles.panelShort,
            fill && { width: '100%', height: '100%', maxHeight: undefined, borderRadius: 0, borderWidth: 0, paddingTop: insets.top + space.lg, paddingBottom: insets.bottom },
          ]}>
          {children}
        </View>
      </View>
    </Modal>
  );
}

// ── 1. Which types ───────────────────────────────────────────────────────────

function TypesStep({ onDone, onClose }: { onDone: (types: MediaType[]) => void; onClose: () => void }) {
  const auth = useAuth();
  const filter = useTypeFilter();
  const offered = useOfferedTypes();
  const [off, setOff] = useState<MediaType[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picked = offered.filter((t) => !off.includes(t));

  const toggle = (t: MediaType) => {
    haptics.tap();
    setError(null);
    setOff((o) => (o.includes(t) ? o.filter((x) => x !== t) : [...o, t]));
  };

  const go = () => {
    if (!picked.length) { setError('Pick at least one. Fandex has nothing to show otherwise.'); return; }
    // Every type on is the account's default already: nothing to save, and
    // nothing stored that would leave out a type Fandex adds later.
    if (picked.length === offered.length) { onDone(picked); return; }
    setSaving(true);
    auth.savePrefs({ mediaTypes: picked })
      .then(() => {
        // A pick on the filter row wins over the default; drop it so the new default shows.
        filter.reset();
        onDone(picked);
      })
      .catch(() => setError('Could not save that. Check the connection and try again.'))
      .finally(() => setSaving(false));
  };

  return (
    <Frame label="What do you follow?" onClose={onClose}>
      <Text accessibilityRole="header" style={type.serifLg}>What do you follow?</Text>
      <Text style={[type.bodySm, { marginTop: space.sm }]}>
        Fandex shows you these. You can change it any time in Settings.
      </Text>
      <View style={styles.typeList}>
        {offered.map((t) => {
          const Icon = TYPE_ICONS[t];
          const on = !off.includes(t);
          return (
            <Pressable
              key={t} onPress={() => toggle(t)} disabled={saving}
              accessibilityRole="checkbox" {...toggled(on)} accessibilityLabel={MEDIA_TYPE_LABELS[t]}
              style={({ pressed }) => [styles.typeRow, on && styles.typeRowOn, pressed && { opacity: 0.7 }]}>
              <View style={[styles.typeIcon, on && { backgroundColor: color.media[t] }]}>
                <Icon size={18} color={on ? color.surface : color.textMuted} />
              </View>
              <Text style={[type.body, { flex: 1, color: on ? color.textPrimary : color.textMuted }]}>{MEDIA_TYPE_LABELS[t]}</Text>
              <View style={[styles.check, on && styles.checkOn]} />
            </Pressable>
          );
        })}
      </View>
      {error ? <Text style={[type.caption, { color: color.danger, marginTop: space.md }]}>{error}</Text> : null}
      <Button label="Continue" variant="primary" size="lg" pill loading={saving} onPress={go} style={{ marginTop: space.xl }} />
    </Frame>
  );
}

// ── 2. Rate five ─────────────────────────────────────────────────────────────

/** Titles read from each type per page. */
const PAGE = 12;
const GAP = 10;

function RateStep({ types, onDone }: { types: MediaType[]; onDone: () => void }) {
  const db = useSQLiteContext();
  const auth = useAuth();
  const catalog = useCatalogSync();
  const { toast } = useToast();
  const { width: windowWidth } = useWindowDimensions();
  const columns = windowWidth >= breakpoint.md ? 5 : windowWidth >= breakpoint.sm ? 4 : 3;

  const [items, setItems] = useState<CardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const cursors = useRef<Partial<Record<MediaType, PickCursor>>>({});
  const spent = useRef(new Set<MediaType>());
  const reading = useRef(false);

  const loadMore = useCallback(async () => {
    if (reading.current) return;
    const live = types.filter((t) => !spent.current.has(t));
    if (!live.length) return;
    reading.current = true;
    setLoading(true);
    try {
      const today = todayIso();
      const pages: CatalogRow[][] = [];
      for (const t of live) pages.push(await ratingPicksPage(db, t, cursors.current[t] ?? null, PAGE, today));
      live.forEach((t, i) => {
        cursors.current[t] = cursorAfter(pages[i], cursors.current[t] ?? null);
        if (pages[i].length < PAGE) spent.current.add(t);
      });
      const fresh = interleave(pages).map(cardFromCatalog);
      setItems((was) => {
        const seen = new Set(was.map((c) => c.key));
        return [...was, ...fresh.filter((c) => !seen.has(c.key))];
      });
    } catch (e) {
      console.warn('rating_picks_failed', e instanceof Error ? e.message : String(e));
    } finally {
      reading.current = false;
      setLoading(false);
    }
  }, [db, types]);

  // A device signing in for the first time may still be filling its catalog:
  // start over each time more arrives, until there is something to rate.
  const empty = items.length === 0;
  useEffect(() => {
    if (!empty) return;
    cursors.current = {};
    spent.current = new Set();
    void loadMore();
  }, [loadMore, empty, catalog.revision]);

  const ids = useMemo(() => items.map((i) => i.id), [items]);
  const stateOf = useCardStates(ids);
  const onError = useCallback((m: string) => toast(m, 'error'), [toast]);
  const actions = useCardActions(onError);

  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true;
    void ratedCount(db).then((n) => { if (live) setCount(n); }, () => undefined);
    return () => { live = false; };
  }, [db, auth.rowsRevision]);
  const done = count >= GOAL;

  const [picking, setPicking] = useState<CardItem | null>(null);
  const [gridWidth, setGridWidth] = useState(0);
  const cellWidth = gridWidth ? Math.floor((gridWidth - GAP * (columns - 1)) / columns) : 0;

  const rows = useMemo(() => {
    const out: CardItem[][] = [];
    for (let i = 0; i < items.length; i += columns) out.push(items.slice(i, i + columns));
    return out;
  }, [items, columns]);

  const pick = useCallback((item: CardItem) => { haptics.tap(); setPicking(item); }, []);
  const picked = picking ? stateOf(picking.id).rating : null;

  return (
    <Frame tall label="Rate five titles you know" onClose={onDone}>
      <View style={styles.rateHead}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text accessibilityRole="header" style={type.serifLg}>Rate five titles you know</Text>
          <Text style={[type.bodySm, { marginTop: space.sm }]}>
            Your Fandex Score learns your taste from your ratings. Tap something you have seen, played or read, then pick the stars.
          </Text>
        </View>
        <Button label={done ? 'Done' : 'Skip'} variant={done ? 'primary' : 'ghost'} size="md" pill onPress={onDone} />
      </View>
      <Progress count={count} />

      <View style={{ flex: 1, marginTop: space.md }} onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}>
        {cellWidth ? (
          <FlatList
            data={rows}
            key={columns}
            keyExtractor={(r) => r[0].key}
            onEndReached={() => void loadMore()}
            onEndReachedThreshold={0.8}
            initialNumToRender={4}
            windowSize={5}
            contentContainerStyle={{ gap: GAP, paddingBottom: space.lg }}
            renderItem={({ item: row }) => (
              <View style={{ flexDirection: 'row', gap: GAP }}>
                {row.map((item) => (
                  <PickCell key={item.key} item={item} width={cellWidth} rating={stateOf(item.id).rating}
                    busy={actions.busy === item.key} active={picking?.key === item.key} onPick={pick} />
                ))}
              </View>
            )}
            ListEmptyComponent={loading || catalog.filling ? (
              <View style={styles.emptyBox}>
                <ActivityIndicator color={color.accent} />
                <Text style={type.caption}>{catalog.filling ? 'Fandex is still fetching titles…' : 'Finding popular titles…'}</Text>
              </View>
            ) : (
              <View style={styles.emptyBox}>
                <Text style={type.bodySm}>No titles to rate yet. Skip this, and rate things as you find them.</Text>
              </View>
            )}
            ListFooterComponent={loading && items.length ? <ActivityIndicator color={color.accent} style={{ marginTop: space.md }} /> : null}
          />
        ) : null}
      </View>

      {picking ? (
        <View style={styles.dock}>
          <View style={styles.dockHead}>
            <Text numberOfLines={1} style={[type.label, { flex: 1 }]}>{picking.title}</Text>
            <Pressable onPress={() => setPicking(null)} accessibilityRole="button" accessibilityLabel="Close the stars" hitSlop={10}>
              <Text style={[type.caption, { color: color.textSecondary }]}>Cancel</Text>
            </Pressable>
          </View>
          <StarPicker
            key={picking.key}
            rating={picked}
            onPick={(n) => actions.rate(picking, n)}
            onSettled={() => setPicking(null)}
          />
        </View>
      ) : null}
    </Frame>
  );
}

/** Five dots, one lit per rating. */
function Progress({ count }: { count: number }) {
  const n = Math.min(count, GOAL);
  return (
    <View style={styles.progress} accessibilityLabel={`${n} of ${GOAL} rated`}>
      {Array.from({ length: GOAL }, (_, i) => <View key={i} style={[styles.dot, i < n && styles.dotOn]} />)}
      <Text style={[type.caption, { marginLeft: space.sm }]}>{n} of {GOAL}</Text>
    </View>
  );
}

const PickCell = memo(function PickCell({ item, width, rating, busy, active, onPick }: {
  item: CardItem; width: number; rating: number | null; busy: boolean; active: boolean; onPick: (item: CardItem) => void;
}) {
  const height = Math.round(width * 1.5);
  const rated = rating != null && rating > 0;
  return (
    <Pressable
      onPress={() => onPick(item)}
      accessibilityRole="button"
      accessibilityLabel={rated ? `${item.title}, rated ${rating}. Change rating` : `Rate ${item.title}`}
      style={({ pressed }) => [{ width }, pressed && { opacity: 0.75 }]}>
      <View style={[styles.poster, { width, height }, (active || rated) && { borderColor: color.accent }]}>
        <Img uri={item.posterUrl ?? ''} width={width} style={{ width, height }} alt="" />
        {busy ? (
          <View style={styles.posterShade}><ActivityIndicator color={color.accent} /></View>
        ) : rated ? (
          <View style={styles.badge}>
            <Star size={11} color={color.accent} fill={color.accent} />
            <Text style={[type.label, { color: color.accent }]}>{rating % 1 === 0 ? rating.toFixed(0) : rating.toFixed(1)}</Text>
          </View>
        ) : null}
      </View>
      <Text numberOfLines={1} style={[type.caption, { marginTop: 4 }]}>{item.title}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: space.lg },
  panel: {
    width: '100%', backgroundColor: color.surfaceOverlay, borderWidth: 1, borderColor: color.border, borderRadius: radius.xl,
    padding: space.xl,
  },
  panelShort: { maxWidth: 440 },
  panelTall: { maxWidth: 760, height: '88%' },
  typeList: { marginTop: space.lg, gap: space.sm },
  typeRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingHorizontal: space.md,
    borderRadius: radius.lg, borderWidth: 1, borderColor: color.border, backgroundColor: color.surfaceElevated,
  },
  typeRowOn: { borderColor: color.borderStrong },
  typeIcon: { width: 32, height: 32, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surfaceInset },
  check: { width: 20, height: 20, borderRadius: radius.full, borderWidth: 2, borderColor: color.borderStrong },
  checkOn: { borderColor: color.accent, backgroundColor: color.accent },
  rateHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.md },
  dot: { width: 8, height: 8, borderRadius: radius.full, backgroundColor: color.borderStrong },
  dotOn: { backgroundColor: color.accent },
  poster: { borderRadius: radius.md, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent', backgroundColor: color.surfaceInset },
  posterShade: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
  badge: {
    position: 'absolute', right: 4, bottom: 4, flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 3, borderRadius: radius.full, backgroundColor: 'rgba(0,0,0,0.75)',
  },
  emptyBox: { alignItems: 'center', gap: space.sm, paddingVertical: 48 },
  dock: { marginTop: space.md, paddingTop: space.md, borderTopWidth: 1, borderTopColor: color.border, gap: space.sm },
  dockHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
