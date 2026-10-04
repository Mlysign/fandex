// Your library and wishlist, from the copy of your rows on this device.
// Reads no network: it shows what the last sync brought, which is what makes it
// open instantly and work offline.

import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Button, Chip, Screen, ScreenTitle, StateBlock, T, TitleRow } from '~/components/ui';
import { useAuth } from '~/lib/AuthProvider';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import { longDate } from '~/lib/dates';
import { shelf, shelfCounts, type ShelfRow, type ShelfSort } from '~/lib/db';
import { color, space } from '~/theme';

type Relation = 'library' | 'wishlist';

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

  const [relation, setRelation] = useState<Relation>('library');
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

  return (
    <Screen>
      <ScreenTitle
        eyebrow={`${total.toLocaleString('en')} ${total === 1 ? 'title' : 'titles'}`}
        title={relation === 'library' ? 'Library' : 'Wishlist'}
      />

      <View style={styles.chips}>
        <Chip label="Library" selected={relation === 'library'} onPress={() => setRelation('library')} />
        <Chip label="Wishlist" selected={relation === 'wishlist'} onPress={() => setRelation('wishlist')} />
      </View>
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
              right={item.rating != null ? <T variant="title" style={styles.rating}>{item.rating}</T> : null}
              onPress={() => router.push(`/item/${item.id}`)}
            />
          )}
          ListFooterComponent={<View style={styles.footer}><Button label="Refresh" onPress={auth.syncRows} quiet /></View>}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm },
  banner: { paddingHorizontal: space.lg, paddingBottom: space.sm, color: color.warning },
  note: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  rating: { color: color.accent, minWidth: 28, textAlign: 'right' },
  footer: { padding: space.lg, alignItems: 'flex-start' },
});
