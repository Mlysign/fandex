// Your library and wishlist, from the copy of your rows on this device. Those
// two read no network: they show what the last sync brought, which is what
// makes them open instantly and work offline. Up next is the exception: it asks
// Trakt what is next for the shows you are part way through (lib/upNext.ts).

import { useRouter } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Button, Chip, FandexBadge, Screen, ScreenTitle, StateBlock, T, TitleRow } from '~/components/ui';
import { useRowScores, useScores } from '~/lib/ScoreProvider';
import { useAuth } from '~/lib/AuthProvider';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import { longDate } from '~/lib/dates';
import { shelf, shelfCounts, type ShelfRow, type ShelfSort } from '~/lib/db';
import { TraktAuthError } from '~/lib/trakt';
import { markEpisodeWatched, refreshUpNext, upNextList, upNextPending, type UpNextEntry } from '~/lib/upNext';
import { color, radius, space } from '~/theme';

type Relation = 'library' | 'wishlist';
type Tab = 'upnext' | Relation;

/** Passes of the Up next refresh one visit may run. Each asks Trakt about a dozen shows. */
const MAX_REFRESH_PASSES = 6;

const TYPES: { key: string | null; label: string }[] = [
  { key: null, label: 'All' },
  { key: 'game', label: 'Games' },
  { key: 'movie', label: 'Films' },
  { key: 'show', label: 'Shows' },
];
const SORTS: { key: ShelfSort; label: string }[] = [
  { key: 'added', label: 'Recent' },
  { key: 'rating', label: 'Your rating' },
  { key: 'title', label: 'A to Z' },
];

const PAGE = 60;

export default function LibraryScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const auth = useAuth();
  const catalog = useCatalogSync();

  const [tab, setTab] = useState<Tab>('library');
  const relation: Relation = tab === 'wishlist' ? 'wishlist' : 'library';
  const [type, setType] = useState<string | null>(null);
  const [sort, setSort] = useState<ShelfSort>('added');
  const [rows, setRows] = useState<ShelfRow[]>([]);
  const [counts, setCounts] = useState({ library: 0, wishlist: 0, missing: 0 });
  const [ready, setReady] = useState(false);
  const exhausted = useRef(false);
  const loadingMore = useRef(false);

  // Re-query when the filters change, when your rows change, and when the
  // catalog copy changes (a title you hold may have just arrived in it).
  useEffect(() => {
    let live = true;
    exhausted.current = false;
    void Promise.all([shelf(db, relation, type, sort, PAGE, 0), shelfCounts(db)]).then(([first, c]) => {
      if (!live) return;
      setRows(first);
      setCounts(c);
      setReady(true);
      exhausted.current = first.length < PAGE;
    });
    return () => { live = false; };
  }, [db, relation, type, sort, auth.rowsRevision, catalog.revision]);

  const more = useCallback(async () => {
    if (exhausted.current || loadingMore.current) return;
    loadingMore.current = true;
    try {
      const next = await shelf(db, relation, type, sort, PAGE, rows.length);
      exhausted.current = next.length < PAGE;
      if (next.length) setRows((cur) => [...cur, ...next]);
    } finally {
      loadingMore.current = false;
    }
  }, [db, relation, type, sort, rows.length]);

  // A wishlist is titles you have not rated, so what goes on the right is how
  // well each one matches your taste. The library shows your own rating there.
  const scores = useScores();
  const rowScores = useRowScores(tab === 'wishlist' ? rows.map((r) => r.id) : []);

  // An auth gate must ASK. A signed-out visitor sees what this tab is for and
  // the way in, never an empty list that reads as "you have nothing".
  if (auth.status === 'signedOut') {
    return (
      <Screen>
        <ScreenTitle title="Library" />
        <StateBlock
          title="Sign in to see your library"
          detail="Your watched and played titles, your ratings and your wishlist live in your Fandex account."
          action={{ label: 'Sign in', onPress: () => router.push('/you') }}
        />
      </Screen>
    );
  }

  const total = relation === 'library' ? counts.library : counts.wishlist;
  const tabs = (
    <View style={styles.chips}>
      <Chip label="Up next" selected={tab === 'upnext'} onPress={() => setTab('upnext')} />
      <Chip label="Library" selected={tab === 'library'} onPress={() => setTab('library')} />
      <Chip label="Wishlist" selected={tab === 'wishlist'} onPress={() => setTab('wishlist')} />
    </View>
  );

  if (tab === 'upnext') {
    return (
      <Screen>
        <ScreenTitle eyebrow="Shows you are part way through" title="Up next" />
        {tabs}
        <UpNext />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenTitle
        eyebrow={`${total.toLocaleString('en')} ${total === 1 ? 'title' : 'titles'}`}
        title={relation === 'library' ? 'Library' : 'Wishlist'}
      />

      {tabs}
      <View style={styles.chips}>
        {TYPES.map((t) => (
          <Chip key={t.label} label={t.label} selected={type === t.key} onPress={() => setType(t.key)} />
        ))}
      </View>
      <View style={styles.chips}>
        {SORTS.filter((s) => relation === 'library' || s.key !== 'rating').map((s) => (
          <Chip key={s.key} label={s.label} selected={sort === s.key} onPress={() => setSort(s.key)} />
        ))}
      </View>

      {auth.rowsError ? <T variant="caption" style={styles.banner}>{auth.rowsError}</T> : null}
      {/* Your rows name titles the catalog copy has not caught up with yet. Say
          so, or the count above and the list below disagree with no reason given. */}
      {counts.missing > 0 ? (
        <T variant="caption" style={styles.note}>
          {counts.missing.toLocaleString('en')} of your titles are still downloading.
        </T>
      ) : null}

      {!ready || auth.status === 'loading' ? (
        <StateBlock loading />
      ) : rows.length === 0 ? (
        auth.rowsSyncing ? (
          <StateBlock loading title="Fetching your library" />
        ) : total === 0 && !type ? (
          <StateBlock
            title={relation === 'library' ? 'Nothing in your library yet' : 'Nothing on your wishlist yet'}
            detail="Titles you track will appear here."
            action={{ label: 'Check again', onPress: auth.syncRows }}
          />
        ) : (
          <StateBlock title="Nothing here" detail="No titles of this kind. Try another type." />
        )
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          onEndReached={() => void more()}
          onEndReachedThreshold={0.6}
          renderItem={({ item }) => (
            <TitleRow
              title={item.title}
              kind={item.type}
              posterUrl={item.poster_url}
              meta={
                relation === 'wishlist'
                  ? longDate(item.release_date) ?? (item.year ? String(item.year) : null)
                  : item.year ? String(item.year) : null
              }
              right={
                relation === 'wishlist'
                  ? (rowScores.has(item.id) ? <FandexBadge score={rowScores.get(item.id)!} center={scores.center} /> : null)
                  : item.rating != null ? <T variant="title" style={styles.rating}>{item.rating}</T> : null
              }
              onPress={() => router.push(`/item/${item.id}`)}
            />
          )}
          ListFooterComponent={<View style={styles.footer}><Button label="Refresh" onPress={auth.syncRows} quiet /></View>}
        />
      )}
    </Screen>
  );
}

function UpNext() {
  const router = useRouter();
  const db = useSQLiteContext();
  const auth = useAuth();
  const catalog = useCatalogSync();
  const [entries, setEntries] = useState<UpNextEntry[] | null>(null);
  const [pending, setPending] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState<string | null>(null);

  const show = useCallback(async () => {
    const [list, waiting] = await Promise.all([upNextList(db), upNextPending(db)]);
    setEntries(list);
    setPending(waiting);
  }, [db]);

  // Show what is stored at once, then ask Trakt about the shows that are due,
  // a few at a time, repainting as each pass lands.
  useEffect(() => {
    let live = true;
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
  }, [db, show, auth.rowsRevision, catalog.revision]);

  const mark = useCallback(async (entry: UpNextEntry) => {
    setMarking(entry.mediaItemId);
    setError(null);
    try {
      await markEpisodeWatched(db, entry);
      await show();
    } catch (e) {
      setError(describeTrakt(e));
    } finally {
      setMarking(null);
    }
  }, [db, show]);

  if (entries === null) return <StateBlock loading />;

  if (!entries.length) {
    // Empty has three causes and they must not look the same: still asking,
    // could not ask, and nothing to watch.
    return refreshing ? (
      <StateBlock loading title="Asking Trakt what is next" />
    ) : error ? (
      <StateBlock title="Could not reach Trakt" detail={error} />
    ) : (
      <StateBlock title="You are caught up" detail="A show appears here when it has an episode out that you have not watched." />
    );
  }

  const status = error ?? (refreshing && pending > 0 ? 'Asking Trakt what is next…' : null);
  return (
    <>
      {status ? <T variant="caption" style={error ? styles.banner : styles.note}>{status}</T> : null}
      <FlatList
        data={entries}
        keyExtractor={(e) => e.mediaItemId}
        renderItem={({ item }) => (
          <TitleRow
            title={item.title}
            kind="show"
            posterUrl={item.posterUrl}
            meta={`S${item.season} E${item.episode}${item.episodeTitle ? ` · ${item.episodeTitle}` : ''}`}
            onPress={() => router.push(`/item/${item.mediaItemId}`)}
            right={
              <Pressable
                onPress={() => void mark(item)}
                disabled={marking !== null}
                accessibilityRole="button"
                accessibilityLabel={`Mark ${item.title} season ${item.season} episode ${item.episode} as watched`}
                style={({ pressed }) => [styles.tick, (pressed || marking !== null) && { opacity: 0.5 }]}>
                {marking === item.mediaItemId
                  ? <ActivityIndicator size="small" color={color.accent} />
                  : <Check color={color.accent} size={20} />}
              </Pressable>
            }
          />
        )}
      />
    </>
  );
}

function describeTrakt(e: unknown): string {
  if (e instanceof TraktAuthError) return 'Trakt needs you to sign in again. You can do that on the You tab.';
  if (e instanceof Error && /Network request failed/i.test(e.message)) return 'No connection. Showing what this device already knows.';
  return e instanceof Error ? e.message : 'Trakt did not answer.';
}

const styles = StyleSheet.create({
  tick: {
    width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.full, borderWidth: 1, borderColor: color.borderStrong,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm },
  banner: { paddingHorizontal: space.lg, paddingBottom: space.sm, color: color.warning },
  note: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  rating: { color: color.accent, minWidth: 28, textAlign: 'right' },
  footer: { padding: space.lg, alignItems: 'flex-start' },
});
