// The next episode of each show you are part way through, with a tick.
// Ports of src/components/EpisodeRow.tsx (the row), ProgressRail.tsx (Home's
// short scroller) and ProgressTabPanel.tsx (the tick's fill, hold and fade).
//
// The data is the device's own (lib/upNext.ts): Trakt is asked show by show,
// and a tick is written to Trakt, the Worker and the device, in that order.

import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Check } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RailHeader } from '~/components/cards';
import { Img } from '~/components/Img';
import { Panel, Skeleton } from '~/components/kit';
import { TypeIcon } from '~/components/Logo';
import { useAuth } from '~/lib/AuthProvider';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import { TraktAuthError } from '~/lib/trakt';
import { markEpisodeWatched, refreshUpNext, upNextList, upNextPending, type UpNextEntry } from '~/lib/upNext';
import { color, font, radius, type } from '~/theme';

export const EPISODE_ROW_H = 76;
export const EPISODE_ROW_GAP = 8;
const MAX_REFRESH_PASSES = 6;
/** How long a ticked row holds its filled box before it fades, and the fade itself. */
const HOLD_MS = 450;
const FADE_MS = 320;

export const epLabel = (season: number, episode: number) => `S.${String(season).padStart(2, '0')} E.${String(episode).padStart(2, '0')}`;
const entryKey = (e: UpNextEntry) => `${e.mediaItemId}:${e.season}:${e.episode}`;

function describeTrakt(e: unknown): string {
  if (e instanceof TraktAuthError) return 'Trakt needs you to sign in again. You can do that under You.';
  if (e instanceof Error && /Network request failed|Failed to fetch/i.test(e.message)) return 'No connection. Showing what this device already knows.';
  return e instanceof Error ? e.message : 'Trakt did not answer.';
}

// ── The row ──────────────────────────────────────────────────────────────────

export function EpisodeRow({ entry, ticked, exiting, onTick }: {
  entry: UpNextEntry; ticked: boolean; exiting: boolean; onTick: (e: UpNextEntry) => void;
}) {
  const router = useRouter();
  const [imgFailed, setImgFailed] = useState(false);
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (exiting) Animated.timing(fade, { toValue: 0, duration: FADE_MS, useNativeDriver: Platform.OS !== 'web' }).start();
    else fade.setValue(1);
  }, [exiting, fade]);

  return (
    <Animated.View style={[styles.row, { opacity: fade, transform: [{ scale: fade.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }] }]}>
      <View style={styles.poster}>
        {entry.posterUrl && !imgFailed
          ? <Img uri={entry.posterUrl} width={56} alt="" style={styles.fill} onError={() => setImgFailed(true)} />
          : <View style={[styles.fill, styles.center]}><TypeIcon type="show" size={16} /></View>}
      </View>
      <Pressable
        onPress={() => router.push(`/item/${entry.mediaItemId}`)}
        accessibilityRole="link"
        accessibilityLabel={`${entry.title}, ${epLabel(entry.season, entry.episode)}`}
        style={styles.body}>
        <View style={styles.titleLine}>
          <View style={styles.chip}><Text style={styles.chipText}>{epLabel(entry.season, entry.episode)}</Text></View>
          <Text numberOfLines={1} style={[type.serifSm, { flexShrink: 1 }]}>{entry.title}</Text>
        </View>
        <Text numberOfLines={1} style={type.meta}>{entry.episodeTitle || `Episode ${entry.episode}`}</Text>
      </Pressable>
      <Pressable
        onPress={() => onTick(entry)}
        disabled={ticked}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: ticked }}
        accessibilityLabel={`Mark ${entry.title} ${epLabel(entry.season, entry.episode)} watched`}
        style={styles.tick}>
        <View style={[styles.box, ticked && { backgroundColor: color.accent, borderColor: color.accent }]}>
          {ticked ? <Check size={20} color={color.surface} strokeWidth={3} /> : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ── The list behind both surfaces ────────────────────────────────────────────

/**
 * The Up next list, kept current. Shows what the device already holds at once,
 * then asks Trakt about the shows that are due. A tick fills its box, holds,
 * fades the row out, and the list is read again with the show's next episode.
 */
export function useUpNext(limit: number) {
  const db = useSQLiteContext();
  const auth = useAuth();
  const catalog = useCatalogSync();
  const [entries, setEntries] = useState<UpNextEntry[] | null>(null);
  const [pending, setPending] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());

  const show = useCallback(async () => {
    const [list, waiting] = await Promise.all([upNextList(db, limit), upNextPending(db)]);
    setEntries(list);
    setPending(waiting);
  }, [db, limit]);

  const signedIn = auth.status === 'signedIn';
  useEffect(() => {
    let live = true;
    if (!signedIn) {
      setEntries([]);
      return;
    }
    (async () => {
      await show();
      setRefreshing(true);
      setError(null);
      try {
        for (let pass = 0; pass < MAX_REFRESH_PASSES && live; pass++) {
          const res = await refreshUpNext(db);
          if (!live) return;
          if (res.checked) await show();
          if (!res.waiting || !res.checked) break;
        }
      } catch (e) {
        if (live) setError(describeTrakt(e));
      } finally {
        if (live) setRefreshing(false);
      }
    })();
    return () => { live = false; };
  }, [db, show, signedIn, auth.rowsRevision, catalog.revision]);

  const tick = useCallback(async (entry: UpNextEntry) => {
    const k = entryKey(entry);
    setDone((s) => new Set(s).add(k));
    setError(null);
    try {
      await markEpisodeWatched(db, entry);
      await new Promise((r) => setTimeout(r, HOLD_MS));
      setLeaving((s) => new Set(s).add(k));
      await new Promise((r) => setTimeout(r, FADE_MS));
      await show();
    } catch (e) {
      setError(describeTrakt(e));
    } finally {
      setDone((s) => { const n = new Set(s); n.delete(k); return n; });
      setLeaving((s) => { const n = new Set(s); n.delete(k); return n; });
    }
  }, [db, show]);

  return { entries, pending, refreshing, error, done, leaving, tick, entryKey };
}

// ── Home's rail ──────────────────────────────────────────────────────────────

const VISIBLE_ROWS = 2.5;
const SCROLLER_H = Math.round(EPISODE_ROW_H * VISIBLE_ROWS + EPISODE_ROW_GAP * (Math.ceil(VISIBLE_ROWS) - 1));

/** Two and a half rows, so the half says there is more, scrolling inside the page. */
export function UpNextRail() {
  const up = useUpNext(30);

  if (up.entries === null) {
    return (
      <View aria-hidden>
        <RailHeader title="Up next" />
        <View style={{ height: SCROLLER_H, gap: EPISODE_ROW_GAP, overflow: 'hidden' }}>
          {[0, 1, 2].map((i) => <Skeleton key={i} style={{ height: EPISODE_ROW_H, borderRadius: radius.lg }} />)}
        </View>
      </View>
    );
  }
  if (!up.entries.length) {
    return (
      <View>
        <RailHeader title="Up next" />
        <Panel style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
          <Text style={type.bodySm}>
            {up.refreshing ? 'Asking Trakt what is next…'
              : up.error ?? 'You are caught up. A show appears here when it has an episode out that you have not watched.'}
          </Text>
        </Panel>
      </View>
    );
  }
  return (
    <View>
      <RailHeader title="Up next" seeAllHref="/wishlist?tab=progress" />
      <ScrollView nestedScrollEnabled style={{ height: SCROLLER_H }} contentContainerStyle={{ gap: EPISODE_ROW_GAP }}>
        {up.entries.map((e) => {
          const k = up.entryKey(e);
          return <EpisodeRow key={k} entry={e} ticked={up.done.has(k)} exiting={up.leaving.has(k)} onTick={(x) => void up.tick(x)} />;
        })}
      </ScrollView>
      {up.error ? <Text style={[type.caption, { color: color.warning, marginTop: 8 }]}>{up.error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  center: { alignItems: 'center', justifyContent: 'center' },
  row: {
    height: EPISODE_ROW_H, flexDirection: 'row', alignItems: 'stretch', overflow: 'hidden',
    backgroundColor: color.surfaceElevated, borderWidth: 1, borderColor: color.border, borderRadius: radius.lg,
  },
  poster: { width: 56, backgroundColor: color.neutral800, overflow: 'hidden' },
  body: { flex: 1, minWidth: 0, paddingHorizontal: 12, paddingVertical: 8, justifyContent: 'center', gap: 4 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  chip: { paddingHorizontal: 6, paddingVertical: 4, borderRadius: 6, backgroundColor: color.accentSubtle },
  chipText: { fontFamily: font.mono, fontSize: 12.5, lineHeight: 14, color: color.accent, fontVariant: ['tabular-nums'] },
  tick: { width: 44, marginRight: 8, alignItems: 'center', justifyContent: 'center' },
  box: {
    width: 28, height: 28, borderRadius: radius.sm, borderWidth: 1, borderColor: color.borderStrong,
    alignItems: 'center', justifyContent: 'center',
  },
});
