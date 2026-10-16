// Search. The site's Discover page (src/app/discover/DiscoverPageClient.tsx):
// one field, one grid, one sort. Typing searches the catalog on the device at
// once and the film, show and game databases a moment later, and both land in
// the same grid under the chosen sort.
//
// With nothing typed the grid is the catalog on this device, and below it the
// site's provider-fed feed of upcoming titles: films and shows from TMDB, asked
// from the device, and games from the Worker (/v1/browse/games), a page of each
// at a time as the list reaches its end. Typing also shows the people and
// tags in the catalog whose names match, above the titles, as the site did.

import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { keyToSlug } from '@/lib/facetUrl';
import { normalizeName, searchKey } from '@/lib/normalize';
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
import { usePageTitle } from '~/lib/pageTitle';
import { catalogCards } from '~/lib/db';
import { useHiddenIds, withoutHidden } from '~/lib/hidden';
import { byPopularity, byRating } from '~/lib/sortCards';
import { useRowScores, useScores } from '~/lib/ScoreProvider';
import { searchTmdb, tmdbUpcoming, type ProviderCard } from '~/lib/tmdb';
import { useTypeFilter } from '~/lib/typeFilter';
import { facetVocab, matchVocab, type VocabEntry } from '~/lib/facetVocab';
import { spokenKey } from '~/lib/facetImpact';
import { color, radius, type } from '~/theme';

// src/components/discovery/types.ts, SORTS.
type Sort = 'releaseDate' | 'popularity' | 'rating' | 'fandexScore';
const SORTS: [Sort, string][] = [['releaseDate', 'Release date'], ['popularity', 'Popularity'], ['rating', 'Rating'], ['fandexScore', 'Fandex Score']];

const DEBOUNCE_MS = 300;
const QUERY_KEY = 'fandex.search.q';
/** How many cards are drawn at first, and how many more each time the end is reached. */
const STEP = 60;

type Remote = { state: 'idle' | 'loading' | 'done' | 'error'; rows: CardItem[] };
/** The upcoming feed: pages loaded so far, and whether there is more. */
type Feed = { rows: CardItem[]; page: number; done: boolean; loading: boolean; failed: boolean };
const FEED_START: Feed = { rows: [], page: 0, done: false, loading: false, failed: false };
/** Pages of each source the feed goes to. The Worker serves ten of games. */
const FEED_PAGES = 5;
const IDLE: Remote = { state: 'idle', rows: [] };

const fromProvider = (r: ProviderCard): CardItem => ({
  key: `${r.source}:${r.type}:${r.sourceId}`, id: null, source: r.source, sourceId: r.sourceId, type: r.type, title: r.title,
  releaseDate: r.releaseDate, posterUrl: r.posterUrl, communityScore: null, communityVotes: r.votes,
});
/** The site's FacetMatchGroup: an eyebrow and a row of chips, each a link to its page. */
function MatchGroup({ title, matches }: { title: string; matches: VocabEntry[] }) {
  const router = useRouter();
  if (!matches.length) return null;
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={[type.eyebrow, { color: color.textSecondary, marginBottom: 8 }]}>{title}</Text>
      <View style={styles.chips}>
        {matches.map((m) => {
          const href = m.kind === 'person' ? `/person/${keyToSlug(m.key)}` : `/tag/${keyToSlug(spokenKey(m.key))}`;
          return (
            <Pressable
              key={`${m.kind}|${m.key}`}
              {...(Platform.OS === 'web' ? ({ href } as object) : null)}
              onPress={(e) => { (e as unknown as { preventDefault?: () => void })?.preventDefault?.(); router.push(href as never); }}
              accessibilityRole="link"
              style={(state: { pressed: boolean; hovered?: boolean }) => [styles.chip, state.hovered && { borderColor: color.borderStrong }]}>
              <Text style={[type.label, { color: color.textPrimary }]}>{m.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const crowdOf = (c: CardItem) => ({ type: c.type, score: c.communityScore, votes: c.communityVotes ?? 0 });
/** Two cards are the same title when type, name and year agree. The year matters: a remake shares the name. */
const identity = (c: CardItem) => `${c.type}|${normalizeName(c.title)}|${c.releaseDate?.slice(0, 4) ?? ''}`;

export default function DiscoverScreen() {
  usePageTitle('Search');
  const db = useSQLiteContext();
  const sync = useCatalogSync();
  const types = useTypeFilter();
  const { center } = useScores();
  // Kept for the browser tab, as the site kept it (rr_discover_q): Back already
  // returns to the mounted screen with its query and scroll, and this covers a
  // reload.
  const [query, setQuery] = useState(() => {
    try { return Platform.OS === 'web' ? globalThis.sessionStorage?.getItem(QUERY_KEY) ?? '' : ''; } catch { return ''; }
  });
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    try { globalThis.sessionStorage?.setItem(QUERY_KEY, query); } catch { /* storage refused: nothing kept */ }
  }, [query]);
  const [sort, setSort] = useState<Sort>('popularity');
  const [pool, setPool] = useState<CardItem[] | null>(null);
  const [screen, setScreen] = useState<Remote>(IDLE);
  const [games, setGames] = useState<Remote>(IDLE);
  const [shown, setShown] = useState(STEP);
  const auth = useAuth();
  const router = useRouter();
  const [filters, setFilters] = useState(noFilters);
  const [sheet, setSheet] = useState(false);
  const [feed, setFeed] = useState<Feed>(FEED_START);
  const feedBusy = useRef(false);

  // One page of upcoming titles from each source. A source that fails is a
  // shorter page, never an empty feed: each answers on its own.
  const loadFeed = useCallback((page: number) => {
    if (feedBusy.current) return;
    feedBusy.current = true;
    setFeed((f) => ({ ...f, loading: true }));
    const settle = <T,>(p: Promise<T[]>) => p.then((v) => ({ ok: true, v }), () => ({ ok: false, v: [] as T[] }));
    void Promise.all([
      settle(tmdbUpcoming('movie', page, auth.region)),
      settle(tmdbUpcoming('show', page, auth.region)),
      settle(api.browseGames(page).then((r) => r.results)),
    ]).then((parts) => {
      const rows = parts.flatMap((part) => (part.v as ProviderCard[]).map(fromProvider));
      setFeed((f) => ({
        rows: [...f.rows, ...rows], page, loading: false,
        done: page >= FEED_PAGES || rows.length === 0,
        failed: parts.every((part) => !part.ok),
      }));
    }).finally(() => { feedBusy.current = false; });
  }, [auth.region]);
  // Another country has other dates: start the feed again.
  useEffect(() => setFeed(FEED_START), [auth.region]);

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

  // searchKey, not normalizeName: an accent must not stop "pokemon" finding Pokémon (SM78).
  const norm = searchKey(term);
  const hidden = useHiddenIds();
  // The catalog's people and tags, read once the first time somebody types.
  const [vocab, setVocab] = useState<VocabEntry[] | null>(null);
  useEffect(() => {
    if (norm.length < 2) return;
    let live = true;
    void facetVocab(db, sync.revision).then((v) => { if (live) setVocab(v); }, () => undefined);
    return () => { live = false; };
  }, [db, sync.revision, norm.length >= 2]);
  const vocabMatches = useMemo(() => (vocab ? matchVocab(vocab, norm) : { people: [], tags: [] }), [vocab, norm]);
  useEffect(() => { if (!norm && pool !== null && feed.page === 0 && !feed.loading) loadFeed(1); }, [norm, pool, feed.page, feed.loading, loadFeed]);
  // Each title's key once per pool, not once per keystroke.
  const keyed = useMemo(() => (pool ?? []).map((c) => ({ c, key: searchKey(c.title) })), [pool]);
  const matches = useMemo(() => {
    const local = norm ? keyed.filter((k) => k.key.includes(norm)).map((k) => k.c) : (pool ?? []);
    // With nothing typed this list chooses for you, so it leaves out what you
    // hid. A name still finds it: "It stays searchable" is what Hide promises.
    if (!norm) {
      // The catalog's copy of a title wins over the feed's: it has your state and score.
      const held = new Set(local.map(identity));
      const upcoming = feed.rows.filter((c) => (held.has(identity(c)) ? false : (held.add(identity(c)), true)));
      return withoutHidden([...local, ...upcoming], hidden);
    }
    // What the catalog holds wins over the same title from a provider: it has your state and score.
    const held = new Set(local.map(identity));
    const fresh = [...screen.rows, ...games.rows].filter((c) => !held.has(identity(c)));
    return [...local, ...fresh];
  }, [pool, keyed, norm, hidden, screen.rows, games.rows, feed.rows]);

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
    switch (sort) {
      // Browsing mixes the types by each title's rank among its own; a search keeps the raw count (lib/sortCards.ts).
      case 'popularity': return byPopularity(list, crowdOf, !norm);
      case 'rating': return byRating(list, crowdOf);
      case 'fandexScore': return list.sort((a, b) => ((b.id ? allScores.get(b.id) : null) ?? -1) - ((a.id ? allScores.get(a.id) : null) ?? -1));
      case 'releaseDate': return list.sort((a, b) => ((b.releaseDate ?? '') < (a.releaseDate ?? '') ? -1 : 1));
    }
  }, [visible, sort, allScores, norm]);

  // A new question starts at the top of its own answer.
  useEffect(() => setShown(STEP), [norm, sort, types.shown.join(','), filters]);
  const page = useMemo(() => sorted.slice(0, shown), [sorted, shown]);
  const more = useCallback(() => {
    if (shown < sorted.length) setShown((n) => n + STEP);
    else if (!norm && !feed.done && !feed.loading) loadFeed(feed.page + 1);
  }, [shown, sorted.length, norm, feed.done, feed.loading, feed.page, loadFeed]);

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
    !norm && feed.loading && feed.page > 0 ? 'Asking for more upcoming titles…' : null,
    !norm && feed.failed ? 'Upcoming titles from TMDB and IGDB are not answering. Showing the catalog on this device.' : null,
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
        header={notes.length || (norm && (vocabMatches.people.length || vocabMatches.tags.length)) ? (
          <View>
            {norm ? (
              <>
                <MatchGroup title="People" matches={vocabMatches.people} />
                <MatchGroup title="Tags" matches={vocabMatches.tags} />
                {vocabMatches.people.length || vocabMatches.tags.length
                  ? <Text style={[type.eyebrow, { color: color.textSecondary, marginBottom: 8 }]}>Titles</Text> : null}
              </>
            ) : null}
            {notes.length ? (
              <View style={{ gap: 4, marginBottom: 12 }}>
                {notes.map((n) => <Text key={n} style={[type.caption, { color: color.textSecondary }]}>{n}</Text>)}
              </View>
            ) : null}
          </View>
        ) : null}
      />
      <FilterSheet
        open={sheet} onClose={() => setSheet(false)} filters={filters} onChange={setFilters}
        resultCount={sorted.length} noun="titles" signedIn={auth.status === 'signedIn'}
        items={typed} onEditPlatforms={() => { setSheet(false); router.push('/settings' as never); }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1,
    borderColor: color.border, backgroundColor: color.surfaceElevated,
  },
});
