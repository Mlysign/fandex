// One title: what it is, when it is out, who made it, where to get it.

import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Poster, Screen, StateBlock, T, TypeTag } from '~/components/ui';
import { useSQLiteContext } from 'expo-sqlite';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ApiError, type ItemDetail } from '~/lib/api';
import { useAuth } from '~/lib/AuthProvider';
import { compactCount, longDate, todayIso } from '~/lib/dates';
import { itemStateFor } from '~/lib/db';
import { rateItem, removeFromLibrary, setWishlist, type ActionTarget } from '~/lib/itemActions';
import { deviceRegion } from '~/lib/region';
import { TraktAuthError } from '~/lib/trakt';
import { color, radius, space } from '~/theme';

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View style={styles.fact}>
      <T variant="eyebrow">{label}</T>
      <T variant="body">{value}</T>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <T variant="eyebrow">{title}</T>
      {children}
    </View>
  );
}

const RATINGS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function runtime(minutes: number | null): string | null {
  if (!minutes) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h ${m ? `${m} min` : ''}`.trim() : `${m} min`;
}

export default function ItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const region = useMemo(deviceRegion, []);
  // The page draws under Android's navigation buttons, so the last line has to clear them.
  const { bottom } = useSafeAreaInsets();
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItem(await api.item(id, region));
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      setError(
        code === 'offline'
          ? { title: 'No connection', detail: 'This page needs a connection to load.' }
          : code === 'not-found'
            ? { title: 'Not in the catalog', detail: 'Fandex does not hold a title at this address.' }
            : { title: 'Could not load this title', detail: 'Something went wrong.' },
      );
    }
  }, [id, region]);

  useEffect(() => {
    void load();
  }, [load]);

  // What this device knows about you and this title. Read-only for now: rating
  // and wishlisting from the app come with the write path.
  const db = useSQLiteContext();
  const auth = useAuth();
  const [mine, setMine] = useState<Awaited<ReturnType<typeof itemStateFor>> | null>(null);
  useEffect(() => {
    let live = true;
    if (auth.status !== 'signedIn') {
      setMine(null);
      return;
    }
    void itemStateFor(db, id).then((s) => { if (live) setMine(s); });
    return () => { live = false; };
  }, [db, id, auth.status, auth.rowsRevision]);

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  /** Run one action; say why if it failed. A failed step wrote nothing after it. */
  const act = useCallback((run: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);
    run()
      .then(() => auth.rowsChanged())
      .catch((e: unknown) => {
        console.warn('item_action_failed', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
        setActionError(
          e instanceof TraktAuthError ? 'Trakt needs you to sign in again. You can do that on the You tab.'
          : e instanceof ApiError && e.code === 'offline' ? 'No connection. Nothing was changed.'
          : e instanceof ApiError && e.code === 'budget-exhausted' ? 'Fandex cannot save more changes until tomorrow.'
          : e instanceof ApiError ? 'Fandex could not save that. Nothing was changed.'
          : e instanceof Error ? e.message : 'That did not work. Nothing was changed.',
        );
      })
      .finally(() => setBusy(false));
  }, [auth]);

  if (error) {
    return (
      <Screen headed>
        <StateBlock title={error.title} detail={error.detail} action={{ label: 'Try again', onPress: () => void load() }} />
      </Screen>
    );
  }
  if (!item) {
    return (
      <Screen headed>
        <StateBlock loading />
      </Screen>
    );
  }

  const m = item.merged;
  const target: ActionTarget = { id: item.id, type: item.type, sources: item.vector.sources };
  const released = longDate(m.releaseDate);
  const upcoming = !!m.releaseDate && m.releaseDate.slice(0, 10) > todayIso();
  const made = item.type === 'game'
    ? [m.developer, m.publisher && m.publisher !== m.developer ? m.publisher : null].filter(Boolean).join(' · ')
    : m.director ?? null;
  const metaLine = [item.vector.year ? String(item.vector.year) : null, runtime(m.runtimeMinutes), m.certification[0]]
    .filter(Boolean)
    .join(' · ');

  return (
    <Screen headed>
      <Stack.Screen options={{ title: m.title }} />
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: space.section + bottom }]}>
        {m.backdropUrl ? <Image source={{ uri: m.backdropUrl }} style={styles.backdrop} contentFit="cover" transition={120} /> : null}

        <View style={styles.head}>
          <Poster uri={m.posterUrl} width={104} kind={item.type} />
          <View style={styles.headBody}>
            <TypeTag kind={item.type} />
            <T variant="serifMd">{m.title}</T>
            {metaLine ? <T variant="meta">{metaLine}</T> : null}
            {released ? (
              <T variant="caption" style={upcoming ? { color: color.accent } : undefined}>
                {upcoming ? `Out ${released}` : `Released ${released}`}
                {item.region !== 'US' && item.type === 'movie' ? ` (${item.region})` : ''}
              </T>
            ) : null}
          </View>
        </View>

        {mine && (mine.inLibrary || mine.inWishlist) ? (
          <View style={styles.mine}>
            <T variant="label" style={{ color: color.accent }}>
              {[
                mine.inLibrary ? (mine.status ? `In your library · ${mine.status}` : 'In your library') : null,
                mine.inWishlist ? 'On your wishlist' : null,
              ].filter(Boolean).join(' · ')}
            </T>
            {mine.rating != null ? <T variant="label">You rated it {mine.rating}</T> : null}
          </View>
        ) : null}

        {auth.status === 'signedIn' && mine ? (
          <View style={styles.actionsBlock}>
            <T variant="eyebrow">Your rating</T>
            <View style={styles.stars}>
              {RATINGS.map((n) => {
                const on = mine.rating != null && Math.round(mine.rating) === n;
                return (
                  <Pressable
                    key={n}
                    disabled={busy}
                    // Tapping the rating it already has takes the rating away.
                    onPress={() => act(() => rateItem(db, target, on ? null : n))}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={on ? `Remove your rating of ${n}` : `Rate ${n} out of 10`}
                    style={({ pressed }) => [styles.star, on && styles.starOn, (pressed || busy) && { opacity: 0.6 }]}>
                    <T variant="label" style={{ color: on ? color.textOnAccent : color.textSecondary }}>{n}</T>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.actionRow}>
              <Pressable
                disabled={busy}
                onPress={() => act(() => setWishlist(db, target, !mine.inWishlist))}
                accessibilityRole="button"
                accessibilityState={{ selected: mine.inWishlist }}
                style={({ pressed }) => [styles.action, mine.inWishlist && styles.actionOn, (pressed || busy) && { opacity: 0.6 }]}>
                <T variant="label" style={mine.inWishlist ? { color: color.accent } : undefined}>
                  {mine.inWishlist ? 'On your wishlist' : 'Add to wishlist'}
                </T>
              </Pressable>
              {mine.inLibrary ? (
                <Pressable
                  disabled={busy}
                  onPress={() => act(() => removeFromLibrary(db, target))}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.action, (pressed || busy) && { opacity: 0.6 }]}>
                  <T variant="label">Remove from library</T>
                </Pressable>
              ) : null}
            </View>
            {actionError ? <T variant="caption" style={{ color: color.warning }}>{actionError}</T> : null}
          </View>
        ) : null}

        {m.communityRatings.length ? (
          <View style={styles.ratings}>
            {m.communityRatings.map((r) => (
              <View key={r.source} style={styles.rating}>
                {/* Scores arrive on three scales. 100 and 10 read on their own; a
                    bare "4.6" does not, so anything else says what it is out of. */}
                <T variant="title">
                  {r.outOf === 100 ? Math.round(r.score) : r.score.toFixed(1)}
                  {r.outOf !== 100 && r.outOf !== 10 ? ` / ${r.outOf}` : ''}
                </T>
                <T variant="meta">
                  {r.label}
                  {r.votes ? ` · ${compactCount(r.votes)}` : ''}
                </T>
              </View>
            ))}
          </View>
        ) : null}

        {m.tagline ? <T variant="serifSm" style={styles.tagline}>{m.tagline}</T> : null}
        {m.description ? <T variant="body" style={styles.block}>{m.description}</T> : null}

        <View style={styles.facts}>
          <Fact label={item.type === 'game' ? 'Made by' : item.type === 'show' ? 'Created by' : 'Directed by'} value={made} />
          <Fact label="Network" value={m.network} />
          <Fact label="Status" value={m.status} />
          <Fact
            label="Seasons"
            value={m.seasonCount ? `${m.seasonCount}${m.episodeCount ? ` · ${m.episodeCount} episodes` : ''}` : null}
          />
          <Fact label="Platforms" value={m.platforms.length ? m.platforms.join(', ') : null} />
        </View>

        {m.streamingProviders.length ? (
          <Section title={`Where to watch · ${item.region}`}>
            <T variant="body">{m.streamingProviders.map((p) => p.name).join(', ')}</T>
          </Section>
        ) : null}

        {m.cast?.length ? (
          <Section title="Cast">
            {m.cast.slice(0, 8).map((c) => (
              <View key={`${c.name}:${c.character ?? ''}`} style={styles.castRow}>
                <T variant="body" style={{ flexShrink: 1 }}>{c.name}</T>
                {c.character ? <T variant="caption" numberOfLines={1} style={styles.castRole}>{c.character}</T> : null}
              </View>
            ))}
          </Section>
        ) : null}

        {m.tags.length ? (
          <Section title="Tags">
            <View style={styles.tags}>
              {m.tags.slice(0, 14).map((t) => (
                <View key={t} style={styles.tag}>
                  <T variant="caption">{t}</T>
                </View>
              ))}
            </View>
          </Section>
        ) : null}

        {m.storeLinks.length ? (
          <Section title="Links">
            <View style={styles.tags}>
              {m.storeLinks.slice(0, 10).map((l) => (
                <Pressable
                  key={`${l.name}:${l.url}`}
                  onPress={() => void Linking.openURL(l.url)}
                  accessibilityRole="link"
                  accessibilityLabel={`Open ${l.name}`}
                  style={({ pressed }) => [styles.link, pressed && { opacity: 0.6 }]}>
                  <T variant="label">{l.name}</T>
                </Pressable>
              ))}
            </View>
          </Section>
        ) : null}

        <T variant="meta" style={styles.sourceLine}>
          Data from {[...new Set(m.dates.map((d) => d.source.toUpperCase()))].join(', ') || item.vector.sources.map((s) => s.source.toUpperCase()).join(', ')}
        </T>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: space.section },
  backdrop: { width: '100%', aspectRatio: 16 / 9, backgroundColor: color.surfaceElevated },
  head: { flexDirection: 'row', gap: space.lg, padding: space.lg, alignItems: 'flex-end' },
  headBody: { flex: 1, minWidth: 0, gap: space.xs },
  mine: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: space.sm,
    marginHorizontal: space.lg, marginBottom: space.md, padding: space.md,
    borderRadius: radius.md, backgroundColor: color.accentSubtle,
  },
  actionsBlock: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.sm },
  // Ten across a 360 px screen: flex shares the row, the height is the tap target.
  stars: { flexDirection: 'row', gap: space.xs },
  star: {
    flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.sm, borderWidth: 1, borderColor: color.borderStrong,
  },
  starOn: { backgroundColor: color.accent, borderColor: color.accent },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  action: {
    paddingHorizontal: space.md, minHeight: 44, justifyContent: 'center',
    borderRadius: radius.md, borderWidth: 1, borderColor: color.borderStrong,
  },
  actionOn: { borderColor: color.accent },
  ratings: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.lg },
  rating: {
    paddingHorizontal: space.md, paddingVertical: space.sm, gap: space.xxs,
    borderRadius: radius.md, backgroundColor: color.surfaceElevated, borderWidth: 1, borderColor: color.border,
  },
  tagline: { paddingHorizontal: space.lg, paddingTop: space.lg, color: color.textSecondary },
  block: { paddingHorizontal: space.lg, paddingTop: space.md },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg, padding: space.lg },
  fact: { gap: space.xxs, minWidth: 130, maxWidth: '100%' },
  section: { paddingHorizontal: space.lg, paddingTop: space.lg, gap: space.sm },
  castRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.md },
  castRole: { flex: 1, minWidth: 0 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tag: {
    paddingHorizontal: space.md, paddingVertical: space.xs,
    borderRadius: radius.full, borderWidth: 1, borderColor: color.border,
  },
  link: {
    paddingHorizontal: space.md, minHeight: 44, justifyContent: 'center',
    borderRadius: radius.md, borderWidth: 1, borderColor: color.borderStrong,
  },
  sourceLine: { padding: space.lg, color: color.textMuted },
});
