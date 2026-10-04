// Browse the catalog copy on this device, most-voted first. No network: this
// screen works on a plane once the first sync has run.

import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Chip, Screen, ScreenTitle, StateBlock, T, TitleRow } from '~/components/ui';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import { compactCount } from '~/lib/dates';
import { browseCatalog, type CatalogRow } from '~/lib/db';
import { color, space } from '~/theme';

const TYPES: { key: string | null; label: string }[] = [
  { key: null, label: 'All' },
  { key: 'game', label: 'Games' },
  { key: 'movie', label: 'Films' },
  { key: 'show', label: 'Shows' },
];

const PAGE = 60;

export default function BrowseScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const sync = useCatalogSync();
  const [type, setType] = useState<string | null>(null);
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [ready, setReady] = useState(false);
  const exhausted = useRef(false);
  const loadingMore = useRef(false);

  // First page: on a type change, and again whenever a sync writes rows, so the
  // list fills in while the first download is still running.
  useEffect(() => {
    let live = true;
    exhausted.current = false;
    void browseCatalog(db, type, PAGE, 0).then((first) => {
      if (!live) return;
      setRows(first);
      setReady(true);
      exhausted.current = first.length < PAGE;
    });
    return () => { live = false; };
  }, [db, type, sync.revision]);

  const more = useCallback(async () => {
    if (exhausted.current || loadingMore.current) return;
    loadingMore.current = true;
    try {
      const next = await browseCatalog(db, type, PAGE, rows.length);
      exhausted.current = next.length < PAGE;
      if (next.length) setRows((cur) => [...cur, ...next]);
    } finally {
      loadingMore.current = false;
    }
  }, [db, type, rows.length]);

  const syncing = sync.state === 'syncing';

  return (
    <Screen>
      <ScreenTitle eyebrow={`${sync.total.toLocaleString('en')} titles on this device`} title="Browse" />
      <View style={styles.chips}>
        {TYPES.map((t) => (
          <Chip key={t.label} label={t.label} selected={type === t.key} onPress={() => setType(t.key)} />
        ))}
      </View>

      {syncing && sync.written > 0 ? (
        <T variant="caption" style={styles.banner}>Downloading the catalog… {sync.total.toLocaleString('en')} so far</T>
      ) : null}

      {!ready ? (
        <StateBlock loading />
      ) : rows.length === 0 ? (
        syncing ? (
          <StateBlock loading title="Downloading the catalog" detail="This happens once. After that only changes are fetched." />
        ) : sync.state === 'error' ? (
          <StateBlock title="The catalog is not on this device yet" detail={sync.error} action={{ label: 'Try again', onPress: sync.sync }} />
        ) : (
          <StateBlock title="Nothing here" detail="No titles of this kind are in the catalog." />
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
              meta={[item.year, item.community_votes ? `${compactCount(item.community_votes)} votes` : null].filter(Boolean).join(' · ') || null}
              right={item.community_score != null ? <T variant="title" style={styles.score}>{item.community_score}</T> : null}
              onPress={() => router.push(`/item/${item.id}`)}
            />
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.md },
  banner: { paddingHorizontal: space.lg, paddingBottom: space.sm, color: color.accent },
  score: { color: color.textSecondary, minWidth: 28, textAlign: 'right' },
});
