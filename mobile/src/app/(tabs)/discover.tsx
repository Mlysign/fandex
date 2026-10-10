// Search. The site's Discover page (src/app/discover/DiscoverPageClient.tsx):
// one field, one grid, one sort. Typing searches the catalog on the device at
// once and the film, show and game databases a moment later, and both land in
// the same grid under the chosen sort.
//
// With nothing typed the grid is the catalog on this device. The site showed a
// provider-fed feed of new and upcoming titles there, which needs a Worker
// route that does not exist yet (docs/app-parity.md). Also not carried over:
// people and tag results.

import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { normalizeName } from '@/lib/normalize';
import { PosterGrid, type CardSection } from '~/components/cards';
import { countActive, FilterSheet, FiltersButton, noFilters, useFiltered } from '~/components/Filters';
import { EmptyState } from '~/components/kit';
import { SubBar } from '~/components/SubBar';
import { Screen, StateBlock } from '~/components/ui';
import { api } from '~/lib/api';
import { useAuth } from '~/lib/AuthProvider';
import { cardFromCatalog, useCardStates, type CardItem } from '~/lib/cards';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import { tmdbConfigured } from '~/lib/config';
import { currentMonth, monthLabel } from '~/lib/dates';
import { catalogCards } from '~/lib/db';
import { useRowScores, useScores } from '~/lib/ScoreProvider';
import { searchTmdb, type ProviderCard } from '~/lib/tmdb';
import { useTypeFilter } from '~/lib/typeFilter';
import { color, type } from '~/theme';

// src/components/discovery/types.ts, SORTS.
type Sort = 'releaseDate' | 'popularity' | 'rating' | 'fandexScore';
const SORTS: [Sort, string][] = [['releaseDate', 'Release date'], ['popularity', 'Popularity'], ['rating', 'Rating'], ['fandexScore', 'Fandex Score']];

const DEBOUNCE_MS = 300;
/** How many cards are drawn at first, and how many more each time the end is reached. */
const STEP = 60;

type Remote = { state: 'idle' | 'loading' | 'done' | 'error'; rows: CardItem[] };
const IDLE: Remote = { state: 'idle', rows: [] };

const fromProvider = (r: ProviderCard): CardItem => ({
  key: `${r.source}:${r.type}:${r.sourceId}`, id: null, source: r.source, sourceId: r.sourceId, type: r.type, title: r.title,
  releaseDate: r.releaseDate, posterUrl: r.posterUrl, communityScore: null, communityVotes: r.votes,
});
/** Two cards are the same title when type, name and year agree. The year matters: a remake shares the name. */
const identity = (c: CardItem) => `${c.type}|${normalizeName(c.title)}|${c.releaseDate?.slice(0, 4) ?? ''}`;

export default function DiscoverScreen() {
  const db = useSQLiteContext();
  const sync = useCatalogSync();
  const types = useTypeFilter();
  const { center } = useScores();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('popularity');
  const [pool, setPool] = useState<CardItem[] | null>(null);
  const [screen, setScreen] = useState<Remote>(IDLE);
  const [games, setGames] = useState<Remote>(IDLE);
  const [shown, setShown] = useState(STEP);
  const auth = useAuth();
  const [filters, setFilters] = useState(noFilters);
  const [sheet, setSheet] = useState(false);

  useEffect(() => {
    let live = true;
    void catalogCards(db).then((rows) => { if (live) setPool(rows.map(cardFromCatalog)); });
    return () => { live = false; };
  }, [db, sync.revision]);

  const term = query.trim();
  useEffect(() => {
    if (term.length < 2) {
      setScreen(IDLE);
      setGames(IDLE);
      return;
    }
    const abort = new AbortController();
    let live = true;
    const timer = setTimeout(() => {
      setScreen({ state: 'loading', rows: [] });
      setGames({ state: 'loading', rows: [] });
      // Each source answers on its own: one of them being down must not empty the other.
      searchTmdb(term, abort.signal)
        .then((rows) => { if (live) setScreen({ state: 'done', rows: rows.map(fromProvider) }); })
        .catch((e) => { if (live && e?.name !== 'AbortError') setScreen({ state: 'error', rows: [] }); });
      api.searchGames(term)
        .then((res) => { if (live) setGames({ state: 'done', rows: res.results.map((g) => fromProvider({ ...g, votes: g.votes })) }); })
        .catch(() => { if (live) setGames({ state: 'error', rows: [] }); });
    }, DEBOUNCE_MS);
    return () => { live = false; clearTimeout(timer); abort.abort(); };
  }, [term]);

  const norm = normalizeName(term);
  const matches = useMemo(() => {
    const local = (pool ?? []).filter((c) => !norm || normalizeName(c.title).includes(norm));
    if (!norm) return local;
    // What the catalog holds wins over the same title from a provider: it has your state and score.
    const held = new Set(local.map(identity));
    const fresh = [...screen.rows, ...games.rows].filter((c) => !held.has(identity(c)));
    return [...local, ...fresh];
  }, [pool, norm, screen.rows, games.rows]);

  const typed = useMemo(() => matches.filter((c) => types.isVisible(c.type)), [matches, types]);
  // Your state for every title is only read while a "your lists" filter is on.
  const listed = Object.values(filters.membership).some(Boolean);
  const stateOf = useCardStates(useMemo(() => (listed ? typed.map((c) => c.id) : []), [listed, typed]));
  const visible = useFiltered(typed, filters, stateOf);
  const allScores = useRowScores(useMemo(
    () => (sort === 'fandexScore' ? visible.map((c) => c.id).filter((id): id is string => !!id) : []), [sort, visible],
  ));

  const sorted = useMemo(() => {
    const list = [...visible];
    const votes = (c: CardItem) => c.communityVotes ?? 0;
    switch (sort) {
      case 'popularity': return list.sort((a, b) => votes(b) - votes(a));
      case 'rating': return list.sort((a, b) => (b.communityScore ?? -1) - (a.communityScore ?? -1) || votes(b) - votes(a));
      case 'fandexScore': return list.sort((a, b) => ((b.id ? allScores.get(b.id) : null) ?? -1) - ((a.id ? allScores.get(a.id) : null) ?? -1));
      case 'releaseDate': return list.sort((a, b) => ((b.releaseDate ?? '') < (a.releaseDate ?? '') ? -1 : 1));
    }
  }, [visible, sort, allScores]);

  // A new question starts at the top of its own answer.
  useEffect(() => setShown(STEP), [norm, sort, types.shown.join(','), filters]);
  const page = useMemo(() => sorted.slice(0, shown), [sorted, shown]);
  const more = useCallback(() => setShown((n) => (n < sorted.length ? n + STEP : n)), [sorted.length]);

  const sections = useMemo<CardSection[] | undefined>(() => {
    if (sort !== 'releaseDate') return undefined;
    const now = currentMonth();
    const out: CardSection[] = [];
    for (const c of page) {
      const m = c.releaseDate?.slice(0, 7) ?? 'none';
      const last = out[out.length - 1];
      if (last?.key === m) last.items.push(c);
      else out.push({ key: m, label: m === 'none' ? 'No date yet' : monthLabel(m), past: m < now, current: m === now, items: [c] });
    }
    return out;
  }, [sort, page]);

  const searching = screen.state === 'loading' || games.state === 'loading';
  const notes = [
    norm && !tmdbConfigured() ? 'Film and show search is not set up in this build.' : null,
    screen.state === 'error' ? 'Film and show search is not answering.' : null,
    games.state === 'error' ? 'Game search is not answering.' : null,
    !norm && sync.state === 'syncing' && sync.written > 0 ? `Downloading the catalog… ${sync.total.toLocaleString('en')} so far` : null,
  ].filter(Boolean);

  const empty = pool === null ? <StateBlock loading />
    : searching ? <StateBlock loading title="Searching" />
    : norm ? <EmptyState title="Nothing found" hint={term.length < 2 ? 'Type one more letter to search the databases.' : 'No game, movie or show by that name.'} />
    : sync.state === 'syncing' ? <StateBlock loading title="Downloading the catalog" detail="This happens once. After that only changes are fetched." />
    : sync.state === 'error' ? <EmptyState title="The catalog is not on this device yet" hint={sync.error} />
    : <EmptyState title="Nothing here" hint="No titles of the types you are looking at." />;

  return (
    <Screen wide>
      <SubBar
        search={{ value: query, onChange: setQuery, placeholder: 'Search games, movies, shows…' }}
        count={pool ? { noun: 'titles', n: sorted.length } : null}
        sort={{ value: sort, options: center == null ? SORTS.filter(([k]) => k !== 'fandexScore') : SORTS, onChange: setSort }}
        trailing={<FiltersButton active={countActive(filters)} onPress={() => setSheet(true)} />}
      />
      <PosterGrid
        items={sections ? undefined : page}
        sections={sections}
        empty={empty}
        onEndReached={more}
        header={notes.length ? (
          <View style={{ gap: 4, marginBottom: 12 }}>
            {notes.map((n) => <Text key={n} style={[type.caption, { color: color.textSecondary }]}>{n}</Text>)}
          </View>
        ) : null}
      />
      <FilterSheet
        open={sheet} onClose={() => setSheet(false)} filters={filters} onChange={setFilters}
        resultCount={sorted.length} noun="titles" signedIn={auth.status === 'signedIn'}
      />
    </Screen>
  );
}
