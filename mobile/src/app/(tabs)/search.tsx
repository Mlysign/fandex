// Search. Three sources, each answering at its own speed:
//
//   on this device   the catalog copy, instant, works offline
//   films and shows  TMDB, called straight from the device
//   games            IGDB, through the Worker (its credentials cannot ship)
//
// The device's answer never stands in for the providers'. A title is a prefix
// of its own sequels: an exact local match on "Blade Runner" would hide "2049"
// if the search stopped there. So all three always run.

import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Search as SearchIcon } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { normalizeName } from '@/lib/normalize';
import { Screen, ScreenTitle, StateBlock, T, TitleRow } from '~/components/ui';
import { api } from '~/lib/api';
import { tmdbConfigured } from '~/lib/config';
import { compactCount } from '~/lib/dates';
import { searchCatalog, type CatalogRow } from '~/lib/db';
import { searchTmdb, type ProviderCard } from '~/lib/tmdb';
import { color, font, radius, space } from '~/theme';

type Remote<T> = { state: 'idle' | 'loading' | 'done' | 'error'; rows: T[]; error?: string };
const idle = <T,>(): Remote<T> => ({ state: 'idle', rows: [] });

const DEBOUNCE_MS = 300;

export default function SearchScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const [text, setText] = useState('');
  const [local, setLocal] = useState<CatalogRow[]>([]);
  const [screen, setScreen] = useState<Remote<ProviderCard>>(idle);
  const [games, setGames] = useState<Remote<ProviderCard>>(idle);

  const term = text.trim();

  // The device answers on every keystroke. It is a local query.
  useEffect(() => {
    let live = true;
    void searchCatalog(db, normalizeName(term)).then((rows) => { if (live) setLocal(rows); });
    return () => { live = false; };
  }, [db, term]);

  // The providers wait for a pause in typing.
  useEffect(() => {
    if (term.length < 2) {
      setScreen(idle());
      setGames(idle());
      return;
    }
    const abort = new AbortController();
    let live = true;
    const timer = setTimeout(() => {
      setScreen({ state: 'loading', rows: [] });
      setGames({ state: 'loading', rows: [] });

      searchTmdb(term, abort.signal)
        .then((rows) => { if (live) setScreen({ state: 'done', rows }); })
        .catch((e) => { if (live && e?.name !== 'AbortError') setScreen({ state: 'error', rows: [], error: 'Film and show search is not answering.' }); });

      api.searchGames(term)
        .then((res) => {
          if (!live) return;
          const rows = res.results
            .map((g): ProviderCard => ({ source: 'igdb', sourceId: g.sourceId, type: 'game', title: g.title, releaseDate: g.releaseDate, posterUrl: g.posterUrl, votes: g.votes }))
            .sort((a, b) => b.votes - a.votes);
          setGames({ state: 'done', rows });
        })
        .catch(() => { if (live) setGames({ state: 'error', rows: [], error: 'Game search is not answering.' }); });
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
      abort.abort();
    };
  }, [term]);

  // A title already on the device is shown once, under "On this device".
  const held = useMemo(() => new Set(local.map((r) => `${r.type}|${normalizeName(r.title)}|${r.year ?? ''}`)), [local]);
  const fresh = (rows: ProviderCard[]) =>
    rows.filter((r) => !held.has(`${r.type}|${normalizeName(r.title)}|${r.releaseDate?.slice(0, 4) ?? ''}`));

  const providerSection = (title: string, remote: Remote<ProviderCard>, unavailable?: string) => {
    if (unavailable) {
      return (
        <View style={styles.section}>
          <T variant="eyebrow" style={styles.sectionTitle}>{title}</T>
          <T variant="caption" style={styles.note}>{unavailable}</T>
        </View>
      );
    }
    if (remote.state === 'idle') return null;
    const rows = fresh(remote.rows);
    return (
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <T variant="eyebrow">{title}</T>
          {remote.state === 'loading' ? <ActivityIndicator size="small" color={color.accent} /> : null}
        </View>
        {remote.state === 'error' ? <T variant="caption" style={styles.note}>{remote.error}</T> : null}
        {remote.state === 'done' && rows.length === 0 ? <T variant="caption" style={styles.note}>Nothing more found.</T> : null}
        {rows.slice(0, 12).map((r) => (
          <TitleRow
            key={`${r.source}:${r.type}:${r.sourceId}`}
            title={r.title}
            kind={r.type}
            posterUrl={r.posterUrl}
            meta={r.releaseDate?.slice(0, 4) ?? null}
            onPress={() => router.push(`/open/${r.source}/${r.type}/${r.sourceId}`)}
          />
        ))}
      </View>
    );
  };

  return (
    <Screen>
      <ScreenTitle title="Search" />
      <View style={styles.inputWrap}>
        <SearchIcon color={color.textMuted} size={18} />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="A game, film or show"
          placeholderTextColor={color.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search titles"
          style={styles.input}
        />
      </View>

      {term.length === 0 ? (
        <StateBlock title="Find a title" detail="Search the catalog on this device, and the film, show and game databases behind it." />
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.results}>
          {local.length ? (
            <View style={styles.section}>
              <T variant="eyebrow" style={styles.sectionTitle}>On this device</T>
              {local.map((r) => (
                <TitleRow
                  key={r.id}
                  title={r.title}
                  kind={r.type}
                  posterUrl={r.poster_url}
                  meta={[r.year, r.community_votes ? `${compactCount(r.community_votes)} votes` : null].filter(Boolean).join(' · ') || null}
                  onPress={() => router.push(`/item/${r.id}`)}
                />
              ))}
            </View>
          ) : null}

          {term.length < 2 ? (
            <T variant="caption" style={styles.note}>Type one more letter to search the databases.</T>
          ) : (
            <>
              {providerSection('Films and shows', screen, tmdbConfigured() ? undefined : 'Film and show search is not set up in this build.')}
              {providerSection('Games', games)}
            </>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    marginHorizontal: space.lg, marginBottom: space.sm, paddingHorizontal: space.md, minHeight: 46,
    borderRadius: radius.md, borderWidth: 1, borderColor: color.borderStrong, backgroundColor: color.surfaceInset,
  },
  // outlineWidth 0: on the web the browser draws its own focus ring INSIDE the
  // bordered wrap, which reads as a second box. The wrap is the field's edge.
  input: { flex: 1, minWidth: 0, color: color.textPrimary, fontFamily: font.sans, fontSize: 15, paddingVertical: space.sm, outlineWidth: 0 },
  results: { paddingBottom: space.section },
  section: { paddingTop: space.md },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.xs },
  sectionTitle: { paddingHorizontal: space.lg, paddingBottom: space.xs },
  note: { paddingHorizontal: space.lg, paddingVertical: space.sm },
});
