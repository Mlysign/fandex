// Wishlist, Progress and Library: one screen with three tabs, as on the site
// (src/components/MyStuffView.tsx). The shared header carries the type filter,
// the tabs, a search within the list, the count and the sort; under it a grid
// of poster cards, or the episode rows of the shows you are part way through.
//
// Everything here is on the device, so a search, a sort or a filter touches no network.

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Bookmark, CirclePlay, Library } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { normalizeName } from '@/lib/normalize';
import { PosterGrid, type CardSection } from '~/components/cards';
import { countActive, FilterSheet, FiltersButton, noFilters, useFiltered } from '~/components/Filters';
import { Button, EmptyState } from '~/components/kit';
import { SubBar, Tabs, type TabDef } from '~/components/SubBar';
import { Screen, StateBlock } from '~/components/ui';
import { EPISODE_ROW_GAP, EpisodeRow, useUpNext } from '~/components/UpNext';
import { useAuth } from '~/lib/AuthProvider';
import { cardFromCatalog, useCardStates, type CardItem } from '~/lib/cards';
import { useCatalogSync } from '~/lib/CatalogSyncProvider';
import { currentMonth, monthLabel } from '~/lib/dates';
import { shelf, shelfCounts, type ShelfRow } from '~/lib/db';
import { useRowScores } from '~/lib/ScoreProvider';
import { useTypeFilter } from '~/lib/typeFilter';
import { color, type } from '~/theme';

type Tab = 'wishlist' | 'progress' | 'library';
const TABS: TabDef<Tab>[] = [
  { key: 'wishlist', label: 'Wishlist', Icon: Bookmark },
  { key: 'progress', label: 'Progress', Icon: CirclePlay },
  { key: 'library', label: 'Library', Icon: Library },
];
const isTab = (v: unknown): v is Tab => v === 'wishlist' || v === 'progress' || v === 'library';

// The site's sort lists (src/components/discovery/types.ts), in its order and words.
type Sort = 'addedAt' | 'releaseDate' | 'popularity' | 'rating' | 'fandexScore';
const LIBRARY_SORTS: [Sort, string][] = [
  ['addedAt', 'Recently added'], ['releaseDate', 'Release date'], ['popularity', 'Popularity'], ['rating', 'Rating'], ['fandexScore', 'Fandex Score'],
];
type ProgressSort = 'upNext' | 'releaseDate' | 'popularity' | 'rating';
const PROGRESS_SORTS: [ProgressSort, string][] = [
  ['upNext', 'Up next'], ['releaseDate', 'Release date'], ['popularity', 'Popularity'], ['rating', 'Rating'],
];

const PLACEHOLDER: Record<Tab, string> = {
  wishlist: 'Search your wishlist…', progress: 'Search shows you’re watching…', library: 'Search your library…',
};
const NOUN: Record<Tab, string> = { wishlist: 'saved', progress: 'episodes', library: 'titles' };

/** Cut a date-sorted list into months. Titles with no date go last, under their own heading. */
function byMonth(rows: (CardItem & { releaseDate: string | null })[], newestFirst: boolean): CardSection[] {
  const months = new Map<string, CardItem[]>();
  const undated: CardItem[] = [];
  for (const r of rows) {
    const m = r.releaseDate?.slice(0, 7);
    if (!m || !/^\d{4}-\d{2}$/.test(m)) { undated.push(r); continue; }
    const list = months.get(m);
    if (list) list.push(r); else months.set(m, [r]);
  }
  const now = currentMonth();
  const ordered = [...months.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  if (newestFirst) ordered.reverse();
  const sections = ordered.map(([m, items]): CardSection => ({ key: m, label: monthLabel(m), past: m < now, current: m === now, items }));
  if (undated.length) sections.push({ key: 'none', label: 'No date yet', items: undated });
  return sections;
}

export default function MyStuffScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const tab: Tab = isTab(params.tab) ? params.tab : 'wishlist';
  const auth = useAuth();
  const [query, setQuery] = useState('');
  // A search belongs to the list it was typed over.
  useEffect(() => setQuery(''), [tab]);

  if (auth.status === 'signedOut') {
    return (
      <Screen wide>
        <SubBar />
        <View style={styles.gate}>
          <EmptyState
            icon={<Bookmark size={18} color={color.accent} />}
            title="Sign in to see your wishlist"
            hint="Your wishlist, your library and the shows you are part way through live in your Fandex account."
            actions={<Button label="Sign in" variant="primary" size="md" pill onPress={() => router.push('/profile')} />}
          />
        </View>
      </Screen>
    );
  }

  const tabs = <Tabs tabs={TABS} active={tab} onChange={(t) => router.setParams({ tab: t === 'wishlist' ? undefined : t })} />;
  return tab === 'progress'
    ? <Progress tabs={tabs} query={query} setQuery={setQuery} />
    : <Shelf key={tab} relation={tab} tabs={tabs} query={query} setQuery={setQuery} />;
}

function SyncButton() {
  const auth = useAuth();
  const trakt = auth.profile?.identities.some((i) => i.provider === 'trakt');
  const busy = auth.rowsSyncing || auth.traktSync.running;
  return <Button label={busy ? 'Syncing…' : 'Sync'} disabled={busy} onPress={trakt ? auth.syncTraktNow : auth.syncRows} />;
}

// ── Wishlist and Library ─────────────────────────────────────────────────────

function Shelf({ relation, tabs, query, setQuery }: { relation: 'wishlist' | 'library'; tabs: React.ReactNode; query: string; setQuery: (v: string) => void }) {
  const db = useSQLiteContext();
  const auth = useAuth();
  const catalog = useCatalogSync();
  const types = useTypeFilter();
  const router = useRouter();
  const [sort, setSort] = useState<Sort>('addedAt');
  const [rows, setRows] = useState<ShelfRow[] | null>(null);
  const [missing, setMissing] = useState(0);
  const [filters, setFilters] = useState(noFilters);
  const [sheet, setSheet] = useState(false);

  // The whole shelf, once. Every filter and sort below is over what is in memory,
  // because a filter over one page of a list only finds what you already scrolled past.
  useEffect(() => {
    let live = true;
    void Promise.all([shelf(db, relation, null, 'added', 100_000, 0), shelfCounts(db)]).then(([all, counts]) => {
      if (!live) return;
      setRows(all);
      setMissing(counts.missing);
    });
    return () => { live = false; };
  }, [db, relation, auth.rowsRevision, catalog.revision]);

  const term = normalizeName(query.trim());
  const filtered = useMemo(() => (rows ?? []).filter((r) => types.isVisible(r.type) && (!term || normalizeName(r.title).includes(term))), [rows, types, term]);
  const scores = useRowScores(useMemo(() => (sort === 'fandexScore' ? filtered.map((r) => r.id) : []), [sort, filtered]));

  const sorted = useMemo(() => {
    const list = [...filtered];
    const votes = (r: ShelfRow) => r.community_votes ?? 0;
    switch (sort) {
      case 'addedAt': return list.sort((a, b) => b.added_at - a.added_at);
      case 'popularity': return list.sort((a, b) => votes(b) - votes(a));
      case 'rating': return list.sort((a, b) => (b.community_score ?? -1) - (a.community_score ?? -1) || votes(b) - votes(a));
      case 'fandexScore': return list.sort((a, b) => (scores.get(b.id) ?? -1) - (scores.get(a.id) ?? -1));
      // Dated first, in order. What "order" means is decided where the months are cut.
      case 'releaseDate': return list.sort((a, b) => ((a.release_date ?? '9999') < (b.release_date ?? '9999') ? -1 : 1));
    }
  }, [filtered, sort, scores]);

  const allCards = useMemo(() => sorted.map(cardFromCatalog), [sorted]);
  const listed = Object.values(filters.membership).some(Boolean);
  const stateOf = useCardStates(useMemo(() => (listed ? allCards.map((c) => c.id) : []), [listed, allCards]));
  const cards = useFiltered(allCards, filters, stateOf);
  // A wishlist by date is a timeline, oldest first, so what is next is where you look.
  // A library by date is newest first.
  const sections = useMemo(() => (sort === 'releaseDate' ? byMonth(cards, relation === 'library') : undefined), [sort, cards, relation]);

  const total = rows?.length ?? 0;
  const empty = rows === null ? <StateBlock loading />
    : auth.rowsSyncing && total === 0 ? <StateBlock loading title="Fetching your library" />
    : total === 0 ? (
      <EmptyState
        title={relation === 'wishlist' ? 'Nothing on your wishlist yet' : 'Nothing in your library yet'}
        hint={relation === 'wishlist' ? 'Tap the bookmark on any title and it is saved here.' : 'Titles you watch, play or rate appear here.'}
        actions={<Button label="Find something" variant="secondary" size="md" onPress={() => router.push('/discover')} />}
      />
    ) : <EmptyState title="Nothing matches" hint={term ? 'No title here has that in its name.' : 'No titles of the types you are looking at.'} />;

  return (
    <Screen wide>
      <SubBar
        tabs={tabs}
        search={{ value: query, onChange: setQuery, placeholder: PLACEHOLDER[relation] }}
        count={rows ? { noun: NOUN[relation], n: cards.length } : null}
        sort={{ value: sort, options: LIBRARY_SORTS, onChange: setSort }}
        actions={<SyncButton />}
        trailing={<FiltersButton active={countActive(filters)} onPress={() => setSheet(true)} />}
      />
      <FilterSheet open={sheet} onClose={() => setSheet(false)} filters={filters} onChange={setFilters} resultCount={cards.length} noun="titles" signedIn />
      <PosterGrid
        items={sections ? undefined : cards}
        sections={sections}
        empty={empty}
        header={
          auth.rowsError || missing > 0 ? (
            <View style={{ gap: 4, marginBottom: 12 }}>
              {auth.rowsError ? <Text style={[type.caption, { color: color.warning }]}>{auth.rowsError}</Text> : null}
              {missing > 0 ? <Text style={type.caption}>{missing.toLocaleString('en')} of your titles are still downloading.</Text> : null}
            </View>
          ) : null
        }
      />
    </Screen>
  );
}

// ── Progress ─────────────────────────────────────────────────────────────────

function Progress({ tabs, query, setQuery }: { tabs: React.ReactNode; query: string; setQuery: (v: string) => void }) {
  const types = useTypeFilter();
  // The whole list, not the home rail's first thirty.
  const up = useUpNext(10_000);
  const [sort, setSort] = useState<ProgressSort>('upNext');

  const term = normalizeName(query.trim());
  const shown = useMemo(() => {
    const list = (up.entries ?? []).filter((e) => !term || normalizeName(e.title).includes(term));
    switch (sort) {
      case 'upNext': return list;
      case 'popularity': return [...list].sort((a, b) => b.votes - a.votes);
      case 'rating': return [...list].sort((a, b) => (b.communityScore ?? -1) - (a.communityScore ?? -1));
      case 'releaseDate': return [...list].sort((a, b) => ((b.releaseDate ?? '') < (a.releaseDate ?? '') ? -1 : 1));
    }
  }, [up.entries, term, sort]);

  const showsVisible = types.isVisible('show');
  return (
    <Screen wide>
      <SubBar
        tabs={tabs}
        search={{ value: query, onChange: setQuery, placeholder: PLACEHOLDER.progress }}
        count={up.entries ? { noun: NOUN.progress, n: showsVisible ? shown.length : 0 } : null}
        sort={{ value: sort, options: PROGRESS_SORTS, onChange: setSort }}
        actions={<SyncButton />}
      />
      {up.entries === null ? <StateBlock loading /> : (
        <FlatList
          data={showsVisible ? shown : []}
          keyExtractor={up.entryKey}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: EPISODE_ROW_GAP }} />}
          ListHeaderComponent={
            up.error || (up.refreshing && up.pending > 0) ? (
              <Text style={[type.caption, { marginBottom: 12, color: up.error ? color.warning : color.textSecondary }]}>
                {up.error ?? 'Asking Trakt what is next…'}
              </Text>
            ) : null
          }
          ListEmptyComponent={
            !showsVisible ? <EmptyState title="Shows are filtered out" hint="Progress is about shows. Pick Shows, or all types, in the filter above." />
              : term ? <EmptyState title="Nothing matches" hint="No show you are watching has that in its name." />
              : up.refreshing ? <StateBlock loading title="Asking Trakt what is next" />
              : <EmptyState title="You are caught up" hint="A show appears here when it has an episode out that you have not watched." />
          }
          renderItem={({ item }) => {
            const k = up.entryKey(item);
            return <EpisodeRow entry={item} ticked={up.done.has(k)} exiting={up.leaving.has(k)} onTick={(e) => void up.tick(e)} />;
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  gate: { flex: 1, justifyContent: 'center', padding: 24 },
  list: { width: '100%', maxWidth: 1152, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 16, paddingBottom: 44 },
});
